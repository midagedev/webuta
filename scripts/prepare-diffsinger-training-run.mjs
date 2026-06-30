#!/usr/bin/env node

import * as yaml from 'js-yaml'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DIFFSINGER_ROOT = '.local/neural-singer/openvpi/DiffSinger'
const DEFAULT_PYTHON = '.local/neural-singer/mamba/envs/webuta-diffsinger/bin/python'
const DEFAULT_OUT = 'experiments/neural-singer/work/diffsinger-training-run'
const DEFAULT_LANGUAGE = 'ko'
const DEFAULT_SPEAKER = 'webuta_ko'
const DEFAULT_MAX_UPDATES = 200000
const DEFAULT_MIN_CHECKPOINT_STEP = 1000
const DEFAULT_VALIDATION_RATIO = 0.05
const DEFAULT_VOCODER = 'checkpoints/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt'
const DEFAULT_MIN_PRODUCTION_MINUTES = 30
const DEFAULT_MIN_PRODUCTION_TRAIN_ITEMS = 20
const DEFAULT_MIN_PRODUCTION_UPDATES = 50000

export function prepareDiffSingerTrainingRun(options = {}) {
  const datasetDir = resolveRequiredPath(options.datasetDir, '--dataset-dir')
  const transcriptions = resolve(options.transcriptions ?? join(datasetDir, 'transcriptions.csv'))
  const diffSingerRoot = resolve(options.diffSingerRoot ?? DEFAULT_DIFFSINGER_ROOT)
  const python = resolve(options.python ?? DEFAULT_PYTHON)
  const baseConfig = resolve(options.baseConfig ?? join(diffSingerRoot, 'configs', 'acoustic.yaml'))
  const outDir = resolve(options.out ?? DEFAULT_OUT)
  const language = options.language ?? DEFAULT_LANGUAGE
  const speaker = options.speaker ?? DEFAULT_SPEAKER
  const modelId = options.modelId ?? 'webuta-ko-neural-candidate'
  const modelName = options.modelName ?? 'WebUtau KO Neural Candidate'
  const datasetIds = normalizeList(options.datasetIds ?? options.dataset ?? [])
  const runId = options.runId ?? `${modelId}-${runStamp()}`
  const binaryDataDir = resolve(options.binaryDataDir ?? join(outDir, 'binary'))
  const trainWorkDir = resolve(options.trainWorkDir ?? join(outDir, 'train'))
  const maxUpdates = positiveInteger(options.maxUpdates, DEFAULT_MAX_UPDATES)
  const checkpointStep = positiveInteger(options.checkpointStep, maxUpdates)
  const minCheckpointStep = positiveInteger(options.minCheckpointStep, DEFAULT_MIN_CHECKPOINT_STEP)
  const accelerator = options.accelerator ?? 'gpu'
  const devices = positiveInteger(options.devices, 1)
  const precision = options.precision ?? '32-true'
  const validationRatio = ratioNumber(options.validationRatio, DEFAULT_VALIDATION_RATIO)
  const vocoder = options.vocoder ?? DEFAULT_VOCODER
  const trainingReadiness = options.trainingReadiness ? resolve(options.trainingReadiness) : null
  const providerDropAudit = options.providerDropAudit ? resolve(options.providerDropAudit) : null
  const production = Boolean(options.production)
  const minProductionMinutes = positiveNumber(options.minProductionMinutes, DEFAULT_MIN_PRODUCTION_MINUTES)
  const minProductionTrainItems = positiveInteger(options.minProductionTrainItems, DEFAULT_MIN_PRODUCTION_TRAIN_ITEMS)
  const minProductionUpdates = positiveInteger(options.minProductionUpdates, DEFAULT_MIN_PRODUCTION_UPDATES)

  assertExists(datasetDir, 'DiffSinger enhanced dataset directory')
  assertExists(transcriptions, 'DiffSinger transcriptions.csv')
  assertExists(baseConfig, 'DiffSinger acoustic base config')
  const readiness = loadTrainingReadiness(trainingReadiness, datasetIds)
  const providerDrop = loadProviderDropAudit(providerDropAudit, datasetIds)

  const entries = parseTranscriptions(readFileSync(transcriptions, 'utf8'))
  if (entries.length < 2) {
    throw new Error('DiffSinger training needs at least one train item and one validation item.')
  }
  for (const entry of entries) {
    assertExists(join(datasetDir, 'wavs', `${entry.name}.wav`), `WAV for ${entry.name}`)
  }

  const validationPrefixes = chooseValidationPrefixes(entries, {
    explicit: options.validationPrefixes,
    ratio: validationRatio,
  })
  const validationItems = entries.filter((entry) => validationPrefixes.some((prefix) => matchesPrefix(entry.name, prefix)))
  const trainItemCount = entries.length - validationItems.length
  if (validationItems.length === 0) {
    throw new Error(`No validation item matched prefixes: ${validationPrefixes.join(', ')}`)
  }
  if (validationItems.length === entries.length) {
    throw new Error('Validation prefixes match every item; DiffSinger would have an empty training set.')
  }

  const phoneCounts = countPhones(entries)
  for (const required of ['AP', 'SP']) {
    if (!phoneCounts.has(required)) {
      throw new Error(`DiffSinger training inventory must include ${required}; rerun alignment/build_dataset with silence/breath coverage.`)
    }
  }
  const preflight = productionPreflight({
    production,
    datasetIds,
    readiness,
    providerDrop,
    trainItemCount,
    maxUpdates,
    minProductionMinutes,
    minProductionTrainItems,
    minProductionUpdates,
  })

  const dictionaryPath = join(outDir, `dictionary-${language}.txt`)
  const configPath = join(outDir, 'config.yaml')
  const manifestPath = join(outDir, 'diffsinger-training.manifest.json')
  const checkpointManifestPath = join(outDir, 'model-checkpoint.template.json')
  const runbookPath = join(outDir, 'README.md')
  const checkpointPath = join(trainWorkDir, `model_ckpt_steps_${checkpointStep}.ckpt`)
  const dictionaryRows = compactDictionaryRows(phoneCounts)
  const config = trainingConfig({
    baseConfig,
    datasetDir,
    language,
    speaker,
    dictionaryPath,
    binaryDataDir,
    validationPrefixes,
    maxUpdates,
    accelerator,
    devices,
    precision,
  })

  mkdirSync(outDir, { recursive: true })
  writeFileSync(dictionaryPath, `${dictionaryRows.join('\n')}\n`)
  writeFileSync(configPath, yaml.dump(config, { lineWidth: -1, noRefs: true, sortKeys: false }))
  const manifest = {
    version: 1,
    source: 'webuta-diffsinger-training-run',
    generatedAt: new Date().toISOString(),
    runId,
    datasetIds,
    datasetDir,
    transcriptions,
    diffSingerRoot,
    python,
    baseConfig,
    config: configPath,
    dictionary: dictionaryPath,
    binaryDataDir,
    trainWorkDir,
    checkpointManifest: checkpointManifestPath,
    language,
    speaker,
    itemCount: entries.length,
    trainItemCount,
    validationItemCount: validationItems.length,
    validationItems: validationItems.map((entry) => entry.name),
    validationPrefixes,
    phoneInventoryCount: phoneCounts.size,
    phoneCounts: Object.fromEntries([...phoneCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    training: {
      maxUpdates,
      accelerator,
      devices,
      precision,
    },
    preflight,
    providerDropAudit,
    commands: trainingCommands({ diffSingerRoot, python, configPath, trainWorkDir }),
    note: 'This prepares a local DiffSinger training run. Do not publish checkpoints, generated audio, or model cards until dataset/model release terms are reviewed.',
  }
  writeJson(manifestPath, manifest)
  writeJson(
    checkpointManifestPath,
    checkpointManifest({
      modelId,
      modelName,
      datasetIds,
      runId,
      trainWorkDir,
      configPath,
      manifestPath,
      checkpointStep,
      checkpointPath,
      diffSingerRoot,
      python,
      vocoder,
      trainingReadiness,
      providerDropAudit,
      minCheckpointStep,
      productionPreflight: preflight,
    }),
  )
  writeFileSync(
    runbookPath,
    trainingRunbook({
      manifestPath,
      checkpointManifestPath,
      diffSingerRoot,
      python,
      configPath,
      trainWorkDir,
      checkpointStep,
    }),
  )

  return {
    outDir,
    config: configPath,
    dictionary: dictionaryPath,
    manifest: manifestPath,
    checkpointManifest: checkpointManifestPath,
    runbook: runbookPath,
    itemCount: entries.length,
    trainItemCount,
    validationItemCount: validationItems.length,
    phoneInventoryCount: phoneCounts.size,
    maxUpdates,
    checkpointStep,
  }
}

function trainingConfig({
  baseConfig,
  datasetDir,
  language,
  speaker,
  dictionaryPath,
  binaryDataDir,
  validationPrefixes,
  maxUpdates,
  accelerator,
  devices,
  precision,
}) {
  return {
    base_config: [baseConfig],
    dictionaries: {
      [language]: dictionaryPath,
    },
    extra_phonemes: [],
    merged_phoneme_groups: [],
    datasets: [
      {
        raw_data_dir: datasetDir,
        speaker,
        spk_id: 0,
        language,
        test_prefixes: validationPrefixes,
      },
    ],
    binary_data_dir: binaryDataDir,
    binarization_args: {
      shuffle: true,
      num_workers: 2,
    },
    pe: 'parselmouth',
    hnsep: 'world',
    use_lang_id: false,
    num_lang: 1,
    use_spk_id: false,
    num_spk: 1,
    use_mix_ln: false,
    use_energy_embed: true,
    use_breathiness_embed: false,
    use_voicing_embed: true,
    use_tension_embed: false,
    use_key_shift_embed: true,
    use_speed_embed: true,
    use_stretch_embed: false,
    use_variance_scaling: false,
    augmentation_args: {
      random_pitch_shifting: {
        enabled: true,
        range: [-2.0, 2.0],
        scale: 0.5,
      },
      fixed_pitch_shifting: {
        enabled: false,
        targets: [-5.0, 5.0],
        scale: 0.5,
      },
      random_time_stretching: {
        enabled: true,
        range: [0.9, 1.1],
        scale: 0.4,
      },
    },
    diffusion_type: 'reflow',
    use_shallow_diffusion: false,
    hidden_size: 256,
    enc_layers: 4,
    num_heads: 2,
    dropout: 0.1,
    backbone_type: 'wavenet',
    backbone_args: {
      num_layers: 20,
      num_channels: 256,
      dilation_cycle_length: 4,
    },
    T_start: 0.0,
    T_start_infer: 0.0,
    K_step: 1000,
    K_step_infer: 1000,
    sampling_steps: 20,
    optimizer_args: {
      optimizer_cls: 'torch.optim.AdamW',
      lr: 0.0004,
      betas: [0.9, 0.98],
      weight_decay: 0.0,
    },
    lr_scheduler_args: {
      scheduler_cls: 'torch.optim.lr_scheduler.StepLR',
      step_size: 50000,
      gamma: 0.75,
    },
    max_batch_frames: 80000,
    max_batch_size: 6,
    max_val_batch_frames: 80000,
    max_val_batch_size: 4,
    max_updates: maxUpdates,
    val_check_interval: Math.max(1000, Math.floor(maxUpdates / 20)),
    num_sanity_val_steps: 0,
    num_valid_plots: 4,
    val_with_vocoder: false,
    num_ckpt_keep: 5,
    permanent_ckpt_start: Math.max(1000, Math.floor(maxUpdates / 4)),
    permanent_ckpt_interval: Math.max(1000, Math.floor(maxUpdates / 4)),
    ds_workers: 2,
    dataloader_prefetch_factor: 2,
    pl_trainer_accelerator: accelerator,
    pl_trainer_devices: devices,
    pl_trainer_precision: precision,
    pl_trainer_strategy: {
      name: 'auto',
    },
    nccl_p2p: false,
  }
}

function checkpointManifest({
  modelId,
  modelName,
  datasetIds,
  runId,
  trainWorkDir,
  configPath,
  manifestPath,
  checkpointStep,
  checkpointPath,
  diffSingerRoot,
  python,
  vocoder,
  trainingReadiness,
  providerDropAudit,
  minCheckpointStep,
  productionPreflight,
}) {
  return {
    version: 1,
    notes: 'Copy/update after training. The checkpoint path must exist before neural:audit-checkpoint can pass.',
    model: {
      id: modelId,
      name: modelName,
      renderer: 'diffsinger',
      releaseStatus: 'local-research',
    },
    datasetIds,
    training: {
      framework: 'openvpi-diffsinger',
      runId,
      runDir: trainWorkDir,
      config: configPath,
      trainManifest: manifestPath,
      minCheckpointStep,
      checkpoint: {
        step: checkpointStep,
        path: checkpointPath,
      },
    },
    runtime: {
      diffSingerRoot,
      python,
      exp: trainWorkDir,
      ckpt: checkpointStep,
      vocoder,
    },
    evidence: {
      ...(trainingReadiness ? { trainingReadiness } : {}),
      ...(providerDropAudit ? { providerDropAudit } : {}),
      productionPreflight,
    },
    terms: {
      licenseSummary: 'Fill after dataset/model license review. Keep local-research until release terms are explicit.',
      allowedUse: ['Local research rendering', 'Pipeline diagnostics'],
      disallowedUse: ['Public model release until dataset/model terms are reviewed'],
    },
  }
}

function loadTrainingReadiness(path, datasetIds) {
  if (!path) {
    return null
  }
  assertExists(path, 'training readiness report')
  const readiness = readJson(path, 'training readiness report')
  if (readiness.ok !== true) {
    throw new Error(`Training readiness report is not ok: ${path}`)
  }
  if (readiness.datasetId && datasetIds.length > 0 && !datasetIds.includes(readiness.datasetId)) {
    throw new Error(`Training readiness datasetId ${readiness.datasetId} is not listed in --dataset/--dataset-ids.`)
  }
  return readiness
}

function loadProviderDropAudit(path, datasetIds) {
  if (!path) {
    return null
  }
  assertExists(path, 'provider archive-drop audit report')
  const report = readJson(path, 'provider archive-drop audit report')
  if (report.ok !== true || report.decision !== 'provider-archive-ready') {
    throw new Error(`Provider archive-drop audit is not ready: ${path}`)
  }
  if (report.datasetId && datasetIds.length > 0 && !datasetIds.includes(report.datasetId)) {
    throw new Error(`Provider archive-drop audit datasetId ${report.datasetId} is not listed in --dataset/--dataset-ids.`)
  }
  if (Number(report.metrics?.archiveCount ?? 0) <= 0) {
    throw new Error(`Provider archive-drop audit has no archives: ${path}`)
  }
  if (Number(report.metrics?.hashedArchiveCount ?? 0) < Number(report.metrics?.archiveCount ?? 0)) {
    throw new Error(`Provider archive-drop audit is missing SHA-256 hashes for some archives: ${path}`)
  }
  return report
}

function productionPreflight({
  production,
  datasetIds,
  readiness,
  providerDrop,
  trainItemCount,
  maxUpdates,
  minProductionMinutes,
  minProductionTrainItems,
  minProductionUpdates,
}) {
  const checks = [
    preflightCheck({
      id: 'dataset-id',
      label: 'Training run declares dataset lineage',
      enforced: production,
      meetsThreshold: datasetIds.length > 0,
      actual: datasetIds.length,
      threshold: 1,
    }),
    preflightCheck({
      id: 'readiness',
      label: 'Training readiness report is attached and passing',
      enforced: production,
      meetsThreshold: readiness?.ok === true,
      actual: readiness?.ok ?? false,
      threshold: true,
    }),
    preflightCheck({
      id: 'provider-drop',
      label: 'Provider archive-drop audit is attached, passing, and hash-provenanced',
      enforced: production,
      meetsThreshold:
        providerDrop?.ok === true &&
        providerDrop?.decision === 'provider-archive-ready' &&
        Number(providerDrop?.metrics?.archiveCount ?? 0) > 0 &&
        Number(providerDrop?.metrics?.hashedArchiveCount ?? 0) >= Number(providerDrop?.metrics?.archiveCount ?? 0),
      actual: providerDrop
        ? {
            decision: providerDrop.decision,
            archiveCount: providerDrop.metrics?.archiveCount ?? 0,
            hashedArchiveCount: providerDrop.metrics?.hashedArchiveCount ?? 0,
          }
        : null,
      threshold: 'provider-archive-ready with SHA-256 hashes',
    }),
    preflightCheck({
      id: 'duration',
      label: 'Readiness report has enough analyzed singing minutes',
      enforced: production,
      meetsThreshold: Number(readiness?.metrics?.totalMinutes ?? 0) >= minProductionMinutes,
      actual: Number(readiness?.metrics?.totalMinutes ?? 0),
      threshold: minProductionMinutes,
    }),
    preflightCheck({
      id: 'training-items',
      label: 'Enhanced DiffSinger dataset has enough training items',
      enforced: production,
      meetsThreshold: trainItemCount >= minProductionTrainItems,
      actual: trainItemCount,
      threshold: minProductionTrainItems,
    }),
    preflightCheck({
      id: 'updates',
      label: 'Training plan uses enough updates for a real candidate',
      enforced: production,
      meetsThreshold: maxUpdates >= minProductionUpdates,
      actual: maxUpdates,
      threshold: minProductionUpdates,
    }),
  ]
  const failed = checks.filter((check) => !check.passed)
  if (failed.length > 0) {
    throw new Error(`Production DiffSinger preflight failed: ${failed.map((check) => check.id).join(', ')}`)
  }
  return {
    production,
    passed: true,
    checks,
  }
}

function preflightCheck({ id, label, enforced, meetsThreshold, actual, threshold }) {
  return {
    id,
    label,
    enforced,
    passed: !enforced || Boolean(meetsThreshold),
    meetsThreshold: Boolean(meetsThreshold),
    actual,
    threshold,
  }
}

function parseTranscriptions(text) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim())
  const header = splitCsvLine(lines.shift() ?? '')
  const nameIndex = header.indexOf('name')
  const phSeqIndex = header.indexOf('ph_seq')
  const phDurIndex = header.indexOf('ph_dur')
  if ([nameIndex, phSeqIndex, phDurIndex].includes(-1)) {
    throw new Error('DiffSinger transcriptions.csv must include name, ph_seq, and ph_dur columns.')
  }
  return lines.map((line) => {
    const columns = splitCsvLine(line)
    const name = columns[nameIndex]?.trim()
    const phones = columns[phSeqIndex]?.trim().split(/\s+/u).filter(Boolean) ?? []
    const durations = columns[phDurIndex]?.trim().split(/\s+/u).filter(Boolean).map(Number) ?? []
    if (!name) {
      throw new Error(`Missing item name in transcriptions row: ${line}`)
    }
    if (phones.length === 0) {
      throw new Error(`Missing ph_seq for ${name}`)
    }
    if (phones.length !== durations.length) {
      throw new Error(`ph_seq/ph_dur length mismatch for ${name}: ${phones.length} vs ${durations.length}`)
    }
    if (durations.some((duration) => !Number.isFinite(duration) || duration < 0)) {
      throw new Error(`Invalid ph_dur value for ${name}`)
    }
    return {
      name,
      phones,
      durations,
    }
  })
}

function splitCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function chooseValidationPrefixes(entries, options) {
  const explicit = normalizeList(options.explicit ?? [])
  if (explicit.length > 0) {
    return explicit
  }
  const validationCount = Math.min(entries.length - 1, Math.max(1, Math.round(entries.length * options.ratio)))
  return entries.slice(-validationCount).map((entry) => entry.name)
}

function countPhones(entries) {
  const counts = new Map()
  for (const entry of entries) {
    for (const phone of entry.phones) {
      counts.set(phone, (counts.get(phone) ?? 0) + 1)
    }
  }
  return counts
}

function compactDictionaryRows(phoneCounts) {
  return [...phoneCounts.keys()]
    .filter((phone) => !['AP', 'SP'].includes(phone))
    .sort((a, b) => a.localeCompare(b))
    .map((phone, index) => `ph_${String(index + 1).padStart(4, '0')}\t${phone}`)
}

function trainingCommands({ diffSingerRoot, python, configPath, trainWorkDir }) {
  return {
    binarize: `cd ${shellQuote(diffSingerRoot)} && ${shellQuote(python)} scripts/binarize.py --config ${shellQuote(configPath)}`,
    train: `cd ${shellQuote(diffSingerRoot)} && ${shellQuote(python)} scripts/train.py --config ${shellQuote(configPath)} --exp_name ${shellQuote(trainWorkDir)} --reset`,
  }
}

