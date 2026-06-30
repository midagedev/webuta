#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeAudio,
  analyzeDurationAlignment,
  analyzeF0Tracking,
  analyzeOnsetTiming,
} from './evaluate-neural-quality.mjs'
import { summarizeLyricCoverage } from './audit-private-singer-prompt-coverage.mjs'

const DEFAULT_PACK_DIR = 'experiments/neural-singer/datasets/original-private-singer'
const DEFAULT_DURATION_TOLERANCE_SECONDS = 0.75
const DEFAULT_MAX_CLIPPING_SAMPLES = 0
const DEFAULT_MIN_RMS = 0.006
const DEFAULT_MAX_RMS = 0.35
const DEFAULT_MAX_SILENCE_RATIO = 0.6
const DEFAULT_MIN_VOICED_FRAME_RATIO = 0.28
const DEFAULT_MAX_MEDIAN_ABS_CENTS = 260
const DEFAULT_MAX_MISSING_F0_RATIO = 0.55
const DEFAULT_MAX_MEDIAN_ONSET_LAG_SECONDS = 0.2
const DEFAULT_MAX_MISSING_ONSET_RATIO = 0.35
const DEFAULT_MAX_GUIDE_TICK_CORRELATION = 0.22
const GUIDE_TICK_HZ = 1800
const GUIDE_TICK_SECONDS = 0.018

export function auditPrivateSingerRecordingTakes(options = {}) {
  const packDir = resolve(options.packDir ?? DEFAULT_PACK_DIR)
  const sessionPath = resolve(options.session ?? join(packDir, 'recording-session.json'))
  if (!existsSync(sessionPath)) {
    throw new Error(`Missing recording session: ${sessionPath}`)
  }
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
  const thresholds = {
    durationToleranceSeconds: positiveNumber(options.durationToleranceSeconds, DEFAULT_DURATION_TOLERANCE_SECONDS),
    maxClippingSamples: integerNumber(options.maxClippingSamples, DEFAULT_MAX_CLIPPING_SAMPLES),
    minRms: positiveNumber(options.minRms, DEFAULT_MIN_RMS),
    maxRms: positiveNumber(options.maxRms, DEFAULT_MAX_RMS),
    maxSilenceRatio: ratioNumber(options.maxSilenceRatio, DEFAULT_MAX_SILENCE_RATIO),
    minVoicedFrameRatio: ratioNumber(options.minVoicedFrameRatio, DEFAULT_MIN_VOICED_FRAME_RATIO),
    maxMedianAbsCents: positiveNumber(options.maxMedianAbsCents, DEFAULT_MAX_MEDIAN_ABS_CENTS),
    maxMissingF0Ratio: ratioNumber(options.maxMissingF0Ratio, DEFAULT_MAX_MISSING_F0_RATIO),
    maxMedianOnsetLagSeconds: positiveNumber(options.maxMedianOnsetLagSeconds, DEFAULT_MAX_MEDIAN_ONSET_LAG_SECONDS),
    maxMissingOnsetRatio: ratioNumber(options.maxMissingOnsetRatio, DEFAULT_MAX_MISSING_ONSET_RATIO),
    maxGuideTickCorrelation: ratioNumber(options.maxGuideTickCorrelation, DEFAULT_MAX_GUIDE_TICK_CORRELATION),
  }

  const takeFilter = parseTakeFilter(options.takes)
  const takes = Array.isArray(session.takes) ? session.takes.filter((take) => !takeFilter || takeFilter.has(take.id)) : []
  if (takes.length === 0) {
    throw new Error('No recording takes selected for audit.')
  }

  const results = takes.map((take) => auditTake({ packDir, take, thresholds }))
  const coverage = summarizeRecordingCoverage({ takes, results })
  const reviewQueue = buildReviewQueue(results, coverage.ready.lyricCoverage)
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    packDir,
    sessionPath,
    sessionId: session.sessionId ?? '(unknown)',
    singerId: session.singerId ?? '(unknown)',
    thresholds,
    totals: summarizeResults(results),
    coverage,
    ok: results.every((result) => result.ok),
    reviewQueue,
    results,
  }

  if (options.report) {
    const reportPath = resolve(options.report)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (options.reviewCsv) {
    const reviewCsvPath = resolve(options.reviewCsv)
    mkdirSync(dirname(reviewCsvPath), { recursive: true })
    writeFileSync(reviewCsvPath, reviewQueueCsv(reviewQueue))
  }
  return report
}

