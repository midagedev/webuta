#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const DEFAULT_OUT = 'experiments/utau-v3/work/v3-listening-review'
export const DEFAULT_LEGACY_V2_VOICEBANK = 'public/voicebanks/webuta-ko-lite.zip'

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

export const LISTENING_SCORE_FIELDS = [
  {
    key: 'koreanClarityScore',
    label: 'Korean clarity',
    prompt: 'Can a Korean listener recognize the intended lyric without reading along?',
  },
  {
    key: 'vowelStabilityScore',
    label: 'Vowel stability',
    prompt: 'Do sustained vowels hold pitch and color without wobble or collapse?',
  },
  {
    key: 'consonantClarityScore',
    label: 'Consonant clarity',
    prompt: 'Are attacks and final consonants clear without chopped starts or repeated codas?',
  },
  {
    key: 'musicalityScore',
    label: 'Musicality',
    prompt: 'Does the phrase feel usable as a musical vocal sketch rather than a test beep?',
  },
  {
    key: 'artifactScore',
    label: 'Artifact control',
    prompt: 'Are clicks, chatter, clipping, and loop seams controlled enough for sharing?',
  },
]

const LISTENING_SCORE_SCALE = '1=unusable, 3=prototype, 5=community-release-ready'

const LISTENING_THRESHOLDS = {
  minKoreanClarityScore: 4,
  minVowelStabilityScore: 4,
  minConsonantClarityScore: 4,
  minMusicalityScore: 4,
  minArtifactScore: 4,
  minV3PreferenceScore: 4,
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
          note('n1', 0, 420, 64, '도'),
          note('n2', 480, 360, 67, '히'),
          note('n3', 960, 420, 64, '도'),
          note('n4', 1440, 600, 69, '히'),
          note('n5', 2160, 420, 67, '다'),
          note('n6', 2640, 360, 69, '이'),
          note('n7', 3120, 420, 65, '스'),
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
  const legacyV2Path = resolve(options.legacyV2 ?? DEFAULT_LEGACY_V2_VOICEBANK)
  const compareLegacyV2 = options.compareLegacyV2 !== false && existsSync(legacyV2Path)
  const legacyAudioDir = join(audioDir, 'legacy-v2')
  const projects = fixedListeningReviewProjects()
  mkdirSync(audioDir, { recursive: true })
  if (compareLegacyV2) {
    mkdirSync(legacyAudioDir, { recursive: true })
  }

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

    const comparisons = compareLegacyV2
      ? await renderLegacyV2Comparisons({
          page,
          legacyV2Path,
          legacyAudioDir,
          outDir,
          projects,
        })
      : []

    const problems = [
      ...phrases.flatMap((phrase) => phrase.gates.problems.map((problem) => `${phrase.id}: ${problem}`)),
      ...comparisons.flatMap((comparison) =>
        comparison.gates.problems.map((problem) => `${comparison.id} legacy-v2: ${problem}`),
      ),
    ]
    const listeningTemplatePath = join(outDir, 'listening-scores.local.template.json')
    const indexHtmlPath = join(outDir, 'index.html')
    const readmePath = join(outDir, 'README.md')
    const manifestPath = join(outDir, 'review-manifest.json')
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
      comparisonCount: comparisons.length,
      thresholds: REVIEW_THRESHOLDS,
      phrases,
      comparisons,
      problems,
      nextSteps: [
        `Open ${indexHtmlPath}`,
        `Use the HTML scorecard to download ${join(outDir, 'listening-scores.local.json')}`,
        'Tune generator consonant/noise/formant profiles if any phrase or V2 comparison scores below 4/5.',
      ],
    }

    const listeningTemplate = makeListeningTemplate(phrases, comparisons)
    writeJson(listeningTemplatePath, listeningTemplate)
    writeFileSync(indexHtmlPath, renderHtml({ phrases, comparisons, listeningTemplatePath }))
    writeFileSync(readmePath, renderReadme({ indexHtmlPath, listeningTemplatePath, phrases, comparisons }))
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