function trainingRunbook({ manifestPath, checkpointManifestPath, diffSingerRoot, python, configPath, trainWorkDir, checkpointStep }) {
  const projectRoot = resolve('.')
  return [
    '# DiffSinger Training Run',
    '',
    'This folder contains local-only DiffSinger training configuration generated by WebUtau.',
    'Do not commit checkpoints, generated audio, or restricted datasets.',
    '',
    '## Train',
    '',
    '```sh',
    `cd ${shellQuote(diffSingerRoot)}`,
    `${shellQuote(python)} scripts/binarize.py --config ${shellQuote(configPath)}`,
    `${shellQuote(python)} scripts/train.py --config ${shellQuote(configPath)} --exp_name ${shellQuote(trainWorkDir)} --reset`,
    '```',
    '',
    '## After Training',
    '',
    '```sh',
    `cd ${shellQuote(projectRoot)}`,
    `npm run neural:audit-checkpoint -- --manifest ${shellQuote(checkpointManifestPath)} --report ${shellQuote(join(dirname(manifestPath), 'model-checkpoint-audit.json'))}`,
    '```',
    '',
    `The checkpoint template currently expects step ${checkpointStep}. Update it if the promoted checkpoint uses a different step.`,
    '',
  ].join('\n')
}

function matchesPrefix(name, prefix) {
  return name === prefix || name.startsWith(prefix)
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean)
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function ratioNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && number < 1 ? number : fallback
}

