#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULTS = {
  voicebankAudit: 'experiments/utau-v3/work/v3-voicebank-audit.json',
  otoAudit: 'experiments/utau-v3/work/v3-oto-audit.json',
  pitchAudit: 'experiments/utau-v3/work/v3-pitch-audit.json',
  loopAudit: 'experiments/utau-v3/work/v3-loop-audit.json',
  demoAudit: 'experiments/utau-v3/work/default-demo-render-audit.json',
  reviewManifest: 'experiments/utau-v3/work/v3-listening-review/review-manifest.json',
  listeningScores: 'experiments/utau-v3/work/v3-listening-review/listening-scores.local.json',
  readme: 'README.md',
  licenseBoundaries: 'docs/LICENSE_BOUNDARIES.md',
  bundledVoicebank: 'src/bundledVoicebank.ts',
  desktopScreenshot: 'docs/screenshots/webuta-desktop.jpg',
  mobileScreenshot: 'docs/screenshots/webuta-mobile.jpg',
}

const EXPECTED_DECISIONS = {
  voicebankAudit: 'v3-voicebank-audit-pass',
  otoAudit: 'v3-oto-audit-pass',
  pitchAudit: 'v3-pitch-audit-pass',
  loopAudit: 'v3-loop-audit-pass',
  demoAudit: 'default-demo-render-pass',
  reviewManifest: 'v3-listening-review-ready',
}

const DEMO_REQUIRED_CHECKS = [
  'default V3 voicebank loaded',
  'first-run demo aliases fully matched',
  'first-run demo render warnings clear',
  'first-run lyric visible',
  'desktop WAV download',
  'render history visible',
  'desktop no page horizontal overflow',
  'desktop piano keyboard and bar ruler visible',
  'mobile export controls visible',
  'mobile touch keyboard visible',
  'mobile piano keyboard and bar ruler visible',
  'mobile no page horizontal overflow',
]

const SCORE_KEYS = [
  'koreanClarityScore',
  'vowelStabilityScore',
  'consonantClarityScore',
  'musicalityScore',
  'artifactScore',
]

const PASSING_LISTENING_DECISIONS = new Set(['community-ready', 'release-ready', 'pass'])

export async function auditUtauCommunityRelease(options = {}) {
  const root = resolve(options.cwd ?? process.cwd())
  const paths = resolvePaths(root, options)
  const bundled = readBundledVoicebank(paths.bundledVoicebank)
  const gates = [
    reportGate('voicebank-package', 'V3 voicebank package audit', paths.voicebankAudit, EXPECTED_DECISIONS.voicebankAudit),
    reportGate('oto-timing', 'V3 oto timing audit', paths.otoAudit, EXPECTED_DECISIONS.otoAudit),
    reportGate('pitch-stability', 'V3 pitch audit', paths.pitchAudit, EXPECTED_DECISIONS.pitchAudit),
    reportGate('loop-stability', 'V3 sustain loop audit', paths.loopAudit, EXPECTED_DECISIONS.loopAudit),
    demoGate(paths.demoAudit),
    reviewPackGate(paths.reviewManifest),
    listeningScoresGate(paths.listeningScores),
    readmeGate(paths),
    bundledVoicebankGate(bundled),
    await pagesGate({ bundled, pagesUrl: options.pagesUrl, pagesReport: options.pagesReport }),
  ]
  const problems = gates.flatMap((gate) => gate.problems.map((problem) => `${gate.id}: ${problem}`))
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'community-release-ready' : 'community-release-blocked',
    voicebank: {
      name: bundled.name,
      file: bundled.file,
      version: bundled.version,
    },
    gates,
    problems,
    nextActions: nextActionsForProblems(problems),
  }
  if (options.report) {
    writeJson(resolve(root, options.report), report)
  }
  return report
}

function resolvePaths(root, options) {
  const paths = {}
  for (const [key, value] of Object.entries(DEFAULTS)) {
    paths[key] = resolve(root, options[key] ?? value)
  }
  return paths
}

