#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PACK_DIR = 'experiments/neural-singer/datasets/original-private-singer'
const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const VOWEL_COUNT = 21
const CODA_COUNT = 28
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

export function auditPrivateSingerPromptCoverage(options = {}) {
  const packDir = resolve(options.packDir ?? DEFAULT_PACK_DIR)
  const sessionPath = resolve(options.session ?? join(packDir, 'recording-session.json'))
  if (!existsSync(sessionPath)) {
    throw new Error(`Missing recording session: ${sessionPath}`)
  }
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
  const thresholds = {
    minTakes: positiveInteger(options.minTakes, 120),
    minMinutes: positiveNumber(options.minMinutes, 30),
    minUniquePrompts: positiveInteger(options.minUniquePrompts, 20),
    minUniqueTags: positiveInteger(options.minUniqueTags, 20),
    minKeys: positiveInteger(options.minKeys, 5),
    minKeyBalanceRatio: ratioNumber(options.minKeyBalanceRatio, 0.65),
    minUniqueSyllables: positiveInteger(options.minUniqueSyllables, 90),
    minCodaCount: positiveInteger(options.minCodaCount, 24),
    minPitchRangeSemitones: positiveInteger(options.minPitchRangeSemitones, 12),
    requireAllOnsets: options.requireAllOnsets !== false,
    requireAllVowels: options.requireAllVowels !== false,
  }
  const takes = Array.isArray(session.takes) ? session.takes : []
  const lyricCoverage = summarizeLyricCoverage(takes)
  const distribution = summarizeDistribution(takes)
  const scoreCoverage = summarizeScoreCoverage({ packDir, takes })
  const gates = evaluateGates({ takes, session, lyricCoverage, distribution, scoreCoverage, thresholds })
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    packDir,
    sessionPath,
    sessionId: session.sessionId ?? '(unknown)',
    singerId: session.singerId ?? '(unknown)',
    thresholds,
    ok: gates.every((gate) => gate.passed),
    gates,
    totals: {
      takeCount: takes.length,
      totalEstimatedSeconds: Number(session.totals?.totalEstimatedSeconds ?? sum(takes.map((take) => Number(take.estimatedSeconds ?? 0)))),
      totalEstimatedMinutes: Number(session.totals?.totalEstimatedMinutes ?? sum(takes.map((take) => Number(take.estimatedSeconds ?? 0))) / 60),
      uniquePrompts: distribution.prompt.count,
      uniqueTags: distribution.tag.count,
      uniqueKeys: distribution.key.count,
      requestCount: scoreCoverage.requestCount,
    },
    distribution,
    lyricCoverage,
    scoreCoverage,
    nextActions: nextActionsForGates(gates),
  }
  if (options.report) {
    const reportPath = resolve(options.report)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

export function summarizeLyricCoverage(takes) {
  const syllables = new Map()
  const onsets = new Map()
  const vowels = new Map()
  const codas = new Map()
  let hangulSyllableCount = 0
  for (const take of takes) {
    for (const char of Array.from(String(take.lyric ?? ''))) {
      const code = char.codePointAt(0) ?? 0
      if (code < HANGUL_BASE || code > HANGUL_END) {
        continue
      }
      hangulSyllableCount += 1
      increment(syllables, char)
      const offset = code - HANGUL_BASE
      const onsetIndex = Math.floor(offset / (VOWEL_COUNT * CODA_COUNT))
      const vowelIndex = Math.floor((offset % (VOWEL_COUNT * CODA_COUNT)) / CODA_COUNT)
      const codaIndex = offset % CODA_COUNT
      increment(onsets, ONSET_SYMBOLS[onsetIndex])
      increment(vowels, VOWEL_SYMBOLS[vowelIndex])
      increment(codas, CODA_SYMBOLS[codaIndex])
    }
  }
  return {
    hangulSyllableCount,
    uniqueSyllableCount: syllables.size,
    topSyllables: topEntries(syllables, 12),
    onset: inventorySummary(ONSET_SYMBOLS.filter(Boolean), onsets),
    vowel: inventorySummary(VOWEL_SYMBOLS, vowels),
    coda: inventorySummary(CODA_SYMBOLS.filter(Boolean), codas),
  }
}

function summarizeDistribution(takes) {
  const sets = new Map()
  const prompts = new Map()
  const tags = new Map()
  const keys = new Map()
  const tempos = new Map()
  for (const take of takes) {
    increment(sets, take.setId ?? '(missing)')
    increment(prompts, take.promptId ?? '(missing)')
    increment(keys, take.key ?? '(missing)')
    increment(tempos, String(take.tempo ?? '(missing)'))
    for (const tag of take.tags ?? []) {
      increment(tags, tag)
    }
  }
  return {
    set: mapSummary(sets),
    prompt: mapSummary(prompts),
    tag: mapSummary(tags),
    key: {
      ...mapSummary(keys),
      balanceRatio: balanceRatio(keys),
    },
    tempo: mapSummary(tempos),
  }
}

function summarizeScoreCoverage({ packDir, takes }) {
  let requestCount = 0
  let noteCount = 0
  const midiValues = []
  const missingRequests = []
  for (const take of takes) {
    const requestPath = take.neuralRequestPath ? resolve(packDir, take.neuralRequestPath) : null
    if (!requestPath || !existsSync(requestPath)) {
      missingRequests.push(take.id)
      continue
    }
    requestCount += 1
    const request = JSON.parse(readFileSync(requestPath, 'utf8'))
    for (const note of request.notes ?? []) {
      if (note.kind !== 'note') {
        continue
      }
      noteCount += 1
      if (Number.isFinite(Number(note.midi))) {
        midiValues.push(Number(note.midi))
      }
    }
  }
  const minMidi = midiValues.length ? Math.min(...midiValues) : null
  const maxMidi = midiValues.length ? Math.max(...midiValues) : null
  return {
    requestCount,
    missingRequestCount: missingRequests.length,
    missingRequests: missingRequests.slice(0, 24),
    noteCount,
    uniqueMidiCount: new Set(midiValues).size,
    minMidi,
    maxMidi,
    pitchRangeSemitones: minMidi === null || maxMidi === null ? 0 : maxMidi - minMidi,
  }
}

function evaluateGates({ takes, session, lyricCoverage, distribution, scoreCoverage, thresholds }) {
  const totalMinutes = Number(session.totals?.totalEstimatedMinutes ?? sum(takes.map((take) => Number(take.estimatedSeconds ?? 0))) / 60)
  return [
    gate('take-count', takes.length >= thresholds.minTakes, takes.length, thresholds.minTakes),
    gate('duration', totalMinutes >= thresholds.minMinutes, round(totalMinutes), thresholds.minMinutes),
    gate('prompt-count', distribution.prompt.count >= thresholds.minUniquePrompts, distribution.prompt.count, thresholds.minUniquePrompts),
    gate('tag-count', distribution.tag.count >= thresholds.minUniqueTags, distribution.tag.count, thresholds.minUniqueTags),
    gate('key-count', distribution.key.count >= thresholds.minKeys, distribution.key.count, thresholds.minKeys),
    gate('key-balance', distribution.key.balanceRatio >= thresholds.minKeyBalanceRatio, distribution.key.balanceRatio, thresholds.minKeyBalanceRatio),
    gate('syllable-count', lyricCoverage.uniqueSyllableCount >= thresholds.minUniqueSyllables, lyricCoverage.uniqueSyllableCount, thresholds.minUniqueSyllables),
    gate('onset-coverage', !thresholds.requireAllOnsets || lyricCoverage.onset.missing.length === 0, lyricCoverage.onset.presentCount, lyricCoverage.onset.requiredCount),
    gate('vowel-coverage', !thresholds.requireAllVowels || lyricCoverage.vowel.missing.length === 0, lyricCoverage.vowel.presentCount, lyricCoverage.vowel.requiredCount),
    gate('coda-coverage', lyricCoverage.coda.presentCount >= thresholds.minCodaCount, lyricCoverage.coda.presentCount, thresholds.minCodaCount),
    gate('request-coverage', scoreCoverage.requestCount === takes.length, scoreCoverage.requestCount, takes.length),
    gate('pitch-range', scoreCoverage.pitchRangeSemitones >= thresholds.minPitchRangeSemitones, scoreCoverage.pitchRangeSemitones, thresholds.minPitchRangeSemitones),
  ]
}

function gate(id, passed, actual, threshold) {
  return {
    id,
    passed: Boolean(passed),
    actual,
    threshold,
  }
}

function nextActionsForGates(gates) {
  const failed = gates.filter((gate) => !gate.passed).map((gate) => gate.id)
  const actions = []
  if (failed.includes('take-count') || failed.includes('duration')) {
    actions.push('Increase target minutes or prompt repeats before recording.')
  }
  if (failed.includes('prompt-count') || failed.includes('tag-count')) {
    actions.push('Add more prompt categories so the singer records broader articulation and musical contexts.')
  }
  if (failed.includes('key-count') || failed.includes('key-balance') || failed.includes('pitch-range')) {
    actions.push('Spread prompts across more keys and regenerate score/request guides.')
  }
  if (failed.includes('syllable-count') || failed.includes('onset-coverage') || failed.includes('vowel-coverage') || failed.includes('coda-coverage')) {
    actions.push('Add Korean coverage prompts for the missing syllables, vowels, onsets, or batchim.')
  }
  if (failed.includes('request-coverage')) {
    actions.push('Regenerate the private singer pack so every take has a neural request fixture.')
  }
  if (actions.length === 0) {
    actions.push('Prompt coverage is ready for a first private recording session.')
  }
  return actions
}

function inventorySummary(required, counts) {
  const present = [...counts.keys()].filter(Boolean).sort()
  const missing = required.filter((item) => !counts.has(item)).sort()
  return {
    requiredCount: required.length,
    presentCount: present.length,
    missing,
    counts: Object.fromEntries([...counts.entries()].filter(([key]) => key).sort(([left], [right]) => left.localeCompare(right))),
  }
}

function mapSummary(map) {
  return {
    count: map.size,
    counts: Object.fromEntries([...map.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))),
    top: topEntries(map, 12),
    low: [...map.entries()].sort((left, right) => left[1] - right[1] || String(left[0]).localeCompare(String(right[0]))).slice(0, 12),
  }
}

