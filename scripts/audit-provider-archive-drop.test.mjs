import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { auditProviderArchiveDrop } from './audit-provider-archive-drop.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('provider archive drop audit', () => {
  it('passes a complete supported raw provider archive drop', async () => {
    const fixture = makeDatasetFixture({
      qualityGates: {
        minProviderArchiveCount: 1,
        minProviderArchiveTotalBytes: 100,
      },
    })
    await writeZip(join(fixture.datasetRoot, 'raw', 'aihub-guide-vocal.zip'), {
      'wav/song-a.wav': 'wav placeholder',
      'metadata/song-a.csv': 'start,end,lyric,midi_num\n0.0,0.5,도,60\n',
    })

    const report = auditProviderArchiveDrop({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      inspectEntries: true,
    })

    expect(report).toMatchObject({
      ok: true,
      decision: 'provider-archive-ready',
      metrics: {
        archiveCount: 1,
        supportedArchiveCount: 1,
        unsupportedArchiveCount: 0,
        hashedArchiveCount: 1,
      },
    })
    expect(report.archives[0].sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(report.archives[0].entryInspection).toMatchObject({
      entryCount: 4,
      unsafeEntries: [],
    })
  })

  it('blocks production when the raw archive drop is too small', async () => {
    const fixture = makeDatasetFixture({
      qualityGates: {
        minProviderArchiveCount: 1,
        minProviderArchiveTotalBytes: 1024 * 1024,
      },
    })
    await writeZip(join(fixture.datasetRoot, 'raw', 'tiny.zip'), {
      'song-a.wav': 'tiny',
    })

    const report = auditProviderArchiveDrop({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      production: true,
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('provider-archive-blocked')
    expect(report.problems.join('\n')).toContain('required at least 1.00 MiB')
  })

  it('separates ignored non-archive notes from unsupported provider archives', () => {
    const fixture = makeDatasetFixture()
    writeFileSync(join(fixture.datasetRoot, 'raw', 'README.txt'), 'manual note')
    writeFileSync(join(fixture.datasetRoot, 'raw', 'provider.7z'), 'unsupported archive')

    const report = auditProviderArchiveDrop({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
    })

    expect(report.ok).toBe(false)
    expect(report.metrics).toMatchObject({
      archiveCount: 1,
      unsupportedArchiveCount: 1,
      nonArchiveFileCount: 1,
      hashedArchiveCount: 1,
    })
    expect(report.problems.join('\n')).toContain('unsupported archive')
    expect(report.warnings.join('\n')).toContain('non-archive')
  })

  it('runs from the command line and writes a report', async () => {
    const fixture = makeDatasetFixture({
      qualityGates: {
        minProviderArchiveTotalBytes: 100,
      },
    })
    const reportPath = join(fixture.root, 'provider-drop.json')
    await writeZip(join(fixture.datasetRoot, 'raw', 'provider.zip'), {
      'song-a.wav': 'wav placeholder',
    })

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-provider-archive-drop.mjs',
        '--registry',
        fixture.registryPath,
        '--dataset',
        'aihub-guide-vocal',
        '--report',
        reportPath,
        '--inspect-entries',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    expect(report.archives[0].sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).archives[0].entryInspection.entryCount).toBe(1)
  })

  it('can skip archive hashing for a fast metadata-only pass', async () => {
    const fixture = makeDatasetFixture({
      qualityGates: {
        minProviderArchiveTotalBytes: 100,
      },
    })
    await writeZip(join(fixture.datasetRoot, 'raw', 'provider.zip'), {
      'song-a.wav': 'wav placeholder',
    })

    const report = auditProviderArchiveDrop({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      hashArchives: false,
    })

    expect(report.ok).toBe(true)
    expect(report.gates.hashArchives).toBe(false)
    expect(report.metrics.hashedArchiveCount).toBe(0)
    expect(report.archives[0].sha256).toBeNull()
  })
})

function makeDatasetFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-provider-drop-'))
  tempRoots.push(root)
  const datasetRoot = join(root, 'aihub-guide-vocal')
  const registryPath = join(root, 'registry.local.json')
  mkdirSync(join(datasetRoot, 'raw'), { recursive: true })
  mkdirSync(join(datasetRoot, 'extracted'), { recursive: true })
  mkdirSync(join(datasetRoot, 'metadata'), { recursive: true })
  writeJson(registryPath, makeRegistry(datasetRoot, options.qualityGates))
  return { root, datasetRoot, registryPath }
}

function makeRegistry(localPath, qualityGates = {}) {
  return {
    version: 1,
    datasets: [
      {
        id: 'aihub-guide-vocal',
        name: 'AI Hub guide vocal fixture',
        sourceUrl: 'https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=473',
        localPath,
        licenseStatus: 'review-required-aihub-terms',
        redistribution: 'review-required-aihub-terms',
        modelPublishing: 'review-required-aihub-terms',
        singerIdentity: 'licensed-dataset',
        language: ['ko'],
        annotationTypes: ['audio', 'midi', 'csv', 'json', 'note-timing', 'pitch'],
        licenseReview: {
          requiresReview: true,
          templatePath: join(localPath, 'metadata', 'license-review.local.template.md'),
          reviewedPath: join(localPath, 'metadata', 'license-review.local.md'),
          requiredFields: ['Reviewer', 'Review date', 'Account/download approval confirmed', 'Local training allowed'],
        },
        qualityGates: {
          minAnnotatedRatio: 0.95,
          ...qualityGates,
        },
        allowedActions: {
          localTraining: false,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        reviewNotes: [],
      },
    ],
  }
}

async function writeZip(path, files) {
  mkdirSync(dirname(path), { recursive: true })
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content)
  }
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
