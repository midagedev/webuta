import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyzeKoreanV3Pitch,
  estimateFrameF0,
} from './analyze-korean-v3-pitch.mjs'
import { generateKoreanV3SyntheticVoicebank } from './generate-korean-v3-synthetic-voicebank.mjs'

const tempRoots = []
const SAMPLE_RATE = 44100

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Korean V3 pitch analyzer', () => {
  it('estimates the fundamental of a stable tone near the expected pitch', () => {
    const tone = sineWave(440, 0.18)

    const result = estimateFrameF0(tone, SAMPLE_RATE, 440)

    expect(result).not.toBeNull()
    expect(centsBetween(result.f0Hz, 440)).toBeLessThan(8)
    expect(result.confidence).toBeGreaterThan(0.95)
  })

  it('passes the generated tiny V3 voicebank and writes a per-sample report', async () => {
    const root = makeTempRoot()
    const zipPath = join(root, 'webuta-ko-v3.zip')
    const reportPath = join(root, 'v3-pitch.json')
    await generateKoreanV3SyntheticVoicebank({ output: zipPath, profile: 'tiny' })

    const report = await analyzeKoreanV3Pitch({ zip: zipPath, report: reportPath })
    const savedReport = JSON.parse(readFileSync(reportPath, 'utf8'))

    expect(report.ok).toBe(true)
    expect(report.pitch.auditedCount).toBeGreaterThan(10)
    expect(report.pitch.summary.problemCount).toBe(0)
    expect(report.pitch.summary.maxMedianAbsCents).toBeLessThan(10)
    expect(savedReport.pitch.samples.length).toBe(report.pitch.auditedCount)
  })

  it('fails when a sample is far from its declared base pitch', async () => {
    const root = makeTempRoot()
    const zipPath = join(root, 'detuned.zip')
    await writeFakeVoicebankZip(zipPath, {
      actualHz: 330,
      declaredHz: 440,
    })

    const report = await analyzeKoreanV3Pitch({ zip: zipPath })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('v3-pitch-audit-fail')
    expect(report.problems.join('\n')).toContain('median pitch error')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-v3-pitch-'))
  tempRoots.push(root)
  return root
}

async function writeFakeVoicebankZip(path, { actualHz, declaredHz }) {
  const zip = new JSZip()
  const fileName = 'samples/test.wav'
  zip.file(fileName, encodeWav(sineWave(actualHz, 0.96)))
  zip.file(
    'webuta-ko-v3.manifest.json',
    `${JSON.stringify({
      id: 'webuta-ko-v3-synthetic',
      name: 'Test V3',
      profile: 'test',
      sampleRate: SAMPLE_RATE,
      samples: [
        {
          type: 'V',
          alias: '아',
          aliases: ['아'],
          pitch: 'A4',
          midi: 69,
          baseHz: declaredHz,
          fileName,
          durationSeconds: 0.96,
        },
      ],
    })}\n`,
  )
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  await import('node:fs/promises').then(({ writeFile }) => writeFile(path, bytes))
}

function sineWave(hz, seconds) {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds))
  for (let i = 0; i < samples.length; i += 1) {
    const envelope = Math.min(1, i / 600, (samples.length - i - 1) / 600)
    samples[i] = Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * envelope * 0.72
  }
  return samples
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }
  return buffer
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

function centsBetween(actualHz, expectedHz) {
  return Math.abs(1200 * Math.log2(actualHz / expectedHz))
}