function auditTake({ packDir, take, thresholds }) {
  const wavPath = resolve(packDir, take.wavPath)
  const requestPath = resolve(packDir, take.neuralRequestPath)
  const scorePath = take.scorePath ? resolve(packDir, take.scorePath) : null
  const base = {
    id: take.id,
    takeNumber: take.takeNumber,
    promptId: take.promptId,
    setId: take.setId,
    key: take.key,
    tempo: take.tempo,
    estimatedSeconds: Number(take.estimatedSeconds ?? 0),
    lyric: take.lyric,
    tags: take.tags ?? [],
    wavPath,
    scorePath,
    requestPath,
  }
  if (!existsSync(requestPath)) {
    return {
      ...base,
      ok: false,
      status: 'missing-request',
      gates: failedPresenceGates('request-present'),
      nextActions: ['Regenerate the private singer pack so every take has a neural request fixture.'],
    }
  }
  if (!existsSync(wavPath)) {
    return {
      ...base,
      ok: false,
      status: 'missing-wav',
      gates: failedPresenceGates('wav-present'),
      nextActions: ['Record or copy the WAV using the exact wavPath from cue-sheet.csv.'],
    }
  }

  const request = JSON.parse(readFileSync(requestPath, 'utf8'))
  const wav = decodePcm16Wav(readFileSync(wavPath))
  const audio = analyzeAudio(wav.samples, wav.sampleRate)
  const f0 = analyzeF0Tracking(wav.samples, wav.sampleRate, request)
  const onset = analyzeOnsetTiming(wav.samples, wav.sampleRate, request)
  const duration = analyzeDurationAlignment(wav.durationSeconds, request)
  const guideLeakage = analyzeGuideTickLeakage(wav.samples, wav.sampleRate, request)
  const gates = evaluateTakeGates({ audio, f0, onset, duration, guideLeakage }, thresholds)
  return {
    ...base,
    ok: gates.passed,
    status: gates.passed ? 'ready' : 'needs-review',
    wav: {
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitsPerSample: wav.bitsPerSample,
      durationSeconds: roundMetric(wav.durationSeconds),
    },
    request: {
      noteCount: request.notes?.length ?? 0,
      expectedSeconds: duration.expectedSeconds,
      bpm: request.project?.bpm,
    },
    audio,
    f0,
    onset,
    duration,
    guideLeakage,
    gates,
    nextActions: nextActionsForTakeGates(gates.failed),
  }
}

function evaluateTakeGates({ audio, f0, onset, duration, guideLeakage }, thresholds) {
  const gates = [
    {
      id: 'duration',
      passed: duration.absDeltaSeconds <= thresholds.durationToleranceSeconds,
      actual: duration.absDeltaSeconds,
      threshold: thresholds.durationToleranceSeconds,
    },
    {
      id: 'clipping',
      passed: audio.clippingSamples <= thresholds.maxClippingSamples,
      actual: audio.clippingSamples,
      threshold: thresholds.maxClippingSamples,
    },
    {
      id: 'rms-min',
      passed: audio.rms >= thresholds.minRms,
      actual: audio.rms,
      threshold: thresholds.minRms,
    },
    {
      id: 'rms-max',
      passed: audio.rms <= thresholds.maxRms,
      actual: audio.rms,
      threshold: thresholds.maxRms,
    },
    {
      id: 'silence',
      passed: audio.silenceRatio <= thresholds.maxSilenceRatio,
      actual: audio.silenceRatio,
      threshold: thresholds.maxSilenceRatio,
    },
    {
      id: 'voiced-frame-ratio',
      passed: f0.voicedFrameRatio >= thresholds.minVoicedFrameRatio,
      actual: f0.voicedFrameRatio,
      threshold: thresholds.minVoicedFrameRatio,
    },
    {
      id: 'missing-f0-ratio',
      passed: f0.missingF0Ratio <= thresholds.maxMissingF0Ratio,
      actual: f0.missingF0Ratio,
      threshold: thresholds.maxMissingF0Ratio,
    },
    {
      id: 'median-abs-cents',
      passed: f0.medianAbsCents <= thresholds.maxMedianAbsCents,
      actual: f0.medianAbsCents,
      threshold: thresholds.maxMedianAbsCents,
    },
    {
      id: 'median-onset-lag',
      passed: onset.medianOnsetLagSeconds <= thresholds.maxMedianOnsetLagSeconds,
      actual: onset.medianOnsetLagSeconds,
      threshold: thresholds.maxMedianOnsetLagSeconds,
    },
    {
      id: 'missing-onset-ratio',
      passed: onset.missingOnsetRatio <= thresholds.maxMissingOnsetRatio,
      actual: onset.missingOnsetRatio,
      threshold: thresholds.maxMissingOnsetRatio,
    },
    {
      id: 'guide-tick-leakage',
      passed: guideLeakage.maxTickCorrelation <= thresholds.maxGuideTickCorrelation,
      actual: guideLeakage.maxTickCorrelation,
      threshold: thresholds.maxGuideTickCorrelation,
    },
  ]
  return {
    passed: gates.every((gate) => gate.passed),
    failed: gates.filter((gate) => !gate.passed).map((gate) => gate.id),
    gates,
  }
}

