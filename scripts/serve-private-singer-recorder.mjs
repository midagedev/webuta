#!/usr/bin/env node

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { summarizeLyricCoverage } from './audit-private-singer-prompt-coverage.mjs'

const DEFAULT_PACK_DIR = 'experiments/neural-singer/datasets/original-private-singer'
const DEFAULT_MAX_AUDIO_BYTES = 120 * 1024 * 1024

export function createPrivateSingerRecorderServer(options = {}) {
  const config = recorderConfig(options)
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        writeHtml(res, recorderHtml())
        return
      }
      if (req.method === 'GET' && req.url === '/health') {
        writeJson(res, 200, { version: 1, ok: true, packDir: config.packDir })
        return
      }
      if (req.method === 'GET' && req.url === '/api/session') {
        writeJson(res, 200, readRecordingSession(config))
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/guides/')) {
        serveGuideFile(req, res, config)
        return
      }
      const takeUpload = /^\/api\/takes\/([^/]+)\/wav$/u.exec(req.url ?? '')
      if (takeUpload && req.method === 'POST') {
        await saveTakeWav(req, res, config, decodeURIComponent(takeUpload[1]))
        return
      }
      writeJson(res, 404, errorResponse('not-found', 'Unknown recording companion endpoint.'))
    } catch (error) {
      writeJson(res, 400, errorResponse('bad-request', error instanceof Error ? error.message : String(error)))
    }
  })
}

export function readRecordingSession(options = {}) {
  const config = recorderConfig(options)
  if (!existsSync(config.sessionPath)) {
    throw new Error(`Missing recording session: ${config.sessionPath}`)
  }
  const session = JSON.parse(readFileSync(config.sessionPath, 'utf8'))
  const takes = Array.isArray(session.takes) ? session.takes.map((take) => takeStatus(config, take)) : []
  const recordedCount = takes.filter((take) => take.recorded.exists).length
  const guideCount = takes.filter((take) => take.guide.exists).length
  const coverage = summarizeRecorderCoverage(takes)
  return {
    version: 1,
    packDir: config.packDir,
    sessionPath: config.sessionPath,
    sessionId: session.sessionId ?? '(unknown)',
    singerId: session.singerId ?? '(unknown)',
    recommendedRecording: session.recommendedRecording ?? {},
    totals: {
      takeCount: takes.length,
      recordedCount,
      missingCount: takes.length - recordedCount,
      guideCount,
      totalEstimatedMinutes: Number(session.totals?.totalEstimatedMinutes ?? 0),
      recordedEstimatedMinutes: coverage.recorded.estimatedMinutes,
      missingEstimatedMinutes: coverage.missing.estimatedMinutes,
    },
    consent: inspectRecorderConsent(config.packDir),
    coverage,
    takes,
  }
}

function recorderConfig(options = {}) {
  const packDir = resolve(options.packDir ?? DEFAULT_PACK_DIR)
  return {
    packDir,
    sessionPath: resolve(options.session ?? join(packDir, 'recording-session.json')),
    maxAudioBytes: Number(options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES),
  }
}

function takeStatus(config, take) {
  const wavPath = resolve(config.packDir, take.wavPath)
  const guidePath = resolve(config.packDir, 'guides', `${take.id}.guide.wav`)
  const wavStats = fileStats(wavPath)
  const guideStats = fileStats(guidePath)
  const wavInfo = wavStats.exists ? safeWavInfo(wavPath) : null
  return {
    id: take.id,
    takeNumber: take.takeNumber,
    promptId: take.promptId,
    setId: take.setId,
    lyric: take.lyric,
    key: take.key,
    tempo: take.tempo,
    tags: take.tags ?? [],
    expectedSeconds: take.singingSeconds,
    estimatedSeconds: take.estimatedSeconds,
    wavPath: take.wavPath,
    scorePath: take.scorePath,
    neuralRequestPath: take.neuralRequestPath,
    guide: {
      exists: guideStats.exists,
      url: guideStats.exists ? `/guides/${encodeURIComponent(basename(guidePath))}` : null,
      sizeBytes: guideStats.sizeBytes,
    },
    recorded: {
      exists: wavStats.exists,
      sizeBytes: wavStats.sizeBytes,
      modifiedAt: wavStats.modifiedAt,
      wav: wavInfo,
    },
  }
}

function summarizeRecorderCoverage(takes) {
  const recorded = takes.filter((take) => take.recorded.exists)
  const missing = takes.filter((take) => !take.recorded.exists)
  return {
    planned: recorderCoverageBucket(takes, takes.length),
    recorded: recorderCoverageBucket(recorded, takes.length),
    missing: recorderCoverageBucket(missing, takes.length),
  }
}

