#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

export const DEFAULT_ZIP = 'public/voicebanks/webuta-ko-v3.zip'
export const DEFAULT_REPORT = 'experiments/utau-v3/work/v3-pitch-audit.json'

const DEFAULT_THRESHOLDS = {
  maxMedianAbsCents: 25,
  maxDriftCents: 45,
  minMedianConfidence: 0.55,
  minVoicedFrames: 3,
}

const ANALYSIS_RANGES = {
  CV: [0.32, 0.76],
  CVC: [0.3, 0.67],
  V: [0.18, 0.82],
  VC: [0.14, 0.55],
}

export async function analyzeKoreanV3Pitch(options = {}) {
  const zipPath = resolve(options.zip ?? DEFAULT_ZIP)
  const maxSamples = Number(options.maxSamples ?? Number.POSITIVE_INFINITY)
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(options.thresholds ?? {}),
  }
  const bytes = readFileSync(zipPath)
  const zip = await JSZip.loadAsync(bytes)
  const manifestText = zip.files['webuta-ko-v3.manifest.json']
    ? await zip.files['webuta-ko-v3.manifest.json'].async('string')
    : '{}'
  const manifest = parseJson(manifestText)
  const manifestSamples = Array.isArray(manifest?.samples) ? manifest.samples : []
  const analyzableSamples = manifestSamples.filter(isPitchAnalyzableSample)
  const selectedSamples = analyzableSamples.slice(0, Math.min(analyzableSamples.length, maxSamples))
  const sampleAudits = []

  for (const sample of selectedSamples) {
    const zipFile = zip.files[sample.fileName]
    if (!zipFile) {
      sampleAudits.push({
        fileName: sample.fileName,
        alias: sample.alias ?? null,
        type: sample.type ?? null,
        pitch: sample.pitch ?? null,
        expectedHz: sample.baseHz ?? null,
        ok: false,
        problems: [`missing WAV file: ${sample.fileName}`],
      })
      continue
    }
    const parsed = parsePcm16Wav(await zipFile.async('uint8array'))
    if (!parsed.ok) {
      sampleAudits.push({
        fileName: sample.fileName,
        alias: sample.alias ?? null,
        type: sample.type ?? null,
        pitch: sample.pitch ?? null,
        expectedHz: sample.baseHz ?? null,
        ok: false,
        problems: [parsed.error],
      })
      continue
    }
    sampleAudits.push(analyzePitchForSample(sample, parsed.samples, parsed.sampleRate, thresholds))
  }

  const problems = sampleAudits.flatMap((audit) =>
    audit.problems.map((problem) => `${audit.fileName}: ${problem}`),
  )
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'v3-pitch-audit-pass' : 'v3-pitch-audit-fail',
    zip: {
      path: zipPath,
      bytes: bytes.length,
    },
    thresholds,
    manifest: {
      id: manifest?.id ?? null,
      name: manifest?.name ?? null,
      profile: manifest?.profile ?? null,
      sampleRate: manifest?.sampleRate ?? null,
    },
    pitch: {
      auditedCount: sampleAudits.length,
      totalAnalyzableCount: analyzableSamples.length,
      skippedCount: Math.max(0, analyzableSamples.length - sampleAudits.length),
      summary: summarizePitchAudits(sampleAudits),
      worst: worstPitchAudits(sampleAudits),
      samples: sampleAudits,
    },
    problems,
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

