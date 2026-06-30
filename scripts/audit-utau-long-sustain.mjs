#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { estimateFrameF0 } from './analyze-korean-v3-pitch.mjs'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_TIMEOUT_MS = 60_000
const PROJECT_STORAGE_KEY = 'webuta.project.v1'
const TICKS_PER_BEAT = 480
const DEFAULT_OUT_DIR = 'experiments/utau-v3/work/long-sustain-audit'

const THRESHOLDS = {
  minDurationSeconds: 40,
  minBodyRms: 0.025,
  minSustainMinWindowRatio: 0.3,
  minSustainTailHeadRatio: 0.55,
  maxSustainStep: 0.16,
  maxClickCandidateCount: 2,
  maxEarlyTransientCount: 4,
  minConsonantAttackRatio: 0.18,
  minCodaTailRatio: 0.025,
  maxMedianAbsCents: 35,
  maxPitchDriftCents: 55,
  minMedianPitchConfidence: 0.55,
  minVoicedFrames: 12,
}

const TEST_NOTES = [
  { lyric: '아', tone: 65, role: 'pure-vowel' },
  { lyric: '도', tone: 65, role: 'stop-onset' },
  { lyric: '히', tone: 65, role: 'fricative-onset' },
  { lyric: '키', tone: 65, role: 'key-onset-regression' },
  { lyric: '연', tone: 65, role: 'coda-n' },
  { lyric: '한', tone: 65, role: 'coda-h-n' },
  { lyric: '랑', tone: 65, role: 'coda-ng' },
  { lyric: '밤', tone: 65, role: 'coda-m' },
  { lyric: '빛', tone: 65, role: 'coda-s' },
]

