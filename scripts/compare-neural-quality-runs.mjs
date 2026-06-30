#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAX_FAILED_GATE_INCREASE = 0
const DEFAULT_MAX_MEDIAN_ABS_CENTS_REGRESSION = 15
const DEFAULT_MAX_DURATION_DELTA_REGRESSION_SECONDS = 0.05
const DEFAULT_MAX_ONSET_LAG_REGRESSION_SECONDS = 0.03
const DEFAULT_MAX_MISSING_ONSET_RATIO_REGRESSION = 0.05
const DEFAULT_MAX_CODA_SUSTAIN_BURST_INCREASE = 0
const DEFAULT_MAX_VOICED_FRAME_RATIO_DROP = 0.05
const DEFAULT_MAX_RENDER_SECONDS_MULTIPLIER = 2

const METRICS = [
  {
    id: 'failedGateCount',
    label: 'failed gates',
    direction: 'lower',
    thresholdKey: 'maxFailedGateIncrease',
    value: (result) => result.summary?.failedGates?.length ?? result.gates?.failed?.length ?? null,
    delta: (baseline, candidate) => candidate - baseline,
    passed: (delta, thresholds) => delta <= thresholds.maxFailedGateIncrease,
    blocking: true,
  },
  {
    id: 'medianAbsCents',
    label: 'median F0 cents',
    direction: 'lower',
    thresholdKey: 'maxMedianAbsCentsRegression',
    value: (result) => result.summary?.medianAbsCents ?? null,
    delta: (baseline, candidate) => candidate - baseline,
    passed: (delta, thresholds) => delta <= thresholds.maxMedianAbsCentsRegression,
    blocking: true,
  },
  {
    id: 'absDurationDeltaSeconds',
    label: 'absolute duration delta',
    direction: 'lower',
    thresholdKey: 'maxDurationDeltaRegressionSeconds',
    value: (result) => absoluteNumber(result.summary?.durationDeltaSeconds),
    delta: (baseline, candidate) => candidate - baseline,
    passed: (delta, thresholds) => delta <= thresholds.maxDurationDeltaRegressionSeconds,
    blocking: true,
  },
  {
    id: 'medianOnsetLagSeconds',
    label: 'median onset lag',
    direction: 'lower',
    thresholdKey: 'maxOnsetLagRegressionSeconds',
    value: (result) => absoluteNumber(result.summary?.medianOnsetLagSeconds),
    delta: (baseline, candidate) => candidate - baseline,
    passed: (delta, thresholds) => delta <= thresholds.maxOnsetLagRegressionSeconds,
    blocking: true,
  },
  {
    id: 'missingOnsetRatio',
    label: 'missing onset ratio',
    direction: 'lower',
    thresholdKey: 'maxMissingOnsetRatioRegression',
    value: (result) => result.summary?.missingOnsetRatio ?? null,
    delta: (baseline, candidate) => candidate - baseline,
    passed: (delta, thresholds) => delta <= thresholds.maxMissingOnsetRatioRegression,
    blocking: true,
  },
  {
    id: 'maxCodaSustainBurstCount',
    label: 'max coda sustain bursts',
    direction: 'lower',
    thresholdKey: 'maxCodaSustainBurstIncrease',
    value: (result) => result.summary?.maxCodaSustainBurstCount ?? null,
    delta: (baseline, candidate) => candidate - baseline,
    passed: (delta, thresholds) => delta <= thresholds.maxCodaSustainBurstIncrease,
    blocking: true,
  },
  {
    id: 'voicedFrameRatio',
    label: 'voiced frame ratio',
    direction: 'higher',
    thresholdKey: 'maxVoicedFrameRatioDrop',
    value: (result) => result.summary?.voicedFrameRatio ?? null,
    delta: (baseline, candidate) => candidate - baseline,
    passed: (delta, thresholds) => delta >= -thresholds.maxVoicedFrameRatioDrop,
    blocking: true,
  },
  {
    id: 'renderSeconds',
    label: 'render seconds',
    direction: 'lower',
    thresholdKey: 'maxRenderSecondsMultiplier',
    value: (result) => result.renderSeconds ?? null,
    delta: (baseline, candidate) => candidate - baseline,
    passed: (delta, thresholds, baseline, candidate) => baseline <= 0 || candidate <= baseline * thresholds.maxRenderSecondsMultiplier,
    blocking: false,
  },
]

