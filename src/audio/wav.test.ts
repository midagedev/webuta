import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

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
})
