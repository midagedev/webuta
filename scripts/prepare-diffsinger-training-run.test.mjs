import * as yaml from 'js-yaml'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDiffSingerTrainingRun } from './prepare-diffsinger-training-run.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('DiffSinger training run preparation', () => {
  it('writes a reusable training config, run manifest, and checkpoint template', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root)
    const diffSingerRoot = makeDiffSingerFixture(root)
    const readiness = join(root, 'readiness.json')
    const providerDropAudit = join(root, 'provider-drop.json')
    const out = join(root, 'out')
    writeFileSync(readiness, JSON.stringify({ ok: true, datasetId: 'licensed-ko' }))
    writeProviderDrop(providerDropAudit, 'licensed-ko')

    const result = prepareDiffSingerTrainingRun({
      datasetDir,
      diffSingerRoot,
      python: join(root, 'python'),
      out,
      dataset: 'licensed-ko',
      trainingReadiness: readiness,
      providerDropAudit,
      modelId: 'webuta-ko-v1',
      modelName: 'WebUtau KO V1',
      runId: 'licensed-ko-run',
      validationRatio: 0.25,
      maxUpdates: 12000,
      checkpointStep: 12000,
      minCheckpointStep: 1000,
      accelerator: 'gpu',
      devices: 1,
    })

    expect(result).toMatchObject({
      itemCount: 4,
      trainItemCount: 3,
      validationItemCount: 1,
      phoneInventoryCount: 11,
      maxUpdates: 12000,
      checkpointStep: 12000,
    })
    expect(readFileSync(join(out, 'dictionary-ko.txt'), 'utf8')).toContain('\tk\n')

    const config = yaml.load(readFileSync(join(out, 'config.yaml'), 'utf8'))
    expect(config.datasets[0]).toMatchObject({
      raw_data_dir: datasetDir,
      speaker: 'webuta_ko',
      language: 'ko',
      test_prefixes: ['song-004'],
    })
    expect(config.max_updates).toBe(12000)
    expect(config.pl_trainer_accelerator).toBe('gpu')
    expect(config.val_with_vocoder).toBe(false)
    expect(config.hidden_size).toBe(256)
    expect(config.use_key_shift_embed).toBe(true)
    expect(config.use_speed_embed).toBe(true)
    expect(config.augmentation_args.random_pitch_shifting.enabled).toBe(true)
    expect(config.augmentation_args.random_time_stretching.enabled).toBe(true)

    const manifest = JSON.parse(readFileSync(join(out, 'diffsinger-training.manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      source: 'webuta-diffsinger-training-run',
      datasetIds: ['licensed-ko'],
      runId: 'licensed-ko-run',
      trainItemCount: 3,
      validationItemCount: 1,
      preflight: {
        production: false,
        passed: true,
      },
      providerDropAudit,
    })
    expect(manifest.commands.binarize).toContain('scripts/binarize.py')

    const checkpointManifest = JSON.parse(readFileSync(join(out, 'model-checkpoint.template.json'), 'utf8'))
    expect(checkpointManifest).toMatchObject({
      model: {
        id: 'webuta-ko-v1',
        name: 'WebUtau KO V1',
        renderer: 'diffsinger',
      },
      datasetIds: ['licensed-ko'],
      training: {
        runId: 'licensed-ko-run',
        minCheckpointStep: 1000,
        checkpoint: {
          step: 12000,
        },
      },
      runtime: {
        ckpt: 12000,
      },
      evidence: {
        trainingReadiness: readiness,
        providerDropAudit,
        productionPreflight: {
          production: false,
          passed: true,
        },
      },
    })
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('npm run neural:audit-checkpoint')
  })

  it('honors explicit validation prefixes and blocks an empty training split', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root)
    const diffSingerRoot = makeDiffSingerFixture(root)

    const result = prepareDiffSingerTrainingRun({
      datasetDir,
      diffSingerRoot,
      out: join(root, 'ok'),
      validationPrefixes: 'song-002,song-003',
      maxUpdates: 2000,
      accelerator: 'cpu',
    })

    const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'))
    expect(manifest.validationItems).toEqual(['song-002', 'song-003'])
    expect(result.trainItemCount).toBe(2)

    expect(() =>
      prepareDiffSingerTrainingRun({
        datasetDir,
        diffSingerRoot,
        out: join(root, 'bad'),
        validationPrefixes: 'song-',
      }),
    ).toThrow(/empty training set/)
  })

  it('fails early when AP or SP is missing from the aligned corpus', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root, 'name,ph_seq,ph_dur\nsong-001,k o,0.1 0.2\nsong-002,t u,0.1 0.2\n')

    expect(() =>
      prepareDiffSingerTrainingRun({
        datasetDir,
        diffSingerRoot: makeDiffSingerFixture(root),
      }),
    ).toThrow(/must include AP/)
  })

  it('rejects failed or mismatched readiness evidence before writing a training run', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root)
    const diffSingerRoot = makeDiffSingerFixture(root)
    const failedReadiness = join(root, 'failed-readiness.json')
    const mismatchedReadiness = join(root, 'mismatched-readiness.json')
    writeFileSync(failedReadiness, JSON.stringify({ ok: false, datasetId: 'licensed-ko' }))
    writeFileSync(mismatchedReadiness, JSON.stringify({ ok: true, datasetId: 'other-ko' }))

    expect(() =>
      prepareDiffSingerTrainingRun({
        datasetDir,
        diffSingerRoot,
        out: join(root, 'failed'),
        dataset: 'licensed-ko',
        trainingReadiness: failedReadiness,
      }),
    ).toThrow(/not ok/)

    expect(() =>
      prepareDiffSingerTrainingRun({
        datasetDir,
        diffSingerRoot,
        out: join(root, 'mismatched'),
        dataset: 'licensed-ko',
        trainingReadiness: mismatchedReadiness,
      }),
    ).toThrow(/not listed/)
  })

  it('enforces production preflight gates when requested', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root)
    const diffSingerRoot = makeDiffSingerFixture(root)
    const readiness = join(root, 'readiness.json')
    const providerDropAudit = join(root, 'provider-drop.json')
    writeFileSync(readiness, JSON.stringify({ ok: true, datasetId: 'licensed-ko', metrics: { totalMinutes: 12 } }))
    writeProviderDrop(providerDropAudit, 'licensed-ko')

    expect(() =>
      prepareDiffSingerTrainingRun({
        datasetDir,
        diffSingerRoot,
        out: join(root, 'too-small'),
        dataset: 'licensed-ko',
        trainingReadiness: readiness,
        providerDropAudit,
        production: true,
        maxUpdates: 12000,
      }),
    ).toThrow(/duration, training-items, updates/)

    const result = prepareDiffSingerTrainingRun({
      datasetDir,
      diffSingerRoot,
      out: join(root, 'production-ok'),
      dataset: 'licensed-ko',
      trainingReadiness: readiness,
      providerDropAudit,
      production: true,
      maxUpdates: 50000,
      minProductionMinutes: 10,
      minProductionTrainItems: 3,
      minProductionUpdates: 50000,
    })
    const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'))
    expect(manifest.preflight).toMatchObject({
      production: true,
      passed: true,
    })
    expect(manifest.preflight.checks.find((check) => check.id === 'provider-drop')).toMatchObject({
      passed: true,
      enforced: true,
    })
  })

  it('requires provider archive provenance for production training preparation', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root)
    const diffSingerRoot = makeDiffSingerFixture(root)
    const readiness = join(root, 'readiness.json')
    writeFileSync(readiness, JSON.stringify({ ok: true, datasetId: 'licensed-ko', metrics: { totalMinutes: 12 } }))

    expect(() =>
      prepareDiffSingerTrainingRun({
        datasetDir,
        diffSingerRoot,
        out: join(root, 'missing-provider-drop'),
        dataset: 'licensed-ko',
        trainingReadiness: readiness,
        production: true,
        maxUpdates: 50000,
        minProductionMinutes: 10,
        minProductionTrainItems: 3,
        minProductionUpdates: 50000,
      }),
    ).toThrow(/provider-drop/)
  })

  it('runs through the command-line entrypoint', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root)
    const diffSingerRoot = makeDiffSingerFixture(root)
    const out = join(root, 'cli-out')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/prepare-diffsinger-training-run.mjs',
        '--dataset-dir',
        datasetDir,
        '--diffsinger-root',
        diffSingerRoot,
        '--out',
        out,
        '--dataset',
        'licensed-ko',
        '--max-updates',
        '3000',
        '--accelerator',
        'cpu',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.maxUpdates).toBe(3000)
    expect(existsSync(join(out, 'config.yaml'))).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'model-checkpoint.template.json'), 'utf8')).datasetIds).toEqual(['licensed-ko'])
  })
})

