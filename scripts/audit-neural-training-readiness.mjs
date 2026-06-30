#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INGEST_DIR = 'experiments/neural-singer/work/original-private-singer-ingest'
const DEFAULT_MIN_MINUTES = 30
const DEFAULT_MIN_ANNOTATED_RATIO = 0.95
const DEFAULT_MIN_UNIQUE_PHONEMES = 18
const DEFAULT_MIN_MEDIAN_RMS = 0.008
const DEFAULT_MAX_MEDIAN_RMS = 0.3
const DEFAULT_MAX_MEAN_SILENCE_RATIO = 0.55
const DEFAULT_MIN_MEAN_VOICED_RATIO = 0.3

export function auditNeuralTrainingReadiness(options = {}) {
  const ingestDir = resolve(options.ingestDir ?? DEFAULT_INGEST_DIR)
  const summaryPath = resolve(options.summary ?? join(ingestDir, 'summary.json'))
  if (!existsSync(summaryPath)) {
    throw new Error(`Missing ingest summary: ${summaryPath}`)
  }

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  const registryCheck = options.registry ? readRegistryCheck(options.registry, options.dataset ?? summary.datasetId) : null
  const thresholds = {
    minMinutes: positiveNumber(options.minMinutes, DEFAULT_MIN_MINUTES),
    minAnnotatedRatio: ratioNumber(options.minAnnotatedRatio, DEFAULT_MIN_ANNOTATED_RATIO),
    minUniquePhonemes: integerNumber(options.minUniquePhonemes, DEFAULT_MIN_UNIQUE_PHONEMES),
    minMedianRms: positiveNumber(options.minMedianRms, DEFAULT_MIN_MEDIAN_RMS),
    maxMedianRms: positiveNumber(options.maxMedianRms, DEFAULT_MAX_MEDIAN_RMS),
    maxMeanSilenceRatio: ratioNumber(options.maxMeanSilenceRatio, DEFAULT_MAX_MEAN_SILENCE_RATIO),
    minMeanVoicedRatio: ratioNumber(options.minMeanVoicedRatio, DEFAULT_MIN_MEAN_VOICED_RATIO),
  }

  const audioCount = Number(summary.files?.audioCount ?? 0)
  const annotatedFiles = Number(summary.lyricCoverage?.annotatedFiles ?? 0)
  const annotatedRatio = audioCount > 0 ? annotatedFiles / audioCount : 0
  const totalDurationSeconds = Number(summary.segments?.totalDurationSeconds ?? 0)
  const totalMinutes = totalDurationSeconds / 60
  const uniquePhonemeCount = Array.isArray(summary.lyricCoverage?.uniquePhonemes)
    ? summary.lyricCoverage.uniquePhonemes.length
    : 0
  const medianRms = finiteOrNull(summary.segments?.rms?.median)
  const meanSilenceRatio = finiteOrNull(summary.segments?.silenceRatio?.mean)
  const meanVoicedRatio = finiteOrNull(summary.segments?.voicedRatio?.mean)

  const gates = [
    gate({
      id: 'registry-local-training',
      label: 'Registry allows local training',
      passed: !registryCheck || registryCheck.allowedLocalTraining,
      actual: registryCheck?.allowedLocalTraining ?? 'not-checked',
      threshold: true,
    }),
    gate({
      id: 'duration',
      label: 'Enough known singing duration',
      passed: totalMinutes >= thresholds.minMinutes,
      actual: round(totalMinutes),
      threshold: thresholds.minMinutes,
    }),
    gate({
      id: 'annotations',
      label: 'Lyrics sidecars cover recorded files',
      passed: annotatedRatio >= thresholds.minAnnotatedRatio,
      actual: round(annotatedRatio),
      threshold: thresholds.minAnnotatedRatio,
    }),
    gate({
      id: 'phoneme-coverage',
      label: 'Korean phoneme inventory is broad enough for first training',
      passed: uniquePhonemeCount >= thresholds.minUniquePhonemes,
      actual: uniquePhonemeCount,
      threshold: thresholds.minUniquePhonemes,
    }),
    gate({
      id: 'rms-min',
      label: 'Median RMS is not too quiet',
      passed: medianRms !== null && medianRms >= thresholds.minMedianRms,
      actual: medianRms,
      threshold: thresholds.minMedianRms,
    }),
    gate({
      id: 'rms-max',
      label: 'Median RMS is not too hot',
      passed: medianRms !== null && medianRms <= thresholds.maxMedianRms,
      actual: medianRms,
      threshold: thresholds.maxMedianRms,
    }),
    gate({
      id: 'silence',
      label: 'Segments are not dominated by silence',
      passed: meanSilenceRatio !== null && meanSilenceRatio <= thresholds.maxMeanSilenceRatio,
      actual: meanSilenceRatio,
      threshold: thresholds.maxMeanSilenceRatio,
    }),
    gate({
      id: 'voiced-coverage',
      label: 'Singing has enough voiced F0 coverage',
      passed: meanVoicedRatio !== null && meanVoicedRatio >= thresholds.minMeanVoicedRatio,
      actual: meanVoicedRatio,
      threshold: thresholds.minMeanVoicedRatio,
    }),
  ]

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ingestDir,
    summaryPath,
    registry: registryCheck,
    datasetId: summary.datasetId,
    thresholds,
    metrics: {
      audioCount,
      segmentCount: Number(summary.segments?.count ?? 0),
      totalDurationSeconds,
      totalMinutes: round(totalMinutes),
      annotatedFiles,
      annotatedRatio: round(annotatedRatio),
      hangulSyllableCount: Number(summary.lyricCoverage?.hangulSyllableCount ?? 0),
      uniqueHangulSyllableCount: Array.isArray(summary.lyricCoverage?.uniqueHangulSyllables)
        ? summary.lyricCoverage.uniqueHangulSyllables.length
        : 0,
      uniquePhonemeCount,
      medianRms,
      meanSilenceRatio,
      meanVoicedRatio,
    },
    ok: gates.every((item) => item.passed),
    gates,
    nextActions: nextActionsForGates(gates),
  }

  if (options.report) {
    const reportPath = resolve(options.report)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

function readRegistryCheck(registryPath, datasetId) {
  const resolved = resolve(registryPath)
  const registry = JSON.parse(readFileSync(resolved, 'utf8'))
  const dataset = registry.datasets?.find((entry) => entry.id === datasetId)
  if (!dataset) {
    return {
      registryPath: resolved,
      datasetId,
      found: false,
      allowedLocalTraining: false,
      licenseStatus: '(missing)',
      modelPublishing: '(missing)',
    }
  }
  return {
    registryPath: resolved,
    datasetId,
    found: true,
    allowedLocalTraining: dataset.allowedActions?.localTraining === true,
    allowedPublicModelRelease: dataset.allowedActions?.publicModelRelease === true,
    licenseStatus: dataset.licenseStatus ?? '(missing)',
    modelPublishing: dataset.modelPublishing ?? '(missing)',
    singerIdentity: dataset.singerIdentity ?? '(missing)',
  }
}

function gate({ id, label, passed, actual, threshold }) {
  return {
    id,
    label,
    passed: Boolean(passed),
    actual,
    threshold,
  }
}

function nextActionsForGates(gates) {
  const failed = gates.filter((item) => !item.passed).map((item) => item.id)
  const actions = []
  if (failed.includes('registry-local-training')) {
    actions.push('Review consent and registry license fields before training.')
  }
  if (failed.includes('duration')) {
    actions.push('Record more clean single-singer Korean singing before running DiffSinger training.')
  }
  if (failed.includes('annotations') || failed.includes('phoneme-coverage')) {
    actions.push('Add or fix lyric sidecars, then rerun dataset ingest.')
  }
  if (failed.includes('rms-min') || failed.includes('rms-max') || failed.includes('silence')) {
    actions.push('Fix recording gain, trim silence, or reject noisy takes before alignment.')
  }
  if (failed.includes('voiced-coverage')) {
    actions.push('Check pitch guide, melody range, and voiced singing coverage before alignment.')
  }
  if (actions.length === 0) {
    actions.push('Proceed to OpenVPI seed preparation, MFA alignment, and DiffSinger training.')
  }
  return actions
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--ingest-dir') {
      parsed.ingestDir = argv[++index]
    } else if (arg === '--summary') {
      parsed.summary = argv[++index]
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--dataset') {
      parsed.dataset = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--min-minutes') {
      parsed.minMinutes = Number(argv[++index])
    } else if (arg === '--min-annotated-ratio') {
      parsed.minAnnotatedRatio = Number(argv[++index])
    } else if (arg === '--min-unique-phonemes') {
      parsed.minUniquePhonemes = Number(argv[++index])
    } else if (arg === '--min-median-rms') {
      parsed.minMedianRms = Number(argv[++index])
    } else if (arg === '--max-median-rms') {
      parsed.maxMedianRms = Number(argv[++index])
    } else if (arg === '--max-mean-silence-ratio') {
      parsed.maxMeanSilenceRatio = Number(argv[++index])
    } else if (arg === '--min-mean-voiced-ratio') {
      parsed.minMeanVoicedRatio = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-neural-training-readiness.mjs [options]',
          '',
          'Options:',
          `  --ingest-dir path               Ingest output dir, default ${DEFAULT_INGEST_DIR}`,
          '  --summary path                  Ingest summary JSON',
          '  --registry path                 Optional dataset registry JSON for license/local-training gate',
          '  --dataset id                    Dataset id when registry is provided',
          '  --report path                   Write JSON report to path',
          `  --min-minutes n                 Minimum known duration, default ${DEFAULT_MIN_MINUTES}`,
          `  --min-annotated-ratio n         Minimum lyric sidecar coverage, default ${DEFAULT_MIN_ANNOTATED_RATIO}`,
          `  --min-unique-phonemes n         Minimum Korean phoneme count, default ${DEFAULT_MIN_UNIQUE_PHONEMES}`,
          `  --min-median-rms n              Minimum median RMS, default ${DEFAULT_MIN_MEDIAN_RMS}`,
          `  --max-median-rms n              Maximum median RMS, default ${DEFAULT_MAX_MEDIAN_RMS}`,
          `  --max-mean-silence-ratio n      Maximum mean silence ratio, default ${DEFAULT_MAX_MEAN_SILENCE_RATIO}`,
          `  --min-mean-voiced-ratio n       Minimum mean voiced ratio, default ${DEFAULT_MIN_MEAN_VOICED_RATIO}`,
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

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function integerNumber(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function ratioNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = auditNeuralTrainingReadiness(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
