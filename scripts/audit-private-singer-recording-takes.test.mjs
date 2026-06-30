import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditPrivateSingerRecordingTakes } from './audit-private-singer-recording-takes.mjs'
import { preparePrivateSingerRecordingPack } from './prepare-private-singer-recording-pack.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('private singer recording take audit', () => {
  it('passes a recorded WAV that follows the generated neural request guide', () => {
    const { out, take, request } = makeRecordingPack()
    writeFileSync(resolve(out, take.wavPath), guidedSineWav(request))

    const report = auditPrivateSingerRecordingTakes({
      packDir: out,
      takes: take.id,
      durationToleranceSeconds: 0.05,
      minVoicedFrameRatio: 0.7,
      maxMedianAbsCents: 80,
      maxMissingOnsetRatio: 1,
    })

    expect(report.ok).toBe(true)
    expect(report.totals).toMatchObject({ takeCount: 1, readyCount: 1, needsReviewCount: 0 })
    expect(report.coverage.ready).toMatchObject({
      takeCount: 1,
      takeRatio: 1,
    })
    expect(report.coverage.ready.lyricCoverage.hangulSyllableCount).toBeGreaterThan(0)
    expect(report.results[0].status).toBe('ready')
    expect(report.results[0].f0.medianAbsCents).toBeLessThan(80)
    expect(report.results[0].duration.absDeltaSeconds).toBeLessThan(0.05)
  })

  it('fails with a clear action when a take WAV has not been recorded yet', () => {
    const { out, take } = makeRecordingPack()
    const reviewCsv = join(out, 'recording-review.csv')

    const report = auditPrivateSingerRecordingTakes({
      packDir: out,
      takes: take.id,
      reviewCsv,
    })

    expect(report.ok).toBe(false)
    expect(report.coverage.ready).toMatchObject({
      takeCount: 0,
      takeRatio: 0,
    })
    expect(report.coverage.needsReview.takeCount).toBe(1)
    expect(report.reviewQueue).toHaveLength(1)
    expect(report.reviewQueue[0]).toMatchObject({
      priority: 2,
      coverageCritical: true,
      id: take.id,
      status: 'missing-wav',
      failedGates: ['wav-present'],
    })
    expect(report.reviewQueue[0].coverageGaps.onset.length).toBeGreaterThan(0)
    expect(report.reviewQueue[0].coverageGaps.vowel.length).toBeGreaterThan(0)
    expect(report.results[0]).toMatchObject({
      status: 'missing-wav',
      gates: {
        failed: ['wav-present'],
      },
    })
    expect(report.results[0].nextActions[0]).toContain('Record or copy the WAV')
    const reviewSheet = readFileSync(reviewCsv, 'utf8')
    expect(reviewSheet).toContain('takeId,status')
    expect(reviewSheet).toContain('coverageCritical,coverageGaps')
    expect(reviewSheet).toContain(take.id)
    expect(reviewSheet).toContain('wav-present')
    expect(reviewSheet).toContain('yes')
  })

  it('flags leaked headphone guide ticks in an otherwise usable take', () => {
    const { out, take, request } = makeRecordingPack()
    writeFileSync(resolve(out, take.wavPath), guidedSineWav(request, 44100, { guideTickGain: 0.18 }))

    const report = auditPrivateSingerRecordingTakes({
      packDir: out,
      takes: take.id,
      durationToleranceSeconds: 0.05,
      minVoicedFrameRatio: 0.7,
      maxMedianAbsCents: 80,
      maxMissingOnsetRatio: 1,
      maxGuideTickCorrelation: 0.15,
    })

    expect(report.ok).toBe(false)
    expect(report.totals.failedGateCounts['guide-tick-leakage']).toBe(1)
    expect(report.results[0].guideLeakage.maxTickCorrelation).toBeGreaterThan(0.15)
    expect(report.results[0].gates.failed).toContain('guide-tick-leakage')
    expect(report.results[0].nextActions.join('\n')).toContain('headphone bleed')
    expect(report.reviewQueue[0]).toMatchObject({
      priority: 3,
      failedGates: ['guide-tick-leakage'],
    })
  })

  it('runs through the command-line entrypoint and writes a report file', () => {
    const { out, take, request } = makeRecordingPack()
    const reportPath = join(out, 'recording-audit.json')
    writeFileSync(resolve(out, take.wavPath), guidedSineWav(request))

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-private-singer-recording-takes.mjs',
        '--pack-dir',
        out,
        '--takes',
        take.id,
        '--report',
        reportPath,
        '--max-missing-onset-ratio',
        '1',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).ok).toBe(true)
  })
})

function makeRecordingPack() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-recording-take-audit-'))
  tempRoots.push(root)
  const out = join(root, 'pack')
  preparePrivateSingerRecordingPack({
    out,
    registryOut: join(root, 'registry.json'),
    targetMinutes: 0.1,
    sessionId: 'take-audit-001',
  })
  const session = JSON.parse(readFileSync(join(out, 'recording-session.json'), 'utf8'))
  const take = session.takes[0]
  const request = JSON.parse(readFileSync(resolve(out, take.neuralRequestPath), 'utf8'))
  mkdirSync(join(out, 'wavs'), { recursive: true })
  return { root, out, session, take, request }
}

function guidedSineWav(request, sampleRate = 44100, options = {}) {
  const durationSeconds = request.notes.reduce((max, note) => Math.max(max, note.startSeconds + note.durationSeconds), 0)
  const sampleCount = Math.ceil(durationSeconds * sampleRate)
  const samples = new Float32Array(sampleCount)
  for (const note of request.notes) {
    if (!note.targetHz) {
      continue
    }
    const start = Math.max(0, Math.round(note.startSeconds * sampleRate))
    const end = Math.min(samples.length, Math.round((note.startSeconds + note.durationSeconds) * sampleRate))
    for (let index = start; index < end; index += 1) {
      const local = (index - start) / Math.max(1, end - start)
      const attack = Math.min(1, local / 0.03)
      const release = Math.min(1, (1 - local) / 0.04)
      const envelope = Math.max(0, Math.min(attack, release))
      samples[index] += Math.sin((index / sampleRate) * Math.PI * 2 * note.targetHz) * 0.35 * envelope
    }
    if (options.guideTickGain) {
      mixGuideTick(samples, sampleRate, note.startSeconds, options.guideTickGain)
    }
  }
  return encodePcm16Wav(samples, sampleRate)
}

function mixGuideTick(samples, sampleRate, startSeconds, gain) {
  const start = Math.max(0, Math.round(startSeconds * sampleRate))
  const length = Math.min(samples.length - start, Math.round(0.018 * sampleRate))
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate
    const envelope = 1 - index / Math.max(1, length)
    samples[start + index] += Math.sin(Math.PI * 2 * 1800 * t) * envelope * gain
  }
}

function encodePcm16Wav(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
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