export function analyzePitchForSample(sample, samples, sampleRate, thresholds = DEFAULT_THRESHOLDS) {
  const expectedHz = Number(sample.baseHz)
  const [startFraction, endFraction] = ANALYSIS_RANGES[sample.type] ?? [0.25, 0.75]
  const start = Math.max(0, Math.floor(samples.length * startFraction))
  const end = Math.min(samples.length, Math.floor(samples.length * endFraction))
  const frameSize = Math.max(512, Math.floor(sampleRate * 0.08))
  const hopSize = Math.max(128, Math.floor(sampleRate * 0.04))
  const frameResults = []

  for (let offset = start; offset + frameSize <= end; offset += hopSize) {
    const result = estimateFrameF0(samples.subarray(offset, offset + frameSize), sampleRate, expectedHz)
    if (result) {
      frameResults.push({
        offsetSeconds: offset / sampleRate,
        f0Hz: result.f0Hz,
        cents: centsBetween(result.f0Hz, expectedHz),
        confidence: result.confidence,
        rms: result.rms,
      })
    }
  }

  const cents = frameResults.map((frame) => frame.cents)
  const confidences = frameResults.map((frame) => frame.confidence)
  const medianCents = median(cents)
  const medianConfidence = median(confidences)
  const driftCents = percentile(cents, 0.9) - percentile(cents, 0.1)
  const maxAbsCents = max(cents.map((value) => Math.abs(value)))
  const medianAbsCents = medianCents === null ? null : Math.abs(medianCents)
  const problems = [
    ...(frameResults.length < thresholds.minVoicedFrames
      ? [`only ${frameResults.length} voiced frames; expected at least ${thresholds.minVoicedFrames}`]
      : []),
    ...(medianAbsCents !== null && Number.isFinite(medianAbsCents) && medianAbsCents <= thresholds.maxMedianAbsCents
      ? []
      : [`median pitch error ${formatCents(medianCents)} exceeds ${thresholds.maxMedianAbsCents} cents`]),
    ...(Number.isFinite(driftCents) && driftCents <= thresholds.maxDriftCents
      ? []
      : [`pitch drift ${formatCents(driftCents)} exceeds ${thresholds.maxDriftCents} cents`]),
    ...(Number.isFinite(medianConfidence) && medianConfidence >= thresholds.minMedianConfidence
      ? []
      : [`median F0 confidence ${formatNumber(medianConfidence)} below ${thresholds.minMedianConfidence}`]),
  ]

  return {
    fileName: sample.fileName,
    alias: sample.alias ?? null,
    type: sample.type ?? null,
    pitch: sample.pitch ?? null,
    expectedHz,
    ok: problems.length === 0,
    problems,
    metrics: {
      analysisStartSeconds: start / sampleRate,
      analysisEndSeconds: end / sampleRate,
      voicedFrames: frameResults.length,
      medianF0Hz: median(frameResults.map((frame) => frame.f0Hz)),
      medianCents,
      medianAbsCents,
      maxAbsCents,
      driftCents,
      medianConfidence,
    },
    frames: frameResults,
  }
}

export function estimateFrameF0(samples, sampleRate, expectedHz) {
  if (!Number.isFinite(expectedHz) || expectedHz <= 0 || samples.length < 8) {
    return null
  }
  const minHz = expectedHz * 0.72
  const maxHz = expectedHz * 1.28
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
  const maxLag = Math.min(samples.length - 2, Math.ceil(sampleRate / minHz))
  if (maxLag <= minLag) {
    return null
  }

  let mean = 0
  for (const sample of samples) {
    mean += sample
  }
  mean /= samples.length

  const windowed = new Float32Array(samples.length)
  let energy = 0
  for (let i = 0; i < samples.length; i += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, samples.length - 1))
    const value = (samples[i] - mean) * hann
    windowed[i] = value
    energy += value * value
  }
  const rms = Math.sqrt(energy / samples.length)
  if (rms < 0.003) {
    return null
  }

  let bestLag = 0
  let bestCorrelation = -Infinity
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0
    let leftEnergy = 0
    let rightEnergy = 0
    for (let i = 0; i < windowed.length - lag; i += 1) {
      const left = windowed[i]
      const right = windowed[i + lag]
      corr += left * right
      leftEnergy += left * left
      rightEnergy += right * right
    }
    const normalized = corr / Math.sqrt(Math.max(1e-12, leftEnergy * rightEnergy))
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized
      bestLag = lag
    }
  }

  if (!bestLag || !Number.isFinite(bestCorrelation)) {
    return null
  }
  return {
    f0Hz: sampleRate / bestLag,
    confidence: bestCorrelation,
    rms,
  }
}

