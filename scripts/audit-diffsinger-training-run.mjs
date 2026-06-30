#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_BINARY_FILES = [
  'dictionary-ko.txt',
  'train.data',
  'train.meta',
  'valid.data',
  'valid.meta',
  'spk_map.json',
  'lang_map.json',
]
const DEFAULT_MIN_ITEMS = 20
const DEFAULT_MIN_VALIDATION_ITEMS = 1
const DEFAULT_MIN_PHONE_INVENTORY = 10
const DEFAULT_MIN_BINARY_BYTES = 1
const DEFAULT_MIN_CHECKPOINT_BYTES = 1

export function auditDiffSingerTrainingRun(options = {}) {
  const trainingManifestPath = resolveRequired(options.trainingManifest, '--training-manifest')
  const enhancedDatasetAuditPath = resolveRequired(options.enhancedDatasetAudit, '--enhanced-dataset-audit')
  const trainingManifest = readJson(trainingManifestPath, 'DiffSinger training manifest')
  const enhancedDatasetAudit = readJson(enhancedDatasetAuditPath, 'enhanced DiffSinger dataset audit')
  const binaryDir = resolve(options.binaryDir ?? trainingManifest.binaryDataDir)
  const checkpointPath = options.checkpoint ? resolve(options.checkpoint) : null
  const checkpointStep = positiveInteger(options.checkpointStep, 0)
  const thresholds = {
    minItems: positiveInteger(options.minItems, DEFAULT_MIN_ITEMS),
    minValidationItems: positiveInteger(options.minValidationItems, DEFAULT_MIN_VALIDATION_ITEMS),
    minPhoneInventory: positiveInteger(options.minPhoneInventory, DEFAULT_MIN_PHONE_INVENTORY),
    minBinaryBytes: positiveInteger(options.minBinaryBytes, DEFAULT_MIN_BINARY_BYTES),
    minCheckpointBytes: positiveInteger(options.minCheckpointBytes, DEFAULT_MIN_CHECKPOINT_BYTES),
  }
  const binaryFiles = inspectBinaryFiles(binaryDir)
  const missingBinaryFiles = binaryFiles.filter((file) => !file.exists || !file.isFile || file.sizeBytes <= 0)
  const binaryBytes = binaryFiles.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0)
  const checkpoint = inspectCheckpoint(checkpointPath, checkpointStep)
  const datasetIds = normalizeDatasetIds(trainingManifest.datasetIds)
  const metrics = {
    itemCount: Number(trainingManifest.itemCount ?? 0),
    trainItemCount: Number(trainingManifest.trainItemCount ?? 0),
    validationItemCount: Number(trainingManifest.validationItemCount ?? 0),
    phoneInventoryCount: Number(trainingManifest.phoneInventoryCount ?? 0),
    enhancedItemCount: Number(enhancedDatasetAudit.metrics?.itemCount ?? 0),
    enhancedWavItemCount: Number(enhancedDatasetAudit.metrics?.wavItemCount ?? 0),
    validWavDurationSeconds: Number(enhancedDatasetAudit.metrics?.validWavDurationSeconds ?? 0),
    binaryBytes,
    checkpointStep: checkpoint.step,
    checkpointBytes: checkpoint.sizeBytes,
  }

  const gates = [
    gate({
      id: 'dataset-lineage',
      label: 'Training manifest declares dataset lineage',
      passed: datasetIds.length > 0,
      actual: datasetIds.length,
      threshold: 1,
    }),
    gate({
      id: 'enhanced-dataset-audit',
      label: 'Enhanced DiffSinger dataset audit is ready',
      passed: enhancedDatasetAudit.ok === true && enhancedDatasetAudit.decision === 'enhanced-dataset-ready',
      actual: enhancedDatasetAudit.decision ?? '(missing)',
      threshold: 'enhanced-dataset-ready',
    }),
    gate({
      id: 'split-counts',
      label: 'Training and validation splits are non-empty',
      passed:
        metrics.itemCount >= thresholds.minItems &&
        metrics.trainItemCount > 0 &&
        metrics.validationItemCount >= thresholds.minValidationItems,
      actual: {
        itemCount: metrics.itemCount,
        trainItemCount: metrics.trainItemCount,
        validationItemCount: metrics.validationItemCount,
      },
      threshold: {
        minItems: thresholds.minItems,
        minValidationItems: thresholds.minValidationItems,
      },
    }),
    gate({
      id: 'phone-inventory',
      label: 'Training manifest has a broad phone inventory with AP/SP coverage',
      passed:
        metrics.phoneInventoryCount >= thresholds.minPhoneInventory &&
        enhancedDatasetAudit.metrics?.hasAp === true &&
        enhancedDatasetAudit.metrics?.hasSp === true,
      actual: {
        phoneInventoryCount: metrics.phoneInventoryCount,
        hasAp: enhancedDatasetAudit.metrics?.hasAp === true,
        hasSp: enhancedDatasetAudit.metrics?.hasSp === true,
      },
      threshold: {
        minPhoneInventory: thresholds.minPhoneInventory,
        hasAp: true,
        hasSp: true,
      },
    }),
    gate({
      id: 'binary-files',
      label: 'DiffSinger binary dataset files exist and are non-empty',
      passed: missingBinaryFiles.length === 0 && binaryBytes >= thresholds.minBinaryBytes,
      actual: {
        missing: missingBinaryFiles.map((file) => file.name),
        binaryBytes,
      },
      threshold: {
        requiredFiles: REQUIRED_BINARY_FILES,
        minBinaryBytes: thresholds.minBinaryBytes,
      },
    }),
    gate({
      id: 'checkpoint',
      label: 'Optional smoke checkpoint exists when supplied',
      passed: !checkpointPath || (checkpoint.exists && checkpoint.isFile && checkpoint.sizeBytes >= thresholds.minCheckpointBytes),
      actual: checkpointPath
        ? {
            path: checkpointPath,
            exists: checkpoint.exists,
            sizeBytes: checkpoint.sizeBytes,
          }
        : 'not-supplied',
      threshold: checkpointPath ? { minCheckpointBytes: thresholds.minCheckpointBytes } : 'not-required',
    }),
  ]

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: gates.every((item) => item.passed),
    decision: gates.every((item) => item.passed) ? 'diffsinger-training-ready' : 'diffsinger-training-blocked',
    datasetId: datasetIds[0] ?? null,
    datasetIds,
    trainingManifest: trainingManifestPath,
    enhancedDatasetAudit: enhancedDatasetAuditPath,
    binaryDir,
    checkpoint,
    thresholds,
    metrics,
    binaryFiles,
    gates,
    nextActions: nextActionsForGates(gates),
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