function recorderCoverageBucket(takes, plannedTakeCount) {
  const estimatedSeconds = takes.reduce((total, take) => total + Number(take.estimatedSeconds ?? 0), 0)
  return {
    takeCount: takes.length,
    takeRatio: plannedTakeCount > 0 ? roundMetric(takes.length / plannedTakeCount) : 0,
    estimatedSeconds: roundMetric(estimatedSeconds),
    estimatedMinutes: roundMetric(estimatedSeconds / 60),
    lyricCoverage: summarizeLyricCoverage(takes),
  }
}

function inspectRecorderConsent(packDir) {
  const templatePath = join(packDir, 'consent-form.template.md')
  const signedConsentPath = join(packDir, 'consent-form.signed.local.md')
  const signedConsentExists = existsSync(signedConsentPath)
  const signedConsentFields = signedConsentExists ? readConsentFields(signedConsentPath) : {}
  const filledFields = {
    singerSignature: Boolean(signedConsentFields.singerSignature),
    date: Boolean(signedConsentFields.date),
    reviewer: Boolean(signedConsentFields.reviewer),
  }
  return {
    requiresSignedConsent: existsSync(templatePath) || signedConsentExists,
    templatePath,
    templateExists: existsSync(templatePath),
    signedConsentPath,
    signedConsentExists,
    signedConsentReady:
      signedConsentExists && filledFields.singerSignature && filledFields.date && filledFields.reviewer,
    filledFields,
  }
}

function readConsentFields(path) {
  const text = readFileSync(path, 'utf8')
  return {
    singerSignature: consentFieldValue(text, 'Singer signature'),
    date: consentFieldValue(text, 'Date'),
    reviewer: consentFieldValue(text, 'Reviewer'),
  }
}

function consentFieldValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = text.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, 'imu'))
  return match?.[1]?.trim() ?? ''
}

function roundMetric(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

function fileStats(path) {
  if (!existsSync(path)) {
    return { exists: false, sizeBytes: 0, modifiedAt: null }
  }
  const stats = statSync(path)
  return {
    exists: stats.isFile(),
    sizeBytes: stats.isFile() ? stats.size : 0,
    modifiedAt: stats.isFile() ? stats.mtime.toISOString() : null,
  }
}

function safeWavInfo(path) {
  try {
    return readWavInfo(readFileSync(path))
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function serveGuideFile(req, res, config) {
  const fileName = decodeURIComponent((req.url ?? '').replace(/^\/guides\//u, ''))
  if (fileName !== basename(fileName) || extname(fileName).toLowerCase() !== '.wav') {
    writeJson(res, 404, errorResponse('not-found', 'Guide file not found.'))
    return
  }
  const guidePath = resolve(config.packDir, 'guides', fileName)
  if (!guidePath.startsWith(resolve(config.packDir, 'guides')) || !existsSync(guidePath)) {
    writeJson(res, 404, errorResponse('not-found', 'Guide file not found.'))
    return
  }
  const buffer = readFileSync(guidePath)
  res.writeHead(200, {
    'content-type': 'audio/wav',
    'content-length': buffer.length,
    'cache-control': 'no-store',
  })
  res.end(buffer)
}

async function saveTakeWav(req, res, config, takeId) {
  const session = readRecordingSession(config)
  const take = session.takes.find((entry) => entry.id === takeId)
  if (!take) {
    writeJson(res, 404, errorResponse('unknown-take', `Unknown take id: ${takeId}`))
    return
  }
  const buffer = await readRequestBody(req, config.maxAudioBytes)
  const wav = readWavInfo(buffer)
  if (wav.durationSeconds <= 0) {
    throw new Error('Recorded WAV has no audio data.')
  }
  const wavPath = resolve(config.packDir, take.wavPath)
  if (!wavPath.startsWith(config.packDir)) {
    throw new Error(`Unsafe take wavPath: ${take.wavPath}`)
  }
  mkdirSync(dirname(wavPath), { recursive: true })
  writeFileSync(wavPath, buffer)
  writeJson(res, 200, {
    version: 1,
    ok: true,
    takeId,
    wavPath: relative(config.packDir, wavPath),
    wav,
    sizeBytes: buffer.length,
  })
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        fail(new Error(`Audio upload is larger than ${maxBytes} bytes.`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) {
        return
      }
      settled = true
      resolvePromise(Buffer.concat(chunks))
    })
    req.on('aborted', () => fail(new Error('Audio upload was aborted.')))
    req.on('error', fail)
  })
}

function readWavInfo(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Uploaded audio must be a WAV file.')
  }
  let offset = 12
  let audioFormat = null
  let channels = null
  let sampleRate = null
  let bitsPerSample = null
  let byteRate = null
  let dataBytes = null
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === 'fmt ' && chunkStart + 16 <= buffer.length) {
      audioFormat = buffer.readUInt16LE(chunkStart)
      channels = buffer.readUInt16LE(chunkStart + 2)
      sampleRate = buffer.readUInt32LE(chunkStart + 4)
      byteRate = buffer.readUInt32LE(chunkStart + 8)
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14)
    } else if (chunkId === 'data') {
      dataBytes = chunkSize
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  if (!sampleRate || !channels || !bitsPerSample || !byteRate || dataBytes === null) {
    throw new Error('WAV is missing fmt or data metadata.')
  }
  return {
    valid: true,
    audioFormat,
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationSeconds: dataBytes / byteRate,
  }
}

