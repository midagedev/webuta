#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_QUALITY_SUMMARY = 'experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000/quality-summary.json'
const DEFAULT_RELEASE_MANIFEST = 'experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/model-release.local-template.json'

export function prepareNeuralListeningReview(options = {}) {
  const qualitySummaryPath = resolve(options.qualitySummary ?? DEFAULT_QUALITY_SUMMARY)
  const releaseManifestPath = options.releaseManifest === false
    ? null
    : resolve(options.releaseManifest ?? DEFAULT_RELEASE_MANIFEST)
  const qualitySummary = readJson(qualitySummaryPath, 'quality summary')
  const releaseManifest = releaseManifestPath && existsSync(releaseManifestPath)
    ? readJson(releaseManifestPath, 'release manifest')
    : null
  const outDir = resolve(options.out ?? join(dirname(qualitySummaryPath), 'listening-review'))
  const audioDir = join(outDir, 'audio')
  const copyAudio = options.copyAudio !== false
  const warnings = []

  validateQualitySummary(qualitySummary)
  if (releaseManifestPath && !releaseManifest) {
    warnings.push(`Release manifest was not found: ${releaseManifestPath}`)
  }
  if (releaseManifest?.model?.id && qualitySummary.modelId && releaseManifest.model.id !== qualitySummary.modelId) {
    warnings.push(`Release manifest model id ${releaseManifest.model.id} does not match quality summary model id ${qualitySummary.modelId}.`)
  }

  mkdirSync(outDir, { recursive: true })
  if (copyAudio) {
    mkdirSync(audioDir, { recursive: true })
  }

  const phrases = qualitySummary.results.map((result, index) => preparePhrase({
    result,
    index,
    outDir,
    audioDir,
    copyAudio,
  }))
  const listeningTemplatePath = join(outDir, 'listening-scores.local.template.json')
  const intendedScoresPath = join(outDir, 'listening-scores.local.json')
  const reviewTemplate = makeListeningTemplate({
    qualitySummary,
    phrases,
  })
  const indexHtmlPath = join(outDir, 'index.html')
  const readmePath = join(outDir, 'README.md')
  const reviewManifestPath = join(outDir, 'review-manifest.json')

  writeJson(listeningTemplatePath, reviewTemplate)
  writeFileSync(indexHtmlPath, renderHtml({
    qualitySummary,
    releaseManifestPath,
    phrases,
    reviewTemplate,
    intendedScoresPath,
  }))
  writeFileSync(readmePath, renderReadme({
    qualitySummary,
    indexHtmlPath,
    listeningTemplatePath,
    intendedScoresPath,
    releaseManifestPath,
  }))

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    qualitySummaryPath,
    releaseManifestPath,
    outDir,
    runId: qualitySummary.runId,
    modelId: qualitySummary.modelId,
    phraseCount: phrases.length,
    audioDir: copyAudio ? audioDir : null,
    indexHtmlPath,
    readmePath,
    listeningTemplatePath,
    intendedScoresPath,
    phrases: phrases.map((phrase) => ({
      id: phrase.id,
      title: phrase.title,
      sourceWavPath: phrase.sourceWavPath,
      reviewWavPath: phrase.reviewWavPath,
      audioHref: phrase.audioHref,
    })),
    warnings,
    nextCommands: makeNextCommands({
      indexHtmlPath,
      releaseManifestPath,
      intendedScoresPath,
    }),
  }
  writeJson(reviewManifestPath, manifest)
  return manifest
}

function validateQualitySummary(summary) {
  if (!summary || summary.version !== 1) {
    throw new Error('Quality summary version must be 1.')
  }
  if (summary.rendered !== true) {
    throw new Error('Quality summary must come from a rendered run.')
  }
  if (typeof summary.runId !== 'string' || summary.runId.length === 0) {
    throw new Error('Quality summary must include runId.')
  }
  if (typeof summary.modelId !== 'string' || summary.modelId.length === 0) {
    throw new Error('Quality summary must include modelId.')
  }
  if (!Array.isArray(summary.results) || summary.results.length === 0) {
    throw new Error('Quality summary must contain rendered phrase results.')
  }
}

