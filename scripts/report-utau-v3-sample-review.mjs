#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULTS = {
  voicebankAudit: 'experiments/utau-v3/work/v3-voicebank-audit.json',
  otoAudit: 'experiments/utau-v3/work/v3-oto-audit.json',
  pitchAudit: 'experiments/utau-v3/work/v3-pitch-audit.json',
  loopAudit: 'experiments/utau-v3/work/v3-loop-audit.json',
  clarityAudit: 'experiments/utau-v3/work/v3-clarity-audit.json',
  listeningManifest: 'experiments/utau-v3/work/v3-listening-review/review-manifest.json',
  out: 'experiments/utau-v3/work/v3-sample-review-report.md',
  json: 'experiments/utau-v3/work/v3-sample-review-report.json',
}

const EXPECTED_DECISIONS = {
  voicebankAudit: 'v3-voicebank-audit-pass',
  otoAudit: 'v3-oto-audit-pass',
  pitchAudit: 'v3-pitch-audit-pass',
  loopAudit: 'v3-loop-audit-pass',
  clarityAudit: 'v3-clarity-audit-pass',
  listeningManifest: 'v3-listening-review-ready',
}

export function prepareUtauV3SampleReviewReport(options = {}) {
  const root = resolve(options.cwd ?? process.cwd())
  const paths = resolvePaths(root, options)
  const inputProblems = []
  const inputs = Object.fromEntries(
    Object.keys(EXPECTED_DECISIONS).map((key) => [key, readJsonInput(paths[key], key, EXPECTED_DECISIONS[key], inputProblems)]),
  )

  const hardFlags = collectHardFlags(inputs)
  const pitchWatchlist = collectPitchWatchlist(inputs.pitchAudit?.json?.pitch?.worst ?? [], Number(options.maxPitchItems ?? 8))
  const loopWatchlist = collectLoopWatchlist(inputs.loopAudit?.json?.loop?.worst ?? [], Number(options.maxLoopItems ?? 8))
  const clarityWatchlist = collectClarityWatchlist(inputs.clarityAudit?.json?.clarity, Number(options.maxClarityItems ?? 10))
  const listeningQueue = collectListeningQueue(inputs.listeningManifest?.json)
  const problems = [
    ...inputProblems,
    ...hardFlags.map((flag) => `${flag.source}: ${flag.fileName}: ${flag.problems.join('; ')}`),
  ]
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'v3-sample-review-report-ready' : 'v3-sample-review-report-needs-fix',
    noRecordingRequired: true,
    paths,
    gates: makeInputGates(inputs),
    package: summarizePackage(inputs.voicebankAudit?.json, inputs.otoAudit?.json),
    automatedDiagnostics: {
      pitch: inputs.pitchAudit?.json?.pitch?.summary ?? null,
      loop: inputs.loopAudit?.json?.loop?.summary ?? null,
      clarity: summarizeClarityDiagnostics(inputs.clarityAudit?.json?.clarity),
    },
    manualReview: {
      noRecordingRequired: true,
      hardFlagCount: hardFlags.length,
      pitchWatchlistCount: pitchWatchlist.length,
      loopWatchlistCount: loopWatchlist.length,
      clarityWatchlistCount: clarityWatchlist.length,
      listeningPhraseCount: listeningQueue.length,
      instruction:
        'Listen only to generated V3/V2 review WAVs and the listed pitch, loop, and clarity watchlist samples; do not record a new singer voice for this review.',
    },
    hardFlags,
    pitchWatchlist,
    loopWatchlist,
    clarityWatchlist,
    listeningQueue,
    problems,
    nextActions:
      problems.length === 0
        ? [
            'Use this report as the sample-level preflight for human listening review.',
            'Open experiments/utau-v3/work/v3-listening-review/index.html and fill listening-scores.local.json from real listening notes.',
          ]
        : ['Fix the flagged V3 sample diagnostics, regenerate audits, then rerun voicebank:sample-review-v3.'],
  }

  const markdown = renderMarkdown(report)
  if (options.out !== false) {
    writeText(paths.out, markdown)
  }
  if (options.json !== false) {
    writeJson(paths.json, report)
  }
  return { report, markdown }
}

function resolvePaths(root, options) {
  const paths = {}
  for (const [key, defaultPath] of Object.entries(DEFAULTS)) {
    const value = options[key] ?? defaultPath
    paths[key] = value === false ? false : resolve(root, value)
  }
  return paths
}

