import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditDiffSingerEnhancedDataset } from './audit-diffsinger-enhanced-dataset.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('DiffSinger enhanced dataset audit', () => {
  it('passes an enhanced dataset with aligned phoneme durations and WAVs', () => {
    const fixture = makeEnhancedFixture()

    const report = auditDiffSingerEnhancedDataset({
      datasetDir: fixture.datasetDir,
      minItems: 3,
      minTotalSeconds: 2.5,
    })

    expect(report).toMatchObject({
      ok: true,
      decision: 'enhanced-dataset-ready',
      metrics: {
        itemCount: 3,
        wavItemCount: 3,
        hasAp: true,
        hasSp: true,
      },
      problems: [],
    })
    expect(report.metrics.validWavDurationSeconds).toBeGreaterThanOrEqual(3)
    expect(report.phoneCounts).toMatchObject({ AP: 1, SP: 2 })
  })

  it('blocks ph_seq and ph_dur length mismatches before training preparation', () => {
    const fixture = makeEnhancedFixture({
      transcriptions: ['name,ph_seq,ph_dur', 'song-001,k o SP,0.4 0.4', 'song-002,AP t u,0.3 0.3 0.4', ''].join('\n'),
      wavSeconds: {
        'song-001': 0.8,
        'song-002': 1,
      },
    })

    const report = auditDiffSingerEnhancedDataset({
      datasetDir: fixture.datasetDir,
      minItems: 2,
      minTotalSeconds: 1,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('song-001: ph_seq/ph_dur length mismatch')
  })

  it('blocks large drift between aligned phone durations and WAV duration', () => {
    const fixture = makeEnhancedFixture({
      transcriptions: ['name,ph_seq,ph_dur', 'song-001,k o SP,0.4 0.4 0.2', 'song-002,AP t u SP,0.2 0.2 0.2 0.4', ''].join('\n'),
      wavSeconds: {
        'song-001': 4,
        'song-002': 1,
      },
    })

    const report = auditDiffSingerEnhancedDataset({
      datasetDir: fixture.datasetDir,
      minItems: 2,
      minTotalSeconds: 1,
      maxDurationDriftSeconds: 0.5,
      maxDurationDriftRatio: 0.2,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('song-001: ph_dur sum 1s differs from WAV 4s')
  })

  it('runs from the command line and writes a report', () => {
    const fixture = makeEnhancedFixture()
    const reportPath = join(fixture.root, 'enhanced-audit.json')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-diffsinger-enhanced-dataset.mjs',
        '--dataset-dir',
        fixture.datasetDir,
        '--min-items',
        '3',
        '--min-total-seconds',
        '2.5',
        '--report',
        reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).decision).toBe('enhanced-dataset-ready')
  })
})

function makeEnhancedFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-enhanced-dataset-audit-'))
  tempRoots.push(root)
  const datasetDir = join(root, 'enhanced')
  const wavDir = join(datasetDir, 'wavs')
  mkdirSync(wavDir, { recursive: true })
  writeFileSync(
    join(datasetDir, 'transcriptions.csv'),
    options.transcriptions ??
      [
        'name,ph_seq,ph_dur',
        'song-001,k o SP,0.4 0.5 0.1',
        'song-002,AP t u o,0.1 0.3 0.3 0.3',
        'song-003,s a ng SP,0.2 0.3 0.3 0.2',
        '',
      ].join('\n'),
  )
  const wavSeconds = options.wavSeconds ?? {
    'song-001': 1,
    'song-002': 1,
    'song-003': 1,
  }
  for (const [name, seconds] of Object.entries(wavSeconds)) {
    writeFileSync(join(wavDir, `${name}.wav`), makeSineWav({ sampleRate: 44100, seconds, hz: 220 }))
  }
  return { root, datasetDir }
}

function makeSineWav({ sampleRate, seconds, hz }) {
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
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * hz * index) / sampleRate) * 0x3000)
    buffer.writeInt16LE(value, 44 + index * 2)
  }
  return buffer
}
