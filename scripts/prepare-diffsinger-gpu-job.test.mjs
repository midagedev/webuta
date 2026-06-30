import * as yaml from 'js-yaml'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDiffSingerGpuJob } from './prepare-diffsinger-gpu-job.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('DiffSinger GPU job preparation', () => {
  it('writes a portable remote config and guarded transfer scripts', () => {
    const root = makeTempRoot()
    const fixture = makeTrainingRunFixture(root)

    const result = prepareDiffSingerGpuJob({
      manifest: fixture.trainingManifest,
      out: join(root, 'gpu-job'),
      remoteHost: 'singer@gpu-box',
      remoteWorkDir: '/srv/webuta/runs/run-001',
      remoteDiffSingerRoot: '/opt/DiffSinger',
      remotePython: '/opt/venv/bin/python',
      checkpointStep: 50000,
      accelerator: 'gpu',
      devices: 2,
      precision: 'bf16-mixed',
      maxUpdates: 50000,
    })

    const remoteConfig = yaml.load(readFileSync(result.remoteConfig, 'utf8'))
    expect(remoteConfig).toMatchObject({
      base_config: ['/opt/DiffSinger/configs/acoustic.yaml'],
      binary_data_dir: '/srv/webuta/runs/run-001/training/binary',
      max_updates: 50000,
      pl_trainer_accelerator: 'gpu',
      pl_trainer_devices: 2,
      pl_trainer_precision: 'bf16-mixed',
    })
    expect(remoteConfig.dictionaries.ko).toBe('/srv/webuta/runs/run-001/training/dictionary-ko.txt')
    expect(remoteConfig.datasets[0].raw_data_dir).toBe('/srv/webuta/runs/run-001/dataset')

    expect(existsSync(join(root, 'gpu-job', 'training', 'dictionary-ko.txt'))).toBe(true)
    expect(readFileSync(result.uploadScript, 'utf8')).toContain('WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD')
    expect(readFileSync(result.uploadScript, 'utf8')).toContain('$REMOTE_WORK_DIR/training/')
    expect(readFileSync(result.runScript, 'utf8')).toContain('scripts/train.py')
    expect(result.runScript).toContain('/training/run-on-gpu.sh')

    const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'))
    expect(manifest).toMatchObject({
      source: 'webuta-diffsinger-gpu-job',
      runId: 'run-001',
      datasetIds: ['licensed-ko'],
      lineage: {
        providerDropAudit: fixture.providerDropAudit,
        productionPreflight: {
          production: true,
        },
      },
      remote: {
        host: 'singer@gpu-box',
        workDir: '/srv/webuta/runs/run-001',
        checkpointStep: 50000,
      },
    })
    expect(readFileSync(join(root, 'gpu-job', 'README.md'), 'utf8')).toContain('Provider archive-drop audit')
  })

  it('fails before creating a GPU job when dataset lineage is missing', () => {
    const root = makeTempRoot()
    const fixture = makeTrainingRunFixture(root, { datasetIds: [] })

    expect(() =>
      prepareDiffSingerGpuJob({
        manifest: fixture.trainingManifest,
        out: join(root, 'gpu-job'),
      }),
    ).toThrow(/datasetIds/)
  })

  it('blocks production GPU jobs when provider archive provenance is missing', () => {
    const root = makeTempRoot()
    const fixture = makeTrainingRunFixture(root, { providerDropAudit: null })

    expect(() =>
      prepareDiffSingerGpuJob({
        manifest: fixture.trainingManifest,
        out: join(root, 'gpu-job'),
      }),
    ).toThrow(/providerDropAudit/)
  })

  it('runs through the command-line entrypoint', () => {
    const root = makeTempRoot()
    const fixture = makeTrainingRunFixture(root)
    const out = join(root, 'cli-gpu-job')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/prepare-diffsinger-gpu-job.mjs',
        '--manifest',
        fixture.trainingManifest,
        '--out',
        out,
        '--remote-host',
        'gpu.example',
        '--remote-work-dir',
        '/runs/webuta-cli',
        '--checkpoint-step',
        '12000',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.checkpointStep).toBe(12000)
    expect(existsSync(join(out, 'gpu-job.manifest.json'))).toBe(true)
    expect(existsSync(join(out, 'training', 'config.remote.yaml'))).toBe(true)
  })
})

