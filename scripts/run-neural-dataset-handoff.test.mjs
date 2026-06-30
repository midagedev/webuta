import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { runNeuralDatasetHandoff } from './run-neural-dataset-handoff.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural dataset handoff runner', () => {
  it('reports the real-data blocker when the intake is still empty', () => {
    const fixture = makeDatasetFixture({ localTraining: false })

    const report = runNeuralDatasetHandoff({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      workDir: fixture.workDir,
      report: fixture.reportPath,
      providerDropAudit: fixture.providerDropAudit,
    })

    expect(report).toMatchObject({
      ok: false,
      status: 'blocked-awaiting-provider-download',
      dataset: 'aihub-guide-vocal',
    })
    expect(report.acquisition).toMatchObject({
      stage: 'awaiting-provider-download',
      providerDataAcquired: false,
    })
    expect(report.handoff).toMatchObject({
      sourceUrl: 'https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=473',
      rawDir: join(fixture.datasetRoot, 'raw'),
      extractedDir: join(fixture.datasetRoot, 'extracted'),
      metadataDir: join(fixture.datasetRoot, 'metadata'),
      providerDropAudit: fixture.providerDropAudit,
    })
    expect(report.handoff.checklist.join('\n')).toContain('Place the complete original provider archives')
    expect(report.handoff.commands.auditProviderDrop).toContain('neural:audit-provider-drop')
    expect(report.handoff.commands.runHandoff).toContain('--limit-files 10')
    expect(report.steps.map((step) => step.id)).toEqual(['inspect-intake'])
    expect(existsSync(fixture.reportPath)).toBe(true)
  })

  it('extracts provider archives and materializes sidecars before stopping for license review', async () => {
    const fixture = makeDatasetFixture({ localTraining: false })
    await writeProviderZip(join(fixture.datasetRoot, 'raw', 'provider.zip'))

    const report = runNeuralDatasetHandoff({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      workDir: fixture.workDir,
      report: fixture.reportPath,
      providerDropAudit: fixture.providerDropAudit,
      minLocalTrainingMinutes: 0.03,
    })

    expect(report.ok).toBe(false)
    expect(report.status).toBe('blocked-license-review')
    expect(report.steps.map((step) => step.id)).toEqual([
      'inspect-intake',
      'audit-provider-archive-drop',
      'extract-provider-archives',
      'inspect-after-extraction',
      'materialize-sidecars',
      'inspect-after-sidecars',
    ])
    expect(report.steps.find((step) => step.id === 'audit-provider-archive-drop').summary).toMatchObject({
      ok: true,
      decision: 'provider-archive-ready',
      archiveCount: 1,
      hashedArchiveCount: 1,
    })
    expect(report.steps.find((step) => step.id === 'extract-provider-archives').summary.extractedFileCount).toBeGreaterThanOrEqual(3)
    expect(report.steps.find((step) => step.id === 'materialize-sidecars').summary.writtenCount).toBe(2)
    expect(report.acquisition).toMatchObject({
      stage: 'ingest-ready-needs-license-review',
      trainingAudioCount: 2,
      annotationPairingReady: true,
    })
    expect(report.handoff.licenseReview.reviewedPath).toBe(join(fixture.datasetRoot, 'metadata', 'license-review.local.md'))
  })

  it('blocks production handoff when provider archives are too small to be a real drop', async () => {
    const fixture = makeDatasetFixture({ localTraining: false })
    await writeProviderZip(join(fixture.datasetRoot, 'raw', 'provider.zip'))

    const report = runNeuralDatasetHandoff({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      workDir: fixture.workDir,
      report: fixture.reportPath,
      providerDropAudit: fixture.providerDropAudit,
      production: true,
      minProviderArchiveTotalBytes: 1024 * 1024,
    })

    expect(report.ok).toBe(false)
    expect(report.status).toBe('blocked-provider-archive-drop')
    expect(report.steps.map((step) => step.id)).toEqual(['inspect-intake', 'audit-provider-archive-drop'])
    expect(report.steps[1].summary).toMatchObject({
      ok: false,
      decision: 'provider-archive-blocked',
    })
    expect(report.nextActions.join('\n')).toContain('complete original provider archives')
  })

  it('runs a license-reviewed dataset through ingest, readiness, OpenVPI, dictionary, and MFA coverage', () => {
    const fixture = makeDatasetFixture({ localTraining: true })
    writeReviewedLicense(fixture.datasetRoot)
    writeTrainingWavWithSidecar(fixture.datasetRoot)
    const makeDiffSingerRoot = writeMakeDiffSingerFixture(fixture.root)

    const report = runNeuralDatasetHandoff({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      workDir: fixture.workDir,
      report: fixture.reportPath,
      providerDropAudit: fixture.providerDropAudit,
      minLocalTrainingMinutes: 0.03,
      minReadinessMinutes: 0.03,
      minUniquePhonemes: 4,
      limitFiles: 1,
      makeDiffSingerRoot,
    })

    expect(report.ok).toBe(true)
    expect(report.status).toBe('alignment-ready-needs-makediffsinger')
    expect(report.steps.map((step) => step.id)).toContain('audit-training-readiness')
    expect(report.steps.map((step) => step.id)).toContain('prepare-openvpi-seed')
    expect(report.steps.map((step) => step.id)).toContain('audit-mfa-label-coverage')
    expect(report.steps.map((step) => step.id)).toContain('prepare-makediffsinger-alignment-job')
    expect(report.artifacts).toMatchObject({
      ingestDir: join(fixture.workDir, 'ingest-slice-1'),
      openVpiSeed: join(fixture.workDir, 'openvpi-seed'),
      alignmentJob: join(fixture.workDir, 'makediffsinger-alignment-job', 'makediffsinger-alignment-job.manifest.json'),
      plannedEnhancedDatasetDir: join(fixture.workDir, 'makediffsinger-alignment-job', 'diffsinger-dataset-enhanced'),
    })
    expect(existsSync(report.artifacts.mfaDictionary)).toBe(true)
    expect(existsSync(report.artifacts.alignmentJob)).toBe(true)
    expect(JSON.parse(readFileSync(fixture.reportPath, 'utf8')).status).toBe('alignment-ready-needs-makediffsinger')
  })

  it('blocks training preparation when the enhanced DiffSinger dataset audit fails', () => {
    const fixture = makeDatasetFixture({ localTraining: true })
    const enhancedDatasetDir = writeInvalidEnhancedDataset(fixture.root)
    writeReviewedLicense(fixture.datasetRoot)
    writeTrainingWavWithSidecar(fixture.datasetRoot)
    const makeDiffSingerRoot = writeMakeDiffSingerFixture(fixture.root)

    const report = runNeuralDatasetHandoff({
      registry: fixture.registryPath,
      dataset: 'aihub-guide-vocal',
      workDir: fixture.workDir,
      report: fixture.reportPath,
      providerDropAudit: fixture.providerDropAudit,
      minLocalTrainingMinutes: 0.03,
      minReadinessMinutes: 0.03,
      minUniquePhonemes: 4,
      limitFiles: 1,
      enhancedDatasetDir,
      makeDiffSingerRoot,
    })

    expect(report.ok).toBe(false)
    expect(report.status).toBe('failed-automation')
    const enhancedAuditStep = report.steps.find((step) => step.id === 'audit-diffsinger-enhanced-dataset')
    expect(enhancedAuditStep.summary).toMatchObject({
      ok: false,
      decision: 'enhanced-dataset-blocked',
    })
    expect(report.steps.map((step) => step.id)).not.toContain('prepare-diffsinger-training')
    expect(report.nextActions.join('\n')).toContain('MakeDiffSinger-enhanced dataset')
  })

  it('runs from the command line and writes a handoff report', () => {
    const fixture = makeDatasetFixture({ localTraining: true })
    writeReviewedLicense(fixture.datasetRoot)
    writeTrainingWavWithSidecar(fixture.datasetRoot)

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/run-neural-dataset-handoff.mjs',
        '--registry',
        fixture.registryPath,
        '--dataset',
        'aihub-guide-vocal',
        '--work-dir',
        fixture.workDir,
        '--report',
        fixture.reportPath,
        '--provider-drop-audit',
        fixture.providerDropAudit,
        '--min-local-training-minutes',
        '0.03',
        '--min-readiness-minutes',
        '0.03',
        '--min-unique-phonemes',
        '4',
        '--limit-files',
        '1',
        '--make-diffsinger-root',
        writeMakeDiffSingerFixture(fixture.root),
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(existsSync(fixture.reportPath)).toBe(true)
    const writtenReport = JSON.parse(readFileSync(fixture.reportPath, 'utf8'))
    expect(writtenReport.artifacts.mfaCoverage).toContain('mfa-label-coverage.json')
    expect(writtenReport.handoff.commands.runHandoff).toContain('--report')
  })
})

