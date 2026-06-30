import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditNeuralModelCheckpoint } from './audit-neural-model-checkpoint.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural model checkpoint audit', () => {
  it('passes a DiffSinger checkpoint with dataset lineage, readiness, and runtime artifacts', () => {
    const fixture = makeCheckpointFixture()

    const report = auditNeuralModelCheckpoint({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report).toMatchObject({
      ok: true,
      decision: 'checkpoint-ready',
      model: {
        id: 'webuta-ko-test',
        renderer: 'diffsinger',
      },
      training: {
        checkpointStep: 2000,
        minCheckpointStep: 1000,
      },
      runtime: {
        ckpt: 2000,
      },
      problems: [],
    })
    expect(report.runtime.serviceCommand).toContain('--accept-local-research-license')
    expect(report.runtime.serviceCommand).toContain('--ckpt 2000')
  })

  it('blocks checkpoints that are below the required training step', () => {
    const fixture = makeCheckpointFixture({
      checkpointStep: 200,
      minCheckpointStep: 1000,
    })

    const report = auditNeuralModelCheckpoint({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('Checkpoint step 200 is below required 1000')
  })

  it('blocks missing runtime artifacts before browser render smoke can claim readiness', () => {
    const fixture = makeCheckpointFixture({ createVocoder: false })

    const report = auditNeuralModelCheckpoint({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('Missing vocoder checkpoint')
  })

  it('blocks dataset and readiness mismatches', () => {
    const fixture = makeCheckpointFixture({
      localTraining: false,
      readinessDatasetId: 'other-dataset',
    })

    const report = auditNeuralModelCheckpoint({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('Dataset licensed-ko is not approved for local training')
    expect(report.problems.join('\n')).toContain('Training readiness datasetId other-dataset is not listed')
  })

  it('requires provider archive-drop provenance for production checkpoints', () => {
    const missing = makeCheckpointFixture({ production: true, providerDrop: false })
    const blocked = auditNeuralModelCheckpoint({
      manifest: missing.manifestPath,
      registry: missing.registryPath,
    })

    expect(blocked.ok).toBe(false)
    expect(blocked.problems).toContain('Production checkpoint evidence is missing evidence.providerDropAudit.')

    const ready = makeCheckpointFixture({ production: true, providerDrop: true })
    const passed = auditNeuralModelCheckpoint({
      manifest: ready.manifestPath,
      registry: ready.registryPath,
    })

    expect(passed.ok).toBe(true)
    expect(passed.evidence.providerDropAudit).toContain('provider-drop.json')
  })

  it('runs from the command line and writes an audit report', () => {
    const fixture = makeCheckpointFixture()
    const reportPath = join(fixture.root, 'checkpoint-audit.json')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-neural-model-checkpoint.mjs',
        '--manifest',
        fixture.manifestPath,
        '--registry',
        fixture.registryPath,
        '--report',
        reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).decision).toBe('checkpoint-ready')
  })
})

function makeCheckpointFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-checkpoint-audit-'))
  tempRoots.push(root)
  const registryPath = join(root, 'registry.json')
  const manifestPath = join(root, 'model-checkpoint.json')
  const readinessPath = join(root, 'readiness.json')
  const diffSingerRoot = join(root, 'DiffSinger')
  const exp = join(root, 'train-run')
  const python = join(root, 'python')
  const vocoder = join(diffSingerRoot, 'checkpoints', 'pc-nsf', 'model.ckpt')
  const checkpointStep = options.checkpointStep ?? 2000
  const checkpointPath = join(exp, `model_ckpt_steps_${checkpointStep}.ckpt`)
  const config = join(exp, 'config.yaml')
  const trainManifestPath = join(root, 'train-manifest.json')
  const providerDropPath = join(root, 'provider-drop.json')

  mkdirSync(join(diffSingerRoot, 'scripts'), { recursive: true })
  mkdirSync(join(diffSingerRoot, 'checkpoints', 'pc-nsf'), { recursive: true })
  mkdirSync(exp, { recursive: true })
  writeFileSync(join(diffSingerRoot, 'scripts', 'infer.py'), 'print("infer")\n')
  writeFileSync(python, '#!/usr/bin/env python\n')
  writeFileSync(config, 'task_cls: training.acoustic_task.AcousticTask\n')
  writeFileSync(checkpointPath, 'fake checkpoint\n')
  if (options.createVocoder !== false) {
    writeFileSync(vocoder, 'fake vocoder\n')
  }
  writeJson(trainManifestPath, {
    version: 1,
    trainWorkDir: exp,
    trainItemCount: 12,
    phoneInventoryCount: 38,
  })
  writeJson(readinessPath, {
    version: 1,
    ok: options.readinessOk ?? true,
    datasetId: options.readinessDatasetId ?? 'licensed-ko',
    gates: [
      { id: 'duration', passed: true },
      { id: 'annotations', passed: true },
    ],
  })
  if (options.providerDrop) {
    writeJson(providerDropPath, {
      version: 1,
      ok: true,
      decision: 'provider-archive-ready',
      production: true,
      datasetId: 'licensed-ko',
      metrics: {
        archiveCount: 1,
        supportedArchiveCount: 1,
        unsupportedArchiveCount: 0,
        totalSizeBytes: 4096,
        hashedArchiveCount: 1,
      },
      archives: [
        {
          relativePath: 'provider.zip',
          sha256: 'b'.repeat(64),
          sizeBytes: 4096,
        },
      ],
      problems: [],
    })
  }
  writeJson(registryPath, {
    version: 1,
    datasets: [
      {
        id: 'licensed-ko',
        name: 'Licensed Korean Singing Fixture',
        localPath: join(root, 'dataset'),
        licenseStatus: 'license-reviewed-local-training',
        redistribution: 'private-fixture',
        modelPublishing: 'not-for-public-release',
        singerIdentity: 'licensed-dataset',
        language: ['ko'],
        annotationTypes: ['audio', 'lyrics'],
        allowedActions: {
          localTraining: options.localTraining ?? true,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        reviewNotes: [],
      },
    ],
  })
  writeJson(manifestPath, {
    version: 1,
    model: {
      id: 'webuta-ko-test',
      name: 'WebUtau KO Test Checkpoint',
      renderer: 'diffsinger',
      releaseStatus: 'local-research',
    },
    datasetIds: ['licensed-ko'],
    training: {
      framework: 'openvpi-diffsinger',
      runId: 'fixture-run',
      runDir: exp,
      config,
      trainManifest: trainManifestPath,
      minCheckpointStep: options.minCheckpointStep ?? 1000,
      checkpoint: {
        step: checkpointStep,
        path: checkpointPath,
      },
    },
    runtime: {
      diffSingerRoot,
      python,
      exp,
      ckpt: checkpointStep,
      vocoder: 'checkpoints/pc-nsf/model.ckpt',
    },
    evidence: {
      trainingReadiness: readinessPath,
      ...(options.providerDrop ? { providerDropAudit: providerDropPath } : {}),
      ...(options.production
        ? {
            productionPreflight: {
              production: true,
              passed: true,
              checks: [
                {
                  id: 'provider-drop',
                  passed: options.providerDrop === true,
                  enforced: true,
                },
              ],
            },
          }
        : {}),
    },
    terms: {
      licenseSummary: 'Fixture checkpoint for local audit tests only.',
      allowedUse: ['Local diagnostics'],
      disallowedUse: ['Public release'],
    },
  })

  return { root, registryPath, manifestPath }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
