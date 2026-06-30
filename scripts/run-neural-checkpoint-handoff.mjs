#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditLocalRenderProfile } from './audit-local-render-profile.mjs'
import { auditNeuralModelCheckpoint } from './audit-neural-model-checkpoint.mjs'
import { promoteNeuralCheckpoint } from './promote-neural-checkpoint.mjs'

const DEFAULT_MANIFEST = 'experiments/neural-singer/work/diffsinger-training-run/model-checkpoint.template.json'
const DEFAULT_REGISTRY = 'experiments/neural-singer/dataset-registry.example.json'
const DEFAULT_WORK_DIR = 'experiments/neural-singer/work/checkpoint-handoff'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8787/render'

export function runNeuralCheckpointHandoff(options = {}) {
  const manifest = resolve(options.manifest ?? DEFAULT_MANIFEST)
  const registry = resolve(options.registry ?? DEFAULT_REGISTRY)
  const workDir = resolve(options.workDir ?? DEFAULT_WORK_DIR)
  const reportPath = options.report ? resolve(options.report) : null
  const checkpointAuditPath = resolve(options.checkpointAudit ?? join(workDir, 'model-checkpoint-audit.json'))
  const promotionDir = resolve(options.promotionDir ?? join(workDir, 'promoted-local-neural-model'))
  const renderProfileAuditPath = resolve(options.renderProfileAudit ?? join(promotionDir, 'render-profile-audit.json'))
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const browserSmoke = options.browserSmoke ? resolve(options.browserSmoke) : null
  const requireBrowserSmoke = Boolean(options.requireBrowserSmoke)
  const steps = []
  const failures = []

  mkdirSync(workDir, { recursive: true })

  const checkpointAudit = runStep(steps, failures, {
    id: 'audit-checkpoint',
    label: 'Audit trained DiffSinger checkpoint',
    run: () =>
      auditNeuralModelCheckpoint({
        manifest,
        registry,
        report: checkpointAuditPath,
        minCheckpointStep: options.minCheckpointStep,
      }),
    summarize: summarizeCheckpointAudit,
  })

  if (!checkpointAudit?.ok) {
    return finish({
      reportPath,
      report: baseReport({
        ok: false,
        status: 'blocked-checkpoint-audit',
        manifest,
        registry,
        workDir,
        endpoint,
        steps,
        failures,
        artifacts: {
          checkpointAudit: checkpointAuditPath,
        },
        nextActions: checkpointAudit?.nextActions ?? ['Fix checkpoint manifest/runtime evidence and rerun this handoff.'],
      }),
    })
  }

  const promotion = runStep(steps, failures, {
    id: 'promote-checkpoint',
    label: 'Promote checkpoint into local render profile',
    run: () =>
      promoteNeuralCheckpoint({
        checkpointAudit: checkpointAuditPath,
        manifest,
        out: promotionDir,
        endpoint,
        host: options.host,
        port: options.port,
        workDir: options.renderWorkDir,
      }),
    summarize: summarizePromotion,
  })

  if (!promotion) {
    return finishFailure({
      reportPath,
      manifest,
      registry,
      workDir,
      endpoint,
      steps,
      failures,
      status: 'blocked-promotion',
      nextActions: ['Fix the checkpoint audit and promotion options before local render profile generation.'],
    })
  }

  const renderAudit = runStep(steps, failures, {
    id: 'audit-render-profile',
    label: 'Audit promoted local render profile',
    run: () =>
      auditLocalRenderProfile({
        profile: promotion.renderProfile,
        releaseManifest: promotion.releaseManifest,
        browserSmoke,
        report: renderProfileAuditPath,
      }),
    summarize: summarizeRenderAudit,
  })

  if (!renderAudit?.ok) {
    return finishFailure({
      reportPath,
      manifest,
      registry,
      workDir,
      endpoint,
      steps,
      failures,
      status: 'blocked-render-profile-audit',
      artifacts: promotionArtifacts({ checkpointAuditPath, promotion, renderProfileAuditPath }),
      nextActions: renderAudit?.nextActions ?? ['Regenerate the promotion folder and rerun render profile audit.'],
    })
  }

  if (requireBrowserSmoke && !browserSmoke) {
    return finish({
      reportPath,
      report: baseReport({
        ok: false,
        status: 'blocked-browser-smoke',
        manifest,
        registry,
        workDir,
        endpoint,
        steps,
        failures,
        artifacts: promotionArtifacts({ checkpointAuditPath, promotion, renderProfileAuditPath }),
        nextActions: [
          `Run ${shellQuote(promotion.serveScript)} in one shell.`,
          `Run npm run smoke:browser:neural:actual -- --neural-endpoint ${shellQuote(endpoint)} --out <browser-smoke-report>.json, then rerun with --browser-smoke.`,
        ],
      }),
    })
  }

  return finish({
    reportPath,
    report: baseReport({
      ok: true,
      status: browserSmoke ? 'render-profile-ready-with-browser-smoke' : 'render-profile-ready-needs-browser-smoke',
      manifest,
      registry,
      workDir,
      endpoint,
      steps,
      failures,
      artifacts: promotionArtifacts({ checkpointAuditPath, promotion, renderProfileAuditPath, browserSmoke }),
      nextActions: browserSmoke
        ? ['Run neural:evaluate-quality, compare candidate quality, then run neural:audit-release with listening evidence.']
        : [
            `Run ${shellQuote(promotion.serveScript)} in one shell.`,
            `Run npm run smoke:browser:neural:actual -- --neural-endpoint ${shellQuote(endpoint)} --out <browser-smoke-report>.json and rerun this handoff with --browser-smoke.`,
          ],
    }),
  })
}

