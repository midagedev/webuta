#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const VOWEL_COUNT = 21
const CODA_COUNT = 28
const DEFAULT_TARGET_SAMPLE_RATE = 44100
const DEFAULT_SEGMENT_SECONDS = 8
const DEFAULT_MIN_SEGMENT_SECONDS = 0.35
const DEFAULT_SILENCE_THRESHOLD = 0.012
const AUDIO_EXTENSIONS = new Set(['.wav'])
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

export function ingestNeuralDataset(options) {
  const registryPath = resolve(options.registry ?? 'experiments/neural-singer/dataset-registry.example.json')
  const datasetId = options.dataset
  if (!datasetId) {
    throw new Error('Missing required --dataset id.')
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  const dataset = registry.datasets?.find((entry) => entry.id === datasetId)
  if (!dataset) {
    throw new Error(`Dataset not found in registry: ${datasetId}`)
  }
  if (!options.allowUnreviewed && dataset.allowedActions?.localTraining !== true) {
    throw new Error(`Dataset ${datasetId} is not marked allowedActions.localTraining=true.`)
  }

  const datasetRoot = resolve(dataset.localPath)
  if (!existsSync(datasetRoot)) {
    throw new Error(`Dataset localPath does not exist: ${datasetRoot}`)
  }

  const outputDir = resolve(options.out ?? `experiments/neural-singer/work/${datasetId}-ingest`)
  const targetSampleRate = positiveNumber(options.targetRate, DEFAULT_TARGET_SAMPLE_RATE)
  const segmentSeconds = positiveNumber(options.segmentSeconds, DEFAULT_SEGMENT_SECONDS)
  const minSegmentSeconds = positiveNumber(options.minSegmentSeconds, DEFAULT_MIN_SEGMENT_SECONDS)
  const silenceThreshold = positiveNumber(options.silenceThreshold, DEFAULT_SILENCE_THRESHOLD)
  const limitFiles = nonNegativeInteger(options.limitFiles, 0)
  const audioInventory = findTrainingAudioFiles(datasetRoot)
  const recordingAuditFilter = options.recordingAudit ? readRecordingAuditFilter(options.recordingAudit) : null
  const filteredInventory = recordingAuditFilter ? filterAudioByRecordingAudit(audioInventory.files, recordingAuditFilter) : null
  const candidateAudioFiles = filteredInventory?.files ?? audioInventory.files
  const audioFiles = limitFiles > 0 ? candidateAudioFiles.slice(0, limitFiles) : candidateAudioFiles
  const segments = []
  const lyricCoverages = []
  const skipped = []

  if (recordingAuditFilter && audioFiles.length === 0) {
    throw new Error(`Recording audit selected no ready WAV files: ${recordingAuditFilter.path}`)
  }

  mkdirSync(outputDir, { recursive: true })

  for (const filePath of audioFiles) {
    try {
      const decoded = decodeWav(readFileSync(filePath))
      const mono = mixToMono(decoded)
      const normalized = resampleLinear(mono, decoded.sampleRate, targetSampleRate)
      const annotationText = readSidecarText(filePath)
      const fileSegments = segmentAudio(normalized.length, targetSampleRate, segmentSeconds, minSegmentSeconds)
      const sourceRelative = relative(datasetRoot, filePath)
      const lyricCoverage = summarizeTextCoverage(annotationText)
      lyricCoverages.push(lyricCoverage)

      for (const [index, segment] of fileSegments.entries()) {
        const samples = normalized.subarray(segment.startSample, segment.endSample)
        segments.push({
          id: `${sanitizeId(sourceRelative)}-${String(index + 1).padStart(3, '0')}`,
          datasetId,
          sourceRelative,
          segmentIndex: index,
          startSeconds: segment.startSample / targetSampleRate,
          durationSeconds: samples.length / targetSampleRate,
          targetSampleRate,
          sourceSampleRate: decoded.sampleRate,
          sourceChannels: decoded.channelCount,
          annotationText,
          stats: analyzeSegment(samples, targetSampleRate, silenceThreshold),
          lyricCoverage,
        })
      }
    } catch (error) {
      skipped.push({
        path: relative(datasetRoot, filePath),
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const summary = {
    version: 1,
    datasetId,
    generatedAt: new Date().toISOString(),
    registryPath,
    datasetRoot,
    outputDir,
    targetSampleRate,
    segmentSeconds,
    minSegmentSeconds,
    silenceThreshold,
    files: {
      audioCount: audioFiles.length,
      availableAudioCount: audioInventory.files.length,
      recordingAudit: recordingAuditFilter
        ? {
            path: recordingAuditFilter.path,
            sessionId: recordingAuditFilter.sessionId,
            readyTakeCount: recordingAuditFilter.readyTakeCount,
            readyWavCount: recordingAuditFilter.readyWavPaths.size,
            eligibleAudioCount: filteredInventory.files.length,
            excludedAudioCount: filteredInventory.excluded.length,
            unmatchedReadyWavCount: filteredInventory.unmatchedReadyWavPaths.length,
            unmatchedReadyWavPaths: filteredInventory.unmatchedReadyWavPaths,
          }
        : null,
      limitFiles,
      ignoredGuideAudioCount: audioInventory.ignoredGuideAudioFiles.length,
      skippedCount: skipped.length,
      skipped,
    },
    segments: summarizeSegments(segments),
    lyricCoverage: mergeLyricCoverage(lyricCoverages),
  }

  writeFileSync(join(outputDir, 'segments.jsonl'), `${segments.map((segment) => JSON.stringify(segment)).join('\n')}\n`)
  writeFileSync(join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return { summary, segments }
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--dataset') {
      parsed.dataset = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--target-rate') {
      parsed.targetRate = Number(argv[++index])
    } else if (arg === '--segment-seconds') {
      parsed.segmentSeconds = Number(argv[++index])
    } else if (arg === '--min-segment-seconds') {
      parsed.minSegmentSeconds = Number(argv[++index])
    } else if (arg === '--silence-threshold') {
      parsed.silenceThreshold = Number(argv[++index])
    } else if (arg === '--limit-files') {
      parsed.limitFiles = Number(argv[++index])
    } else if (arg === '--recording-audit') {
      parsed.recordingAudit = argv[++index]
    } else if (arg === '--allow-unreviewed') {
      parsed.allowUnreviewed = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/ingest-neural-dataset.mjs --dataset id [options]',
          '',
          'Options:',
          '  --registry path             Dataset registry JSON',
          '  --out path                  Ignored output directory',
          '  --target-rate hz            Analysis sample rate, default 44100',
          '  --segment-seconds seconds   Segment length, default 8',
          '  --min-segment-seconds sec   Minimum final segment, default 0.35',
          '  --silence-threshold value   Absolute-amplitude silence threshold',
          '  --limit-files n             Ingest only the first n sorted audio files for a quick slice',
          '  --recording-audit path      Ingest only WAV takes that passed audit-recordings',
          '  --allow-unreviewed          Inspect before localTraining approval',
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

function readRecordingAuditFilter(path) {
  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    throw new Error(`Recording audit does not exist: ${resolved}`)
  }
  const report = JSON.parse(readFileSync(resolved, 'utf8'))
  const results = Array.isArray(report.results) ? report.results : []
  const readyResults = results.filter((result) => result?.ok === true && typeof result.wavPath === 'string')
  const readyWavPaths = new Set(readyResults.map((result) => resolve(result.wavPath)))
  return {
    path: resolved,
    sessionId: report.sessionId ?? null,
    readyTakeCount: readyResults.length,
    readyWavPaths,
  }
}

function filterAudioByRecordingAudit(files, filter) {
  const ready = []
  const excluded = []
  const seen = new Set()
  for (const file of files) {
    const resolved = resolve(file)
    if (filter.readyWavPaths.has(resolved)) {
      ready.push(file)
      seen.add(resolved)
    } else {
      excluded.push(file)
    }
  }
  return {
    files: ready,
    excluded,
    unmatchedReadyWavPaths: [...filter.readyWavPaths].filter((path) => !seen.has(path)),
  }
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback
}

function findTrainingAudioFiles(root) {
  const files = []
  const ignoredGuideAudioFiles = []
  walk(root, (path) => {
    if (AUDIO_EXTENSIONS.has(extname(path).toLowerCase())) {
      if (isGuideAudioArtifact(root, path)) {
        ignoredGuideAudioFiles.push(path)
      } else {
        files.push(path)
      }
    }
  })
  return {
    files: files.sort((a, b) => a.localeCompare(b)),
    ignoredGuideAudioFiles: ignoredGuideAudioFiles.sort((a, b) => a.localeCompare(b)),
  }
}

function walk(path, onFile) {
  const stats = statSync(path)
  if (stats.isFile()) {
    onFile(path)
    return
  }
  if (!stats.isDirectory()) {
    return
  }
  for (const entry of readdirSync(path)) {
    walk(join(path, entry), onFile)
  }
}

function decodeWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Unsupported WAV container.')
  }

  let offset = 12
  let fmt = null
  let dataOffset = null
  let dataSize = null
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channelCount: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    } else if (chunkId === 'data') {
      dataOffset = chunkStart
      dataSize = chunkSize
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }

  if (!fmt || dataOffset === null || dataSize === null) {
    throw new Error('WAV is missing fmt or data chunk.')
  }
  if (![1, 3].includes(fmt.audioFormat)) {
    throw new Error(`Unsupported WAV format: ${fmt.audioFormat}`)
  }
  if (![8, 16, 24, 32].includes(fmt.bitsPerSample)) {
    throw new Error(`Unsupported WAV bit depth: ${fmt.bitsPerSample}`)
  }

  const frameCount = Math.floor(dataSize / fmt.blockAlign)
  const channels = Array.from({ length: fmt.channelCount }, () => new Float32Array(frameCount))
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * fmt.blockAlign
    for (let channel = 0; channel < fmt.channelCount; channel += 1) {
      const sampleOffset = frameOffset + channel * (fmt.bitsPerSample / 8)
      channels[channel][frame] = readSample(buffer, sampleOffset, fmt.audioFormat, fmt.bitsPerSample)
    }
  }
  return {
    sampleRate: fmt.sampleRate,
    channelCount: fmt.channelCount,
    channels,
  }
}

function readSample(buffer, offset, audioFormat, bitsPerSample) {
  if (audioFormat === 3 && bitsPerSample === 32) {
    return clamp(buffer.readFloatLE(offset), -1, 1)
  }
  if (bitsPerSample === 8) {
    return (buffer.readUInt8(offset) - 128) / 128
  }
  if (bitsPerSample === 16) {
    return buffer.readInt16LE(offset) / 32768
  }
  if (bitsPerSample === 24) {
    const value = buffer.readIntLE(offset, 3)
    return value / 8388608
  }
  if (bitsPerSample === 32) {
    return buffer.readInt32LE(offset) / 2147483648
  }
  throw new Error(`Unsupported sample depth: ${bitsPerSample}`)
}

function mixToMono(decoded) {
  if (decoded.channelCount === 1) {
    return decoded.channels[0]
  }
  const mono = new Float32Array(decoded.channels[0].length)
  const gain = 1 / Math.sqrt(decoded.channelCount)
  for (const channel of decoded.channels) {
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] += channel[index] * gain
    }
  }
  return mono
}

