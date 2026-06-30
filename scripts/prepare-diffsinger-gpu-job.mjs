#!/usr/bin/env node

import * as yaml from 'js-yaml'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MANIFEST = 'experiments/neural-singer/work/diffsinger-training-run/diffsinger-training.manifest.json'
const DEFAULT_REMOTE_WORK_ROOT = '~/webuta-diffsinger-runs'
const DEFAULT_REMOTE_PYTHON = 'python'

export function prepareDiffSingerGpuJob(options = {}) {
  const manifestPath = resolve(options.manifest ?? DEFAULT_MANIFEST)
  const manifest = readJson(manifestPath, 'DiffSinger training manifest')
  validateTrainingManifest(manifest, manifestPath)

  const outDir = resolve(options.out ?? join(dirname(manifestPath), 'gpu-job'))
  const checkpointManifestPath = resolveManifestPath(manifestPath, options.checkpointManifest ?? manifest.checkpointManifest)
  const checkpointManifest = checkpointManifestPath ? readJson(checkpointManifestPath, 'model checkpoint template') : null
  const providerDropAudit = resolveProviderDropAuditPath(manifestPath, manifest, checkpointManifestPath, checkpointManifest)
  const productionPreflight = manifest.preflight ?? checkpointManifest?.evidence?.productionPreflight ?? null
  validateProviderDropLineage({ providerDropAudit, productionPreflight })
  const runId = options.runId ?? manifest.runId
  const remoteWorkDir = options.remoteWorkDir ?? remoteJoin(DEFAULT_REMOTE_WORK_ROOT, sanitizeRemoteSegment(runId))
  const remoteDiffSingerRoot = options.remoteDiffSingerRoot ?? remoteJoin(remoteWorkDir, 'DiffSinger')
  const remotePython = options.remotePython ?? DEFAULT_REMOTE_PYTHON
  const remoteHost = options.remoteHost ?? ''
  const datasetDir = resolve(manifest.datasetDir)
  const configPath = resolve(manifest.config)
  const dictionaryPath = resolve(manifest.dictionary)
  const language = manifest.language ?? 'ko'
  const checkpointStep = positiveInteger(options.checkpointStep, checkpointManifest?.training?.checkpoint?.step ?? manifest.training?.maxUpdates)
  const accelerator = options.accelerator ?? 'gpu'
  const devices = positiveInteger(options.devices, manifest.training?.devices ?? 1)
  const precision = options.precision ?? manifest.training?.precision ?? '32-true'
  const maxUpdates = positiveInteger(options.maxUpdates, manifest.training?.maxUpdates)

  assertExists(configPath, 'training config')
  assertExists(dictionaryPath, 'training dictionary')
  assertExists(datasetDir, 'enhanced DiffSinger dataset')

  const localBundleDir = join(outDir, 'training')
  mkdirSync(localBundleDir, { recursive: true })

  const remoteConfigPath = join(localBundleDir, 'config.remote.yaml')
  const remoteDictionaryName = basename(dictionaryPath)
  const remoteDictionaryPath = join(localBundleDir, remoteDictionaryName)
  const remoteConfig = buildRemoteConfig({
    config: yaml.load(readFileSync(configPath, 'utf8')),
    language,
    remoteWorkDir,
    remoteDiffSingerRoot,
    remoteDictionaryName,
    accelerator,
    devices,
    precision,
    maxUpdates,
  })
  writeFileSync(remoteConfigPath, yaml.dump(remoteConfig, { lineWidth: -1, noRefs: true, sortKeys: false }))
  copyFileSync(dictionaryPath, remoteDictionaryPath)

  const uploadScript = join(outDir, 'upload-to-gpu.sh')
  const runScript = join(localBundleDir, 'run-on-gpu.sh')
  const downloadScript = join(outDir, 'download-checkpoint.sh')
  const readmePath = join(outDir, 'README.md')
  const gpuManifestPath = join(outDir, 'gpu-job.manifest.json')

  writeFileSync(
    uploadScript,
    uploadScriptText({
      remoteHost,
      remoteWorkDir,
      localBundleDir,
      datasetDir,
    }),
  )
  writeFileSync(
    runScript,
    runScriptText({
      remoteWorkDir,
      remoteDiffSingerRoot,
      remotePython,
    }),
  )
  writeFileSync(
    downloadScript,
    downloadScriptText({
      remoteHost,
      remoteWorkDir,
      checkpointStep,
      localCheckpointDir: checkpointManifest?.training?.runDir ?? manifest.trainWorkDir,
    }),
  )
  for (const script of [uploadScript, runScript, downloadScript]) {
    chmodSync(script, 0o755)
  }

  const gpuManifest = {
    version: 1,
    source: 'webuta-diffsinger-gpu-job',
    generatedAt: new Date().toISOString(),
    runId,
    trainingManifest: manifestPath,
    checkpointManifest: checkpointManifestPath,
    datasetIds: manifest.datasetIds ?? [],
    lineage: {
      providerDropAudit,
      productionPreflight,
    },
    local: {
      datasetDir,
      config: configPath,
      dictionary: dictionaryPath,
      bundleDir: outDir,
      remoteConfig: remoteConfigPath,
      remoteDictionary: remoteDictionaryPath,
      expectedCheckpointDir: checkpointManifest?.training?.runDir ?? manifest.trainWorkDir,
    },
    remote: {
      host: remoteHost || '(set WEBUTA_GPU_HOST)',
      workDir: remoteWorkDir,
      diffSingerRoot: remoteDiffSingerRoot,
      python: remotePython,
      trainDir: remoteJoin(remoteWorkDir, 'train'),
      config: remoteJoin(remoteWorkDir, 'training', 'config.remote.yaml'),
      datasetDir: remoteJoin(remoteWorkDir, 'dataset'),
      checkpointStep,
    },
    training: {
      accelerator,
      devices,
      precision,
      maxUpdates,
    },
    scripts: {
      upload: uploadScript,
      runOnGpu: runScript,
      downloadCheckpoint: downloadScript,
    },
    guards: [
      'Set WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD=1 only after the dataset license allows remote/private GPU compute.',
      'Set WEBUTA_GPU_HOST or pass --remote-host before running upload/download scripts.',
      ...(providerDropAudit
        ? [
            'Keep the provider archive-drop audit with GPU job and checkpoint promotion artifacts.',
            'Upload only enhanced datasets produced from the original archives covered by providerDropAudit.',
          ]
        : []),
      'Do not commit uploaded datasets, checkpoints, or generated remote outputs.',
    ],
  }
  writeJson(gpuManifestPath, gpuManifest)
  writeFileSync(readmePath, readmeText(gpuManifest))

  return {
    outDir,
    manifest: gpuManifestPath,
    remoteConfig: remoteConfigPath,
    uploadScript,
    runScript,
    downloadScript,
    runId,
    remoteWorkDir,
    checkpointStep,
  }
}

function validateTrainingManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`DiffSinger training manifest must be an object: ${manifestPath}`)
  }
  if (manifest.source !== 'webuta-diffsinger-training-run') {
    throw new Error(`Unsupported training manifest source: ${manifest.source}`)
  }
  for (const key of ['runId', 'datasetDir', 'config', 'dictionary', 'language', 'trainWorkDir']) {
    if (typeof manifest[key] !== 'string' || manifest[key].length === 0) {
      throw new Error(`Training manifest is missing ${key}.`)
    }
  }
  if (!Array.isArray(manifest.datasetIds) || manifest.datasetIds.length === 0) {
    throw new Error('Training manifest must declare datasetIds before preparing a GPU job.')
  }
}

function resolveProviderDropAuditPath(manifestPath, manifest, checkpointManifestPath, checkpointManifest) {
  const candidates = []
  if (typeof manifest.providerDropAudit === 'string' && manifest.providerDropAudit.length > 0) {
    candidates.push(resolveManifestPath(manifestPath, manifest.providerDropAudit))
  }
  const checkpointProviderDrop = checkpointManifest?.evidence?.providerDropAudit
  if (checkpointManifestPath && typeof checkpointProviderDrop === 'string' && checkpointProviderDrop.length > 0) {
    candidates.push(resolveManifestPath(checkpointManifestPath, checkpointProviderDrop))
  }
  const unique = [...new Set(candidates)]
  if (unique.length > 1) {
    throw new Error('Training manifest and checkpoint manifest disagree on providerDropAudit.')
  }
  return unique[0] ?? null
}