function failedPresenceGates(id) {
  return {
    passed: false,
    failed: [id],
    gates: [
      {
        id,
        passed: false,
        actual: false,
        threshold: true,
      },
    ],
  }
}

function nextActionsForTakeGates(failed) {
  const actions = []
  if (failed.includes('duration')) {
    actions.push('Re-record the take closer to the score guide duration.')
  }
  if (failed.includes('clipping') || failed.includes('rms-max')) {
    actions.push('Lower recording gain and re-record the take without clipping.')
  }
  if (failed.includes('rms-min')) {
    actions.push('Raise recording gain or move closer to the mic while keeping tone clean.')
  }
  if (failed.includes('silence')) {
    actions.push('Trim long silence or re-record with a tighter start/end.')
  }
  if (failed.includes('voiced-frame-ratio') || failed.includes('missing-f0-ratio')) {
    actions.push('Check that the take is sung, not spoken or whispered, and follows the pitch guide.')
  }
  if (failed.includes('median-abs-cents')) {
    actions.push('Use the score guide and re-record with closer pitch tracking.')
  }
  if (failed.includes('median-onset-lag') || failed.includes('missing-onset-ratio')) {
    actions.push('Re-record with clearer consonant attacks aligned to the guide.')
  }
  if (failed.includes('guide-tick-leakage')) {
    actions.push('Reduce headphone bleed or lower guide volume, then re-record a dry vocal take.')
  }
  if (actions.length === 0) {
    actions.push('Keep this take for ingest/readiness and later MFA alignment.')
  }
  return actions
}

function summarizeResults(results) {
  const ready = results.filter((result) => result.ok)
  const missing = results.filter((result) => result.status === 'missing-wav' || result.status === 'missing-request')
  return {
    takeCount: results.length,
    readyCount: ready.length,
    needsReviewCount: results.length - ready.length,
    missingArtifactCount: missing.length,
    failedGateCounts: countFailedGates(results),
  }
}

function summarizeRecordingCoverage({ takes, results }) {
  const readyIds = new Set(results.filter((result) => result.ok).map((result) => result.id))
  const needsReviewIds = new Set(results.filter((result) => !result.ok).map((result) => result.id))
  const readyTakes = takes.filter((take) => readyIds.has(take.id))
  const needsReviewTakes = takes.filter((take) => needsReviewIds.has(take.id))
  return {
    planned: coverageBucket(takes, takes.length),
    ready: coverageBucket(readyTakes, takes.length),
    needsReview: coverageBucket(needsReviewTakes, takes.length),
  }
}

function coverageBucket(takes, plannedTakeCount) {
  const estimatedSeconds = sum(takes.map((take) => Number(take.estimatedSeconds ?? 0)))
  return {
    takeCount: takes.length,
    takeRatio: plannedTakeCount > 0 ? roundMetric(takes.length / plannedTakeCount) : 0,
    estimatedSeconds: roundMetric(estimatedSeconds),
    estimatedMinutes: roundMetric(estimatedSeconds / 60),
    lyricCoverage: summarizeLyricCoverage(takes),
  }
}