function resampleLinear(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return samples
  }
  const targetLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate))
  const output = new Float32Array(targetLength)
  const ratio = sourceRate / targetRate
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio
    const left = Math.floor(sourcePosition)
    const right = Math.min(samples.length - 1, left + 1)
    const fraction = sourcePosition - left
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction
  }
  return output
}

function segmentAudio(sampleCount, sampleRate, segmentSeconds, minSegmentSeconds) {
  const segmentLength = Math.max(1, Math.round(sampleRate * segmentSeconds))
  const minSegmentLength = Math.max(1, Math.round(sampleRate * minSegmentSeconds))
  const segments = []
  for (let startSample = 0; startSample < sampleCount; startSample += segmentLength) {
    const endSample = Math.min(sampleCount, startSample + segmentLength)
    if (endSample - startSample < minSegmentLength && segments.length > 0) {
      segments[segments.length - 1].endSample = endSample
    } else {
      segments.push({ startSample, endSample })
    }
  }
  return segments
}

function analyzeSegment(samples, sampleRate, silenceThreshold) {
  let peak = 0
  let squareSum = 0
  let silent = 0
  for (const sample of samples) {
    const abs = Math.abs(sample)
    peak = Math.max(peak, abs)
    squareSum += sample * sample
    if (abs < silenceThreshold) {
      silent += 1
    }
  }
  const rms = samples.length ? Math.sqrt(squareSum / samples.length) : 0
  return {
    peak,
    rms,
    silenceRatio: samples.length ? silent / samples.length : 1,
    pitch: estimatePitchCoverage(samples, sampleRate),
  }
}

