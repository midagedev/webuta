#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MANIFEST = 'experiments/neural-singer/model-release.example.json'
const DEFAULT_REGISTRY = 'experiments/neural-singer/dataset-registry.example.json'
const PUBLIC_RELEASE_INTENTS = new Set(['public-demo', 'public-model'])
const PRIVATE_RELEASE_INTENTS = new Set(['local-research', 'private-family'])

export function auditNeuralReleaseReadiness(options = {}) {
  const manifestPath = resolve(options.manifest ?? DEFAULT_MANIFEST)
  const registryPath = resolve(options.registry ?? DEFAULT_REGISTRY)
  const manifest = readJson(manifestPath, 'release manifest')
  const registry = readJson(registryPath, 'dataset registry')
  const datasets = new Map((registry.datasets ?? []).map((dataset) => [dataset.id, dataset]))
  const evidenceProblems = []
  const qualitySummary = loadQualitySummary(manifest, evidenceProblems)
  const problems = [
    ...validateManifestShape(manifest),
    ...validateDatasetRights(manifest, datasets),
    ...evidenceProblems,
    ...validateCheckpointEvidence(manifest),
    ...validateQualityEvidence(manifest, qualitySummary),
    ...validateListeningEvidence(manifest, qualitySummary),
    ...validateBrowserEvidence(manifest),
    ...validateReleaseTerms(manifest),
  ]
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'release-ready' : 'release-blocked',
    manifestPath,
    registryPath,
    model: {
      id: manifest.model?.id ?? '(missing)',
      name: manifest.model?.name ?? '(missing)',
      releaseIntent: manifest.model?.releaseIntent ?? '(missing)',
      releaseStatus: manifest.model?.releaseStatus ?? '(missing)',
    },
    evidence: summarizeEvidence(manifest, datasets),
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
    return ['Release manifest must be a JSON object.']
  }
  if (manifest.version !== 1) {
    problems.push('Release manifest version must be 1.')
  }
  if (!manifest.model || typeof manifest.model !== 'object') {
    problems.push('Release manifest must contain a model object.')
  } else {
    for (const key of ['id', 'name', 'releaseIntent', 'releaseStatus']) {
      if (typeof manifest.model[key] !== 'string' || manifest.model[key].length === 0) {
        problems.push(`Missing model.${key}.`)
      }
    }
    if (!PRIVATE_RELEASE_INTENTS.has(manifest.model.releaseIntent) && !PUBLIC_RELEASE_INTENTS.has(manifest.model.releaseIntent)) {
      problems.push('model.releaseIntent must be local-research, private-family, public-demo, or public-model.')
    }
  }
  if (!Array.isArray(manifest.datasetIds) || manifest.datasetIds.length === 0) {
    problems.push('Release manifest must contain a non-empty datasetIds array.')
  }
  if (!manifest.evidence || typeof manifest.evidence !== 'object') {
    problems.push('Release manifest must contain an evidence object.')
  }
  if (!manifest.terms || typeof manifest.terms !== 'object') {
    problems.push('Release manifest must contain a terms object.')
  }
  return problems
}

function validateDatasetRights(manifest, datasets) {
  const problems = []
  const publicIntent = isPublicIntent(manifest)
  for (const id of manifest.datasetIds ?? []) {
    const dataset = datasets.get(id)
    if (!dataset) {
      problems.push(`Dataset ${id} is not present in the registry.`)
      continue
    }
    if (dataset.allowedActions?.localTraining !== true) {
      problems.push(`Dataset ${id} is not approved for local training.`)
    }
    if (publicIntent) {
      if (dataset.allowedActions?.publicModelRelease !== true) {
        problems.push(`Dataset ${id} is not approved for public model release.`)
      }
      if (restrictedForPublicRelease(dataset.licenseStatus)) {
        problems.push(`Dataset ${id} licenseStatus is not public-release-ready: ${dataset.licenseStatus}.`)
      }
      if (restrictedForPublicRelease(dataset.modelPublishing)) {
        problems.push(`Dataset ${id} modelPublishing is not public-release-ready: ${dataset.modelPublishing}.`)
      }
      if (restrictedForPublicRelease(dataset.redistribution)) {
        problems.push(`Dataset ${id} redistribution is not public-release-ready: ${dataset.redistribution}.`)
      }
    }
  }
  return problems
}

