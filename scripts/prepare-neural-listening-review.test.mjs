import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareNeuralListeningReview } from './prepare-neural-listening-review.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural listening review pack', () => {
  it('copies phrase WAVs and writes a release-audit-compatible score template', () => {
    const fixture = makeQualityFixture()
    const outDir = join(fixture.root, 'review')

    const manifest = prepareNeuralListeningReview({
      qualitySummary: fixture.qualitySummaryPath,
      releaseManifest: fixture.releaseManifestPath,
      out: outDir,
    })

    expect(manifest.phraseCount).toBe(2)
    expect(existsSync(join(outDir, 'index.html'))).toBe(true)
    expect(existsSync(join(outDir, 'audio', '01-do-hi.wav'))).toBe(true)
    expect(existsSync(join(outDir, 'audio', '02-batchim.wav'))).toBe(true)
    expect(manifest.warnings).toEqual([])

    const template = JSON.parse(readFileSync(join(outDir, 'listening-scores.local.template.json'), 'utf8'))
    expect(template).toMatchObject({
      version: 1,
      runId: 'review-run',
      modelId: 'webuta-ko-review',
      reviewer: '',
      reviewedAt: '',
      decision: '',
    })
    expect(template.phraseScores).toEqual([
      expect.objectContaining({
        id: 'do-hi',
        koreanClarityScore: null,
        vowelStabilityScore: null,
        artifactScore: null,
      }),
      expect.objectContaining({
        id: 'batchim',
        koreanClarityScore: null,
        vowelStabilityScore: null,
        artifactScore: null,
      }),
    ])

    const html = readFileSync(join(outDir, 'index.html'), 'utf8')
    expect(html).toContain('WebUtau Korean Listening Review')
    expect(html).toContain('audio/01-do-hi.wav')
    expect(html).toContain('webuta-ko-review')
  })

  it('runs through the command-line entrypoint', () => {
    const fixture = makeQualityFixture()
    const outDir = join(fixture.root, 'cli-review')
    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/prepare-neural-listening-review.mjs',
        '--quality-summary',
        fixture.qualitySummaryPath,
        '--release-manifest',
        fixture.releaseManifestPath,
        '--out',
        outDir,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )

    expect(JSON.parse(stdout)).toMatchObject({
      runId: 'review-run',
      modelId: 'webuta-ko-review',
      phraseCount: 2,
    })
    expect(existsSync(join(outDir, 'review-manifest.json'))).toBe(true)
  })

  it('fails clearly when a phrase WAV is missing', () => {
    const fixture = makeQualityFixture({ missingSecondWav: true })
    const blocked = spawnSync(
      process.execPath,
      [
        'scripts/prepare-neural-listening-review.mjs',
        '--quality-summary',
        fixture.qualitySummaryPath,
        '--release-manifest',
        fixture.releaseManifestPath,
        '--out',
        join(fixture.root, 'blocked-review'),
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )

    expect(blocked.status).toBe(1)
    expect(blocked.stderr).toContain('Missing phrase WAV for batchim')
  })
})

function makeQualityFixture(options = {}) {
  const root = makeTempRoot()
  const audioDir = join(root, 'source-audio')
  const qualitySummaryPath = join(root, 'quality-summary.json')
  const releaseManifestPath = join(root, 'release-manifest.json')
  const wavA = join(audioDir, 'do-hi.wav')
  const wavB = join(audioDir, 'batchim.wav')
  mkdirSync(audioDir, { recursive: true })
  writeFileSync(wavA, makeTinyWav())
  if (!options.missingSecondWav) {
    writeFileSync(wavB, makeTinyWav())
  }

  writeJson(qualitySummaryPath, {
    version: 1,
    runId: 'review-run',
    generatedAt: '2026-06-30T00:00:00.000Z',
    modelId: 'webuta-ko-review',
    rendered: true,
    thresholds: {
      minListeningKoreanClarityScore: 4,
      minListeningVowelStabilityScore: 4,
      minListeningArtifactScore: 4,
      scoreScale: '1=unusable, 3=prototype, 5=public-beta-ready',
    },
    totals: {
      phraseCount: 2,
      renderedCount: 2,
      okCount: 2,
      failedRenderCount: 0,
      passedGateCount: 2,
      failedGateCount: 0,
    },
    results: [
      {
        id: 'do-hi',
        title: '도히',
        ok: true,
        wavPath: wavA,
        renderSeconds: 1.2,
        summary: {
          rms: 0.04,
          peak: 0.2,
          medianAbsCents: 4,
          medianOnsetLagSeconds: 0.01,
        },
      },
      {
        id: 'batchim',
        title: '받침',
        ok: true,
        wavPath: wavB,
        renderSeconds: 1.3,
        summary: {
          rms: 0.05,
          peak: 0.25,
          medianAbsCents: 5,
          medianOnsetLagSeconds: 0.02,
        },
      },
    ],
  })
  writeJson(releaseManifestPath, {
    version: 1,
    model: {
      id: 'webuta-ko-review',
      name: 'WebUtau KO Review',
      releaseIntent: 'local-research',
      releaseStatus: 'local-research',
    },
    datasetIds: ['fixture'],
    evidence: {
      qualitySummary: qualitySummaryPath,
    },
    terms: {
      licenseSummary: 'Fixture release manifest for listening review tests.',
      allowedUse: ['Test'],
      disallowedUse: ['Release'],
    },
  })
  return { root, qualitySummaryPath, releaseManifestPath }
}

function makeTinyWav() {
  const sampleRate = 44100
  const samples = 64
  const dataBytes = samples * 2
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
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index % 2 === 0 ? 1200 : -1200, 44 + index * 2)
  }
  return buffer
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-listening-review-'))
  tempRoots.push(root)
  return root
}