function readJsonInput(path, id, expectedDecision, problems) {
  if (!existsSync(path)) {
    problems.push(`${id}: missing input ${path}`)
    return { id, path, ok: false, decision: null, json: null, problems: [`missing input ${path}`] }
  }
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'))
    const gateProblems = [
      ...(json.ok === true ? [] : ['input ok must be true']),
      ...(json.decision === expectedDecision ? [] : [`decision must be ${expectedDecision}, got ${json.decision ?? 'missing'}`]),
    ]
    problems.push(...gateProblems.map((problem) => `${id}: ${problem}`))
    return {
      id,
      path,
      ok: gateProblems.length === 0,
      decision: json.decision ?? null,
      json,
      problems: gateProblems,
    }
  } catch (error) {
    const message = `invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    problems.push(`${id}: ${message}`)
    return { id, path, ok: false, decision: null, json: null, problems: [message] }
  }
}

function makeInputGates(inputs) {
  return Object.values(inputs).map((input) => ({
    id: input.id,
    path: input.path,
    passed: input.ok,
    decision: input.decision,
    problems: input.problems,
  }))
}

function summarizePackage(voicebankAudit, otoAudit) {
  return {
    name: voicebankAudit?.manifest?.name ?? otoAudit?.manifest?.name ?? null,
    profile: voicebankAudit?.manifest?.profile ?? otoAudit?.manifest?.profile ?? null,
    sampleCount: voicebankAudit?.manifest?.coverage?.sampleCount ?? otoAudit?.oto?.manifestSampleCount ?? null,
    aliasCount: voicebankAudit?.manifest?.coverage?.aliasCount ?? otoAudit?.oto?.entryCount ?? null,
    byType: voicebankAudit?.manifest?.coverage?.byType ?? otoAudit?.oto?.summary?.byType ?? null,
    byPitch: voicebankAudit?.manifest?.coverage?.byPitch ?? null,
    wavSummary: voicebankAudit?.wav?.summary ?? null,
    otoSummary: otoAudit?.oto?.summary ?? null,
  }
}

function collectHardFlags(inputs) {
  const flags = []
  const seen = new Set()
  addWorstProblems(flags, 'voicebank-wav', inputs.voicebankAudit?.json?.wav?.worst ?? [])
  addWorstProblems(flags, 'oto', inputs.otoAudit?.json?.oto?.worst ?? [])
  addWorstProblems(flags, 'pitch', [
    ...(inputs.pitchAudit?.json?.pitch?.worst ?? []),
    ...(inputs.pitchAudit?.json?.pitch?.samples ?? []),
  ], seen)
  addWorstProblems(flags, 'loop', [
    ...(inputs.loopAudit?.json?.loop?.worst ?? []),
    ...(inputs.loopAudit?.json?.loop?.samples ?? []),
  ], seen)
  addWorstProblems(flags, 'clarity-vowel', inputs.clarityAudit?.json?.clarity?.vowels?.samples ?? [], seen)
  return flags
}

function addWorstProblems(flags, source, items, seen = new Set()) {
  for (const item of items) {
    if (item?.ok === false || (Array.isArray(item?.problems) && item.problems.length > 0)) {
      const key = `${source}:${item.fileName ?? item.path ?? '(unknown)'}:${(item.problems ?? []).join('|')}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      flags.push({
        source,
        fileName: item.fileName ?? item.path ?? '(unknown)',
        alias: item.alias ?? null,
        type: item.type ?? null,
        pitch: item.pitch ?? null,
        problems: Array.isArray(item.problems) ? item.problems : ['failed audit'],
      })
    }
  }
}

function collectPitchWatchlist(items, maxItems) {
  return items.slice(0, maxItems).map((item) => ({
    source: 'pitch',
    fileName: item.fileName,
    alias: item.alias ?? null,
    type: item.type ?? null,
    pitch: item.pitch ?? null,
    medianAbsCents: round(item.metrics?.medianAbsCents),
    driftCents: round(item.metrics?.driftCents),
    medianConfidence: round(item.metrics?.medianConfidence, 4),
    reason: `largest pitch deviation: ${round(item.metrics?.medianAbsCents)} cents median, ${round(item.metrics?.driftCents)} cents drift`,
  }))
}