function reportGate(id, label, path, expectedDecision) {
  const problems = []
  const report = readOptionalJson(path, label, problems)
  if (report) {
    if (report.ok !== true) {
      problems.push('report ok must be true')
    }
    if (report.decision !== expectedDecision) {
      problems.push(`decision must be ${expectedDecision}, got ${report.decision ?? 'missing'}`)
    }
  }
  return makeGate(id, label, path, problems, summarizeReport(report))
}

function demoGate(path) {
  const problems = []
  const report = readOptionalJson(path, 'default V3 demo render audit', problems)
  if (report) {
    if (report.ok !== true || report.decision !== EXPECTED_DECISIONS.demoAudit) {
      problems.push('default demo render audit must pass')
    }
    const checks = new Set((report.requiredChecks ?? []).filter((check) => check.passed).map((check) => check.check))
    for (const check of DEMO_REQUIRED_CHECKS) {
      if (!checks.has(check)) {
        problems.push(`missing passed demo check: ${check}`)
      }
    }
    const wav = report.download?.wav ?? {}
    if (wav.sampleRate !== 44100 || wav.channels !== 1 || wav.bitsPerSample !== 16) {
      problems.push('demo WAV must be 44.1 kHz mono 16-bit PCM')
    }
  }
  return makeGate('default-demo', 'First-run default demo render audit', path, problems, summarizeReport(report))
}

function reviewPackGate(path) {
  const problems = []
  const report = readOptionalJson(path, 'V3 listening review manifest', problems)
  if (report) {
    if (report.ok !== true || report.decision !== EXPECTED_DECISIONS.reviewManifest) {
      problems.push('listening review pack must be ready')
    }
    if ((report.phraseCount ?? 0) < 4) {
      problems.push('listening review pack must include at least four phrases')
    }
    for (const phrase of report.phrases ?? []) {
      if (phrase.gates?.passed !== true) {
        problems.push(`review phrase ${phrase.id ?? '(unknown)'} did not pass WAV gates`)
      }
      if (phrase.wavPath && !existsSync(phrase.wavPath)) {
        problems.push(`review phrase WAV is missing: ${phrase.wavPath}`)
      }
    }
  }
  return makeGate('listening-pack', 'Browser-rendered V3 listening review pack', path, problems, summarizeReport(report))
}

function listeningScoresGate(path) {
  const problems = []
  const scores = readOptionalJson(path, 'human listening scores', problems)
  if (scores) {
    if (scores.version !== 1) {
      problems.push('listening score version must be 1')
    }
    if (typeof scores.reviewer !== 'string' || scores.reviewer.trim().length === 0) {
      problems.push('human listening scores must include reviewer')
    }
    if (typeof scores.reviewedAt !== 'string' || scores.reviewedAt.trim().length === 0) {
      problems.push('human listening scores must include reviewedAt')
    }
    const decision = String(scores.decision ?? '').trim().toLowerCase()
    if (!PASSING_LISTENING_DECISIONS.has(decision)) {
      problems.push('human listening decision must be community-ready, release-ready, or pass')
    }
    const thresholds = scores.thresholds ?? {}
    for (const [index, phrase] of (scores.phraseScores ?? []).entries()) {
      for (const key of SCORE_KEYS) {
        const score = phrase[key]
        const threshold = thresholds[`min${capitalize(key)}`] ?? 4
        if (typeof score !== 'number') {
          problems.push(`phrase ${phrase.id ?? index} ${key} must be scored`)
        } else if (score < threshold) {
          problems.push(`phrase ${phrase.id ?? index} ${key} ${score} is below ${threshold}`)
        }
      }
    }
    if (!Array.isArray(scores.phraseScores) || scores.phraseScores.length < 4) {
      problems.push('human listening scores must include at least four phrase scores')
    }
  }
  return makeGate('human-listening', 'Human listening review scores', path, problems, scores ? { phraseCount: scores.phraseScores?.length ?? 0 } : null)
}

