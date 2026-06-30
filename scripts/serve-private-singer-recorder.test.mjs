import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrivateSingerRecorderServer, readRecordingSession } from './serve-private-singer-recorder.mjs'
import { preparePrivateSingerRecordingPack } from './prepare-private-singer-recording-pack.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('private singer recording companion', () => {
  it('summarizes recording progress and guide availability for a capture pack', () => {
    const { packDir, firstTake } = makePack()
    mkdirSync(join(packDir, 'guides'), { recursive: true })
    writeFileSync(join(packDir, 'guides', `${firstTake.id}.guide.wav`), makeSineWav({ sampleRate: 8000, seconds: 0.25, hz: 660 }))

    const session = readRecordingSession({ packDir })

    expect(session.totals.takeCount).toBeGreaterThan(0)
    expect(session.totals.recordedCount).toBe(0)
    expect(session.totals.guideCount).toBe(1)
    expect(session.takes[0]).toMatchObject({
      id: firstTake.id,
      lyric: '도히도히 다이스키',
      guide: {
        exists: true,
        url: `/guides/${firstTake.id}.guide.wav`,
      },
      recorded: {
        exists: false,
      },
    })
  })

  it('serves the recorder UI and saves uploaded WAVs to the selected take path', async () => {
    const { packDir, firstTake } = makePack()
    mkdirSync(join(packDir, 'guides'), { recursive: true })
    writeFileSync(join(packDir, 'guides', `${firstTake.id}.guide.wav`), makeSineWav({ sampleRate: 8000, seconds: 0.25, hz: 660 }))
    const server = createPrivateSingerRecorderServer({ packDir })
    await listen(server)
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`
      const html = await fetchText(`${baseUrl}/`)
      expect(html).toContain('WebUtau Recording Companion')
      expect(html).toContain('/api/session')

      const before = await fetchJson(`${baseUrl}/api/session`)
      expect(before.totals.recordedCount).toBe(0)

      const upload = await fetchJson(`${baseUrl}/api/takes/${encodeURIComponent(firstTake.id)}/wav`, {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: makeSineWav({ sampleRate: 16000, seconds: 0.5, hz: 440 }),
      })
      expect(upload).toMatchObject({
        ok: true,
        takeId: firstTake.id,
        wav: {
          sampleRate: 16000,
          channels: 1,
          bitsPerSample: 16,
        },
      })

      const savedPath = join(packDir, firstTake.wavPath)
      expect(existsSync(savedPath)).toBe(true)
      expect(readFileSync(savedPath).toString('ascii', 0, 4)).toBe('RIFF')
      const after = await fetchJson(`${baseUrl}/api/session`)
      expect(after.totals.recordedCount).toBe(1)
      expect(after.takes[0].recorded.wav.durationSeconds).toBeCloseTo(0.5, 4)
    } finally {
      await close(server)
    }
  })

  it('rejects unknown take uploads with a stable error code', async () => {
    const { packDir } = makePack()
    const server = createPrivateSingerRecorderServer({ packDir })
    await listen(server)
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`
      const response = await fetchJson(`${baseUrl}/api/takes/missing/wav`, {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: makeSineWav({ sampleRate: 8000, seconds: 0.1, hz: 220 }),
      })
      expect(response).toMatchObject({
        ok: false,
        error: {
          code: 'unknown-take',
        },
      })
    } finally {
      await close(server)
    }
  })

  it('prints help from the command-line entrypoint', () => {
    const stdout = execFileSync(process.execPath, ['scripts/serve-private-singer-recorder.mjs', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(stdout).toContain('Usage: node scripts/serve-private-singer-recorder.mjs')
    expect(stdout).toContain('--pack-dir')
    expect(stdout).toContain('--port')
  })
})

function makePack() {
  const root = makeTempRoot()
  const packDir = join(root, 'pack')
  const result = preparePrivateSingerRecordingPack({
    out: packDir,
    registryOut: join(root, 'registry.json'),
    targetMinutes: 0.15,
    sessionId: 'rec-001',
    singerId: 'test-singer',
  })
  const session = JSON.parse(readFileSync(join(packDir, 'recording-session.json'), 'utf8'))
  return { root, packDir, result, firstTake: session.takes[0] }
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-recorder-'))
  tempRoots.push(root)
  return root
}

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise()
    })
  })
}

function close(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolvePromise()
      }
    })
  })
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  return response.json()
}

async function fetchText(url, options) {
  const response = await fetch(url, options)
  return response.text()
}

function makeSineWav({ sampleRate, seconds, hz }) {
  const sampleCount = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(sampleCount * 2)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * hz) * 0.5
    data.writeInt16LE(Math.round(sample * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
