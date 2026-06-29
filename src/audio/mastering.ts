export type MasteringOptions = {
  sampleRate: number
  highPassHz?: number
  targetPeak?: number
  maxGain?: number
}

export function masterMonoMix(samples: Float32Array, options: MasteringOptions) {
  removeDcOffset(samples)
  highPass(samples, options.sampleRate, options.highPassHz ?? 35)
  softLimit(samples)
  peakNormalize(samples, options.targetPeak ?? 0.88, options.maxGain ?? 2.4)
}

export function measurePeak(samples: Float32Array) {
  let peak = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample))
  }
  return peak
}

export function measureMean(samples: Float32Array) {
  if (samples.length === 0) {
    return 0
  }
  let sum = 0
  for (const sample of samples) {
    sum += sample
  }
  return sum / samples.length
}

function removeDcOffset(samples: Float32Array) {
  const mean = measureMean(samples)
  if (Math.abs(mean) < 0.000001) {
    return
  }
  for (let i = 0; i < samples.length; i++) {
    samples[i] -= mean
  }
}

function highPass(samples: Float32Array, sampleRate: number, cutoffHz: number) {
  if (samples.length === 0 || cutoffHz <= 0) {
    return
  }
  const dt = 1 / sampleRate
  const rc = 1 / (2 * Math.PI * cutoffHz)
  const alpha = rc / (rc + dt)
  let previousInput = samples[0]
  let previousOutput = 0
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i]
    const output = alpha * (previousOutput + input - previousInput)
    samples[i] = output
    previousInput = input
    previousOutput = output
  }
}

function softLimit(samples: Float32Array) {
  const drive = 1.35
  const scale = Math.tanh(drive)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.tanh(samples[i] * drive) / scale
  }
}

function peakNormalize(samples: Float32Array, targetPeak: number, maxGain: number) {
  const peak = measurePeak(samples)
  if (peak < 0.01) {
    return
  }
  const gain = Math.min(maxGain, targetPeak / peak)
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= gain
  }
}