function inspectBinaryFiles(binaryDir) {
  return REQUIRED_BINARY_FILES.map((name) => {
    const path = join(binaryDir, name)
    const exists = existsSync(path)
    const stats = exists ? statSync(path) : null
    return {
      name,
      path,
      exists,
      isFile: stats?.isFile() === true,
      sizeBytes: stats?.isFile() ? stats.size : 0,
    }
  })
}

function inspectCheckpoint(path, step) {
  const exists = Boolean(path && existsSync(path))
  const stats = exists ? statSync(path) : null
  return {
    path,
    step: step > 0 ? step : null,
    exists,
    isFile: stats?.isFile() === true,
    sizeBytes: stats?.isFile() ? stats.size : 0,
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
  if (failed.includes('dataset-lineage')) {
    actions.push('Regenerate the DiffSinger training manifest with datasetIds.')
  }
  if (failed.includes('enhanced-dataset-audit')) {
    actions.push('Run neural:audit-enhanced-dataset and fix the enhanced dataset before binarization.')
  }
  if (failed.includes('split-counts') || failed.includes('phone-inventory')) {
    actions.push('Regenerate the training run from a larger enhanced dataset with AP/SP phone coverage.')
  }
  if (failed.includes('binary-files')) {
    actions.push('Run DiffSinger scripts/binarize.py for this training config.')
  }
  if (failed.includes('checkpoint')) {
    actions.push('Run a one-step train smoke or update the supplied checkpoint path.')
  }
  if (actions.length === 0) {
    actions.push('Proceed to neural:audit-checkpoint for local renderer handoff evidence.')
  }
  return actions
}

function readJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function resolveRequired(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required ${label}.`)
  }
  return resolve(value)
}

function normalizeDatasetIds(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.length > 0)
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value]
  }
  return []
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--training-manifest') {
      parsed.trainingManifest = argv[++index]
    } else if (arg === '--enhanced-dataset-audit') {
      parsed.enhancedDatasetAudit = argv[++index]
    } else if (arg === '--binary-dir') {
      parsed.binaryDir = argv[++index]
    } else if (arg === '--checkpoint') {
      parsed.checkpoint = argv[++index]
    } else if (arg === '--checkpoint-step') {
      parsed.checkpointStep = Number(argv[++index])
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--min-items') {
      parsed.minItems = Number(argv[++index])
    } else if (arg === '--min-validation-items') {
      parsed.minValidationItems = Number(argv[++index])
    } else if (arg === '--min-phone-inventory') {
      parsed.minPhoneInventory = Number(argv[++index])
    } else if (arg === '--min-binary-bytes') {
      parsed.minBinaryBytes = Number(argv[++index])
    } else if (arg === '--min-checkpoint-bytes') {
      parsed.minCheckpointBytes = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-diffsinger-training-run.mjs --training-manifest path --enhanced-dataset-audit path [options]',
          '',
          'Options:',
          '  --training-manifest path       DiffSinger training manifest JSON',
          '  --enhanced-dataset-audit path  neural:audit-enhanced-dataset report',
          '  --binary-dir path              Override binary_data_dir from the manifest',
          '  --checkpoint path              Optional checkpoint to prove train.py reached a step',
          '  --checkpoint-step n            Checkpoint step number for report metadata',
          '  --report path                  Write JSON report to path',
          `  --min-items n                  Minimum training manifest item count, default ${DEFAULT_MIN_ITEMS}`,
          `  --min-validation-items n       Minimum validation item count, default ${DEFAULT_MIN_VALIDATION_ITEMS}`,
          `  --min-phone-inventory n        Minimum phone inventory count, default ${DEFAULT_MIN_PHONE_INVENTORY}`,
          `  --min-binary-bytes n           Minimum total bytes across required binary files, default ${DEFAULT_MIN_BINARY_BYTES}`,
          `  --min-checkpoint-bytes n       Minimum supplied checkpoint size, default ${DEFAULT_MIN_CHECKPOINT_BYTES}`,
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
    const report = auditDiffSingerTrainingRun(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
