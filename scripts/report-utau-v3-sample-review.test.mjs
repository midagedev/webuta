import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareUtauV3SampleReviewReport } from './report-utau-v3-sample-review.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('UTAU V3 sample review report', () => {
  it('builds a no-recording sample review preflight from existing V3 audits', () => {
    const fixture = makeFixture()

    const { report, markdown } = prepareUtauV3SampleReviewReport({
      cwd: fixture.root,
      out: 'sample-review.md',
      json: 'sample-review.json',
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('v3-sample-review-report-ready')
    expect(report.noRecordingRequired).toBe(true)
    expect(report.package).toMatchObject({
      name: 'WebUtau Korean V3 Synthetic',
      sampleCount: 615,
      aliasCount: 1437,
    })
    expect(report.manualReview).toMatchObject({
      noRecordingRequired: true,
      hardFlagCount: 0,
      pitchWatchlistCount: 2,
      loopWatchlistCount: 2,
      listeningPhraseCount: 1,
    })
    expect(report.pitchWatchlist[0]).toMatchObject({ fileName: 'samples/do_C4.wav', alias: '도' })
    expect(report.loopWatchlist[0]).toMatchObject({ fileName: 'samples/i_A4.wav', alias: '이' })
    expect(markdown).toContain('does not ask anyone to record a voice')
    expect(markdown).toContain('Pitch Watchlist')
    expect(existsSync(join(fixture.root, 'sample-review.md'))).toBe(true)
    expect(JSON.parse(readFileSync(join(fixture.root, 'sample-review.json'), 'utf8')).ok).toBe(true)
  })

  it('fails when an input audit contains hard sample flags', () => {
    const fixture = makeFixture({
      pitchSamples: [
        {
          fileName: 'samples/bad.wav',
          alias: '바',
          type: 'CV',
          pitch: 'F4',
          ok: false,
          problems: ['pitch drift too large'],
          metrics: { medianAbsCents: 90, driftCents: 120, medianConfidence: 0.4 },
        },
      ],
    })

    const { report, markdown } = prepareUtauV3SampleReviewReport({
      cwd: fixture.root,
      out: 'bad-review.md',
      json: 'bad-review.json',
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('v3-sample-review-report-needs-fix')
    expect(report.hardFlags[0]).toMatchObject({
      source: 'pitch',
      fileName: 'samples/bad.wav',
      problems: ['pitch drift too large'],
    })
    expect(markdown).toContain('v3-sample-review-report-needs-fix')
  })
})

function makeFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-v3-sample-review-'))
  tempRoots.push(root)
  const work = join(root, 'experiments', 'utau-v3', 'work')
  const review = join(work, 'v3-listening-review')
  writeJson(join(work, 'v3-voicebank-audit.json'), makeVoicebankAudit())
  writeJson(join(work, 'v3-oto-audit.json'), makeOtoAudit())
  writeJson(join(work, 'v3-pitch-audit.json'), makePitchAudit(overrides.pitchSamples))
  writeJson(join(work, 'v3-loop-audit.json'), makeLoopAudit())
  writeJson(join(review, 'review-manifest.json'), makeListeningManifest())
  return { root }
}

function makeVoicebankAudit() {
  return {
    version: 1,
    ok: true,
    decision: 'v3-voicebank-audit-pass',
    manifest: {
      name: 'WebUtau Korean V3 Synthetic',
      profile: 'web',
      coverage: {
        sampleCount: 615,
        aliasCount: 1437,
        byType: { CV: 411, V: 21, VC: 168, CVC: 15 },
        byPitch: { F4: 593, C4: 11, A4: 11 },
      },
    },
    wav: {
      summary: { problemCount: 0, maxPeak: 0.86, minDurationSeconds: 0.86, maxDurationSeconds: 1.18 },
      worst: [],
    },
  }
}

function makeOtoAudit() {
  return {
    version: 1,
    ok: true,
    decision: 'v3-oto-audit-pass',
    manifest: {
      name: 'WebUtau Korean V3 Synthetic',
      profile: 'web',
    },
    oto: {
      manifestSampleCount: 615,
      entryCount: 1437,
      summary: { okCount: 615, problemCount: 0 },
      worst: [],
    },
  }
}

function makePitchAudit(samples = []) {
  const worst = [
    {
      fileName: 'samples/do_C4.wav',
      alias: '도',
      type: 'CV',
      pitch: 'C4',
      ok: true,
      problems: [],
      metrics: { medianAbsCents: 4.5, driftCents: 10.2, medianConfidence: 0.984 },
    },
    {
      fileName: 'samples/hi_A4.wav',
      alias: '히',
      type: 'CV',
      pitch: 'A4',
      ok: true,
      problems: [],
      metrics: { medianAbsCents: 3.1, driftCents: 8.5, medianConfidence: 0.99 },
    },
  ]
  return {
    version: 1,
    ok: true,
    decision: 'v3-pitch-audit-pass',
    pitch: {
      summary: { okCount: 615, problemCount: 0, maxMedianAbsCents: 4.5, maxDriftCents: 10.2 },
      worst,
      samples,
    },
  }
}

function makeLoopAudit() {
  return {
    version: 1,
    ok: true,
    decision: 'v3-loop-audit-pass',
    loop: {
      summary: { okCount: 432, problemCount: 0, maxResidualRatio: 0.058, maxSeamJump: 0.093 },
      worst: [
        {
          fileName: 'samples/i_A4.wav',
          alias: '이',
          type: 'CV',
          pitch: 'A4',
          ok: true,
          problems: [],
          metrics: { residualRatio: 0.058, seamJump: 0.093, loopDurationMs: 185.35 },
        },
        {
          fileName: 'samples/ki_A4.wav',
          alias: '키',
          type: 'CV',
          pitch: 'A4',
          ok: true,
          problems: [],
          metrics: { residualRatio: 0.052, seamJump: 0.023, loopDurationMs: 185.35 },
        },
      ],
      samples: [],
    },
  }
}

function makeListeningManifest() {
  return {
    version: 1,
    ok: true,
    decision: 'v3-listening-review-ready',
    phrases: [
      {
        id: 'first-run-demo',
        title: 'First-run hook',
        description: 'Default melody and lyric shown to a new visitor.',
        lyricLine: '도 히 도 히 다 이 스 키',
        wavPath: '/tmp/v3.wav',
        wav: { durationSeconds: 6.55 },
      },
    ],
    comparisons: [
      {
        id: 'first-run-demo',
        wavPath: '/tmp/v2.wav',
        wav: { durationSeconds: 6.55 },
        warningText: '렌더 경고 없음',
      },
    ],
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
