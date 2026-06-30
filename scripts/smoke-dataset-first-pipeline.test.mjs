import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { smokeDatasetFirstPipeline } from './smoke-dataset-first-pipeline.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('dataset-first neural singer pipeline smoke', () => {
  it('runs dataset audit, ingest, readiness, OpenVPI seed, and MFA dictionary coverage', async () => {
    const { registryPath, root } = createDatasetFixture()
    const workDir = join(root, 'work')
    const reportPath = join(root, 'dataset-first-smoke.json')

    const report = await smokeDatasetFirstPipeline({
      registry: registryPath,
      dataset: 'licensed-ko-fixture',
      workDir,
      out: reportPath,
      limitFiles: 2,
      minLocalTrainingMinutes: 0.01,
      minMinutes: 0.01,
      minUniquePhonemes: 4,
      maxMedianRms: 0.5,
      maxMeanSilenceRatio: 0.95,
      minMeanVoicedRatio: 0,
    })

    expect(report).toMatchObject({
      ok: true,
      mode: 'dataset-first-pipeline',
      datasetId: 'licensed-ko-fixture',
      gates: {
        datasetAudit: {
          ok: true,
          fileCount: 2,
          annotatedRatio: 1,
        },
        ingest: {
          audioCount: 2,
          availableAudioCount: 2,
          limitFiles: 2,
        },
        readiness: {
          ok: true,
        },
        openVpi: {
          copiedAudio: true,
        },
        mfaDictionary: {
          unsupportedTokenCount: 0,
        },
        mfaCoverage: {
          oovUniqueTokenCount: 0,
        },
      },
    })
    expect(report.checks).toContain('MFA label coverage has no OOV tokens with generated dictionary')
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).ok).toBe(true)
  })

  it('prints help from the command-line entrypoint', () => {
    const stdout = execFileSync(process.execPath, ['scripts/smoke-dataset-first-pipeline.mjs', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(stdout).toContain('Usage: node scripts/smoke-dataset-first-pipeline.mjs')
    expect(stdout).toContain('--dataset')
    expect(stdout).toContain('--min-local-training-minutes')
  })
})

function createDatasetFixture() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-dataset-first-smoke-'))
  tempRoots.push(root)
  const datasetRoot = join(root, 'dataset')
  const registryPath = join(root, 'registry.json')
  mkdirSync(datasetRoot, { recursive: true })
  writeFileSync(join(datasetRoot, 'take-a.wav'), makeSineWav({ sampleRate: 16000, seconds: 1.2, hz: 220 }))
  writeFileSync(join(datasetRoot, 'take-a.txt'), '강남 밤하늘')
  writeFileSync(join(datasetRoot, 'take-b.wav'), makeSineWav({ sampleRate: 16000, seconds: 1.2, hz: 330 }))
  writeFileSync(join(datasetRoot, 'take-b.txt'), '도히 다이스키')
  writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot), null, 2))
  return { root, registryPath }
}

function makeRegistry(localPath) {
  return {
    version: 1,
    datasets: [
      {
        id: 'licensed-ko-fixture',
        name: 'Licensed Korean Fixture',
        sourceUrl: null,
        localPath,
        licenseStatus: 'license-reviewed-local-training',
        redistribution: 'private-test-fixture',
        modelPublishing: 'not-for-release',
        singerIdentity: 'synthetic-fixture',
        language: ['ko'],
        audioHours: null,
        annotationTypes: ['audio', 'lyrics'],
        qualityGates: {
          minAnnotatedRatio: 0.95,
        },
        allowedActions: {
          localTraining: true,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        reviewNotes: ['Synthetic test fixture.'],
      },
    ],
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