function validateProviderDropLineage({ providerDropAudit, productionPreflight }) {
  if (productionPreflight?.production === true && !providerDropAudit) {
    throw new Error('Production GPU job requires providerDropAudit from the training or checkpoint manifest.')
  }
  if (providerDropAudit) {
    assertExists(providerDropAudit, 'provider archive-drop audit report')
  }
}

function buildRemoteConfig({ config, language, remoteWorkDir, remoteDiffSingerRoot, remoteDictionaryName, accelerator, devices, precision, maxUpdates }) {
  if (!config || typeof config !== 'object') {
    throw new Error('Training config must be a YAML object.')
  }
  const datasets = Array.isArray(config.datasets) ? config.datasets : []
  if (datasets.length === 0) {
    throw new Error('Training config must contain at least one dataset.')
  }
  return {
    ...config,
    base_config: [remoteJoin(remoteDiffSingerRoot, 'configs', 'acoustic.yaml')],
    dictionaries: {
      ...(config.dictionaries ?? {}),
      [language]: remoteJoin(remoteWorkDir, 'training', remoteDictionaryName),
    },
    datasets: datasets.map((dataset, index) => ({
      ...dataset,
      raw_data_dir: index === 0 ? remoteJoin(remoteWorkDir, 'dataset') : dataset.raw_data_dir,
    })),
    binary_data_dir: remoteJoin(remoteWorkDir, 'training', 'binary'),
    max_updates: maxUpdates,
    pl_trainer_accelerator: accelerator,
    pl_trainer_devices: devices,
    pl_trainer_precision: precision,
  }
}

function uploadScriptText({ remoteHost, remoteWorkDir, localBundleDir, datasetDir }) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `REMOTE_HOST="\${WEBUTA_GPU_HOST:-${remoteHost}}"`,
    `REMOTE_WORK_DIR="\${WEBUTA_GPU_WORK_DIR:-${remoteWorkDir}}"`,
    '',
    'if [[ -z "$REMOTE_HOST" ]]; then',
    '  echo "Set WEBUTA_GPU_HOST or regenerate with --remote-host." >&2',
    '  exit 2',
    'fi',
    '',
    'if [[ "${WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD:-}" != "1" ]]; then',
    '  echo "Refusing to upload training data until WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD=1 is set after license review." >&2',
    '  exit 2',
    'fi',
    '',
    'ssh "$REMOTE_HOST" "mkdir -p ${REMOTE_WORK_DIR}/training ${REMOTE_WORK_DIR}/dataset"',
    `rsync -az --delete ${shellQuote(`${localBundleDir}/`)} "$REMOTE_HOST:$REMOTE_WORK_DIR/training/"`,
    `rsync -az --delete ${shellQuote(`${datasetDir}/`)} "$REMOTE_HOST:$REMOTE_WORK_DIR/dataset/"`,
    '',
  ].join('\n')
}

function runScriptText({ remoteWorkDir, remoteDiffSingerRoot, remotePython }) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `REMOTE_WORK_DIR="\${WEBUTA_GPU_WORK_DIR:-${remoteWorkDir}}"`,
    `DIFFSINGER_ROOT="\${WEBUTA_DIFFSINGER_ROOT:-${remoteDiffSingerRoot}}"`,
    `PYTHON="\${WEBUTA_DIFFSINGER_PYTHON:-${remotePython}}"`,
    '',
    'cd "$DIFFSINGER_ROOT"',
    '"$PYTHON" scripts/binarize.py --config "$REMOTE_WORK_DIR/training/config.remote.yaml"',
    '"$PYTHON" scripts/train.py --config "$REMOTE_WORK_DIR/training/config.remote.yaml" --exp_name "$REMOTE_WORK_DIR/train" --reset',
    '',
  ].join('\n')
}

function downloadScriptText({ remoteHost, remoteWorkDir, checkpointStep, localCheckpointDir }) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `REMOTE_HOST="\${WEBUTA_GPU_HOST:-${remoteHost}}"`,
    `REMOTE_WORK_DIR="\${WEBUTA_GPU_WORK_DIR:-${remoteWorkDir}}"`,
    '',
    'if [[ -z "$REMOTE_HOST" ]]; then',
    '  echo "Set WEBUTA_GPU_HOST or regenerate with --remote-host." >&2',
    '  exit 2',
    'fi',
    '',
    `mkdir -p ${shellQuote(localCheckpointDir)}`,
    `rsync -az "$REMOTE_HOST:$REMOTE_WORK_DIR/train/model_ckpt_steps_${checkpointStep}.ckpt" ${shellQuote(`${localCheckpointDir}/`)}`,
    '',
  ].join('\n')
}