function makeDatasetFixture(root, transcriptions = null) {
  const datasetDir = join(root, 'dataset')
  const wavDir = join(datasetDir, 'wavs')
  mkdirSync(wavDir, { recursive: true })
  writeFileSync(
    join(datasetDir, 'transcriptions.csv'),
    transcriptions ??
      [
        'name,ph_seq,ph_dur',
        'song-001,k o SP,0.1 0.2 0.1',
        'song-002,AP t u o,0.1 0.2 0.2 0.1',
        'song-003,s a ng SP,0.1 0.2 0.2 0.1',
        'song-004,AP h i,0.1 0.2 0.2',
        '',
      ].join('\n'),
  )
  for (const id of ['song-001', 'song-002', 'song-003', 'song-004']) {
    writeFileSync(join(wavDir, `${id}.wav`), '')
  }
  return datasetDir
}

function makeDiffSingerFixture(root) {
  const diffSingerRoot = join(root, 'DiffSinger')
  mkdirSync(join(diffSingerRoot, 'configs'), { recursive: true })
  writeFileSync(join(diffSingerRoot, 'configs', 'acoustic.yaml'), 'base_config: []\n')
  return diffSingerRoot
}

function writeProviderDrop(path, datasetId) {
  writeFileSync(
    path,
    JSON.stringify(
      {
        version: 1,
        ok: true,
        decision: 'provider-archive-ready',
        production: true,
        datasetId,
        gates: {
          minArchiveCount: 1,
          minTotalBytes: 1,
          minArchiveBytes: 1,
          hashArchives: true,
        },
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
            sizeBytes: 4096,
            sha256: 'a'.repeat(64),
          },
        ],
        problems: [],
      },
      null,
      2,
    ),
  )
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-diffsinger-training-run-'))
  tempRoots.push(root)
  return root
}
