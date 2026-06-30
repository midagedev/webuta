import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareGTSingerDiffSingerDataset } from './prepare-gtsinger-diffsinger-dataset.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('GTSinger DiffSinger dataset preparation', () => {
  it('converts local processed Korean rows into DiffSinger transcriptions', () => {
    const fixture = makeFixture()
    const out = join(fixture.root, 'out')
    const result = prepareGTSingerDiffSingerDataset({
      repository: fixture.repository,
      out,
    })

    expect(result.metrics).toMatchObject({
      metadataItemCount: 3,
      itemCount: 2,
      skippedCount: 1,
      hasAp: true,
      hasSp: true,
    })
    expect(result.phoneCounts).toMatchObject({ AP: 1, SP: 1, k: 1, 'ɨ': 1 })
    expect(existsSync(join(out, 'wavs', 'gts-ko-0001.wav'))).toBe(true)
    expect(readFileSync(join(out, 'transcriptions.csv'), 'utf8')).toBe(
      [
        'name,ph_seq,ph_dur,ph_num,note_seq,note_dur,note_slur,text,source_item_name,source_wav',
        'gts-ko-0001,AP k ɨ,0.1 0.2 0.3,1 2,rest C4 C4,0.1 0.2 0.3,0 0 0,<AP>그,Korean#Singer#Song#Group#0000,Korean/Singer/Song/Group/0000.wav',
        'gts-ko-0002,SP m a,0.15 0.25 0.35,1 2,rest D4 D4,0.15 0.25 0.35,0 0 0,<SP>마,Korean#Singer#Song#Group#0001,Korean/Singer/Song/Group/0001.wav',
        '',
      ].join('\n'),
    )
  })

  it('runs through the command-line entrypoint', () => {
    const fixture = makeFixture()
    const out = join(fixture.root, 'cli-out')
    const stdout = execFileSync(
      process.execPath,
      ['scripts/prepare-gtsinger-diffsinger-dataset.mjs', '--repository', fixture.repository, '--out', out],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.metrics.itemCount).toBe(2)
    expect(readFileSync(join(out, 'gtsinger-diffsinger-dataset.manifest.json'), 'utf8')).toContain('gtsinger-processed-korean')
  })
})

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-gtsinger-diffsinger-'))
  tempRoots.push(root)
  const repository = join(root, 'repository')
  const wavDir = join(repository, 'Korean', 'Singer', 'Song', 'Group')
  const metadataDir = join(repository, 'processed', 'Korean')
  mkdirSync(wavDir, { recursive: true })
  mkdirSync(metadataDir, { recursive: true })
  writeFileSync(join(wavDir, '0000.wav'), makeSineWav({ seconds: 0.6 }))
  writeFileSync(join(wavDir, '0001.wav'), makeSineWav({ seconds: 0.75 }))
  writeFileSync(
    join(metadataDir, 'metadata.json'),
    JSON.stringify([
      {
        item_name: 'Korean#Singer#Song#Group#0000',
        wav_fn: 'Korean/Singer/Song/Group/0000.wav',
        txt: ['<AP>', '그'],
        ph: ['<AP>', 'k_ko', 'ɨ_ko'],
        ph_durs: [0.1, 0.2, 0.3],
        ph2words: [0, 1, 1],
        ep_pitches: [0, 60, 60],
        ep_notedurs: [0.1, 0.2, 0.3],
      },
      {
        item_name: 'Korean#Singer#Song#Group#0001',
        wav_fn: 'Korean/Singer/Song/Group/0001.wav',
        txt: ['<SP>', '마'],
        ph: ['<SP>', 'm_ko', 'a_ko'],
        ph_durs: [0.15, 0.25, 0.35],
        ph2words: [0, 1, 1],
        ep_pitches: [0, 62, 62],
        ep_notedurs: [0.15, 0.25, 0.35],
      },
      {
        item_name: 'Korean#Singer#Song#Group#9999',
        wav_fn: 'Korean/Singer/Song/Group/9999.wav',
        txt: ['없'],
        ph: ['ʌ_ko', 'p̚_ko'],
        ph_durs: [0.2, 0.2],
        ph2words: [0, 0],
        ep_pitches: [64, 64],
        ep_notedurs: [0.2, 0.2],
      },
    ], null, 2),
  )
  return { root, repository }
}

function makeSineWav({ seconds }) {
  const sampleRate = 44100
  const sampleCount = Math.round(sampleRate * seconds)
  const dataBytes = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}
