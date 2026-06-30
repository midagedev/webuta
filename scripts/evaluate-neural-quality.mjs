#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderNeuralRequest } from './neural-render-service.mjs'

const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const VOWEL_COUNT = 21
const CODA_COUNT = 28
const DEFAULT_PHRASE_SET = 'experiments/neural-singer/quality-phrases.json'
const DEFAULT_OUT_ROOT = 'experiments/neural-singer/work/neural-quality'
const DEFAULT_TIMEBASE = 480
const F0_FRAME_SECONDS = 0.04
const F0_HOP_SECONDS = 0.01
const ONSET_FRAME_SECONDS = 0.02
const ONSET_HOP_SECONDS = 0.005
const CODA_FRAME_SECONDS = 0.02
const CODA_HOP_SECONDS = 0.01
const SOFT_ONSET_SYMBOLS = new Set(['n', 'm', 'r', 'ng'])

const ONSET_SYMBOLS = [
  'g',
  'kk',
  'n',
  'd',
  'tt',
  'r',
  'm',
  'b',
  'pp',
  's',
  'ss',
  '',
  'j',
  'jj',
  'ch',
  'k',
  't',
  'p',
  'h',
]

const VOWEL_SYMBOLS = [
  'a',
  'ae',
  'ya',
  'yae',
  'eo',
  'e',
  'yeo',
  'ye',
  'o',
  'wa',
  'wae',
  'oe',
  'yo',
  'u',
  'wo',
  'we',
  'wi',
  'yu',
  'eu',
  'ui',
  'i',
]

const CODA_SYMBOLS = [
  '',
  'g',
  'kk',
  'gs',
  'n',
  'nj',
  'nh',
  'd',
  'r',
  'rg',
  'rm',
  'rb',
  'rs',
  'rt',
  'rp',
  'rh',
  'm',
  'b',
  'bs',
  's',
  'ss',
  'ng',
  'j',
  'ch',
  'k',
  't',
  'p',
  'h',
]

