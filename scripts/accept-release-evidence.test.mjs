import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acceptReleaseEvidence } from './accept-release-evidence.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('accept release evidence', () => {
  it('auto-detects downloaded listening and DAW handoff JSON before copying both into release paths', async () => {
    const fixture = makeFixture()

    const report = await acceptReleaseEvidence({
      cwd: fixture.root,
      downloadsDir: 'Downloads',
      skipAudit: true,
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('release-evidence-accepted')
    expect(report.readiness).toMatchObject({
      readyCount: 2,
      total: 2,
      label: '2/2 ready',
      nextAction: 'run-release-accept-evidence',
    })
    expect(report.listening.accepted).toBe(true)
    expect(report.wavDawHandoff.accepted).toBe(true)
    expect(JSON.parse(readFileSync(fixture.acceptedScores, 'utf8')).reviewId).toBe('webuta-ko-v3-synthetic-listening-review')
    expect(JSON.parse(readFileSync(fixture.acceptedHandoff, 'utf8')).reviewId).toBe('webuta-wav-daw-handoff-v1')
    expect(report.nextActions.join('\n')).toContain('release:audit-utau')
  })

  it('does not install partial evidence when either downloaded JSON fails validation', async () => {
    const fixture = makeFixture({
      handoff: {
        checks: {
          targetDawImportWorked: false,
        },
      },
    })

    const report = await acceptReleaseEvidence({
      cwd: fixture.root,
      scores: 'Downloads/listening-scores.local.json',
      handoff: 'Downloads/handoff-report.local.json',
      skipAudit: true,
    })

    expect(report.ok).toBe(false)
    expect(report.readiness).toMatchObject({
      readyCount: 1,
      total: 2,
      label: '1/2 ready',
      nextAction: 'fix-handoff-report',
    })
    expect(report.problems.join('\n')).toContain('targetDawImportWorked must be true')
    expect(report.nextActions.join('\n')).toContain('Evidence Preflight')
    expect(report.nextActions.join('\n')).toContain('no upload')
    expect(existsSync(fixture.acceptedScores)).toBe(false)
    expect(existsSync(fixture.acceptedHandoff)).toBe(false)
  })
})

function makeFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-release-evidence-'))
  tempRoots.push(root)
  const downloads = join(root, 'Downloads')
  mkdirSync(downloads, { recursive: true })
  const acceptedScores = join(root, 'experiments', 'utau-v3', 'work', 'v3-listening-review', 'listening-scores.local.json')
  const acceptedHandoff = join(root, 'experiments', 'utau-v3', 'work', 'wav-daw-handoff', 'handoff-report.local.json')
  writeJson(join(downloads, 'listening-scores.local.json'), deepMerge(makeScores(), overrides.scores ?? {}))
  writeJson(join(downloads, 'handoff-report.local.json'), deepMerge(makeHandoff(), overrides.handoff ?? {}))
  return {
    root,
    downloads,
    acceptedScores,
    acceptedHandoff,
  }
}

function makeScores() {
  return {
    version: 1,
    reviewId: 'webuta-ko-v3-synthetic-listening-review',
    reviewer: 'release reviewer',
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
  }
}

function makeHandoff() {
  return {
    version: 1,
    reviewId: 'webuta-wav-daw-handoff-v1',
    reviewer: 'release reviewer',
    verifiedAt: '2026-07-01T00:00:00.000Z',
    decision: 'community-ready',
    physicalDevice: true,
    defaultVoicebank: 'WebUtau Korean V3 Synthetic',
    environment: {
      device: 'iPad',
      osVersion: 'iPadOS 26',
      browser: 'Safari',
      targetDaw: 'GarageBand iPad',
      webutaUrl: 'https://midagedev.github.io/webuta/',
    },
    checks: {
      openedFromPublicUrl: true,
      defaultVoicebankSelected: true,
      firstRunGuideVisible: true,
      starterLyricInputVisible: true,
      defaultLyricsMatched: true,
      audioPreviewWorked: true,
      wavExportWorked: true,
      targetDawImportWorked: true,
      targetDawPlaybackAudible: true,
      browserDraftRestored: true,
      noHorizontalOverflowPortrait: true,
      userVoicebankPrivacyConfirmed: true,
    },
    renderedWav: {
      fileName: 'First-Vocal-Sketch.wav',
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 16,
      durationSeconds: 6.55,
    },
    handoff: {
      exportMethod: 'share',
      importedRegionVisible: true,
      noConversionError: true,
      notes: '',
    },
    homeScreen: {
      status: 'pass',
      notes: '',
    },
    notes: '',
  }
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return base
  }
  const merged = { ...base }
  for (const [key, value] of Object.entries(override)) {
    merged[key] =
      value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
        ? deepMerge(base[key], value)
        : value
  }
  return merged
}