export async function auditUtauLongSustain(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR)
  const tempRoot = mkdtempSync(join(tmpdir(), 'webuta-long-sustain-'))
  let server = null
  let browser = null

  try {
    mkdirSync(outDir, { recursive: true })
    const project = makeLongSustainProject()
    const url = options.url ?? (await startViteServer({ cwd, host: options.host ?? DEFAULT_HOST, port: options.port }))
    server = typeof url === 'string' ? null : url.server
    const baseUrl = typeof url === 'string' ? url : url.url

    browser = await chromium.launch({ headless: !options.headed })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 860 },
    })
    await context.addInitScript(
      ({ key, projectPayload }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            savedAt: new Date().toISOString(),
            project: projectPayload,
          }),
        )
      },
      { key: PROJECT_STORAGE_KEY, projectPayload: project },
    )
    const page = await context.newPage()
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS })
    await page.getByLabel('Current project').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.waitForFunction(
      () => document.body.textContent?.includes('WebUtau Korean V3 Synthetic'),
      undefined,
      { timeout: DEFAULT_TIMEOUT_MS },
    )
    await page.getByText('WAV not rendered yet').waitFor({ timeout: DEFAULT_TIMEOUT_MS })

    const downloadPromise = page.waitForEvent('download', { timeout: DEFAULT_TIMEOUT_MS })
    await page.getByRole('button', { name: '하단 WAV 다운로드' }).click()
    const download = await downloadPromise
    const wavPath = join(outDir, 'webuta-v3-long-sustain-utau.wav')
    await download.saveAs(wavPath)
    await page.getByText('WAV downloaded', { exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })

    const decoded = decodePcm16Wav(readFileSync(wavPath))
    const noteAudits = project.notes.map((note) => analyzeRenderedNote(note, project, decoded.samples, decoded.info.sampleRate))
    const problems = [
      ...(decoded.info.durationSeconds >= THRESHOLDS.minDurationSeconds
        ? []
        : [`WAV duration ${formatNumber(decoded.info.durationSeconds, 3)}s below ${THRESHOLDS.minDurationSeconds}s`]),
      ...noteAudits.flatMap((audit) => audit.problems.map((problem) => `${audit.lyric}: ${problem}`)),
    ]
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ok: problems.length === 0,
      decision: problems.length === 0 ? 'utau-long-sustain-audit-pass' : 'utau-long-sustain-audit-fail',
      thresholds: THRESHOLDS,
      app: {
        url: baseUrl,
        renderer: 'WebUtau Korean V3 Synthetic UTAU',
      },
      wav: {
        path: wavPath,
        fileName: download.suggestedFilename(),
        sampleRate: decoded.info.sampleRate,
        channels: decoded.info.channels,
        bitsPerSample: decoded.info.bitsPerSample,
        durationSeconds: decoded.info.durationSeconds,
        bytes: decoded.info.bytes,
      },
      project: {
        path: join(outDir, 'long-sustain-project.webutau.json'),
        name: project.name,
        bpm: project.bpm,
        noteCount: project.notes.length,
      },
      summary: summarizeNoteAudits(noteAudits),
      notes: noteAudits,
      problems,
    }

    writeJson(join(outDir, 'long-sustain-project.webutau.json'), project)
    writeJson(resolve(options.report ?? join(outDir, 'long-sustain-audit.json')), report)
    return report
  } finally {
    if (browser) {
      await browser.close()
    }
    if (server) {
      server.kill('SIGTERM')
      await onceExit(server, 1500)
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function makeLongSustainProject() {
  const bpm = 90
  const trackId = 'track-long-sustain'
  const partId = 'part-long-sustain'
  const duration = TICKS_PER_BEAT * 6
  const gap = TICKS_PER_BEAT
  const startOffset = TICKS_PER_BEAT
  const notes = TEST_NOTES.map((item, index) => ({
    id: `long-${index + 1}`,
    trackId,
    partId,
    start: startOffset + index * (duration + gap),
    duration,
    tone: item.tone,
    lyric: item.lyric,
  }))
  const endTick = notes.at(-1).start + duration + TICKS_PER_BEAT * 2
  return {
    id: 'utau-long-sustain-audit',
    name: 'UTAU Long Sustain Audit',
    comment: 'Generated QA project for long UTAU sustain, click, onset, vowel, and coda checks.',
    bpm,
    beatPerBar: 4,
    beatUnit: 4,
    source: {
      fileName: 'long-sustain-audit',
      format: 'webuta',
    },
    tracks: [
      {
        id: trackId,
        name: 'Generated V3 QA',
        color: 'Coral',
        singer: 'WebUtau Korean V3 Synthetic',
        phonemizer: 'hangul cv/vc synthetic',
      },
    ],
    parts: [
      {
        id: partId,
        trackId,
        name: 'Long sustain QA',
        start: 0,
        duration: endTick,
      },
    ],
    notes,
  }
}

function analyzeRenderedNote(note, project, samples, sampleRate) {
  const phoneme = decomposeHangul(note.lyric)
  const startSeconds = ticksToSeconds(note.start, project.bpm)
  const endSeconds = ticksToSeconds(note.start + note.duration, project.bpm)
  const hasCoda = Boolean(phoneme?.coda)
  const hasAudibleOnset = Boolean(phoneme?.onset && phoneme.onset !== 'ㅇ')
  const bodyStart = startSeconds + 0.55
  const bodyEnd = endSeconds - (hasCoda ? 0.58 : 0.36)
  const body = sliceByTime(samples, sampleRate, bodyStart, bodyEnd)
  const bodyRms = rms(body)
  const windowRms = movingRms(body, sampleRate, 0.1, 0.05)
  const diffFrames = movingDiffRms(body, sampleRate, 0.02, 0.01)
  const medianWindow = median(windowRms)
  const medianDiff = median(diffFrames)
  const sustainStep = maxAbsStep(body)
  const clickThreshold = Math.max(THRESHOLDS.maxSustainStep, bodyRms * 0.8)
  const clickCandidateCount = countSampleSteps(body, clickThreshold)
  const earlyTransientThreshold = Math.max(0.025, medianDiff * 3.6)
  const earlyTransientCount = diffFrames.filter((value) => value > earlyTransientThreshold).length
  const firstThirdRms = median(movingRms(sliceFraction(body, 0, 0.33), sampleRate, 0.1, 0.05))
  const lastThirdRms = median(movingRms(sliceFraction(body, 0.67, 1), sampleRate, 0.1, 0.05))
  const attack = sliceByTime(samples, sampleRate, startSeconds - 0.08, startSeconds + 0.16)
  const codaTail = sliceByTime(samples, sampleRate, endSeconds - 0.18, endSeconds + 0.22)
  const attackRms = rms(attack)
  const codaTailRms = rms(codaTail)
  const attackRatio = attackRms / Math.max(bodyRms, 1e-6)
  const codaTailRatio = codaTailRms / Math.max(bodyRms, 1e-6)
  const sustainMinWindowRatio = min(windowRms) / Math.max(medianWindow, 1e-6)
  const sustainTailHeadRatio = lastThirdRms / Math.max(firstThirdRms, 1e-6)
  const pitch = analyzePitch(body, sampleRate, midiToHz(note.tone))

  const problems = [
    ...(bodyRms >= THRESHOLDS.minBodyRms
      ? []
      : [`body RMS ${formatNumber(bodyRms, 4)} below ${THRESHOLDS.minBodyRms}`]),
    ...(sustainMinWindowRatio >= THRESHOLDS.minSustainMinWindowRatio
      ? []
      : [
          `sustain RMS dip ratio ${formatNumber(sustainMinWindowRatio, 3)} below ${THRESHOLDS.minSustainMinWindowRatio}`,
        ]),
    ...(sustainTailHeadRatio >= THRESHOLDS.minSustainTailHeadRatio
      ? []
      : [`sustain tail/head RMS ratio ${formatNumber(sustainTailHeadRatio, 3)} below ${THRESHOLDS.minSustainTailHeadRatio}`]),
    ...(sustainStep <= THRESHOLDS.maxSustainStep
      ? []
      : [`max sustain sample step ${formatNumber(sustainStep, 4)} exceeds ${THRESHOLDS.maxSustainStep}`]),
    ...(clickCandidateCount <= THRESHOLDS.maxClickCandidateCount
      ? []
      : [`${clickCandidateCount} click-like sample steps in sustain body`]),
    ...(earlyTransientCount <= THRESHOLDS.maxEarlyTransientCount
      ? []
      : [`${earlyTransientCount} repeated transient frames before coda/release`]),
    ...(hasAudibleOnset && attackRatio < THRESHOLDS.minConsonantAttackRatio
      ? [`initial consonant attack ratio ${formatNumber(attackRatio, 3)} below ${THRESHOLDS.minConsonantAttackRatio}`]
      : []),
    ...(hasCoda && codaTailRatio < THRESHOLDS.minCodaTailRatio
      ? [`coda tail ratio ${formatNumber(codaTailRatio, 3)} below ${THRESHOLDS.minCodaTailRatio}`]
      : []),
    ...(pitch.voicedFrames >= THRESHOLDS.minVoicedFrames
      ? []
      : [`only ${pitch.voicedFrames} voiced pitch frames; expected at least ${THRESHOLDS.minVoicedFrames}`]),
    ...(pitch.medianAbsCents <= THRESHOLDS.maxMedianAbsCents
      ? []
      : [`median pitch error ${formatNumber(pitch.medianAbsCents, 1)} cents exceeds ${THRESHOLDS.maxMedianAbsCents}`]),
    ...(pitch.driftCents <= THRESHOLDS.maxPitchDriftCents
      ? []
      : [`in-note pitch drift ${formatNumber(pitch.driftCents, 1)} cents exceeds ${THRESHOLDS.maxPitchDriftCents}`]),
    ...(pitch.medianConfidence >= THRESHOLDS.minMedianPitchConfidence
      ? []
      : [
          `median pitch confidence ${formatNumber(pitch.medianConfidence, 3)} below ${THRESHOLDS.minMedianPitchConfidence}`,
        ]),
  ]

  return {
    id: note.id,
    lyric: note.lyric,
    role: TEST_NOTES.find((item) => item.lyric === note.lyric)?.role ?? null,
    phoneme,
    tone: note.tone,
    startSeconds,
    endSeconds,
    durationSeconds: endSeconds - startSeconds,
    ok: problems.length === 0,
    problems,
    metrics: {
      bodyRms,
      attackRms,
      attackRatio,
      codaTailRms,
      codaTailRatio: hasCoda ? codaTailRatio : null,
      sustainMinWindowRatio,
      sustainTailHeadRatio,
      maxSustainStep: sustainStep,
      clickThreshold,
      clickCandidateCount,
      medianDiffRms: medianDiff,
      earlyTransientThreshold,
      earlyTransientCount,
      bodyWindowCount: windowRms.length,
      diffFrameCount: diffFrames.length,
      pitch,
    },
  }
}

function summarizeNoteAudits(noteAudits) {
  return {
    okCount: noteAudits.filter((audit) => audit.ok).length,
    problemCount: noteAudits.filter((audit) => !audit.ok).length,
    maxSustainStep: max(noteAudits.map((audit) => audit.metrics.maxSustainStep)),
    maxClickCandidateCount: max(noteAudits.map((audit) => audit.metrics.clickCandidateCount)),
    maxEarlyTransientCount: max(noteAudits.map((audit) => audit.metrics.earlyTransientCount)),
    minSustainMinWindowRatio: min(noteAudits.map((audit) => audit.metrics.sustainMinWindowRatio)),
    minSustainTailHeadRatio: min(noteAudits.map((audit) => audit.metrics.sustainTailHeadRatio)),
    minConsonantAttackRatio: min(
      noteAudits
        .filter((audit) => audit.phoneme?.onset && audit.phoneme.onset !== 'ㅇ')
        .map((audit) => audit.metrics.attackRatio),
    ),
    minCodaTailRatio: min(
      noteAudits.filter((audit) => audit.phoneme?.coda).map((audit) => audit.metrics.codaTailRatio ?? Infinity),
    ),
    maxMedianAbsCents: max(noteAudits.map((audit) => audit.metrics.pitch.medianAbsCents)),
    maxPitchDriftCents: max(noteAudits.map((audit) => audit.metrics.pitch.driftCents)),
    minMedianPitchConfidence: min(noteAudits.map((audit) => audit.metrics.pitch.medianConfidence)),
    minVoicedFrames: min(noteAudits.map((audit) => audit.metrics.pitch.voicedFrames)),
  }
}

function analyzePitch(samples, sampleRate, expectedHz) {
  const frameSize = Math.max(512, Math.floor(sampleRate * 0.08))
  const hopSize = Math.max(128, Math.floor(sampleRate * 0.04))
  const frames = []
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const result = estimateFrameF0(samples.subarray(offset, offset + frameSize), sampleRate, expectedHz)
    if (!result) {
      continue
    }
    frames.push({
      offsetSeconds: offset / sampleRate,
      f0Hz: result.f0Hz,
      cents: centsBetween(result.f0Hz, expectedHz),
      confidence: result.confidence,
      rms: result.rms,
    })
  }
  const cents = frames.map((frame) => frame.cents)
  const confidences = frames.map((frame) => frame.confidence)
  const medianCents = median(cents)
  return {
    expectedHz,
    voicedFrames: frames.length,
    medianF0Hz: median(frames.map((frame) => frame.f0Hz)),
    medianCents,
    medianAbsCents: Math.abs(medianCents),
    driftCents: percentile(cents, 0.9) - percentile(cents, 0.1),
    maxAbsCents: max(cents.map((value) => Math.abs(value))),
    medianConfidence: median(confidences),
  }
}

function decodePcm16Wav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV container')
  }
  let fmtOffset = -1
  let dataOffset = -1
  let dataBytes = 0
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      fmtOffset = offset + 8
    }
    if (id === 'data') {
      dataOffset = offset + 8
      dataBytes = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (fmtOffset < 0 || dataOffset < 0) {
    throw new Error('Missing WAV fmt/data chunks')
  }
  const audioFormat = view.getUint16(fmtOffset, true)
  const channels = view.getUint16(fmtOffset + 2, true)
  const sampleRate = view.getUint32(fmtOffset + 4, true)
  const bitsPerSample = view.getUint16(fmtOffset + 14, true)
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV format: format=${audioFormat} channels=${channels} bits=${bitsPerSample}`)
  }
  const frameCount = Math.floor(dataBytes / 2)
  const samples = new Float32Array(frameCount)
  for (let index = 0; index < frameCount; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 0x8000
  }
  return {
    samples,
    info: {
      sampleRate,
      channels,
      bitsPerSample,
      dataBytes,
      durationSeconds: frameCount / sampleRate,
      bytes: view.byteLength,
    },
  }
}

async function startViteServer({ cwd, host, port }) {
  const selectedPort = port ? Number(port) : await findFreePort()
  const viteBin = resolve(cwd, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) {
    throw new Error(`Missing Vite binary: ${viteBin}`)
  }
  const child = spawn(process.execPath, [viteBin, '--host', host, '--port', String(selectedPort), '--strictPort'], {
    cwd,
    env: {
      ...process.env,
      BROWSER: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))
  const url = `http://${host}:${selectedPort}/`
  await waitForHttp(url, child, logs)
  return { url, server: child }
}

