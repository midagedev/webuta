#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const DEFAULT_OUT = 'experiments/utau-v3/work/v3-listening-review'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_TIMEOUT_MS = 45_000
const TICKS_PER_BEAT = 480

const REVIEW_THRESHOLDS = {
  minDurationSeconds: 1.8,
  maxDurationSeconds: 12,
  minBytes: 180_000,
  sampleRate: 44100,
  channels: 1,
  bitsPerSample: 16,
}

export function fixedListeningReviewProjects() {
  return [
    {
      id: 'first-run-demo',
      title: 'First-run hook',
      description: 'Default melody and lyric shown to a new visitor.',
      project: makeProject({
        id: 'v3-review-first-run',
        name: 'V3 Review 01 First Run',
        bpm: 112,
        partDuration: TICKS_PER_BEAT * 10,
        notes: [
          note('n1', 0, 420, 60, '도'),
          note('n2', 480, 360, 62, '히'),
          note('n3', 960, 420, 64, '도'),
          note('n4', 1440, 600, 65, '히'),
          note('n5', 2160, 420, 67, '다'),
          note('n6', 2640, 360, 69, '이'),
          note('n7', 3120, 420, 67, '스'),
          note('n8', 3600, 1080, 64, '키'),
        ],
      }),
    },
    {
      id: 'coda-release-check',
      title: 'Batchim release check',
      description: 'Long notes with final consonants; codas should happen once at release, not chatter in the sustain.',
      project: makeProject({
        id: 'v3-review-coda',
        name: 'V3 Review 02 Batchim',
        bpm: 104,
        partDuration: TICKS_PER_BEAT * 8,
        notes: [
          note('n1', 0, 720, 60, '연'),
          note('n2', 840, 720, 62, '한'),
          note('n3', 1680, 720, 65, '랑'),
          note('n4', 2520, 720, 67, '밤'),
          note('n5', 3360, 960, 64, '말'),
        ],
      }),
    },
    {
      id: 'clear-cv-line',
      title: 'Clear CV line',
      description: 'Common onset+vowel syllables for consonant attack clarity and vowel stability.',
      project: makeProject({
        id: 'v3-review-cv',
        name: 'V3 Review 03 CV',
        bpm: 116,
        partDuration: TICKS_PER_BEAT * 8,
        notes: [
          note('n1', 0, 480, 60, '가'),
          note('n2', 480, 480, 62, '나'),
          note('n3', 960, 480, 64, '다'),
          note('n4', 1440, 480, 65, '라'),
          note('n5', 1920, 480, 67, '마'),
          note('n6', 2400, 960, 69, '사'),
        ],
      }),
    },
    {
      id: 'vowel-color-check',
      title: 'Vowel color check',
      description: 'Pure vowel-color syllables across a short contour.',
      project: makeProject({
        id: 'v3-review-vowels',
        name: 'V3 Review 04 Vowels',
        bpm: 108,
        partDuration: TICKS_PER_BEAT * 8,
        notes: [
          note('n1', 0, 600, 60, '아'),
          note('n2', 720, 600, 64, '이'),
          note('n3', 1440, 600, 67, '우'),
          note('n4', 2160, 600, 69, '에'),
          note('n5', 2880, 960, 65, '오'),
        ],
      }),
    },
  ]
}

export async function prepareUtauV3ListeningReview(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const outDir = resolve(options.out ?? DEFAULT_OUT)
  const audioDir = join(outDir, 'audio')
  const projects = fixedListeningReviewProjects()
  mkdirSync(audioDir, { recursive: true })

  const started = await startViteServer({ cwd, host: options.host ?? DEFAULT_HOST, port: options.port })
  let browser = null
  try {
    browser = await chromium.launch({ headless: !options.headed })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 860 },
    })
    const page = await context.newPage()
    await page.goto(started.url, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS })
    await page.getByLabel('Current project').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.getByText('WebUtau Korean V3 Synthetic').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })

    const phrases = []
    for (const [index, item] of projects.entries()) {
      if (index > 0) {
        await importProject(page, item.project, `${item.id}.webutau.json`)
      }
      await assertReviewProjectReady(page)
      const fileName = `${String(index + 1).padStart(2, '0')}-${item.id}.wav`
      const wavPath = join(audioDir, fileName)
      const wav = await renderAndSaveWav(page, wavPath)
      phrases.push({
        id: item.id,
        title: item.title,
        description: item.description,
        lyricLine: item.project.notes.map((itemNote) => itemNote.lyric).join(' '),
        projectName: item.project.name,
        wavPath,
        audioHref: toPosix(relative(outDir, wavPath)),
        wav,
        gates: evaluateWav(wav),
      })
    }

    const problems = phrases.flatMap((phrase) => phrase.gates.problems.map((problem) => `${phrase.id}: ${problem}`))
    const listeningTemplatePath = join(outDir, 'listening-scores.local.template.json')
    const indexHtmlPath = join(outDir, 'index.html')
    const readmePath = join(outDir, 'README.md')
    const manifestPath = join(outDir, 'review-manifest.json')
    const listeningTemplate = makeListeningTemplate(phrases)
    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ok: problems.length === 0,
      decision: problems.length === 0 ? 'v3-listening-review-ready' : 'v3-listening-review-needs-render-fix',
      outDir,
      audioDir,
      indexHtmlPath,
      readmePath,
      listeningTemplatePath,
      phraseCount: phrases.length,
      thresholds: REVIEW_THRESHOLDS,
      phrases,
      problems,
      nextSteps: [
        `Open ${indexHtmlPath}`,
        `Fill ${join(outDir, 'listening-scores.local.json')} from ${listeningTemplatePath}`,
        'Tune generator consonant/noise/formant profiles if any phrase scores below 4/5.',
      ],
    }

    writeJson(listeningTemplatePath, listeningTemplate)
    writeFileSync(indexHtmlPath, renderHtml({ phrases, listeningTemplatePath }))
    writeFileSync(readmePath, renderReadme({ indexHtmlPath, listeningTemplatePath, phrases }))
    writeJson(manifestPath, manifest)
    if (options.report) {
      writeJson(resolve(options.report), manifest)
    }
    return manifest
  } finally {
    if (browser) {
      await browser.close()
    }
    started.server.kill('SIGTERM')
    await onceExit(started.server, 1500)
  }
}

