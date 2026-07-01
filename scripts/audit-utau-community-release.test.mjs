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

    expect(report.problems).toEqual([])
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
    expect(report.nextActions.join('\n')).toContain('Downloads')
    expect(report.nextActions.join('\n')).toContain('Evidence Preflight')
    expect(report.nextActions.join('\n')).toContain('no upload')
    expect(report.nextActions.join('\n')).toContain('npm run release:evidence-status')
    expect(report.nextActions.join('\n')).toContain('npm run release:accept-evidence')
    expect(report.nextActions.join('\n')).toContain('Use explicit --scores/--handoff paths only when the files are somewhere else.')
    expect(report.nextActions.join('\n')).toContain('https://midagedev.github.io/webuta/review/v3/')
    expect(report.nextActions.join('\n')).toContain('progress/autosave')
  })

  it('blocks release when physical WAV DAW handoff evidence is missing', async () => {
    const fixture = await makeFixture({ omitWavDawHandoff: true })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('wav-daw-handoff: missing physical WAV DAW handoff report')
    expect(report.nextActions.join('\n')).toContain('docs/WAV_DAW_QA.md')
    expect(report.nextActions.join('\n')).toContain('Downloads')
    expect(report.nextActions.join('\n')).toContain('Evidence Preflight')
    expect(report.nextActions.join('\n')).toContain('no upload')
    expect(report.nextActions.join('\n')).toContain('npm run release:evidence-status')
    expect(report.nextActions.join('\n')).toContain('npm run release:accept-evidence')
    expect(report.nextActions.join('\n')).not.toContain('npm run release:accept-evidence -- --scores path/to/listening-scores.local.json --handoff path/to/handoff-report.local.json')
  })

  it('blocks release when physical DAW import did not pass', async () => {
    const fixture = await makeFixture({
      wavDawHandoff: {
        checks: {
          targetDawImportWorked: false,
          targetDawPlaybackAudible: false,
        },
        renderedWav: {
          channels: 2,
        },
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('wav-daw-handoff: WAV DAW handoff check targetDawImportWorked must be true')
    expect(report.problems.join('\n')).toContain('wav-daw-handoff: WAV DAW handoff renderedWav.channels 2 must be 1')
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
          'pages V3 listening review download gate loaded',
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

  it('blocks release when the deployed browser demo report predates the starter handoff strip', async () => {
    const stalePagesDemo = makeDemoReport('https://midagedev.github.io/webuta/')
    stalePagesDemo.requiredChecks = stalePagesDemo.requiredChecks.filter(
      (check) =>
        ![
          'first-run route map visible',
          'first-run route state badges visible',
          'first-run lyric helper visible',
          'first-run DAW handoff checklist visible',
          'first-run release evidence links visible',
        ].includes(check.check),
    )
    const fixture = await makeFixture({
      pagesDemo: stalePagesDemo,
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
      pagesUrl: 'https://midagedev.github.io/webuta/',
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('pages-default-demo: missing passed demo check: first-run route map visible')
    expect(report.problems.join('\n')).toContain('pages-default-demo: missing passed demo check: first-run lyric helper visible')
    expect(report.problems.join('\n')).toContain('pages-default-demo: missing passed demo check: first-run DAW handoff checklist visible')
    expect(report.problems.join('\n')).toContain('pages-default-demo: missing passed demo check: first-run release evidence links visible')
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

  it('blocks release when the WAV DAW QA checklist still points reviewers at the old Teto-first path', async () => {
    const fixture = await makeFixture()
    writeFileSync(
      join(fixture.root, 'docs', 'WAV_DAW_QA.md'),
      [
        '# WAV / DAW QA',
        '4. Import the official Kasane Teto UTAU/OpenUTAU zip from Files.',
        '',
      ].join('\n'),
    )

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('WAV / DAW QA doc must include "WebUtau Korean V3 Synthetic"')
    expect(report.problems.join('\n')).toContain('WAV / DAW QA doc must not make Kasane Teto import the default release path')
  })

  it('blocks release when the public WAV DAW handoff builder is missing report markers', async () => {
    const fixture = await makeFixture()
    writeFileSync(join(fixture.root, 'public', 'review', 'wav-daw', 'index.html'), '<h1>WAV handoff</h1>')

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('public-wav-daw-handoff: public WAV DAW handoff builder must include "webuta-wav-daw-handoff-v1"')
    expect(report.problems.join('\n')).toContain('public-wav-daw-handoff: public WAV DAW handoff builder must include "handoff-report.local.json"')
  })

  it('blocks release when the public review hub is missing the final evidence links', async () => {
    const fixture = await makeFixture()
    writeFileSync(join(fixture.root, 'public', 'review', 'index.html'), '<h1>Release hub</h1>')

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('public-release-review-hub: public release review hub must include "listening-scores.local.json"')
    expect(report.problems.join('\n')).toContain('public-release-review-hub: public release review hub must include "handoff-report.local.json"')
  })

  it('blocks release when the public release packet is missing or stale', async () => {
    const fixture = await makeFixture({
      releasePacket: {
        decision: 'release-review-packet-blocked',
        voicebank: {
          version: 'old',
          noRecordingRequired: false,
          kasaneTetoBundled: true,
        },
        requiredEvidence: [],
        reviewAudio: [],
      },
    })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('public-release-review-packet: public release review packet must be ready')
    expect(report.problems.join('\n')).toContain('public-release-review-packet: public release review packet voicebank version old does not match 20260701-v3-synthetic-web-3')
    expect(report.problems.join('\n')).toContain('public-release-review-packet: public release review packet must require listening-scores.local.json')
    expect(report.problems.join('\n')).toContain('public-release-review-packet: public release review packet must list at least eight V3/V2 review audio files')
  })

  it('blocks release when the public release review bundle is missing', async () => {
    const fixture = await makeFixture({ omitReleaseBundle: true })

    const report = await auditUtauCommunityRelease({
      cwd: fixture.root,
      pagesReport: fixture.pagesReport,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('public-release-review-bundle: missing public release review bundle')
  })
})

async function makeFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-utau-release-audit-'))
  tempRoots.push(root)
  const work = join(root, 'experiments', 'utau-v3', 'work')
  const longSustain = join(work, 'long-sustain-audit')
  const review = join(work, 'v3-listening-review')
  const wavDawHandoff = join(work, 'wav-daw-handoff')
  const docs = join(root, 'docs')
  mkdirSync(review, { recursive: true })
  mkdirSync(wavDawHandoff, { recursive: true })
  mkdirSync(longSustain, { recursive: true })
  mkdirSync(join(review, 'audio'), { recursive: true })
  mkdirSync(join(review, 'audio', 'legacy-v2'), { recursive: true })
  mkdirSync(join(docs, 'screenshots'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'public', 'voicebanks'), { recursive: true })
  mkdirSync(join(root, 'public', 'review', 'v3', 'audio', 'legacy-v2'), { recursive: true })
  mkdirSync(join(root, 'public', 'review', 'wav-daw'), { recursive: true })
  writeJson(join(root, 'package.json'), overrides.packageJson ?? makePackageJson())
  writeJson(join(work, 'v3-voicebank-audit.json'), passReport('v3-voicebank-audit-pass'))
  writeJson(join(work, 'v3-oto-audit.json'), passReport('v3-oto-audit-pass'))
  writeJson(join(work, 'v3-pitch-audit.json'), passReport('v3-pitch-audit-pass'))
  writeJson(join(work, 'v3-loop-audit.json'), passReport('v3-loop-audit-pass'))
  writeJson(join(longSustain, 'long-sustain-audit.json'), passReport('utau-long-sustain-audit-pass'))
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
    '<h1>WebUtau Korean V3 Listening Review</h1><p>No recording step</p><section aria-label="10-minute listening review path"><p>manual evidence only after real listening</p><p>Listen phrase by phrase</p><p>Compare V3 against V2</p><p>4/5 or higher</p></section><p id="progressSummary"></p><ul id="problemList"></ul><button title="Finish every required score before downloading">Download JSON</button><code>listening-scores.local.json</code><p>Evidence Preflight</p><p>no upload</p><p>Downloads</p><code>npm run release:evidence-status</code><code>npm run release:accept-evidence</code>',
  )
  writeFileSync(join(root, 'public', 'review', 'v3', 'README.md'), '# WebUtau Korean V3 Listening Review\n')
  writeFileSync(join(root, 'public', 'review', 'v3', 'listening-scores.local.template.json'), '{}\n')
  if (!overrides.omitReleasePacket) {
    writeJson(join(root, 'public', 'review', 'release-packet.json'), deepMerge(makeReleasePacket(), overrides.releasePacket ?? {}))
  }
  writeFileSync(join(root, 'public', 'review', 'index.html'), makeReviewHubPage())
  writeFileSync(join(root, 'public', 'review', 'wav-daw', 'index.html'), makeWavDawHandoffPage())
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
  if (!overrides.omitWavDawHandoff) {
    writeJson(join(wavDawHandoff, 'handoff-report.local.json'), deepMerge(makeWavDawHandoff(), overrides.wavDawHandoff ?? {}))
  }
  writeFileSync(join(root, 'README.md'), makeReadme())
  writeFileSync(join(docs, 'LICENSE_BOUNDARIES.md'), makeLicenseBoundaries())
  writeFileSync(join(docs, 'WAV_DAW_QA.md'), makeWavDawQa())
  if (!overrides.omitReleaseBundle) {
    await writeReleaseBundleZip(root)
  }
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
        'pages release review hub loaded',
        'pages release review packet loaded',
        'pages release review bundle loaded',
        'pages V3 listening review scorecard loaded',
        'pages V3 listening review path loaded',
        'pages V3 listening review download gate loaded',
        'pages V3 listening review audio loaded',
        'pages WAV DAW handoff builder loaded',
        'pages WAV DAW physical handoff path loaded',
        'pages WAV DAW starter lyric input handoff gate loaded',
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

async function writeReleaseBundleZip(root) {
  const zip = new JSZip()
  const entries = [
    [
      'webuta-release-review/README.md',
      'It does not ask anyone to record a voice.\nEvidence Preflight\nno upload\nnpm run release:evidence-status\nnpm run release:accept-evidence\n',
    ],
    ['webuta-release-review/release-packet.json', JSON.stringify(makeReleasePacket())],
    ['webuta-release-review/review/index.html', makeReviewHubPage()],
    ['webuta-release-review/review/v3/index.html', '<h1>Listening Review</h1>'],
    ['webuta-release-review/review/v3/listening-scores.local.template.json', '{}\n'],
    ['webuta-release-review/review/v3/review-manifest.json', JSON.stringify(makePublicReviewManifest())],
    ['webuta-release-review/review/wav-daw/index.html', makeWavDawHandoffPage()],
    ['webuta-release-review/docs/WAV_DAW_QA.md', makeWavDawQa()],
    ['webuta-release-review/docs/LICENSE_BOUNDARIES.md', makeLicenseBoundaries()],
  ]
  for (const [path, content] of entries) {
    zip.file(path, content)
  }
  for (const item of makeReleasePacket().reviewAudio) {
    zip.file(`webuta-release-review/review/v3/${item.href}`, Buffer.alloc(200_000, 1))
  }
  writeFileSync(
    join(root, 'public', 'review', 'release-review-bundle.zip'),
    await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }),
  )
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
      'first-run starter guide visible',
      'first-run one-minute path visible',
      'first-run starter chord guide visible',
      'first-run route map visible',
      'first-run route state badges visible',
      'first-run three-step checklist visible',
      'first-run quick-start CTA visible',
      'first-run focused next action visible',
      'first-run starter launch panel visible',
      'first-run inline lyric input visible',
      'first-run lyric helper visible',
      'first-run current lyric card visible',
      'first-run utility actions visible',
      'first-run DAW handoff checklist visible',
      'first-run release evidence links visible',
      'first-run sketch cues visible',
      'tempo map controls visible',
      'first-run demo aliases fully matched',
      'first-run demo render warnings clear',
      'first-run lyric visible',
      'community release readiness card visible',
      'manual release evidence checklist visible',
      'voicebank license metadata visible',
      'voicebank self-generated origin visible',
      'selected-note dynamics controls visible',
      'selected-note resampler controls visible',
      'selected-note timing controls visible',
      'selected-note envelope controls visible',
      'selected-note vibrato controls visible',
      'selected-note pitch bend controls visible',
      'selected-note duplicate controls visible',
      'classic UST import/export controls visible',
      'DAW handoff bundle export visible',
      'community release review hub linked',
      'community evidence preflight linked',
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
      'voicebank:sustain-v3': 'node scripts/audit-utau-long-sustain.mjs',
      'voicebank:review-v3': 'node scripts/prepare-utau-v3-listening-review.mjs',
      'release:packet': 'node scripts/build-release-review-packet.mjs',
      'release:bundle': 'node scripts/build-release-review-bundle.mjs',
      'release:audit-utau': 'node scripts/audit-utau-community-release.mjs --pages-url https://midagedev.github.io/webuta/',
      'release:evidence-status': 'node scripts/release-evidence-status.mjs',
      'release:accept-evidence': 'node scripts/accept-release-evidence.mjs',
      'release:accept-daw-handoff': 'node scripts/accept-wav-daw-handoff.mjs',
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

function makeWavDawHandoff() {
  return {
    version: 1,
    reviewId: 'webuta-wav-daw-handoff-v1',
    reviewer: 'fixture reviewer',
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

function makeReadme() {
  return [
    '# WebUtau',
    'The app now ships with `WebUtau Korean V3 Synthetic`, not recorded from a human singer and not derived from public/private recorded datasets.',
    'The first-run starter shows `처음 시작`, `듣기 · 가사 · WAV`, `1분 완성 루트`, `C -> G -> Am -> F`, `STEP 01`, `고급 도구`, `DAW 번들`, and `다운로드 패키지` for the ZIP handoff path.',
    'The DAW handoff bundle includes `arrangement.txt`, `chords.csv`, `lyrics.txt`, and `notes.csv` sidecars.',
    '## No Recording Needed',
    'The app, review flow, and release checklist must not ask the user, the user\'s family, or reviewers to record new voice material.',
    'Kasane Teto assets are not bundled in this repository.',
    'See License Boundaries.',
    'Use `public/review/index.html` as the release review hub.',
    'Use `public/review/release-packet.json` as the machine-readable reviewer packet.',
    'Use `public/review/release-review-bundle.zip` as the offline reviewer bundle.',
    'Use the `10-minute listening review path` before accepting listening evidence.',
    'Use the `60-second physical handoff path` to export `First-Vocal-Sketch.wav` before DAW import.',
    'Run `npm run release:packet` to rebuild the public reviewer packet.',
    'Run `npm run release:bundle` to rebuild the offline reviewer bundle.',
    'Run `npm run release:evidence-status` to check both release JSON files before copying them.',
    'Run `npm run release:accept-evidence` after downloading both release JSON files into Downloads.',
    'The public review hub includes `Evidence Preflight` with `No upload` local JSON checks.',
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

function makeWavDawQa() {
  return [
    '# WAV / DAW QA',
    'Default voicebank: WebUtau Korean V3 Synthetic',
    'Confirm `WebUtau Korean V3 Synthetic` is selected without importing a voicebank zip.',
    'Confirm the first-run guide shows `처음 시작`, `듣기 · 가사 · WAV`, `1분 완성 루트`, `C -> G -> Am -> F`, `01 샘플 듣기`, `02 가사 적용`, `03 WAV 받기`, `STEP 01`, `샘플 먼저 듣기`, `한글 그대로 입력`, `스타터 가사 라인`, `현재 가사`, `샘플 듣기`, `멜로디 추천`, `DAW 번들`, `렌더 후 ZIP`, `새 프로젝트`, `기본 샘플`, and `고급 도구`.',
    'The DAW bundle includes `arrangement.txt`, `chords.csv`, `lyrics.txt`, and `notes.csv` beside the rendered WAV.',
    'Short route shown on `review/wav-daw/index.html`: the `60-second physical handoff path` opens the public app, exports `First-Vocal-Sketch.wav`, imports it into the target DAW, then downloads `handoff-report.local.json`; expected WAV is `44.1 kHz mono 16-bit`.',
    'Tap `공유`, `스타터 WAV 받기`, or the top-bar WAV download button.',
    'Open `review/wav-daw/index.html` to generate `handoff-report.local.json`.',
    'Fill `docs/wav-daw-handoff.local.template.json`, keep both JSON files in Downloads, check both in `Evidence Preflight` with no upload, run `npm run release:evidence-status`, and run `npm run release:accept-evidence`.',
    'Optional compatibility pass: import a user-provided UTAU/OpenUTAU zip from Files.',
    'Any optional imported voicebank zip remains user-provided and private to the browser.',
    '',
  ].join('\n')
}

function makeReviewHubPage() {
  return [
    '<!doctype html>',
    '<title>WebUtau Release Review Hub</title>',
    '<h1>Release Review Hub</h1>',
    '<p>WebUtau Korean V3 Synthetic</p>',
    '<p>No recording needed</p>',
    '<p>2 files to finish</p>',
    '<section aria-label="Release completion path">',
    '<p>3/3 passed</p>',
    '<p>0/2 left</p>',
    '<a href="../">Open WebUtau app</a>',
    '<a href="v3/index.html">Open listening review</a>',
    '<a href="release-packet.json">Download review packet</a>',
    '<a href="release-review-bundle.zip">Download review bundle</a>',
    '<code>release-review-bundle.zip</code>',
    '<code>listening-scores.local.json</code>',
    '<a href="wav-daw/index.html">Open DAW handoff</a>',
    '<code>handoff-report.local.json</code>',
    '<h2>Fast Acceptance Path</h2>',
    '<section id="evidence-preflight" aria-label="Evidence preflight checker">',
    '<h2>Evidence Preflight</h2>',
    '<p>No upload: checks run locally in this browser.</p>',
    '<input id="listeningEvidenceInput">',
    '<input id="handoffEvidenceInput">',
    '<p id="evidencePreflightSummary">Choose both JSON files.</p>',
    '<code>webuta-evidence-preflight-v1</code>',
    '</section>',
    '<p>Downloads</p>',
    '<code>npm run release:evidence-status</code>',
    '<code>npm run release:accept-evidence</code>',
    '<code>npm run release:accept-evidence -- --scores path/to/listening-scores.local.json --handoff path/to/handoff-report.local.json</code>',
    '<code>npm run voicebank:accept-review-v3 -- --scores path/to/listening-scores.local.json</code>',
    '<code>npm run release:accept-daw-handoff -- --handoff path/to/handoff-report.local.json</code>',
    '<code>npm run release:audit-utau</code>',
    '<code>release-packet.json</code>',
    '',
  ].join('\n')
}

function makeReleasePacket() {
  return {
    version: 1,
    ok: true,
    decision: 'release-review-packet-ready',
    pagesUrl: 'https://midagedev.github.io/webuta/',
    reviewHubUrl: 'https://midagedev.github.io/webuta/review/',
    listeningReviewUrl: 'https://midagedev.github.io/webuta/review/v3/',
    wavDawHandoffUrl: 'https://midagedev.github.io/webuta/review/wav-daw/',
    packetUrl: 'https://midagedev.github.io/webuta/review/release-packet.json',
    voicebank: {
      name: 'WebUtau Korean V3 Synthetic',
      file: 'webuta-ko-v3.zip',
      version: '20260701-v3-synthetic-web-3',
      url: 'https://midagedev.github.io/webuta/voicebanks/webuta-ko-v3.zip?v=20260701-v3-synthetic-web-3',
      bundledByDefault: true,
      origin: 'self-generated synthetic UTAU sample voicebank',
      noRecordingRequired: true,
      kasaneTetoBundled: false,
    },
    requiredEvidence: [
      {
        id: 'human-listening',
        downloadFile: 'listening-scores.local.json',
        acceptedPath: 'experiments/utau-v3/work/v3-listening-review/listening-scores.local.json',
      },
      {
        id: 'wav-daw-handoff',
        downloadFile: 'handoff-report.local.json',
        acceptedPath: 'experiments/utau-v3/work/wav-daw-handoff/handoff-report.local.json',
      },
    ],
    reviewAudio: makePagesReviewAudio().map((item) => ({
      role: item.role,
      id: item.id,
      href: item.href,
      bytes: item.bytes,
    })),
    commands: {
      status: 'npm run release:evidence-status',
      accept: 'npm run release:accept-evidence',
      audit: 'npm run release:audit-utau',
    },
    noRecordingRequired: true,
    problems: [],
  }
}

function makeWavDawHandoffPage() {
  return [
    '<!doctype html>',
    '<title>WebUtau WAV DAW Handoff</title>',
    '<h1>WebUtau WAV DAW Handoff</h1>',
    '<p>No recording needed</p>',
    '<code>webuta-wav-daw-handoff-v1</code>',
    '<code>handoff-report.local.json</code>',
    '<code>npm run release:accept-evidence -- --scores path/to/listening-scores.local.json --handoff path/to/handoff-report.local.json</code>',
    '<p>WebUtau Korean V3 Synthetic</p>',
    '<p>https://midagedev.github.io/webuta/</p>',
    '<p>GarageBand iPad</p>',
    '<a href="../../">Open WebUtau app</a>',
    '<a href="../index.html">Open release hub</a>',
    '<section aria-label="60-second physical handoff path">',
    '<p>manual evidence only after real DAW import</p>',
    '<p>처음 시작 and 듣기 · 가사 · WAV are visible.</p>',
    '<p>First-Vocal-Sketch.wav</p>',
    '<p>44.1 kHz mono 16-bit</p>',
    '<p>도 히 도 히 다 이 스 키</p>',
    '<script>',
    'const checks = ["openedFromPublicUrl","defaultVoicebankSelected","firstRunGuideVisible","starterLyricInputVisible","defaultLyricsMatched","audioPreviewWorked","wavExportWorked","targetDawImportWorked","targetDawPlaybackAudible","browserDraftRestored","noHorizontalOverflowPortrait","userVoicebankPrivacyConfirmed"];',
    'localStorage.setItem("fixture", JSON.stringify(checks));',
    '</script>',
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
