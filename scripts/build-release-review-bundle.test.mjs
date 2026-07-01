import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReleaseReviewBundle } from './build-release-review-bundle.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('release review bundle', () => {
  it('builds an offline reviewer ZIP with packet, scorecard, WAVs, DAW handoff, and docs', async () => {
    const fixture = makeFixture()

    const report = await buildReleaseReviewBundle({
      cwd: fixture.root,
      out: 'public/review/release-review-bundle.zip',
      packet: 'public/review/release-packet.json',
      publicReview: 'public/review',
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('release-review-bundle-ready')
    expect(report.fileCount).toBeGreaterThanOrEqual(17)
    expect(report.bytes).toBeGreaterThan(1000)
    expect(existsSync(join(fixture.root, 'public', 'review', 'release-review-bundle.zip'))).toBe(true)

    const zip = await JSZip.loadAsync(readFileSync(join(fixture.root, 'public', 'review', 'release-review-bundle.zip')))
    for (const path of [
      'webuta-release-review/README.md',
      'webuta-release-review/release-packet.json',
      'webuta-release-review/review/index.html',
      'webuta-release-review/review/v3/index.html',
      'webuta-release-review/review/v3/listening-scores.local.template.json',
      'webuta-release-review/review/v3/audio/01-first-run-demo.wav',
      'webuta-release-review/review/v3/audio/legacy-v2/01-first-run-demo-legacy-v2.wav',
      'webuta-release-review/review/wav-daw/index.html',
      'webuta-release-review/docs/WAV_DAW_QA.md',
      'webuta-release-review/docs/LICENSE_BOUNDARIES.md',
    ]) {
      expect(zip.file(path), path).toBeTruthy()
    }
    const readme = await zip.file('webuta-release-review/README.md').async('string')
    expect(readme).toContain('npm run release:evidence-status')
    expect(readme).toContain('Evidence Preflight')
    expect(readme).toContain('no upload')
    expect(readme).toContain('It does not ask anyone to record a voice')
  })

  it('blocks bundling when packet evidence is incomplete', async () => {
    const fixture = makeFixture({
      packet: {
        ok: false,
        decision: 'release-review-packet-blocked',
        requiredEvidence: [],
        reviewAudio: [],
      },
    })

    const report = await buildReleaseReviewBundle({
      cwd: fixture.root,
      packet: 'public/review/release-packet.json',
      publicReview: 'public/review',
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('release-review-bundle-blocked')
    expect(report.problems.join('\n')).toContain('release review packet must be ready before bundling')
    expect(report.problems.join('\n')).toContain('release review packet must require listening-scores.local.json')
    expect(report.problems.join('\n')).toContain('release review packet must include at least eight review audio files')
  })
})

function makeFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-release-bundle-'))
  tempRoots.push(root)
  const publicReview = join(root, 'public', 'review')
  mkdirSync(join(publicReview, 'v3', 'audio', 'legacy-v2'), { recursive: true })
  mkdirSync(join(publicReview, 'wav-daw'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(publicReview, 'index.html'), '<h1>Release Review Hub</h1>')
  writeFileSync(join(publicReview, 'wav-daw', 'index.html'), '<h1>WAV DAW Handoff</h1>')
  writeFileSync(join(publicReview, 'v3', 'index.html'), '<h1>Listening Review</h1>')
  writeFileSync(join(publicReview, 'v3', 'README.md'), '# Listening Review\n')
  writeFileSync(join(publicReview, 'v3', 'listening-scores.local.template.json'), '{}\n')
  writeFileSync(join(publicReview, 'v3', 'review-manifest.json'), '{}\n')
  writeFileSync(join(root, 'docs', 'WAV_DAW_QA.md'), '# WAV DAW QA\n')
  writeFileSync(join(root, 'docs', 'LICENSE_BOUNDARIES.md'), '# License Boundaries\n')

  const audioFiles = [
    '01-first-run-demo.wav',
    '02-coda-release-check.wav',
    '03-clear-cv-line.wav',
    '04-vowel-color-check.wav',
  ]
  for (const fileName of audioFiles) {
    writeFileSync(join(publicReview, 'v3', 'audio', fileName), Buffer.alloc(200000, 1))
    writeFileSync(join(publicReview, 'v3', 'audio', 'legacy-v2', fileName.replace('.wav', '-legacy-v2.wav')), Buffer.alloc(200000, 2))
  }
  writeFileSync(
    join(publicReview, 'release-packet.json'),
    `${JSON.stringify(options.packet ?? makePacket(audioFiles), null, 2)}\n`,
  )
  return { root }
}

function makePacket(audioFiles) {
  return {
    ok: true,
    decision: 'release-review-packet-ready',
    pagesUrl: 'https://example.test/webuta/',
    reviewHubUrl: 'https://example.test/webuta/review/',
    listeningReviewUrl: 'https://example.test/webuta/review/v3/',
    wavDawHandoffUrl: 'https://example.test/webuta/review/wav-daw/',
    voicebank: {
      noRecordingRequired: true,
    },
    requiredEvidence: [
      { downloadFile: 'listening-scores.local.json' },
      { downloadFile: 'handoff-report.local.json' },
    ],
    reviewAudio: [
      ...audioFiles.map((fileName) => ({ id: fileName, role: 'V3', href: `audio/${fileName}` })),
      ...audioFiles.map((fileName) => ({
        id: fileName,
        role: 'legacy V2',
        href: `audio/legacy-v2/${fileName.replace('.wav', '-legacy-v2.wav')}`,
      })),
    ],
    noRecordingRequired: true,
  }
}