function loadQualitySummary(manifest, problems) {
  const qualitySummary = loadOptionalJson(manifest.evidence?.qualitySummary, 'quality summary', problems)
  if (!qualitySummary) {
    problems.push('Missing rendered quality summary evidence.')
  }
  return qualitySummary
}

function validateQualityEvidence(manifest, qualitySummary) {
  const problems = []
  if (!qualitySummary) {
    return problems
  }
  if (qualitySummary.rendered !== true) {
    problems.push('Quality summary must come from a rendered run.')
  }
  if (manifest.model?.id && qualitySummary.modelId && qualitySummary.modelId !== manifest.model.id) {
    problems.push(`Quality summary modelId ${qualitySummary.modelId} does not match manifest model id ${manifest.model.id}.`)
  }
  if ((qualitySummary.totals?.failedRenderCount ?? 1) !== 0) {
    problems.push('Quality summary contains failed renders.')
  }
  if ((qualitySummary.totals?.failedGateCount ?? 1) !== 0) {
    problems.push('Quality summary contains failed objective gates.')
  }
  if ((qualitySummary.totals?.passedGateCount ?? 0) < 1) {
    problems.push('Quality summary does not prove any passed quality gates.')
  }

  const comparisonPath = manifest.evidence?.qualityComparison
  if (comparisonPath) {
    const comparison = loadOptionalJson(comparisonPath, 'quality comparison', problems)
    if (comparison) {
      if (comparison.ok !== true || comparison.decision !== 'candidate-promote') {
        problems.push('Quality comparison did not promote the candidate.')
      }
      if (qualitySummary.runId && comparison.candidate?.runId && comparison.candidate.runId !== qualitySummary.runId) {
        problems.push(`Quality comparison candidate run ${comparison.candidate.runId} does not match quality summary run ${qualitySummary.runId}.`)
      }
      if ((comparison.totals?.blockingRegressionCount ?? 1) !== 0) {
        problems.push('Quality comparison contains blocking regressions.')
      }
    }
  } else if (isPublicIntent(manifest)) {
    problems.push('Public release requires quality comparison evidence.')
  }
  return problems
}

function validateCheckpointEvidence(manifest) {
  const problems = []
  const checkpointPath = manifest.evidence?.modelCheckpoint
  if (!checkpointPath) {
    problems.push('Missing model checkpoint audit evidence.')
    return problems
  }
  const checkpoint = loadOptionalJson(checkpointPath, 'model checkpoint audit', problems)
  if (!checkpoint) {
    return problems
  }
  if (checkpoint.ok !== true || checkpoint.decision !== 'checkpoint-ready') {
    problems.push('Model checkpoint audit evidence is not checkpoint-ready.')
  }
  if (manifest.model?.id && checkpoint.model?.id && checkpoint.model.id !== manifest.model.id) {
    problems.push(`Model checkpoint audit model id ${checkpoint.model.id} does not match manifest model id ${manifest.model.id}.`)
  }
  const checkpointDatasetIds = new Set((checkpoint.datasets ?? []).map((dataset) => dataset.id).filter(Boolean))
  for (const id of manifest.datasetIds ?? []) {
    if (!checkpointDatasetIds.has(id)) {
      problems.push(`Model checkpoint audit does not include dataset ${id}.`)
    }
  }
  const runtime = checkpoint.runtime ?? {}
  if (!runtime.exp || !runtime.checkpointPath || !runtime.vocoder) {
    problems.push('Model checkpoint audit must include runtime exp, checkpointPath, and vocoder.')
  }
  if (isNonResearchRelease(manifest) && !checkpoint.evidence?.providerDropAudit) {
    problems.push('Non-research release requires provider archive-drop evidence in the checkpoint audit.')
  }
  return problems
}

