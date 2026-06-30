import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runNeuralCheckpointHandoff } from './run-neural-checkpoint-handoff.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural checkpoint handoff runner', () => {
  it('audits, promotes, and audits the local render profile from a ready checkpoint', () => {
    const fixture = makeCheckpointFixture()

    const report = runNeuralCheckpointHandoff({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
      workDir: fixture.workDir,
      report: fixture.reportPath,
      endpoint: 'http://127.0.0.1:8787/render',
      minCheckpointStep: 1000,
    })

    expect(report).toMatchObject({
      ok: true,
      status: 'render-profile-ready-needs-browser-smoke',
      endpoint: 'http://127.0.0.1:8787/render',
    })
    expect(report.steps.map((step) => step.id)).toEqual(['audit-checkpoint', 'promote-checkpoint', 'audit-render-profile'])
    expect(report.artifacts).toMatchObject({
      checkpointAudit: join(fixture.workDir, 'model-checkpoint-audit.json'),
      renderProfile: join(fixture.workDir, 'promoted-local-neural-model', 'local-render-profile.json'),
      renderProfileAudit: join(fixture.workDir, 'promoted-local-neural-model', 'render-profile-audit.json'),
    })
    expect(existsSync(report.artifacts.serveScript)).toBe(true)
    expect(JSON.parse(readFileSync(report.artifacts.renderProfileAudit, 'utf8')).decision).toBe('render-profile-ready')
    expect(JSON.parse(readFileSync(fixture.reportPath, 'utf8')).ok).toBe(true)
  })

  it('blocks when browser smoke is required but missing', () => {
    const fixture = makeCheckpointFixture()

    const report = runNeuralCheckpointHandoff({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
      workDir: fixture.workDir,
      requireBrowserSmoke: true,
    })

    expect(report.ok).toBe(false)
    expect(report.status).toBe('blocked-browser-smoke')
    expect(report.nextActions.join('\n')).toContain('smoke:browser:neural')
  })

  it('blocks before promotion when checkpoint audit fails', () => {
    const fixture = makeCheckpointFixture({ emptyCheckpoint: true })

    const report = runNeuralCheckpointHandoff({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
      workDir: fixture.workDir,
    })

    expect(report.ok).toBe(false)
    expect(report.status).toBe('blocked-checkpoint-audit')
    expect(report.steps.map((step) => step.id)).toEqual(['audit-checkpoint'])
  })

  it('runs from the command line and exits nonzero on blocked handoff', () => {
    const fixture = makeCheckpointFixture()
    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/run-neural-checkpoint-handoff.mjs',
        '--manifest',
        fixture.manifestPath,
        '--registry',
        fixture.registryPath,
        '--work-dir',
        fixture.workDir,
        '--report',
        fixture.reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(JSON.parse(stdout).status).toBe('render-profile-ready-needs-browser-smoke')

    const blocked = spawnSync(
      process.execPath,
      [
        'scripts/run-neural-checkpoint-handoff.mjs',
        '--manifest',
        fixture.manifestPath,
        '--registry',
        fixture.registryPath,
        '--work-dir',
        join(fixture.root, 'blocked-work'),
        '--require-browser-smoke',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(blocked.status).toBe(1)
    expect(JSON.parse(blocked.stdout).status).toBe('blocked-browser-smoke')
  })
})

function makeCheckpointFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-checkpoint-handoff-'))
  tempRoots.push(root)
  const registryPath = join(root, 'registry.json')
  const workDir = join(root, 'checkpoint-handoff')
  const reportPath = join(root, 'checkpoint-handoff.json')
  const diffSingerRoot = join(root, 'DiffSinger')
  const python = join(root, 'python')
  const trainDir = join(root, 'train')
  const configPath = join(root, 'config.yaml')
  const trainManifestPath = join(root, 'diffsinger-training.manifest.json')
  const readinessPath = join(root, 'training-readiness.json')
  const checkpointPath = join(trainDir, 'model_ckpt_steps_2000.ckpt')
  const vocoder = join(diffSingerRoot, 'checkpoints', 'vocoder.ckpt')
  const manifestPath = join(root, 'model-checkpoint.json')

  mkdirSync(join(diffSingerRoot, 'scripts'), { recursive: true })
  mkdirSync(dirname(vocoder), { recursive: true })
  mkdirSync(trainDir, { recursive: true })
  writeFileSync(join(diffSingerRoot, 'scripts', 'infer.py'), '# infer fixture\n')
  writeFileSync(python, '#!/usr/bin/env python\n')
  writeFileSync(vocoder, 'vocoder\n')
  writeFileSync(configPath, 'base_config: []\n')
  writeFileSync(checkpointPath, options.emptyCheckpoint ? '' : 'checkpoint\n')
  writeJson(registryPath, {
    version: 1,
    datasets: [
      {
        id: 'licensed-ko',
        name: 'Licensed Korean Fixture',
        licenseStatus: 'license-reviewed-local-training',
        modelPublishing: 'private-family-allowed',
        redistribution: 'private-local-only',
        allowedActions: {
          localTraining: true,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
      },
    ],
  })
  writeJson(trainManifestPath, {
    version: 1,
    source: 'webuta-diffsinger-training-run',
    runId: 'run-001',
    trainWorkDir: trainDir,
    trainItemCount: 12,
    phoneInventoryCount: 24,
  })
  writeJson(readinessPath, {
    version: 1,
    ok: true,
    datasetId: 'licensed-ko',
    gates: [{ id: 'duration', passed: true }],
  })
  writeJson(manifestPath, {
    version: 1,
    model: {
      id: 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      renderer: 'diffsinger',
      releaseStatus: 'private-family',
    },
    datasetIds: ['licensed-ko'],
    training: {
      framework: 'openvpi-diffsinger',
      runId: 'run-001',
      runDir: trainDir,
      config: configPath,
      trainManifest: trainManifestPath,
      minCheckpointStep: 1000,
      checkpoint: {
        step: 2000,
        path: checkpointPath,
      },
    },
    runtime: {
      diffSingerRoot,
      python,
      exp: trainDir,
      ckpt: 2000,
      vocoder,
    },
    evidence: {
      trainingReadiness: readinessPath,
      productionPreflight: {
        production: false,
      },
    },
    terms: {
      licenseSummary: 'Consent-reviewed private Korean model.',
      allowedUse: ['Private local rendering'],
      disallowedUse: ['Public model release'],
    },
  })

  return { root, registryPath, workDir, reportPath, manifestPath }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