export function makeListeningTemplate(phrases, comparisons = []) {
  const phrasesById = new Map(phrases.map((phrase) => [phrase.id, phrase]))
  return {
    version: 1,
    reviewId: 'webuta-ko-v3-synthetic-listening-review',
    reviewer: '',
    reviewedAt: '',
    decision: '',
    scoreScale: LISTENING_SCORE_SCALE,
    instructions: [
      'Listen to the generated WAV phrases on headphones or neutral speakers.',
      'Do not record new voice material for this review; score only the bundled synthetic V3 renders.',
      'When legacy V2 comparison WAVs are present, score whether V3 is clearly more usable than V2.',
      'Use release-ready/pass/community-ready only if every phrase score meets the configured thresholds.',
    ],
    reviewEnvironment: {
      playback: '',
      reviewerNotes: '',
      noRecordingRequired: true,
    },
    rubric: LISTENING_SCORE_FIELDS,
    thresholds: LISTENING_THRESHOLDS,
    phraseScores: phrases.map((phrase) => ({
      id: phrase.id,
      title: phrase.title,
      wavPath: phrase.wavPath,
      ...Object.fromEntries(LISTENING_SCORE_FIELDS.map((field) => [field.key, null])),
      notes: '',
    })),
    comparisonScores: comparisons.map((comparison) => ({
      id: comparison.id,
      title: comparison.title,
      v3WavPath: phrasesById.get(comparison.id)?.wavPath ?? '',
      legacyV2WavPath: comparison.wavPath,
      v3PreferenceScore: null,
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

async function renderLegacyV2Comparisons({ page, legacyV2Path, legacyAudioDir, outDir, projects }) {
  await uploadVoicebankFile(page, legacyV2Path, 'WebUtau Korean V2')
  const comparisons = []
  for (const [index, item] of projects.entries()) {
    await importProject(page, item.project, `${item.id}-legacy-v2.webutau.json`)
    await waitForVoicebankCoverage(page)
    const status = await readVoicebankStatus(page)
    const fileName = `${String(index + 1).padStart(2, '0')}-${item.id}-legacy-v2.wav`
    const wavPath = join(legacyAudioDir, fileName)
    const wav = await renderAndSaveWav(page, wavPath)
    comparisons.push({
      id: item.id,
      title: item.title,
      description: `Legacy V2 baseline for ${item.title}.`,
      voicebankName: 'WebUtau Korean V2 Legacy',
      lyricLine: item.project.notes.map((itemNote) => itemNote.lyric).join(' '),
      wavPath,
      audioHref: toPosix(relative(outDir, wavPath)),
      wav,
      gates: evaluateWav(wav),
      coverageText: status.coverageText,
      warningText: status.warningText,
    })
  }
  return comparisons
}

async function uploadVoicebankFile(page, filePath, expectedText) {
  await page.locator('input[accept=".zip"]').first().setInputFiles(filePath)
  if (expectedText) {
    await page.getByText(expectedText).first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  }
}

async function waitForVoicebankCoverage(page) {
  await page.getByText(/matched/u).first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
}

async function readVoicebankStatus(page) {
  const status = await page.evaluate(() => ({
    coverageText: document.querySelector('.coverage-card')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
    warningText: document.querySelector('.render-warning-card')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
  }))
  return {
    coverageText: normalizeReviewStatusText(status.coverageText),
    warningText: normalizeReviewStatusText(status.warningText),
  }
}

export function normalizeReviewStatusText(text) {
  return String(text ?? '')
    .replace(/\s*(현재 세션 전용|이 기기에 저장 중|이 기기 저장됨)\s*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
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

export function renderHtml({ phrases, comparisons = [], listeningTemplatePath }) {
  const template = makeListeningTemplate(phrases, comparisons)
  const comparisonsById = new Map(comparisons.map((comparison, comparisonIndex) => [comparison.id, { ...comparison, comparisonIndex }]))
  const phrasePayload = phrases.map((phrase) => ({
    id: phrase.id,
    title: phrase.title,
    description: phrase.description,
    lyricLine: phrase.lyricLine,
    wavPath: phrase.wavPath,
    audioHref: phrase.audioHref,
    gates: phrase.gates,
  }))
  const comparisonPayload = comparisons.map((comparison) => ({
    id: comparison.id,
    title: comparison.title,
    voicebankName: comparison.voicebankName,
    wavPath: comparison.wavPath,
    audioHref: comparison.audioHref,
    coverageText: comparison.coverageText,
    warningText: comparison.warningText,
    gates: comparison.gates,
  }))
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WebUtau Korean V3 Listening Review</title>
  <style>
    :root { color-scheme: dark; --bg: #11131a; --panel: #191d27; --line: #303848; --text: #f4f7fb; --muted: #b8c2d1; --ok: #9cff8a; --warn: #ffd166; --accent: #83f7ff; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(1100px, calc(100vw - 28px)); margin: 0 auto; padding: 28px 0 48px; }
    h1 { margin: 0 0 8px; font-size: 44px; letter-spacing: 0; }
    h2, h3 { letter-spacing: 0; }
    p { color: var(--muted); line-height: 1.55; }
    code { color: #9cff8a; word-break: break-all; }
    form { display: grid; gap: 16px; }
    .notice, .listening-route, article, fieldset, .output { border: 1px solid #2d3544; border-radius: 8px; background: var(--panel); }
    .notice { padding: 14px 16px; }
    .notice strong { color: var(--accent); }
    .listening-route { display: grid; gap: 14px; margin: 16px 0; padding: 16px; border-color: #355567; }
    .route-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
    .route-head h2 { margin: 0; font-size: 21px; }
    .route-pill { display: inline-flex; min-height: 30px; align-items: center; border: 1px solid #37596a; border-radius: 999px; padding: 0 10px; color: var(--accent); background: #10131b; font-size: 12px; font-weight: 900; }
    .route-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .route-step { display: grid; gap: 8px; align-content: start; min-height: 142px; padding: 12px; border: 1px solid var(--line); border-radius: 7px; background: #10131b; }
    .route-step span { width: 30px; min-height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; color: #071113; background: var(--accent); font-size: 12px; font-weight: 950; }
    .route-step strong, .route-step em { display: block; min-width: 0; }
    .route-step strong { color: var(--text); font-size: 15px; line-height: 1.15; }
    .route-step em { color: var(--muted); font-size: 12px; font-style: normal; line-height: 1.38; }
    .review-reference { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .review-reference div { min-width: 0; padding: 10px; border: 1px solid #31384a; border-radius: 7px; background: #111722; }
    .review-reference span, .review-reference strong { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .review-reference span { color: var(--accent); font-size: 11px; font-weight: 900; }
    .review-reference strong { margin-top: 4px; color: var(--text); font-size: 13px; }
    .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 13px; }
    input, select, textarea, button { width: 100%; border: 1px solid var(--line); border-radius: 6px; background: #10131b; color: var(--text); font: inherit; }
    input, select, textarea { padding: 10px 11px; }
    textarea { min-height: 82px; resize: vertical; }
    button { width: auto; padding: 10px 14px; cursor: pointer; font-weight: 800; }
    button:disabled { cursor: not-allowed; opacity: 0.52; }
    article { display: grid; gap: 12px; margin: 16px 0; padding: 16px; }
    audio { width: 100%; }
    fieldset { margin: 0; padding: 12px; }
    legend { padding: 0 6px; color: var(--accent); font-weight: 800; }
    .scores { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .comparison-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .comparison-grid > div { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #10131b; }
    .comparison-grid h3 { margin: 0 0 8px; font-size: 15px; }
    .comparison-note { margin: 6px 0 0; font-size: 12px; }
    .score-help { min-height: 44px; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .output { display: grid; gap: 10px; padding: 16px; }
    .draft-note, .progress-note { margin: -4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .progress-note.ok { color: var(--ok); font-weight: 800; }
    .progress-note.warn { color: var(--warn); font-weight: 800; }
    .status { font-weight: 800; }
    .status.ok { color: var(--ok); }
    .status.warn { color: var(--warn); }
    .problem-list { display: grid; gap: 4px; margin: 0; padding-left: 20px; color: var(--warn); font-size: 12px; line-height: 1.4; }
    .problem-list.ok { color: var(--ok); list-style: none; padding-left: 0; font-weight: 800; }
    #scoreJson { min-height: 320px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 14px; }
    th, td { padding: 9px; border-bottom: 1px solid #303848; text-align: left; }
    .ok { color: var(--ok); font-weight: 800; }
    @media (max-width: 760px) {
      h1 { font-size: 30px; }
      .meta, .scores, .comparison-grid, .route-grid, .review-reference { grid-template-columns: 1fr; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <h1>WebUtau Korean V3 Listening Review</h1>
    <p>Listen to the generated V3 WAVs and generate <code>listening-scores.local.json</code> for the release audit.</p>
    <div class="notice">
      <strong>No recording step:</strong> this review does not ask anyone to record a voice. It only scores WAVs generated from the bundled synthetic UTAU V3 voicebank.
    </div>
    <p>Template path: <code>${escapeHtml(listeningTemplatePath)}</code>. A phrase should score 4/5 or higher before community release.</p>
    <p>After downloading this JSON, download <code>handoff-report.local.json</code> from the DAW handoff page too, keep both files in Downloads, then accept both with <code>npm run release:accept-evidence</code>. Use explicit <code>--scores</code> and <code>--handoff</code> paths only when the files are somewhere else.</p>
    <section class="listening-route" aria-label="10-minute listening review path">
      <div class="route-head">
        <h2>10-minute listening review path</h2>
        <span class="route-pill">manual evidence only after real listening</span>
      </div>
      <div class="route-grid">
        <div class="route-step">
          <span>01</span>
          <strong>Set reviewer info</strong>
          <em>Fill reviewer, playback device, and choose a passing decision only after every required score is honest.</em>
        </div>
        <div class="route-step">
          <span>02</span>
          <strong>Listen phrase by phrase</strong>
          <em>Use headphones or neutral speakers, then score Korean clarity, vowel stability, consonants, musicality, and artifacts.</em>
        </div>
        <div class="route-step">
          <span>03</span>
          <strong>Compare V3 against V2</strong>
          <em>For each phrase, score whether current V3 is clearly better than the legacy V2 baseline.</em>
        </div>
        <div class="route-step">
          <span>04</span>
          <strong>Download the JSON</strong>
          <em>Only download listening-scores.local.json after the status says the release scorecard passes.</em>
        </div>
      </div>
      <div class="review-reference" aria-label="Listening review reference">
        <div>
          <span>phrases</span>
          <strong>${phrases.length} V3 renders</strong>
        </div>
        <div>
          <span>comparison</span>
          <strong>${comparisons.length} legacy V2 WAVs</strong>
        </div>
        <div>
          <span>threshold</span>
          <strong>4/5 or higher</strong>
        </div>
        <div>
          <span>output</span>
          <strong>listening-scores.local.json</strong>
        </div>
      </div>
    </section>
    <form id="scorecardForm">
      <section class="meta" aria-label="Review metadata">
        <label>Reviewer
          <input id="reviewer" autocomplete="name" placeholder="name or handle" required>
        </label>
        <label>Reviewed at
          <input id="reviewedAt" type="datetime-local" required>
        </label>
        <label>Decision
          <select id="decision" required>
            <option value="">Choose after scoring</option>
            <option value="community-ready">community-ready</option>
            <option value="release-ready">release-ready</option>
            <option value="pass">pass</option>
            <option value="needs-tuning">needs-tuning</option>
            <option value="fail">fail</option>
          </select>
        </label>
      </section>
      <label>Playback notes
        <input id="playback" placeholder="headphones, speakers, phone speaker, etc.">
      </label>
      ${phrases
        .map(
          (phrase, phraseIndex) => {
            const comparison = comparisonsById.get(phrase.id)
            return `<article data-phrase-id="${escapeHtml(phrase.id)}">
        <h2>${escapeHtml(phrase.title)}</h2>
        <p>${escapeHtml(phrase.description)}</p>
        <p><strong>Lyrics:</strong> ${escapeHtml(phrase.lyricLine)}</p>
        <audio controls src="${escapeHtml(phrase.audioHref)}"></audio>
        <p class="${phrase.gates.passed ? 'ok' : ''}">${phrase.gates.passed ? 'WAV gate passed' : escapeHtml(phrase.gates.problems.join('; '))}</p>
        ${
          comparison
            ? `<section aria-label="V3 versus legacy V2 comparison">
          <h3>V3 vs legacy V2</h3>
          <div class="comparison-grid">
            <div>
              <h3>Current V3 synthetic</h3>
              <audio controls src="${escapeHtml(phrase.audioHref)}"></audio>
              <p class="comparison-note">${phrase.gates.passed ? 'V3 WAV gate passed' : escapeHtml(phrase.gates.problems.join('; '))}</p>
            </div>
            <div>
              <h3>Legacy V2 baseline</h3>
              <audio controls src="${escapeHtml(comparison.audioHref)}"></audio>
              <p class="comparison-note">${comparison.gates.passed ? 'V2 WAV gate passed' : escapeHtml(comparison.gates.problems.join('; '))}</p>
              <p class="comparison-note">${escapeHtml(comparison.coverageText || comparison.warningText || 'Legacy V2 status captured.')}</p>
            </div>
          </div>
          <label>V3 preference over legacy V2
            <select data-comparison-index="${comparison.comparisonIndex}" data-comparison-score required>
              <option value="">-</option>
              <option value="1">1 - V2 is better</option>
              <option value="2">2 - V3 is worse or unclear</option>
              <option value="3">3 - roughly tied</option>
              <option value="4">4 - V3 is clearly better</option>
              <option value="5">5 - V3 is dramatically better</option>
            </select>
            <span class="score-help">Community release expects V3 to be clearly better than the old bundled V2 baseline.</span>
          </label>
          <label>Comparison notes
            <textarea data-comparison-index="${comparison.comparisonIndex}" data-comparison-notes placeholder="What improved or regressed compared with V2?"></textarea>
          </label>
        </section>`
            : ''
        }
        <fieldset>
          <legend>Scores</legend>
          <div class="scores">
            ${LISTENING_SCORE_FIELDS.map(
              (field) => `<label>${escapeHtml(field.label)}
                <select data-phrase-index="${phraseIndex}" data-score-key="${escapeHtml(field.key)}" required>
                  <option value="">-</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
                <span class="score-help">${escapeHtml(field.prompt)}</span>
              </label>`,
            ).join('\n')}
          </div>
        </fieldset>
        <label>Phrase notes
          <textarea data-phrase-index="${phraseIndex}" data-notes placeholder="What sounded clear or broken?"></textarea>
        </label>
      </article>`
          },
        )
        .join('\n')}
      <section class="output">
        <div class="actions">
          <button type="button" id="buildJson">Build listening-scores.local.json</button>
          <button type="button" id="downloadJson">Download JSON</button>
          <button type="button" id="clearDraft">Clear saved draft</button>
          <span id="status" class="status warn">Scores not complete.</span>
        </div>
        <p id="progressSummary" class="progress-note warn">Metadata 0/3 · Phrase scores 0/${phrases.length * LISTENING_SCORE_FIELDS.length} · V2/V3 comparisons 0/${comparisons.length}</p>
        <p id="draftStatus" class="draft-note">Draft autosave is active in this browser.</p>
        <ul id="problemList" class="problem-list"></ul>
        <textarea id="scoreJson" readonly spellcheck="false"></textarea>
      </section>
    </form>
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
  <script>
    const template = ${jsonForHtml(template)};
    const phrases = ${jsonForHtml(phrasePayload)};
    const comparisons = ${jsonForHtml(comparisonPayload)};
    const scoreFields = ${jsonForHtml(LISTENING_SCORE_FIELDS)};
    const draftStorageKey = 'webuta.v3ListeningReviewDraft.v1';
    const passingDecisions = new Set(['community-ready', 'release-ready', 'pass']);
    const reviewerInput = document.querySelector('#reviewer');
    const reviewedAtInput = document.querySelector('#reviewedAt');
    const decisionInput = document.querySelector('#decision');
    const playbackInput = document.querySelector('#playback');
    const output = document.querySelector('#scoreJson');
    const status = document.querySelector('#status');
    const progressSummary = document.querySelector('#progressSummary');
    const draftStatus = document.querySelector('#draftStatus');
    const downloadButton = document.querySelector('#downloadJson');
    const problemList = document.querySelector('#problemList');

    reviewedAtInput.value = toLocalDateTime(new Date());
    restoreDraft();
    document.querySelector('#buildJson').addEventListener('click', updateOutput);
    downloadButton.addEventListener('click', downloadJson);
    document.querySelector('#clearDraft').addEventListener('click', clearDraft);
    document.querySelector('#scorecardForm').addEventListener('input', () => {
      updateOutput();
      saveDraft();
    });
    updateOutput();

    function buildPayload() {
      const phraseScores = phrases.map((phrase, phraseIndex) => {
        const scores = Object.fromEntries(scoreFields.map((field) => {
          const select = document.querySelector(\`[data-phrase-index="\${phraseIndex}"][data-score-key="\${field.key}"]\`);
          const value = select?.value ? Number(select.value) : null;
          return [field.key, value];
        }));
        const notes = document.querySelector(\`[data-phrase-index="\${phraseIndex}"][data-notes]\`)?.value ?? '';
        return {
          id: phrase.id,
          title: phrase.title,
          wavPath: phrase.wavPath,
          ...scores,
          notes,
        };
      });
      const comparisonScores = comparisons.map((comparison, comparisonIndex) => {
        const select = document.querySelector(\`[data-comparison-index="\${comparisonIndex}"][data-comparison-score]\`);
        const notes = document.querySelector(\`[data-comparison-index="\${comparisonIndex}"][data-comparison-notes]\`)?.value ?? '';
        return {
          id: comparison.id,
          title: comparison.title,
          v3WavPath: phrases.find((phrase) => phrase.id === comparison.id)?.wavPath ?? '',
          legacyV2WavPath: comparison.wavPath,
          v3PreferenceScore: select?.value ? Number(select.value) : null,
          notes,
        };
      });
      return {
        ...template,
        reviewer: reviewerInput.value.trim(),
        reviewedAt: reviewedAtInput.value ? new Date(reviewedAtInput.value).toISOString() : '',
        decision: decisionInput.value,
        reviewEnvironment: {
          playback: playbackInput.value.trim(),
          reviewerNotes: '',
          noRecordingRequired: true,
        },
        phraseScores,
        comparisonScores,
      };
    }

    function validatePayload(payload) {
      const problems = [];
      if (!payload.reviewer) problems.push('Reviewer is required.');
      if (!payload.reviewedAt) problems.push('Reviewed-at time is required.');
      if (!payload.decision) problems.push('Decision is required.');
      if (payload.decision && !passingDecisions.has(payload.decision)) {
        problems.push('Decision will intentionally block release.');
      }
      for (const phrase of payload.phraseScores) {
        for (const field of scoreFields) {
          const score = phrase[field.key];
          const threshold = payload.thresholds[\`min\${field.key.charAt(0).toUpperCase()}\${field.key.slice(1)}\`] ?? 4;
          if (typeof score !== 'number') {
            problems.push(\`\${phrase.id}: \${field.label} is not scored.\`);
          } else if (score < threshold) {
            problems.push(\`\${phrase.id}: \${field.label} \${score} is below \${threshold}.\`);
          }
        }
      }
      for (const comparison of payload.comparisonScores ?? []) {
        const score = comparison.v3PreferenceScore;
        const threshold = payload.thresholds.minV3PreferenceScore ?? 4;
        if (typeof score !== 'number') {
          problems.push(\`\${comparison.id}: V3 preference over legacy V2 is not scored.\`);
        } else if (score < threshold) {
          problems.push(\`\${comparison.id}: V3 preference \${score} is below \${threshold}.\`);
        }
      }
      return problems;
    }

    function updateOutput() {
      const payload = buildPayload();
      const problems = validatePayload(payload);
      output.value = JSON.stringify(payload, null, 2);
      status.textContent = problems.length === 0 ? 'Release listening scorecard passes.' : problems.slice(0, 3).join(' ');
      if (problems.length > 3) status.textContent += \` +\${problems.length - 3} more.\`;
      status.className = \`status \${problems.length === 0 ? 'ok' : 'warn'}\`;
      progressSummary.textContent = summarizeProgress(payload);
      progressSummary.className = \`progress-note \${problems.length === 0 ? 'ok' : 'warn'}\`;
      downloadButton.disabled = problems.length > 0;
      downloadButton.title = problems.length === 0 ? 'Download release-audit-ready listening score JSON' : 'Finish every required score before downloading';
      problemList.className = \`problem-list \${problems.length === 0 ? 'ok' : ''}\`;
      problemList.innerHTML = problems.length === 0
        ? '<li>Ready: download this JSON, keep it beside the DAW handoff JSON in Downloads, then run npm run release:accept-evidence.</li>'
        : problems.slice(0, 8).map((problem) => \`<li>\${escapeText(problem)}</li>\`).join('');
    }

    function summarizeProgress(payload) {
      const metadataDone = [
        Boolean(payload.reviewer),
        Boolean(payload.reviewedAt),
        passingDecisions.has(payload.decision),
      ].filter(Boolean).length;
      const phraseTotal = payload.phraseScores.length * scoreFields.length;
      let phraseDone = 0;
      let phrasePassing = 0;
      for (const phrase of payload.phraseScores) {
        for (const field of scoreFields) {
          const score = phrase[field.key];
          const threshold = payload.thresholds[\`min\${field.key.charAt(0).toUpperCase()}\${field.key.slice(1)}\`] ?? 4;
          if (typeof score === 'number') {
            phraseDone += 1;
            if (score >= threshold) {
              phrasePassing += 1;
            }
          }
        }
      }
      let comparisonDone = 0;
      let comparisonPassing = 0;
      const comparisonTotal = payload.comparisonScores?.length ?? 0;
      for (const comparison of payload.comparisonScores ?? []) {
        const score = comparison.v3PreferenceScore;
        const threshold = payload.thresholds.minV3PreferenceScore ?? 4;
        if (typeof score === 'number') {
          comparisonDone += 1;
          if (score >= threshold) {
            comparisonPassing += 1;
          }
        }
      }
      return [
        \`Metadata \${metadataDone}/3\`,
        \`Phrase scores \${phraseDone}/\${phraseTotal} complete, \${phrasePassing}/\${phraseTotal} passing\`,
        \`V2/V3 comparisons \${comparisonDone}/\${comparisonTotal} complete, \${comparisonPassing}/\${comparisonTotal} passing\`,
      ].join(' · ');
    }

    function serializeDraft() {
      return {
        reviewer: reviewerInput.value,
        reviewedAt: reviewedAtInput.value,
        decision: decisionInput.value,
        playback: playbackInput.value,
        phraseScores: phrases.map((phrase, phraseIndex) => ({
          id: phrase.id,
          scores: Object.fromEntries(scoreFields.map((field) => {
            const select = document.querySelector(\`[data-phrase-index="\${phraseIndex}"][data-score-key="\${field.key}"]\`);
            return [field.key, select?.value ?? ''];
          })),
          notes: document.querySelector(\`[data-phrase-index="\${phraseIndex}"][data-notes]\`)?.value ?? '',
        })),
        comparisonScores: comparisons.map((comparison, comparisonIndex) => ({
          id: comparison.id,
          score: document.querySelector(\`[data-comparison-index="\${comparisonIndex}"][data-comparison-score]\`)?.value ?? '',
          notes: document.querySelector(\`[data-comparison-index="\${comparisonIndex}"][data-comparison-notes]\`)?.value ?? '',
        })),
      };
    }

    function saveDraft() {
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify(serializeDraft()));
        draftStatus.textContent = 'Draft saved in this browser.';
      } catch {
        draftStatus.textContent = 'Draft autosave is unavailable in this browser.';
      }
    }

    function restoreDraft() {
      let draft = null;
      try {
        const text = localStorage.getItem(draftStorageKey);
        draft = text ? JSON.parse(text) : null;
      } catch {
        draftStatus.textContent = 'Draft autosave is unavailable in this browser.';
        return;
      }
      if (!draft || typeof draft !== 'object') {
        return;
      }
      reviewerInput.value = typeof draft.reviewer === 'string' ? draft.reviewer : reviewerInput.value;
      reviewedAtInput.value = typeof draft.reviewedAt === 'string' && draft.reviewedAt ? draft.reviewedAt : reviewedAtInput.value;
      decisionInput.value = typeof draft.decision === 'string' ? draft.decision : decisionInput.value;
      playbackInput.value = typeof draft.playback === 'string' ? draft.playback : playbackInput.value;
      for (const [phraseIndex, phraseDraft] of (draft.phraseScores ?? []).entries()) {
        for (const field of scoreFields) {
          const select = document.querySelector(\`[data-phrase-index="\${phraseIndex}"][data-score-key="\${field.key}"]\`);
          const value = phraseDraft?.scores?.[field.key];
          if (select && typeof value === 'string') {
            select.value = value;
          }
        }
        const notes = document.querySelector(\`[data-phrase-index="\${phraseIndex}"][data-notes]\`);
        if (notes && typeof phraseDraft?.notes === 'string') {
          notes.value = phraseDraft.notes;
        }
      }
      for (const [comparisonIndex, comparisonDraft] of (draft.comparisonScores ?? []).entries()) {
        const select = document.querySelector(\`[data-comparison-index="\${comparisonIndex}"][data-comparison-score]\`);
        const notes = document.querySelector(\`[data-comparison-index="\${comparisonIndex}"][data-comparison-notes]\`);
        if (select && typeof comparisonDraft?.score === 'string') {
          select.value = comparisonDraft.score;
        }
        if (notes && typeof comparisonDraft?.notes === 'string') {
          notes.value = comparisonDraft.notes;
        }
      }
      draftStatus.textContent = 'Saved draft restored in this browser.';
    }

    function clearDraft() {
      try {
        localStorage.removeItem(draftStorageKey);
        draftStatus.textContent = 'Saved draft cleared.';
      } catch {
        draftStatus.textContent = 'Draft autosave is unavailable in this browser.';
      }
    }

    function downloadJson() {
      const payload = buildPayload();
      const problems = validatePayload(payload);
      updateOutput();
      saveDraft();
      if (problems.length > 0) {
        status.textContent = 'Download blocked until the scorecard passes.';
        status.className = 'status warn';
        progressSummary.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      const blob = new Blob([output.value + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'listening-scores.local.json';
      link.click();
      URL.revokeObjectURL(url);
    }

    function toLocalDateTime(date) {
      const offsetMs = date.getTimezoneOffset() * 60 * 1000;
      return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
    }

    function escapeText(text) {
      return String(text ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }
  </script>
</body>
</html>
`
}

function renderReadme({ indexHtmlPath, listeningTemplatePath, phrases, comparisons = [] }) {
  return [
    '# WebUtau Korean V3 Listening Review',
    '',
    'This folder contains browser-rendered WAVs from the bundled V3 UTAU sample renderer.',
    '',
    `Open: ${indexHtmlPath}`,
    `Score template: ${listeningTemplatePath}`,
    '',
    'Open the HTML scorecard, review each phrase on headphones or neutral speakers, and download `listening-scores.local.json` after the scorecard says it passes.',
    'The scorecard starts with a `10-minute listening review path`: set reviewer info, listen phrase by phrase, compare V3 against V2, then download the JSON only after real listening.',
    'The HTML scorecard autosaves an in-progress draft in the current browser and includes a clear-draft control.',
    'The scorecard shows metadata, phrase-score, V2/V3 comparison progress, and a problem list; JSON download stays disabled until every required score meets the release thresholds.',
    'After downloading this file, download `handoff-report.local.json` from the DAW handoff page too, keep both files in Downloads, then accept both with `npm run release:accept-evidence` before running the final release audit. Use explicit `--scores` and `--handoff` paths only when the files are somewhere else.',
    'No new voice recording is required or requested. Score only the generated synthetic V3 WAVs.',
    'Score 1-5 for Korean clarity, vowel stability, consonant clarity, musicality, and artifacts.',
    comparisons.length
      ? 'This pack also includes legacy V2 baseline WAVs. Score whether V3 is clearly better than V2 before release.'
      : 'Legacy V2 baseline WAVs were not generated for this pack.',
    '',
    '## Phrases',
    '',
    ...phrases.map((phrase) => `- ${phrase.id}: ${phrase.title} (${phrase.lyricLine})`),
    comparisons.length ? '' : null,
    comparisons.length ? '## Legacy V2 Comparisons' : null,
    ...comparisons.map((comparison) => `- ${comparison.id}: ${comparison.audioHref}`),
    '',
  ]
    .filter((line) => line !== null)
    .join('\n')
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

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/</gu, '\\u003c')
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
    } else if (arg === '--legacy-v2') {
      options.legacyV2 = argv[++index]
    } else if (arg === '--no-legacy-v2') {
      options.compareLegacyV2 = false
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
          '  --legacy-v2 path Legacy V2 voicebank zip for A/B comparison',
          '  --no-legacy-v2  Skip legacy V2 comparison audio',
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