function validateListeningEvidence(manifest, qualitySummary) {
  const problems = []
  const listeningPath = manifest.evidence?.listeningScores
  if (!listeningPath) {
    if (isPublicIntent(manifest)) {
      problems.push('Public release requires human listening score evidence.')
    } else if (isNonResearchRelease(manifest)) {
      problems.push('Non-research release requires human listening score evidence.')
    }
    return problems
  }

  const listening = loadOptionalJson(listeningPath, 'listening scores', problems)
  if (!listening) {
    return problems
  }
  if (listening.version !== 1) {
    problems.push('Listening score evidence version must be 1.')
  }
  if (typeof listening.reviewer !== 'string' || listening.reviewer.trim().length === 0) {
    problems.push('Listening score evidence must include reviewer.')
  }
  if (typeof listening.reviewedAt !== 'string' || listening.reviewedAt.trim().length === 0) {
    problems.push('Listening score evidence must include reviewedAt.')
  }
  if (listening.decision !== 'pass') {
    problems.push('Listening score evidence decision must be pass.')
  }
  if (qualitySummary?.runId && listening.runId !== qualitySummary.runId) {
    problems.push(`Listening score runId ${listening.runId ?? '(missing)'} does not match quality summary run ${qualitySummary.runId}.`)
  }
  const modelId = manifest.model?.id ?? qualitySummary?.modelId
  if (modelId && listening.modelId !== modelId) {
    problems.push(`Listening score modelId ${listening.modelId ?? '(missing)'} does not match model id ${modelId}.`)
  }
  const phraseScores = Array.isArray(listening.phraseScores) ? listening.phraseScores : []
  if (phraseScores.length === 0) {
    problems.push('Listening score evidence must contain phraseScores.')
    return problems
  }

  const thresholds = qualitySummary?.thresholds ?? listening.thresholds ?? {}
  const minKoreanClarity = Number(thresholds.minListeningKoreanClarityScore ?? 0)
  const minVowelStability = Number(thresholds.minListeningVowelStabilityScore ?? 0)
  const minArtifact = Number(thresholds.minListeningArtifactScore ?? 0)
  const scoreById = new Map(phraseScores.map((score) => [score.id, score]))
  const requiredPhraseIds = new Set((qualitySummary?.results ?? []).map((result) => result.id).filter(Boolean))
  for (const id of requiredPhraseIds) {
    if (!scoreById.has(id)) {
      problems.push(`Listening score evidence is missing phrase: ${id}.`)
    }
  }

  for (const score of phraseScores) {
    const id = score.id ?? '(missing)'
    for (const [field, threshold] of [
      ['koreanClarityScore', minKoreanClarity],
      ['vowelStabilityScore', minVowelStability],
      ['artifactScore', minArtifact],
    ]) {
      const value = Number(score[field])
      if (!Number.isFinite(value)) {
        problems.push(`Listening score ${id}.${field} must be numeric.`)
      } else if (value < threshold) {
        problems.push(`Listening score ${id}.${field} ${value} is below required ${threshold}.`)
      }
    }
  }
  return problems
}

function validateBrowserEvidence(manifest) {
  const problems = []
  const smokePath = manifest.evidence?.browserSmoke
  if (!smokePath) {
    if (isPublicIntent(manifest)) {
      problems.push('Public release requires browser smoke evidence.')
    }
    return problems
  }
  const smoke = loadOptionalJson(smokePath, 'browser smoke', problems)
  if (!smoke) {
    return problems
  }
  if (smoke.ok !== true) {
    problems.push('Browser smoke report is not ok.')
  }
  if (smoke.mode !== 'local-neural') {
    problems.push('Browser smoke must run in local-neural mode for a neural model release.')
  }
  const wav = smoke.download?.wav
  if (!wav || wav.sampleRate !== 44100 || wav.channels !== 1 || wav.bitsPerSample !== 16 || wav.durationSeconds < 2) {
    problems.push('Browser smoke does not prove a DAW-ready 44.1 kHz mono 16-bit WAV download.')
  }
  const checks = new Set(smoke.checks ?? [])
  for (const check of ['desktop neural WAV download', 'render history visible', 'mobile export controls visible', 'mobile no page horizontal overflow']) {
    if (!checks.has(check)) {
      problems.push(`Browser smoke is missing required check: ${check}.`)
    }
  }
  return problems
}

