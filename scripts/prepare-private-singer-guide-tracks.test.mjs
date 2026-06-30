import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { preparePrivateSingerRecordingPack } from './prepare-private-singer-recording-pack.mjs'
import { preparePrivateSingerGuideTracks } from './prepare-private-singer-guide-tracks.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('private singer guide track preparation', () => {
  it('renders headphone pitch guide WAVs from generated neural request fixtures', () => {
    const { out, take, request } = makeRecordingPack()

    const manifest = preparePrivateSingerGuideTracks({
      packDir: out,
      takes: take.id,
      countInBeats: 2,
      sampleRate: 22050,
    })

    expect(manifest.totals).toMatchObject({
      takeCount: 1,
    })
    expect(manifest.guides[0]).toMatchObject({
      id: take.id,
      lyric: take.lyric,
      noteCount: request.notes.length,
      vocalStartSeconds: 1.25,
    })
    expect(existsSync(manifest.guides[0].guidePath)).toBe(true)
    const wav = inspectWav(manifest.guides[0].guidePath)
    expect(wav).toMatchObject({
      sampleRate: 22050,
      channels: 1,
      bitsPerSample: 16,
    })
    expect(wav.durationSeconds).toBeGreaterThan(manifest.guides[0].expectedVocalSeconds)
    expect(readFileSync(join(out, 'guides', 'README.md'), 'utf8')).toContain('Do not train on these guide WAVs')
  })

  it('runs through the command-line entrypoint and writes a selected guide manifest', () => {
    const { out, take } = makeRecordingPack()
    const report = join(out, 'guides', 'selected-guide-manifest.json')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/prepare-private-singer-guide-tracks.mjs',
        '--pack-dir',
        out,
        '--takes',
        take.id,
        '--report',
        report,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const manifest = JSON.parse(stdout)

    expect(manifest.guides).toHaveLength(1)
    expect(JSON.parse(readFileSync(report, 'utf8')).guides[0].id).toBe(take.id)
  })

  it('removes stale guide WAVs when regenerating a full guide folder', () => {
    const { out, take } = makeRecordingPack()
    const guideDir = join(out, 'guides')
    const stalePath = join(guideDir, 'old-session-9999-stale.guide.wav')
    preparePrivateSingerGuideTracks({
      packDir: out,
      takes: take.id,
    })
    writeFileSync(stalePath, 'stale guide')

    const manifest = preparePrivateSingerGuideTracks({
      packDir: out,
    })

    expect(existsSync(stalePath)).toBe(false)
    expect(manifest.totals.staleDeletedCount).toBe(1)
    expect(manifest.staleDeleted).toContain('old-session-9999-stale.guide.wav')
  })
})

function makeRecordingPack() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-private-guide-'))
  tempRoots.push(root)
  const out = join(root, 'pack')
  preparePrivateSingerRecordingPack({
    out,
    registryOut: join(root, 'registry.json'),
    targetMinutes: 0.1,
    sessionId: 'guide-001',
  })
  const session = JSON.parse(readFileSync(join(out, 'recording-session.json'), 'utf8'))
  const take = session.takes[0]
  const request = JSON.parse(readFileSync(resolve(out, take.neuralRequestPath), 'utf8'))
  return { root, out, session, take, request }
}

function inspectWav(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a WAV file: ${path}`)
  }
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(start + 2)
      sampleRate = buffer.readUInt32LE(start + 4)
      bitsPerSample = buffer.readUInt16LE(start + 14)
    } else if (id === 'data') {
      dataBytes = size
      break
    }
    offset = start + size + (size % 2)
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    durationSeconds: dataBytes / (sampleRate * channels * (bitsPerSample / 8)),
  }
}
