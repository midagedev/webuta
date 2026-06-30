import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditDiffSingerTrainingRun } from './audit-diffsinger-training-run.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('DiffSinger training run audit', () => {
  it('passes a binarized training run with a one-step checkpoint', () => {
    const fixture = makeTrainingFixture()

    const report = auditDiffSingerTrainingRun({
      trainingManifest: fixture.trainingManifest,
      enhancedDatasetAudit: fixture.enhancedDatasetAudit,
      checkpoint: fixture.checkpoint,
      checkpointStep: 1,
      minItems: 3,
      minPhoneInventory: 3,
    })

    expect(report).toMatchObject({
      ok: true,
      decision: 'diffsinger-training-ready',
      datasetId: 'gtsinger-ko',
      metrics: {
        itemCount: 3,
        trainItemCount: 2,
        validationItemCount: 1,
        phoneInventoryCount: 4,
        checkpointStep: 1,
      },
    })
    expect(report.gates.every((gate) => gate.passed)).toBe(true)
  })

  it('blocks missing binary files before checkpoint handoff', () => {
    const fixture = makeTrainingFixture({ omitBinary: ['valid.data'] })

    const report = auditDiffSingerTrainingRun({
      trainingManifest: fixture.trainingManifest,
      enhancedDatasetAudit: fixture.enhancedDatasetAudit,
      checkpoint: fixture.checkpoint,
      checkpointStep: 1,
      minItems: 3,
      minPhoneInventory: 3,
    })

    expect(report.ok).toBe(false)
    expect(report.gates.find((gate) => gate.id === 'binary-files')).toMatchObject({
      passed: false,
    })
    expect(report.nextActions.join('\n')).toContain('binarize.py')
  })

  it('runs from the command line and writes a report', () => {
    const fixture = makeTrainingFixture()
    const reportPath = join(fixture.root, 'training-run-audit.json')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-diffsinger-training-run.mjs',
        '--training-manifest',
        fixture.trainingManifest,
        '--enhanced-dataset-audit',
        fixture.enhancedDatasetAudit,
        '--checkpoint',
        fixture.checkpoint,
        '--checkpoint-step',
        '1',
        '--min-items',
        '3',
        '--min-phone-inventory',
        '3',
        '--report',
        reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).decision).toBe('diffsinger-training-ready')
  })
})

function makeTrainingFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-diffsinger-training-audit-'))
  tempRoots.push(root)
  const binaryDir = join(root, 'binary')
  mkdirSync(binaryDir, { recursive: true })
  for (const name of ['dictionary-ko.txt', 'train.data', 'train.meta', 'valid.data', 'valid.meta', 'spk_map.json', 'lang_map.json']) {
    if (options.omitBinary?.includes(name)) {
      continue
    }
    writeFileSync(join(binaryDir, name), `${name}\n`)
  }
  const trainingManifest = join(root, 'diffsinger-training.manifest.json')
  writeFileSync(
    trainingManifest,
    `${JSON.stringify(
      {
        version: 1,
        datasetIds: ['gtsinger-ko'],
        binaryDataDir: binaryDir,
        itemCount: 3,
        trainItemCount: 2,
        validationItemCount: 1,
        phoneInventoryCount: 4,
      },
      null,
      2,
    )}\n`,
  )
  const enhancedDatasetAudit = join(root, 'enhanced-audit.json')
  writeFileSync(
    enhancedDatasetAudit,
    `${JSON.stringify(
      {
        ok: true,
        decision: 'enhanced-dataset-ready',
        metrics: {
          itemCount: 3,
          wavItemCount: 3,
          validWavDurationSeconds: 42,
          hasAp: true,
          hasSp: true,
        },
      },
      null,
      2,
    )}\n`,
  )
  const checkpoint = join(root, 'model_ckpt_steps_1.ckpt')
  writeFileSync(checkpoint, 'checkpoint')
  return { root, trainingManifest, enhancedDatasetAudit, checkpoint }
}