function validateReleaseTerms(manifest) {
  const problems = []
  const publicIntent = isPublicIntent(manifest)
  const terms = manifest.terms ?? {}
  if (typeof terms.licenseSummary !== 'string' || terms.licenseSummary.length < 10) {
    problems.push('terms.licenseSummary must explain the model/data license state.')
  }
  if (!Array.isArray(terms.allowedUse) || terms.allowedUse.length === 0) {
    problems.push('terms.allowedUse must list allowed usage.')
  }
  if (!Array.isArray(terms.disallowedUse) || terms.disallowedUse.length === 0) {
    problems.push('terms.disallowedUse must list disallowed usage.')
  }
  if (publicIntent && !terms.publicReleaseNotes) {
    problems.push('Public release requires terms.publicReleaseNotes.')
  }
  if (publicIntent && ['local-research', 'planned'].includes(manifest.model?.releaseStatus)) {
    problems.push(`Public release cannot use model.releaseStatus=${manifest.model.releaseStatus}.`)
  }
  if (!publicIntent && !['local-research', 'private-family', 'user-provided', 'planned'].includes(manifest.model?.releaseStatus)) {
    problems.push(`Private/research release intent has unexpected model.releaseStatus=${manifest.model?.releaseStatus}.`)
  }
  return problems
}

function summarizeEvidence(manifest, datasets) {
  return {
    datasets: (manifest.datasetIds ?? []).map((id) => {
      const dataset = datasets.get(id)
      return {
        id,
        found: Boolean(dataset),
        licenseStatus: dataset?.licenseStatus ?? '(missing)',
        modelPublishing: dataset?.modelPublishing ?? '(missing)',
        allowedActions: dataset?.allowedActions ?? {},
      }
    }),
    qualitySummary: summarizePath(manifest.evidence?.qualitySummary),
    qualityComparison: summarizePath(manifest.evidence?.qualityComparison),
    modelCheckpoint: summarizePath(manifest.evidence?.modelCheckpoint),
    listeningScores: summarizePath(manifest.evidence?.listeningScores),
    browserSmoke: summarizePath(manifest.evidence?.browserSmoke),
  }
}

function nextActionsForProblems(problems) {
  if (problems.length === 0) {
    return ['Model release gate passed. Keep the report with release artifacts.']
  }
  const actions = new Set()
  for (const problem of problems) {
    if (problem.includes('public model release') || problem.includes('public-release-ready')) {
      actions.add('Review dataset/model publishing rights or keep this model private.')
    } else if (problem.includes('provider archive-drop')) {
      actions.add('Attach provider-drop audit evidence to the production checkpoint audit before release.')
    } else if (problem.includes('checkpoint')) {
      actions.add('Run npm run neural:audit-checkpoint and attach the checkpoint-ready report.')
    } else if (problem.includes('Quality')) {
      actions.add('Render the fixed phrase set and compare the candidate checkpoint before release.')
    } else if (problem.toLowerCase().includes('listening')) {
      actions.add('Fill human listening scores for the fixed phrase set before release.')
    } else if (problem.includes('Browser smoke')) {
      actions.add('Run npm run smoke:browser with --out and attach the JSON report.')
    } else if (problem.includes('terms.')) {
      actions.add('Fill out model release terms before publishing.')
    } else {
      actions.add('Fix the release manifest or referenced evidence paths.')
    }
  }
  return [...actions]
}

function loadOptionalJson(path, label, problems) {
  if (!path) {
    return null
  }
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    problems.push(`Missing ${label}: ${resolved}.`)
    return null
  }
  return readJson(resolved, label)
}

function readJson(path, label) {
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    throw new Error(`Missing ${label}: ${resolved}`)
  }
  return JSON.parse(readFileSync(resolved, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function summarizePath(path) {
  if (!path) {
    return { path: null, exists: false }
  }
  const resolved = resolve(path)
  return { path: resolved, exists: existsSync(resolved) }
}

function isPublicIntent(manifest) {
  return PUBLIC_RELEASE_INTENTS.has(manifest.model?.releaseIntent)
}

function isNonResearchRelease(manifest) {
  return manifest.model?.releaseIntent !== 'local-research' || manifest.model?.releaseStatus !== 'local-research'
}

function restrictedForPublicRelease(value) {
  return typeof value !== 'string' || /(review|required|requires|research|private|unknown|not-recorded|noncommercial|sharealike|no-commercial)/iu.test(value)
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
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-neural-release-readiness.mjs [options]',
          '',
          'Options:',
          `  --manifest path  Model release manifest, default ${DEFAULT_MANIFEST}`,
          `  --registry path  Dataset registry JSON, default ${DEFAULT_REGISTRY}`,
          '  --report path    Write JSON release readiness report',
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
    const report = auditNeuralReleaseReadiness(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