function makeDatasetFixture({ localTraining }) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-dataset-handoff-'))
  tempRoots.push(root)
  const datasetRoot = join(root, 'aihub-guide-vocal')
  const registryPath = join(root, 'dataset-registry.local.json')
  const workDir = join(root, 'work')
  const reportPath = join(root, 'handoff-report.json')
  const providerDropAudit = join(workDir, 'provider-archive-drop.json')
  mkdirSync(join(datasetRoot, 'raw'), { recursive: true })
  mkdirSync(join(datasetRoot, 'extracted'), { recursive: true })
  mkdirSync(join(datasetRoot, 'metadata'), { recursive: true })
  writeJson(registryPath, makeRegistry(datasetRoot, localTraining))
  return { root, datasetRoot, registryPath, workDir, reportPath, providerDropAudit }
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
        redistribution: 'private-local-only',
        modelPublishing: localTraining ? 'private-lab-allowed' : 'review-required-aihub-terms',
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

async function writeProviderZip(path) {
  mkdirSync(dirname(path), { recursive: true })
  const zip = new JSZip()
  zip.file('wav/song-a.wav', makeSineWav({ sampleRate: 44100, seconds: 1.2, hz: 220 }))
  zip.file('wav/song-b.wav', makeSineWav({ sampleRate: 44100, seconds: 1.2, hz: 330 }))
  zip.file(
    'metadata/global-notes.csv',
    [
      'audio,start,end,lyric,midi_num',
      'wav/song-a.wav,0.0,0.4,도,60',
      'wav/song-a.wav,0.4,0.8,히,64',
      'wav/song-a.wav,0.8,1.2,도,67',
      'wav/song-b.wav,0.0,0.4,다,62',
      'wav/song-b.wav,0.4,0.8,이,65',
      'wav/song-b.wav,0.8,1.2,스키,69',
      '',
    ].join('\n'),
  )
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }))
}