function topEntries(map, limit) {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))).slice(0, limit)
}

function balanceRatio(map) {
  const values = [...map.values()]
  if (values.length === 0) {
    return 0
  }
  return round(Math.min(...values) / Math.max(...values))
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}

function positiveNumber(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
}

function positiveInteger(value, fallback) {
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback
}

function ratioNumber(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1 ? Number(value) : fallback
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pack-dir') {
      parsed.packDir = argv[++index]
    } else if (arg === '--session') {
      parsed.session = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--min-takes') {
      parsed.minTakes = Number(argv[++index])
    } else if (arg === '--min-minutes') {
      parsed.minMinutes = Number(argv[++index])
    } else if (arg === '--min-unique-prompts') {
      parsed.minUniquePrompts = Number(argv[++index])
    } else if (arg === '--min-unique-tags') {
      parsed.minUniqueTags = Number(argv[++index])
    } else if (arg === '--min-keys') {
      parsed.minKeys = Number(argv[++index])
    } else if (arg === '--min-key-balance-ratio') {
      parsed.minKeyBalanceRatio = Number(argv[++index])
    } else if (arg === '--min-unique-syllables') {
      parsed.minUniqueSyllables = Number(argv[++index])
    } else if (arg === '--min-coda-count') {
      parsed.minCodaCount = Number(argv[++index])
    } else if (arg === '--min-pitch-range-semitones') {
      parsed.minPitchRangeSemitones = Number(argv[++index])
    } else if (arg === '--allow-missing-onsets') {
      parsed.requireAllOnsets = false
    } else if (arg === '--allow-missing-vowels') {
      parsed.requireAllVowels = false
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-private-singer-prompt-coverage.mjs [options]',
          '',
          'Options:',
          `  --pack-dir path                    Recording pack dir, default ${DEFAULT_PACK_DIR}`,
          '  --session path                     recording-session.json path',
          '  --report path                      Write JSON report to path',
          '  --min-takes n                      Minimum take count, default 120',
          '  --min-minutes n                    Minimum estimated minutes, default 30',
          '  --min-unique-prompts n             Minimum prompt ids, default 20',
          '  --min-unique-tags n                Minimum tag count, default 20',
          '  --min-keys n                       Minimum key count, default 5',
          '  --min-key-balance-ratio n          Minimum min/max key balance, default 0.65',
          '  --min-unique-syllables n           Minimum unique Hangul syllables, default 90',
          '  --min-coda-count n                 Minimum non-empty coda symbols, default 24',
          '  --min-pitch-range-semitones n      Minimum request pitch range, default 12',
          '  --allow-missing-onsets             Do not require every Hangul onset symbol',
          '  --allow-missing-vowels             Do not require every Hangul vowel symbol',
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
    const report = auditPrivateSingerPromptCoverage(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