function writeHtml(res, html) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(html)
}

function writeJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(`${JSON.stringify(value, null, 2)}\n`)
}

function errorResponse(code, message) {
  return {
    version: 1,
    ok: false,
    error: { code, message },
  }
}

function recorderHtml() {
  return String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WebUtau Recording Companion</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080611;
      --panel: #141020;
      --panel-2: #1d162c;
      --line: #3b3151;
      --text: #f8f5ff;
      --muted: #bdb3d6;
      --hot: #ff4fd8;
      --cyan: #21e6ff;
      --lime: #b8ff4f;
      --warn: #ffd166;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      letter-spacing: 0;
    }
    button {
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      min-height: 42px;
      padding: 0 14px;
      border-radius: 6px;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button.primary { border-color: var(--hot); background: var(--hot); color: #170515; }
    button.cyan { border-color: var(--cyan); background: var(--cyan); color: #031014; }
    button.ghost { background: transparent; }
    .app {
      display: grid;
      grid-template-columns: 320px 1fr;
      min-height: 100vh;
      overflow-x: hidden;
    }
    aside {
      border-right: 1px solid var(--line);
      background: #0f0b19;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    header {
      padding: 16px;
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.1;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .meter {
      height: 10px;
      border: 1px solid var(--line);
      margin-top: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: #07050d;
    }
    .meter > span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--cyan), var(--hot));
      width: 0%;
    }
    .take-list {
      overflow: auto;
      padding: 10px;
      display: grid;
      gap: 8px;
      max-height: calc(100vh - 132px);
    }
    .take-row {
      text-align: left;
      display: grid;
      grid-template-columns: 38px 1fr auto;
      gap: 10px;
      align-items: center;
      min-height: 52px;
      width: 100%;
      background: var(--panel);
    }
    .take-row[aria-current="true"] { border-color: var(--hot); box-shadow: inset 4px 0 0 var(--hot); }
    .take-no { color: var(--cyan); font-weight: 900; }
    .take-title { min-width: 0; }
    .take-title strong, .take-title span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .take-title span { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 900;
      color: var(--muted);
    }
    .badge.done { border-color: var(--lime); color: var(--lime); }
    main {
      display: grid;
      grid-template-rows: auto 1fr auto;
      min-width: 0;
      min-height: 100vh;
      overflow-x: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
      background: #100b1b;
    }
    .toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .stage {
      display: grid;
      align-content: center;
      gap: 20px;
      padding: clamp(18px, 5vw, 56px);
    }
    .count {
      color: var(--cyan);
      font-size: 13px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .lyric {
      font-size: clamp(32px, 7vw, 88px);
      line-height: 1.08;
      font-weight: 950;
      max-width: 980px;
      word-break: keep-all;
    }
    .details {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: var(--muted);
      font-weight: 800;
    }
    .status {
      min-height: 26px;
      color: var(--warn);
      font-weight: 800;
    }
    .transport {
      border-top: 1px solid var(--line);
      padding: 14px 16px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      background: #100b1b;
    }
    .recording {
      color: var(--hot);
      font-weight: 950;
      min-height: 22px;
    }
    audio {
      width: min(520px, 100%);
      max-width: 100%;
    }
    @media (max-width: 820px) {
      .app { grid-template-columns: 1fr; }
      aside {
        width: 100%;
        min-height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--line);
        overflow: hidden;
      }
      .take-list {
        grid-auto-flow: column;
        grid-auto-columns: minmax(230px, 72vw);
        overflow-x: auto;
        overflow-y: hidden;
        max-height: none;
        width: 100%;
      }
      main { min-height: auto; }
      .toolbar, .transport { grid-template-columns: 1fr; align-items: stretch; }
      .toolbar { display: grid; }
      .toolbar-actions { justify-content: stretch; }
      .toolbar-actions button, .transport button { flex: 1 1 130px; }
      .lyric { font-size: clamp(34px, 12vw, 56px); }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <header>
        <h1>WebUtau Recording Companion</h1>
        <div class="meta" id="sessionMeta"></div>
        <div class="meter" aria-label="Recording progress"><span id="progressBar"></span></div>
      </header>
      <div class="take-list" id="takeList"></div>
    </aside>
    <main>
      <div class="toolbar">
        <div>
          <div class="count" id="takeCount">Loading</div>
          <div class="status" id="status"></div>
        </div>
        <div class="toolbar-actions">
          <button class="ghost" id="prevButton" type="button">Prev</button>
          <button class="ghost" id="nextButton" type="button">Next</button>
          <button class="cyan" id="playButton" type="button">Play Guide</button>
        </div>
      </div>
      <section class="stage">
        <div class="lyric" id="lyric">...</div>
        <div class="details" id="details"></div>
        <audio id="guideAudio" controls preload="auto"></audio>
      </section>
      <div class="transport">
        <div>
          <div class="recording" id="recordingState"></div>
          <div class="details" id="recordedInfo"></div>
        </div>
        <div class="toolbar-actions">
          <button class="primary" id="recordButton" type="button">Record</button>
          <button id="stopButton" type="button" disabled>Stop & Save</button>
        </div>
      </div>
    </main>
  </div>
  <script>
    const state = {
      session: null,
      index: 0,
      stream: null,
      context: null,
      processor: null,
      source: null,
      buffers: [],
      recordingStartedAt: 0,
    };
    const $ = (id) => document.getElementById(id);
    const sessionMeta = $('sessionMeta');
    const progressBar = $('progressBar');
    const takeList = $('takeList');
    const takeCount = $('takeCount');
    const status = $('status');
    const lyric = $('lyric');
    const details = $('details');
    const guideAudio = $('guideAudio');
    const recordingState = $('recordingState');
    const recordedInfo = $('recordedInfo');

    $('prevButton').addEventListener('click', () => selectTake(Math.max(0, state.index - 1)));
    $('nextButton').addEventListener('click', () => selectTake(Math.min(state.session.takes.length - 1, state.index + 1)));
    $('playButton').addEventListener('click', playGuide);
    $('recordButton').addEventListener('click', startRecording);
    $('stopButton').addEventListener('click', stopAndSave);

    loadSession();

    async function loadSession(keepTakeId) {
      const response = await fetch('/api/session');
      state.session = await response.json();
      const previousIndex = keepTakeId ? state.session.takes.findIndex((take) => take.id === keepTakeId) : state.index;
      state.index = Math.max(0, previousIndex === -1 ? 0 : Math.min(previousIndex, state.session.takes.length - 1));
      render();
    }

    function render() {
      const session = state.session;
      const take = currentTake();
      const percent = session.totals.takeCount ? session.totals.recordedCount / session.totals.takeCount * 100 : 0;
      sessionMeta.textContent = session.sessionId + ' | ' + session.totals.recordedCount + '/' + session.totals.takeCount + ' recorded';
      progressBar.style.width = percent + '%';
      takeList.innerHTML = '';
      session.takes.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'take-row';
        button.setAttribute('aria-current', index === state.index ? 'true' : 'false');
        button.addEventListener('click', () => selectTake(index));
        button.innerHTML =
          '<span class="take-no">' + item.takeNumber + '</span>' +
          '<span class="take-title"><strong>' + escapeHtml(item.lyric) + '</strong><span>' + escapeHtml(item.key + ' / ' + item.promptId) + '</span></span>' +
          '<span class="badge ' + (item.recorded.exists ? 'done' : '') + '">' + (item.recorded.exists ? 'WAV' : 'OPEN') + '</span>';
        takeList.appendChild(button);
      });
      takeCount.textContent = 'Take ' + take.takeNumber + ' of ' + session.totals.takeCount;
      lyric.textContent = take.lyric;
      details.textContent = [take.key, take.tempo + ' BPM', Math.round(take.expectedSeconds * 10) / 10 + 's', take.wavPath].join(' | ');
      guideAudio.src = take.guide.url || '';
      $('playButton').disabled = !take.guide.exists;
      recordedInfo.textContent = take.recorded.exists
        ? 'Saved: ' + formatSeconds(take.recorded.wav?.durationSeconds) + ' / ' + Math.round(take.recorded.sizeBytes / 1024) + ' KB'
        : 'No WAV saved yet';
    }

    function selectTake(index) {
      state.index = index;
      render();
    }

    function currentTake() {
      return state.session.takes[state.index];
    }

    async function playGuide() {
      if (!currentTake().guide.exists) {
        setStatus('Guide WAV is missing. Run npm run neural:prepare-guides first.');
        return;
      }
      guideAudio.currentTime = 0;
      await guideAudio.play();
      setStatus('Guide playing');
    }

    async function startRecording() {
      if (state.processor) {
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      state.stream = stream;
      state.context = context;
      state.source = source;
      state.processor = processor;
      state.buffers = [];
      state.recordingStartedAt = performance.now();
      processor.onaudioprocess = (event) => {
        state.buffers.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        recordingState.textContent = 'Recording ' + formatSeconds((performance.now() - state.recordingStartedAt) / 1000);
      };
      source.connect(processor);
      processor.connect(context.destination);
      $('recordButton').disabled = true;
      $('stopButton').disabled = false;
      recordingState.textContent = 'Recording 0.0s';
      setStatus('Recording dry vocal');
    }

    async function stopAndSave() {
      const take = currentTake();
      const sampleRate = state.context.sampleRate;
      const samples = mergeBuffers(state.buffers);
      cleanupRecording();
      const wav = encodePcm16Wav(samples, sampleRate);
      setStatus('Saving ' + take.wavPath);
      const response = await fetch('/api/takes/' + encodeURIComponent(take.id) + '/wav', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav
      });
      const result = await response.json();
      if (!result.ok) {
        setStatus(result.error?.message || 'Save failed');
        return;
      }
      setStatus('Saved ' + take.wavPath);
      await loadSession(take.id);
    }

    function cleanupRecording() {
      state.processor?.disconnect();
      state.source?.disconnect();
      state.stream?.getTracks().forEach((track) => track.stop());
      state.context?.close();
      state.processor = null;
      state.source = null;
      state.stream = null;
      state.context = null;
      $('recordButton').disabled = false;
      $('stopButton').disabled = true;
      recordingState.textContent = '';
    }

    function mergeBuffers(buffers) {
      const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
      const merged = new Float32Array(length);
      let offset = 0;
      for (const buffer of buffers) {
        merged.set(buffer, offset);
        offset += buffer.length;
      }
      return merged;
    }

    function encodePcm16Wav(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      writeAscii(view, 0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeAscii(view, 8, 'WAVE');
      writeAscii(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(view, 36, 'data');
      view.setUint32(40, samples.length * 2, true);
      let offset = 44;
      for (const value of samples) {
        const sample = Math.max(-1, Math.min(1, value));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
      return new Blob([view], { type: 'audio/wav' });
    }

    function writeAscii(view, offset, text) {
      for (let index = 0; index < text.length; index += 1) {
        view.setUint8(offset + index, text.charCodeAt(index));
      }
    }

    function setStatus(message) {
      status.textContent = message;
    }

    function formatSeconds(value) {
      return Number.isFinite(value) ? value.toFixed(1) + 's' : 'unknown';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]);
    }
  </script>
</body>
</html>`
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pack-dir') {
      parsed.packDir = argv[++index]
    } else if (arg === '--session') {
      parsed.session = argv[++index]
    } else if (arg === '--host') {
      parsed.host = argv[++index]
    } else if (arg === '--port') {
      parsed.port = Number(argv[++index])
    } else if (arg === '--max-audio-bytes') {
      parsed.maxAudioBytes = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/serve-private-singer-recorder.mjs [options]',
          '',
          'Options:',
          `  --pack-dir path        Recording pack dir, default ${DEFAULT_PACK_DIR}`,
          '  --session path         recording-session.json path',
          '  --host address         Bind address, default 127.0.0.1',
          '  --port port            Bind port, default 8791',
          `  --max-audio-bytes n    Upload cap, default ${DEFAULT_MAX_AUDIO_BYTES}`,
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return parsed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const host = options.host ?? '127.0.0.1'
    const port = options.port ?? 8791
    const server = createPrivateSingerRecorderServer(options)
    server.listen(port, host, () => {
      process.stdout.write(`WebUtau private singer recorder listening on http://${host}:${port}/\n`)
    })
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
