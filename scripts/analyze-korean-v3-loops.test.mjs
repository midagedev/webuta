import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeKoreanV3Loops } from './analyze-korean-v3-loops.mjs'
import { generateKoreanV3SyntheticVoicebank } from './generate-korean-v3-synthetic-voicebank.mjs'

const tempRoots = []
const SAMPLE_RATE = 44100

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Korean V3 loop analyzer', () => {
  it('finds smooth loop candidates in the generated tiny V3 voicebank', async () => {
    const root = makeTempRoot()
    const zipPath = join(root, 'webuta-ko-v3.zip')
    const reportPath = join(root, 'v3-loop.json')
    await generateKoreanV3SyntheticVoicebank({ output: zipPath, profile: 'tiny' })

    const report = await analyzeKoreanV3Loops({
      zip: zipPath,
      report: reportPath,
      thresholds: { minAuditedSamples: 20 },
    })
    const savedReport = JSON.parse(readFileSync(reportPath, 'utf8'))

    expect(report.ok).toBe(true)
    expect(report.loop.auditedCount).toBeGreaterThan(20)
    expect(report.loop.summary.problemCount).toBe(0)
    expect(report.loop.summary.maxResidualRatio).toBeLessThan(0.14)
    expect(savedReport.loop.samples.length).toBe(report.loop.auditedCount)
  })

  it('fails a non-periodic sample that has no useful sustain loop', async () => {
    const root = makeTempRoot()
    const zipPath = join(root, 'bad-loop.zip')
    await writeFakeVoicebankZip(zipPath, noiseSource(0.94))

    const report = await analyzeKoreanV3Loops({
      zip: zipPath,
      thresholds: { minAuditedSamples: 1 },
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('v3-loop-audit-fail')
    expect(report.problems.join('\n')).toContain('loop residual ratio')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-v3-loop-'))
  tempRoots.push(root)
  return root
}

async function writeFakeVoicebankZip(path, samples) {
  const zip = new JSZip()
  zip.file('samples/test.wav', encodeWav(samples))
  zip.file('oto.ini', 'test.wav=아,0,165,-650,72,34\n')
  zip.file(
    'webuta-ko-v3.manifest.json',
    `${JSON.stringify({
      id: 'webuta-ko-v3-synthetic',
      name: 'Bad Loop Test',
      profile: 'test',
      sampleRate: SAMPLE_RATE,
      samples: [
        {
          type: 'CV',
          alias: '아',
          aliases: ['아'],
          pitch: 'F4',
          baseHz: 349.228231,
          fileName: 'samples/test.wav',
          durationSeconds: samples.length / SAMPLE_RATE,
        },
      ],
    })}\n`,
  )
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  await writeFile(path, bytes)
}

function noiseSource(seconds) {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds))
  let seed = 246813579
  for (let i = 0; i < samples.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const noise = (seed / 0xffffffff) * 2 - 1
    const envelope = Math.min(1, i / 900, (samples.length - i - 1) / 900)
    samples[i] = noise * 0.58 * envelope
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