export function compareNeuralQualityRuns(options = {}) {
  if (!options.baseline || !options.candidate) {
    throw new Error('Both --baseline and --candidate quality-summary.json paths are required.')
  }
  const baselinePath = resolve(options.baseline)
  const candidatePath = resolve(options.candidate)
  const baseline = loadSummary(baselinePath, 'baseline')
  const candidate = loadSummary(candidatePath, 'candidate')
  const thresholds = {
    maxFailedGateIncrease: nonNegativeNumber(options.maxFailedGateIncrease, DEFAULT_MAX_FAILED_GATE_INCREASE),
    maxMedianAbsCentsRegression: nonNegativeNumber(options.maxMedianAbsCentsRegression, DEFAULT_MAX_MEDIAN_ABS_CENTS_REGRESSION),
    maxDurationDeltaRegressionSeconds: nonNegativeNumber(
      options.maxDurationDeltaRegressionSeconds,
      DEFAULT_MAX_DURATION_DELTA_REGRESSION_SECONDS,
    ),
    maxOnsetLagRegressionSeconds: nonNegativeNumber(options.maxOnsetLagRegressionSeconds, DEFAULT_MAX_ONSET_LAG_REGRESSION_SECONDS),
    maxMissingOnsetRatioRegression: nonNegativeNumber(options.maxMissingOnsetRatioRegression, DEFAULT_MAX_MISSING_ONSET_RATIO_REGRESSION),
    maxCodaSustainBurstIncrease: nonNegativeNumber(options.maxCodaSustainBurstIncrease, DEFAULT_MAX_CODA_SUSTAIN_BURST_INCREASE),
    maxVoicedFrameRatioDrop: nonNegativeNumber(options.maxVoicedFrameRatioDrop, DEFAULT_MAX_VOICED_FRAME_RATIO_DROP),
    maxRenderSecondsMultiplier: positiveNumber(options.maxRenderSecondsMultiplier, DEFAULT_MAX_RENDER_SECONDS_MULTIPLIER),
  }

  const phraseComparisons = comparePhrases(baseline, candidate, thresholds)
  const totals = summarizeComparisons(phraseComparisons, candidate)
  const ok = totals.blockingRegressionCount === 0 && totals.missingCandidatePhraseCount === 0 && totals.candidateFailedGateCount === 0
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok,
    decision: ok ? 'candidate-promote' : 'candidate-hold',
    baseline: summaryHeader(baseline, baselinePath),
    candidate: summaryHeader(candidate, candidatePath),
    thresholds,
    totals,
    phraseComparisons,
  }

  if (options.out) {
    writeJson(resolve(options.out), report)
  }
  if (options.markdown) {
    writeText(resolve(options.markdown), markdownForReport(report))
  }
  return report
}