function makeTrainingRunFixture(root, overrides = {}) {
  const datasetDir = join(root, 'dataset')
  const wavDir = join(datasetDir, 'wavs')
  const runDir = join(root, 'training-run')
  const trainWorkDir = join(runDir, 'train')
  mkdirSync(wavDir, { recursive: true })
  mkdirSync(trainWorkDir, { recursive: true })
  writeFileSync(join(wavDir, 'song-001.wav'), '')
  writeFileSync(join(datasetDir, 'transcriptions.csv'), 'name,ph_seq,ph_dur\nsong-001,k o SP,0.1 0.2 0.1\n')
  writeFileSync(join(runDir, 'dictionary-ko.txt'), 'ph_0001\tk\nph_0002\to\n')
  const providerDropAudit = overrides.providerDropAudit === undefined ? join(runDir, 'provider-drop-audit.json') : overrides.providerDropAudit
  if (providerDropAudit) {
    writeJson(providerDropAudit, {
      version: 1,
      ok: true,
      decision: 'provider-archive-ready',
      production: true,
      datasetId: 'licensed-ko',
      metrics: {
        archiveCount: 1,
        hashedArchiveCount: 1,
        totalSizeBytes: 1073741824,
      },
      archives: [
        {
          path: join(root, 'raw', 'licensed-ko.zip'),
          sha256: 'a'.repeat(64),
        },
      ],
    })
  }
  const productionPreflight = overrides.productionPreflight ?? { production: true, ok: true, required: true }
  writeFileSync(
    join(runDir, 'config.yaml'),
    yaml.dump({
      base_config: [join(root, 'DiffSinger', 'configs', 'acoustic.yaml')],
      dictionaries: {
        ko: join(runDir, 'dictionary-ko.txt'),
      },
      datasets: [
        {
          raw_data_dir: datasetDir,
          speaker: 'webuta_ko',
          language: 'ko',
          test_prefixes: ['song-001'],
        },
      ],
      binary_data_dir: join(runDir, 'binary'),
      max_updates: 200000,
      pl_trainer_accelerator: 'gpu',
      pl_trainer_devices: 1,
      pl_trainer_precision: '32-true',
    }),
  )
  const checkpointManifest = join(runDir, 'model-checkpoint.template.json')
  writeFileSync(
    checkpointManifest,
    JSON.stringify(
      {
        version: 1,
        training: {
          runDir: trainWorkDir,
          checkpoint: {
            step: 200000,
            path: join(trainWorkDir, 'model_ckpt_steps_200000.ckpt'),
          },
        },
        ...(providerDropAudit ? { providerDropAudit } : {}),
        evidence: {
          ...(providerDropAudit ? { providerDropAudit } : {}),
          productionPreflight,
        },
      },
      null,
      2,
    ),
  )
  const trainingManifest = join(runDir, 'diffsinger-training.manifest.json')
  writeFileSync(
    trainingManifest,
    JSON.stringify(
      {
        version: 1,
        source: 'webuta-diffsinger-training-run',
        runId: 'run-001',
        datasetIds: overrides.datasetIds ?? ['licensed-ko'],
        datasetDir,
        config: join(runDir, 'config.yaml'),
        dictionary: join(runDir, 'dictionary-ko.txt'),
        checkpointManifest,
        language: 'ko',
        trainWorkDir,
        preflight: productionPreflight,
        ...(providerDropAudit ? { providerDropAudit } : {}),
        training: {
          maxUpdates: 200000,
          devices: 1,
          precision: '32-true',
        },
      },
      null,
      2,
    ),
  )
  return { trainingManifest, providerDropAudit }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-diffsinger-gpu-job-'))
  tempRoots.push(root)
  return root
}
