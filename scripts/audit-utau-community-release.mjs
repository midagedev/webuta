#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { validateScores as validateListeningScores } from './accept-utau-v3-listening-scores.mjs'
import { validateHandoffReport as validateWavDawHandoff } from './accept-wav-daw-handoff.mjs'

const DEFAULTS = {
  voicebankAudit: 'experiments/utau-v3/work/v3-voicebank-audit.json',
  otoAudit: 'experiments/utau-v3/work/v3-oto-audit.json',
  pitchAudit: 'experiments/utau-v3/work/v3-pitch-audit.json',
  loopAudit: 'experiments/utau-v3/work/v3-loop-audit.json',
  longSustainAudit: 'experiments/utau-v3/work/long-sustain-audit/long-sustain-audit.json',
  clarityAudit: 'experiments/utau-v3/work/v3-clarity-audit.json',
  demoAudit: 'experiments/utau-v3/work/default-demo-render-audit.json',
  pagesDemoAudit: 'experiments/utau-v3/work/pages-default-demo-render-audit.json',
  reviewManifest: 'experiments/utau-v3/work/v3-listening-review/review-manifest.json',
  publicReviewHub: 'public/review/index.html',
  publicReviewIndex: 'public/review/v3/index.html',
  publicReviewManifest: 'public/review/v3/review-manifest.json',
  publicWavDawHandoffIndex: 'public/review/wav-daw/index.html',
  sampleReview: 'experiments/utau-v3/work/v3-sample-review-report.json',
  listeningScores: 'experiments/utau-v3/work/v3-listening-review/listening-scores.local.json',
  wavDawHandoff: 'experiments/utau-v3/work/wav-daw-handoff/handoff-report.local.json',
  packageJson: 'package.json',
  readme: 'README.md',
  licenseBoundaries: 'docs/LICENSE_BOUNDARIES.md',
  wavDawQa: 'docs/WAV_DAW_QA.md',
  bundledVoicebank: 'src/bundledVoicebank.ts',
  voicebankZip: 'public/voicebanks/webuta-ko-v3.zip',
  desktopScreenshot: 'docs/screenshots/webuta-desktop.jpg',
  mobileScreenshot: 'docs/screenshots/webuta-mobile.jpg',
}

const EXPECTED_DECISIONS = {
  voicebankAudit: 'v3-voicebank-audit-pass',
  otoAudit: 'v3-oto-audit-pass',
  pitchAudit: 'v3-pitch-audit-pass',
  loopAudit: 'v3-loop-audit-pass',
  longSustainAudit: 'utau-long-sustain-audit-pass',
  clarityAudit: 'v3-clarity-audit-pass',
  demoAudit: 'default-demo-render-pass',
  reviewManifest: 'v3-listening-review-ready',
  sampleReview: 'v3-sample-review-report-ready',
}

const DEMO_REQUIRED_CHECKS = [
  'default V3 voicebank loaded',
  'first-run starter guide visible',
  'first-run three-step checklist visible',
  'first-run quick-start CTA visible',
  'first-run focused next action visible',
  'first-run starter launch panel visible',
  'first-run inline lyric input visible',
  'first-run current lyric card visible',
  'first-run utility actions visible',
  'first-run sketch cues visible',
  'tempo map controls visible',
  'first-run demo aliases fully matched',
  'first-run demo render warnings clear',
  'first-run lyric visible',
  'community release readiness card visible',
  'manual release evidence checklist visible',
  'voicebank license metadata visible',
  'voicebank self-generated origin visible',
  'DAW handoff bundle export visible',
  'community release review hub linked',
  'community listening review scorecard linked',
  'selected-note UTAU sample preview available',
  'desktop WAV download',
  'render history visible',
  'desktop no page horizontal overflow',
  'desktop piano keyboard and bar ruler visible',
  'mobile export controls visible',
  'mobile touch keyboard visible',
  'mobile piano keyboard and bar ruler visible',
  'mobile no page horizontal overflow',
]

export async function auditUtauCommunityRelease(options = {}) {
  const root = resolve(options.cwd ?? process.cwd())
  const paths = resolvePaths(root, options)
  const bundled = readBundledVoicebank(paths.bundledVoicebank)
  const gates = [
    reportGate('voicebank-package', 'V3 voicebank package audit', paths.voicebankAudit, EXPECTED_DECISIONS.voicebankAudit),
    reportGate('oto-timing', 'V3 oto timing audit', paths.otoAudit, EXPECTED_DECISIONS.otoAudit),
    reportGate('pitch-stability', 'V3 pitch audit', paths.pitchAudit, EXPECTED_DECISIONS.pitchAudit),
    reportGate('loop-stability', 'V3 sustain loop audit', paths.loopAudit, EXPECTED_DECISIONS.loopAudit),
    reportGate(
      'rendered-long-sustain',
      'Rendered UTAU long sustain, click, coda, and pitch audit',
      paths.longSustainAudit,
      EXPECTED_DECISIONS.longSustainAudit,
    ),
    reportGate('phoneme-clarity', 'V3 phoneme clarity audit', paths.clarityAudit, EXPECTED_DECISIONS.clarityAudit),
    demoGate(paths.demoAudit),
    pagesDemoGate(paths.pagesDemoAudit, options.pagesUrl),
    reviewPackGate(paths.reviewManifest),
    publicReviewHubGate(paths.publicReviewHub),
    publicReviewGate(paths),
    publicWavDawHandoffGate(paths.publicWavDawHandoffIndex),
    sampleReviewGate(paths.sampleReview),
    listeningScoresGate(paths.listeningScores),
    wavDawHandoffGate(paths.wavDawHandoff),
    noRecordingWorkflowGate(paths.packageJson),
    readmeGate(paths),
    bundledVoicebankGate(bundled),
    await syntheticOriginGate(paths.voicebankZip, bundled),
    await pagesGate({
      bundled,
      pagesUrl: options.pagesUrl,
      pagesReport: options.pagesReport,
      voicebankZipPath: paths.voicebankZip,
      publicReviewManifestPath: paths.publicReviewManifest,
    }),
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
    validateDefaultDemoReport(report, problems)
  }
  return makeGate('default-demo', 'First-run default demo render audit', path, problems, summarizeReport(report))
}