function loadSummary(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label} quality summary: ${path}`)
  }
  const summary = JSON.parse(readFileSync(path, 'utf8'))
  if (summary.version !== 1 || !Array.isArray(summary.results)) {
    throw new Error(`Unsupported ${label} quality summary: ${path}`)
  }
  if (summary.rendered !== true) {
    throw new Error(`${label} quality summary must come from a rendered run: ${path}`)
  }
  return summary
}

function comparePhrases(baseline, candidate, thresholds) {
  const candidateById = new Map(candidate.results.map((result) => [result.id, result]))
  return baseline.results.map((baselineResult) => {
    const candidateResult = candidateById.get(baselineResult.id)
    if (!candidateResult) {
      return {
        id: baselineResult.id,
        title: baselineResult.title,
        status: 'missing',
        blockingRegressions: ['candidate-phrase-missing'],
        advisories: [],
        metrics: [],
      }
    }
    if (!baselineResult.summary || !candidateResult.summary) {
      return {
        id: baselineResult.id,
        title: baselineResult.title,
        status: 'missing-diagnostics',
        blockingRegressions: ['quality-diagnostics-missing'],
        advisories: [],
        metrics: [],
      }
    }

    const metricComparisons = METRICS.map((metric) => compareMetric(metric, baselineResult, candidateResult, thresholds))
      .filter(Boolean)
    const newlyFailedGates = difference(candidateResult.summary.failedGates ?? [], baselineResult.summary.failedGates ?? [])
    const blockingRegressions = [
      ...metricComparisons.filter((metric) => metric.blocking && !metric.passed).map((metric) => metric.id),
      ...newlyFailedGates.map((gate) => `new-failed-gate:${gate}`),
    ]
    const advisories = metricComparisons.filter((metric) => !metric.blocking && !metric.passed).map((metric) => metric.id)
    const improvedCount = metricComparisons.filter((metric) => metric.change === 'improved').length
    const regressedCount = metricComparisons.filter((metric) => metric.change === 'regressed').length
    const status = blockingRegressions.length > 0 ? 'regressed' : improvedCount > regressedCount ? 'improved' : 'neutral'

    return {
      id: baselineResult.id,
      title: baselineResult.title,
      status,
      baselineOk: Boolean(baselineResult.ok && baselineResult.gates?.passed),
      candidateOk: Boolean(candidateResult.ok && candidateResult.gates?.passed),
      blockingRegressions,
      advisories,
      newlyFailedGates,
      metrics: metricComparisons,
    }
  })
}

function compareMetric(metric, baselineResult, candidateResult, thresholds) {
  const baselineValue = metric.value(baselineResult)
  const candidateValue = metric.value(candidateResult)
  if (!Number.isFinite(baselineValue) || !Number.isFinite(candidateValue)) {
    return null
  }
  const delta = metric.delta(baselineValue, candidateValue)
  const passed = metric.passed(delta, thresholds, baselineValue, candidateValue)
  return {
    id: metric.id,
    label: metric.label,
    direction: metric.direction,
    baseline: roundMetric(baselineValue),
    candidate: roundMetric(candidateValue),
    delta: roundMetric(delta),
    threshold: thresholds[metric.thresholdKey],
    passed,
    blocking: metric.blocking,
    change: classifyChange(metric.direction, delta),
  }
}

function classifyChange(direction, delta) {
  if (Math.abs(delta) < 0.000001) {
    return 'same'
  }
  if (direction === 'higher') {
    return delta > 0 ? 'improved' : 'regressed'
  }
  return delta < 0 ? 'improved' : 'regressed'
}

function summarizeComparisons(phraseComparisons, candidate) {
  const candidateFailedGateCount = candidate.results.reduce(
    (sum, result) => sum + (result.summary?.failedGates?.length ?? result.gates?.failed?.length ?? 0),
    0,
  )
  return {
    phraseCount: phraseComparisons.length,
    improvedCount: phraseComparisons.filter((item) => item.status === 'improved').length,
    neutralCount: phraseComparisons.filter((item) => item.status === 'neutral').length,
    regressedCount: phraseComparisons.filter((item) => item.status === 'regressed').length,
    missingCandidatePhraseCount: phraseComparisons.filter((item) => item.status === 'missing').length,
    missingDiagnosticsCount: phraseComparisons.filter((item) => item.status === 'missing-diagnostics').length,
    blockingRegressionCount: phraseComparisons.reduce((sum, item) => sum + item.blockingRegressions.length, 0),
    advisoryCount: phraseComparisons.reduce((sum, item) => sum + item.advisories.length, 0),
    candidateFailedGateCount,
  }
}

function summaryHeader(summary, path) {
  return {
    path,
    runId: summary.runId,
    modelId: summary.modelId,
    renderer: summary.renderer,
    generatedAt: summary.generatedAt,
    totals: summary.totals,
  }
}

function markdownForReport(report) {
  const rows = report.phraseComparisons.map((item) => {
    const metricSummary = item.metrics
      .filter((metric) => metric.blocking || !metric.passed)
      .map((metric) => `${metric.id}: ${formatSigned(metric.delta)}`)
      .join('<br>')
    return `| ${item.id} | ${item.status} | ${item.blockingRegressions.join(', ') || 'none'} | ${metricSummary || 'within tolerance'} |`
  })
  return [
    '# WebUtau Neural Quality Comparison',
    '',
    `Generated at: ${report.generatedAt}`,
    `Decision: ${report.decision}`,
    `Baseline: ${report.baseline.runId} (${report.baseline.modelId})`,
    `Candidate: ${report.candidate.runId} (${report.candidate.modelId})`,
    '',
    '## Totals',
    '',
    '```json',
    JSON.stringify(report.totals, null, 2),
    '```',
    '',
    '## Phrase Comparison',
    '',
    '| Phrase | Status | Blocking regressions | Key metric deltas |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

