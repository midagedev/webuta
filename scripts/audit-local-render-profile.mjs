#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PROFILE = 'experiments/neural-singer/work/promoted-local-neural-model/local-render-profile.json'

export function auditLocalRenderProfile(options = {}) {
  const profilePath = resolve(options.profile ?? DEFAULT_PROFILE)
  const profile = readJson(profilePath, 'local render profile')
  const resolver = (value) => resolveProfilePath(profilePath, value)
  const checkpointAuditPath = resolver(profile.checkpointAudit)
  const checkpointManifestPath = resolver(profile.checkpointManifest)
  const serviceScriptPath = resolver(profile.service?.script)
  const envPath = resolver(profile.vite?.envFile)
  const releaseManifestPath = resolver(options.releaseManifest ?? 'model-release.local-template.json')
  const browserSmokePath = options.browserSmoke ? resolve(options.browserSmoke) : null

  const checkpointAudit = loadOptionalJson(checkpointAuditPath)
  const checkpointManifest = loadOptionalJson(checkpointManifestPath)
  const releaseManifest = loadOptionalJson(releaseManifestPath)
  const browserSmoke = browserSmokePath ? loadOptionalJson(browserSmokePath) : null
  const serviceScript = readOptionalText(serviceScriptPath)
  const envText = readOptionalText(envPath)

  const problems = [
    ...validateProfileShape(profile),
    ...validatePaths({
      checkpointAuditPath,
      checkpointManifestPath,
      serviceScriptPath,
      envPath,
      releaseManifestPath,
      browserSmokePath,
    }),
    ...validateCheckpoint(profile, checkpointAudit, checkpointManifest),
    ...validateService(profile, serviceScript, envText),
    ...validateRelease(profile, checkpointAudit, releaseManifest),
    ...validateBrowserSmoke(profile, browserSmoke),
  ]
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'render-profile-ready' : 'render-profile-blocked',
    profilePath,
    model: {
      id: profile.model?.id ?? '(missing)',
      name: profile.model?.name ?? '(missing)',
      releaseStatus: profile.model?.releaseStatus ?? '(missing)',
    },
    endpoint: profile.endpoint ?? null,
    evidence: {
      checkpointAudit: summarizePath(checkpointAuditPath),
      checkpointManifest: summarizePath(checkpointManifestPath),
      serviceScript: summarizePath(serviceScriptPath),
      viteEnv: summarizePath(envPath),
      releaseManifest: summarizePath(releaseManifestPath),
      browserSmoke: summarizePath(browserSmokePath),
    },
    problems,
    nextActions: nextActionsForProblems(problems),
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

function validateProfileShape(profile) {
  const problems = []
  if (!profile || typeof profile !== 'object') {
    return ['Local render profile must be a JSON object.']
  }
  if (profile.version !== 1) {
    problems.push('Local render profile version must be 1.')
  }
  if (profile.source !== 'webuta-neural-checkpoint-promotion') {
    problems.push('Local render profile source must be webuta-neural-checkpoint-promotion.')
  }
  for (const field of ['endpoint', 'checkpointAudit', 'checkpointManifest']) {
    if (!stringField(profile[field])) {
      problems.push(`Local render profile is missing ${field}.`)
    }
  }
  for (const field of ['id', 'name', 'renderer', 'releaseStatus']) {
    if (!stringField(profile.model?.[field])) {
      problems.push(`Local render profile is missing model.${field}.`)
    }
  }
  if (!Array.isArray(profile.datasetIds) || profile.datasetIds.length === 0) {
    problems.push('Local render profile must include datasetIds.')
  }
  return problems
}

function validatePaths(paths) {
  const problems = []
  for (const [label, path] of Object.entries(paths)) {
    if (!path) {
      if (label === 'browserSmokePath') {
        continue
      }
      problems.push(`Missing ${label}.`)
      continue
    }
    if (!existsSync(path)) {
      problems.push(`Missing ${label}: ${path}.`)
    }
  }
  return problems
}

function validateCheckpoint(profile, checkpointAudit, checkpointManifest) {
  const problems = []
  if (!checkpointAudit) {
    problems.push('Checkpoint audit evidence could not be read.')
  } else {
    if (checkpointAudit.ok !== true || checkpointAudit.decision !== 'checkpoint-ready') {
      problems.push('Checkpoint audit is not checkpoint-ready.')
    }
    if (profile.model?.id && checkpointAudit.model?.id && profile.model.id !== checkpointAudit.model.id) {
      problems.push(`Profile model id ${profile.model.id} does not match checkpoint audit model id ${checkpointAudit.model.id}.`)
    }
    const auditDatasetIds = new Set((checkpointAudit.datasets ?? []).map((dataset) => dataset.id).filter(Boolean))
    for (const id of profile.datasetIds ?? []) {
      if (!auditDatasetIds.has(id)) {
        problems.push(`Checkpoint audit does not include dataset ${id}.`)
      }
    }
  }
  if (!checkpointManifest) {
    problems.push('Checkpoint manifest could not be read.')
  } else {
    if (profile.model?.id && checkpointManifest.model?.id && profile.model.id !== checkpointManifest.model.id) {
      problems.push(`Profile model id ${profile.model.id} does not match checkpoint manifest model id ${checkpointManifest.model.id}.`)
    }
    if (profile.runtime?.ckpt && checkpointManifest.runtime?.ckpt && Number(profile.runtime.ckpt) !== Number(checkpointManifest.runtime.ckpt)) {
      problems.push(`Profile ckpt ${profile.runtime.ckpt} does not match checkpoint manifest runtime ckpt ${checkpointManifest.runtime.ckpt}.`)
    }
  }
  return problems
}

function validateService(profile, serviceScript, envText) {
  const problems = []
  const command = `${profile.service?.command ?? ''}\n${serviceScript ?? ''}`
  for (const flag of ['--accept-local-research-license', '--model-manifest', '--diffsinger-root', '--python', '--exp', '--ckpt', '--vocoder']) {
    if (!command.includes(flag)) {
      problems.push(`Local render service command is missing ${flag}.`)
    }
  }
  if (!envText?.includes(`VITE_WEBUTA_NEURAL_ENDPOINT=${profile.endpoint}`)) {
    problems.push('Vite env file does not match the promoted endpoint.')
  }
  if (profile.vite?.env?.VITE_WEBUTA_NEURAL_ENDPOINT !== profile.endpoint) {
    problems.push('Vite env metadata does not match the promoted endpoint.')
  }
  return problems
}

function validateRelease(profile, checkpointAudit, releaseManifest) {
  const problems = []
  if (!releaseManifest) {
    problems.push('Release manifest template could not be read.')
    return problems
  }
  if (releaseManifest.model?.id !== profile.model?.id) {
    problems.push(`Release manifest model id ${releaseManifest.model?.id ?? '(missing)'} does not match profile model id ${profile.model?.id}.`)
  }
  if (releaseManifest.model?.releaseStatus !== profile.model?.releaseStatus) {
    problems.push('Release manifest releaseStatus does not match profile releaseStatus.')
  }
  if (checkpointAudit?.manifestPath && releaseManifest.evidence?.modelCheckpoint !== profile.checkpointAudit) {
    problems.push('Release manifest modelCheckpoint evidence does not point at the promoted checkpoint audit.')
  }
  const releaseDatasetIds = new Set(releaseManifest.datasetIds ?? [])
  for (const id of profile.datasetIds ?? []) {
    if (!releaseDatasetIds.has(id)) {
      problems.push(`Release manifest does not include dataset ${id}.`)
    }
  }
  if (!stringField(releaseManifest.terms?.licenseSummary)) {
    problems.push('Release manifest terms.licenseSummary is missing.')
  }
  return problems
}

function validateBrowserSmoke(profile, browserSmoke) {
  const problems = []
  if (!browserSmoke) {
    return problems
  }
  if (browserSmoke.ok !== true) {
    problems.push('Browser smoke report is not ok.')
  }
  if (browserSmoke.mode !== 'local-neural') {
    problems.push('Browser smoke report is not local-neural mode.')
  }
  if (browserSmoke.neuralEndpoint && browserSmoke.neuralEndpoint !== profile.endpoint) {
    problems.push(`Browser smoke endpoint ${browserSmoke.neuralEndpoint} does not match profile endpoint ${profile.endpoint}.`)
  }
  const wav = browserSmoke.download?.wav
  if (!wav || wav.sampleRate !== 44100 || wav.channels !== 1 || wav.bitsPerSample !== 16 || wav.durationSeconds < 2) {
    problems.push('Browser smoke does not prove a DAW-ready 44.1 kHz mono 16-bit WAV.')
  }
  return problems
}

function nextActionsForProblems(problems) {
  if (problems.length === 0) {
    return ['Local render profile gate passed. Run the promoted service, browser smoke, quality evaluation, and release audit.']
  }
  const actions = new Set()
  for (const problem of problems) {
    if (problem.includes('checkpoint')) {
      actions.add('Rerun neural:audit-checkpoint and neural:promote-checkpoint from the same checkpoint manifest.')
    } else if (problem.includes('Vite') || problem.includes('service command')) {
      actions.add('Regenerate the promotion folder so serve-render.sh and Vite env match the profile.')
    } else if (problem.includes('Release manifest')) {
      actions.add('Regenerate or update the generated release manifest template before audit-release.')
    } else if (problem.includes('Browser smoke')) {
      actions.add('Run smoke:browser:neural:actual against the promoted endpoint and pass --browser-smoke to this audit.')
    } else {
      actions.add('Fix the promoted local render profile and rerun this audit.')
    }
  }
  return [...actions]
}

function resolveProfilePath(profilePath, value) {
  if (!stringField(value)) {
    return null
  }
  if (value.startsWith('/')) {
    return resolve(value)
  }
  const cwdPath = resolve(value)
  if (existsSync(cwdPath)) {
    return cwdPath
  }
  return resolve(dirname(profilePath), value)
}

function readJson(path, label) {
  if (!path || !existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function loadOptionalJson(path) {
  if (!path || !existsSync(path)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function readOptionalText(path) {
  if (!path || !existsSync(path)) {
    return null
  }
  return readFileSync(path, 'utf8')
}

function summarizePath(path) {
  if (!path) {
    return { path: null, exists: false }
  }
  return { path, exists: existsSync(path) }
}

function stringField(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile') {
      parsed.profile = argv[++index]
    } else if (arg === '--release-manifest') {
      parsed.releaseManifest = argv[++index]
    } else if (arg === '--browser-smoke') {
      parsed.browserSmoke = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-local-render-profile.mjs --profile path [options]',
          '',
          'Options:',
          `  --profile path           Promoted local render profile, default ${DEFAULT_PROFILE}`,
          '  --release-manifest path  Generated model release manifest template',
          '  --browser-smoke path     Optional local-neural browser smoke report',
          '  --report path            Write JSON audit report',
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
    const report = auditLocalRenderProfile(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