export function makeListeningTemplate(phrases) {
  return {
    version: 1,
    reviewId: 'webuta-ko-v3-synthetic-listening-review',
    reviewer: '',
    reviewedAt: '',
    decision: '',
    scoreScale: '1=unusable, 3=prototype, 5=community-release-ready',
    thresholds: {
      minKoreanClarityScore: 4,
      minVowelStabilityScore: 4,
      minConsonantClarityScore: 4,
      minMusicalityScore: 4,
      minArtifactScore: 4,
    },
    phraseScores: phrases.map((phrase) => ({
      id: phrase.id,
      title: phrase.title,
      wavPath: phrase.wavPath,
      koreanClarityScore: null,
      vowelStabilityScore: null,
      consonantClarityScore: null,
      musicalityScore: null,
      artifactScore: null,
      notes: '',
    })),
  }
}

export function evaluateWav(wav, thresholds = REVIEW_THRESHOLDS) {
  const problems = [
    ...(wav.sampleRate === thresholds.sampleRate ? [] : [`sampleRate ${wav.sampleRate}; expected ${thresholds.sampleRate}`]),
    ...(wav.channels === thresholds.channels ? [] : [`channels ${wav.channels}; expected ${thresholds.channels}`]),
    ...(wav.bitsPerSample === thresholds.bitsPerSample
      ? []
      : [`bitsPerSample ${wav.bitsPerSample}; expected ${thresholds.bitsPerSample}`]),
    ...(wav.durationSeconds >= thresholds.minDurationSeconds && wav.durationSeconds <= thresholds.maxDurationSeconds
      ? []
      : [
          `duration ${wav.durationSeconds.toFixed(3)}s outside ${thresholds.minDurationSeconds}..${thresholds.maxDurationSeconds}s`,
        ]),
    ...(wav.bytes >= thresholds.minBytes ? [] : [`bytes ${wav.bytes}; expected at least ${thresholds.minBytes}`]),
  ]
  return {
    passed: problems.length === 0,
    problems,
  }
}

async function importProject(page, project, fileName) {
  const input = page.locator('input[accept*=".webutau.json"]')
  await input.setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(`${JSON.stringify({
      format: 'webuta-project',
      version: 1,
      app: 'WebUtau',
      exportedAt: new Date().toISOString(),
      project,
    }, null, 2)}\n`),
  })
  await page.waitForFunction(
    (expectedName) => {
      const inputElement = document.querySelector('[aria-label="Project name"]')
      const value = inputElement && 'value' in inputElement ? String(inputElement.value) : ''
      return value === expectedName
    },
    project.name,
    { timeout: DEFAULT_TIMEOUT_MS },
  )
}

async function assertReviewProjectReady(page) {
  await page.getByText(/matched/u).first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText('렌더 경고 없음').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
}

async function renderAndSaveWav(page, wavPath) {
  const downloadPromise = page.waitForEvent('download', { timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '하단 WAV 다운로드' }).click()
  const download = await downloadPromise
  await download.saveAs(wavPath)
  return inspectPcmWav(wavPath)
}

function makeProject({ id, name, bpm, partDuration, notes }) {
  const trackId = 'track-main'
  const partId = 'part-main'
  return {
    id,
    name,
    comment: 'WebUtau Korean V3 listening review phrase.',
    bpm,
    beatPerBar: 4,
    beatUnit: 4,
    source: {
      fileName: `${id}.webutau.json`,
      format: 'webuta',
    },
    tracks: [
      {
        id: trackId,
        name: 'Main Vocal',
        color: 'Coral',
        singer: 'WebUtau Korean V3 Synthetic',
        phonemizer: 'hangul cv/vc synthetic',
      },
    ],
    parts: [
      {
        id: partId,
        trackId,
        name: 'Review Phrase',
        start: 0,
        duration: partDuration,
      },
    ],
    notes: notes.map((item) => ({ ...item, trackId, partId })),
  }
}