function pagesDemoGate(path, pagesUrl) {
  const problems = []
  const report = readOptionalJson(path, 'GitHub Pages default V3 demo render audit', problems)
  if (report) {
    validateDefaultDemoReport(report, problems)
    const smokeUrl = report.smoke?.url ?? ''
    if (!/^https?:\/\//u.test(smokeUrl)) {
      problems.push(`Pages demo smoke URL must be a deployed URL, got ${smokeUrl || 'missing'}`)
    }
    if (pagesUrl && normalizeUrl(smokeUrl) !== normalizeUrl(pagesUrl)) {
      problems.push(`Pages demo smoke URL ${smokeUrl || 'missing'} does not match ${pagesUrl}`)
    }
  }
  return makeGate('pages-default-demo', 'GitHub Pages first-run default demo browser audit', path, problems, {
    ...summarizeReport(report),
    url: report?.smoke?.url ?? null,
    wav: report?.download?.wav ?? null,
  })
}

function validateDefaultDemoReport(report, problems) {
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
    if ((report.comparisonCount ?? 0) < 4) {
      problems.push('listening review pack must include at least four legacy V2 comparison phrases')
    }
    for (const phrase of report.phrases ?? []) {
      if (phrase.gates?.passed !== true) {
        problems.push(`review phrase ${phrase.id ?? '(unknown)'} did not pass WAV gates`)
      }
      if (phrase.wavPath && !existsSync(phrase.wavPath)) {
        problems.push(`review phrase WAV is missing: ${phrase.wavPath}`)
      }
    }
    for (const comparison of report.comparisons ?? []) {
      if (comparison.gates?.passed !== true) {
        problems.push(`legacy V2 comparison ${comparison.id ?? '(unknown)'} did not pass WAV gates`)
      }
      if (comparison.wavPath && !existsSync(comparison.wavPath)) {
        problems.push(`legacy V2 comparison WAV is missing: ${comparison.wavPath}`)
      }
    }
  }
  return makeGate('listening-pack', 'Browser-rendered V3 listening review pack', path, problems, summarizeReport(report))
}

function publicReviewHubGate(path) {
  const problems = []
  const html = readOptionalText(path, 'public release review hub', problems)
  if (html) {
    for (const snippet of [
      'WebUtau Release Review Hub',
      'Release Review Hub',
      'WebUtau Korean V3 Synthetic',
      'No recording needed',
      '2 files to finish',
      'Release completion path',
      '3/3 passed',
      '0/2 left',
      'Open WebUtau app',
      'href="../"',
      'v3/index.html',
      'listening-scores.local.json',
      'wav-daw/index.html',
      'handoff-report.local.json',
      'Fast Acceptance Path',
      'Downloads',
      'release:accept-evidence',
      'voicebank:accept-review-v3',
      'release:accept-daw-handoff',
      'release:audit-utau',
    ]) {
      if (!html.includes(snippet)) {
        problems.push(`public release review hub must include "${snippet}"`)
      }
    }
  }
  return makeGate('public-release-review-hub', 'Published release review hub', path, problems, html ? {
    hasListeningLink: html.includes('v3/index.html'),
    hasWavDawLink: html.includes('wav-daw/index.html'),
  } : null)
}