function readmeGate(paths) {
  const problems = []
  const readme = readOptionalText(paths.readme, 'README', problems)
  const license = readOptionalText(paths.licenseBoundaries, 'license boundaries doc', problems)
  if (readme) {
    const requiredSnippets = [
      '## Screenshots',
      'docs/screenshots/webuta-desktop.jpg',
      'docs/screenshots/webuta-mobile.jpg',
      '## Limitations',
      'WebUtau Korean V3 Synthetic',
      'not recorded from a human singer',
      'Kasane Teto assets are not bundled',
      'License Boundaries',
    ]
    for (const snippet of requiredSnippets) {
      if (!readme.includes(snippet)) {
        problems.push(`README must include "${snippet}"`)
      }
    }
  }
  if (license) {
    for (const snippet of ['WebUtau Korean V3 Synthetic', 'generated by WebUtau DSP tooling', 'Kasane Teto', 'not a bundled asset']) {
      if (!license.includes(snippet)) {
        problems.push(`license boundaries doc must include "${snippet}"`)
      }
    }
  }
  for (const screenshotPath of [paths.desktopScreenshot, paths.mobileScreenshot]) {
    if (!existsSync(screenshotPath)) {
      problems.push(`screenshot missing: ${screenshotPath}`)
    }
  }
  return makeGate('readme-release-docs', 'README screenshots, license notes, and honest limitations', paths.readme, problems, {
    desktopScreenshot: paths.desktopScreenshot,
    mobileScreenshot: paths.mobileScreenshot,
  })
}

function bundledVoicebankGate(bundled) {
  const problems = []
  if (bundled.name !== 'WebUtau Korean V3 Synthetic') {
    problems.push(`bundled voicebank name must be WebUtau Korean V3 Synthetic, got ${bundled.name}`)
  }
  if (bundled.file !== 'webuta-ko-v3.zip') {
    problems.push(`bundled voicebank file must be webuta-ko-v3.zip, got ${bundled.file}`)
  }
  if (!/^\d{8}-v3-/u.test(bundled.version)) {
    problems.push(`bundled voicebank version must be cache-busted V3 version, got ${bundled.version}`)
  }
  return makeGate('bundled-v3-selected', 'Bundled V3 voicebank selected by default', null, problems, bundled)
}

async function pagesGate({ bundled, pagesUrl, pagesReport }) {
  const problems = []
  let evidence = null
  if (pagesReport) {
    evidence = readOptionalJson(resolve(pagesReport), 'GitHub Pages evidence', problems)
    if (evidence) {
      validatePagesEvidence(evidence, bundled, problems)
    }
  } else if (pagesUrl) {
    evidence = await fetchPagesEvidence(pagesUrl, bundled, problems)
  } else {
    problems.push('missing GitHub Pages deployment evidence; pass --pages-url or --pages-report')
  }
  return makeGate('github-pages-v3', 'GitHub Pages loads cache-busted bundled V3 zip', pagesReport ? resolve(pagesReport) : pagesUrl ?? null, problems, evidence)
}

function validatePagesEvidence(evidence, bundled, problems) {
  if (evidence.ok !== true) {
    problems.push('GitHub Pages evidence ok must be true')
  }
  if (evidence.voicebank?.file !== bundled.file) {
    problems.push(`GitHub Pages voicebank file ${evidence.voicebank?.file ?? 'missing'} does not match ${bundled.file}`)
  }
  if (evidence.voicebank?.version !== bundled.version) {
    problems.push(`GitHub Pages voicebank version ${evidence.voicebank?.version ?? 'missing'} does not match ${bundled.version}`)
  }
  const checks = new Set(evidence.checks ?? [])
  for (const check of ['pages app loaded', 'pages V3 zip cache-busted']) {
    if (!checks.has(check)) {
      problems.push(`GitHub Pages evidence missing check: ${check}`)
    }
  }
}

