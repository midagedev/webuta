import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { preparePrivateSingerRecordingPack } from './prepare-private-singer-recording-pack.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('private singer recording pack preparation', () => {
  it('creates a consent-first recording kit with ingest-compatible lyric sidecars', () => {
    const root = makeTempRoot()
    const out = join(root, 'original-private-singer')
    const registryOut = join(root, 'registry.local.json')

    const result = preparePrivateSingerRecordingPack({
      out,
      registryOut,
      targetMinutes: 1,
      sessionId: 'family-001',
      singerId: 'singer-a',
    })

    expect(result.totals.totalEstimatedMinutes).toBeGreaterThanOrEqual(1)
    expect(result.totals.takeCount).toBeGreaterThan(3)
    expect(existsSync(join(out, 'cue-sheet.csv'))).toBe(true)
    expect(existsSync(join(out, 'consent-form.template.md'))).toBe(true)
    expect(existsSync(join(out, 'wavs', `${result.sessionId}-0001-do-hi-daisuki.txt`))).toBe(true)
    expect(existsSync(join(out, 'scores', `${result.sessionId}-0001-do-hi-daisuki.ustx.json`))).toBe(true)
    expect(existsSync(join(out, 'requests', `${result.sessionId}-0001-do-hi-daisuki.neural-request.json`))).toBe(true)
    expect(readFileSync(join(out, 'wavs', `${result.sessionId}-0001-do-hi-daisuki.txt`), 'utf8')).toContain('도히도히')
    const score = JSON.parse(readFileSync(join(out, 'scores', `${result.sessionId}-0001-do-hi-daisuki.ustx.json`), 'utf8'))
    const request = JSON.parse(readFileSync(join(out, 'requests', `${result.sessionId}-0001-do-hi-daisuki.neural-request.json`), 'utf8'))
    expect(score.voice_parts[0].notes.map((note) => note.lyric)).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
    expect(request).toMatchObject({
      version: 1,
      voice: {
        language: 'ko',
        renderer: 'diffsinger',
      },
      render: {
        sampleRate: 44100,
        format: 'wav',
      },
    })
    expect(request.notes).toHaveLength(8)
    expect(request.notes[0].phonemes.map((phoneme) => phoneme.symbol)).toEqual(['d', 'o'])

    const registry = JSON.parse(readFileSync(registryOut, 'utf8'))
    expect(registry.datasets[0]).toMatchObject({
      id: 'original-private-singer',
      licenseStatus: 'consent-required-before-training',
      consent: {
        requiresSignedConsent: true,
        localTrainingScope: 'Local WebUtau Korean neural singer training only.',
      },
      allowedActions: {
        localTraining: false,
        publicModelRelease: false,
        publicAudioExamples: false,
      },
    })
  })

  it('can generate a reviewed local-training registry from the command line', () => {
    const root = makeTempRoot()
    const out = join(root, 'pack')
    const registryOut = join(root, 'registry.json')
    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/prepare-private-singer-recording-pack.mjs',
        '--out',
        out,
        '--registry-out',
        registryOut,
        '--target-minutes',
        '0.5',
        '--session-id',
        'reviewed-001',
        '--allow-local-training',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)
    const registry = JSON.parse(readFileSync(registryOut, 'utf8'))

    expect(result.allowLocalTraining).toBe(true)
    expect(registry.datasets[0].allowedActions.localTraining).toBe(true)
    const readme = readFileSync(join(out, 'README.md'), 'utf8')
    expect(readme).toContain('npm run neural:audit-prompt-coverage')
    expect(readme).toContain('npm run neural:prepare-guides')
    expect(readme).toContain('npm run neural:serve-recorder')
    expect(readme).toContain('npm run neural:audit-recordings')
    expect(readme).toContain('--review-csv')
    expect(readme).toContain('consent-form.signed.local.md')
    expect(readme).toContain('npm run neural:ingest-dataset')
    expect(readme).toContain('scores/*.ustx.json')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-private-singer-pack-'))
  tempRoots.push(root)
  return root
}
