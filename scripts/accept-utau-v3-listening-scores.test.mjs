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
    reviewer: 'human reviewer',
    reviewedAt: '2026-07-01T00:00:00.000Z',
    decision: 'community-ready',
    reviewEnvironment: {
      playback: 'headphones',
      reviewerNotes: '',
      noRecordingRequired: true,
    },
    thresholds: {
      minKoreanClarityScore: 4,
      minVowelStabilityScore: 4,
      minConsonantClarityScore: 4,
      minMusicalityScore: 4,
      minArtifactScore: 4,
      minV3PreferenceScore: 4,
    },
    phraseScores: ['first-run-demo', 'coda-release-check', 'clear-cv-line', 'vowel-color-check'].map((id) => ({
      id,
      koreanClarityScore: 4,
      vowelStabilityScore: 4,
      consonantClarityScore: 4,
      musicalityScore: 4,
      artifactScore: 4,
    })),
    comparisonScores: ['first-run-demo', 'coda-release-check', 'clear-cv-line', 'vowel-color-check'].map((id) => ({
      id,
      v3PreferenceScore: 4,
    })),
    ...overrides,
  }
}