function estimatePitchCoverage(samples, sampleRate) {
  const frameLength = Math.max(256, Math.round(sampleRate * 0.046))
  const hop = Math.max(128, Math.round(sampleRate * 0.023))
  const pitches = []
  let frameCount = 0
  for (let start = 0; start + frameLength <= samples.length; start += hop) {
    frameCount += 1
    const frame = samples.subarray(start, start + frameLength)
    const estimate = estimateFramePitch(frame, sampleRate)
    if (estimate && estimate.confidence >= 0.28) {
      pitches.push(estimate.hz)
    }
  }
  return {
    frameCount,
    voicedFrameCount: pitches.length,
    voicedRatio: frameCount ? pitches.length / frameCount : 0,
    medianHz: median(pitches),
    minHz: pitches.length ? Math.min(...pitches) : null,
    maxHz: pitches.length ? Math.max(...pitches) : null,
  }
}

function estimateFramePitch(frame, sampleRate) {
  let mean = 0
  for (const sample of frame) {
    mean += sample
  }
  mean /= frame.length

  let energy = 0
  const centered = new Float32Array(frame.length)
  for (let index = 0; index < frame.length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, frame.length - 1))
    const value = (frame[index] - mean) * window
    centered[index] = value
    energy += value * value
  }
  if (energy < 1e-6) {
    return null
  }

  const minLag = Math.max(1, Math.floor(sampleRate / 900))
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / 65))
  let bestLag = minLag
  let best = -Infinity
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0
    for (let index = 0; index + lag < centered.length; index += 1) {
      sum += centered[index] * centered[index + lag]
    }
    if (sum > best) {
      best = sum
      bestLag = lag
    }
  }
  const confidence = best / energy
  return {
    hz: sampleRate / bestLag,
    confidence,
  }
}