export async function evaluateNeuralQuality(options = {}) {
  const phraseSetPath = resolve(options.phraseSet ?? DEFAULT_PHRASE_SET)
  const phraseSet = loadQualityPhraseSet(phraseSetPath)
  const runId = options.runId ?? new Date().toISOString().replace(/[:.]/gu, '-')
  const outDir = resolve(options.out ?? join(DEFAULT_OUT_ROOT, runId))
  const render = options.render !== false
  const phraseFilter = parsePhraseFilter(options.phrases)
  const selectedPhrases = phraseSet.phrases.filter((phrase) => !phraseFilter || phraseFilter.has(phrase.id))
  if (selectedPhrases.length === 0) {
    throw new Error('No quality phrases selected.')
  }

  mkdirSync(outDir, { recursive: true })
  const results = []
  for (const phrase of selectedPhrases) {
    const phraseDir = join(outDir, phrase.id)
    mkdirSync(phraseDir, { recursive: true })
    const request = phraseToNeuralRequest(phrase, phraseSet)
    const requestPath = join(phraseDir, 'request.json')
    writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`)

    if (!render) {
      results.push({
        id: phrase.id,
        title: phrase.title,
        ok: true,
        skippedRender: true,
        requestPath,
      })
      continue
    }

    const response = await renderNeuralRequest(request, {
      ...options,
      workDir: join(phraseDir, 'render-work'),
    })
    if (!response.ok) {
      const failed = {
        id: phrase.id,
        title: phrase.title,
        ok: false,
        error: response.error,
        diagnostics: response.diagnostics,
        requestPath,
      }
      writeFileSync(join(phraseDir, 'quality-diagnostics.json'), `${JSON.stringify(failed, null, 2)}\n`)
      results.push(failed)
      continue
    }

    const diagnostics = analyzeRenderedQuality({
      request,
      phrase,
      phraseSet,
      response,
      wavPath: response.diagnostics.artifacts.wavPath,
    })
    const qualityPath = join(phraseDir, 'quality-diagnostics.json')
    writeFileSync(qualityPath, `${JSON.stringify(diagnostics, null, 2)}\n`)
    results.push({
      id: phrase.id,
      title: phrase.title,
      ok: true,
      requestPath,
      qualityPath,
      wavPath: response.diagnostics.artifacts.wavPath,
      renderSeconds: response.diagnostics.renderSeconds,
      gates: diagnostics.gates,
      summary: diagnostics.summary,
    })
  }

  const summary = {
    version: 1,
    runId,
    generatedAt: new Date().toISOString(),
    phraseSetPath,
    outDir,
    renderer: phraseSet.renderer,
    modelId: options.modelId ?? 'webuta-ko-neural-dev',
    rendered: render,
    thresholds: phraseSet.betaThresholds,
    totals: summarizeResults(results),
    results,
  }
  const listeningScoresTemplatePath = join(outDir, 'listening-scores.template.json')
  summary.listeningScoresTemplate = listeningScoresTemplatePath
  writeFileSync(listeningScoresTemplatePath, `${JSON.stringify(listeningScoresTemplateFor(summary), null, 2)}\n`)
  writeFileSync(join(outDir, 'quality-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(outDir, 'listening-log.md'), listeningLogFor(summary))
  return summary
}

export function loadQualityPhraseSet(path = DEFAULT_PHRASE_SET) {
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    throw new Error(`Missing quality phrase set: ${resolved}`)
  }
  const phraseSet = JSON.parse(readFileSync(resolved, 'utf8'))
  validatePhraseSet(phraseSet)
  return phraseSet
}

export function phraseToNeuralRequest(phrase, phraseSet = {}) {
  const bpm = Number(phrase.bpm ?? 120)
  const timebase = Number(phraseSet.timebase ?? DEFAULT_TIMEBASE)
  const ticksPerSecond = (timebase * bpm) / 60
  let cursorSeconds = 0
  const notes = []
  for (const [index, note] of phrase.notes.entries()) {
    cursorSeconds += Number(note.gapSeconds ?? 0)
    const durationSeconds = Number(note.durationSeconds)
    const startSeconds = cursorSeconds
    const midi = Number(note.midi)
    notes.push({
      kind: 'note',
      id: `${phrase.id}-${String(index + 1).padStart(2, '0')}`,
      trackId: 'quality-main',
      partId: phrase.id,
      startTick: Math.round(startSeconds * ticksPerSecond),
      durationTick: Math.round(durationSeconds * ticksPerSecond),
      startSeconds,
      durationSeconds,
      midi,
      targetHz: midiToHz(midi),
      lyric: note.lyric,
      phonemes: phonemesForLyric(note.lyric),
      pitchCurve: normalizePitchCurve(note.pitchCurve ?? []),
    })
    cursorSeconds += durationSeconds
  }
  return {
    version: 1,
    project: {
      id: phrase.id,
      title: phrase.title,
      bpm,
      timebase,
    },
    voice: {
      id: phraseSet.voiceId ?? 'webuta-ko-neural-dev',
      language: phraseSet.language ?? 'ko',
      renderer: phraseSet.renderer ?? 'diffsinger',
    },
    render: {
      sampleRate: Number(phraseSet.sampleRate ?? 44100),
      format: 'wav',
      includeDiagnostics: true,
    },
    notes,
  }
}

export function analyzeRenderedQuality({ request, phrase, phraseSet = {}, response, wavPath }) {
  const wav = decodePcm16Wav(readFileSync(wavPath))
  const audio = analyzeAudio(wav.samples, wav.sampleRate)
  const f0 = analyzeF0Tracking(wav.samples, wav.sampleRate, request)
  const onset = analyzeOnsetTiming(wav.samples, wav.sampleRate, request)
  const coda = analyzeCodaRepetition(wav.samples, wav.sampleRate, request)
  const duration = analyzeDurationAlignment(wav.durationSeconds, request)
  const thresholds = phraseSet.betaThresholds ?? {}
  const gates = evaluateGates({ audio, f0, onset, coda, duration }, thresholds)
  return {
    version: 1,
    phrase: {
      id: phrase.id,
      title: phrase.title,
      purpose: phrase.purpose,
    },
    request: {
      noteCount: request.notes.length,
      durationSeconds: duration.expectedSeconds,
      bpm: request.project.bpm,
    },
    response: {
      renderSeconds: response.diagnostics.renderSeconds,
      warnings: response.diagnostics.warnings,
      artifacts: response.diagnostics.artifacts,
    },
    wav: {
      path: wavPath,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitsPerSample: wav.bitsPerSample,
      durationSeconds: wav.durationSeconds,
    },
    audio,
    f0,
    onset,
    coda,
    duration,
    gates,
    summary: summarizeDiagnostics({ audio, f0, onset, coda, duration, gates }),
  }
}

export function analyzeAudio(samples, sampleRate, options = {}) {
  const silenceThreshold = Number(options.silenceThreshold ?? 0.006)
  let peak = 0
  let sumSquares = 0
  let clippingSamples = 0
  let silenceSamples = 0
  for (const sample of samples) {
    const abs = Math.abs(sample)
    peak = Math.max(peak, abs)
    sumSquares += sample * sample
    if (abs >= 0.999) {
      clippingSamples += 1
    }
    if (abs < silenceThreshold) {
      silenceSamples += 1
    }
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0
  const windowSize = Math.max(1, Math.round(sampleRate * 0.1))
  const windowRms = []
  for (let start = 0; start < samples.length; start += windowSize) {
    windowRms.push(rmsOf(samples, start, Math.min(samples.length, start + windowSize)))
  }
  return {
    peak: roundMetric(peak),
    rms: roundMetric(rms),
    loudnessDbFs: dbfs(rms),
    clippingSamples,
    clippingRatio: samples.length > 0 ? roundMetric(clippingSamples / samples.length) : 0,
    silenceRatio: samples.length > 0 ? roundMetric(silenceSamples / samples.length) : 0,
    noiseFloorDbFs: dbfs(percentile(windowRms, 0.1)),
  }
}

export function analyzeF0Tracking(samples, sampleRate, request, options = {}) {
  const frameSize = Math.max(1, Math.round(sampleRate * Number(options.frameSeconds ?? F0_FRAME_SECONDS)))
  const hopSize = Math.max(1, Math.round(sampleRate * Number(options.hopSeconds ?? F0_HOP_SECONDS)))
  const minHz = Number(options.minHz ?? 70)
  const maxHz = Number(options.maxHz ?? 900)
  const globalRms = rmsOf(samples, 0, samples.length)
  const rmsThreshold = Math.max(0.004, globalRms * 0.24)
  const frames = []
  const absCents = []
  let targetFrameCount = 0
  let estimatedFrameCount = 0
  let missingF0Count = 0

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const timeSeconds = (start + frameSize / 2) / sampleRate
    const targetHz = targetHzAt(request, timeSeconds)
    if (targetHz <= 0) {
      continue
    }
    targetFrameCount += 1
    const estimate = estimateFrameF0(samples, start, frameSize, sampleRate, minHz, maxHz, rmsThreshold, targetHz)
    if (!estimate) {
      missingF0Count += 1
      continue
    }
    estimatedFrameCount += 1
    const cents = 1200 * Math.log2(estimate.hz / targetHz)
    absCents.push(Math.abs(cents))
    frames.push({
      timeSeconds: roundMetric(timeSeconds),
      targetHz: roundMetric(targetHz),
      estimatedHz: roundMetric(estimate.hz),
      confidence: roundMetric(estimate.confidence),
      centsError: roundMetric(cents),
    })
  }

  return {
    frameSeconds: Number(options.frameSeconds ?? F0_FRAME_SECONDS),
    hopSeconds: Number(options.hopSeconds ?? F0_HOP_SECONDS),
    targetFrameCount,
    estimatedFrameCount,
    missingF0Count,
    voicedFrameRatio: targetFrameCount > 0 ? roundMetric(estimatedFrameCount / targetFrameCount) : 0,
    missingF0Ratio: targetFrameCount > 0 ? roundMetric(missingF0Count / targetFrameCount) : 1,
    medianAbsCents: roundMetric(percentile(absCents, 0.5)),
    meanAbsCents: roundMetric(mean(absCents)),
    p90AbsCents: roundMetric(percentile(absCents, 0.9)),
    sampledFrames: frames.filter((_, index) => index % Math.max(1, Math.ceil(frames.length / 24)) === 0).slice(0, 24),
  }
}

export function analyzeOnsetTiming(samples, sampleRate, request, options = {}) {
  const frameSize = Math.max(1, Math.round(sampleRate * Number(options.frameSeconds ?? ONSET_FRAME_SECONDS)))
  const hopSize = Math.max(1, Math.round(sampleRate * Number(options.hopSeconds ?? ONSET_HOP_SECONDS)))
  const globalRms = rmsOf(samples, 0, samples.length)
  const noteResults = []

  for (const note of request.notes.filter((item) => item.kind === 'note')) {
    const startSample = Math.max(0, Math.round(note.startSeconds * sampleRate))
    const endSample = Math.min(samples.length, Math.round((note.startSeconds + note.durationSeconds) * sampleRate))
    const attackEnd = Math.min(endSample, startSample + Math.round(0.2 * sampleRate))
    const notePeak = peakOf(samples, startSample, endSample)
    const threshold = Math.max(0.004, globalRms * 0.35, notePeak * 0.14)
    let onsetSeconds = null
    for (let start = startSample; start + frameSize <= attackEnd; start += hopSize) {
      if (rmsOf(samples, start, start + frameSize) >= threshold) {
        onsetSeconds = start / sampleRate
        break
      }
    }
    const onsetLagSeconds = onsetSeconds === null ? null : onsetSeconds - note.startSeconds
    const hasEnergyOnset = noteHasEnergyOnset(note)
    noteResults.push({
      id: note.id,
      lyric: note.lyric,
      startSeconds: roundMetric(note.startSeconds),
      hasOnset: hasEnergyOnset,
      onsetLagSeconds: onsetLagSeconds === null ? null : roundMetric(onsetLagSeconds),
      threshold: roundMetric(threshold),
      notePeak: roundMetric(notePeak),
    })
  }

  const lags = noteResults.flatMap((note) => (note.onsetLagSeconds === null ? [] : [note.onsetLagSeconds]))
  const onsetBearingNotes = noteResults.filter((note) => note.hasOnset)
  const missingOnsetCount = onsetBearingNotes.filter((note) => note.onsetLagSeconds === null).length
  return {
    frameSeconds: Number(options.frameSeconds ?? ONSET_FRAME_SECONDS),
    hopSeconds: Number(options.hopSeconds ?? ONSET_HOP_SECONDS),
    noteCount: noteResults.length,
    onsetBearingNoteCount: onsetBearingNotes.length,
    missingOnsetCount,
    missingOnsetRatio: onsetBearingNotes.length > 0 ? roundMetric(missingOnsetCount / onsetBearingNotes.length) : 0,
    medianOnsetLagSeconds: roundMetric(percentile(lags, 0.5)),
    maxOnsetLagSeconds: roundMetric(lags.length > 0 ? Math.max(...lags) : 0),
    notes: noteResults,
  }
}

function noteHasEnergyOnset(note) {
  return note.phonemes.some((phoneme) => phoneme.role === 'onset' && !SOFT_ONSET_SYMBOLS.has(phoneme.symbol))
}

export function analyzeCodaRepetition(samples, sampleRate, request, options = {}) {
  const frameSize = Math.max(1, Math.round(sampleRate * Number(options.frameSeconds ?? CODA_FRAME_SECONDS)))
  const hopSize = Math.max(1, Math.round(sampleRate * Number(options.hopSeconds ?? CODA_HOP_SECONDS)))
  const minDurationSeconds = Number(options.minDurationSeconds ?? 0.45)
  const sustainHeadGuardSeconds = Number(options.sustainHeadGuardSeconds ?? 0.18)
  const codaTailGuardSeconds = Number(options.codaTailGuardSeconds ?? 0.12)
  const noteResults = []

  for (const note of request.notes.filter((item) => item.kind === 'note' && item.durationSeconds >= minDurationSeconds)) {
    const codaPhones = note.phonemes.filter((phoneme) => phoneme.role === 'coda')
    if (codaPhones.length === 0) {
      continue
    }

    const startSeconds = note.startSeconds + Math.min(note.durationSeconds * 0.38, sustainHeadGuardSeconds)
    const endSeconds = note.startSeconds + note.durationSeconds - Math.min(note.durationSeconds * 0.28, codaTailGuardSeconds)
    const startSample = clampInt(Math.round(startSeconds * sampleRate), 0, samples.length)
    const endSample = clampInt(Math.round(endSeconds * sampleRate), startSample, samples.length)
    const frames = []
    for (let start = startSample; start + frameSize <= endSample; start += hopSize) {
      const rms = rmsOf(samples, start, start + frameSize)
      frames.push({
        timeSeconds: (start + frameSize / 2) / sampleRate,
        rms,
        transientRatio: transientRatioOf(samples, start, start + frameSize),
      })
    }

    const rmsValues = frames.map((frame) => frame.rms)
    const transientValues = frames.map((frame) => frame.transientRatio)
    const rmsMedian = percentile(rmsValues, 0.5)
    const transientMedian = percentile(transientValues, 0.5)
    const rmsMad = medianAbsoluteDeviation(rmsValues, rmsMedian)
    const transientMad = medianAbsoluteDeviation(transientValues, transientMedian)
    const rmsThreshold = Math.max(rmsMedian * 1.8, rmsMedian + Math.max(0.006, rmsMad * 3.2))
    const transientThreshold = Math.max(transientMedian * 1.35, transientMedian + Math.max(0.015, transientMad * 2.5))
    const burstFrames = frames.filter((frame) => frame.rms >= rmsThreshold && frame.transientRatio >= transientThreshold)
    const burstCount = countSeparatedEvents(burstFrames.map((frame) => frame.timeSeconds), 0.055)

    noteResults.push({
      id: note.id,
      lyric: note.lyric,
      coda: codaPhones.map((phoneme) => phoneme.symbol).join(' '),
      sustainStartSeconds: roundMetric(startSeconds),
      sustainEndSeconds: roundMetric(endSeconds),
      analyzedFrameCount: frames.length,
      rmsMedian: roundMetric(rmsMedian),
      transientMedian: roundMetric(transientMedian),
      rmsThreshold: roundMetric(rmsThreshold),
      transientThreshold: roundMetric(transientThreshold),
      sustainBurstCount: burstCount,
      sampledBursts: burstFrames
        .filter((_, index) => index % Math.max(1, Math.ceil(burstFrames.length / 8)) === 0)
        .slice(0, 8)
        .map((frame) => ({
          timeSeconds: roundMetric(frame.timeSeconds),
          rms: roundMetric(frame.rms),
          transientRatio: roundMetric(frame.transientRatio),
        })),
    })
  }

  const burstCounts = noteResults.map((note) => note.sustainBurstCount)
  return {
    frameSeconds: Number(options.frameSeconds ?? CODA_FRAME_SECONDS),
    hopSeconds: Number(options.hopSeconds ?? CODA_HOP_SECONDS),
    codaNoteCount: noteResults.length,
    maxSustainBurstCount: burstCounts.length > 0 ? Math.max(...burstCounts) : 0,
    totalSustainBurstCount: burstCounts.reduce((sum, count) => sum + count, 0),
    notes: noteResults,
  }
}

export function analyzeDurationAlignment(renderedSeconds, request) {
  const expectedSeconds = request.notes.reduce(
    (max, note) => Math.max(max, note.startSeconds + note.durationSeconds),
    0,
  )
  const deltaSeconds = renderedSeconds - expectedSeconds
  return {
    expectedSeconds: roundMetric(expectedSeconds),
    renderedSeconds: roundMetric(renderedSeconds),
    deltaSeconds: roundMetric(deltaSeconds),
    absDeltaSeconds: roundMetric(Math.abs(deltaSeconds)),
    ratio: expectedSeconds > 0 ? roundMetric(renderedSeconds / expectedSeconds) : 0,
  }
}

function validatePhraseSet(phraseSet) {
  if (!phraseSet || phraseSet.version !== 1) {
    throw new Error('Unsupported neural quality phrase set version.')
  }
  if (!Array.isArray(phraseSet.phrases) || phraseSet.phrases.length === 0) {
    throw new Error('Quality phrase set has no phrases.')
  }
  for (const phrase of phraseSet.phrases) {
    if (!phrase.id || !Array.isArray(phrase.notes) || phrase.notes.length === 0) {
      throw new Error(`Invalid quality phrase entry: ${phrase.id ?? 'unknown'}`)
    }
    for (const note of phrase.notes) {
      if (!note.lyric || !Number.isFinite(Number(note.midi)) || !Number.isFinite(Number(note.durationSeconds))) {
        throw new Error(`Invalid note in quality phrase ${phrase.id}.`)
      }
    }
  }
}

function phonemesForLyric(lyric) {
  return Array.from(String(lyric).trim()).flatMap((char) => phonemesForCharacter(char))
}

function phonemesForCharacter(char) {
  const code = char.codePointAt(0) ?? 0
  if (code < HANGUL_BASE || code > HANGUL_END) {
    return [{ symbol: char, role: 'literal', source: char, startRatio: 0, endRatio: 1 }]
  }

  const offset = code - HANGUL_BASE
  const onsetIndex = Math.floor(offset / (VOWEL_COUNT * CODA_COUNT))
  const vowelIndex = Math.floor((offset % (VOWEL_COUNT * CODA_COUNT)) / CODA_COUNT)
  const codaIndex = offset % CODA_COUNT
  const result = []
  const onset = ONSET_SYMBOLS[onsetIndex] ?? ''
  const vowel = VOWEL_SYMBOLS[vowelIndex] ?? ''
  const coda = CODA_SYMBOLS[codaIndex] ?? ''
  if (onset) {
    result.push({ symbol: onset, role: 'onset', source: char, startRatio: 0, endRatio: 0 })
  }
  result.push({ symbol: vowel, role: 'vowel', source: char, startRatio: 0, endRatio: 0 })
  if (coda) {
    result.push({ symbol: coda, role: 'coda', source: char, startRatio: 0, endRatio: 0 })
  }
  return distributeRatios(result)
}

function distributeRatios(phonemes) {
  const weights = phonemes.map(phonemeRatioWeight)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  return phonemes.map((phoneme, index) => {
    const startRatio = cursor / total
    cursor += weights[index]
    return { ...phoneme, startRatio, endRatio: cursor / total }
  })
}

function phonemeRatioWeight(phoneme) {
  if (phoneme.role === 'vowel') {
    return 7
  }
  if (phoneme.role === 'coda') {
    return 0.45
  }
  return 0.9
}

function decodePcm16Wav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Unsupported WAV container.')
  }
  let offset = 12
  let fmt = null
  let dataOffset = -1
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    }
    if (chunkId === 'data') {
      dataOffset = chunkStart
      dataBytes = chunkSize
      break
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  if (!fmt || dataOffset < 0 || fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error('Only 16-bit PCM WAV files are supported for quality diagnostics.')
  }
  const frameCount = Math.floor(dataBytes / (fmt.channels * 2))
  const samples = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0
    for (let channel = 0; channel < fmt.channels; channel += 1) {
      sum += buffer.readInt16LE(dataOffset + (frame * fmt.channels + channel) * 2) / 0x8000
    }
    samples[frame] = sum / fmt.channels
  }
  return {
    samples,
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    durationSeconds: frameCount / fmt.sampleRate,
  }
}

function estimateFrameF0(samples, start, frameSize, sampleRate, minHz, maxHz, rmsThreshold, targetHz = 0) {
  const frameRms = rmsOf(samples, start, start + frameSize)
  if (frameRms < rmsThreshold) {
    return null
  }
  const minLag = Math.max(1, Math.floor(sampleRate / maxHz))
  const maxLag = Math.min(frameSize - 2, Math.ceil(sampleRate / minHz))
  const candidates = []
  let bestScore = 0
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0
    let energyA = 0
    let energyB = 0
    for (let index = 0; index + lag < frameSize; index += 1) {
      const a = samples[start + index]
      const b = samples[start + index + lag]
      corr += a * b
      energyA += a * a
      energyB += b * b
    }
    const score = energyA > 0 && energyB > 0 ? corr / Math.sqrt(energyA * energyB) : 0
    if (score > bestScore) {
      bestScore = score
    }
    candidates.push({ lag, hz: sampleRate / lag, confidence: score })
  }
  if (bestScore < 0.45) {
    return null
  }
  const viable = candidates.filter((candidate) => candidate.confidence >= bestScore * 0.88)
  const selected = targetHz > 0
    ? viable.sort((a, b) => Math.abs(1200 * Math.log2(a.hz / targetHz)) - Math.abs(1200 * Math.log2(b.hz / targetHz)))[0]
    : viable.sort((a, b) => b.confidence - a.confidence)[0]
  return { hz: selected.hz, confidence: selected.confidence }
}

function targetHzAt(request, timeSeconds) {
  const note = request.notes.find((item) => timeSeconds >= item.startSeconds && timeSeconds < item.startSeconds + item.durationSeconds)
  if (!note || !note.targetHz) {
    return 0
  }
  return note.targetHz * 2 ** (interpolateCents(note.pitchCurve ?? [], (timeSeconds - note.startSeconds) / note.durationSeconds) / 1200)
}

function interpolateCents(points, timeRatio) {
  if (!points.length) {
    return 0
  }
  const sorted = [...points].sort((a, b) => a.timeRatio - b.timeRatio)
  if (timeRatio <= sorted[0].timeRatio) {
    return sorted[0].cents
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const next = sorted[index]
    if (timeRatio <= next.timeRatio) {
      const local = (timeRatio - previous.timeRatio) / Math.max(0.0001, next.timeRatio - previous.timeRatio)
      return previous.cents + (next.cents - previous.cents) * local
    }
  }
  return sorted.at(-1).cents
}

function evaluateGates({ audio, f0, onset, coda, duration }, thresholds) {
  const gates = [
    {
      id: 'duration',
      passed: duration.absDeltaSeconds <= Number(thresholds.durationToleranceSeconds ?? 0.35),
      actual: duration.absDeltaSeconds,
      threshold: Number(thresholds.durationToleranceSeconds ?? 0.35),
    },
    {
      id: 'clipping',
      passed: audio.clippingSamples <= Number(thresholds.maxClippingSamples ?? 0),
      actual: audio.clippingSamples,
      threshold: Number(thresholds.maxClippingSamples ?? 0),
    },
    {
      id: 'rms-min',
      passed: audio.rms >= Number(thresholds.minRms ?? 0.005),
      actual: audio.rms,
      threshold: Number(thresholds.minRms ?? 0.005),
    },
    {
      id: 'rms-max',
      passed: audio.rms <= Number(thresholds.maxRms ?? 0.25),
      actual: audio.rms,
      threshold: Number(thresholds.maxRms ?? 0.25),
    },
    {
      id: 'voiced-frame-ratio',
      passed: f0.voicedFrameRatio >= Number(thresholds.minVoicedFrameRatio ?? 0.35),
      actual: f0.voicedFrameRatio,
      threshold: Number(thresholds.minVoicedFrameRatio ?? 0.35),
    },
    {
      id: 'median-abs-cents',
      passed: f0.medianAbsCents <= Number(thresholds.maxMedianAbsCents ?? 180),
      actual: f0.medianAbsCents,
      threshold: Number(thresholds.maxMedianAbsCents ?? 180),
    },
    {
      id: 'median-onset-lag',
      passed: onset.medianOnsetLagSeconds <= Number(thresholds.maxMedianOnsetLagSeconds ?? 0.12),
      actual: onset.medianOnsetLagSeconds,
      threshold: Number(thresholds.maxMedianOnsetLagSeconds ?? 0.12),
    },
    {
      id: 'missing-onset-ratio',
      passed: onset.missingOnsetRatio <= Number(thresholds.maxMissingOnsetRatio ?? 0.2),
      actual: onset.missingOnsetRatio,
      threshold: Number(thresholds.maxMissingOnsetRatio ?? 0.2),
    },
    {
      id: 'coda-sustain-bursts',
      passed: coda.maxSustainBurstCount <= Number(thresholds.maxCodaSustainBurstCount ?? 1),
      actual: coda.maxSustainBurstCount,
      threshold: Number(thresholds.maxCodaSustainBurstCount ?? 1),
    },
  ]
  return {
    passed: gates.every((gate) => gate.passed),
    failed: gates.filter((gate) => !gate.passed).map((gate) => gate.id),
    gates,
  }
}

function summarizeDiagnostics({ audio, f0, onset, coda, duration, gates }) {
  return {
    passed: gates.passed,
    rms: audio.rms,
    peak: audio.peak,
    clippingSamples: audio.clippingSamples,
    durationDeltaSeconds: duration.deltaSeconds,
    voicedFrameRatio: f0.voicedFrameRatio,
    medianAbsCents: f0.medianAbsCents,
    medianOnsetLagSeconds: onset.medianOnsetLagSeconds,
    missingOnsetRatio: onset.missingOnsetRatio,
    maxCodaSustainBurstCount: coda.maxSustainBurstCount,
    totalCodaSustainBurstCount: coda.totalSustainBurstCount,
    failedGates: gates.failed,
  }
}

function summarizeResults(results) {
  const rendered = results.filter((result) => !result.skippedRender)
  const ok = rendered.filter((result) => result.ok)
  const passed = ok.filter((result) => result.gates?.passed)
  return {
    phraseCount: results.length,
    renderedCount: rendered.length,
    okCount: ok.length,
    failedRenderCount: rendered.length - ok.length,
    passedGateCount: passed.length,
    failedGateCount: ok.length - passed.length,
  }
}

function listeningLogFor(summary) {
  const rows = summary.results
    .map((result) => `| ${result.id} | ${result.wavPath ?? ''} |  |  |  |  | ${result.summary ? `failed gates: ${result.summary.failedGates.join(', ') || 'none'}` : ''} |`)
    .join('\n')
  return [
    '# WebUtau Neural Singer Listening Log',
    '',
    `Run id: ${summary.runId}`,
    `Generated at: ${summary.generatedAt}`,
    `Model/checkpoint: ${summary.modelId}`,
    `Renderer: ${summary.renderer}`,
    '',
    '## Objective Summary',
    '',
    '```json',
    JSON.stringify(summary.totals, null, 2),
    '```',
    '',
    '## Phrase Notes',
    '',
    '| Phrase | WAV | Korean clarity | Pitch stability | Timing | Noise/artifacts | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    rows,
    '',
    '## Gate Decision',
    '',
    '- Pass/fail:',
    '- Reason:',
    '- Next action:',
    '',
  ].join('\n')
}

