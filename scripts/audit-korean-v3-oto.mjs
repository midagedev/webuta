#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { DEFAULT_ZIP, parseOto } from './audit-korean-v3-voicebank.mjs'

export const DEFAULT_REPORT = 'experiments/utau-v3/work/v3-oto-audit.json'

const DEFAULT_THRESHOLDS = {
  minSamples: 600,
  minAliases: 1400,
}

const TYPE_EXPECTATIONS = {
  CV: {
    offset: [0, 8],
    consonant: [140, 190],
    cutoff: [-700, -580],
    preutterance: [55, 90],
    overlap: [25, 45],
    minSourceWindowMs: 560,
    minSustainBodyMs: 390,
    minReleaseGapMs: 180,
  },
  CVC: {
    offset: [0, 8],
    consonant: [140, 190],
    cutoff: [-670, -560],
    preutterance: [55, 90],
    overlap: [25, 45],
    minSourceWindowMs: 520,
    minSustainBodyMs: 340,
    minReleaseGapMs: 180,
  },
  V: {
    offset: [0, 8],
    consonant: [55, 85],
    cutoff: [-820, -700],
    preutterance: [18, 35],
    overlap: [6, 18],
    minSourceWindowMs: 700,
    minSustainBodyMs: 580,
    minReleaseGapMs: 250,
  },
  VC: {
    offset: [0, 8],
    consonant: [80, 120],
    cutoff: [-310, -220],
    preutterance: [20, 42],
    overlap: [10, 28],
    minSourceWindowMs: 220,
    minSustainBodyMs: 120,
    minReleaseGapMs: 420,
  },
}

export async function auditKoreanV3Oto(options = {}) {
  const zipPath = resolve(options.zip ?? DEFAULT_ZIP)
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) }
  const bytes = readFileSync(zipPath)
  const zip = await JSZip.loadAsync(bytes)
  const otoText = zip.files['oto.ini'] ? await zip.files['oto.ini'].async('string') : ''
  const manifestText = zip.files['webuta-ko-v3.manifest.json']
    ? await zip.files['webuta-ko-v3.manifest.json'].async('string')
    : '{}'
  const manifest = parseJson(manifestText)
  const manifestSamples = Array.isArray(manifest?.samples) ? manifest.samples : []
  const otoEntries = parseOto(otoText)
  const otoByFileName = new Map()

  for (const entry of otoEntries) {
    const entries = otoByFileName.get(entry.fileName) ?? []
    entries.push(entry)
    otoByFileName.set(entry.fileName, entries)
  }

  const sampleAudits = manifestSamples.map((sample) => auditSampleOto(sample, otoByFileName))
  const referencedFiles = new Set(manifestSamples.map((sample) => basename(String(sample?.fileName ?? ''))))
  const extraOtoFiles = [...otoByFileName.keys()].filter((fileName) => !referencedFiles.has(fileName)).sort()
  const problems = [
    ...(existsSync(zipPath) ? [] : [`Missing voicebank zip: ${zipPath}`]),
    ...(manifestSamples.length < thresholds.minSamples
      ? [`Only ${manifestSamples.length} manifest samples; expected at least ${thresholds.minSamples}.`]
      : []),
    ...(otoEntries.length < thresholds.minAliases
      ? [`Only ${otoEntries.length} oto entries; expected at least ${thresholds.minAliases}.`]
      : []),
    ...extraOtoFiles.slice(0, 20).map((fileName) => `oto.ini contains sample not present in manifest: ${fileName}`),
    ...sampleAudits.flatMap((audit) => audit.problems.map((problem) => `${audit.fileName}: ${problem}`)).slice(0, 80),
  ]

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'v3-oto-audit-pass' : 'v3-oto-audit-fail',
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
    oto: {
      manifestSampleCount: manifestSamples.length,
      entryCount: otoEntries.length,
      auditedSampleCount: sampleAudits.length,
      extraOtoFileCount: extraOtoFiles.length,
      summary: summarizeSampleAudits(sampleAudits),
      worst: sampleAudits.filter((audit) => !audit.ok).slice(0, 12),
    },
    problems,
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

