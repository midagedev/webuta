#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MANIFEST = 'experiments/neural-singer/model-checkpoint.example.json'
const DEFAULT_REGISTRY = 'experiments/neural-singer/dataset-registry.example.json'
const DEFAULT_MIN_CHECKPOINT_STEP = 1000

export function auditNeuralModelCheckpoint(options = {}) {
  const manifestPath = resolve(options.manifest ?? DEFAULT_MANIFEST)
  const registryPath = resolve(options.registry ?? DEFAULT_REGISTRY)
  const manifest = readJson(manifestPath, 'model checkpoint manifest')
  manifest.__manifestPath = manifestPath
  const registry = readJson(registryPath, 'dataset registry')
  const resolver = (value) => resolveManifestPath(manifestPath, value)
  const datasets = new Map((registry.datasets ?? []).map((dataset) => [dataset.id, dataset]))
  const resolved = resolveCheckpointManifest(manifest, resolver, options)
  const problems = [
    ...validateManifestShape(manifest),
    ...validateDatasetLineage(manifest, datasets),
    ...validateTrainingArtifacts(manifest, resolved),
    ...validateRuntimeArtifacts(manifest, resolved),
    ...validateReadinessEvidence(manifest, resolved),
    ...validateProviderDropEvidence(manifest, resolved),
    ...validateLicenseNotes(manifest),
  ]
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'checkpoint-ready' : 'checkpoint-blocked',
    manifestPath,
    registryPath,
    model: {
      id: manifest.model?.id ?? '(missing)',
      name: manifest.model?.name ?? '(missing)',
      renderer: manifest.model?.renderer ?? '(missing)',
      releaseStatus: manifest.model?.releaseStatus ?? '(missing)',
    },
    datasets: summarizeDatasets(manifest, datasets),
    training: summarizeTraining(manifest, resolved),
    runtime: summarizeRuntime(manifest, resolved),
    evidence: summarizeEvidence(manifest, resolved),
    problems,
    nextActions: nextActionsForProblems(problems),
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

function validateManifestShape(manifest) {
  const problems = []
  if (!manifest || typeof manifest !== 'object') {
    return ['Model checkpoint manifest must be a JSON object.']
  }
  if (manifest.version !== 1) {
    problems.push('Model checkpoint manifest version must be 1.')
  }
  if (!manifest.model || typeof manifest.model !== 'object') {
    problems.push('Manifest must contain model object.')
  } else {
    for (const key of ['id', 'name', 'renderer', 'releaseStatus']) {
      if (typeof manifest.model[key] !== 'string' || manifest.model[key].length === 0) {
        problems.push(`Missing model.${key}.`)
      }
    }
    if (manifest.model.renderer !== 'diffsinger') {
      problems.push('model.renderer must be diffsinger for this audit.')
    }
  }
  if (!Array.isArray(manifest.datasetIds) || manifest.datasetIds.length === 0) {
    problems.push('Manifest must contain a non-empty datasetIds array.')
  }
  if (!manifest.training || typeof manifest.training !== 'object') {
    problems.push('Manifest must contain training object.')
  }
  if (!manifest.runtime || typeof manifest.runtime !== 'object') {
    problems.push('Manifest must contain runtime object.')
  }
  if (!manifest.evidence || typeof manifest.evidence !== 'object') {
    problems.push('Manifest must contain evidence object.')
  }
  if (!manifest.terms || typeof manifest.terms !== 'object') {
    problems.push('Manifest must contain terms object.')
  }
  return problems
}

function validateDatasetLineage(manifest, datasets) {
  const problems = []
  for (const id of manifest.datasetIds ?? []) {
    const dataset = datasets.get(id)
    if (!dataset) {
      problems.push(`Dataset ${id} is not present in the registry.`)
      continue
    }
    if (dataset.allowedActions?.localTraining !== true) {
      problems.push(`Dataset ${id} is not approved for local training.`)
    }
  }
  return problems
}

function validateTrainingArtifacts(manifest, resolved) {
  const problems = []
  const training = manifest.training ?? {}
  if (!['openvpi-diffsinger', 'diffsinger'].includes(training.framework)) {
    problems.push('training.framework must be openvpi-diffsinger or diffsinger.')
  }
  if (!stringField(training.runId)) {
    problems.push('Missing training.runId.')
  }
  requireExistingPath(problems, 'training run directory', resolved.trainingRunDir, 'directory')
  requireExistingPath(problems, 'training config', resolved.trainingConfig, 'file')
  requireExistingPath(problems, 'checkpoint file', resolved.checkpointPath, 'file')
  if (resolved.checkpointPath && existsSync(resolved.checkpointPath) && statSync(resolved.checkpointPath).size <= 0) {
    problems.push(`Checkpoint file is empty: ${resolved.checkpointPath}.`)
  }

  const checkpointStep = resolved.checkpointStep
  if (!Number.isInteger(checkpointStep) || checkpointStep <= 0) {
    problems.push('Checkpoint step must be a positive integer.')
  }
  if (Number.isInteger(checkpointStep) && checkpointStep < resolved.minCheckpointStep) {
    problems.push(`Checkpoint step ${checkpointStep} is below required ${resolved.minCheckpointStep}.`)
  }
  if (resolved.trainManifest) {
    requireExistingPath(problems, 'training conversion manifest', resolved.trainManifest, 'file')
    const trainManifest = loadOptionalJson(resolved.trainManifest, 'training conversion manifest', problems)
    if (trainManifest) {
      if (trainManifest.trainWorkDir && resolve(trainManifest.trainWorkDir) !== resolved.trainingRunDir) {
        problems.push(`training.trainManifest trainWorkDir does not match training.runDir: ${trainManifest.trainWorkDir}.`)
      }
      if (Number(trainManifest.trainItemCount ?? 0) <= 0) {
        problems.push('training.trainManifest does not show any training items.')
      }
      if (Number(trainManifest.phoneInventoryCount ?? 0) <= 0) {
        problems.push('training.trainManifest does not show a phone inventory.')
      }
    }
  }
  return problems
}

function validateRuntimeArtifacts(manifest, resolved) {
  const problems = []
  requireExistingPath(problems, 'DiffSinger root', resolved.diffSingerRoot, 'directory')
  requireExistingPath(problems, 'DiffSinger infer.py', resolved.inferScript, 'file')
  requireExistingPath(problems, 'runtime experiment directory', resolved.runtimeExp, 'directory')
  requireExistingPath(problems, 'runtime checkpoint file', resolved.runtimeCheckpointPath, 'file')
  requireExistingPath(problems, 'vocoder checkpoint', resolved.vocoderPath, 'file')
  if (resolved.runtimeExp && resolved.trainingRunDir && resolved.runtimeExp !== resolved.trainingRunDir) {
    problems.push(`runtime.exp does not match training.runDir: ${resolved.runtimeExp}.`)
  }
  if (Number.isInteger(resolved.runtimeCkpt) && Number.isInteger(resolved.checkpointStep) && resolved.runtimeCkpt !== resolved.checkpointStep) {
    problems.push(`runtime.ckpt ${resolved.runtimeCkpt} does not match training checkpoint step ${resolved.checkpointStep}.`)
  }
  if (resolved.python) {
    requireExistingPath(problems, 'Python executable', resolved.python, 'file')
  }
  return problems
}

function validateReadinessEvidence(manifest, resolved) {
  const problems = []
  if (!resolved.trainingReadiness) {
    problems.push('Missing evidence.trainingReadiness.')
    return problems
  }
  requireExistingPath(problems, 'training readiness report', resolved.trainingReadiness, 'file')
  const readiness = loadOptionalJson(resolved.trainingReadiness, 'training readiness report', problems)
  if (!readiness) {
    return problems
  }
  if (readiness.ok !== true) {
    problems.push('Training readiness evidence is not ok.')
  }
  if (readiness.datasetId && Array.isArray(manifest.datasetIds) && !manifest.datasetIds.includes(readiness.datasetId)) {
    problems.push(`Training readiness datasetId ${readiness.datasetId} is not listed in manifest.datasetIds.`)
  }
  const failedGates = (readiness.gates ?? []).filter((gate) => gate.passed !== true)
  if (failedGates.length > 0) {
    problems.push(`Training readiness evidence has failed gates: ${failedGates.map((gate) => gate.id ?? gate.label).join(', ')}.`)
  }
  return problems
}

function validateProviderDropEvidence(manifest, resolved) {
  const problems = []
  const production = manifest.evidence?.productionPreflight?.production === true
  if (!resolved.providerDropAudit) {
    if (production) {
      problems.push('Production checkpoint evidence is missing evidence.providerDropAudit.')
    }
    return problems
  }

  requireExistingPath(problems, 'provider archive-drop audit report', resolved.providerDropAudit, 'file')
  const report = loadOptionalJson(resolved.providerDropAudit, 'provider archive-drop audit report', problems)
  if (!report) {
    return problems
  }
  if (report.ok !== true || report.decision !== 'provider-archive-ready') {
    problems.push('Provider archive-drop audit evidence is not provider-archive-ready.')
  }
  if (report.datasetId && Array.isArray(manifest.datasetIds) && !manifest.datasetIds.includes(report.datasetId)) {
    problems.push(`Provider archive-drop datasetId ${report.datasetId} is not listed in manifest.datasetIds.`)
  }
  if (Number(report.metrics?.archiveCount ?? 0) <= 0) {
    problems.push('Provider archive-drop audit evidence has no provider archives.')
  }
  if (Number(report.metrics?.hashedArchiveCount ?? 0) < Number(report.metrics?.archiveCount ?? 0)) {
    problems.push('Provider archive-drop audit evidence is missing SHA-256 hashes for some archives.')
  }
  return problems
}

function validateLicenseNotes(manifest) {
  const problems = []
  if (!stringField(manifest.terms?.licenseSummary)) {
    problems.push('Missing terms.licenseSummary.')
  }
  if (!Array.isArray(manifest.terms?.allowedUse) || manifest.terms.allowedUse.length === 0) {
    problems.push('terms.allowedUse must list allowed uses.')
  }
  if (!Array.isArray(manifest.terms?.disallowedUse) || manifest.terms.disallowedUse.length === 0) {
    problems.push('terms.disallowedUse must list disallowed uses.')
  }
  return problems
}

function resolveCheckpointManifest(manifest, resolver, options) {
  const training = manifest.training ?? {}
  const runtime = manifest.runtime ?? {}
  const checkpointStep = positiveInteger(training.checkpoint?.step ?? runtime.ckpt, 0)
  const runtimeCkpt = positiveInteger(runtime.ckpt ?? training.checkpoint?.step, 0)
  const minCheckpointStep = positiveInteger(options.minCheckpointStep ?? training.minCheckpointStep, DEFAULT_MIN_CHECKPOINT_STEP)
  const trainingRunDir = resolver(training.runDir ?? runtime.exp)
  const runtimeExp = resolver(runtime.exp ?? training.runDir)
  const checkpointPath = resolver(training.checkpoint?.path ?? join(training.runDir ?? runtime.exp ?? '.', `model_ckpt_steps_${checkpointStep}.ckpt`))
  const runtimeCheckpointPath = runtimeExp ? join(runtimeExp, `model_ckpt_steps_${runtimeCkpt}.ckpt`) : null
  const diffSingerRoot = resolver(runtime.diffSingerRoot)
  return {
    minCheckpointStep,
    checkpointStep,
    runtimeCkpt,
    trainingRunDir,
    runtimeExp,
    trainingConfig: resolver(training.config),
    trainManifest: resolver(training.trainManifest),
    checkpointPath,
    diffSingerRoot,
    inferScript: diffSingerRoot ? join(diffSingerRoot, 'scripts', 'infer.py') : null,
    python: resolver(runtime.python),
    vocoderPath: resolveVocoderPath(diffSingerRoot, runtime.vocoder),
    runtimeCheckpointPath,
    trainingReadiness: resolver(manifest.evidence?.trainingReadiness),
    providerDropAudit: resolver(manifest.evidence?.providerDropAudit),
  }
}

function resolveVocoderPath(diffSingerRoot, vocoder) {
  if (!vocoder) {
    return null
  }
  if (vocoder.startsWith('/')) {
    return resolve(vocoder)
  }
  if (existsSync(resolve(vocoder))) {
    return resolve(vocoder)
  }
  return diffSingerRoot ? resolve(diffSingerRoot, vocoder) : resolve(vocoder)
}

function summarizeDatasets(manifest, datasets) {
  return (manifest.datasetIds ?? []).map((id) => {
    const dataset = datasets.get(id)
    return {
      id,
      found: Boolean(dataset),
      localTraining: dataset?.allowedActions?.localTraining === true,
      publicModelRelease: dataset?.allowedActions?.publicModelRelease === true,
      licenseStatus: dataset?.licenseStatus ?? '(missing)',
      modelPublishing: dataset?.modelPublishing ?? '(missing)',
    }
  })
}

function summarizeTraining(manifest, resolved) {
  return {
    framework: manifest.training?.framework ?? '(missing)',
    runId: manifest.training?.runId ?? '(missing)',
    runDir: resolved.trainingRunDir,
    config: resolved.trainingConfig,
    trainManifest: resolved.trainManifest,
    checkpointStep: resolved.checkpointStep,
    minCheckpointStep: resolved.minCheckpointStep,
    checkpointPath: resolved.checkpointPath,
  }
}

function summarizeRuntime(manifest, resolved) {
  return {
    diffSingerRoot: resolved.diffSingerRoot,
    python: resolved.python,
    exp: resolved.runtimeExp,
    ckpt: resolved.runtimeCkpt,
    checkpointPath: resolved.runtimeCheckpointPath,
    vocoder: resolved.vocoderPath,
    serviceCommand: [
      'npm run neural:serve-render --',
      '--accept-local-research-license',
      manifestPathForCommand(manifest) ? `--model-manifest ${quoteArg(manifestPathForCommand(manifest))}` : '',
      resolved.diffSingerRoot ? `--diffsinger-root ${quoteArg(resolved.diffSingerRoot)}` : '',
      resolved.python ? `--python ${quoteArg(resolved.python)}` : '',
      resolved.runtimeExp ? `--exp ${quoteArg(resolved.runtimeExp)}` : '',
      Number.isInteger(resolved.runtimeCkpt) && resolved.runtimeCkpt > 0 ? `--ckpt ${resolved.runtimeCkpt}` : '',
      resolved.vocoderPath ? `--vocoder ${quoteArg(resolved.vocoderPath)}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  }
}

function summarizeEvidence(manifest, resolved) {
  return {
    trainingReadiness: resolved.trainingReadiness,
    providerDropAudit: resolved.providerDropAudit,
    qualitySummary: manifest.evidence?.qualitySummary ?? null,
    browserSmoke: manifest.evidence?.browserSmoke ?? null,
  }
}

function requireExistingPath(problems, label, path, type) {
  if (!path) {
    problems.push(`Missing ${label} path.`)
    return
  }
  if (!existsSync(path)) {
    problems.push(`Missing ${label}: ${path}.`)
    return
  }
  const stats = statSync(path)
  if (type === 'directory' && !stats.isDirectory()) {
    problems.push(`${label} is not a directory: ${path}.`)
  }
  if (type === 'file' && !stats.isFile()) {
    problems.push(`${label} is not a file: ${path}.`)
  }
}

function readJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function loadOptionalJson(path, label, problems) {
  if (!path) {
    return null
  }
  try {
    return readJson(path, label)
  } catch (error) {
    problems.push(`Could not read ${label}: ${error instanceof Error ? error.message : String(error)}.`)
    return null
  }
}

function resolveManifestPath(manifestPath, value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  if (value.startsWith('/')) {
    return resolve(value)
  }
  const cwdPath = resolve(value)
  if (existsSync(cwdPath)) {
    return cwdPath
  }
  return resolve(dirname(manifestPath), value)
}

function nextActionsForProblems(problems) {
  if (problems.length === 0) {
    return ['Checkpoint runtime gate passed. Run neural:evaluate-quality and browser smoke for release evidence.']
  }
  const joined = problems.join('\n')
  const actions = []
  if (/Dataset/u.test(joined)) {
    actions.push('Fix dataset registry lineage and local-training approval before treating this checkpoint as usable.')
  }
  if (/readiness/u.test(joined)) {
    actions.push('Attach a passing neural:audit-readiness report for the ingested training dataset.')
  }
  if (/Checkpoint|checkpoint step/u.test(joined)) {
    actions.push('Train or export the requested DiffSinger checkpoint step and update training.checkpoint/runtime.ckpt.')
  }
  if (/DiffSinger|vocoder|Python|runtime/u.test(joined)) {
    actions.push('Install or point the manifest at the DiffSinger runtime, infer.py, Python env, experiment directory, and vocoder checkpoint.')
  }
  if (/terms/u.test(joined)) {
    actions.push('Fill model/data license terms before using the checkpoint beyond local diagnostics.')
  }
  return actions.length > 0 ? actions : ['Fix the reported manifest problems and rerun the checkpoint audit.']
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function stringField(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function quoteArg(value) {
  return `'${String(value).replace(/'/gu, "'\\''")}'`
}

function manifestPathForCommand(manifest) {
  return manifest.__manifestPath ?? null
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--manifest') {
      parsed.manifest = argv[++index]
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--min-checkpoint-step') {
      parsed.minCheckpointStep = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-neural-model-checkpoint.mjs [options]',
          '',
          'Options:',
          `  --manifest path             Model checkpoint manifest, default ${DEFAULT_MANIFEST}`,
          `  --registry path             Dataset registry JSON, default ${DEFAULT_REGISTRY}`,
          '  --report path               Write JSON report to path',
          `  --min-checkpoint-step n      Override minimum checkpoint step, default ${DEFAULT_MIN_CHECKPOINT_STEP}`,
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
    const report = auditNeuralModelCheckpoint(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