function buildReviewQueue(results, readyLyricCoverage) {
  return results
    .filter((result) => !result.ok)
    .map((result) => {
      const coverageGaps = coverageGapsForResult(result, readyLyricCoverage)
      const coverageCritical = Object.values(coverageGaps).some((items) => items.length > 0)
      return {
        priority: reviewPriority(result.gates?.failed ?? []),
        coverageCritical,
        coverageGaps,
        id: result.id,
        takeNumber: result.takeNumber,
        status: result.status,
        lyric: result.lyric,
        key: result.key,
        tempo: result.tempo,
        failedGates: result.gates?.failed ?? [],
        nextActions: result.nextActions ?? [],
        wavPath: result.wavPath,
        scorePath: result.scorePath,
        requestPath: result.requestPath,
      }
    })
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        Number(right.coverageCritical) - Number(left.coverageCritical) ||
        Number(left.takeNumber ?? 0) - Number(right.takeNumber ?? 0),
    )
}

function coverageGapsForResult(result, readyLyricCoverage) {
  const resultCoverage = summarizeLyricCoverage([result])
  return {
    onset: intersectMissingSymbols(readyLyricCoverage.onset.missing, resultCoverage.onset.counts),
    vowel: intersectMissingSymbols(readyLyricCoverage.vowel.missing, resultCoverage.vowel.counts),
    coda: intersectMissingSymbols(readyLyricCoverage.coda.missing, resultCoverage.coda.counts),
  }
}

function intersectMissingSymbols(missing, counts) {
  const present = new Set(Object.keys(counts))
  return missing.filter((symbol) => present.has(symbol))
}

function reviewPriority(failed) {
  if (failed.includes('request-present')) {
    return 1
  }
  if (failed.includes('wav-present')) {
    return 2
  }
  if (
    failed.includes('clipping') ||
    failed.includes('rms-min') ||
    failed.includes('rms-max') ||
    failed.includes('silence') ||
    failed.includes('guide-tick-leakage')
  ) {
    return 3
  }
  if (failed.includes('duration') || failed.includes('median-onset-lag') || failed.includes('missing-onset-ratio')) {
    return 4
  }
  return 5
}

function reviewQueueCsv(queue) {
  const rows = [
    [
      'priority',
      'takeNumber',
      'takeId',
      'status',
      'key',
      'tempo',
      'lyric',
      'failedGates',
      'coverageCritical',
      'coverageGaps',
      'nextActions',
      'wavPath',
      'scorePath',
      'requestPath',
    ],
    ...queue.map((item) => [
      item.priority,
      item.takeNumber ?? '',
      item.id,
      item.status,
      item.key ?? '',
      item.tempo ?? '',
      item.lyric,
      item.failedGates.join('|'),
      item.coverageCritical ? 'yes' : 'no',
      formatCoverageGaps(item.coverageGaps),
      item.nextActions.join(' | '),
      item.wavPath,
      item.scorePath ?? '',
      item.requestPath,
    ]),
  ]
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function formatCoverageGaps(gaps) {
  return Object.entries(gaps)
    .filter(([, values]) => values.length > 0)
    .map(([kind, values]) => `${kind}:${values.join('|')}`)
    .join(' ')
}

function countFailedGates(results) {
  const counts = {}
  for (const result of results) {
    for (const id of result.gates?.failed ?? []) {
      counts[id] = (counts[id] ?? 0) + 1
    }
  }
  return counts
}

export function analyzeGuideTickLeakage(samples, sampleRate, request) {
  const notes = (request.notes ?? []).filter((note) => note.kind === 'note' && Number.isFinite(Number(note.startSeconds)))
  const correlations = []
  const windowLength = Math.max(1, Math.round(GUIDE_TICK_SECONDS * sampleRate))
  for (const note of notes) {
    const start = Math.max(0, Math.round(Number(note.startSeconds) * sampleRate))
    if (start + windowLength > samples.length) {
      continue
    }
    correlations.push(tickCorrelation(samples, sampleRate, start, windowLength))
  }
  return {
    tickHz: GUIDE_TICK_HZ,
    tickWindowSeconds: GUIDE_TICK_SECONDS,
    noteCount: notes.length,
    measuredTickCount: correlations.length,
    maxTickCorrelation: roundMetric(correlations.length > 0 ? Math.max(...correlations) : 0),
    medianTickCorrelation: roundMetric(median(correlations)),
  }
}

function tickCorrelation(samples, sampleRate, start, length) {
  let dot = 0
  let sampleEnergy = 0
  let referenceEnergy = 0
  let mean = 0
  for (let index = 0; index < length; index += 1) {
    mean += samples[start + index]
  }
  mean /= Math.max(1, length)
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate
    const envelope = 1 - index / Math.max(1, length)
    const reference = Math.sin(Math.PI * 2 * GUIDE_TICK_HZ * t) * envelope
    const sample = samples[start + index] - mean
    dot += sample * reference
    sampleEnergy += sample * sample
    referenceEnergy += reference * reference
  }
  if (sampleEnergy <= 0 || referenceEnergy <= 0) {
    return 0
  }
  return Math.abs(dot / Math.sqrt(sampleEnergy * referenceEnergy))
}

