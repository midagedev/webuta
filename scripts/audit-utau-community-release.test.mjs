import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { auditUtauCommunityRelease } from './audit-utau-community-release.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('UTAU community release audit', () => {
  it('passes when all package, UI, README, listening, and Pages evidence is present', async () => {
    const fixture = await makeFixture()

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      report: 'release-report.json',
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('community-release-ready')
    expect(report.gates.every((gate) => gate.passed)).toBe(true)
    expect(JSON.parse(readFileSync(join(fixture.root, 'release-report.json'), 'utf8')).ok).toBe(true)
  })

  it('blocks release when human listening and Pages evidence are missing', async () => {
    const fixture = await makeFixture({ omitListeningScores: true })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('community-release-blocked')
    expect(report.problems.join('\n')).toContain('human-listening: missing human listening scores')
    expect(report.problems.join('\n')).toContain('github-pages-v3: missing GitHub Pages deployment evidence')
    expect(report.nextActions.join('\n')).toContain('listening-scores.local.json')
  })

  it('blocks release when listening scores are below threshold', async () => {
    const fixture = await makeFixture({
      listeningScores: {
        phraseScores: [
          {
            id: 'first-run-demo',
            koreanClarityScore: 3,
            vowelStabilityScore: 4,
            consonantClarityScore: 4,
            musicalityScore: 4,
            artifactScore: 4,
          },
        ],
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('koreanClarityScore 3 is below 4')
    expect(report.problems.join('\n')).toContain('must include at least four phrase scores')
  })

  it('blocks release when deployed Pages evidence does not match the cache-busted bundled V3 version', async () => {
    const fixture = await makeFixture({
      pagesReport: {
        ok: true,
        voicebank: {
          file: 'webuta-ko-v3.zip',
          version: '20260629-old',
        },
        checks: ['pages app loaded', 'pages V3 zip cache-busted'],
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('does not match 20260630-v3-synthetic-web-1')
  })

  it('blocks release when the bundled V3 zip lacks no-recording synthetic-origin evidence', async () => {
    const fixture = await makeFixture({ badSyntheticOrigin: true })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('synthetic-origin: V3 manifest type must declare generated-synthetic origin')
    expect(report.problems.join('\n')).toContain('synthetic-origin: V3 readme.txt must include "not by cloning, recording"')
    expect(report.problems.join('\n')).toContain('synthetic-origin: V3 license.txt must include "TTS service output"')
  })
})

async function makeFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-utau-release-audit-'))
  tempRoots.push(root)
  const work = join(root, 'experiments', 'utau-v3', 'work')
  const review = join(work, 'v3-listening-review')
  const docs = join(root, 'docs')
  mkdirSync(review, { recursive: true })
  mkdirSync(join(review, 'audio'), { recursive: true })
  mkdirSync(join(docs, 'screenshots'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'public', 'voicebanks'), { recursive: true })
  writeJson(join(work, 'v3-voicebank-audit.json'), passReport('v3-voicebank-audit-pass'))
  writeJson(join(work, 'v3-oto-audit.json'), passReport('v3-oto-audit-pass'))
  writeJson(join(work, 'v3-pitch-audit.json'), passReport('v3-pitch-audit-pass'))
  writeJson(join(work, 'v3-loop-audit.json'), passReport('v3-loop-audit-pass'))
  writeJson(join(work, 'default-demo-render-audit.json'), makeDemoReport())
  writeFileSync(join(review, 'audio', '01-first-run-demo.wav'), 'wav')
  writeFileSync(join(review, 'audio', '02-coda-release-check.wav'), 'wav')
  writeFileSync(join(review, 'audio', '03-clear-cv-line.wav'), 'wav')
  writeFileSync(join(review, 'audio', '04-vowel-color-check.wav'), 'wav')
  writeJson(join(review, 'review-manifest.json'), makeReviewManifest(review))
  if (!overrides.omitListeningScores) {
    writeJson(join(review, 'listening-scores.local.json'), deepMerge(makeListeningScores(), overrides.listeningScores ?? {}))
  }
  writeFileSync(join(root, 'README.md'), makeReadme())
  writeFileSync(join(docs, 'LICENSE_BOUNDARIES.md'), makeLicenseBoundaries())
  writeFileSync(join(docs, 'screenshots', 'webuta-desktop.jpg'), 'jpg')
  writeFileSync(join(docs, 'screenshots', 'webuta-mobile.jpg'), 'jpg')
  writeFileSync(
    join(root, 'src', 'bundledVoicebank.ts'),
    [
      "export const BUNDLED_KOREAN_LITE_VOICEBANK_NAME = 'WebUtau Korean V3 Synthetic'",
      "export const BUNDLED_KOREAN_LITE_VOICEBANK_FILE = 'webuta-ko-v3.zip'",
      "export const BUNDLED_KOREAN_LITE_VOICEBANK_VERSION = '20260630-v3-synthetic-web-1'",
      '',
    ].join('\n'),
  )
  await writeV3Zip(join(root, 'public', 'voicebanks', 'webuta-ko-v3.zip'), overrides.badSyntheticOrigin)
  const pagesReport = join(root, 'pages-report.json')
  writeJson(
    pagesReport,
    overrides.pagesReport ?? {
      ok: true,
      voicebank: {
        file: 'webuta-ko-v3.zip',
        version: '20260630-v3-synthetic-web-1',
      },
      checks: ['pages app loaded', 'pages V3 zip cache-busted'],
    },
  )
  return { root, pagesReport }
}

async function writeV3Zip(path, badSyntheticOrigin = false) {
  const zip = new JSZip()
  zip.file(
    'webuta-ko-v3.manifest.json',
    `${JSON.stringify(
      badSyntheticOrigin
        ? {
            version: 1,
            id: 'webuta-ko-v3-synthetic',
            name: 'WebUtau Korean V3 Synthetic',
            type: 'recorded-utau',
            license: 'Fixture voicebank.',
            qualityIntent: 'Fixture voice.',
            samples: [],
          }
        : {
            version: 1,
            id: 'webuta-ko-v3-synthetic',
            name: 'WebUtau Korean V3 Synthetic',
            type: 'generated-synthetic-utau-cv-vc',
            license: 'Original deterministic DSP-generated samples and metadata.',
            qualityIntent: 'License-clean stylized cyber singer that does not imitate a real singer.',
            samples: [{ fileName: 'samples/do_C4.wav' }],
          },
      null,
      2,
    )}\n`,
  )
  zip.file(
    'readme.txt',
    badSyntheticOrigin
      ? 'Fixture voicebank.\n'
      : 'The samples are produced by deterministic DSP synthesis, not by cloning, recording, or redistributing a human singer.\n',
  )
  zip.file(
    'license.txt',
    badSyntheticOrigin
      ? 'Fixture license.\n'
      : [
          'No third-party voice, singer likeness, TTS service output, model checkpoint output, Kasane Teto asset, or Vocaloid asset is included.',
          'Generated user audio may be used freely.',
          '',
        ].join('\n'),
  )
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }))
}

