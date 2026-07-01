#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_TIMEOUT_MS = 45_000
export const DEFAULT_REPORT = 'experiments/utau-v3/work/starter-sample-gallery-render-audit.json'

export const STARTER_SAMPLES = [
  {
    id: 'neon-lift',
    title: 'Neon Lift',
    mood: 'Cyber Pop',
    projectName: 'First Vocal Sketch',
    lyricLine: '네 오 빛 이 메 로 디 로 데 려 가',
    chordLine: 'Am -> F -> C -> G',
    noteCount: 11,
  },
  {
    id: 'blue-hour',
    title: 'Blue Hour',
    mood: 'Dream Pop',
    projectName: 'Blue Hour Vocal',
    lyricLine: '밤 이 와 너 와 나 노 래 해',
    chordLine: 'F -> C -> G -> Am',
    noteCount: 9,
  },
  {
    id: 'retro-run',
    title: 'Retro Run',
    mood: 'Retro Game',
    projectName: 'Retro Run Vocal',
    lyricLine: '레 트 로 비 트 로 뛰 어 가',
    chordLine: 'Dm -> Bb -> F -> C',
    noteCount: 9,
  },
  {
    id: 'moon-signal',
    title: 'Moon Signal',
    mood: 'Dark Synth',
    projectName: 'Moon Signal Vocal',
    lyricLine: '달 빛 속 에 숨 은 말 을 켜',
    chordLine: 'Em -> C -> G -> D',
    noteCount: 9,
  },
  {
    id: 'pink-noise',
    title: 'Pink Noise',
    mood: 'Hyperpop',
    projectName: 'Pink Noise Vocal',
    lyricLine: '핑 크 노 이 즈 가 심 장 을 깨 워',
    chordLine: 'Bm -> G -> D -> A',
    noteCount: 11,
  },
  {
    id: 'rain-verse',
    title: 'Rain Verse',
    mood: 'Emo Ballad',
    projectName: 'Rain Verse Vocal',
    lyricLine: '비 가 내 린 밤 너 를 부 르 네',
    chordLine: 'C -> G -> Am -> F',
    noteCount: 10,
  },
  {
    id: 'city-glide',
    title: 'City Glide',
    mood: 'City Pop',
    projectName: 'City Glide Vocal',
    lyricLine: '도 시 불 빛 위 로 우 린 날 아',
    chordLine: 'F -> E -> Am -> C',
    noteCount: 10,
  },
]

const DEFAULT_THRESHOLDS = {
  minSampleCount: 7,
  minDurationSeconds: 2.6,
  maxDurationSeconds: 12,
  minBytes: 220_000,
  minPeak: 0.02,
  minRms: 0.0015,
}

export async function auditStarterSampleGallery(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const tempRoot = mkdtempSync(join(tmpdir(), 'webuta-starter-samples-'))
  let server = null
  let browser = null
  try {
    const url = options.url ?? (await startViteServer({ cwd, host: options.host ?? DEFAULT_HOST, port: options.port }))
    server = typeof url === 'string' ? null : url.server
    const baseUrl = typeof url === 'string' ? url : url.url
    browser = await chromium.launch({ headless: !options.headed })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 860 },
    })
    const page = await context.newPage()
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS })
    await page.getByLabel('Current project').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.getByText('WebUtau Korean V3 Synthetic').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })

    const renderedSamples = []
    for (const sample of STARTER_SAMPLES) {
      const rendered = await renderStarterSample(page, tempRoot, sample)
      renderedSamples.push(rendered)
    }

    const report = summarizeStarterSampleRenders({
      url: baseUrl,
      renderedSamples,
      thresholds: options.thresholds,
    })
    if (options.report) {
      writeJson(resolve(options.report), report)
    }
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

async function renderStarterSample(page, tempRoot, sample) {
  const gallery = page.getByLabel('Starter sample gallery')
  await gallery.getByRole('button', { name: `${sample.title} 샘플 열기` }).click()
  await page.waitForFunction(
    (projectName) => {
      const input = document.querySelector('[aria-label="Project name"]')
      return input && 'value' in input && String(input.value) === projectName
    },
    sample.projectName,
    { timeout: DEFAULT_TIMEOUT_MS },
  )
  await gallery.getByRole('button', { name: `${sample.title} 샘플 열기` }).evaluate((button) => {
    if (button.getAttribute('aria-pressed') !== 'true') {
      throw new Error('starter sample button did not become active')
    }
  })
  await page.getByText(`${sample.noteCount}/${sample.noteCount} matched`).first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText('렌더 경고 없음').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Starter hook chord guide').getByText(sample.chordLine).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.waitForFunction(
    (lyricLine) => {
      const input = document.querySelector('[aria-label="빠른 가사 입력"]')
      return input && 'value' in input && String(input.value).trim() === lyricLine
    },
    sample.lyricLine,
    { timeout: DEFAULT_TIMEOUT_MS },
  )

  const downloadPromise = page.waitForEvent('download', { timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '하단 WAV 다운로드' }).click()
  const download = await downloadPromise
  const savedDownload = join(tempRoot, `${sample.id}-${download.suggestedFilename()}`)
  await download.saveAs(savedDownload)
  const wav = inspectPcmWav(savedDownload)
  await page.getByText('WAV downloaded', { exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })

  return {
    ...sample,
    fileName: download.suggestedFilename(),
    wav,
  }
}