function difference(values, previousValues) {
  const previous = new Set(previousValues)
  return values.filter((value) => !previous.has(value))
}

function absoluteNumber(value) {
  return Number.isFinite(Number(value)) ? Math.abs(Number(value)) : null
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function roundMetric(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

function formatSigned(value) {
  if (!Number.isFinite(value)) {
    return String(value)
  }
  return value > 0 ? `+${roundMetric(value)}` : String(roundMetric(value))
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--baseline') {
      parsed.baseline = argv[++index]
    } else if (arg === '--candidate') {
      parsed.candidate = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--markdown') {
      parsed.markdown = argv[++index]
    } else if (arg === '--max-failed-gate-increase') {
      parsed.maxFailedGateIncrease = Number(argv[++index])
    } else if (arg === '--max-median-abs-cents-regression') {
      parsed.maxMedianAbsCentsRegression = Number(argv[++index])
    } else if (arg === '--max-duration-delta-regression-seconds') {
      parsed.maxDurationDeltaRegressionSeconds = Number(argv[++index])
    } else if (arg === '--max-onset-lag-regression-seconds') {
      parsed.maxOnsetLagRegressionSeconds = Number(argv[++index])
    } else if (arg === '--max-missing-onset-ratio-regression') {
      parsed.maxMissingOnsetRatioRegression = Number(argv[++index])
    } else if (arg === '--max-coda-sustain-burst-increase') {
      parsed.maxCodaSustainBurstIncrease = Number(argv[++index])
    } else if (arg === '--max-voiced-frame-ratio-drop') {
      parsed.maxVoicedFrameRatioDrop = Number(argv[++index])
    } else if (arg === '--max-render-seconds-multiplier') {
      parsed.maxRenderSecondsMultiplier = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/compare-neural-quality-runs.mjs --baseline path --candidate path [options]',
          '',
          'Options:',
          '  --out path                                      Write JSON comparison report',
          '  --markdown path                                 Write Markdown comparison report',
          `  --max-failed-gate-increase n                     Default ${DEFAULT_MAX_FAILED_GATE_INCREASE}`,
          `  --max-median-abs-cents-regression n              Default ${DEFAULT_MAX_MEDIAN_ABS_CENTS_REGRESSION}`,
          `  --max-duration-delta-regression-seconds n        Default ${DEFAULT_MAX_DURATION_DELTA_REGRESSION_SECONDS}`,
          `  --max-onset-lag-regression-seconds n             Default ${DEFAULT_MAX_ONSET_LAG_REGRESSION_SECONDS}`,
          `  --max-missing-onset-ratio-regression n           Default ${DEFAULT_MAX_MISSING_ONSET_RATIO_REGRESSION}`,
          `  --max-coda-sustain-burst-increase n              Default ${DEFAULT_MAX_CODA_SUSTAIN_BURST_INCREASE}`,
          `  --max-voiced-frame-ratio-drop n                  Default ${DEFAULT_MAX_VOICED_FRAME_RATIO_DROP}`,
          `  --max-render-seconds-multiplier n                Default ${DEFAULT_MAX_RENDER_SECONDS_MULTIPLIER}`,
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
    const report = compareNeuralQualityRuns(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
