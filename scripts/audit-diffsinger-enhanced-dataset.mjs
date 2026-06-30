#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DATASET_DIR = 'experiments/neural-singer/work/csd-mfa-smoke/diffsinger-dataset-enhanced'
const DEFAULT_MIN_ITEMS = 2
const DEFAULT_MIN_TOTAL_SECONDS = 2
const DEFAULT_PRODUCTION_MIN_ITEMS = 20
const DEFAULT_PRODUCTION_MIN_TOTAL_SECONDS = 30 * 60
const DEFAULT_MAX_DURATION_DRIFT_SECONDS = 0.75
const DEFAULT_MAX_DURATION_DRIFT_RATIO = 0.35
const DEFAULT_MIN_PHONE_DURATION = 0.005
const DEFAULT_MAX_PHONE_DURATION = 3

export function auditDiffSingerEnhancedDataset(options = {}) {
  const datasetDir = resolve(options.datasetDir ?? DEFAULT_DATASET_DIR)
  const transcriptionsPath = resolve(options.transcriptions ?? join(datasetDir, 'transcriptions.csv'))
  const wavDir = resolve(options.wavDir ?? join(datasetDir, 'wavs'))
  const production = Boolean(options.production)
  const thresholds = {
    minItems: positiveInteger(options.minItems, production ? DEFAULT_PRODUCTION_MIN_ITEMS : DEFAULT_MIN_ITEMS),
    minTotalSeconds: positiveNumber(options.minTotalSeconds, production ? DEFAULT_PRODUCTION_MIN_TOTAL_SECONDS : DEFAULT_MIN_TOTAL_SECONDS),
    maxDurationDriftSeconds: positiveNumber(options.maxDurationDriftSeconds, DEFAULT_MAX_DURATION_DRIFT_SECONDS),
    maxDurationDriftRatio: ratioNumber(options.maxDurationDriftRatio, DEFAULT_MAX_DURATION_DRIFT_RATIO),
    minPhoneDuration: positiveNumber(options.minPhoneDuration, DEFAULT_MIN_PHONE_DURATION),
    maxPhoneDuration: positiveNumber(options.maxPhoneDuration, DEFAULT_MAX_PHONE_DURATION),
    requireApSp: options.requireApSp !== false,
  }
  const problems = []
  const warnings = []

  if (!existsSync(datasetDir)) {
    problems.push(`Missing enhanced dataset directory: ${datasetDir}.`)
  }
  if (!existsSync(transcriptionsPath)) {
    problems.push(`Missing transcriptions.csv: ${transcriptionsPath}.`)
  }
  if (!existsSync(wavDir)) {
    problems.push(`Missing wavs directory: ${wavDir}.`)
  }

  const entries = existsSync(transcriptionsPath) ? parseTranscriptions(readFileSync(transcriptionsPath, 'utf8'), problems) : []
  const duplicateNames = duplicateValues(entries.map((entry) => entry.name))
  for (const name of duplicateNames) {
    problems.push(`Duplicate transcription item name: ${name}.`)
  }

  const phoneCounts = new Map()
  const itemReports = []
  for (const entry of entries) {
    const wavPath = join(wavDir, `${entry.name}.wav`)
    const wav = readWavStats(wavPath)
    const itemProblems = [...entry.problems]
    const itemWarnings = []
    const phoneDurationSeconds = sum(entry.durations)
    for (const phone of entry.phones) {
      phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1)
    }

    if (!wav.exists) {
      itemProblems.push(`Missing WAV: ${wavPath}`)
    } else if (wav.error) {
      itemProblems.push(`Invalid WAV: ${wav.error}`)
    } else {
      const driftSeconds = Math.abs(phoneDurationSeconds - wav.durationSeconds)
      const driftRatio = wav.durationSeconds > 0 ? driftSeconds / wav.durationSeconds : 1
      if (driftSeconds > thresholds.maxDurationDriftSeconds && driftRatio > thresholds.maxDurationDriftRatio) {
        itemProblems.push(
          `ph_dur sum ${round(phoneDurationSeconds)}s differs from WAV ${round(wav.durationSeconds)}s by ${round(driftSeconds)}s (${round(driftRatio)} ratio).`,
        )
      } else if (driftSeconds > thresholds.maxDurationDriftSeconds || driftRatio > thresholds.maxDurationDriftRatio) {
        itemWarnings.push(
          `ph_dur/WAV duration drift is near threshold: ${round(driftSeconds)}s (${round(driftRatio)} ratio).`,
        )
      }
    }

    for (const [index, duration] of entry.durations.entries()) {
      if (duration < thresholds.minPhoneDuration) {
        itemProblems.push(`Phone duration too short at index ${index}: ${duration}.`)
      }
      if (duration > thresholds.maxPhoneDuration) {
        itemProblems.push(`Phone duration too long at index ${index}: ${duration}.`)
      }
    }

    itemReports.push({
      name: entry.name,
      wav: wav.path,
      wavExists: wav.exists,
      wavDurationSeconds: wav.durationSeconds,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitsPerSample: wav.bitsPerSample,
      phoneCount: entry.phones.length,
      phoneDurationSeconds: round(phoneDurationSeconds),
      hasAp: entry.phones.includes('AP'),
      hasSp: entry.phones.includes('SP'),
      problems: itemProblems,
      warnings: itemWarnings,
    })
  }

  const totalPhoneDurationSeconds = sum(itemReports.map((item) => item.phoneDurationSeconds ?? 0))
  const validWavDurationSeconds = sum(itemReports.map((item) => item.wavDurationSeconds ?? 0))
  if (entries.length < thresholds.minItems) {
    problems.push(`Enhanced dataset has ${entries.length} items; required ${thresholds.minItems}.`)
  }
  if (validWavDurationSeconds < thresholds.minTotalSeconds) {
    problems.push(`Enhanced dataset has ${round(validWavDurationSeconds)} seconds of WAV audio; required ${thresholds.minTotalSeconds}.`)
  }
  if (thresholds.requireApSp) {
    if (!phoneCounts.has('AP')) {
      problems.push('Enhanced dataset phone inventory must include AP.')
    }
    if (!phoneCounts.has('SP')) {
      problems.push('Enhanced dataset phone inventory must include SP.')
    }
  }

  const itemProblems = itemReports.flatMap((item) => item.problems.map((problem) => `${item.name}: ${problem}`))
  const itemWarnings = itemReports.flatMap((item) => item.warnings.map((warning) => `${item.name}: ${warning}`))
  problems.push(...itemProblems)
  warnings.push(...itemWarnings)

  const referenced = new Set(entries.map((entry) => `${entry.name}.wav`))
  const unreferencedWavs = existsSync(wavDir)
    ? readdirSync(wavDir).filter((name) => name.toLowerCase().endsWith('.wav') && !referenced.has(name)).sort((a, b) => a.localeCompare(b))
    : []
  if (unreferencedWavs.length > 0) {
    warnings.push(`Unreferenced WAV files: ${unreferencedWavs.slice(0, 12).join(', ')}${unreferencedWavs.length > 12 ? '...' : ''}.`)
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'enhanced-dataset-ready' : 'enhanced-dataset-blocked',
    datasetDir,
    transcriptions: transcriptionsPath,
    wavDir,
    production,
    thresholds,
    metrics: {
      itemCount: entries.length,
      wavItemCount: itemReports.filter((item) => item.wavExists && !item.problems.some((problem) => problem.startsWith('Invalid WAV'))).length,
      totalPhoneDurationSeconds: round(totalPhoneDurationSeconds),
      validWavDurationSeconds: round(validWavDurationSeconds),
      phoneInventoryCount: phoneCounts.size,
      hasAp: phoneCounts.has('AP'),
      hasSp: phoneCounts.has('SP'),
      duplicateNameCount: duplicateNames.length,
      unreferencedWavCount: unreferencedWavs.length,
    },
    phoneCounts: Object.fromEntries([...phoneCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    items: itemReports,
    problems,
    warnings,
    nextActions: nextActionsForProblems(problems),
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

function parseTranscriptions(text, problems) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim())
  const header = splitCsvLine(lines.shift() ?? '').map((cell) => cell.trim())
  const nameIndex = header.indexOf('name')
  const phSeqIndex = header.indexOf('ph_seq')
  const phDurIndex = header.indexOf('ph_dur')
  if ([nameIndex, phSeqIndex, phDurIndex].includes(-1)) {
    problems.push('DiffSinger transcriptions.csv must include name, ph_seq, and ph_dur columns.')
    return []
  }
  return lines.map((line, rowIndex) => {
    const columns = splitCsvLine(line)
    const name = columns[nameIndex]?.trim()
    const phones = columns[phSeqIndex]?.trim().split(/\s+/u).filter(Boolean) ?? []
    const durations = columns[phDurIndex]?.trim().split(/\s+/u).filter(Boolean).map(Number) ?? []
    const rowProblems = []
    if (!name) {
      rowProblems.push(`Missing item name in row ${rowIndex + 2}.`)
    }
    if (phones.length === 0) {
      rowProblems.push('Missing ph_seq.')
    }
    if (phones.length !== durations.length) {
      rowProblems.push(`ph_seq/ph_dur length mismatch: ${phones.length} vs ${durations.length}.`)
    }
    if (durations.some((duration) => !Number.isFinite(duration) || duration < 0)) {
      rowProblems.push('Invalid ph_dur value.')
    }
    return {
      name: name || `(row-${rowIndex + 2})`,
      phones,
      durations,
      problems: rowProblems,
    }
  })
}

function splitCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function readWavStats(path) {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      error: null,
      durationSeconds: 0,
      sampleRate: null,
      channels: null,
      bitsPerSample: null,
    }
  }
  try {
    const buffer = readFileSync(path)
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('Unsupported WAV container.')
    }
    let offset = 12
    let fmt = null
    let dataSize = null
    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4)
      const chunkSize = buffer.readUInt32LE(offset + 4)
      const chunkStart = offset + 8
      if (chunkId === 'fmt ') {
        fmt = {
          audioFormat: buffer.readUInt16LE(chunkStart),
          channels: buffer.readUInt16LE(chunkStart + 2),
          sampleRate: buffer.readUInt32LE(chunkStart + 4),
          byteRate: buffer.readUInt32LE(chunkStart + 8),
          bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
        }
      } else if (chunkId === 'data') {
        dataSize = chunkSize
      }
      offset = chunkStart + chunkSize + (chunkSize % 2)
    }
    if (!fmt || dataSize === null) {
      throw new Error('WAV is missing fmt or data chunk.')
    }
    if (fmt.audioFormat !== 1 && fmt.audioFormat !== 3) {
      throw new Error(`Unsupported WAV format: ${fmt.audioFormat}.`)
    }
    return {
      path,
      exists: true,
      error: null,
      durationSeconds: fmt.byteRate > 0 ? dataSize / fmt.byteRate : 0,
      sampleRate: fmt.sampleRate,
      channels: fmt.channels,
      bitsPerSample: fmt.bitsPerSample,
    }
  } catch (error) {
    return {
      path,
      exists: true,
      error: error instanceof Error ? error.message : String(error),
      durationSeconds: 0,
      sampleRate: null,
      channels: null,
      bitsPerSample: null,
    }
  }
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }
  return [...duplicates].sort((a, b) => a.localeCompare(b))
}

