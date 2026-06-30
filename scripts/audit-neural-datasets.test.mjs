import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditNeuralDatasets } from './audit-neural-datasets.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural dataset audit', () => {
  it('requires enough known WAV duration for local-training datasets when a minute gate is set', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'short.wav'), makeSineWav({ sampleRate: 8000, seconds: 10, hz: 220 }))
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const report = auditNeuralDatasets({
      registry: registryPath,
      minLocalTrainingMinutes: 1,
    })

    expect(report.ok).toBe(false)
    expect(report.datasets[0].audio.knownDurationSeconds).toBeCloseTo(10, 4)
    expect(report.datasets[0].problems.join('\n')).toContain('required 1.00 minutes')
  })

  it('passes a private dataset with enough known duration and reviewed local training', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'take-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 31, hz: 220 }))
    writeFileSync(join(datasetRoot, 'take-b.wav'), makeSineWav({ sampleRate: 8000, seconds: 31, hz: 330 }))
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const report = auditNeuralDatasets({
      registry: registryPath,
      minLocalTrainingMinutes: 1,
    })

    expect(report.ok).toBe(true)
    expect(report.datasets[0].audio.wavCount).toBe(2)
    expect(report.datasets[0].audio.knownDurationSeconds).toBeGreaterThan(60)
  })

  it('blocks consent-tracked local training until a signed consent file is filled', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'take-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 61, hz: 220 }))
    writeFileSync(
      registryPath,
      JSON.stringify(makeRegistry(datasetRoot, true, { consent: makeConsentConfig(datasetRoot) }), null, 2),
    )

    const report = auditNeuralDatasets({
      registry: registryPath,
      minLocalTrainingMinutes: 1,
    })

    expect(report.ok).toBe(false)
    expect(report.datasets[0].consent).toMatchObject({
      requiresSignedConsent: true,
      signedConsentExists: false,
      signedConsentReady: false,
    })
    expect(report.datasets[0].problems.join('\n')).toContain('signed consent is missing or incomplete')
  })

  it('passes consent-tracked local training when signed consent fields are filled', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    const signedConsentPath = join(datasetRoot, 'consent-form.signed.local.md')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'take-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 61, hz: 220 }))
    writeFileSync(
      signedConsentPath,
      ['# Signed Consent Fixture', '', 'Singer signature: Test Singer', 'Date: 2026-06-30', 'Reviewer: Test Reviewer', ''].join('\n'),
    )
    writeFileSync(
      registryPath,
      JSON.stringify(makeRegistry(datasetRoot, true, { consent: makeConsentConfig(datasetRoot) }), null, 2),
    )

    const report = auditNeuralDatasets({
      registry: registryPath,
      minLocalTrainingMinutes: 1,
    })

    expect(report.ok).toBe(true)
    expect(report.datasets[0].consent).toMatchObject({
      signedConsentExists: true,
      signedConsentReady: true,
      filledFields: {
        singerSignature: true,
        date: true,
        reviewer: true,
      },
    })
  })

  it('blocks licensed local training until the license review file is filled', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(join(datasetRoot, 'metadata'), { recursive: true })
    writeFileSync(join(datasetRoot, 'take-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 61, hz: 220 }))
    writeFileSync(
      registryPath,
      JSON.stringify(makeRegistry(datasetRoot, true, { licenseReview: makeLicenseReviewConfig(datasetRoot) }), null, 2),
    )

    const report = auditNeuralDatasets({
      registry: registryPath,
      minLocalTrainingMinutes: 1,
    })

    expect(report.ok).toBe(false)
    expect(report.datasets[0].licenseReview).toMatchObject({
      requiresReview: true,
      reviewedExists: false,
      reviewReady: false,
    })
    expect(report.datasets[0].problems.join('\n')).toContain('license review is missing or incomplete')
  })

  it('passes licensed local training when the license review file allows it', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(join(datasetRoot, 'metadata'), { recursive: true })
    writeFileSync(join(datasetRoot, 'take-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 61, hz: 220 }))
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
    writeFileSync(
      registryPath,
      JSON.stringify(makeRegistry(datasetRoot, true, { licenseReview: makeLicenseReviewConfig(datasetRoot) }), null, 2),
    )

    const report = auditNeuralDatasets({
      registry: registryPath,
      minLocalTrainingMinutes: 1,
    })

    expect(report.ok).toBe(true)
    expect(report.datasets[0].licenseReview).toMatchObject({
      reviewedExists: true,
      reviewReady: true,
      filledFields: {
        reviewer: true,
        reviewDate: true,
        accountDownloadApprovalConfirmed: true,
        localTrainingAllowed: true,
      },
    })
  })

  it('blocks local training when audio files are missing paired lyric or label sidecars', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'take-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 10, hz: 220 }))
    writeFileSync(
      registryPath,
      JSON.stringify(makeRegistry(datasetRoot, true, { qualityGates: { minAnnotatedRatio: 0.95 } }), null, 2),
    )

    const report = auditNeuralDatasets({
      registry: registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.datasets[0].annotations).toMatchObject({
      pairedCount: 0,
      missingCount: 1,
      annotatedRatio: 0,
      missing: ['take-a.wav'],
    })
    expect(report.datasets[0].problems.join('\n')).toContain('0.0% paired annotations')
  })

  it('accepts CSD-style sibling lyric directories as paired annotations', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const wavRoot = join(datasetRoot, 'wav')
    const lyricRoot = join(datasetRoot, 'lyric')
    const registryPath = join(root, 'registry.json')
    mkdirSync(wavRoot, { recursive: true })
    mkdirSync(lyricRoot, { recursive: true })
    writeFileSync(join(wavRoot, 'take-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 10, hz: 220 }))
    writeFileSync(join(lyricRoot, 'take-a.txt'), '도 히 도 히 다 이 스 키\n')
    writeFileSync(
      registryPath,
      JSON.stringify(makeRegistry(datasetRoot, true, { qualityGates: { minAnnotatedRatio: 0.95 } }), null, 2),
    )

    const report = auditNeuralDatasets({
      registry: registryPath,
    })

    expect(report.ok).toBe(true)
    expect(report.datasets[0].annotations).toMatchObject({
      pairedCount: 1,
      missingCount: 0,
      annotatedRatio: 1,
      extensions: {
        '.txt': 1,
      },
    })
  })

  it('limits inventory to configured roots inside a multi-language checkout', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'gtsinger-lfs')
    const registryPath = join(root, 'registry.json')
    mkdirSync(join(datasetRoot, 'Korean', 'KO-Soprano-1'), { recursive: true })
    mkdirSync(join(datasetRoot, 'Chinese', 'ZH-Alto-1'), { recursive: true })
    writeFileSync(join(datasetRoot, 'Korean', 'KO-Soprano-1', 'ko-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 10, hz: 220 }))
    writeFileSync(join(datasetRoot, 'Korean', 'KO-Soprano-1', 'ko-a.json'), '{"lyric":"도"}\n')
    writeFileSync(join(datasetRoot, 'Chinese', 'ZH-Alto-1', 'zh-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 10, hz: 330 }))
    const registry = makeRegistry(datasetRoot, true, {
      inventoryRoots: ['Korean'],
      qualityGates: { minAnnotatedRatio: 0.95 },
    })
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const report = auditNeuralDatasets({
      registry: registryPath,
    })

    expect(report.ok).toBe(true)
    expect(report.datasets[0]).toMatchObject({
      inventoryRoots: ['Korean'],
      audio: {
        fileCount: 1,
        wavCount: 1,
      },
      annotations: {
        pairedCount: 1,
        missingCount: 0,
        annotatedRatio: 1,
      },
    })
  })

  it('excludes guide WAVs from local-training duration gates', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const guideRoot = join(datasetRoot, 'guides')
    const registryPath = join(root, 'registry.json')
    mkdirSync(guideRoot, { recursive: true })
    writeFileSync(join(guideRoot, 'take-a.guide.wav'), makeSineWav({ sampleRate: 8000, seconds: 90, hz: 220 }))
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const report = auditNeuralDatasets({
      registry: registryPath,
      minLocalTrainingMinutes: 1,
    })

    expect(report.ok).toBe(false)
    expect(report.datasets[0].audio.fileCount).toBe(0)
    expect(report.datasets[0].audio.wavCount).toBe(0)
    expect(report.datasets[0].audio.ignoredGuideAudioCount).toBe(1)
    expect(report.datasets[0].audio.knownDurationSeconds).toBe(0)
    expect(report.datasets[0].problems.join('\n')).toContain('has 0.00 minutes')
  })

  it('runs the minute gate through the command-line entrypoint', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'take.wav'), makeSineWav({ sampleRate: 8000, seconds: 5, hz: 440 }))
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    expect(() =>
      execFileSync(
        process.execPath,
        ['scripts/audit-neural-datasets.mjs', '--registry', registryPath, '--min-local-training-minutes', '1'],
        { cwd: process.cwd(), encoding: 'utf8' },
      ),
    ).toThrow()
  })

  it('can audit one dataset from a registry that also contains unavailable future candidates', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'take.wav'), makeSineWav({ sampleRate: 8000, seconds: 5, hz: 440 }))
    const registry = makeRegistry(datasetRoot, true)
    registry.datasets.push({
      ...registry.datasets[0],
      id: 'future-candidate',
      name: 'Future Candidate',
      localPath: join(root, 'missing-future-candidate'),
      allowedActions: {
        localTraining: false,
        publicModelRelease: false,
        publicAudioExamples: false,
      },
    })
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const report = auditNeuralDatasets({
      registry: registryPath,
      dataset: 'private-ko',
    })

    expect(report.ok).toBe(true)
    expect(report.datasetFilter).toBe('private-ko')
    expect(report.datasets).toHaveLength(1)
    expect(report.datasets[0].id).toBe('private-ko')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-neural-audit-'))
  tempRoots.push(root)
  return root
}

