import { describe, expect, it } from 'vitest'
import { masterMonoMix, measureMean, measurePeak } from './mastering'

describe('mastering chain', () => {
  it('removes DC offset and keeps peaks bounded', () => {
    const samples = new Float32Array(4096)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.34 + Math.sin(i / 9) * 1.8
    }

    masterMonoMix(samples, { sampleRate: 44100, targetPeak: 0.86, maxGain: 3 })

    expect(Math.abs(measureMean(samples))).toBeLessThan(0.01)
    expect(measurePeak(samples)).toBeLessThanOrEqual(0.87)
  })

  it('fades the exported edges to prevent start and end clicks', () => {
    const samples = new Float32Array(1000)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = i < samples.length / 2 ? 0.4 : -0.4
    }

    masterMonoMix(samples, {
      sampleRate: 1000,
      highPassHz: 0,
      targetPeak: 0.5,
      maxGain: 1,
      fadeEdgesMs: 20,
    })

    expect(Math.abs(samples[0])).toBeLessThan(0.001)
    expect(Math.abs(samples.at(-1) ?? 1)).toBeLessThan(0.001)
    expect(Math.abs(samples[40])).toBeGreaterThan(0.1)
  })
})
