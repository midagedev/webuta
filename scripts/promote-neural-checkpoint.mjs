#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_AUDIT = 'experiments/neural-singer/work/model-checkpoint-audit.json'
const DEFAULT_OUT = 'experiments/neural-singer/work/promoted-local-neural-model'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8787/render'
const DEFAULT_WORK_DIR = 'experiments/neural-singer/work/local-neural-render'

export function promoteNeuralCheckpoint(options = {}) {
  const checkpointAuditPath = resolve(options.checkpointAudit ?? options.audit ?? DEFAULT_AUDIT)
  const checkpointAudit = readJson(checkpointAuditPath, 'checkpoint audit report')
  validateCheckpointAudit(checkpointAudit, checkpointAuditPath)

  const checkpointManifestPath = resolve(options.manifest ?? checkpointAudit.manifestPath)
  const checkpointManifest = readJson(checkpointManifestPath, 'checkpoint manifest')
  const outDir = resolve(options.out ?? DEFAULT_OUT)
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const endpointUrl = new URL(endpoint)
  const port = positiveInteger(options.port, endpointUrl.port ? Number(endpointUrl.port) : 8787)
  const host = options.host ?? endpointUrl.hostname
  const workDir = resolve(options.workDir ?? DEFAULT_WORK_DIR)
  const renderProfilePath = join(outDir, 'local-render-profile.json')
  const serveScriptPath = join(outDir, 'serve-render.sh')
  const envPath = join(outDir, 'vite-local-neural.env')
  const releaseManifestPath = join(outDir, 'model-release.local-template.json')
  const readmePath = join(outDir, 'README.md')
  const runtime = checkpointAudit.runtime ?? {}
  const model = checkpointAudit.model ?? checkpointManifest.model ?? {}
  const terms = checkpointManifest.terms ?? {}
  const datasetIds = checkpointManifest.datasetIds ?? checkpointAudit.datasets?.map((dataset) => dataset.id) ?? []

  mkdirSync(outDir, { recursive: true })

  const serveCommand = [
    'npm run neural:serve-render --',
    '--accept-local-research-license',
    `--host ${shellQuote(host)}`,
    `--port ${port}`,
    `--work-dir ${shellQuote(workDir)}`,
    `--model-manifest ${shellQuote(checkpointManifestPath)}`,
    `--diffsinger-root ${shellQuote(runtime.diffSingerRoot)}`,
    `--python ${shellQuote(runtime.python)}`,
    `--exp ${shellQuote(runtime.exp)}`,
    `--ckpt ${runtime.ckpt}`,
    runtime.vocoder ? `--vocoder ${shellQuote(runtime.vocoder)}` : '',
  ].filter(Boolean)

  const renderProfile = {
    version: 1,
    source: 'webuta-neural-checkpoint-promotion',
    generatedAt: new Date().toISOString(),
    model: {
      id: model.id,
      name: model.name,
      renderer: model.renderer,
      releaseStatus: model.releaseStatus,
    },
    datasetIds,
    endpoint,
    checkpointAudit: checkpointAuditPath,
    checkpointManifest: checkpointManifestPath,
    service: {
      host,
      port,
      workDir,
      command: serveCommand.join(' '),
      script: serveScriptPath,
    },
    vite: {
      envFile: envPath,
      env: {
        VITE_WEBUTA_NEURAL_ENDPOINT: endpoint,
      },
      command: `env $(cat ${shellQuote(envPath)} | xargs) npm run dev`,
    },
    runtime,
    terms: {
      licenseSummary: terms.licenseSummary ?? '',
      allowedUse: terms.allowedUse ?? [],
      disallowedUse: terms.disallowedUse ?? [],
    },
    nextCommands: [
      `${shellQuote(serveScriptPath)}`,
      `VITE_WEBUTA_NEURAL_ENDPOINT=${shellQuote(endpoint)} npm run dev`,
      `npm run smoke:browser:neural:actual -- --neural-endpoint ${shellQuote(endpoint)} --out experiments/neural-singer/work/browser-smoke/${safeName(model.id)}.json`,
      `npm run neural:evaluate-quality -- --accept-local-research-license`,
    ],
  }

  writeJson(renderProfilePath, renderProfile)
  writeFileSync(serveScriptPath, `${serveScriptText(serveCommand)}\n`)
  chmodSync(serveScriptPath, 0o755)
  writeFileSync(envPath, `VITE_WEBUTA_NEURAL_ENDPOINT=${endpoint}\n`)
  writeJson(releaseManifestPath, releaseManifestTemplate({ checkpointAuditPath, checkpointManifest, model, datasetIds }))
  writeFileSync(readmePath, readmeText({ renderProfile, releaseManifestPath }))

  return {
    outDir,
    renderProfile: renderProfilePath,
    serveScript: serveScriptPath,
    env: envPath,
    releaseManifest: releaseManifestPath,
    endpoint,
    modelId: model.id,
  }
}