function readmeText(manifest) {
  return [
    '# DiffSinger GPU Job Bundle',
    '',
    'This folder is a portable training launcher generated from a WebUtau DiffSinger training manifest.',
    'It does not include raw data or checkpoints in git.',
    '',
    '## Usage',
    '',
    '```sh',
    'export WEBUTA_GPU_HOST=user@gpu-host',
    'export WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD=1',
    './upload-to-gpu.sh',
    `ssh "$WEBUTA_GPU_HOST" 'bash ${manifest.remote.workDir}/training/run-on-gpu.sh'`,
    './download-checkpoint.sh',
    '```',
    '',
    'Only set `WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD=1` after confirming the dataset terms allow private remote/GPU training.',
    '',
    ...(manifest.lineage?.providerDropAudit
      ? [
          '## Dataset Provenance',
          '',
          `Provider archive-drop audit: \`${manifest.lineage.providerDropAudit}\``,
          '',
          'The remote dataset upload should correspond to the enhanced dataset produced from those audited original archives.',
          '',
        ]
      : []),
    '',
    '',
    'After the checkpoint is downloaded, update the local checkpoint manifest if needed and run:',
    '',
    '```sh',
    `npm run neural:audit-checkpoint -- --manifest ${shellQuote(manifest.checkpointManifest)}`,
    '```',
    '',
  ].join('\n')
}

function resolveManifestPath(manifestPath, value) {
  if (!value) {
    return null
  }
  return value.startsWith('/') ? resolve(value) : resolve(dirname(manifestPath), value)
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${label}: ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  if (Number.isInteger(number) && number > 0) {
    return number
  }
  if (Number.isInteger(fallback) && fallback > 0) {
    return fallback
  }
  throw new Error('A positive checkpoint/update value is required.')
}

function remoteJoin(...parts) {
  return parts
    .filter((part) => typeof part === 'string' && part.length > 0)
    .map((part, index) => (index === 0 ? part.replace(/\/+$/u, '') : part.replace(/^\/+|\/+$/gu, '')))
    .join('/')
}

function sanitizeRemoteSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/gu, '-')
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--manifest') {
      parsed.manifest = argv[++index]
    } else if (arg === '--checkpoint-manifest') {
      parsed.checkpointManifest = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--run-id') {
      parsed.runId = argv[++index]
    } else if (arg === '--remote-host') {
      parsed.remoteHost = argv[++index]
    } else if (arg === '--remote-work-dir') {
      parsed.remoteWorkDir = argv[++index]
    } else if (arg === '--remote-diffsinger-root') {
      parsed.remoteDiffSingerRoot = argv[++index]
    } else if (arg === '--remote-python') {
      parsed.remotePython = argv[++index]
    } else if (arg === '--checkpoint-step') {
      parsed.checkpointStep = Number(argv[++index])
    } else if (arg === '--accelerator') {
      parsed.accelerator = argv[++index]
    } else if (arg === '--devices') {
      parsed.devices = Number(argv[++index])
    } else if (arg === '--precision') {
      parsed.precision = argv[++index]
    } else if (arg === '--max-updates') {
      parsed.maxUpdates = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-diffsinger-gpu-job.mjs --manifest path [options]',
          '',
          'Options:',
          `  --manifest path                 Training manifest, default ${DEFAULT_MANIFEST}`,
          '  --checkpoint-manifest path      Model checkpoint template/manifest',
          '  --out path                      Output GPU job bundle directory',
          '  --remote-host user@host         Optional SSH target for generated scripts',
          `  --remote-work-dir path          Remote work dir, default ${DEFAULT_REMOTE_WORK_ROOT}/<run-id>`,
          '  --remote-diffsinger-root path   Remote DiffSinger checkout path',
          `  --remote-python path            Remote Python executable, default ${DEFAULT_REMOTE_PYTHON}`,
          '  --checkpoint-step n             Expected checkpoint step to download',
          '  --accelerator value             Remote Lightning accelerator, default gpu',
          '  --devices n                     Remote device count',
          '  --precision value               Remote Lightning precision',
          '  --max-updates n                 Override remote config max_updates',
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
    const result = prepareDiffSingerGpuJob(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
