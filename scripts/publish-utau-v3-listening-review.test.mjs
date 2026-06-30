import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishUtauV3ListeningReview } from './publish-utau-v3-listening-review.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('publish UTAU V3 listening review', () => {
  it('copies the ready review pack into public assets with web-safe manifest paths', () => {
    const fixture = makeFixture()

    const report = publishUtauV3ListeningReview({
      cwd: fixture.root,
      source: fixture.source,
      out: fixture.out,
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('v3-listening-review-published')
    expect(report.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'index.html',
        'README.md',
        'listening-scores.local.template.json',
        'review-manifest.json',
        'audio/01-first-run-demo.wav',
        'audio/legacy-v2/01-first-run-demo-legacy-v2.wav',
      ]),
    )
    const publicManifest = JSON.parse(readFileSync(join(fixture.out, 'review-manifest.json'), 'utf8'))
    expect(publicManifest.publishedForWeb).toBe(true)
    expect(publicManifest.phrases[0].wavPath).toBe('audio/01-first-run-demo.wav')
    expect(JSON.stringify(publicManifest)).not.toContain(fixture.root)
    expect(readFileSync(join(fixture.out, 'index.html'), 'utf8')).not.toContain(fixture.root)
    expect(readFileSync(join(fixture.out, 'README.md'), 'utf8')).not.toContain(fixture.root)
  })

  it('blocks publishing when a review WAV is missing', () => {
    const fixture = makeFixture({ omitComparison: true })

    const report = publishUtauV3ListeningReview({
      cwd: fixture.root,
      source: fixture.source,
      out: fixture.out,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('missing review audio')
  })
})

function makeFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-review-publish-'))
  tempRoots.push(root)
  const source = join(root, 'review-source')
  const out = join(root, 'public', 'review', 'v3')
  mkdirSync(join(source, 'audio', 'legacy-v2'), { recursive: true })
  writeFileSync(join(source, 'index.html'), `<h1>WebUtau Korean V3 Listening Review</h1><code>${source}/audio/01-first-run-demo.wav</code>`)
  writeFileSync(join(source, 'README.md'), `# WebUtau Korean V3 Listening Review\nOpen: ${source}/index.html\n`)
  writeFileSync(join(source, 'listening-scores.local.template.json'), '{}\n')
  for (const fileName of [
    '01-first-run-demo.wav',
    '02-coda-release-check.wav',
    '03-clear-cv-line.wav',
    '04-vowel-color-check.wav',
  ]) {
    writeFileSync(join(source, 'audio', fileName), Buffer.alloc(200_000, 1))
  }
  for (const fileName of [
    '01-first-run-demo-legacy-v2.wav',
    '02-coda-release-check-legacy-v2.wav',
    '03-clear-cv-line-legacy-v2.wav',
    '04-vowel-color-check-legacy-v2.wav',
  ]) {
    if (options.omitComparison && fileName === '01-first-run-demo-legacy-v2.wav') {
      continue
    }
    writeFileSync(join(source, 'audio', 'legacy-v2', fileName), Buffer.alloc(200_000, 1))
  }
  writeFileSync(
    join(source, 'review-manifest.json'),
    `${JSON.stringify(makeReviewManifest(source), null, 2)}\n`,
  )
  return { root, source, out }
}

function makeReviewManifest(source) {
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
      wavPath: join(source, 'audio', fileName),
      audioHref: `audio/${fileName}`,
      wav: { path: join(source, 'audio', fileName), bytes: 200_000 },
      gates: { passed: true, problems: [] },
    })),
    comparisons: phrases.map(([id, fileName]) => {
      const legacyName = fileName.replace('.wav', '-legacy-v2.wav')
      return {
        id,
        wavPath: join(source, 'audio', 'legacy-v2', legacyName),
        audioHref: `audio/legacy-v2/${legacyName}`,
        wav: { path: join(source, 'audio', 'legacy-v2', legacyName), bytes: 200_000 },
        gates: { passed: true, problems: [] },
      }
    }),
  }
}