function publicReviewGate(paths) {
  const problems = []
  const html = readOptionalText(paths.publicReviewIndex, 'public V3 listening review scorecard', problems)
  const manifest = readOptionalJson(paths.publicReviewManifest, 'public V3 listening review manifest', problems)
  if (html) {
    for (const snippet of [
      'WebUtau Korean V3 Listening Review',
      'listening-scores.local.json',
      'No recording step',
      'progressSummary',
      'problemList',
      'Finish every required score before downloading',
      'release:accept-evidence',
      'Downloads',
    ]) {
      if (!html.includes(snippet)) {
        problems.push(`public review scorecard must include "${snippet}"`)
      }
    }
  }
  if (manifest) {
    if (manifest.ok !== true || manifest.decision !== EXPECTED_DECISIONS.reviewManifest) {
      problems.push('public review manifest must describe a ready review pack')
    }
    if (manifest.publishedForWeb !== true) {
      problems.push('public review manifest must be sanitized for web publishing')
    }
    if (JSON.stringify(manifest).includes('/Users/')) {
      problems.push('public review manifest must not contain local absolute paths')
    }
    if ((manifest.phraseCount ?? 0) < 4 || (manifest.comparisonCount ?? 0) < 4) {
      problems.push('public review manifest must include four V3 phrases and four legacy comparisons')
    }
    const baseDir = dirname(paths.publicReviewManifest)
    for (const item of [...(manifest.phrases ?? []), ...(manifest.comparisons ?? [])]) {
      const href = item.audioHref ?? item.wavPath
      if (typeof href !== 'string' || href.length === 0) {
        problems.push(`public review item ${item.id ?? '(unknown)'} is missing audioHref`)
        continue
      }
      if (href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(href)) {
        problems.push(`public review item ${item.id ?? '(unknown)'} must use relative audio href`)
        continue
      }
      const audioPath = resolve(baseDir, href)
      if (!existsSync(audioPath)) {
        problems.push(`public review audio missing: ${href}`)
      } else if (readFileSync(audioPath).byteLength < 180_000) {
        problems.push(`public review audio too small: ${href}`)
      }
    }
  }
  return makeGate('public-listening-review', 'Published V3 listening review scorecard', paths.publicReviewIndex, problems, manifest ? {
    phraseCount: manifest.phraseCount ?? null,
    comparisonCount: manifest.comparisonCount ?? null,
    publishedForWeb: manifest.publishedForWeb ?? null,
  } : null)
}

function publicWavDawHandoffGate(path) {
  const problems = []
  const html = readOptionalText(path, 'public WAV DAW handoff report builder', problems)
  if (html) {
    for (const snippet of [
      'WebUtau WAV DAW Handoff',
      'webuta-wav-daw-handoff-v1',
      'handoff-report.local.json',
      'release:accept-evidence',
      'WebUtau Korean V3 Synthetic',
      'https://midagedev.github.io/webuta/',
      'Open WebUtau app',
      'Open release hub',
      'href="../../"',
      'href="../index.html"',
      '60-second physical handoff path',
      'manual evidence only after real DAW import',
      'First-Vocal-Sketch.wav',
      '44.1 kHz mono 16-bit',
      '도 히 도 히 다 이 스 키',
      'openedFromPublicUrl',
      'defaultVoicebankSelected',
      'firstRunGuideVisible',
      'starterLyricInputVisible',
      'defaultLyricsMatched',
      'audioPreviewWorked',
      'wavExportWorked',
      'targetDawImportWorked',
      'targetDawPlaybackAudible',
      'browserDraftRestored',
      'noHorizontalOverflowPortrait',
      'userVoicebankPrivacyConfirmed',
      'GarageBand',
      'No recording needed',
    ]) {
      if (!html.includes(snippet)) {
        problems.push(`public WAV DAW handoff builder must include "${snippet}"`)
      }
    }
  }
  return makeGate('public-wav-daw-handoff', 'Published WAV DAW handoff report builder', path, problems, html ? {
    hasDownloadBuilder: html.includes('handoff-report.local.json'),
    hasAutosave: html.includes('localStorage'),
  } : null)
}

function sampleReviewGate(path) {
  const problems = []
  const report = readOptionalJson(path, 'V3 sample review report', problems)
  if (report) {
    if (report.ok !== true || report.decision !== EXPECTED_DECISIONS.sampleReview) {
      problems.push('V3 sample review report must be ready')
    }
    if (report.noRecordingRequired !== true || report.manualReview?.noRecordingRequired !== true) {
      problems.push('V3 sample review must not require new voice recordings')
    }
    if ((report.manualReview?.hardFlagCount ?? 0) !== 0 || (report.hardFlags?.length ?? 0) !== 0) {
      problems.push('V3 sample review must have zero hard sample flags')
    }
    if ((report.manualReview?.pitchWatchlistCount ?? 0) < 1 || !Array.isArray(report.pitchWatchlist)) {
      problems.push('V3 sample review must include a pitch watchlist')
    }
    if ((report.manualReview?.loopWatchlistCount ?? 0) < 1 || !Array.isArray(report.loopWatchlist)) {
      problems.push('V3 sample review must include a loop watchlist')
    }
    if ((report.manualReview?.clarityWatchlistCount ?? 0) < 1 || !Array.isArray(report.clarityWatchlist)) {
      problems.push('V3 sample review must include a clarity watchlist')
    }
    if ((report.manualReview?.listeningPhraseCount ?? 0) < 4 || !Array.isArray(report.listeningQueue)) {
      problems.push('V3 sample review must include at least four listening phrases')
    }
  }
  return makeGate('sample-review', 'V3 sample-level review preflight', path, problems, report ? {
    decision: report.decision ?? null,
    hardFlagCount: report.manualReview?.hardFlagCount ?? null,
    pitchWatchlistCount: report.manualReview?.pitchWatchlistCount ?? null,
    loopWatchlistCount: report.manualReview?.loopWatchlistCount ?? null,
    clarityWatchlistCount: report.manualReview?.clarityWatchlistCount ?? null,
    listeningPhraseCount: report.manualReview?.listeningPhraseCount ?? null,
  } : null)
}

function listeningScoresGate(path) {
  const problems = []
  const scores = readOptionalJson(path, 'human listening scores', problems)
  if (scores) {
    validateListeningScores(scores, problems)
  }
  return makeGate('human-listening', 'Human listening review scores', path, problems, scores ? { phraseCount: scores.phraseScores?.length ?? 0, comparisonCount: scores.comparisonScores?.length ?? 0 } : null)
}