function passReport(decision) {
  return {
    version: 1,
    ok: true,
    decision,
    generatedAt: '2026-06-30T00:00:00.000Z',
  }
}

function makeDemoReport() {
  return {
    ...passReport('default-demo-render-pass'),
    requiredChecks: [
      'default V3 voicebank loaded',
      'first-run demo aliases fully matched',
      'first-run demo render warnings clear',
      'first-run lyric visible',
      'desktop WAV download',
      'render history visible',
      'desktop no page horizontal overflow',
      'desktop piano keyboard and bar ruler visible',
      'mobile export controls visible',
      'mobile touch keyboard visible',
      'mobile piano keyboard and bar ruler visible',
      'mobile no page horizontal overflow',
    ].map((check) => ({ check, passed: true })),
    download: {
      wav: {
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
      },
    },
  }
}

function makeReviewManifest(review) {
  return {
    ...passReport('v3-listening-review-ready'),
    phraseCount: 4,
    phrases: [
      ['first-run-demo', '01-first-run-demo.wav'],
      ['coda-release-check', '02-coda-release-check.wav'],
      ['clear-cv-line', '03-clear-cv-line.wav'],
      ['vowel-color-check', '04-vowel-color-check.wav'],
    ].map(([id, fileName]) => ({
      id,
      wavPath: join(review, 'audio', fileName),
      gates: { passed: true },
    })),
  }
}

function makeListeningScores() {
  return {
    version: 1,
    reviewer: 'fixture reviewer',
    reviewedAt: '2026-07-01T00:00:00.000Z',
    decision: 'community-ready',
    thresholds: {
      minKoreanClarityScore: 4,
      minVowelStabilityScore: 4,
      minConsonantClarityScore: 4,
      minMusicalityScore: 4,
      minArtifactScore: 4,
    },
    phraseScores: ['first-run-demo', 'coda-release-check', 'clear-cv-line', 'vowel-color-check'].map((id) => ({
      id,
      koreanClarityScore: 4,
      vowelStabilityScore: 4,
      consonantClarityScore: 4,
      musicalityScore: 4,
      artifactScore: 4,
    })),
  }
}

function makeReadme() {
  return [
    '# WebUtau',
    'The app now ships with `WebUtau Korean V3 Synthetic`, not recorded from a human singer.',
    'Kasane Teto assets are not bundled in this repository.',
    'See License Boundaries.',
    '## Screenshots',
    '![WebUtau desktop editor](docs/screenshots/webuta-desktop.jpg)',
    '![WebUtau mobile editor](docs/screenshots/webuta-mobile.jpg)',
    '## Limitations',
    'Synthetic V3 is useful for sketching but still needs human listening review before release.',
    '',
  ].join('\n')
}

function makeLicenseBoundaries() {
  return [
    '# License Boundaries',
    'WebUtau Korean V3 Synthetic is generated by WebUtau DSP tooling.',
    'Kasane Teto remains a user-provided import and is not a bundled asset.',
    '',
  ].join('\n')
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return overrides ?? base
  }
  const output = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    output[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? deepMerge(base[key] && typeof base[key] === 'object' ? base[key] : {}, value)
        : value
  }
  return output
}
