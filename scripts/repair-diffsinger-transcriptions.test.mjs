import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { repairDiffSingerTranscriptions, repairPhoneSequence } from './repair-diffsinger-transcriptions.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('DiffSinger transcription repair', () => {
  it('restores blank MakeDiffSinger phone intervals as SP tokens', () => {
    const result = repairPhoneSequence('SP k ɨ  ɛː ', {
      blankPhone: 'SP',
      expectedCount: 6,
    })

    expect(result).toEqual({
      phones: ['SP', 'k', 'ɨ', 'SP', 'ɛː', 'SP'],
      changed: true,
      insertedBlankPhoneCount: 2,
    })
  })

  it('writes a repaired dataset with aligned ph_seq and ph_dur columns', () => {
    const fixture = makeFixture()
    const out = join(fixture.root, 'repaired')
    const report = repairDiffSingerTranscriptions({
      datasetDir: fixture.datasetDir,
      out,
    })

    expect(report).toMatchObject({
      rowCount: 2,
      changedRowCount: 1,
      insertedBlankPhoneCount: 2,
      unresolvedCount: 0,
    })
    expect(readFileSync(join(out, 'transcriptions.csv'), 'utf8')).toBe(
      [
        'name,ph_seq,ph_dur',
        'song-001,SP k ɨ SP ɛː SP,0.1 0.2 0.3 0.4 0.5 0.6',
        'song-002,k o SP,0.3 0.3 0.4',
        '',
      ].join('\n'),
    )
    expect(existsSync(join(out, 'wavs', 'song-001.wav'))).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'webuta-diffsinger-transcription-repair.json'), 'utf8')).rowCount).toBe(2)
  })

  it('runs through the command-line entrypoint', () => {
    const fixture = makeFixture()
    const out = join(fixture.root, 'cli-repaired')
    const stdout = execFileSync(
      process.execPath,
      ['scripts/repair-diffsinger-transcriptions.mjs', '--dataset-dir', fixture.datasetDir, '--out', out],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.insertedBlankPhoneCount).toBe(2)
    expect(readFileSync(join(out, 'transcriptions.csv'), 'utf8')).toContain('SP k ɨ SP ɛː SP')
  })
})

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-repair-diffsinger-'))
  tempRoots.push(root)
  const datasetDir = join(root, 'dataset')
  const wavDir = join(datasetDir, 'wavs')
  mkdirSync(wavDir, { recursive: true })
  writeFileSync(
    join(datasetDir, 'transcriptions.csv'),
    [
      'name,ph_seq,ph_dur',
      'song-001,SP k ɨ  ɛː ,0.1 0.2 0.3 0.4 0.5 0.6',
      'song-002,k o SP,0.3 0.3 0.4',
      '',
    ].join('\n'),
  )
  writeFileSync(join(wavDir, 'song-001.wav'), 'fake wav')
  writeFileSync(join(wavDir, 'song-002.wav'), 'fake wav')
  return { root, datasetDir }
}
