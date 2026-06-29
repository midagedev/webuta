import { describe, expect, it } from 'vitest'
import { encodeWav, inspectWavBlob, inspectWavBuffer, isGarageBandReadyWav } from './wav'

describe('WAV encoder', () => {
  it('writes a mono PCM WAV header', async () => {
    const blob = encodeWav(new Float32Array([0, 0.5, -0.5]), 44100)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const header = String.fromCharCode(...bytes.slice(0, 4))
    const wave = String.fromCharCode(...bytes.slice(8, 12))

    expect(blob.type).toBe('audio/wav')
    expect(header).toBe('RIFF')
    expect(wave).toBe('WAVE')
    expect(bytes.length).toBe(50)
  })

  it('inspects GarageBand-ready WAV metadata', async () => {
    const blob = encodeWav(new Float32Array(44100), 44100)
    const info = await inspectWavBlob(blob)

    expect(info.container).toBe('RIFF/WAVE')
    expect(info.formatName).toBe('PCM')
    expect(info.channelCount).toBe(1)
    expect(info.sampleRate).toBe(44100)
    expect(info.bitsPerSample).toBe(16)
    expect(info.durationSeconds).toBe(1)
    expect(isGarageBandReadyWav(info)).toBe(true)
  })

  it('rejects invalid WAV containers during inspection', () => {
    const invalid = new TextEncoder().encode('not a wave').buffer

    expect(() => inspectWavBuffer(invalid)).toThrow('Invalid WAV container')
  })
})
