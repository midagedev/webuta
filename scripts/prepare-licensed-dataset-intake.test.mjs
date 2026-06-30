import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareLicensedDatasetIntake } from './prepare-licensed-dataset-intake.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('licensed Korean singing dataset intake preparation', () => {
  it('creates a consent/license-first AI Hub guide-vocal intake registry', () => {
    const root = makeTempRoot()
    const localPath = join(root, 'aihub-guide-vocal')
    const registryOut = join(root, 'registry.local.json')

    const result = prepareLicensedDatasetIntake({
      preset: 'aihub-guide-vocal',
      localPath,
      registryOut,
    })

    expect(result).toMatchObject({
      preset: 'aihub-guide-vocal',
      allowLocalTraining: false,
      sourceUrl: 'https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=473',
    })
    expect(existsSync(join(localPath, 'raw'))).toBe(true)
    expect(existsSync(join(localPath, 'extracted'))).toBe(true)
    expect(existsSync(join(localPath, 'metadata', 'license-review.local.template.md'))).toBe(true)
    const registry = JSON.parse(readFileSync(registryOut, 'utf8'))
    expect(registry.datasets[0]).toMatchObject({
      id: 'aihub-guide-vocal',
      annotationTypes: ['audio', 'midi', 'csv', 'json', 'note-timing', 'pitch'],
      licenseReview: {
        requiresReview: true,
        reviewedPath: join(localPath, 'metadata', 'license-review.local.md'),
      },
      qualityGates: {
        minAnnotatedRatio: 0.95,
        minProviderArchiveCount: 1,
      },
      allowedActions: {
        localTraining: false,
        publicModelRelease: false,
        publicAudioExamples: false,
      },
    })
    expect(readFileSync(join(localPath, 'README.md'), 'utf8')).toContain('npm run neural:audit-datasets')
    expect(readFileSync(join(localPath, 'README.md'), 'utf8')).toContain('npm run neural:audit-provider-drop')
    expect(readFileSync(join(localPath, 'README.md'), 'utf8')).toContain('npm run neural:extract-dataset')
    expect(readFileSync(join(localPath, 'README.md'), 'utf8')).toContain('license-review.local.md')
  })

  it('can generate a reviewed local-training registry from the command line', () => {
    const root = makeTempRoot()
    const localPath = join(root, 'aihub-multispeaker')
    const registryOut = join(root, 'registry.local.json')
    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/prepare-licensed-dataset-intake.mjs',
        '--preset',
        'aihub-multispeaker-singing',
        '--local-path',
        localPath,
        '--registry-out',
        registryOut,
        '--allow-local-training',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)
    const registry = JSON.parse(readFileSync(registryOut, 'utf8'))

    expect(result.allowLocalTraining).toBe(true)
    expect(registry.datasets[0]).toMatchObject({
      id: 'aihub-multispeaker-singing',
      licenseStatus: 'license-reviewed-local-training',
      allowedActions: {
        localTraining: true,
      },
    })
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-dataset-intake-'))
  tempRoots.push(root)
  return root
}