function nextActionsForProblems(problems) {
  if (problems.length === 0) {
    return ['Prepare the DiffSinger training run and guarded GPU job from this enhanced dataset.']
  }
  const actions = new Set()
  for (const problem of problems) {
    if (problem.includes('WAV') || problem.includes('duration')) {
      actions.add('Rerun MakeDiffSinger alignment/enhancement and verify WAV export paths and durations.')
    } else if (problem.includes('AP') || problem.includes('SP')) {
      actions.add('Include silence/breath boundary labels during alignment so AP/SP are present.')
    } else if (problem.includes('items') || problem.includes('seconds')) {
      actions.add('Use a larger reviewed dataset slice before preparing a production training run.')
    } else {
      actions.add('Fix the enhanced DiffSinger transcriptions.csv and rerun this audit.')
    }
  }
  return [...actions]
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function ratioNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0)
}

function round(value) {
  return Math.round(Number(value ?? 0) * 1000000) / 1000000
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dataset-dir') {
      parsed.datasetDir = argv[++index]
    } else if (arg === '--transcriptions') {
      parsed.transcriptions = argv[++index]
    } else if (arg === '--wav-dir') {
      parsed.wavDir = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--production') {
      parsed.production = true
    } else if (arg === '--min-items') {
      parsed.minItems = Number(argv[++index])
    } else if (arg === '--min-total-seconds') {
      parsed.minTotalSeconds = Number(argv[++index])
    } else if (arg === '--max-duration-drift-seconds') {
      parsed.maxDurationDriftSeconds = Number(argv[++index])
    } else if (arg === '--max-duration-drift-ratio') {
      parsed.maxDurationDriftRatio = Number(argv[++index])
    } else if (arg === '--min-phone-duration') {
      parsed.minPhoneDuration = Number(argv[++index])
    } else if (arg === '--max-phone-duration') {
      parsed.maxPhoneDuration = Number(argv[++index])
    } else if (arg === '--no-require-ap-sp') {
      parsed.requireApSp = false
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-diffsinger-enhanced-dataset.mjs [options]',
          '',
          'Options:',
          `  --dataset-dir path                  Enhanced dataset dir, default ${DEFAULT_DATASET_DIR}`,
          '  --transcriptions path               Override transcriptions.csv path',
          '  --wav-dir path                      Override wavs directory',
          '  --report path                       Write JSON audit report',
          '  --production                        Use production item/duration defaults',
          '  --min-items n                       Minimum transcription items',
          '  --min-total-seconds n               Minimum referenced WAV seconds',
          '  --max-duration-drift-seconds n      Max ph_dur/WAV absolute drift',
          '  --max-duration-drift-ratio n        Max ph_dur/WAV relative drift',
          '  --min-phone-duration n              Minimum per-phone duration',
          '  --max-phone-duration n              Maximum per-phone duration',
          '  --no-require-ap-sp                  Do not require AP and SP labels',
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
    const report = auditDiffSingerEnhancedDataset(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
