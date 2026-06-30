import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { extractNeuralDatasetArchives } from './extract-neural-dataset-archives.mjs'
import { inspectNeuralDatasetIntake } from './inspect-neural-dataset-intake.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural dataset archive extraction', () => {
  it('extracts raw provider zips into per-archive folders and leaves an inspectable intake', async () => {
    const fixture = makeDatasetFixture()
    await writeZip(join(fixture.datasetRoot, 'raw', 'aihub-guide-vocal.zip'), {
      'wav/song-a.wav': 'wav placeholder',
      'metadata/song-a.csv': 'start,end,lyric,midi_num\n0.0,0.5,도,60\n',
    })

    const report = extractNeuralDatasetArchives({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
    })

    const extractedRoot = join(fixture.datasetRoot, 'extracted', 'aihub-guide-vocal')
    expect(report).toMatchObject({
      ok: true,
      archiveCount: 1,
      dryRun: false,
      results: [
        {
          destination: extractedRoot,
          entryCount: 4,
          filesBefore: 0,
          filesAfter: 2,
          extractedFileCount: 2,
        },
      ],
    })
    expect(existsSync(join(extractedRoot, 'wav', 'song-a.wav'))).toBe(true)
    expect(existsSync(join(extractedRoot, 'metadata', 'song-a.csv'))).toBe(true)

    const intake = inspectNeuralDatasetIntake({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
    })
    expect(intake.acquisition.stage).toBe('ingest-ready-needs-license-review')
  })

  it('supports dry-run planning without writing extracted files', async () => {
    const fixture = makeDatasetFixture()
    await writeZip(join(fixture.datasetRoot, 'raw', 'aihub-guide-vocal.zip'), {
      'song-a.wav': 'wav placeholder',
    })

    const report = extractNeuralDatasetArchives({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      dryRun: true,
    })

    expect(report).toMatchObject({
      ok: true,
      archiveCount: 1,
      dryRun: true,
      results: [
        {
          entryCount: 1,
          filesAfter: 0,
          extractedFileCount: 0,
        },
      ],
    })
    expect(existsSync(join(fixture.datasetRoot, 'extracted', 'aihub-guide-vocal', 'song-a.wav'))).toBe(false)
  })

  it('refuses unsafe archive paths before extraction', async () => {
    const fixture = makeDatasetFixture()
    await writeZip(join(fixture.datasetRoot, 'raw', 'unsafe.zip'), {
      '../outside.wav': 'bad path',
    })

    expect(() =>
      extractNeuralDatasetArchives({
        registry: fixture.registryPath,
        dataset: 'aihub-guide-vocal',
      }),
    ).toThrow(/Refusing unsafe archive paths/u)
  })

  it('runs from the command line and writes a report', async () => {
    const fixture = makeDatasetFixture()
    const reportPath = join(fixture.root, 'extract-report.json')
    await writeZip(join(fixture.datasetRoot, 'raw', 'aihub-guide-vocal.zip'), {
      'song-a.wav': 'wav placeholder',
      'song-a.csv': 'start,end,lyric,midi_num\n0.0,0.5,도,60\n',
    })

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/extract-neural-dataset-archives.mjs',
        '--registry',
        fixture.registryPath,
        '--dataset',
        'aihub-guide-vocal',
        '--report',
        reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).results[0].entryCount).toBe(2)
  })
})

function makeDatasetFixture() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-archive-extract-'))
  tempRoots.push(root)
  const datasetRoot = join(root, 'aihub-guide-vocal')
  const registryPath = join(root, 'registry.json')
  mkdirSync(join(datasetRoot, 'raw'), { recursive: true })
  mkdirSync(join(datasetRoot, 'extracted'), { recursive: true })
  mkdirSync(join(datasetRoot, 'metadata'), { recursive: true })
  writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot), null, 2))
  return { root, datasetRoot, registryPath }
}

function makeRegistry(localPath) {
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
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content)
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  writeFileSync(path, bytes)
}
