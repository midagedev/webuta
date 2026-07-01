import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectReleaseEvidence } from './release-evidence-status.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('release evidence status', () => {
  it('reports downloaded listening and DAW handoff JSON as ready without installing them', () => {
    const fixture = makeFixture()

    const report = inspectReleaseEvidence({
      cwd: fixture.root,
      downloadsDir: 'Downloads',
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('release-evidence-ready')
    expect(report.listening).toMatchObject({
      found: true,
      valid: true,
      sourcePath: join(fixture.downloads, 'listening-scores.local.json'),
      outPath: fixture.acceptedScores,
      problems: [],
    })
    expect(report.wavDawHandoff).toMatchObject({
      found: true,
      valid: true,
      sourcePath: join(fixture.downloads, 'handoff-report.local.json'),
      outPath: fixture.acceptedHandoff,
      problems: [],
    })
    expect(existsSync(fixture.acceptedScores)).toBe(false)
    expect(existsSync(fixture.acceptedHandoff)).toBe(false)
    expect(report.nextActions.join('\n')).toContain('npm run release:accept-evidence')
    expect(report.nextActions.join('\n')).toContain('Evidence Preflight')
    expect(report.nextActions.join('\n')).toContain('no upload')
  })

  it('shows focused next actions when one evidence file is missing', () => {
    const fixture = makeFixture({ omitHandoff: true })

    const report = inspectReleaseEvidence({
      cwd: fixture.root,
      downloadsDir: 'Downloads',
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('release-evidence-missing')
    expect(report.listening.valid).toBe(true)
    expect(report.wavDawHandoff).toMatchObject({
      found: false,
      valid: false,
      sourcePath: null,
    })
    expect(report.problems.join('\n')).toContain('missing handoff-report.local.json')
    expect(report.nextActions.join('\n')).toContain('https://midagedev.github.io/webuta/review/wav-daw/')
    expect(report.nextActions.join('\n')).toContain('https://midagedev.github.io/webuta/review/#evidence-preflight')
    expect(report.nextActions.join('\n')).toContain('Evidence Preflight')
    expect(report.nextActions.join('\n')).toContain('npm run release:evidence-status')
  })

  it('reports validator problems for malformed listening scores', () => {
    const fixture = makeFixture({
      scores: {
        decision: 'draft',
        phraseScores: [{ id: 'first-run-demo' }],
        comparisonScores: [{ id: 'first-run-demo' }],
      },
    })

    const report = inspectReleaseEvidence({
      cwd: fixture.root,
      scores: 'Downloads/listening-scores.local.json',
      handoff: 'Downloads/handoff-report.local.json',
    })

    expect(report.ok).toBe(false)
    expect(report.listening.found).toBe(true)
    expect(report.listening.valid).toBe(false)
    expect(report.wavDawHandoff.valid).toBe(true)
    expect(report.problems.join('\n')).toContain('human listening decision must be community-ready, release-ready, or pass')
    expect(report.problems.join('\n')).toContain('human listening phrase IDs must be exactly')
  })
})

function makeFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-release-evidence-status-'))
  tempRoots.push(root)
  const downloads = join(root, 'Downloads')
  mkdirSync(downloads, { recursive: true })
  const acceptedScores = join(root, 'experiments', 'utau-v3', 'work', 'v3-listening-review', 'listening-scores.local.json')
  const acceptedHandoff = join(root, 'experiments', 'utau-v3', 'work', 'wav-daw-handoff', 'handoff-report.local.json')
  writeJson(join(downloads, 'listening-scores.local.json'), deepMerge(makeScores(), options.scores ?? {}))
  if (!options.omitHandoff) {
    writeJson(join(downloads, 'handoff-report.local.json'), deepMerge(makeHandoff(), options.handoff ?? {}))
  }
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
