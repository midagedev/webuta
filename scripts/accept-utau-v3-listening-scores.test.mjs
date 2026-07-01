import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acceptUtauV3ListeningScores } from './accept-utau-v3-listening-scores.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('accept UTAU V3 listening scores', () => {
  it('copies a passing human scorecard into the release audit path', () => {
    const root = makeRoot()
    const source = join(root, 'downloads', 'listening-scores.local.json')
    const out = join(root, 'experiments', 'utau-v3', 'work', 'v3-listening-review', 'listening-scores.local.json')
    writeJson(source, makeScores())

    const report = acceptUtauV3ListeningScores({ cwd: root, scores: source, out })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('v3-listening-scores-accepted')
    expect(JSON.parse(readFileSync(out, 'utf8')).reviewer).toBe('human reviewer')
  })

  it('rejects low or incomplete scores without writing the accepted file', () => {
    const root = makeRoot()
    const source = join(root, 'downloads', 'listening-scores.local.json')
    const out = join(root, 'accepted', 'listening-scores.local.json')
    writeJson(
      source,
      makeScores({
        decision: 'needs-work',
        phraseScores: [{ id: 'first-run-demo', koreanClarityScore: 3 }],
        comparisonScores: [{ id: 'first-run-demo', v3PreferenceScore: 3 }],
      }),
    )

    const report = acceptUtauV3ListeningScores({ cwd: root, scores: source, out })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('decision must be community-ready')
    expect(report.problems.join('\n')).toContain('koreanClarityScore 3 is below 4')
    expect(report.problems.join('\n')).toContain('must include at least four V2/V3 comparison scores')
    expect(existsSync(out)).toBe(false)
  })

  it('requires explicit no-recording review metadata', () => {
    const root = makeRoot()
    const source = join(root, 'downloads', 'listening-scores.local.json')
    writeJson(source, makeScores({ reviewEnvironment: { noRecordingRequired: false } }))

    const report = acceptUtauV3ListeningScores({ cwd: root, scores: source })

    expect(report.ok).toBe(false)
    expect(report.problems).toContain('reviewEnvironment.noRecordingRequired must be true')
  })

  it('requires real listening guard confirmations', () => {
    const root = makeRoot()
    const source = join(root, 'downloads', 'listening-scores.local.json')
    writeJson(source, makeScores({
      reviewEnvironment: {
        playback: '',
        reviewerNotes: '',
        noRecordingRequired: true,
        realPlaybackConfirmed: false,
        lyricBlindPassConfirmed: false,
        v2ComparisonConfirmed: false,
      },
    }))

    const report = acceptUtauV3ListeningScores({ cwd: root, scores: source })

    expect(report.ok).toBe(false)
    expect(report.problems).toContain('reviewEnvironment.playback must describe the real playback device')
    expect(report.problems).toContain('reviewEnvironment.realPlaybackConfirmed must be true')
    expect(report.problems).toContain('reviewEnvironment.lyricBlindPassConfirmed must be true')
    expect(report.problems).toContain('reviewEnvironment.v2ComparisonConfirmed must be true')
  })

  it('rejects scores that do not match the current V3 review pack identity', () => {
    const root = makeRoot()
    const source = join(root, 'downloads', 'listening-scores.local.json')
    writeJson(
      source,
      makeScores({
        reviewId: 'old-review-pack',
        phraseScores: [
          {
            id: 'wrong-phrase',
            wavPath: 'audio/wrong.wav',
            koreanClarityScore: 5,
            vowelStabilityScore: 5,
            consonantClarityScore: 5,
            musicalityScore: 5,
            artifactScore: 5,
          },
        ],
        comparisonScores: [
          {
            id: 'wrong-phrase',
            v3WavPath: 'audio/wrong.wav',
            legacyV2WavPath: 'audio/legacy-v2/wrong.wav',
            v3PreferenceScore: 5,
          },
        ],
      }),
    )

    const report = acceptUtauV3ListeningScores({ cwd: root, scores: source })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('reviewId must be webuta-ko-v3-synthetic-listening-review')
    expect(report.problems.join('\n')).toContain('phrase IDs must be exactly')
    expect(report.problems.join('\n')).toContain('comparison IDs must be exactly')
  })
})

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-accept-scores-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'downloads'), { recursive: true })
  return root
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function makeScores(overrides = {}) {
  return {
    version: 1,
    reviewId: 'webuta-ko-v3-synthetic-listening-review',
    reviewer: 'human reviewer',
    reviewedAt: '2026-07-01T00:00:00.000Z',
    decision: 'community-ready',
    reviewEnvironment: {
      playback: 'headphones',
      reviewerNotes: '',
      noRecordingRequired: true,
      realPlaybackConfirmed: true,
      lyricBlindPassConfirmed: true,
      v2ComparisonConfirmed: true,
    },
    thresholds: {
      minKoreanClarityScore: 4,
      minVowelStabilityScore: 4,
      minConsonantClarityScore: 4,
      minMusicalityScore: 4,
      minArtifactScore: 4,
      minV3PreferenceScore: 4,
    },
    phraseScores: [
      ['first-run-demo', 'audio/01-first-run-demo.wav'],
      ['coda-release-check', 'audio/02-coda-release-check.wav'],
      ['clear-cv-line', 'audio/03-clear-cv-line.wav'],
      ['vowel-color-check', 'audio/04-vowel-color-check.wav'],
    ].map(([id, wavPath]) => ({
      id,
      wavPath,
      koreanClarityScore: 4,
      vowelStabilityScore: 4,
      consonantClarityScore: 4,
      musicalityScore: 4,
      artifactScore: 4,
    })),
    comparisonScores: [
      ['first-run-demo', 'audio/01-first-run-demo.wav', 'audio/legacy-v2/01-first-run-demo-legacy-v2.wav'],
      ['coda-release-check', 'audio/02-coda-release-check.wav', 'audio/legacy-v2/02-coda-release-check-legacy-v2.wav'],
      ['clear-cv-line', 'audio/03-clear-cv-line.wav', 'audio/legacy-v2/03-clear-cv-line-legacy-v2.wav'],
      ['vowel-color-check', 'audio/04-vowel-color-check.wav', 'audio/legacy-v2/04-vowel-color-check-legacy-v2.wav'],
    ].map(([id, v3WavPath, legacyV2WavPath]) => ({
      id,
      v3WavPath,
      legacyV2WavPath,
      v3PreferenceScore: 4,
    })),
    ...overrides,
  }
}
