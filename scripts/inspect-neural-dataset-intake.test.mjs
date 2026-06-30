import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectNeuralDatasetIntake } from './inspect-neural-dataset-intake.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural dataset intake inspection', () => {
  it('keeps an empty prepared intake in awaiting-provider-download stage', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'aihub-guide-vocal')
    const registryPath = join(root, 'registry.json')
    mkdirSync(join(datasetRoot, 'raw'), { recursive: true })
    mkdirSync(join(datasetRoot, 'extracted'), { recursive: true })
    mkdirSync(join(datasetRoot, 'metadata'), { recursive: true })
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, false), null, 2))

    const report = inspectNeuralDatasetIntake({
      registry: registryPath,
      dataset: 'aihub-guide-vocal',
    })

    expect(report.ok).toBe(false)
    expect(report.acquisition).toMatchObject({
      stage: 'awaiting-provider-download',
      providerDataAcquired: false,
      providerArchiveCount: 0,
      trainingAudioCount: 0,
      canStartDatasetAudit: false,
      canStartIngest: false,
    })
    expect(report.acquisition.blockers.join('\n')).toContain('Provider data has not been acquired yet')
    expect(report.acquisition.nextActions.join('\n')).toContain('Download the dataset')
  })

  it('recognizes a downloaded provider archive before extraction', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'aihub-guide-vocal')
    const registryPath = join(root, 'registry.json')
    mkdirSync(join(datasetRoot, 'raw'), { recursive: true })
    mkdirSync(join(datasetRoot, 'extracted'), { recursive: true })
    writeFileSync(join(datasetRoot, 'raw', 'aihub-guide-vocal.zip'), 'provider archive placeholder')
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, false), null, 2))

    const report = inspectNeuralDatasetIntake({
      registry: registryPath,
      dataset: 'aihub-guide-vocal',
    })

    expect(report.ok).toBe(true)
    expect(report.archives).toMatchObject({
      count: 1,
      extensions: {
        '.zip': 1,
      },
    })
    expect(report.readiness).toMatchObject({
      hasProviderArchive: true,
      hasTrainingAudio: false,
      needsExtraction: true,
      ingestReady: false,
    })
    expect(report.acquisition).toMatchObject({
      stage: 'archive-ready-for-extraction',
      providerDataAcquired: true,
      providerArchiveCount: 1,
      trainingAudioCount: 0,
      licenseReviewComplete: false,
      canStartDatasetAudit: false,
      canStartIngest: false,
    })
    expect(report.acquisition.nextActions.join('\n')).toContain('Extract provider archives')
    expect(report.readiness.warnings.join('\n')).toContain('no extracted training audio')
  })

  it('marks extracted same-stem WAV and CSV note labels as ingest-ready', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'aihub-guide-vocal')
    const extractedRoot = join(datasetRoot, 'extracted')
    const metadataRoot = join(datasetRoot, 'metadata')
    const registryPath = join(root, 'registry.json')
    mkdirSync(extractedRoot, { recursive: true })
    mkdirSync(metadataRoot, { recursive: true })
    writeFileSync(join(extractedRoot, 'song-a.wav'), 'wav placeholder')
    writeFileSync(join(extractedRoot, 'song-a.csv'), 'start,end,lyric,midi_num\n0.0,0.5,도,60\n0.5,1.0,히,64\n')
    writeFileSync(
      join(metadataRoot, 'license-review.local.md'),
      [
        '# License Review Fixture',
        '',
        '- Reviewer: Test Reviewer',
        '- Review date: 2026-06-30',
        '- Account/download approval confirmed: yes',
        '- Local training allowed: yes',
        '- Public model release allowed: no',
        '- Public audio examples allowed: no',
        '',
      ].join('\n'),
    )
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const report = inspectNeuralDatasetIntake({
      registry: registryPath,
      dataset: 'aihub-guide-vocal',
    })

    expect(report.readiness).toMatchObject({
      hasTrainingAudio: true,
      sameStemAnnotationReady: true,
      structuredNoteMetadataReady: true,
      ingestReady: true,
      suggestedDatasetRoot: extractedRoot,
      blockers: [],
    })
    expect(report.acquisition).toMatchObject({
      stage: 'ready-for-audit-and-ingest',
      licenseReviewComplete: true,
      annotationPairingReady: true,
      canStartDatasetAudit: true,
      canStartIngest: true,
    })
    expect(report.annotations.pairing).toMatchObject({
      pairedCount: 1,
      missingCount: 0,
      annotatedRatio: 1,
      extensions: {
        '.csv': 1,
      },
    })
    expect(report.licenseReview).toMatchObject({
      reviewedExists: true,
      filledFields: {
        localTrainingAllowed: true,
      },
    })
  })

  it('flags global note metadata that still needs a dataset-specific mapping adapter', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'aihub-guide-vocal')
    const extractedRoot = join(datasetRoot, 'extracted')
    const metadataRoot = join(datasetRoot, 'metadata')
    const registryPath = join(root, 'registry.json')
    mkdirSync(extractedRoot, { recursive: true })
    mkdirSync(metadataRoot, { recursive: true })
    writeFileSync(join(extractedRoot, 'song-a.wav'), 'wav placeholder')
    writeFileSync(join(metadataRoot, 'notes.csv'), 'audio,start,end,lyric,midi_num\nsong-a.wav,0.0,0.5,가,60\n')
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, false), null, 2))

    const report = inspectNeuralDatasetIntake({
      registry: registryPath,
      dataset: 'aihub-guide-vocal',
    })

    expect(report.readiness).toMatchObject({
      hasTrainingAudio: true,
      sameStemAnnotationReady: false,
      structuredNoteMetadataReady: true,
      needsMetadataAdapter: true,
      ingestReady: false,
    })
    expect(report.acquisition).toMatchObject({
      stage: 'metadata-ready-needs-sidecars',
      sidecarMaterializationCandidate: true,
      canStartDatasetAudit: false,
      canStartIngest: false,
    })
    expect(report.acquisition.nextActions.join('\n')).toContain('neural:materialize-sidecars')
    expect(report.annotations.structuredMetadata).toMatchObject({
      timingFileCount: 1,
      pitchFileCount: 1,
      hangulFileCount: 1,
      audioReferenceFileCount: 1,
    })
    expect(report.readiness.blockers.join('\n')).toContain('same-stem or sibling annotations')
  })

  it('runs from the command line and writes a report file', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const reportPath = join(root, 'report.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'take.wav'), 'wav placeholder')
    writeFileSync(join(datasetRoot, 'take.txt'), '선명한 노래')

    const stdout = execFileSync(
      process.execPath,
      ['scripts/inspect-neural-dataset-intake.mjs', '--local-path', datasetRoot, '--report', reportPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.readiness.ingestReady).toBe(true)
    expect(report.acquisition.stage).toBe('ready-for-audit-and-ingest')
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).audio.trainingFileCount).toBe(1)
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-intake-inspect-'))
  tempRoots.push(root)
  return root
}

function makeRegistry(localPath, localTraining) {
  return {
    version: 1,
    datasets: [
      {
        id: 'aihub-guide-vocal',
        name: 'AI Hub guide vocal fixture',
        sourceUrl: 'https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=473',
        localPath,
        licenseStatus: localTraining ? 'license-reviewed-local-training' : 'review-required-aihub-terms',
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
          localTraining,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        reviewNotes: [],
      },
    ],
  }
}