function wavDawHandoffGate(path) {
  const problems = []
  const handoff = readOptionalJson(path, 'physical WAV DAW handoff report', problems)
  if (handoff) {
    validateWavDawHandoff(handoff, problems)
  }
  return makeGate('wav-daw-handoff', 'Physical device WAV and DAW import handoff', path, problems, handoff ? {
    device: handoff.environment?.device ?? null,
    browser: handoff.environment?.browser ?? null,
    targetDaw: handoff.environment?.targetDaw ?? null,
    exportMethod: handoff.handoff?.exportMethod ?? null,
    wav: handoff.renderedWav ?? null,
  } : null)
}

function noRecordingWorkflowGate(path) {
  const problems = []
  const pkg = readOptionalJson(path, 'package.json', problems)
  const inspectedScripts = []
  const inactiveScripts = []
  const forbidden = [
    'record',
    'recorder',
    'recording',
    'private-singer',
    'supertonic',
    'tts',
  ]
  if (pkg) {
    const scripts = pkg.scripts
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
      problems.push('package.json must include a scripts object')
    } else {
      if (!scripts['voicebank:v3']) {
        problems.push('package.json must expose voicebank:v3 as the self-generated V3 builder')
      }
      if (!scripts['release:audit-utau']) {
        problems.push('package.json must expose release:audit-utau')
      }
      if (!scripts['release:accept-evidence']) {
        problems.push('package.json must expose release:accept-evidence')
      }
      for (const [name, command] of Object.entries(scripts)) {
        const script = String(command)
        if (/^(experimental|legacy):/u.test(name)) {
          inactiveScripts.push(name)
          continue
        }
        if (!/^(voicebank|release|smoke):/u.test(name)) {
          continue
        }
        inspectedScripts.push(name)
        const haystack = `${name} ${script}`.toLowerCase()
        for (const token of forbidden) {
          if (haystack.includes(token)) {
            problems.push(`active script ${name} must not require ${token}; move it under experimental: or legacy:`)
            break
          }
        }
      }
    }
  }
  return makeGate('no-recording-workflow', 'Active V3 npm workflow stays self-generated', path, problems, {
    inspectedScriptCount: inspectedScripts.length,
    inspectedScripts,
    inactiveExperimentalOrLegacyCount: inactiveScripts.length,
    inactiveExperimentalOrLegacyScripts: inactiveScripts,
  })
}

function readmeGate(paths) {
  const problems = []
  const readme = readOptionalText(paths.readme, 'README', problems)
  const license = readOptionalText(paths.licenseBoundaries, 'license boundaries doc', problems)
  const wavDawQa = readOptionalText(paths.wavDawQa, 'WAV / DAW QA doc', problems)
  if (readme) {
    const requiredSnippets = [
      '## No Recording Needed',
      '## Screenshots',
      'docs/screenshots/webuta-desktop.jpg',
      'docs/screenshots/webuta-mobile.jpg',
      '## Limitations',
      'WebUtau Korean V3 Synthetic',
      'not recorded from a human singer',
      'derived from public/private recorded datasets',
      'must not ask the user, the user\'s family, or reviewers to record new voice material',
      'Kasane Teto assets are not bundled',
      'License Boundaries',
      'public/review/index.html',
      '60-second physical handoff path',
      'First-Vocal-Sketch.wav',
      'release:accept-evidence',
      'Downloads',
    ]
    for (const snippet of requiredSnippets) {
      if (!readme.includes(snippet)) {
        problems.push(`README must include "${snippet}"`)
      }
    }
  }
  if (license) {
    for (const snippet of [
      'WebUtau Korean V3 Synthetic',
      'generated by WebUtau DSP tooling',
      'public/private recorded dataset',
      'Kasane Teto',
      'not a bundled asset',
    ]) {
      if (!license.includes(snippet)) {
        problems.push(`license boundaries doc must include "${snippet}"`)
      }
    }
  }
  if (wavDawQa) {
    for (const snippet of [
      'WebUtau Korean V3 Synthetic',
      'selected without importing a voicebank zip',
      'START HERE',
      '01 샘플 듣기',
      '02 가사 적용',
      '03 WAV 받기',
      'STEP 01',
      '샘플 먼저 듣기',
      '스타터 가사 라인',
      '현재 가사',
      '작업 시작',
      '필요한 것만 바로 꺼내기',
      '샘플 듣기',
      '멜로디 추천',
      '새 프로젝트',
      '기본 샘플',
      'wav-daw-handoff.local.template.json',
      'review/wav-daw/index.html',
      '60-second physical handoff path',
      'First-Vocal-Sketch.wav',
      '44.1 kHz mono 16-bit',
      'release:accept-evidence',
      'Downloads',
      'Optional compatibility pass',
      'Any optional imported voicebank zip remains user-provided and private to the browser',
    ]) {
      if (!wavDawQa.includes(snippet)) {
        problems.push(`WAV / DAW QA doc must include "${snippet}"`)
      }
    }
    if (/Import the official Kasane Teto UTAU\/OpenUTAU zip from Files/u.test(wavDawQa)) {
      problems.push('WAV / DAW QA doc must not make Kasane Teto import the default release path')
    }
  }
  const screenshots = [
    inspectScreenshot(paths.desktopScreenshot, { label: 'desktop', minWidth: 1000, minHeight: 700, minBytes: 80_000 }, problems),
    inspectScreenshot(paths.mobileScreenshot, { label: 'mobile', minWidth: 360, minHeight: 700, minBytes: 40_000 }, problems),
  ].filter(Boolean)
  return makeGate('readme-release-docs', 'README, WAV/DAW QA, screenshots, license notes, and honest limitations', paths.readme, problems, {
    desktopScreenshot: paths.desktopScreenshot,
    mobileScreenshot: paths.mobileScreenshot,
    screenshots,
  })
}