function note(id, start, duration, tone, lyric) {
  return { id, start, duration, tone, lyric }
}

function renderHtml({ phrases, listeningTemplatePath }) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WebUtau Korean V3 Listening Review</title>
  <style>
    body { margin: 0; background: #11131a; color: #f4f7fb; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(960px, calc(100vw - 28px)); margin: 0 auto; padding: 28px 0 48px; }
    h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 48px); }
    p { color: #b8c2d1; line-height: 1.55; }
    code { color: #9cff8a; word-break: break-all; }
    article { display: grid; gap: 10px; margin: 16px 0; padding: 16px; border: 1px solid #2d3544; border-radius: 8px; background: #191d27; }
    audio { width: 100%; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 14px; }
    th, td { padding: 9px; border-bottom: 1px solid #303848; text-align: left; }
    .ok { color: #9cff8a; font-weight: 800; }
  </style>
</head>
<body>
  <main>
    <h1>WebUtau Korean V3 Listening Review</h1>
    <p>Fill scores in <code>${escapeHtml(listeningTemplatePath)}</code>. A phrase should score 4/5 or higher before community release.</p>
    ${phrases
      .map(
        (phrase) => `<article>
      <h2>${escapeHtml(phrase.title)}</h2>
      <p>${escapeHtml(phrase.description)}</p>
      <p><strong>Lyrics:</strong> ${escapeHtml(phrase.lyricLine)}</p>
      <audio controls src="${escapeHtml(phrase.audioHref)}"></audio>
      <p class="${phrase.gates.passed ? 'ok' : ''}">${phrase.gates.passed ? 'WAV gate passed' : escapeHtml(phrase.gates.problems.join('; '))}</p>
    </article>`,
      )
      .join('\n')}
    <table>
      <thead><tr><th>Phrase</th><th>Focus</th><th>WAV</th></tr></thead>
      <tbody>
        ${phrases
          .map(
            (phrase) =>
              `<tr><td>${escapeHtml(phrase.title)}</td><td>${escapeHtml(phrase.description)}</td><td><code>${escapeHtml(phrase.audioHref)}</code></td></tr>`,
          )
          .join('\n')}
      </tbody>
    </table>
  </main>
</body>
</html>
`
}

function renderReadme({ indexHtmlPath, listeningTemplatePath, phrases }) {
  return [
    '# WebUtau Korean V3 Listening Review',
    '',
    'This folder contains browser-rendered WAVs from the bundled V3 UTAU sample renderer.',
    '',
    `Open: ${indexHtmlPath}`,
    `Score template: ${listeningTemplatePath}`,
    '',
    'Review each phrase on headphones or neutral speakers. Score 1-5 for Korean clarity, vowel stability, consonant clarity, musicality, and artifacts.',
    '',
    '## Phrases',
    '',
    ...phrases.map((phrase) => `- ${phrase.id}: ${phrase.title} (${phrase.lyricLine})`),
    '',
  ].join('\n')
}

async function startViteServer({ cwd, host, port }) {
  const selectedPort = port ? Number(port) : await findFreePort()
  const viteBin = resolve(cwd, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) {
    throw new Error(`Missing Vite binary: ${viteBin}`)
  }
  const child = spawn(process.execPath, [viteBin, '--host', host, '--port', String(selectedPort), '--strictPort'], {
    cwd,
    env: { ...process.env, BROWSER: 'none' },
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
      // Vite is still booting.
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
  const bytes = new Uint8Array(readFileSync(path))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 44 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') {
    throw new Error(`Not a RIFF/WAVE file: ${path}`)
  }
  let format = null
  let dataBytes = 0
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      format = {
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
        byteRate: view.getUint32(offset + 16, true),
      }
    }
    if (id === 'data') {
      dataBytes = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (!format || dataBytes <= 0) {
    throw new Error(`Missing WAV fmt/data chunks: ${path}`)
  }
  return {
    path,
    bytes: bytes.byteLength,
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
    durationSeconds: dataBytes / format.byteRate,
  }
}

function ascii(view, offset, length) {
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

function toPosix(path) {
  return path.split('\\').join('/')
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
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
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    }),
  ])
}

function parseArgs(argv) {
  const options = {
    out: DEFAULT_OUT,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--port') {
      options.port = Number(argv[++index])
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--clean') {
      rmSync(resolve(options.out), { recursive: true, force: true })
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/prepare-utau-v3-listening-review.mjs [options]',
          '',
          'Options:',
          '  --out path      Listening review output directory',
          '  --report path   Also write manifest JSON to this path',
          '  --port n        Port for the temporary Vite server',
          '  --headed        Run Chromium with a visible window',
          '  --clean         Remove output directory before rendering',
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
  prepareUtauV3ListeningReview(parseArgs(process.argv.slice(2)))
    .then((manifest) => {
      console.log(JSON.stringify(manifest, null, 2))
      if (!manifest.ok) {
        process.exit(1)
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error))
      process.exit(1)
    })
}