function writeTrainingWavWithSidecar(datasetRoot) {
  const outDir = join(datasetRoot, 'extracted')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'song-a.wav'), makeSineWav({ sampleRate: 44100, seconds: 2.1, hz: 220 }))
  writeFileSync(
    join(outDir, 'song-a.csv'),
    [
      'start,end,lyric,midi_num',
      '0.0,0.7,도,60',
      '0.7,1.4,히,64',
      '1.4,2.1,다,67',
      '',
    ].join('\n'),
  )
}

function writeReviewedLicense(datasetRoot) {
  writeFileSync(
    join(datasetRoot, 'metadata', 'license-review.local.md'),
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
}

function writeInvalidEnhancedDataset(root) {
  const datasetDir = join(root, 'invalid-enhanced')
  const wavDir = join(datasetDir, 'wavs')
  mkdirSync(wavDir, { recursive: true })
  writeFileSync(join(datasetDir, 'transcriptions.csv'), 'name,ph_seq,ph_dur\nsong-001,k o SP,0.4 0.4\nsong-002,AP t u,0.2 0.2 0.6\n')
  writeFileSync(join(wavDir, 'song-001.wav'), makeSineWav({ sampleRate: 44100, seconds: 0.8, hz: 220 }))
  writeFileSync(join(wavDir, 'song-002.wav'), makeSineWav({ sampleRate: 44100, seconds: 1, hz: 330 }))
  return datasetDir
}

function writeMakeDiffSingerFixture(root) {
  const toolDir = join(root, 'MakeDiffSinger', 'acoustic_forced_alignment')
  mkdirSync(toolDir, { recursive: true })
  for (const script of ['validate_labels.py', 'reformat_wavs.py', 'check_tg.py', 'enhance_tg.py', 'build_dataset.py']) {
    writeFileSync(join(toolDir, script), '# fixture\n')
  }
  return join(root, 'MakeDiffSinger')
}

function makeSineWav({ sampleRate, seconds, hz }) {
  const sampleCount = Math.round(sampleRate * seconds)
  const dataBytes = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * hz * index) / sampleRate) * 0x3000)
    buffer.writeInt16LE(value, 44 + index * 2)
  }
  return buffer
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