function inspectScreenshot(path, expectation, problems) {
  if (!existsSync(path)) {
    problems.push(`screenshot missing: ${path}`)
    return null
  }
  const bytes = readFileSync(path)
  const image = readImageInfo(bytes)
  if (!image) {
    problems.push(`${expectation.label} screenshot must be a readable PNG or JPEG: ${path}`)
    return {
      label: expectation.label,
      path,
      bytes: bytes.length,
      type: null,
      width: null,
      height: null,
    }
  }
  if (bytes.length < expectation.minBytes) {
    problems.push(`${expectation.label} screenshot is too small: ${bytes.length} bytes; expected at least ${expectation.minBytes}`)
  }
  if (image.width < expectation.minWidth || image.height < expectation.minHeight) {
    problems.push(
      `${expectation.label} screenshot is ${image.width}x${image.height}; expected at least ${expectation.minWidth}x${expectation.minHeight}`,
    )
  }
  return {
    label: expectation.label,
    path,
    bytes: bytes.length,
    ...image,
  }
}

function readImageInfo(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      type: 'png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      while (bytes[offset] === 0xff) {
        offset += 1
      }
      const marker = bytes[offset]
      offset += 1
      if (marker === 0xd9 || marker === 0xda) {
        break
      }
      if (offset + 2 > bytes.length) {
        break
      }
      const segmentLength = bytes.readUInt16BE(offset)
      if (segmentLength < 2 || offset + segmentLength > bytes.length) {
        break
      }
      if (isJpegStartOfFrame(marker) && offset + 7 <= bytes.length) {
        return {
          type: 'jpeg',
          width: bytes.readUInt16BE(offset + 5),
          height: bytes.readUInt16BE(offset + 3),
        }
      }
      offset += segmentLength
    }
  }
  return null
}

