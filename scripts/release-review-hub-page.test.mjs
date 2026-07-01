import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

describe('release review hub page', () => {
  it('updates Evidence Preflight progress after both release evidence files pass local checks', async () => {
    const html = readFileSync(resolve('public/review/index.html'), 'utf8')
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'https://midagedev.github.io/webuta/review/index.html',
    })
    const { document } = dom.window

    expect(document.querySelector('[aria-label="Evidence preflight progress"]')?.textContent).toContain('0/2 ready')
    expect(document.querySelector('#evidenceNextAction')?.textContent).toBe('Choose listening JSON')

    await chooseJsonFile(dom, '#listeningEvidenceInput', 'listening-scores.local.json', makeListeningScores())

    expect(document.querySelector('#evidenceReadyCount')?.textContent).toBe('1/2 ready')
    expect(document.querySelector('#evidenceNextAction')?.textContent).toBe('Choose DAW JSON')
    expect(document.querySelector('#listeningEvidenceStatus')?.textContent).toContain('4 phrases / 4 comparisons')

    await chooseJsonFile(dom, '#handoffEvidenceInput', 'handoff-report.local.json', makeHandoffReport())

    expect(document.querySelector('#evidenceReadyCount')?.textContent).toBe('2/2 ready')
    expect(document.querySelector('#evidenceNextAction')?.textContent).toBe('Run terminal status')
    expect(document.querySelector('#handoffEvidenceStatus')?.textContent).toContain('physical handoff pass')
    expect(document.querySelector('#evidencePreflightSummary')?.textContent).toContain('npm run release:evidence-status')
    expect(document.querySelector('#evidencePreflightSummary')?.textContent).toContain('npm run release:accept-evidence')
  })
})

async function chooseJsonFile(dom, selector, fileName, payload) {
  const input = dom.window.document.querySelector(selector)
  const file = new dom.window.File([JSON.stringify(payload)], fileName, { type: 'application/json' })
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  })
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await new Promise((resolvePromise) => dom.window.setTimeout(resolvePromise, 0))
}

function makeListeningScores() {
  const phrases = [
    ['first-run-demo', 'audio/01-first-run-demo.wav'],
    ['coda-release-check', 'audio/02-coda-release-check.wav'],
    ['clear-cv-line', 'audio/03-clear-cv-line.wav'],
    ['vowel-color-check', 'audio/04-vowel-color-check.wav'],
  ]
  return {
    version: 1,
    reviewId: 'webuta-ko-v3-synthetic-listening-review',
    reviewer: 'release reviewer',
    reviewedAt: '2026-07-01T10:00:00.000Z',
    decision: 'community-ready',
    reviewEnvironment: {
      playback: 'headphones',
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
    phraseScores: phrases.map(([id, wavPath]) => ({
      id,
      wavPath,
      koreanClarityScore: 4,
      vowelStabilityScore: 4,
      consonantClarityScore: 4,
      musicalityScore: 4,
      artifactScore: 4,
    })),
    comparisonScores: phrases.map(([id, wavPath]) => ({
      id,
      v3WavPath: wavPath,
      legacyV2WavPath: `audio/legacy-v2/${wavPath.split('/').at(-1).replace('.wav', '-legacy-v2.wav')}`,
      v3PreferenceScore: 4,
    })),
  }
}

function makeHandoffReport() {
  return {
    version: 1,
    reviewId: 'webuta-wav-daw-handoff-v1',
    reviewer: 'release reviewer',
    verifiedAt: '2026-07-01T10:10:00.000Z',
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
    },
    homeScreen: {
      status: 'pass',
    },
  }
}