function preparePhrase({ result, index, outDir, audioDir, copyAudio }) {
  if (!result || result.ok !== true) {
    throw new Error(`Phrase result ${result?.id ?? index + 1} is not ok.`)
  }
  if (typeof result.id !== 'string' || result.id.length === 0) {
    throw new Error(`Phrase result ${index + 1} is missing id.`)
  }
  if (typeof result.wavPath !== 'string' || result.wavPath.length === 0) {
    throw new Error(`Phrase ${result.id} is missing wavPath.`)
  }
  const sourceWavPath = resolve(result.wavPath)
  if (!existsSync(sourceWavPath)) {
    throw new Error(`Missing phrase WAV for ${result.id}: ${sourceWavPath}`)
  }
  if (statSync(sourceWavPath).size <= 44) {
    throw new Error(`Phrase WAV is too small for ${result.id}: ${sourceWavPath}`)
  }

  const safeName = `${String(index + 1).padStart(2, '0')}-${slugify(result.id)}${extname(sourceWavPath) || '.wav'}`
  const reviewWavPath = copyAudio ? join(audioDir, safeName) : sourceWavPath
  if (copyAudio) {
    copyFileSync(sourceWavPath, reviewWavPath)
  }
  return {
    id: result.id,
    title: result.title ?? result.id,
    sourceWavPath,
    reviewWavPath,
    audioHref: toPosix(relative(outDir, reviewWavPath)),
    renderSeconds: result.renderSeconds ?? null,
    summary: result.summary ?? {},
    gates: result.gates ?? {},
  }
}

function makeListeningTemplate({ qualitySummary, phrases }) {
  const thresholds = qualitySummary.thresholds ?? {}
  return {
    version: 1,
    runId: qualitySummary.runId,
    modelId: qualitySummary.modelId,
    reviewer: '',
    reviewedAt: '',
    decision: '',
    thresholds: {
      minListeningKoreanClarityScore: thresholds.minListeningKoreanClarityScore ?? 4,
      minListeningVowelStabilityScore: thresholds.minListeningVowelStabilityScore ?? 4,
      minListeningArtifactScore: thresholds.minListeningArtifactScore ?? 4,
      scoreScale: thresholds.scoreScale ?? '1=unusable, 3=prototype, 5=public-beta-ready',
    },
    phraseScores: phrases.map((phrase) => ({
      id: phrase.id,
      title: phrase.title,
      wavPath: phrase.reviewWavPath,
      koreanClarityScore: null,
      vowelStabilityScore: null,
      artifactScore: null,
      notes: '',
    })),
  }
}