function readSidecarText(audioPath) {
  for (const { path, extension } of sidecarCandidates(audioPath)) {
    if (!existsSync(path)) {
      continue
    }
    const text = readFileSync(path, 'utf8')
    if (extension === '.json') {
      try {
        const data = JSON.parse(text)
        return jsonAnnotationText(data)
      } catch {
        return text
      }
    }
    if (extension === '.csv') {
      return csvAnnotationText(text)
    }
    if (extension === '.lab') {
      return text
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/).slice(2).join(' '))
        .filter(Boolean)
        .join(' ')
    }
    return text.trim()
  }
  return ''
}

function sidecarCandidates(audioPath) {
  const extensionOrder = ['.txt', '.lab', '.json', '.csv']
  const base = audioPath.slice(0, audioPath.length - extname(audioPath).length)
  const audioDir = dirname(audioPath)
  const parentDir = dirname(audioDir)
  const stem = basename(base)
  const siblings = ['lyric', 'lyrics', 'label', 'labels', 'csv', 'json', 'metadata']
  const candidates = []
  for (const extension of extensionOrder) {
    candidates.push({ path: `${base}${extension}`, extension })
  }
  for (const sibling of siblings) {
    for (const extension of extensionOrder) {
      candidates.push({ path: join(parentDir, sibling, `${stem}${extension}`), extension })
    }
  }
  const seen = new Set()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) {
      return false
    }
    seen.add(candidate.path)
    return true
  })
}

function jsonAnnotationText(value) {
  const collected = []
  collectJsonAnnotationText(value, collected)
  return collected.join(' ').trim()
}

function collectJsonAnnotationText(value, collected, key = '') {
  if (typeof value === 'string') {
    if (isAnnotationTextKey(key) || containsHangul(value)) {
      collected.push(value)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonAnnotationText(item, collected, key)
    }
    return
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectJsonAnnotationText(childValue, collected, childKey)
    }
  }
}