function collectLoopWatchlist(items, maxItems) {
  return items.slice(0, maxItems).map((item) => ({
    source: 'loop',
    fileName: item.fileName,
    alias: item.alias ?? null,
    type: item.type ?? null,
    pitch: item.pitch ?? null,
    residualRatio: round(item.metrics?.residualRatio, 4),
    seamJump: round(item.metrics?.seamJump, 4),
    loopDurationMs: round(item.metrics?.loopDurationMs),
    reason: `largest loop residual: ${round(item.metrics?.residualRatio, 4)} ratio, ${round(item.metrics?.seamJump, 4)} seam jump`,
  }))
}

function collectClarityWatchlist(clarity, maxItems) {
  const vowels = (clarity?.vowels?.worst ?? []).map((item) => ({
    source: 'clarity-vowel',
    fileName: item.fileName,
    alias: item.alias ?? null,
    vowel: item.vowel ?? null,
    pitch: item.pitch ?? null,
    formantEnergyRatio: round(item.metrics?.formantEnergyRatio, 4),
    reason: `lowest vowel formant energy ratio: ${round(item.metrics?.formantEnergyRatio, 4)}`,
  }))
  const consonants = (clarity?.consonants?.worst ?? []).map((item) => ({
    source: 'clarity-consonant',
    fileName: item.fileName,
    alias: item.alias ?? null,
    onset: item.onset ?? null,
    vowel: item.vowel ?? null,
    pitch: item.pitch ?? null,
    onsetRatio: round(item.metrics?.onsetRatio, 4),
    brightRatio: round(item.metrics?.brightRatio, 4),
    reason: `weakest consonant onset ratio: ${round(item.metrics?.onsetRatio, 4)}`,
  }))
  return [...vowels, ...consonants].slice(0, maxItems)
}

function summarizeClarityDiagnostics(clarity) {
  if (!clarity) {
    return null
  }
  return {
    vowels: {
      auditedCount: clarity.vowels?.auditedCount ?? null,
      summary: clarity.vowels?.summary ?? null,
      worst: clarity.vowels?.worst ?? [],
    },
    consonants: {
      auditedCount: clarity.consonants?.auditedCount ?? null,
      weakCount: clarity.consonants?.weakCount ?? null,
      weakRatio: clarity.consonants?.weakRatio ?? null,
      summary: clarity.consonants?.summary ?? null,
      worst: clarity.consonants?.worst ?? [],
    },
  }
}

function collectListeningQueue(manifest) {
  const comparisonsById = new Map((manifest?.comparisons ?? []).map((comparison) => [comparison.id, comparison]))
  return (manifest?.phrases ?? []).map((phrase) => {
    const comparison = comparisonsById.get(phrase.id)
    return {
      id: phrase.id,
      title: phrase.title,
      lyricLine: phrase.lyricLine,
      focus: phrase.description,
      v3WavPath: phrase.wavPath,
      legacyV2WavPath: comparison?.wavPath ?? null,
      v3DurationSeconds: round(phrase.wav?.durationSeconds, 3),
      legacyV2DurationSeconds: round(comparison?.wav?.durationSeconds, 3),
      legacyV2WarningText: comparison?.warningText ?? '',
    }
  })
}

