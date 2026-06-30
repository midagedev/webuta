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

  it('blocks release when the V3 sample review preflight is flagged', async () => {
    const fixture = await makeFixture({
      sampleReview: {
        ok: false,
        decision: 'v3-sample-review-report-needs-fix',
        noRecordingRequired: true,
        manualReview: {
          noRecordingRequired: true,
          hardFlagCount: 1,
          pitchWatchlistCount: 1,
          loopWatchlistCount: 1,
          clarityWatchlistCount: 1,
          listeningPhraseCount: 4,
        },
        hardFlags: [{ fileName: 'samples/bad.wav', problems: ['pitch drift too large'] }],
        pitchWatchlist: [{}],
        loopWatchlist: [{}],
        clarityWatchlist: [{}],
        listeningQueue: [{}, {}, {}, {}],
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('sample-review: V3 sample review report must be ready')
    expect(report.problems.join('\n')).toContain('sample-review: V3 sample review must have zero hard sample flags')
  })

  it('blocks release when V3 is not clearly preferred over legacy V2', async () => {
    const fixture = await makeFixture({
      listeningScores: {
        comparisonScores: [
          {
            id: 'first-run-demo',
            v3PreferenceScore: 3,
          },
        ],
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('v3PreferenceScore 3 is below 4')
    expect(report.problems.join('\n')).toContain('must include at least four V2/V3 comparison scores')
  })

  it('blocks release when human scores belong to a stale review pack', async () => {
    const fixture = await makeFixture({
      listeningScores: {
        reviewId: 'old-webuta-review',
        phraseScores: [
          {
            id: 'old-demo',
            wavPath: 'audio/old.wav',
            koreanClarityScore: 5,
            vowelStabilityScore: 5,
            consonantClarityScore: 5,
            musicalityScore: 5,
            artifactScore: 5,
          },
        ],
        comparisonScores: [
          {
            id: 'old-demo',
            v3WavPath: 'audio/old.wav',
            legacyV2WavPath: 'audio/legacy-v2/old.wav',
            v3PreferenceScore: 5,
          },
        ],
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('human-listening: listening score reviewId must be webuta-ko-v3-synthetic-listening-review')
    expect(report.problems.join('\n')).toContain('human-listening: human listening phrase IDs must be exactly')
    expect(report.problems.join('\n')).toContain('human-listening: human listening comparison IDs must be exactly')
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
    expect(report.problems.join('\n')).toContain('does not match 20260701-v3-synthetic-web-3')
  })

  it('blocks release when deployed V3 listening review WAVs are missing', async () => {
    const fixture = await makeFixture({
      pagesReport: {
        ok: true,
        voicebank: {
          file: 'webuta-ko-v3.zip',
          version: '20260701-v3-synthetic-web-3',
          bytes: 593,
        },
        reviewAudio: makePagesReviewAudio().map((item, index) =>
          index === 0
            ? {
                ...item,
                status: 404,
                bytes: 0,
              }
            : item,
        ),
        checks: [
          'pages app loaded',
          'pages V3 zip cache-busted',
          'pages V3 zip bytes match local bundle',
          'pages V3 listening review scorecard loaded',
          'pages V3 listening review audio loaded',
        ],
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('github-pages-v3: GitHub Pages V3 audio audio/01-first-run-demo.wav returned HTTP 404')
    expect(report.problems.join('\n')).toContain('audio/01-first-run-demo.wav is unexpectedly small')
  })

  it('blocks release when the deployed browser demo smoke is stale', async () => {
    const fixture = await makeFixture({
      pagesDemo: {
        ...makeDemoReport('https://old.example.test/webuta/'),
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
      pagesUrl: 'https://midagedev.github.io/webuta/',
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('pages-default-demo: Pages demo smoke URL https://old.example.test/webuta/ does not match https://midagedev.github.io/webuta/')
    expect(report.nextActions.join('\n')).toContain('voicebank:demo-v3:pages')
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

  it('blocks release when an active V3 workflow script points to recording or TTS tooling', async () => {
    const fixture = await makeFixture({
      packageJson: {
        scripts: {
          'voicebank:v3': 'node scripts/generate-korean-v3-synthetic-voicebank.mjs',
          'voicebank:supertonic': 'python3 scripts/generate-korean-supertonic-voicebank.py',
          'release:audit-utau': 'node scripts/audit-utau-community-release.mjs',
        },
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('no-recording-workflow: active script voicebank:supertonic must not require supertonic')
    expect(report.nextActions.join('\n')).toContain('experimental: or legacy:')
  })

  it('blocks release when README screenshots are placeholders instead of real captures', async () => {
    const fixture = await makeFixture()
    writeFileSync(join(fixture.root, 'docs', 'screenshots', 'webuta-mobile.jpg'), 'jpg')

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('mobile screenshot must be a readable PNG or JPEG')
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
  mkdirSync(join(review, 'audio', 'legacy-v2'), { recursive: true })
  mkdirSync(join(docs, 'screenshots'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'public', 'voicebanks'), { recursive: true })
  mkdirSync(join(root, 'public', 'review', 'v3', 'audio', 'legacy-v2'), { recursive: true })
  writeJson(join(root, 'package.json'), overrides.packageJson ?? makePackageJson())
  writeJson(join(work, 'v3-voicebank-audit.json'), passReport('v3-voicebank-audit-pass'))
  writeJson(join(work, 'v3-oto-audit.json'), passReport('v3-oto-audit-pass'))
  writeJson(join(work, 'v3-pitch-audit.json'), passReport('v3-pitch-audit-pass'))
  writeJson(join(work, 'v3-loop-audit.json'), passReport('v3-loop-audit-pass'))
  writeJson(join(work, 'v3-clarity-audit.json'), passReport('v3-clarity-audit-pass'))
  writeJson(join(work, 'default-demo-render-audit.json'), makeDemoReport())
  writeJson(join(work, 'pages-default-demo-render-audit.json'), overrides.pagesDemo ?? makeDemoReport('https://midagedev.github.io/webuta/'))
  writeJson(join(work, 'v3-sample-review-report.json'), overrides.sampleReview ?? makeSampleReviewReport())
  writeFileSync(join(review, 'audio', '01-first-run-demo.wav'), 'wav')
  writeFileSync(join(review, 'audio', '02-coda-release-check.wav'), 'wav')
  writeFileSync(join(review, 'audio', '03-clear-cv-line.wav'), 'wav')
  writeFileSync(join(review, 'audio', '04-vowel-color-check.wav'), 'wav')
  writeFileSync(join(review, 'audio', 'legacy-v2', '01-first-run-demo-legacy-v2.wav'), 'wav')
  writeFileSync(join(review, 'audio', 'legacy-v2', '02-coda-release-check-legacy-v2.wav'), 'wav')
  writeFileSync(join(review, 'audio', 'legacy-v2', '03-clear-cv-line-legacy-v2.wav'), 'wav')
  writeFileSync(join(review, 'audio', 'legacy-v2', '04-vowel-color-check-legacy-v2.wav'), 'wav')
  writeJson(join(review, 'review-manifest.json'), makeReviewManifest(review))
  writeFileSync(
    join(root, 'public', 'review', 'v3', 'index.html'),
    '<h1>WebUtau Korean V3 Listening Review</h1><p>No recording step</p><code>listening-scores.local.json</code>',
  )
  writeFileSync(join(root, 'public', 'review', 'v3', 'README.md'), '# WebUtau Korean V3 Listening Review\n')
  writeFileSync(join(root, 'public', 'review', 'v3', 'listening-scores.local.template.json'), '{}\n')
  for (const fileName of ['01-first-run-demo.wav', '02-coda-release-check.wav', '03-clear-cv-line.wav', '04-vowel-color-check.wav']) {
    writeFileSync(join(root, 'public', 'review', 'v3', 'audio', fileName), Buffer.alloc(200_000, 1))
  }
  for (const fileName of [
    '01-first-run-demo-legacy-v2.wav',
    '02-coda-release-check-legacy-v2.wav',
    '03-clear-cv-line-legacy-v2.wav',
    '04-vowel-color-check-legacy-v2.wav',
  ]) {
    writeFileSync(join(root, 'public', 'review', 'v3', 'audio', 'legacy-v2', fileName), Buffer.alloc(200_000, 1))
  }
  writeJson(join(root, 'public', 'review', 'v3', 'review-manifest.json'), makePublicReviewManifest())
  if (!overrides.omitListeningScores) {
    writeJson(join(review, 'listening-scores.local.json'), deepMerge(makeListeningScores(), overrides.listeningScores ?? {}))
  }
  writeFileSync(join(root, 'README.md'), makeReadme())
  writeFileSync(join(docs, 'LICENSE_BOUNDARIES.md'), makeLicenseBoundaries())
  writeFakeJpeg(join(docs, 'screenshots', 'webuta-desktop.jpg'), 1280, 800, 90_000)
  writeFakeJpeg(join(docs, 'screenshots', 'webuta-mobile.jpg'), 390, 844, 45_000)
  writeFileSync(
    join(root, 'src', 'bundledVoicebank.ts'),
    [
      "export const BUNDLED_UTAU_VOICEBANK_NAME = 'WebUtau Korean V3 Synthetic'",
      "export const BUNDLED_UTAU_VOICEBANK_FILE = 'webuta-ko-v3.zip'",
      "export const BUNDLED_UTAU_VOICEBANK_VERSION = '20260701-v3-synthetic-web-3'",
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
        version: '20260701-v3-synthetic-web-3',
        bytes: readFileSync(join(root, 'public', 'voicebanks', 'webuta-ko-v3.zip')).byteLength,
      },
      checks: [
        'pages app loaded',
        'pages V3 zip cache-busted',
        'pages V3 zip bytes match local bundle',
        'pages V3 listening review scorecard loaded',
        'pages V3 listening review audio loaded',
      ],
      reviewAudio: makePagesReviewAudio(),
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
            sourceLineage: {
              method: 'deterministic-dsp-only',
              noHumanRecordingSource: true,
              noPublicOrPrivateRecordedDatasetSource: true,
              noThirdPartySingerOrCharacterSource: true,
              noTtsOrModelCheckpointOutput: true,
            },
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
      : [
          'The samples are produced by deterministic DSP synthesis, not by cloning, recording, or redistributing a human singer.',
          'No public or private recorded voice dataset is used as source audio for the bundled samples.',
          '',
        ].join('\n'),
  )
  zip.file(
    'license.txt',
    badSyntheticOrigin
      ? 'Fixture license.\n'
      : [
          'No third-party voice, singer likeness, TTS service output, model checkpoint output, Kasane Teto asset, or Vocaloid asset is included.',
          'No public or private recorded voice dataset is used as source audio for the bundled samples.',
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

function makeDemoReport(url = 'http://127.0.0.1:5173/') {
  return {
    ...passReport('default-demo-render-pass'),
    requiredChecks: [
      'default V3 voicebank loaded',
      'first-run demo aliases fully matched',
      'first-run demo render warnings clear',
      'first-run lyric visible',
      'community release readiness card visible',
      'voicebank license metadata visible',
      'selected-note vibrato controls visible',
      'community listening review scorecard linked',
      'selected-note UTAU sample preview available',
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
        durationSeconds: 6.55,
        bytes: 578384,
      },
    },
    smoke: {
      mode: 'static',
      url,
    },
  }
}

function makeReviewManifest(review) {
  const phrases = [
    ['first-run-demo', '01-first-run-demo.wav'],
    ['coda-release-check', '02-coda-release-check.wav'],
    ['clear-cv-line', '03-clear-cv-line.wav'],
    ['vowel-color-check', '04-vowel-color-check.wav'],
  ]
  return {
    ...passReport('v3-listening-review-ready'),
    phraseCount: 4,
    comparisonCount: 4,
    phrases: phrases.map(([id, fileName]) => ({
      id,
      wavPath: join(review, 'audio', fileName),
      gates: { passed: true },
    })),
    comparisons: phrases.map(([id, fileName]) => ({
      id,
      wavPath: join(review, 'audio', 'legacy-v2', fileName.replace('.wav', '-legacy-v2.wav')),
      gates: { passed: true },
    })),
  }
}

function makePublicReviewManifest() {
  const phrases = [
    ['first-run-demo', '01-first-run-demo.wav'],
    ['coda-release-check', '02-coda-release-check.wav'],
    ['clear-cv-line', '03-clear-cv-line.wav'],
    ['vowel-color-check', '04-vowel-color-check.wav'],
  ]
  return {
    ...passReport('v3-listening-review-ready'),
    publishedForWeb: true,
    phraseCount: 4,
    comparisonCount: 4,
    phrases: phrases.map(([id, fileName]) => ({
      id,
      wavPath: `audio/${fileName}`,
      audioHref: `audio/${fileName}`,
      gates: { passed: true },
    })),
    comparisons: phrases.map(([id, fileName]) => {
      const legacyName = fileName.replace('.wav', '-legacy-v2.wav')
      return {
        id,
        wavPath: `audio/legacy-v2/${legacyName}`,
        audioHref: `audio/legacy-v2/${legacyName}`,
        gates: { passed: true },
      }
    }),
  }
}

function makePagesReviewAudio() {
  const phraseFiles = ['01-first-run-demo.wav', '02-coda-release-check.wav', '03-clear-cv-line.wav', '04-vowel-color-check.wav']
  return [
    ...phraseFiles.map((fileName) => ({
      role: 'V3',
      id: fileName.replace(/\.wav$/u, ''),
      href: `audio/${fileName}`,
      url: `https://example.test/review/v3/audio/${fileName}`,
      status: 200,
      bytes: 200_000,
      localBytes: 200_000,
    })),
    ...phraseFiles.map((fileName) => {
      const legacyName = fileName.replace('.wav', '-legacy-v2.wav')
      return {
        role: 'legacy V2',
        id: fileName.replace(/\.wav$/u, ''),
        href: `audio/legacy-v2/${legacyName}`,
        url: `https://example.test/review/v3/audio/legacy-v2/${legacyName}`,
        status: 200,
        bytes: 200_000,
        localBytes: 200_000,
      }
    }),
  ]
}

function makeSampleReviewReport() {
  return {
    version: 1,
    ok: true,
    decision: 'v3-sample-review-report-ready',
    noRecordingRequired: true,
    manualReview: {
      noRecordingRequired: true,
      hardFlagCount: 0,
      pitchWatchlistCount: 2,
      loopWatchlistCount: 2,
      clarityWatchlistCount: 2,
      listeningPhraseCount: 4,
    },
    hardFlags: [],
    pitchWatchlist: [
      { fileName: 'samples/do_C4.wav', alias: '도' },
      { fileName: 'samples/hi_A4.wav', alias: '히' },
    ],
    loopWatchlist: [
      { fileName: 'samples/i_A4.wav', alias: '이' },
      { fileName: 'samples/ki_A4.wav', alias: '키' },
    ],
    clarityWatchlist: [
      { fileName: 'samples/v_i_F4.wav', alias: '-ㅣ', vowel: 'ㅣ' },
      { fileName: 'samples/cv_0000_ga_F4.wav', alias: '가', onset: 'ㄱ' },
    ],
    listeningQueue: ['first-run-demo', 'coda-release-check', 'clear-cv-line', 'vowel-color-check'].map((id) => ({ id })),
  }
}

function makePackageJson() {
  return {
    scripts: {
      'voicebank:v3': 'node scripts/generate-korean-v3-synthetic-voicebank.mjs',
      'voicebank:audit-v3': 'node scripts/audit-korean-v3-voicebank.mjs',
      'voicebank:demo-v3': 'node scripts/audit-default-demo-render.mjs',
      'voicebank:review-v3': 'node scripts/prepare-utau-v3-listening-review.mjs',
      'release:audit-utau': 'node scripts/audit-utau-community-release.mjs',
      'smoke:browser': 'node scripts/smoke-browser-render.mjs',
      'experimental:smoke:recorder': 'node scripts/smoke-private-singer-recorder.mjs',
      'experimental:neural:serve-recorder': 'node scripts/serve-private-singer-recorder.mjs',
      'legacy:voicebank:supertonic': 'python3 scripts/generate-korean-supertonic-voicebank.py',
    },
  }
}

function makeListeningScores() {
  return {
    version: 1,
    reviewId: 'webuta-ko-v3-synthetic-listening-review',
    reviewer: 'fixture reviewer',
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

function makeReadme() {
  return [
    '# WebUtau',
    'The app now ships with `WebUtau Korean V3 Synthetic`, not recorded from a human singer and not derived from public/private recorded datasets.',
    '## No Recording Needed',
    'The app, review flow, and release checklist must not ask the user, the user\'s family, or reviewers to record new voice material.',
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
    'WebUtau Korean V3 Synthetic is generated by WebUtau DSP tooling and not copied from a public/private recorded dataset.',
    'Kasane Teto remains a user-provided import and is not a bundled asset.',
    '',
  ].join('\n')
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeFakeJpeg(path, width, height, byteLength) {
  const sof0 = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ])
  const header = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    sof0,
    Buffer.from([0xff, 0xd9]),
  ])
  const output = Buffer.alloc(Math.max(byteLength, header.length), 0)
  header.copy(output)
  writeFileSync(path, output)
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
