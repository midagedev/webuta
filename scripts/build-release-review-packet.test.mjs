import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReleaseReviewPacket } from './build-release-review-packet.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('release review packet', () => {
  it('writes a machine-readable packet for the public release evidence flow', () => {
    const fixture = makeFixture()

    const packet = buildReleaseReviewPacket({
      cwd: fixture.root,
      out: 'public/review/release-packet.json',
      reviewManifest: 'public/review/v3/review-manifest.json',
      bundledVoicebank: 'src/bundledVoicebank.ts',
      pagesUrl: 'https://example.test/webuta',
    })

    expect(packet.ok).toBe(true)
    expect(packet.decision).toBe('release-review-packet-ready')
    expect(packet.pagesUrl).toBe('https://example.test/webuta/')
    expect(packet.evidencePreflightUrl).toBe('https://example.test/webuta/review/#evidence-preflight')
    expect(packet.voicebank).toMatchObject({
      name: 'WebUtau Korean V3 Synthetic',
      file: 'webuta-ko-v3.zip',
      version: '20260701-v3-synthetic-web-5',
      bundledByDefault: true,
      noRecordingRequired: true,
      kasaneTetoBundled: false,
    })
    expect(packet.voicebank.url).toBe('https://example.test/webuta/voicebanks/webuta-ko-v3.zip?v=20260701-v3-synthetic-web-5')
    expect(packet.requiredEvidence.map((item) => item.downloadFile)).toEqual([
      'listening-scores.local.json',
      'handoff-report.local.json',
    ])
    expect(packet.reviewAudio).toHaveLength(8)
    expect(packet.commands.status).toBe('npm run release:evidence-status')
    expect(packet.commands.accept).toBe('npm run release:accept-evidence')
    expect(packet.checklist.join('\n')).toContain('Evidence Preflight')
    expect(packet.checklist.join('\n')).toContain('no upload')
    expect(packet.checklist.join('\n')).toContain('blind lyric pass')
    expect(packet.requiredEvidence[0].requirement).toContain('playback device')
    expect(packet.requiredEvidence[0].requirement).toContain('V2 comparison confirmations')
    expect(packet.checklist.join('\n')).toContain('Run npm run release:evidence-status.')
    expect(existsSync(join(fixture.root, 'public', 'review', 'release-packet.json'))).toBe(true)
    const written = JSON.parse(readFileSync(join(fixture.root, 'public', 'review', 'release-packet.json'), 'utf8'))
    expect(written.reviewAudio[0]).toMatchObject({
      role: 'V3',
      id: 'first-run-demo',
      href: 'audio/01-first-run-demo.wav',
    })
  })

  it('blocks packet readiness when the public review manifest is not ready', () => {
    const fixture = makeFixture({
      reviewManifest: {
        ok: false,
        decision: 'v3-listening-review-needs-render-fix',
        phraseCount: 1,
        comparisonCount: 0,
      },
    })

    const packet = buildReleaseReviewPacket({
      cwd: fixture.root,
      reviewManifest: 'public/review/v3/review-manifest.json',
      write: false,
    })

    expect(packet.ok).toBe(false)
    expect(packet.decision).toBe('release-review-packet-blocked')
    expect(packet.problems.join('\n')).toContain('public V3 listening review manifest must be ready')
    expect(packet.problems.join('\n')).toContain('release packet requires at least four V3 listening phrases')
    expect(packet.problems.join('\n')).toContain('release packet requires at least four legacy V2 comparison phrases')
  })
})

function makeFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-release-packet-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'public', 'review', 'v3'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(
    join(root, 'src', 'bundledVoicebank.ts'),
    [
      "export const BUNDLED_UTAU_VOICEBANK_NAME = 'WebUtau Korean V3 Synthetic'",
      "export const BUNDLED_UTAU_VOICEBANK_FILE = 'webuta-ko-v3.zip'",
      "export const BUNDLED_UTAU_VOICEBANK_VERSION = '20260701-v3-synthetic-web-5'",
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'public', 'review', 'v3', 'review-manifest.json'),
    `${JSON.stringify(options.reviewManifest ?? makeReviewManifest(), null, 2)}\n`,
  )
  return { root }
}

function makeReviewManifest() {
  const phrases = [
    ['first-run-demo', '01-first-run-demo.wav'],
    ['coda-release-check', '02-coda-release-check.wav'],
    ['clear-cv-line', '03-clear-cv-line.wav'],
    ['vowel-color-check', '04-vowel-color-check.wav'],
  ]
  return {
    version: 1,
    ok: true,
    decision: 'v3-listening-review-ready',
    phraseCount: 4,
    comparisonCount: 4,
    phrases: phrases.map(([id, fileName]) => ({
      id,
      title: id,
      lyricLine: '도 히',
      audioHref: `audio/${fileName}`,
      wav: {
        bytes: 200000,
        durationSeconds: 3,
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
      },
    })),
    comparisons: phrases.map(([id, fileName]) => ({
      id,
      title: `${id} legacy`,
      lyricLine: '도 히',
      audioHref: `audio/legacy-v2/${fileName.replace('.wav', '-legacy-v2.wav')}`,
      wav: {
        bytes: 200000,
        durationSeconds: 3,
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
      },
    })),
  }
}