function renderHtml({ qualitySummary, releaseManifestPath, phrases, reviewTemplate, intendedScoresPath }) {
  const appData = escapeScriptJson({
    reviewTemplate,
    intendedScoresPath,
    phrases: phrases.map((phrase) => ({
      id: phrase.id,
      title: phrase.title,
      audioHref: phrase.audioHref,
      renderSeconds: phrase.renderSeconds,
      summary: phrase.summary,
      gatesPassed: phrase.gates?.passed === true,
    })),
  })
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WebUtau Korean Listening Review</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101014;
      --panel: #191923;
      --panel-2: #232433;
      --line: #3a3c52;
      --text: #f8f7ff;
      --muted: #b9bad1;
      --pink: #ff4da6;
      --cyan: #25d9ff;
      --lime: #b8ff4d;
      --yellow: #ffe66d;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    main {
      width: min(1180px, calc(100vw - 28px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }
    header {
      display: grid;
      gap: 12px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 4vw, 52px);
      line-height: 1;
    }
    h2 {
      margin: 0;
      font-size: 18px;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
    }
    code {
      color: var(--lime);
      word-break: break-all;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pill {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      padding: 7px 10px;
      font-size: 13px;
    }
    .review-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 18px;
      margin-top: 22px;
      align-items: start;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 16px;
    }
    .phrase-list {
      display: grid;
      gap: 12px;
    }
    .phrase {
      display: grid;
      gap: 14px;
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 16px;
    }
    .phrase-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
    }
    .phrase-title strong {
      color: var(--cyan);
      font-size: 18px;
    }
    audio {
      width: 100%;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .metric {
      background: var(--panel-2);
      border: 1px solid var(--line);
      padding: 8px;
      min-height: 54px;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }
    .metric b {
      display: block;
      margin-top: 4px;
      color: var(--yellow);
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .scores {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 13px;
    }
    input,
    select,
    textarea,
    button {
      border: 1px solid var(--line);
      background: #11121a;
      color: var(--text);
      font: inherit;
      min-height: 40px;
      padding: 9px 10px;
    }
    textarea {
      min-height: 78px;
      resize: vertical;
    }
    button {
      cursor: pointer;
      background: var(--pink);
      color: #15000c;
      border-color: var(--pink);
      font-weight: 700;
    }
    button.secondary {
      background: transparent;
      color: var(--cyan);
      border-color: var(--cyan);
    }
    .side {
      position: sticky;
      top: 12px;
      display: grid;
      gap: 12px;
    }
    .actions {
      display: grid;
      gap: 10px;
    }
    .output {
      width: 100%;
      min-height: 220px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .tiny {
      font-size: 12px;
    }
    @media (max-width: 860px) {
      main {
        width: min(100vw - 20px, 680px);
        padding-top: 18px;
      }
      .review-grid {
        grid-template-columns: 1fr;
      }
      .side {
        position: static;
      }
      .metrics,
      .scores {
        grid-template-columns: 1fr;
      }
      .phrase-title {
        display: grid;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>WebUtau Korean Listening Review</h1>
      <p>현재 확보된 렌더 샘플을 귀로 확인하고, release audit이 읽을 수 있는 청취 점수 JSON을 만듭니다.</p>
      <div class="meta">
        <span class="pill">model <code>${escapeHtml(qualitySummary.modelId)}</code></span>
        <span class="pill">run <code>${escapeHtml(qualitySummary.runId)}</code></span>
        <span class="pill">phrases ${phrases.length}</span>
      </div>
      <p class="tiny">Release manifest: <code>${escapeHtml(releaseManifestPath ?? '(not attached)')}</code></p>
    </header>
    <div class="review-grid">
      <section class="phrase-list" id="phrases"></section>
      <aside class="side">
        <section class="panel">
          <h2>Reviewer</h2>
          <label>이름 또는 이니셜
            <input id="reviewer" autocomplete="name" placeholder="예: HK">
          </label>
          <label>리뷰 날짜
            <input id="reviewedAt" type="date">
          </label>
          <label>판정
            <select id="decision">
              <option value="">hold</option>
              <option value="pass">pass</option>
            </select>
          </label>
        </section>
        <section class="panel actions">
          <h2>Scores</h2>
          <p>각 항목은 1점 unusable, 3점 prototype, 5점 public-beta-ready 기준입니다. release gate는 기본 4점 이상을 요구합니다.</p>
          <button id="download">Download JSON</button>
          <button id="copy" class="secondary">Copy JSON</button>
          <p class="tiny">권장 파일명: <code>${escapeHtml(basename(intendedScoresPath))}</code></p>
        </section>
        <textarea class="output" id="output" spellcheck="false"></textarea>
      </aside>
    </div>
  </main>
  <script>
    const app = ${appData}
    const scoreFields = [
      ['koreanClarityScore', 'Korean clarity'],
      ['vowelStabilityScore', 'Vowel stability'],
      ['artifactScore', 'Artifacts'],
    ]

    function metric(value, fallback = '-') {
      return value === null || value === undefined ? fallback : String(value)
    }

    function createScoreSelect(phraseId, field, label) {
      const wrapper = document.createElement('label')
      wrapper.textContent = label
      const select = document.createElement('select')
      select.dataset.phraseId = phraseId
      select.dataset.scoreField = field
      const blank = document.createElement('option')
      blank.value = ''
      blank.textContent = '-'
      select.append(blank)
      for (const score of [1, 2, 3, 4, 5]) {
        const option = document.createElement('option')
        option.value = String(score)
        option.textContent = String(score)
        select.append(option)
      }
      select.addEventListener('change', updateOutput)
      wrapper.append(select)
      return wrapper
    }

    function renderPhrases() {
      const root = document.querySelector('#phrases')
      for (const phrase of app.phrases) {
        const article = document.createElement('article')
        article.className = 'phrase'

        const title = document.createElement('div')
        title.className = 'phrase-title'
        title.innerHTML = '<strong></strong><code></code>'
        title.querySelector('strong').textContent = phrase.title
        title.querySelector('code').textContent = phrase.id

        const audio = document.createElement('audio')
        audio.controls = true
        audio.preload = 'metadata'
        audio.src = phrase.audioHref

        const metrics = document.createElement('div')
        metrics.className = 'metrics'
        const summary = phrase.summary || {}
        for (const [label, value] of [
          ['rms', summary.rms],
          ['peak', summary.peak],
          ['f0 cents', summary.medianAbsCents],
          ['onset lag', summary.medianOnsetLagSeconds],
        ]) {
          const node = document.createElement('div')
          node.className = 'metric'
          node.innerHTML = '<span></span><b></b>'
          node.querySelector('span').textContent = label
          node.querySelector('b').textContent = metric(value)
          metrics.append(node)
        }

        const scores = document.createElement('div')
        scores.className = 'scores'
        for (const [field, label] of scoreFields) {
          scores.append(createScoreSelect(phrase.id, field, label))
        }

        const notes = document.createElement('label')
        notes.textContent = 'Notes'
        const textarea = document.createElement('textarea')
        textarea.dataset.phraseId = phrase.id
        textarea.dataset.scoreField = 'notes'
        textarea.placeholder = '자음이 뭉개짐, 모음이 흔들림, 잡음 등'
        textarea.addEventListener('input', updateOutput)
        notes.append(textarea)

        article.append(title, audio, metrics, scores, notes)
        root.append(article)
      }
    }

    function collectScores() {
      const json = structuredClone(app.reviewTemplate)
      json.reviewer = document.querySelector('#reviewer').value.trim()
      json.reviewedAt = document.querySelector('#reviewedAt').value.trim()
      json.decision = document.querySelector('#decision').value
      for (const phrase of json.phraseScores) {
        for (const [field] of scoreFields) {
          const input = document.querySelector('[data-phrase-id="' + phrase.id + '"][data-score-field="' + field + '"]')
          phrase[field] = input && input.value ? Number(input.value) : null
        }
        const note = document.querySelector('[data-phrase-id="' + phrase.id + '"][data-score-field="notes"]')
        phrase.notes = note ? note.value.trim() : ''
      }
      return json
    }

    function updateOutput() {
      document.querySelector('#output').value = JSON.stringify(collectScores(), null, 2)
    }

    function downloadJson() {
      const blob = new Blob([JSON.stringify(collectScores(), null, 2) + '\\n'], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'listening-scores.local.json'
      link.click()
      URL.revokeObjectURL(url)
    }

    async function copyJson() {
      await navigator.clipboard.writeText(JSON.stringify(collectScores(), null, 2) + '\\n')
    }

    document.querySelector('#reviewedAt').value = new Date().toISOString().slice(0, 10)
    document.querySelector('#reviewer').addEventListener('input', updateOutput)
    document.querySelector('#reviewedAt').addEventListener('input', updateOutput)
    document.querySelector('#decision').addEventListener('change', updateOutput)
    document.querySelector('#download').addEventListener('click', downloadJson)
    document.querySelector('#copy').addEventListener('click', copyJson)
    renderPhrases()
    updateOutput()
  </script>
</body>
</html>
`
}

function renderReadme({ qualitySummary, indexHtmlPath, listeningTemplatePath, intendedScoresPath, releaseManifestPath }) {
  return [
    '# WebUtau Korean Listening Review',
    '',
    `Model: \`${qualitySummary.modelId}\``,
    `Run: \`${qualitySummary.runId}\``,
    '',
    'Open the review page and listen to every phrase:',
    '',
    `- \`${indexHtmlPath}\``,
    '',
    'Fill reviewer, review date, decision, and every 1-5 phrase score.',
    'Use `pass` only when every phrase is acceptable for the intended handoff.',
    '',
    'Generated files:',
    '',
    `- Template: \`${listeningTemplatePath}\``,
    `- Intended completed scores path: \`${intendedScoresPath}\``,
    `- Release manifest: \`${releaseManifestPath ?? '(not attached)'}\``,
    '',
    'The release audit must remain blocked until the completed scores JSON exists and all scores meet the configured thresholds.',
    '',
  ].join('\n')
}

function makeNextCommands({ indexHtmlPath, releaseManifestPath, intendedScoresPath }) {
  const commands = [`open ${shellQuote(indexHtmlPath)}`]
  commands.push(`cp ${shellQuote(intendedScoresPath.replace(/\.json$/u, '.template.json'))} ${shellQuote(intendedScoresPath)}`)
  if (releaseManifestPath) {
    commands.push(`npm run neural:audit-release -- --manifest ${shellQuote(relative(process.cwd(), releaseManifestPath))} --registry experiments/neural-singer/dataset-registry.example.json --report ${shellQuote(relative(process.cwd(), join(dirname(releaseManifestPath), 'release-audit.json')))}`)
  }
  return commands
}

function readJson(path, label) {
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    throw new Error(`Missing ${label}: ${resolved}`)
  }
  return JSON.parse(readFileSync(resolved, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll('</script', '<\\/script')
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase() || 'phrase'
}

function toPosix(path) {
  return path.split('\\').join('/')
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--quality-summary') {
      parsed.qualitySummary = argv[++index]
    } else if (arg === '--release-manifest') {
      parsed.releaseManifest = argv[++index]
    } else if (arg === '--no-release-manifest') {
      parsed.releaseManifest = false
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--no-copy-audio') {
      parsed.copyAudio = false
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-neural-listening-review.mjs [options]',
          '',
          'Options:',
          `  --quality-summary path    Rendered quality summary, default ${DEFAULT_QUALITY_SUMMARY}`,
          `  --release-manifest path   Release manifest, default ${DEFAULT_RELEASE_MANIFEST}`,
          '  --no-release-manifest     Generate review pack without release manifest context',
          '  --out path                Output review folder, default quality-summary sibling listening-review',
          '  --no-copy-audio           Reference source WAVs instead of copying them into the review pack',
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
    const manifest = prepareNeuralListeningReview(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