export function renderMarkdown(report) {
  return [
    '# WebUtau Korean V3 Sample Review Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    report.ok
      ? 'Decision: `v3-sample-review-report-ready`.'
      : 'Decision: `v3-sample-review-report-needs-fix`.',
    '',
    'This report is a sample-level preflight for the bundled synthetic UTAU V3 voicebank. It does not ask anyone to record a voice and it does not replace the final human listening scorecard.',
    '',
    '## Gate Summary',
    '',
    '| Gate | Decision | Status |',
    '| --- | --- | --- |',
    ...report.gates.map((gate) => `| ${gate.id} | ${gate.decision ?? 'missing'} | ${gate.passed ? 'pass' : `fail: ${gate.problems.join('; ')}`} |`),
    '',
    '## Package Snapshot',
    '',
    `- Singer: ${report.package.name ?? 'unknown'}`,
    `- Profile: ${report.package.profile ?? 'unknown'}`,
    `- Samples: ${report.package.sampleCount ?? 'unknown'}`,
    `- Aliases: ${report.package.aliasCount ?? 'unknown'}`,
    `- By type: ${JSON.stringify(report.package.byType ?? {})}`,
    `- By pitch: ${JSON.stringify(report.package.byPitch ?? {})}`,
    '',
    '## Automated Diagnostics',
    '',
    `- WAV hard flags: ${report.hardFlags.length}`,
    `- Pitch max median error: ${formatNumber(report.automatedDiagnostics.pitch?.maxMedianAbsCents)} cents`,
    `- Pitch max drift: ${formatNumber(report.automatedDiagnostics.pitch?.maxDriftCents)} cents`,
    `- Loop max residual ratio: ${formatNumber(report.automatedDiagnostics.loop?.maxResidualRatio, 4)}`,
    `- Loop max seam jump: ${formatNumber(report.automatedDiagnostics.loop?.maxSeamJump, 4)}`,
    `- Clarity min vowel distance: ${formatNumber(report.automatedDiagnostics.clarity?.vowels?.summary?.minVowelDistance, 4)}`,
    `- Clarity weak consonant ratio: ${formatNumber(report.automatedDiagnostics.clarity?.consonants?.weakRatio, 4)}`,
    '',
    '## Hard Flags',
    '',
    report.hardFlags.length
      ? hardFlagsTable(report.hardFlags)
      : 'No hard sample failures were reported by package, oto, pitch, loop, or clarity audits.',
    '',
    '## Pitch Watchlist',
    '',
    watchlistTable(report.pitchWatchlist, ['fileName', 'alias', 'pitch', 'medianAbsCents', 'driftCents', 'medianConfidence']),
    '',
    '## Loop Watchlist',
    '',
    watchlistTable(report.loopWatchlist, ['fileName', 'alias', 'pitch', 'residualRatio', 'seamJump', 'loopDurationMs']),
    '',
    '## Clarity Watchlist',
    '',
    watchlistTable(report.clarityWatchlist, ['source', 'fileName', 'alias', 'vowel', 'onset', 'pitch', 'formantEnergyRatio', 'onsetRatio', 'brightRatio']),
    '',
    '## Listening Queue',
    '',
    '| Phrase | Lyrics | Focus | V3 WAV | Legacy V2 WAV |',
    '| --- | --- | --- | --- | --- |',
    ...report.listeningQueue.map((item) =>
      `| ${escapeTable(item.title)} | ${escapeTable(item.lyricLine)} | ${escapeTable(item.focus)} | ${escapeTable(item.v3WavPath)} | ${escapeTable(item.legacyV2WavPath ?? '')} |`,
    ),
    '',
    '## Next Actions',
    '',
    ...report.nextActions.map((action) => `- ${action}`),
    '',
  ].join('\n')
}

function hardFlagsTable(items) {
  return [
    '| Source | File | Alias | Problems |',
    '| --- | --- | --- | --- |',
    ...items.map((item) => `| ${escapeTable(item.source)} | ${escapeTable(item.fileName)} | ${escapeTable(item.alias ?? '')} | ${escapeTable(item.problems.join('; '))} |`),
  ].join('\n')
}

function watchlistTable(items, keys) {
  if (items.length === 0) {
    return 'No watchlist samples were available.'
  }
  return [
    `| ${keys.join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...items.map((item) => `| ${keys.map((key) => escapeTable(item[key] ?? '')).join(' | ')} |`),
  ].join('\n')
}

function round(value, digits = 2) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return null
  }
  const scale = 10 ** digits
  return Math.round(number * scale) / scale
}

function formatNumber(value, digits = 2) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : 'n/a'
}

function escapeTable(value) {
  return String(value).replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${value}\n`)
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--json') {
      options.json = argv[++index]
    } else if (arg === '--voicebank-audit') {
      options.voicebankAudit = argv[++index]
    } else if (arg === '--oto-audit') {
      options.otoAudit = argv[++index]
    } else if (arg === '--pitch-audit') {
      options.pitchAudit = argv[++index]
    } else if (arg === '--loop-audit') {
      options.loopAudit = argv[++index]
    } else if (arg === '--clarity-audit') {
      options.clarityAudit = argv[++index]
    } else if (arg === '--listening-manifest') {
      options.listeningManifest = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/report-utau-v3-sample-review.mjs [options]',
          '',
          'Options:',
          '  --out path                 Markdown report output',
          '  --json path                JSON report output',
          '  --voicebank-audit path     V3 voicebank audit JSON',
          '  --oto-audit path           V3 oto audit JSON',
          '  --pitch-audit path         V3 pitch audit JSON',
          '  --loop-audit path          V3 loop audit JSON',
          '  --clarity-audit path       V3 clarity audit JSON',
          '  --listening-manifest path  V3 listening review manifest JSON',
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
    const { report } = prepareUtauV3SampleReviewReport(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