function isJpegStartOfFrame(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
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

async function syntheticOriginGate(path, bundled) {
  const problems = []
  let summary = null
  if (!existsSync(path)) {
    problems.push(`missing bundled V3 zip: ${path}`)
    return makeGate('synthetic-origin', 'No-recording synthetic voicebank origin evidence', path, problems, summary)
  }

  try {
    const zip = await JSZip.loadAsync(readFileSync(path))
    const manifestText = await readZipText(zip, 'webuta-ko-v3.manifest.json', problems)
    const readme = await readZipText(zip, 'readme.txt', problems)
    const license = await readZipText(zip, 'license.txt', problems)
    let manifest = null
    if (manifestText) {
      try {
        manifest = JSON.parse(manifestText)
      } catch (error) {
        problems.push(`invalid V3 manifest JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (manifest) {
      summary = {
        id: manifest.id ?? null,
        name: manifest.name ?? null,
        type: manifest.type ?? null,
        sampleCount: Array.isArray(manifest.samples) ? manifest.samples.length : null,
      }
      if (manifest.name !== bundled.name) {
        problems.push(`V3 manifest name ${manifest.name ?? 'missing'} does not match ${bundled.name}`)
      }
      if (!String(manifest.type ?? '').includes('generated-synthetic')) {
        problems.push('V3 manifest type must declare generated-synthetic origin')
      }
      if (!String(manifest.license ?? '').includes('DSP-generated')) {
        problems.push('V3 manifest license must describe DSP-generated sample origin')
      }
      if (!String(manifest.qualityIntent ?? '').includes('does not imitate a real singer')) {
        problems.push('V3 manifest quality intent must reject real-singer imitation')
      }
      if (manifest.sourceLineage?.method !== 'deterministic-dsp-only') {
        problems.push('V3 manifest sourceLineage.method must be deterministic-dsp-only')
      }
      for (const key of [
        'noHumanRecordingSource',
        'noPublicOrPrivateRecordedDatasetSource',
        'noThirdPartySingerOrCharacterSource',
        'noTtsOrModelCheckpointOutput',
      ]) {
        if (manifest.sourceLineage?.[key] !== true) {
          problems.push(`V3 manifest sourceLineage.${key} must be true`)
        }
      }
    }

    if (readme) {
      for (const snippet of [
        'deterministic DSP synthesis',
        'not by cloning, recording',
        'No public or private recorded voice dataset is used as source audio',
      ]) {
        if (!readme.includes(snippet)) {
          problems.push(`V3 readme.txt must include "${snippet}"`)
        }
      }
    }
    if (license) {
      for (const snippet of [
        'No third-party voice',
        'TTS service output',
        'model checkpoint output',
        'Kasane Teto asset',
        'No public or private recorded voice dataset is used as source audio',
        'Generated user audio may be used freely',
      ]) {
        if (!license.includes(snippet)) {
          problems.push(`V3 license.txt must include "${snippet}"`)
        }
      }
    }
  } catch (error) {
    problems.push(`unable to inspect bundled V3 zip: ${error instanceof Error ? error.message : String(error)}`)
  }
  return makeGate('synthetic-origin', 'No-recording synthetic voicebank origin evidence', path, problems, summary)
}

async function readZipText(zip, path, problems) {
  const file = zip.file(path)
  if (!file) {
    problems.push(`V3 zip is missing ${path}`)
    return null
  }
  return file.async('string')
}

async function pagesGate({ bundled, pagesUrl, pagesReport, voicebankZipPath, publicReviewManifestPath }) {
  const problems = []
  let evidence = null
  const localBytes = voicebankZipPath && existsSync(voicebankZipPath) ? readFileSync(voicebankZipPath).byteLength : null
  if (pagesReport) {
    evidence = readOptionalJson(resolve(pagesReport), 'GitHub Pages evidence', problems)
    if (evidence) {
      validatePagesEvidence(evidence, bundled, localBytes, problems)
    }
  } else if (pagesUrl) {
    evidence = await fetchPagesEvidence(pagesUrl, bundled, localBytes, publicReviewManifestPath, problems)
  } else {
    problems.push('missing GitHub Pages deployment evidence; pass --pages-url or --pages-report')
  }
  return makeGate('github-pages-v3', 'GitHub Pages loads cache-busted bundled V3 zip and review WAVs', pagesReport ? resolve(pagesReport) : pagesUrl ?? null, problems, evidence)
}

function validatePagesEvidence(evidence, bundled, localBytes, problems) {
  if (evidence.ok !== true) {
    problems.push('GitHub Pages evidence ok must be true')
  }
  if (evidence.voicebank?.file !== bundled.file) {
    problems.push(`GitHub Pages voicebank file ${evidence.voicebank?.file ?? 'missing'} does not match ${bundled.file}`)
  }
  if (evidence.voicebank?.version !== bundled.version) {
    problems.push(`GitHub Pages voicebank version ${evidence.voicebank?.version ?? 'missing'} does not match ${bundled.version}`)
  }
  if (localBytes !== null && evidence.voicebank?.bytes !== localBytes) {
    problems.push(`GitHub Pages V3 zip bytes ${evidence.voicebank?.bytes ?? 'missing'} do not match local bundled zip ${localBytes}`)
  }
  const checks = new Set(evidence.checks ?? [])
  for (const check of [
    'pages app loaded',
    'pages V3 zip cache-busted',
    'pages V3 zip bytes match local bundle',
    'pages release review hub loaded',
    'pages V3 listening review scorecard loaded',
    'pages V3 listening review download gate loaded',
    'pages V3 listening review audio loaded',
    'pages WAV DAW handoff builder loaded',
    'pages WAV DAW physical handoff path loaded',
    'pages WAV DAW starter lyric input handoff gate loaded',
  ]) {
    if (!checks.has(check)) {
      problems.push(`GitHub Pages evidence missing check: ${check}`)
    }
  }
  validateReviewAudioEvidence(evidence.reviewAudio ?? [], problems)
}

async function fetchPagesEvidence(pagesUrl, bundled, localBytes, publicReviewManifestPath, problems) {
  const base = new URL(pagesUrl)
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/'
  }
  const app = await fetchWithProblem(base, 'GitHub Pages app', problems)
  const hubUrl = new URL('review/index.html', base)
  const reviewUrl = new URL('review/v3/index.html', base)
  const handoffUrl = new URL('review/wav-daw/index.html', base)
  const zipUrl = new URL(`voicebanks/${bundled.file}`, base)
  zipUrl.searchParams.set('v', bundled.version)
  const hub = await fetchWithProblem(hubUrl, 'GitHub Pages release review hub', problems)
  const review = await fetchWithProblem(reviewUrl, 'GitHub Pages V3 listening review', problems)
  const handoff = await fetchWithProblem(handoffUrl, 'GitHub Pages WAV DAW handoff builder', problems)
  const zip = await fetchWithProblem(zipUrl, 'GitHub Pages V3 zip', problems, { method: 'HEAD' })
  const reviewAudio = await fetchReviewAudioEvidence(reviewUrl, publicReviewManifestPath, problems)
  const evidence = {
    ok: problems.length === 0,
    url: base.href,
    hubUrl: hubUrl.href,
    reviewUrl: reviewUrl.href,
    handoffUrl: handoffUrl.href,
    voicebankUrl: zipUrl.href,
    voicebank: {
      file: bundled.file,
      version: bundled.version,
      status: zip?.status ?? null,
      bytes: Number(zip?.headers.get('content-length') ?? 0),
      localBytes,
    },
    reviewAudio,
    checks: [],
  }
  if (app?.ok) {
    evidence.checks.push('pages app loaded')
  }
  if (zip?.ok) {
    evidence.checks.push('pages V3 zip cache-busted')
  }
  if (hub?.ok) {
    const html = await hub.text()
    if (
      html.includes('WebUtau Release Review Hub') &&
      html.includes('Open WebUtau app') &&
      html.includes('v3/index.html') &&
      html.includes('wav-daw/index.html') &&
      html.includes('listening-scores.local.json') &&
      html.includes('handoff-report.local.json') &&
      html.includes('release:accept-evidence')
    ) {
      evidence.checks.push('pages release review hub loaded')
    } else {
      problems.push('GitHub Pages release review hub is missing release evidence links')
    }
  }
  if (review?.ok) {
    const html = await review.text()
    evidence.checks.push('pages V3 listening review scorecard loaded')
    if (
      html.includes('problemList') &&
      html.includes('Finish every required score before downloading') &&
      html.includes('release:accept-evidence') &&
      html.includes('Downloads')
    ) {
      evidence.checks.push('pages V3 listening review download gate loaded')
    } else {
      problems.push('GitHub Pages V3 listening review is missing scorecard download gate markers')
    }
  }
  if (handoff?.ok) {
    const html = await handoff.text()
    if (
      html.includes('webuta-wav-daw-handoff-v1') &&
      html.includes('handoff-report.local.json') &&
      html.includes('release:accept-evidence') &&
      html.includes('Open WebUtau app') &&
      html.includes('Open release hub')
    ) {
      evidence.checks.push('pages WAV DAW handoff builder loaded')
    } else {
      problems.push('GitHub Pages WAV DAW handoff builder is missing release report markers')
    }
    if (html.includes('starterLyricInputVisible') && html.includes('스타터 가사 라인')) {
      evidence.checks.push('pages WAV DAW starter lyric input handoff gate loaded')
    } else {
      problems.push('GitHub Pages WAV DAW handoff builder is missing starter lyric input gate markers')
    }
    if (
      html.includes('60-second physical handoff path') &&
      html.includes('manual evidence only after real DAW import') &&
      html.includes('First-Vocal-Sketch.wav') &&
      html.includes('44.1 kHz mono 16-bit')
    ) {
      evidence.checks.push('pages WAV DAW physical handoff path loaded')
    } else {
      problems.push('GitHub Pages WAV DAW handoff builder is missing physical handoff path markers')
    }
  }
  if (reviewAudio.length >= 8 && reviewAudio.every((item) => item.status === 200 && item.bytes >= 180_000 && item.bytes === item.localBytes)) {
    evidence.checks.push('pages V3 listening review audio loaded')
  }
  if (zip?.ok && localBytes !== null && evidence.voicebank.bytes === localBytes) {
    evidence.checks.push('pages V3 zip bytes match local bundle')
  }
  if (zip?.ok && localBytes !== null && evidence.voicebank.bytes !== localBytes) {
    problems.push(`GitHub Pages V3 zip bytes ${evidence.voicebank.bytes} do not match local bundled zip ${localBytes}`)
  }
  if ((evidence.voicebank.bytes ?? 0) > 0 && evidence.voicebank.bytes < 40_000_000) {
    problems.push(`GitHub Pages V3 zip is unexpectedly small: ${evidence.voicebank.bytes} bytes`)
  }
  evidence.ok = problems.length === 0
  return evidence
}

async function fetchReviewAudioEvidence(reviewUrl, publicReviewManifestPath, problems) {
  const manifestProblems = []
  const manifest = readOptionalJson(publicReviewManifestPath, 'public V3 listening review manifest', manifestProblems)
  for (const problem of manifestProblems) {
    problems.push(problem)
  }
  if (!manifest) {
    return []
  }
  const items = publicReviewAudioItems(manifest, publicReviewManifestPath)
  const evidence = []
  for (const item of items) {
    const url = new URL(item.href, reviewUrl)
    const response = await fetchWithProblem(url, `GitHub Pages ${item.role} review audio ${item.id}`, problems, { method: 'HEAD' })
    const bytes = Number(response?.headers.get('content-length') ?? 0)
    evidence.push({
      role: item.role,
      id: item.id,
      href: item.href,
      url: url.href,
      status: response?.status ?? null,
      bytes,
      localBytes: item.localBytes,
    })
    if (response?.ok && item.localBytes !== null && bytes !== item.localBytes) {
      problems.push(`GitHub Pages ${item.role} review audio ${item.href} bytes ${bytes} do not match local file ${item.localBytes}`)
    }
    if (response?.ok && bytes < 180_000) {
      problems.push(`GitHub Pages ${item.role} review audio ${item.href} is unexpectedly small: ${bytes} bytes`)
    }
  }
  if (items.length < 8) {
    problems.push(`GitHub Pages V3 listening review audio list has ${items.length} files; expected at least 8`)
  }
  return evidence
}

function validateReviewAudioEvidence(reviewAudio, problems) {
  if (!Array.isArray(reviewAudio) || reviewAudio.length < 8) {
    problems.push('GitHub Pages evidence must include at least eight V3/V2 review audio files')
    return
  }
  for (const item of reviewAudio) {
    if (item.status !== 200) {
      problems.push(`GitHub Pages ${item.role ?? 'review'} audio ${item.href ?? item.url ?? 'missing'} returned HTTP ${item.status ?? 'missing'}`)
    }
    if (Number(item.bytes ?? 0) < 180_000) {
      problems.push(`GitHub Pages ${item.role ?? 'review'} audio ${item.href ?? item.url ?? 'missing'} is unexpectedly small: ${item.bytes ?? 'missing'} bytes`)
    }
    if (item.localBytes !== undefined && item.localBytes !== null && item.bytes !== item.localBytes) {
      problems.push(`GitHub Pages ${item.role ?? 'review'} audio ${item.href ?? item.url ?? 'missing'} bytes ${item.bytes ?? 'missing'} do not match local file ${item.localBytes}`)
    }
  }
}

function publicReviewAudioItems(manifest, publicReviewManifestPath) {
  const reviewDir = dirname(publicReviewManifestPath)
  return [
    ...audioItemsFrom(manifest.phrases ?? [], 'V3'),
    ...audioItemsFrom(manifest.comparisons ?? [], 'legacy V2'),
  ].map((item) => {
    const localPath = resolve(reviewDir, item.href)
    return {
      ...item,
      localBytes: existsSync(localPath) ? readFileSync(localPath).byteLength : null,
    }
  })
}

function audioItemsFrom(items, role) {
  return items
    .map((item, index) => ({
      role,
      id: item.id ?? `${role}-${index + 1}`,
      href: item.audioHref ?? item.wavPath,
    }))
    .filter((item) => typeof item.href === 'string' && item.href.trim().length > 0)
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
    name: readExportedString(text, 'BUNDLED_UTAU_VOICEBANK_NAME') || readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_NAME'),
    file: readExportedString(text, 'BUNDLED_UTAU_VOICEBANK_FILE') || readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_FILE'),
    version:
      readExportedString(text, 'BUNDLED_UTAU_VOICEBANK_VERSION') || readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_VERSION'),
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
    actions.push('Open the release review hub at public/review/index.html or https://midagedev.github.io/webuta/review/, then open the V3 listening scorecard at public/review/v3/index.html or https://midagedev.github.io/webuta/review/v3/ to use progress/autosave while scoring the generated V3 WAVs plus V2/V3 comparisons. Download listening-scores.local.json and handoff-report.local.json, keep both files in Downloads, then run npm run release:accept-evidence. Use explicit --scores/--handoff paths only when the files are somewhere else.')
  }
  if (problems.some((problem) => problem.includes('wav-daw-handoff'))) {
    actions.push('Run the physical-device WAV/DAW checklist in docs/WAV_DAW_QA.md, open the release review hub at public/review/index.html or https://midagedev.github.io/webuta/review/, then use public/review/wav-daw/index.html or https://midagedev.github.io/webuta/review/wav-daw/ to download handoff-report.local.json. Keep handoff-report.local.json beside listening-scores.local.json in Downloads, then accept both final JSON files with npm run release:accept-evidence.')
  }
  if (problems.some((problem) => problem.includes('public-listening-review'))) {
    actions.push('Run npm run voicebank:review-v3 and npm run voicebank:publish-review-v3 so the V3 listening review scorecard is available from GitHub Pages.')
  }
  if (problems.some((problem) => problem.includes('github-pages-v3'))) {
    actions.push('Deploy to GitHub Pages and rerun this audit with --pages-url https://midagedev.github.io/webuta/.')
  }
  if (problems.some((problem) => problem.includes('pages-default-demo'))) {
    actions.push('Run npm run voicebank:demo-v3:pages after deploying so the live app proves default V3 render, mobile layout, and WAV download behavior.')
  }
  if (problems.some((problem) => problem.includes('readme-release-docs'))) {
    actions.push('Refresh README screenshots, license notes, and limitations before public release.')
  }
  if (problems.some((problem) => problem.includes('sample-review'))) {
    actions.push('Run npm run voicebank:sample-review-v3 after regenerating V3 package, oto, pitch, loop, and listening-review evidence.')
  }
  if (problems.some((problem) => problem.includes('no-recording-workflow'))) {
    actions.push('Keep the active release commands on npm run voicebank:v3 and release:audit-utau; move recording, private-singer, TTS, or legacy generator commands under experimental: or legacy:.')
  }
  if (problems.some((problem) => problem.includes('phoneme-clarity'))) {
    actions.push('Run npm run voicebank:clarity-v3 after regenerating the V3 zip so vowel color and consonant onset evidence is current.')
  }
  if (actions.length === 0) {
    actions.push('Regenerate the failing evidence report, then rerun npm run release:audit-utau.')
  }
  return actions
}

function normalizeUrl(value) {
  try {
    const url = new URL(value)
    if (!url.pathname.endsWith('/')) {
      url.pathname += '/'
    }
    url.hash = ''
    return url.href
  } catch {
    return String(value ?? '')
  }
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
    } else if (arg === '--pages-demo-audit') {
      options.pagesDemoAudit = argv[++index]
    } else if (arg === '--listening-scores') {
      options.listeningScores = argv[++index]
    } else if (arg === '--wav-daw-handoff') {
      options.wavDawHandoff = argv[++index]
    } else if (arg === '--sample-review') {
      options.sampleReview = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-utau-community-release.mjs [options]',
          '',
          'Options:',
          '  --report path            Write release gate report JSON',
          '  --pages-url url          Verify a live GitHub Pages deployment',
          '  --pages-report path      Use saved GitHub Pages evidence JSON',
          '  --pages-demo-audit path  Override deployed browser demo audit JSON path',
          '  --listening-scores path  Override human listening score JSON path',
          '  --wav-daw-handoff path   Override physical WAV/DAW handoff JSON path',
          '  --sample-review path     Override V3 sample review report JSON path',
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
