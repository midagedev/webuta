#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditMfaLabelCoverage } from './audit-mfa-label-coverage.mjs'
import { auditNeuralDatasets } from './audit-neural-datasets.mjs'
import { auditNeuralTrainingReadiness } from './audit-neural-training-readiness.mjs'
import { ingestNeuralDataset } from './ingest-neural-dataset.mjs'
import { prepareKoreanMfaDictionary } from './prepare-korean-mfa-dictionary.mjs'
import { prepareOpenVpiSeed } from './prepare-openvpi-seed.mjs'

const DEFAULT_REGISTRY = 'experiments/neural-singer/dataset-registry.example.json'
const DEFAULT_DATASET = 'csd-korean-research-baseline'
const DEFAULT_LIMIT_FILES = 10
const DEFAULT_TARGET_RATE = 16000
const DEFAULT_MIN_LOCAL_TRAINING_MINUTES = 10
const DEFAULT_MIN_MINUTES = 10
const DEFAULT_MIN_ANNOTATED_RATIO = 0.95
const DEFAULT_MIN_UNIQUE_PHONEMES = 18

export async function smokeDatasetFirstPipeline(options = {}) {
  const datasetId = options.dataset ?? DEFAULT_DATASET
  const registryPath = resolve(options.registry ?? DEFAULT_REGISTRY)
  const workDir = resolve(options.workDir ?? join('experiments/neural-singer/work/dataset-first-pipeline-smoke', `${datasetId}-${runStamp()}`))
  const ingestDir = resolve(options.ingestDir ?? join(workDir, 'ingest-slice'))
  const openVpiDir = resolve(options.openVpiDir ?? join(workDir, 'openvpi-seed'))
  const dictionaryDir = resolve(options.dictionaryDir ?? join(workDir, 'mfa-dictionary'))
  const labelAuditDir = resolve(options.labelAuditDir ?? join(workDir, 'mfa-label-audit'))
  const reportPath = options.out ? resolve(options.out) : null
  const limitFiles = positiveInteger(options.limitFiles, DEFAULT_LIMIT_FILES)
  const targetRate = positiveInteger(options.targetRate, DEFAULT_TARGET_RATE)
  const minLocalTrainingMinutes = positiveNumber(options.minLocalTrainingMinutes, DEFAULT_MIN_LOCAL_TRAINING_MINUTES)
  const minMinutes = positiveNumber(options.minMinutes, DEFAULT_MIN_MINUTES)
  const minAnnotatedRatio = ratioNumber(options.minAnnotatedRatio, DEFAULT_MIN_ANNOTATED_RATIO)
  const minUniquePhonemes = positiveInteger(options.minUniquePhonemes, DEFAULT_MIN_UNIQUE_PHONEMES)

  mkdirSync(workDir, { recursive: true })

  const datasetAudit = auditNeuralDatasets({
    registry: registryPath,
    dataset: datasetId,
    minLocalTrainingMinutes,
    minAnnotatedRatio,
  })
  if (!datasetAudit.ok) {
    throw new Error(`Dataset-first smoke audit failed: ${JSON.stringify(datasetAudit.datasets?.[0]?.problems ?? datasetAudit.problems)}`)
  }

  const ingest = ingestNeuralDataset({
    registry: registryPath,
    dataset: datasetId,
    out: ingestDir,
    targetRate,
    limitFiles,
  })
  if (ingest.summary.files.audioCount === 0) {
    throw new Error(`Dataset-first smoke found no training audio for ${datasetId}.`)
  }
  if (ingest.summary.files.skippedCount > 0) {
    throw new Error(`Dataset-first smoke skipped ${ingest.summary.files.skippedCount} audio files: ${JSON.stringify(ingest.summary.files.skipped)}`)
  }

  const readinessPath = join(workDir, 'readiness.json')
  const readiness = auditNeuralTrainingReadiness({
    ingestDir,
    registry: registryPath,
    dataset: datasetId,
    minMinutes,
    minAnnotatedRatio,
    minUniquePhonemes,
    maxMedianRms: options.maxMedianRms,
    maxMeanSilenceRatio: options.maxMeanSilenceRatio,
    minMeanVoicedRatio: options.minMeanVoicedRatio,
    report: readinessPath,
  })
  if (!readiness.ok) {
    throw new Error(`Dataset-first smoke readiness failed: ${JSON.stringify(readiness.gates.filter((gate) => !gate.passed))}`)
  }

  const openVpi = prepareOpenVpiSeed({
    ingestDir,
    out: openVpiDir,
    copyAudio: true,
  })
  if (openVpi.segmentCount !== ingest.summary.segments.count) {
    throw new Error(`OpenVPI seed segment mismatch: ${openVpi.segmentCount} vs ${ingest.summary.segments.count}`)
  }

  const dictionary = prepareKoreanMfaDictionary({
    seedDir: openVpiDir,
    out: dictionaryDir,
  })
  if (dictionary.unsupportedTokenCount > 0) {
    throw new Error(`Generated Korean MFA dictionary has unsupported tokens: ${dictionary.unsupportedTokenCount}`)
  }

  const mfaCoverage = auditMfaLabelCoverage({
    seedDir: openVpiDir,
    dictionary: dictionary.dictionary,
    out: labelAuditDir,
  })
  if (mfaCoverage.oovUniqueTokenCount > 0) {
    throw new Error(`Generated Korean MFA dictionary does not cover seed labels: ${mfaCoverage.oovUniqueTokenCount} OOV tokens.`)
  }

  const report = {
    ok: true,
    mode: 'dataset-first-pipeline',
    datasetId,
    registryPath,
    workDir,
    gates: {
      datasetAudit: {
        ok: datasetAudit.ok,
        fileCount: datasetAudit.datasets[0].audio.fileCount,
        knownDurationSeconds: datasetAudit.datasets[0].audio.knownDurationSeconds,
        annotatedRatio: datasetAudit.datasets[0].annotations.annotatedRatio,
      },
      ingest: {
        audioCount: ingest.summary.files.audioCount,
        availableAudioCount: ingest.summary.files.availableAudioCount,
        limitFiles,
        segmentCount: ingest.summary.segments.count,
        totalDurationSeconds: ingest.summary.segments.totalDurationSeconds,
        uniquePhonemes: ingest.summary.lyricCoverage.uniquePhonemes,
      },
      readiness: {
        ok: readiness.ok,
        metrics: readiness.metrics,
        reportPath: readinessPath,
      },
      openVpi: {
        segmentCount: openVpi.segmentCount,
        copiedAudio: openVpi.copiedAudio,
        outputDir: openVpi.outputDir,
      },
      mfaDictionary: {
        labFileCount: dictionary.labFileCount,
        dictionaryEntryCount: dictionary.dictionaryEntryCount,
        unsupportedTokenCount: dictionary.unsupportedTokenCount,
        phoneInventoryCount: dictionary.phoneInventoryCount,
        dictionary: dictionary.dictionary,
      },
      mfaCoverage: {
        labFileCount: mfaCoverage.labFileCount,
        coveredUniqueTokenCount: mfaCoverage.coveredUniqueTokenCount,
        oovUniqueTokenCount: mfaCoverage.oovUniqueTokenCount,
        report: mfaCoverage.report,
      },
    },
    checks: [
      'dataset registry rights and annotation gates passed',
      'dataset ingest slice created segment diagnostics',
      'training readiness gates passed',
      'OpenVPI pre-alignment seed corpus generated',
      'Korean MFA dictionary generated from seed labels',
      'MFA label coverage has no OOV tokens with generated dictionary',
    ],
    note:
      'This smoke proves the dataset-first preparation path. It is not release evidence for a public model unless the dataset/model terms are separately reviewed.',
  }
  if (reportPath) {
    writeJson(reportPath, report)
  }
  return report
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--dataset') {
      parsed.dataset = argv[++index]
    } else if (arg === '--work-dir') {
      parsed.workDir = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--limit-files') {
      parsed.limitFiles = Number(argv[++index])
    } else if (arg === '--target-rate') {
      parsed.targetRate = Number(argv[++index])
    } else if (arg === '--min-local-training-minutes') {
      parsed.minLocalTrainingMinutes = Number(argv[++index])
    } else if (arg === '--min-minutes') {
      parsed.minMinutes = Number(argv[++index])
    } else if (arg === '--min-annotated-ratio') {
      parsed.minAnnotatedRatio = Number(argv[++index])
    } else if (arg === '--min-unique-phonemes') {
      parsed.minUniquePhonemes = Number(argv[++index])
    } else if (arg === '--max-median-rms') {
      parsed.maxMedianRms = Number(argv[++index])
    } else if (arg === '--max-mean-silence-ratio') {
      parsed.maxMeanSilenceRatio = Number(argv[++index])
    } else if (arg === '--min-mean-voiced-ratio') {
      parsed.minMeanVoicedRatio = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/smoke-dataset-first-pipeline.mjs [options]',
          '',
          'Options:',
          `  --registry path                       Dataset registry JSON, default ${DEFAULT_REGISTRY}`,
          `  --dataset id                          Dataset id, default ${DEFAULT_DATASET}`,
          '  --work-dir path                       Output work directory',
          '  --out path                            Write JSON report to path',
          `  --limit-files n                       Ingest only the first n sorted audio files, default ${DEFAULT_LIMIT_FILES}`,
          `  --target-rate hz                      Ingest analysis rate, default ${DEFAULT_TARGET_RATE}`,
          `  --min-local-training-minutes minutes  Dataset audit duration gate, default ${DEFAULT_MIN_LOCAL_TRAINING_MINUTES}`,
          `  --min-minutes minutes                 Readiness duration gate, default ${DEFAULT_MIN_MINUTES}`,
          `  --min-annotated-ratio ratio           Annotation coverage gate, default ${DEFAULT_MIN_ANNOTATED_RATIO}`,
          `  --min-unique-phonemes n               Readiness phoneme gate, default ${DEFAULT_MIN_UNIQUE_PHONEMES}`,
          '  --max-median-rms value                Override readiness max-RMS gate',
          '  --max-mean-silence-ratio ratio        Override readiness silence gate',
          '  --min-mean-voiced-ratio ratio         Override readiness voiced-F0 gate',
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

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function ratioNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback
}

function runStamp() {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\..+$/u, 'Z')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await smokeDatasetFirstPipeline(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