function runStep(steps, failures, { id, label, run, summarize }) {
  try {
    const result = run()
    steps.push({
      id,
      label,
      status: 'passed',
      summary: summarize ? summarize(result) : result,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    steps.push({
      id,
      label,
      status: 'failed',
      error: message,
    })
    failures.push({ id, error: message })
    return null
  }
}

function baseReport({ ok, status, manifest, registry, workDir, endpoint, steps, failures, artifacts, nextActions }) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'neural-checkpoint-handoff',
    ok,
    status,
    manifest,
    registry,
    workDir,
    endpoint,
    artifacts: artifacts ?? {},
    steps,
    failures,
    nextActions: dedupe(nextActions ?? []),
  }
}

function finishFailure({ reportPath, manifest, registry, workDir, endpoint, steps, failures, status, artifacts, nextActions }) {
  return finish({
    reportPath,
    report: baseReport({
      ok: false,
      status,
      manifest,
      registry,
      workDir,
      endpoint,
      steps,
      failures,
      artifacts,
      nextActions,
    }),
  })
}

function finish({ reportPath, report }) {
  if (reportPath) {
    writeJson(reportPath, report)
  }
  return report
}

function promotionArtifacts({ checkpointAuditPath, promotion, renderProfileAuditPath, browserSmoke }) {
  return {
    checkpointAudit: checkpointAuditPath,
    renderProfile: promotion.renderProfile,
    serveScript: promotion.serveScript,
    viteEnv: promotion.env,
    releaseManifest: promotion.releaseManifest,
    renderProfileAudit: renderProfileAuditPath,
    browserSmoke: browserSmoke ?? null,
  }
}

function summarizeCheckpointAudit(report) {
  return {
    ok: report.ok,
    decision: report.decision,
    modelId: report.model?.id ?? null,
    checkpointStep: report.training?.checkpointStep ?? null,
    problemCount: report.problems.length,
  }
}

function summarizePromotion(result) {
  return {
    modelId: result.modelId,
    endpoint: result.endpoint,
    renderProfile: result.renderProfile,
    releaseManifest: result.releaseManifest,
  }
}

function summarizeRenderAudit(report) {
  return {
    ok: report.ok,
    decision: report.decision,
    modelId: report.model?.id ?? null,
    endpoint: report.endpoint,
    problemCount: report.problems.length,
  }
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))]
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
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
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--work-dir') {
      parsed.workDir = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--checkpoint-audit') {
      parsed.checkpointAudit = argv[++index]
    } else if (arg === '--promotion-dir') {
      parsed.promotionDir = argv[++index]
    } else if (arg === '--render-profile-audit') {
      parsed.renderProfileAudit = argv[++index]
    } else if (arg === '--endpoint') {
      parsed.endpoint = argv[++index]
    } else if (arg === '--host') {
      parsed.host = argv[++index]
    } else if (arg === '--port') {
      parsed.port = Number(argv[++index])
    } else if (arg === '--render-work-dir') {
      parsed.renderWorkDir = argv[++index]
    } else if (arg === '--browser-smoke') {
      parsed.browserSmoke = argv[++index]
    } else if (arg === '--require-browser-smoke') {
      parsed.requireBrowserSmoke = true
    } else if (arg === '--min-checkpoint-step') {
      parsed.minCheckpointStep = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/run-neural-checkpoint-handoff.mjs --manifest path --registry path [options]',
          '',
          'Options:',
          '  --manifest path              Model checkpoint manifest',
          '  --registry path              Dataset registry JSON',
          '  --work-dir path              Output handoff work dir',
          '  --report path                Write JSON handoff report',
          '  --checkpoint-audit path      Checkpoint audit output path',
          '  --promotion-dir path         Promotion folder output path',
          '  --render-profile-audit path  Render profile audit output path',
          '  --endpoint url               Local render endpoint',
          '  --browser-smoke path         Optional local-neural browser smoke report',
          '  --require-browser-smoke      Block unless --browser-smoke is supplied',
          '  --min-checkpoint-step n       Override checkpoint minimum step',
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
    const report = runNeuralCheckpointHandoff(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