function csvAnnotationText(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) {
    return containsHangul(text) ? text : ''
  }
  const header = rows[0].map((cell) => cell.trim())
  const candidateIndexes = header
    .map((name, index) => (isAnnotationTextKey(name) ? index : -1))
    .filter((index) => index >= 0)
  const fallbackIndexes = header.map((_, index) => index)
  const indexes = candidateIndexes.length > 0 ? candidateIndexes : fallbackIndexes
  return rows
    .slice(1)
    .flatMap((row) => indexes.map((index) => row[index] ?? ''))
    .filter(containsHangul)
    .join(' ')
    .trim()
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  row.push(cell)
  if (row.some((value) => value.length > 0)) {
    rows.push(row)
  }
  return rows
}

function isAnnotationTextKey(key) {
  return /^(lyric|lyrics|text|transcript|transcription|syllable|syllables|label|labels|word|words)$/iu.test(key)
}

function containsHangul(value) {
  return /[\uac00-\ud7a3]/u.test(String(value ?? ''))
}

function summarizeTextCoverage(text) {
  const hangul = []
  const phonemes = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < HANGUL_BASE || code > HANGUL_END) {
      continue
    }
    hangul.push(char)
    const offset = code - HANGUL_BASE
    const onsetIndex = Math.floor(offset / (VOWEL_COUNT * CODA_COUNT))
    const vowelIndex = Math.floor((offset % (VOWEL_COUNT * CODA_COUNT)) / CODA_COUNT)
    const codaIndex = offset % CODA_COUNT
    const onset = ONSET_SYMBOLS[onsetIndex]
    const vowel = VOWEL_SYMBOLS[vowelIndex]
    const coda = CODA_SYMBOLS[codaIndex]
    if (onset) {
      phonemes.push(onset)
    }
    if (vowel) {
      phonemes.push(vowel)
    }
    if (coda) {
      phonemes.push(coda)
    }
  }
  return {
    hasText: text.trim().length > 0,
    hangulSyllableCount: hangul.length,
    uniqueHangulSyllables: [...new Set(hangul)].sort(),
    uniquePhonemes: [...new Set(phonemes)].sort(),
  }
}

function summarizeSegments(segments) {
  return {
    count: segments.length,
    totalDurationSeconds: sum(segments.map((segment) => segment.durationSeconds)),
    durationSeconds: numericStats(segments.map((segment) => segment.durationSeconds)),
    peak: numericStats(segments.map((segment) => segment.stats.peak)),
    rms: numericStats(segments.map((segment) => segment.stats.rms)),
    silenceRatio: numericStats(segments.map((segment) => segment.stats.silenceRatio)),
    voicedRatio: numericStats(segments.map((segment) => segment.stats.pitch.voicedRatio)),
    medianPitchHz: numericStats(segments.map((segment) => segment.stats.pitch.medianHz).filter((value) => value !== null)),
  }
}

function mergeLyricCoverage(coverages) {
  const hangul = new Set()
  const phonemes = new Set()
  let annotatedFiles = 0
  let hangulSyllableCount = 0
  for (const coverage of coverages) {
    if (coverage.hasText) {
      annotatedFiles += 1
    }
    hangulSyllableCount += coverage.hangulSyllableCount
    for (const syllable of coverage.uniqueHangulSyllables) {
      hangul.add(syllable)
    }
    for (const phoneme of coverage.uniquePhonemes) {
      phonemes.add(phoneme)
    }
  }
  return {
    annotatedFiles,
    hangulSyllableCount,
    uniqueHangulSyllables: [...hangul].sort(),
    uniquePhonemes: [...phonemes].sort(),
  }
}

function numericStats(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (clean.length === 0) {
    return { min: null, median: null, max: null, mean: null }
  }
  return {
    min: clean[0],
    median: median(clean),
    max: clean[clean.length - 1],
    mean: sum(clean) / clean.length,
  }
}

function median(values) {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}

function sanitizeId(value) {
  return basename(value)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-|-$/g, '') || 'segment'
}

function isGuideAudioArtifact(root, path) {
  const relativeParts = relative(root, path).split(/[\\/]+/u)
  const fileName = relativeParts.at(-1)?.toLowerCase() ?? ''
  return fileName.endsWith('.guide.wav') || relativeParts.slice(0, -1).some((part) => isGuideDirectoryName(part))
}

function isGuideDirectoryName(value) {
  return ['guides', 'guide-tracks'].includes(value.toLowerCase())
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { summary } = ingestNeuralDataset(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