function runStamp() {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\..+$/u, 'Z')
}

function resolveRequiredPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required ${label} path.`)
  }
  return resolve(value)
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${label}: ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dataset-dir') {
      parsed.datasetDir = argv[++index]
    } else if (arg === '--transcriptions') {
      parsed.transcriptions = argv[++index]
    } else if (arg === '--diffsinger-root') {
      parsed.diffSingerRoot = argv[++index]
    } else if (arg === '--python') {
      parsed.python = argv[++index]
    } else if (arg === '--base-config') {
      parsed.baseConfig = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--binary-data-dir') {
      parsed.binaryDataDir = argv[++index]
    } else if (arg === '--train-work-dir') {
      parsed.trainWorkDir = argv[++index]
    } else if (arg === '--speaker') {
      parsed.speaker = argv[++index]
    } else if (arg === '--language') {
      parsed.language = argv[++index]
    } else if (arg === '--dataset') {
      parsed.dataset = argv[++index]
    } else if (arg === '--dataset-ids') {
      parsed.datasetIds = argv[++index]
    } else if (arg === '--run-id') {
      parsed.runId = argv[++index]
    } else if (arg === '--model-id') {
      parsed.modelId = argv[++index]
    } else if (arg === '--model-name') {
      parsed.modelName = argv[++index]
    } else if (arg === '--validation-prefix') {
      parsed.validationPrefixes = argv[++index]
    } else if (arg === '--validation-ratio') {
      parsed.validationRatio = Number(argv[++index])
    } else if (arg === '--max-updates') {
      parsed.maxUpdates = Number(argv[++index])
    } else if (arg === '--checkpoint-step') {
      parsed.checkpointStep = Number(argv[++index])
    } else if (arg === '--min-checkpoint-step') {
      parsed.minCheckpointStep = Number(argv[++index])
    } else if (arg === '--accelerator') {
      parsed.accelerator = argv[++index]
    } else if (arg === '--devices') {
      parsed.devices = Number(argv[++index])
    } else if (arg === '--precision') {
      parsed.precision = argv[++index]
    } else if (arg === '--vocoder') {
      parsed.vocoder = argv[++index]
    } else if (arg === '--training-readiness') {
      parsed.trainingReadiness = argv[++index]
    } else if (arg === '--provider-drop-audit') {
      parsed.providerDropAudit = argv[++index]
    } else if (arg === '--production') {
      parsed.production = true
    } else if (arg === '--min-production-minutes') {
      parsed.minProductionMinutes = Number(argv[++index])
    } else if (arg === '--min-production-train-items') {
      parsed.minProductionTrainItems = Number(argv[++index])
    } else if (arg === '--min-production-updates') {
      parsed.minProductionUpdates = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-diffsinger-training-run.mjs --dataset-dir path [options]',
          '',
          'Options:',
          '  --dataset-dir path         Enhanced DiffSinger dataset containing transcriptions.csv and wavs/',
          `  --diffsinger-root path     Local DiffSinger checkout, default ${DEFAULT_DIFFSINGER_ROOT}`,
          `  --out path                 Output run folder, default ${DEFAULT_OUT}`,
          '  --dataset id               Dataset id for generated checkpoint manifest',
          '  --training-readiness path  Passing neural:audit-readiness report',
          '  --provider-drop-audit path Passing neural:audit-provider-drop report with SHA-256 archive hashes',
          `  --max-updates n            Training updates, default ${DEFAULT_MAX_UPDATES}`,
          '  --validation-prefix value  Comma-separated validation item prefixes',
          '  --accelerator value        DiffSinger/PyTorch Lightning accelerator, default gpu',
          '  --production               Enforce production preflight gates',
          `  --min-production-minutes n Minimum analyzed minutes for --production, default ${DEFAULT_MIN_PRODUCTION_MINUTES}`,
          `  --min-production-train-items n Minimum train items for --production, default ${DEFAULT_MIN_PRODUCTION_TRAIN_ITEMS}`,
          `  --min-production-updates n Minimum updates for --production, default ${DEFAULT_MIN_PRODUCTION_UPDATES}`,
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
    const result = prepareDiffSingerTrainingRun(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