function validateCheckpointAudit(report, path) {
  if (!report || typeof report !== 'object') {
    throw new Error(`Checkpoint audit report must be a JSON object: ${path}`)
  }
  if (report.ok !== true || report.decision !== 'checkpoint-ready') {
    throw new Error(`Checkpoint audit is not ready: ${path}`)
  }
  for (const key of ['manifestPath', 'model', 'runtime']) {
    if (!report[key]) {
      throw new Error(`Checkpoint audit is missing ${key}: ${path}`)
    }
  }
  for (const key of ['diffSingerRoot', 'python', 'exp', 'ckpt']) {
    if (report.runtime[key] === undefined || report.runtime[key] === null || report.runtime[key] === '') {
      throw new Error(`Checkpoint audit runtime is missing ${key}: ${path}`)
    }
  }
}

function serveScriptText(serveCommand) {
  const command = serveCommand.map((part, index) => (index === 0 ? part : `  ${part}`)).join(' \\\n')
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    command,
  ].join('\n')
}

function releaseManifestTemplate({ checkpointAuditPath, checkpointManifest, model, datasetIds }) {
  const qualitySummary = checkpointManifest.evidence?.qualitySummary ?? 'experiments/neural-singer/work/neural-quality/<run-id>/quality-summary.json'
  const browserSmoke = checkpointManifest.evidence?.browserSmoke ?? 'experiments/neural-singer/work/browser-smoke/neural-latest.json'
  return {
    version: 1,
    notes: 'Generated from a checkpoint-ready audit. Fill quality comparison and listening evidence before release audit.',
    model: {
      id: model.id,
      name: model.name,
      releaseIntent: releaseIntentForStatus(model.releaseStatus),
      releaseStatus: model.releaseStatus ?? 'local-research',
    },
    datasetIds,
    evidence: {
      modelCheckpoint: checkpointAuditPath,
      qualitySummary,
      qualityComparison: 'experiments/neural-singer/work/neural-quality/<comparison-id>/checkpoint-comparison.json',
      browserSmoke,
      listeningScores: 'experiments/neural-singer/work/neural-quality/<run-id>/listening-scores.local.json',
    },
    terms: checkpointManifest.terms ?? {
      licenseSummary: '',
      allowedUse: [],
      disallowedUse: [],
      publicReleaseNotes: '',
    },
  }
}

function readmeText({ renderProfile, releaseManifestPath }) {
  return [
    '# Promoted Local Neural Model',
    '',
    `Model: ${renderProfile.model.name} (${renderProfile.model.id})`,
    '',
    'This folder is generated only after `neural:audit-checkpoint` reports `checkpoint-ready`.',
    'Keep it local until dataset/model release terms are explicitly reviewed.',
    '',
    '## Run Local Render Service',
    '',
    '```sh',
    './serve-render.sh',
    '```',
    '',
    'In another shell:',
    '',
    '```sh',
    `VITE_WEBUTA_NEURAL_ENDPOINT=${shellQuote(renderProfile.endpoint)} npm run dev`,
    '```',
    '',
    '## Verify',
    '',
    '```sh',
    `npm run smoke:browser:neural:actual -- --neural-endpoint ${shellQuote(renderProfile.endpoint)} --out experiments/neural-singer/work/browser-smoke/${safeName(renderProfile.model.id)}.json`,
    '```',
    '',
    '## Release Audit Template',
    '',
    `Generated: ${releaseManifestPath}`,
    '',
  ].join('\n')
}

function releaseIntentForStatus(status) {
  if (status === 'public-beta') {
    return 'public-demo'
  }
  if (status === 'private-family') {
    return 'private-family'
  }
  return 'local-research'
}

function readJson(path, label) {
  if (!path || !existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  if (Number.isInteger(number) && number > 0) {
    return number
  }
  if (Number.isInteger(fallback) && fallback > 0) {
    return fallback
  }
  throw new Error('A positive port is required.')
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function safeName(value) {
  return String(value)
    .trim()
    .replace(/[^\w.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'webuta-neural'
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--checkpoint-audit' || arg === '--audit') {
      parsed.checkpointAudit = argv[++index]
    } else if (arg === '--manifest') {
      parsed.manifest = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--endpoint') {
      parsed.endpoint = argv[++index]
    } else if (arg === '--host') {
      parsed.host = argv[++index]
    } else if (arg === '--port') {
      parsed.port = Number(argv[++index])
    } else if (arg === '--work-dir') {
      parsed.workDir = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/promote-neural-checkpoint.mjs --checkpoint-audit path [options]',
          '',
          'Options:',
          `  --checkpoint-audit path  checkpoint-ready neural:audit-checkpoint report, default ${DEFAULT_AUDIT}`,
          '  --manifest path          Override checkpoint manifest path',
          `  --out path               Output folder, default ${DEFAULT_OUT}`,
          `  --endpoint url           Local render endpoint, default ${DEFAULT_ENDPOINT}`,
          '  --host address           Render service bind host inferred from endpoint by default',
          '  --port n                 Render service port inferred from endpoint by default',
          `  --work-dir path          Render artifact work dir, default ${DEFAULT_WORK_DIR}`,
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
    const result = promoteNeuralCheckpoint(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