function median(values) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
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
    throw new Error('Only 16-bit PCM WAV files are supported for recording take diagnostics.')
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

function parseTakeFilter(value) {
  if (!value) {
    return null
  }
  return new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))
}

function csvCell(value) {
  const text = String(value ?? '')
  if (!/[",\n]/u.test(text)) {
    return text
  }
  return `"${text.replaceAll('"', '""')}"`
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pack-dir') {
      parsed.packDir = argv[++index]
    } else if (arg === '--session') {
      parsed.session = argv[++index]
    } else if (arg === '--takes') {
      parsed.takes = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--review-csv') {
      parsed.reviewCsv = argv[++index]
    } else if (arg === '--duration-tolerance-seconds') {
      parsed.durationToleranceSeconds = Number(argv[++index])
    } else if (arg === '--max-clipping-samples') {
      parsed.maxClippingSamples = Number(argv[++index])
    } else if (arg === '--min-rms') {
      parsed.minRms = Number(argv[++index])
    } else if (arg === '--max-rms') {
      parsed.maxRms = Number(argv[++index])
    } else if (arg === '--max-silence-ratio') {
      parsed.maxSilenceRatio = Number(argv[++index])
    } else if (arg === '--min-voiced-frame-ratio') {
      parsed.minVoicedFrameRatio = Number(argv[++index])
    } else if (arg === '--max-median-abs-cents') {
      parsed.maxMedianAbsCents = Number(argv[++index])
    } else if (arg === '--max-missing-f0-ratio') {
      parsed.maxMissingF0Ratio = Number(argv[++index])
    } else if (arg === '--max-median-onset-lag-seconds') {
      parsed.maxMedianOnsetLagSeconds = Number(argv[++index])
    } else if (arg === '--max-missing-onset-ratio') {
      parsed.maxMissingOnsetRatio = Number(argv[++index])
    } else if (arg === '--max-guide-tick-correlation') {
      parsed.maxGuideTickCorrelation = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-private-singer-recording-takes.mjs [options]',
          '',
          'Options:',
          `  --pack-dir path                         Recording pack dir, default ${DEFAULT_PACK_DIR}`,
          '  --session path                          recording-session.json path',
          '  --takes id,id                           Audit only selected take ids',
          '  --report path                           Write JSON report to path',
          '  --review-csv path                       Write failed-take review queue CSV',
          `  --duration-tolerance-seconds n           Default ${DEFAULT_DURATION_TOLERANCE_SECONDS}`,
          `  --max-clipping-samples n                 Default ${DEFAULT_MAX_CLIPPING_SAMPLES}`,
          `  --min-rms n                              Default ${DEFAULT_MIN_RMS}`,
          `  --max-rms n                              Default ${DEFAULT_MAX_RMS}`,
          `  --max-silence-ratio n                    Default ${DEFAULT_MAX_SILENCE_RATIO}`,
          `  --min-voiced-frame-ratio n               Default ${DEFAULT_MIN_VOICED_FRAME_RATIO}`,
          `  --max-median-abs-cents n                 Default ${DEFAULT_MAX_MEDIAN_ABS_CENTS}`,
          `  --max-missing-f0-ratio n                 Default ${DEFAULT_MAX_MISSING_F0_RATIO}`,
          `  --max-median-onset-lag-seconds n         Default ${DEFAULT_MAX_MEDIAN_ONSET_LAG_SECONDS}`,
          `  --max-missing-onset-ratio n              Default ${DEFAULT_MAX_MISSING_ONSET_RATIO}`,
          `  --max-guide-tick-correlation n           Default ${DEFAULT_MAX_GUIDE_TICK_CORRELATION}`,
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

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function integerNumber(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function ratioNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

function roundMetric(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = auditPrivateSingerRecordingTakes(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