function listeningScoresTemplateFor(summary) {
  return {
    version: 1,
    runId: summary.runId,
    modelId: summary.modelId,
    reviewer: '',
    reviewedAt: '',
    decision: '',
    thresholds: {
      minListeningKoreanClarityScore: summary.thresholds?.minListeningKoreanClarityScore ?? null,
      minListeningVowelStabilityScore: summary.thresholds?.minListeningVowelStabilityScore ?? null,
      minListeningArtifactScore: summary.thresholds?.minListeningArtifactScore ?? null,
      scoreScale: summary.thresholds?.scoreScale ?? '1=unusable, 3=prototype, 5=public-beta-ready',
    },
    phraseScores: summary.results.map((result) => ({
      id: result.id,
      title: result.title,
      wavPath: result.wavPath ?? '',
      koreanClarityScore: null,
      vowelStabilityScore: null,
      artifactScore: null,
      notes: '',
    })),
  }
}

function parsePhraseFilter(value) {
  if (!value) {
    return null
  }
  if (value instanceof Set) {
    return value
  }
  if (Array.isArray(value)) {
    return new Set(value)
  }
  return new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))
}

function normalizePitchCurve(points) {
  return points
    .map((point) => ({
      timeRatio: clamp(Number(point.timeRatio), 0, 1),
      cents: Number.isFinite(Number(point.cents)) ? Number(point.cents) : 0,
    }))
    .sort((a, b) => a.timeRatio - b.timeRatio)
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function rmsOf(samples, start, end) {
  const clippedStart = Math.max(0, start)
  const clippedEnd = Math.min(samples.length, end)
  if (clippedEnd <= clippedStart) {
    return 0
  }
  let sumSquares = 0
  for (let index = clippedStart; index < clippedEnd; index += 1) {
    sumSquares += samples[index] * samples[index]
  }
  return Math.sqrt(sumSquares / (clippedEnd - clippedStart))
}

function peakOf(samples, start, end) {
  let peak = 0
  for (let index = Math.max(0, start); index < Math.min(samples.length, end); index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]))
  }
  return peak
}