export function parsePcm16Wav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 44 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') {
    return { ok: false, error: 'not a RIFF/WAVE file' }
  }
  let offset = 12
  let format = null
  let dataOffset = -1
  let dataSize = 0
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (id === 'fmt ') {
      format = {
        audioFormat: view.getUint16(chunkStart, true),
        channels: view.getUint16(chunkStart + 2, true),
        sampleRate: view.getUint32(chunkStart + 4, true),
        bitsPerSample: view.getUint16(chunkStart + 14, true),
      }
    } else if (id === 'data') {
      dataOffset = chunkStart
      dataSize = size
      break
    }
    offset = chunkStart + size + (size % 2)
  }
  if (!format) {
    return { ok: false, error: 'missing fmt chunk' }
  }
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    return { ok: false, error: `unsupported WAV format ${format.audioFormat}/${format.bitsPerSample}` }
  }
  if (dataOffset < 0) {
    return { ok: false, error: 'missing data chunk' }
  }

  const frameCount = Math.floor(dataSize / 2 / format.channels)
  const samples = new Float32Array(frameCount)
  let cursor = dataOffset
  for (let i = 0; i < frameCount; i += 1) {
    let mixed = 0
    for (let channel = 0; channel < format.channels; channel += 1) {
      mixed += view.getInt16(cursor, true) / 32768
      cursor += 2
    }
    samples[i] = mixed / format.channels
  }
  return { ok: true, ...format, samples }
}

function isPitchAnalyzableSample(sample) {
  return (
    sample &&
    typeof sample.fileName === 'string' &&
    typeof sample.type === 'string' &&
    Number.isFinite(Number(sample.baseHz))
  )
}

function summarizePitchAudits(audits) {
  const metrics = audits.map((audit) => audit.metrics).filter(Boolean)
  return {
    okCount: audits.filter((audit) => audit.ok).length,
    problemCount: audits.filter((audit) => !audit.ok).length,
    maxMedianAbsCents: max(metrics.map((metric) => metric.medianAbsCents).filter(Number.isFinite)),
    maxDriftCents: max(metrics.map((metric) => metric.driftCents).filter(Number.isFinite)),
    minMedianConfidence: min(metrics.map((metric) => metric.medianConfidence).filter(Number.isFinite)),
    minVoicedFrames: min(metrics.map((metric) => metric.voicedFrames).filter(Number.isFinite)),
    maxVoicedFrames: max(metrics.map((metric) => metric.voicedFrames).filter(Number.isFinite)),
  }
}

function worstPitchAudits(audits) {
  return [...audits]
    .sort((a, b) => pitchRiskScore(b) - pitchRiskScore(a))
    .slice(0, 12)
    .map((audit) => ({
      fileName: audit.fileName,
      alias: audit.alias,
      type: audit.type,
      pitch: audit.pitch,
      ok: audit.ok,
      problems: audit.problems,
      metrics: audit.metrics ?? null,
    }))
}

function pitchRiskScore(audit) {
  if (!audit.metrics) {
    return 100000
  }
  return (
    (audit.ok ? 0 : 1000) +
    (audit.metrics.medianAbsCents ?? 0) * 3 +
    (audit.metrics.driftCents ?? 0) +
    Math.max(0, 1 - (audit.metrics.medianConfidence ?? 0)) * 100
  )
}

function centsBetween(actualHz, expectedHz) {
  return 1200 * Math.log2(actualHz / expectedHz)
}

function percentile(values, quantile) {
  if (!values.length) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * quantile))
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) {
    return sorted[lower]
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function median(values) {
  return percentile(values, 0.5)
}

function min(values) {
  return values.length ? Math.min(...values) : null
}

function max(values) {
  return values.length ? Math.max(...values) : null
}

function formatCents(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} cents` : 'unavailable'
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'unavailable'
}

function ascii(view, offset, length) {
  let text = ''
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i))
  }
  return text
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const options = {
    zip: DEFAULT_ZIP,
    report: DEFAULT_REPORT,
    thresholds: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--zip' && next) {
      options.zip = next
      index += 1
    } else if (arg === '--report' && next) {
      options.report = next
      index += 1
    } else if (arg === '--max-samples' && next) {
      options.maxSamples = Number(next)
      index += 1
    } else if (arg === '--max-median-abs-cents' && next) {
      options.thresholds.maxMedianAbsCents = Number(next)
      index += 1
    } else if (arg === '--max-drift-cents' && next) {
      options.thresholds.maxDriftCents = Number(next)
      index += 1
    } else if (arg === '--min-confidence' && next) {
      options.thresholds.minMedianConfidence = Number(next)
      index += 1
    }
  }
  return options
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.zip)) {
    console.error(`Missing voicebank zip: ${resolve(options.zip)}`)
    process.exitCode = 1
  } else {
    analyzeKoreanV3Pitch(options)
      .then((report) => {
        console.log(JSON.stringify({ ...report, pitch: { ...report.pitch, samples: undefined } }, null, 2))
        if (!report.ok) {
          process.exitCode = 1
        }
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      })
  }
}