export function summarizeStarterSampleRenders(input = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) }
  const renderedSamples = Array.isArray(input.renderedSamples) ? input.renderedSamples : []
  const sampleProblems = renderedSamples.map((sample) => ({
    id: sample.id,
    title: sample.title,
    problems: problemsForRenderedSample(sample, thresholds),
  }))
  const missingSamples = STARTER_SAMPLES.filter(
    (sample) => !renderedSamples.some((rendered) => rendered.id === sample.id),
  )
  const problems = [
    ...(renderedSamples.length >= thresholds.minSampleCount
      ? []
      : [`rendered sample count ${renderedSamples.length}; expected at least ${thresholds.minSampleCount}`]),
    ...missingSamples.map((sample) => `missing rendered starter sample: ${sample.title}`),
    ...sampleProblems.flatMap((sample) => sample.problems.map((problem) => `${sample.title}: ${problem}`)),
  ]

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'starter-sample-gallery-render-pass' : 'starter-sample-gallery-render-fail',
    url: input.url ?? null,
    thresholds,
    sampleCount: renderedSamples.length,
    diversity: {
      moodCount: new Set(renderedSamples.map((sample) => sample.mood)).size,
      lyricLineCount: new Set(renderedSamples.map((sample) => sample.lyricLine)).size,
      chordLineCount: new Set(renderedSamples.map((sample) => sample.chordLine)).size,
    },
    samples: renderedSamples.map((sample) => ({
      id: sample.id,
      title: sample.title,
      mood: sample.mood,
      projectName: sample.projectName,
      lyricLine: sample.lyricLine,
      chordLine: sample.chordLine,
      noteCount: sample.noteCount,
      fileName: sample.fileName ?? null,
      wav: sample.wav ?? null,
      passed: sampleProblems.find((item) => item.id === sample.id)?.problems.length === 0,
    })),
    problems,
  }
}

function problemsForRenderedSample(sample, thresholds) {
  const wav = sample.wav ?? {}
  return [
    ...(String(sample.fileName ?? '').endsWith('.wav') ? [] : [`download fileName ${sample.fileName ?? 'missing'} is not a WAV`]),
    ...(wav.sampleRate === 44100 ? [] : [`WAV sampleRate ${wav.sampleRate ?? 'missing'}; expected 44100`]),
    ...(wav.channels === 1 ? [] : [`WAV channels ${wav.channels ?? 'missing'}; expected mono`]),
    ...(wav.bitsPerSample === 16 ? [] : [`WAV bitsPerSample ${wav.bitsPerSample ?? 'missing'}; expected 16`]),
    ...(wav.durationSeconds >= thresholds.minDurationSeconds && wav.durationSeconds <= thresholds.maxDurationSeconds
      ? []
      : [
          `WAV duration ${Number(wav.durationSeconds ?? 0).toFixed(3)}s outside ${thresholds.minDurationSeconds}..${thresholds.maxDurationSeconds}s`,
        ]),
    ...(wav.bytes >= thresholds.minBytes ? [] : [`WAV bytes ${wav.bytes ?? 0}; expected at least ${thresholds.minBytes}`]),
    ...(wav.peak >= thresholds.minPeak ? [] : [`WAV peak ${Number(wav.peak ?? 0).toFixed(4)} below ${thresholds.minPeak}`]),
    ...(wav.rms >= thresholds.minRms ? [] : [`WAV rms ${Number(wav.rms ?? 0).toFixed(5)} below ${thresholds.minRms}`]),
  ]
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
      VITE_WEBUTA_NEURAL_ENDPOINT: '',
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

function inspectPcmWav(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Downloaded file is not a RIFF/WAVE file: ${path}`)
  }
  let offset = 12
  let fmt = null
  let dataOffset = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    } else if (chunkId === 'data') {
      dataOffset = chunkStart
      dataBytes = chunkSize
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  if (!fmt || dataOffset <= 0 || dataBytes <= 0) {
    throw new Error(`Downloaded WAV is missing fmt or data chunks: ${path}`)
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`Downloaded WAV is not PCM16: ${path}`)
  }
  let peak = 0
  let sumSquares = 0
  const frameCount = Math.floor(dataBytes / 2)
  for (let index = 0; index < frameCount; index += 1) {
    const sample = buffer.readInt16LE(dataOffset + index * 2) / 32768
    const abs = Math.abs(sample)
    peak = Math.max(peak, abs)
    sumSquares += sample * sample
  }
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    durationSeconds: dataBytes / (fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8)),
    bytes: buffer.length,
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, frameCount)),
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function onceExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return
  }
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(timeoutMs).then(() => {
      child.kill('SIGKILL')
    }),
  ])
}

function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') {
      options.url = argv[++index]
    } else if (arg === '--report' || arg === '--out') {
      options.report = argv[++index]
    } else if (arg === '--port') {
      options.port = Number(argv[++index])
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/audit-starter-sample-gallery.mjs [options]',
          '',
          'Options:',
          '  --url url       Use an already-running WebUtau URL instead of starting Vite',
          '  --report path   JSON report path',
          '  --port n        Port for the temporary Vite server',
          '  --headed        Run Chromium with a visible window',
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
  auditStarterSampleGallery(parseArgs(process.argv.slice(2)))
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