function transientRatioOf(samples, start, end) {
  const clippedStart = Math.max(1, start)
  const clippedEnd = Math.min(samples.length, end)
  if (clippedEnd <= clippedStart) {
    return 0
  }
  let sumSquares = 0
  for (let index = clippedStart; index < clippedEnd; index += 1) {
    const delta = samples[index] - samples[index - 1]
    sumSquares += delta * delta
  }
  const diffRms = Math.sqrt(sumSquares / (clippedEnd - clippedStart))
  const frameRms = rmsOf(samples, start, end)
  return frameRms > 0 ? diffRms / frameRms : 0
}

function percentile(values, p) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (finite.length === 0) {
    return 0
  }
  const index = Math.min(finite.length - 1, Math.max(0, Math.round((finite.length - 1) * p)))
  return finite[index]
}

function medianAbsoluteDeviation(values, median) {
  return percentile(values.map((value) => Math.abs(value - median)), 0.5)
}

function mean(values) {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) {
    return 0
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function dbfs(value) {
  if (value <= 0) {
    return -Infinity
  }
  return roundMetric(20 * Math.log10(value))
}

function roundMetric(value) {
  if (!Number.isFinite(value)) {
    return value
  }
  return Number(value.toFixed(6))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clampInt(value, min, max) {
  if (max < min) {
    return min
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

function countSeparatedEvents(times, minSeparationSeconds) {
  let count = 0
  let last = -Infinity
  for (const time of times) {
    if (time - last >= minSeparationSeconds) {
      count += 1
      last = time
    }
  }
  return count
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--phrase-set') {
      parsed.phraseSet = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--run-id') {
      parsed.runId = argv[++index]
    } else if (arg === '--phrases') {
      parsed.phrases = argv[++index]
    } else if (arg === '--model-id') {
      parsed.modelId = argv[++index]
    } else if (arg === '--no-render') {
      parsed.render = false
    } else if (arg === '--accept-local-research-license') {
      parsed.acceptLocalResearchLicense = true
    } else if (arg === '--work-dir') {
      parsed.workDir = argv[++index]
    } else if (arg === '--diffsinger-root') {
      parsed.diffSingerRoot = argv[++index]
    } else if (arg === '--python') {
      parsed.python = argv[++index]
    } else if (arg === '--exp') {
      parsed.exp = argv[++index]
    } else if (arg === '--ckpt') {
      parsed.ckpt = Number(argv[++index])
    } else if (arg === '--steps') {
      parsed.steps = Number(argv[++index])
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/evaluate-neural-quality.mjs [options]',
          '',
          'Options:',
          `  --phrase-set path                  Quality phrase JSON, default ${DEFAULT_PHRASE_SET}`,
          `  --out path                         Output run directory, default ${DEFAULT_OUT_ROOT}/<timestamp>`,
          '  --phrases id,id                    Render only selected phrase ids',
          '  --model-id id                      Model/checkpoint id recorded in quality summary',
          '  --no-render                        Write request fixtures without running DiffSinger',
          '  --accept-local-research-license    Required before rendering local research models/vocoders',
          '  --diffsinger-root path             Local DiffSinger checkout',
          '  --python path                      Python executable for DiffSinger env',
          '  --exp path                         DiffSinger experiment checkpoint directory',
          '  --ckpt steps                       Checkpoint step, default from render service',
          '  --steps count                      DiffSinger denoise steps',
          '  --timeout-ms ms                    Per-phrase render timeout',
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return parsed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const summary = await evaluateNeuralQuality(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