function makeRegistry(localPath, localTraining, options = {}) {
  return {
    version: 1,
    datasets: [
      {
        id: 'private-ko',
        name: 'Private Korean Fixture',
        sourceUrl: null,
        localPath,
        licenseStatus: 'original-consent-reviewed-local-training',
        redistribution: 'private-test-fixture',
        modelPublishing: 'not-for-release',
        singerIdentity: 'private',
        language: ['ko'],
        audioHours: null,
        annotationTypes: options.consent ? ['audio', 'lyrics', 'consent'] : ['audio', 'lyrics'],
        ...(options.inventoryRoots ? { inventoryRoots: options.inventoryRoots } : {}),
        ...(options.consent ? { consent: options.consent } : {}),
        ...(options.licenseReview ? { licenseReview: options.licenseReview } : {}),
        ...(options.qualityGates ? { qualityGates: options.qualityGates } : {}),
        allowedActions: {
          localTraining,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        reviewNotes: ['Synthetic test fixture.'],
      },
    ],
  }
}

function makeLicenseReviewConfig(datasetRoot) {
  return {
    requiresReview: true,
    templatePath: join(datasetRoot, 'metadata', 'license-review.local.template.md'),
    reviewedPath: join(datasetRoot, 'metadata', 'license-review.local.md'),
    requiredFields: ['Reviewer', 'Review date', 'Account/download approval confirmed', 'Local training allowed'],
  }
}

function makeConsentConfig(datasetRoot) {
  return {
    requiresSignedConsent: true,
    templatePath: join(datasetRoot, 'consent-form.template.md'),
    signedConsentPath: join(datasetRoot, 'consent-form.signed.local.md'),
    localTrainingScope: 'Local synthetic fixture training.',
    publicReleaseScope: 'No public release.',
  }
}

function makeSineWav({ sampleRate, seconds, hz }) {
  const sampleCount = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(sampleCount * 2)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * hz) * 0.5
    data.writeInt16LE(Math.round(sample * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