export function auditSampleOto(sample, otoByFileName) {
  const fileName = basename(String(sample?.fileName ?? ''))
  const type = String(sample?.type ?? '')
  const expectedAliases = new Set(Array.isArray(sample?.aliases) ? sample.aliases.map(String) : [])
  const durationMs = Number(sample?.durationSeconds) * 1000
  const entries = otoByFileName.get(fileName) ?? []
  const entryAliases = new Set(entries.map((entry) => entry.alias))
  const timingReference = entries[0]
  const timingProblems = timingReference ? validateTiming(type, durationMs, timingReference) : []
  const inconsistentTiming = entries.some(
    (entry) =>
      timingReference &&
      (entry.offsetMs !== timingReference.offsetMs ||
        entry.consonantMs !== timingReference.consonantMs ||
        entry.cutoffMs !== timingReference.cutoffMs ||
        entry.preutteranceMs !== timingReference.preutteranceMs ||
        entry.overlapMs !== timingReference.overlapMs),
  )
  const missingAliases = [...expectedAliases].filter((alias) => !entryAliases.has(alias)).sort()
  const extraAliases = [...entryAliases].filter((alias) => !expectedAliases.has(alias)).sort()
  const duplicateAliases = entries
    .map((entry) => entry.alias)
    .filter((alias, index, aliases) => aliases.indexOf(alias) !== index)
    .filter((alias, index, aliases) => aliases.indexOf(alias) === index)
    .sort()
  const problems = [
    ...(entries.length === 0 ? ['missing oto.ini entry'] : []),
    ...(expectedAliases.size === 0 ? ['manifest sample has no aliases'] : []),
    ...missingAliases.slice(0, 8).map((alias) => `missing alias ${alias}`),
    ...extraAliases.slice(0, 8).map((alias) => `unexpected alias ${alias}`),
    ...duplicateAliases.map((alias) => `duplicate alias ${alias}`),
    ...(inconsistentTiming ? ['aliases for this sample do not share identical timing fields'] : []),
    ...timingProblems,
  ]

  return {
    ok: problems.length === 0,
    fileName,
    type,
    alias: sample?.alias ?? null,
    pitch: sample?.pitch ?? null,
    aliasCount: expectedAliases.size,
    otoEntryCount: entries.length,
    timing: timingReference
      ? {
          offsetMs: timingReference.offsetMs,
          consonantMs: timingReference.consonantMs,
          cutoffMs: timingReference.cutoffMs,
          preutteranceMs: timingReference.preutteranceMs,
          overlapMs: timingReference.overlapMs,
          sourceWindowMs: sourceWindowMs(timingReference, durationMs),
          sustainBodyMs: sourceWindowMs(timingReference, durationMs) - timingReference.consonantMs,
          releaseGapMs: durationMs - sourceWindowMs(timingReference, durationMs),
        }
      : null,
    problems,
  }
}

function validateTiming(type, durationMs, entry) {
  const expected = TYPE_EXPECTATIONS[type]
  if (!expected) {
    return [`unknown sample type ${type}`]
  }
  const windowMs = sourceWindowMs(entry, durationMs)
  const sustainBodyMs = windowMs - entry.consonantMs
  const releaseGapMs = durationMs - windowMs
  return [
    ...rangeProblems('offset', entry.offsetMs, expected.offset),
    ...rangeProblems('consonant', entry.consonantMs, expected.consonant),
    ...rangeProblems('cutoff', entry.cutoffMs, expected.cutoff),
    ...rangeProblems('preutterance', entry.preutteranceMs, expected.preutterance),
    ...rangeProblems('overlap', entry.overlapMs, expected.overlap),
    ...(entry.cutoffMs >= 0 ? ['cutoff must be negative for generated V3 source-window timing'] : []),
    ...(entry.overlapMs > entry.preutteranceMs ? ['overlap must not exceed preutterance'] : []),
    ...(entry.preutteranceMs > entry.consonantMs ? ['preutterance must not exceed consonant'] : []),
    ...(windowMs < expected.minSourceWindowMs
      ? [`source window ${windowMs.toFixed(1)}ms is shorter than ${expected.minSourceWindowMs}ms`]
      : []),
    ...(sustainBodyMs < expected.minSustainBodyMs
      ? [`sustain body ${sustainBodyMs.toFixed(1)}ms is shorter than ${expected.minSustainBodyMs}ms`]
      : []),
    ...(releaseGapMs < expected.minReleaseGapMs
      ? [`release gap ${releaseGapMs.toFixed(1)}ms is shorter than ${expected.minReleaseGapMs}ms`]
      : []),
  ]
}

function sourceWindowMs(entry, durationMs) {
  if (entry.cutoffMs < 0) {
    return entry.offsetMs + Math.abs(entry.cutoffMs)
  }
  return durationMs - entry.cutoffMs
}

function rangeProblems(label, value, [min, max]) {
  return value >= min && value <= max ? [] : [`${label} ${value}ms is outside ${min}..${max}ms`]
}

function summarizeSampleAudits(audits) {
  const byType = {}
  for (const audit of audits) {
    const item = byType[audit.type] ?? { count: 0, okCount: 0, problemCount: 0 }
    item.count += 1
    item.okCount += audit.ok ? 1 : 0
    item.problemCount += audit.ok ? 0 : 1
    byType[audit.type] = item
  }
  return {
    okCount: audits.filter((audit) => audit.ok).length,
    problemCount: audits.filter((audit) => !audit.ok).length,
    byType,
  }
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
    report: DEFAULT_REPORT,
    thresholds: {},
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--zip') {
      options.zip = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--min-samples') {
      options.thresholds.minSamples = Number(argv[++index])
    } else if (arg === '--min-aliases') {
      options.thresholds.minAliases = Number(argv[++index])
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/audit-korean-v3-oto.mjs [options]',
          '',
          'Options:',
          '  --zip path            Voicebank zip, default public/voicebanks/webuta-ko-v3.zip',
          '  --report path         JSON report path',
          '  --min-samples n       Minimum manifest sample count',
          '  --min-aliases n       Minimum oto.ini alias count',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  auditKoreanV3Oto(parseArgs(process.argv.slice(2)))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) {
        process.exit(1)
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
