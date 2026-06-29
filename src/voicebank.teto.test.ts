import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { createUtauSampleRenderer } from './renderers/utauSampleRenderer'
import { findEntryForLyric, loadVoicebankZip } from './voicebank'

const runTetoAsset = process.env.RUN_TETO_ASSET === '1'

describe.skipIf(!runTetoAsset)('official Kasane Teto OpenUTAU asset', () => {
  it('loads the local non-redistributed test zip and finds Japanese aliases', async () => {
    const bytes = await readFile('test-assets/TETO-OUset240323.zip')
    const file = new File([bytes], 'TETO-OUset240323.zip')

    const voicebank = await loadVoicebankZip(file)
    const a = findEntryForLyric(voicebank, 'a')
    const la = findEntryForLyric(voicebank, 'la')
    const doKorean = findEntryForLyric(voicebank, '도')
    const suKorean = findEntryForLyric(voicebank, '스')

    expect(voicebank.name).toContain('重音テト')
    expect(voicebank.sampleCount).toBeGreaterThan(1000)
    expect(voicebank.wavCount).toBeGreaterThan(1000)
    expect(a.alias).toContain('あ')
    expect(la.alias).toContain('ら')
    expect(doKorean.alias).toContain('ど')
    expect(suKorean.alias).toContain('す')
  }, 60000)

  it('renders the built-in Korean demo with local Teto samples', async () => {
    const bytes = await readFile('test-assets/TETO-OUset240323.zip')
    const file = new File([bytes], 'TETO-OUset240323.zip')
    const voicebank = await loadVoicebankZip(file)
    const audioContext = {
      async decodeAudioData(buffer: ArrayBuffer) {
        return decodeWavToAudioBuffer(buffer)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    const result = await renderer.render(demoProject)
    const peak = result.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
    const hasNonFiniteSample = result.samples.some((sample) => !Number.isFinite(sample))

    expect(result.sampleRate).toBe(44100)
    expect(peak).toBeGreaterThan(0.04)
    expect(peak).toBeLessThanOrEqual(0.89)
    expect(hasNonFiniteSample).toBe(false)
  }, 60000)
})

function decodeWavToAudioBuffer(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  if (readFourCc(view, 0) !== 'RIFF' || readFourCc(view, 8) !== 'WAVE') {
    throw new Error('Unsupported WAV container')
  }

  let fmtOffset = -1
  let dataOffset = -1
  let dataSize = 0
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const id = readFourCc(view, offset)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      fmtOffset = offset + 8
    }
    if (id === 'data') {
      dataOffset = offset + 8
      dataSize = size
      break
    }
    offset += 8 + size + (size % 2)
  }

  if (fmtOffset < 0 || dataOffset < 0) {
    throw new Error('Missing WAV fmt or data chunk')
  }

  const audioFormat = view.getUint16(fmtOffset, true)
  const channelCount = view.getUint16(fmtOffset + 2, true)
  const sampleRate = view.getUint32(fmtOffset + 4, true)
  const blockAlign = view.getUint16(fmtOffset + 12, true)
  const bitsPerSample = view.getUint16(fmtOffset + 14, true)
  const frameCount = Math.floor(dataSize / blockAlign)
  const samples = new Float32Array(frameCount)

  for (let frame = 0; frame < frameCount; frame++) {
    const sampleOffset = dataOffset + frame * blockAlign
    samples[frame] = readPcmSample(view, sampleOffset, audioFormat, bitsPerSample)
    if (channelCount > 1) {
      samples[frame] /= Math.sqrt(channelCount)
    }
  }

  return {
    sampleRate,
    getChannelData(channel: number) {
      if (channel !== 0) {
        throw new Error(`Unexpected channel: ${channel}`)
      }
      return samples
    },
  } as AudioBuffer
}

function readFourCc(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function readPcmSample(view: DataView, offset: number, audioFormat: number, bitsPerSample: number) {
  if (audioFormat === 1 && bitsPerSample === 16) {
    return view.getInt16(offset, true) / 32768
  }
  if (audioFormat === 1 && bitsPerSample === 8) {
    return (view.getUint8(offset) - 128) / 128
  }
  if (audioFormat === 3 && bitsPerSample === 32) {
    return view.getFloat32(offset, true)
  }
  throw new Error(`Unsupported WAV sample format: ${audioFormat}/${bitsPerSample}`)
}
