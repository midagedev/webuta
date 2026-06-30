import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditNeuralTrainingReadiness } from './audit-neural-training-readiness.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural training readiness audit', () => {
  it('passes an ingest summary that meets duration, annotation, signal, and registry gates', () => {
    const root = makeTempRoot()
    const ingestDir = join(root, 'ingest')
    const registryPath = join(root, 'registry.json')
    mkdirSync(ingestDir, { recursive: true })
    writeFileSync(join(ingestDir, 'summary.json'), JSON.stringify(makeSummary({ totalDurationSeconds: 1900 }), null, 2))
    writeFileSync(registryPath, JSON.stringify(makeRegistry(true), null, 2))

    const report = auditNeuralTrainingReadiness({
      ingestDir,
      registry: registryPath,
      minMinutes: 30,
    })

    expect(report.ok).toBe(true)
    expect(report.metrics.totalMinutes).toBeGreaterThan(30)
    expect(report.registry).toMatchObject({ allowedLocalTraining: true })
    expect(report.nextActions).toEqual(['Proceed to OpenVPI seed preparation, MFA alignment, and DiffSinger training.'])
  })

  it('fails with concrete next actions for short unreviewed datasets', () => {
    const root = makeTempRoot()
    const ingestDir = join(root, 'ingest')
    const registryPath = join(root, 'registry.json')
    mkdirSync(ingestDir, { recursive: true })
    writeFileSync(
      join(ingestDir, 'summary.json'),
      JSON.stringify(
        makeSummary({
          audioCount: 10,
          annotatedFiles: 4,
          totalDurationSeconds: 120,
          uniquePhonemes: ['a', 'n', 'g'],
          medianRms: 0.002,
          meanSilenceRatio: 0.8,
          meanVoicedRatio: 0.1,
        }),
        null,
        2,
      ),
    )
    writeFileSync(registryPath, JSON.stringify(makeRegistry(false), null, 2))

    const report = auditNeuralTrainingReadiness({
      ingestDir,
      registry: registryPath,
      minMinutes: 30,
    })

    expect(report.ok).toBe(false)
    expect(report.gates.filter((gate) => !gate.passed).map((gate) => gate.id)).toEqual([
      'registry-local-training',
      'duration',
      'annotations',
      'phoneme-coverage',
      'rms-min',
      'silence',
      'voiced-coverage',
    ])
    expect(report.nextActions.join('\n')).toContain('Review consent')
    expect(report.nextActions.join('\n')).toContain('Record more clean')
  })

  it('runs through the command-line entrypoint and writes a report file', () => {
    const root = makeTempRoot()
    const ingestDir = join(root, 'ingest')
    const registryPath = join(root, 'registry.json')
    const reportPath = join(root, 'readiness.json')
    mkdirSync(ingestDir, { recursive: true })
    writeFileSync(join(ingestDir, 'summary.json'), JSON.stringify(makeSummary({ totalDurationSeconds: 70 }), null, 2))
    writeFileSync(registryPath, JSON.stringify(makeRegistry(true), null, 2))

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-neural-training-readiness.mjs',
        '--ingest-dir',
        ingestDir,
        '--registry',
        registryPath,
        '--min-minutes',
        '1',
        '--report',
        reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).ok).toBe(true)
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-training-readiness-'))
  tempRoots.push(root)
  return root
}

function makeSummary({
  audioCount = 10,
  annotatedFiles = 10,
  totalDurationSeconds = 1800,
  uniquePhonemes = ['a', 'ae', 'b', 'ch', 'd', 'eo', 'eu', 'g', 'h', 'i', 'j', 'k', 'm', 'n', 'ng', 'o', 'p', 'r', 's', 't', 'u', 'ya'],
  medianRms = 0.05,
  meanSilenceRatio = 0.2,
  meanVoicedRatio = 0.55,
} = {}) {
  return {
    version: 1,
    datasetId: 'original-private-singer',
    files: {
      audioCount,
      skippedCount: 0,
      skipped: [],
    },
    segments: {
      count: 240,
      totalDurationSeconds,
      rms: { min: 0.01, median: medianRms, max: 0.12, mean: medianRms },
      silenceRatio: { min: 0.02, median: meanSilenceRatio, max: 0.7, mean: meanSilenceRatio },
      voicedRatio: { min: 0.12, median: meanVoicedRatio, max: 0.9, mean: meanVoicedRatio },
      medianPitchHz: { min: 120, median: 260, max: 620, mean: 300 },
    },
    lyricCoverage: {
      annotatedFiles,
      hangulSyllableCount: 1200,
      uniqueHangulSyllables: ['가', '나', '다', '라', '마'],
      uniquePhonemes,
    },
  }
}

function makeRegistry(localTraining) {
  return {
    version: 1,
    datasets: [
      {
        id: 'original-private-singer',
        name: 'Original private singer',
        sourceUrl: null,
        localPath: 'experiments/neural-singer/datasets/original-private-singer',
        licenseStatus: localTraining ? 'original-consent-reviewed-local-training' : 'consent-required-before-training',
        redistribution: 'private-until-written-release',
        modelPublishing: 'requires-separate-written-release',
        singerIdentity: 'private',
        language: ['ko'],
        audioHours: null,
        annotationTypes: ['audio', 'lyrics', 'consent'],
        allowedActions: {
          localTraining,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        reviewNotes: ['Fixture.'],
      },
    ],
  }
}