async function waitForHttp(url, child, logs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < DEFAULT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before serving ${url}\n${logs.join('')}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Keep polling while Vite boots.
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${url}\n${logs.join('')}`)
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, DEFAULT_HOST, () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local port.'))
          return
        }
        resolvePort(address.port)
      })
    })
  })
}

function onceExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolveExit()
    }, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function ticksToSeconds(ticks, bpm) {
  return (ticks / TICKS_PER_BEAT) * (60 / bpm)
}

function midiToHz(tone) {
  return 440 * 2 ** ((tone - 69) / 12)
}

function centsBetween(actualHz, expectedHz) {
  return 1200 * Math.log2(actualHz / expectedHz)
}

function sliceByTime(samples, sampleRate, startSeconds, endSeconds) {
  const start = clampInt(Math.floor(Math.max(0, startSeconds) * sampleRate), 0, samples.length)
  const end = clampInt(Math.ceil(Math.max(startSeconds, endSeconds) * sampleRate), start, samples.length)
  return samples.subarray(start, end)
}

function sliceFraction(samples, startFraction, endFraction) {
  const start = clampInt(Math.floor(samples.length * startFraction), 0, samples.length)
  const end = clampInt(Math.ceil(samples.length * endFraction), start, samples.length)
  return samples.subarray(start, end)
}

function movingRms(samples, sampleRate, frameSeconds, hopSeconds) {
  const frame = Math.max(16, Math.floor(frameSeconds * sampleRate))
  const hop = Math.max(1, Math.floor(hopSeconds * sampleRate))
  const values = []
  for (let start = 0; start + frame <= samples.length; start += hop) {
    values.push(rms(samples.subarray(start, start + frame)))
  }
  if (values.length === 0 && samples.length > 0) {
    values.push(rms(samples))
  }
  return values
}

function movingDiffRms(samples, sampleRate, frameSeconds, hopSeconds) {
  const frame = Math.max(16, Math.floor(frameSeconds * sampleRate))
  const hop = Math.max(1, Math.floor(hopSeconds * sampleRate))
  const values = []
  for (let start = 1; start + frame <= samples.length; start += hop) {
    let sum = 0
    for (let index = start; index < start + frame; index += 1) {
      const diff = samples[index] - samples[index - 1]
      sum += diff * diff
    }
    values.push(Math.sqrt(sum / frame))
  }
  return values
}

function rms(samples) {
  if (samples.length === 0) {
    return 0
  }
  let sum = 0
  for (const sample of samples) {
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

function maxAbsStep(samples) {
  let value = 0
  for (let index = 1; index < samples.length; index += 1) {
    value = Math.max(value, Math.abs(samples[index] - samples[index - 1]))
  }
  return value
}

function countSampleSteps(samples, threshold) {
  let count = 0
  let previousHit = -Infinity
  const guard = 64
  for (let index = 1; index < samples.length; index += 1) {
    if (Math.abs(samples[index] - samples[index - 1]) > threshold && index - previousHit > guard) {
      count += 1
      previousHit = index
    }
  }
  return count
}

function decomposeHangul(text) {
  const char = [...text.trim()][0]
  if (!char) {
    return null
  }
  const code = char.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) {
    return null
  }
  const index = code - 0xac00
  const onset = Math.floor(index / 588)
  const vowel = Math.floor((index % 588) / 28)
  const coda = index % 28
  return {
    onset: ONSETS[onset] ?? null,
    vowel: VOWELS[vowel] ?? null,
    coda: CODAS[coda] || null,
  }
}

const ONSETS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const VOWELS = [
  'ㅏ',
  'ㅐ',
  'ㅑ',
  'ㅒ',
  'ㅓ',
  'ㅔ',
  'ㅕ',
  'ㅖ',
  'ㅗ',
  'ㅘ',
  'ㅙ',
  'ㅚ',
  'ㅛ',
  'ㅜ',
  'ㅝ',
  'ㅞ',
  'ㅟ',
  'ㅠ',
  'ㅡ',
  'ㅢ',
  'ㅣ',
]
const CODAS = [
  '',
  'ㄱ',
  'ㄲ',
  'ㄳ',
  'ㄴ',
  'ㄵ',
  'ㄶ',
  'ㄷ',
  'ㄹ',
  'ㄺ',
  'ㄻ',
  'ㄼ',
  'ㄽ',
  'ㄾ',
  'ㄿ',
  'ㅀ',
  'ㅁ',
  'ㅂ',
  'ㅄ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
]

function readAscii(view, offset, length) {
  let text = ''
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index))
  }
  return text
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function median(values) {
  return percentile(values, 0.5)
}

function percentile(values, quantile) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (finite.length === 0) {
    return 0
  }
  const index = Math.min(finite.length - 1, Math.max(0, (finite.length - 1) * quantile))
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) {
    return finite[lower]
  }
  return finite[lower] + (finite[upper] - finite[lower]) * (index - lower)
}

function min(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? Math.min(...finite) : 0
}

function max(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? Math.max(...finite) : 0
}

function clampInt(value, minValue, maxValue) {
  if (maxValue < minValue) {
    return minValue
  }
  return Math.min(maxValue, Math.max(minValue, Math.round(value)))
}

function formatNumber(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
}

function parseArgs(argv) {
  const options = {
    outDir: DEFAULT_OUT_DIR,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') {
      options.url = argv[++index]
    } else if (arg === '--out-dir') {
      options.outDir = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--port') {
      options.port = Number(argv[++index])
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/audit-utau-long-sustain.mjs [options]',
          '',
          'Options:',
          '  --url url        Use an already-running WebUtau URL instead of starting Vite.',
          '  --out-dir path   Output directory for WAV, project, and report.',
          '  --report path    JSON report path.',
          '  --port n         Port for the temporary Vite server.',
          '  --headed         Run Chromium with a visible window.',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  auditUtauLongSustain(parseArgs(process.argv.slice(2)))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) {
        process.exit(1)
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error))
      process.exit(1)
    })
}
