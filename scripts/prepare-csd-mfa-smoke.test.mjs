import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareCsdMfaSmoke } from './prepare-csd-mfa-smoke.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('CSD MFA smoke corpus preparation', () => {
  it('converts CSD Korean CSV and lyrics into segmented MFA labels', () => {
    const { csdRoot, out } = makeCsdFixture()
    const result = prepareCsdMfaSmoke({
      csdRoot,
      ids: ['kr999a'],
      out,
      targetRate: 8000,
      gapSeconds: 0.7,
      paddingSeconds: 0,
    })

    expect(result).toMatchObject({
      segmentCount: 2,
    })
    expect(readFileSync(join(out, 'raw', 'transcriptions.csv'), 'utf8')).toBe(
      ['name,text', 'kr999a-01,가 나 다', 'kr999a-02,라 마', ''].join('\n'),
    )
    expect(readFileSync(join(out, 'raw', 'wavs', 'kr999a-01.lab'), 'utf8')).toBe('가 나 다\n')
    expect(readFileSync(join(out, 'raw', 'wavs', 'kr999a-02.lab'), 'utf8')).toBe('라 마\n')
    expect(readFileSync(join(out, 'raw', 'wavs', 'kr999a-01.wav')).toString('ascii', 0, 4)).toBe('RIFF')

    const manifest = JSON.parse(readFileSync(join(out, 'csd-mfa-smoke.manifest.json'), 'utf8'))
    expect(manifest.segments).toHaveLength(2)
    expect(manifest.segments[0]).toMatchObject({
      sourceId: 'kr999a',
      label: '가 나 다',
      midi: [60, 62, 64],
      csdSyllables: ['g_a', 'n_a', 'd_a'],
    })
  })

  it('rejects lyric and CSV syllable mismatches', () => {
    const { csdRoot, out } = makeCsdFixture({ lyric: '가나다라' })

    expect(() =>
      prepareCsdMfaSmoke({
        csdRoot,
        ids: ['kr999a'],
        out,
      }),
    ).toThrow(/row\/lyric syllable mismatch/)
  })

  it('runs through the command-line entrypoint', () => {
    const { csdRoot, out } = makeCsdFixture()
    const stdout = execFileSync(
      process.execPath,
      ['scripts/prepare-csd-mfa-smoke.mjs', '--csd-root', csdRoot, '--ids', 'kr999a', '--out', out, '--target-rate', '8000'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.segmentCount).toBe(2)
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('CSD MFA Smoke Corpus')
  })

  it('can select sorted CSD Korean ids automatically with --ids all and --limit', () => {
    const { csdRoot, out } = makeCsdFixture({ extraIds: ['kr001b', 'kr001a'] })
    const result = prepareCsdMfaSmoke({
      csdRoot,
      ids: 'all',
      limit: 2,
      out,
      targetRate: 8000,
      paddingSeconds: 0,
    })

    expect(result.ids).toEqual(['kr001a', 'kr001b'])
    expect(result.segmentCount).toBe(4)
    const manifest = JSON.parse(readFileSync(join(out, 'csd-mfa-smoke.manifest.json'), 'utf8'))
    expect([...new Set(manifest.segments.map((segment) => segment.sourceId))]).toEqual(['kr001a', 'kr001b'])
  })
})

function makeCsdFixture(options = {}) {
  const root = makeTempRoot()
  const csdRoot = join(root, 'CSD', 'korean')
  const out = join(root, 'out')
  mkdirSync(join(csdRoot, 'wav'), { recursive: true })
  mkdirSync(join(csdRoot, 'csv'), { recursive: true })
  mkdirSync(join(csdRoot, 'lyric'), { recursive: true })
  writeFileSync(join(csdRoot, 'wav', 'kr999a.wav'), makeSineWav({ sampleRate: 8000, seconds: 4, hz: 440 }))
  writeFileSync(join(csdRoot, 'lyric', 'kr999a.txt'), options.lyric ?? '가나다 라마')
  writeFileSync(
    join(csdRoot, 'csv', 'kr999a.csv'),
    [
      'start,end,pitch,syllable',
      '0.50,0.80,60,g_a',
      '0.80,1.10,62,n_a',
      '1.10,1.40,64,d_a',
      '2.30,2.70,65,r_a',
      '2.70,3.10,67,m_a',
      '',
    ].join('\n'),
  )
  for (const id of options.extraIds ?? []) {
    writeFileSync(join(csdRoot, 'wav', `${id}.wav`), makeSineWav({ sampleRate: 8000, seconds: 4, hz: 440 }))
    writeFileSync(join(csdRoot, 'lyric', `${id}.txt`), '가나다 라마')
    writeFileSync(
      join(csdRoot, 'csv', `${id}.csv`),
      [
        'start,end,pitch,syllable',
        '0.50,0.80,60,g_a',
        '0.80,1.10,62,n_a',
        '1.10,1.40,64,d_a',
        '2.30,2.70,65,r_a',
        '2.70,3.10,67,m_a',
        '',
      ].join('\n'),
    )
  }
  return { root, csdRoot, out }
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-csd-smoke-'))
  tempRoots.push(root)
  return root
}

function makeSineWav({ sampleRate, seconds, hz }) {
  const sampleCount = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(sampleCount * 2)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * hz) * 0.35
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