async function fetchPagesEvidence(pagesUrl, bundled, problems) {
  const base = new URL(pagesUrl)
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/'
  }
  const app = await fetchWithProblem(base, 'GitHub Pages app', problems)
  const zipUrl = new URL(`voicebanks/${bundled.file}`, base)
  zipUrl.searchParams.set('v', bundled.version)
  const zip = await fetchWithProblem(zipUrl, 'GitHub Pages V3 zip', problems, { method: 'HEAD' })
  const evidence = {
    ok: problems.length === 0,
    url: base.href,
    voicebankUrl: zipUrl.href,
    voicebank: {
      file: bundled.file,
      version: bundled.version,
      status: zip?.status ?? null,
      bytes: Number(zip?.headers.get('content-length') ?? 0),
    },
    checks: [],
  }
  if (app?.ok) {
    evidence.checks.push('pages app loaded')
  }
  if (zip?.ok) {
    evidence.checks.push('pages V3 zip cache-busted')
  }
  if ((evidence.voicebank.bytes ?? 0) > 0 && evidence.voicebank.bytes < 40_000_000) {
    problems.push(`GitHub Pages V3 zip is unexpectedly small: ${evidence.voicebank.bytes} bytes`)
  }
  evidence.ok = problems.length === 0
  return evidence
}

async function fetchWithProblem(url, label, problems, init = {}) {
  try {
    const response = await fetch(url, init)
    if (!response.ok) {
      problems.push(`${label} returned HTTP ${response.status}`)
    }
    return response
  } catch (error) {
    problems.push(`${label} fetch failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function readBundledVoicebank(path) {
  const text = readFileSync(path, 'utf8')
  return {
    name: readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_NAME'),
    file: readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_FILE'),
    version: readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_VERSION'),
  }
}

function readExportedString(text, name) {
  const match = text.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`, 'u'))
  return match?.[1] ?? ''
}

function makeGate(id, label, evidencePath, problems, summary = null) {
  return {
    id,
    label,
    passed: problems.length === 0,
    evidencePath,
    summary,
    problems,
  }
}

function summarizeReport(report) {
  if (!report) {
    return null
  }
  return {
    decision: report.decision ?? null,
    generatedAt: report.generatedAt ?? null,
  }
}

function readOptionalJson(path, label, problems) {
  if (!existsSync(path)) {
    problems.push(`missing ${label}: ${path}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(`invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function readOptionalText(path, label, problems) {
  if (!existsSync(path)) {
    problems.push(`missing ${label}: ${path}`)
    return null
  }
  return readFileSync(path, 'utf8')
}

function nextActionsForProblems(problems) {
  if (problems.length === 0) {
    return ['Community release gate passed. Keep this report with release artifacts.']
  }
  const actions = []
  if (problems.some((problem) => problem.includes('human-listening'))) {
    actions.push('Fill experiments/utau-v3/work/v3-listening-review/listening-scores.local.json from the template after a human listening pass.')
  }
  if (problems.some((problem) => problem.includes('github-pages-v3'))) {
    actions.push('Deploy to GitHub Pages and rerun this audit with --pages-url https://midagedev.github.io/webuta/.')
  }
  if (problems.some((problem) => problem.includes('readme-release-docs'))) {
    actions.push('Refresh README screenshots, license notes, and limitations before public release.')
  }
  if (actions.length === 0) {
    actions.push('Regenerate the failing evidence report, then rerun npm run release:audit-utau.')
  }
  return actions
}

function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--report' || arg === '--out') {
      options.report = argv[++index]
    } else if (arg === '--pages-url') {
      options.pagesUrl = argv[++index]
    } else if (arg === '--pages-report') {
      options.pagesReport = argv[++index]
    } else if (arg === '--listening-scores') {
      options.listeningScores = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-utau-community-release.mjs [options]',
          '',
          'Options:',
          '  --report path            Write release gate report JSON',
          '  --pages-url url          Verify a live GitHub Pages deployment',
          '  --pages-report path      Use saved GitHub Pages evidence JSON',
          '  --listening-scores path  Override human listening score JSON path',
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await auditUtauCommunityRelease(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
