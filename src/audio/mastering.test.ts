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
})
