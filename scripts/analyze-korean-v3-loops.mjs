#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parsePcm16Wav } from './analyze-korean-v3-pitch.mjs'
import { parseOto } from './audit-korean-v3-voicebank.mjs'

export const DEFAULT_ZIP = 'public/voicebanks/webuta-ko-v3.zip'
export const DEFAULT_REPORT = 'experiments/utau-v3/work/v3-loop-audit.json'

const MIN_LOOP_MS = 180
const MAX_LOOP_MS = 620
const LOOP_RELEASE_GUARD_MS = 180
const CODA_RELEASE_TAIL_MS = 240
const CODA_LOOP_BODY_MS = 420
const CODA_LOOP_TAIL_GAP_MS = 70
const COMPARE_MS = 24

const DEFAULT_THRESHOLDS = {
  minAuditedSamples: 420,
  maxResidualRatio: 0.14,
  maxSeamJump: 0.18,
  minLoopMs: 170,
}

export async function analyzeKoreanV3Loops(options = {}) {
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
  const otoEntries = parseOto(zip.files['oto.ini'] ? await zip.files['oto.ini'].async('string') : '')
  const otoByFileName = new Map()
  for (const entry of otoEntries) {
    if (!otoByFileName.has(entry.fileName)) {
      otoByFileName.set(entry.fileName, entry)
    }
  }

  const manifestSamples = Array.isArray(manifest?.samples) ? manifest.samples : []
  const loopSamples = manifestSamples.filter((sample) => ['CV', 'V'].includes(sample?.type))
  const selectedSamples = loopSamples.slice(0, Math.min(loopSamples.length, maxSamples))
  const audits = []

  for (const sample of selectedSamples) {
    const zipFile = zip.files[sample.fileName]
    const fileName = basename(sample.fileName)
    const otoEntry = otoByFileName.get(fileName)
    if (!zipFile || !otoEntry) {
      audits.push({
        fileName: sample.fileName,
        alias: sample.alias ?? null,
        type: sample.type ?? null,
        pitch: sample.pitch ?? null,
        ok: false,
        problems: [!zipFile ? `missing WAV file: ${sample.fileName}` : `missing oto entry: ${fileName}`],
      })
      continue
    }

    const parsed = parsePcm16Wav(await zipFile.async('uint8array'))
    if (!parsed.ok) {
      audits.push({
        fileName: sample.fileName,
        alias: sample.alias ?? null,
        type: sample.type ?? null,
        pitch: sample.pitch ?? null,
        ok: false,
        problems: [parsed.error],
      })
      continue
    }

    audits.push(analyzeLoopCandidate(sample, otoEntry, parsed.samples, parsed.sampleRate, thresholds))
  }

  const baseProblems = [
    ...(audits.length >= thresholds.minAuditedSamples
      ? []
      : [`only ${audits.length} sustained samples audited; expected at least ${thresholds.minAuditedSamples}`]),
  ]
  const problems = [
    ...baseProblems,
    ...audits.flatMap((audit) => audit.problems.map((problem) => `${audit.fileName}: ${problem}`)),
  ]
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'v3-loop-audit-pass' : 'v3-loop-audit-fail',
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
    loop: {
      auditedCount: audits.length,
      totalLoopableCount: loopSamples.length,
      skippedCount: Math.max(0, loopSamples.length - audits.length),
      summary: summarizeLoopAudits(audits),
      worst: worstLoopAudits(audits),
      samples: audits,
    },
    problems,
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

export function analyzeLoopCandidate(sample, otoEntry, samples, sampleRate, thresholds = DEFAULT_THRESHOLDS) {
  const sourceWindow = makeSourceWindow(samples.length, sampleRate, otoEntry)
  const bounds = makeLoopBounds(sourceWindow, sampleRate, sample.type === 'CVC')
  const candidate = findBestLoopCandidate(samples, bounds, sampleRate)
  if (!candidate) {
    return {
      fileName: sample.fileName,
      alias: sample.alias ?? null,
      type: sample.type ?? null,
      pitch: sample.pitch ?? null,
      ok: false,
      problems: ['no loop candidate found'],
      metrics: null,
    }
  }

  const problems = [
    ...(candidate.residualRatio <= thresholds.maxResidualRatio
      ? []
      : [`loop residual ratio ${candidate.residualRatio.toFixed(3)} exceeds ${thresholds.maxResidualRatio}`]),
    ...(candidate.seamJump <= thresholds.maxSeamJump
      ? []
      : [`loop seam jump ${candidate.seamJump.toFixed(3)} exceeds ${thresholds.maxSeamJump}`]),
    ...(candidate.loopDurationMs >= thresholds.minLoopMs
      ? []
      : [`loop duration ${candidate.loopDurationMs.toFixed(1)}ms below ${thresholds.minLoopMs}ms`]),
  ]

  return {
    fileName: sample.fileName,
    alias: sample.alias ?? null,
    type: sample.type ?? null,
    pitch: sample.pitch ?? null,
    ok: problems.length === 0,
    problems,
    metrics: {
      sourceStartSeconds: sourceWindow.start / sampleRate,
      sourceEndSeconds: sourceWindow.end / sampleRate,
      consonantEndSeconds: sourceWindow.consonantEnd / sampleRate,
      loopStartSeconds: candidate.start / sampleRate,
      loopEndSeconds: candidate.end / sampleRate,
      loopDurationMs: candidate.loopDurationMs,
      tailStartSeconds: bounds.tailStart / sampleRate,
      tailGapMs: candidate.tailGapMs,
      crossfadeMs: candidate.crossfadeSamples / sampleRate * 1000,
      residualRms: candidate.residualRms,
      bodyRms: candidate.bodyRms,
      residualRatio: candidate.residualRatio,
      seamJump: candidate.seamJump,
    },
  }
}

export function findBestLoopCandidate(samples, bounds, sampleRate) {
  const endStep = Math.max(16, Math.floor(sampleRate * 0.0029))
  const startStep = Math.max(16, Math.floor(sampleRate * 0.00145))
  const searchBack = msToSamples(120, sampleRate)
  const endStart = Math.max(bounds.earliestStart + bounds.minLoopSamples, bounds.latestEnd - searchBack)
  let best = null

  for (let end = endStart; end <= bounds.latestEnd; end += endStep) {
    const startMin = Math.max(bounds.earliestStart, end - bounds.maxLoopSamples)
    const startMax = end - bounds.minLoopSamples
    for (let start = startMin; start <= startMax; start += startStep) {
      const metrics = scoreLoopCandidate(samples, start, end, sampleRate)
      const latestEndPenalty = (Math.abs(end - bounds.latestEnd) / sampleRate) * 0.1
      const totalScore = metrics.residualRatio + latestEndPenalty
      if (!best || totalScore < best.totalScore) {
        best = {
          ...metrics,
          start,
          end,
          totalScore,
          loopDurationMs: ((end - start) / sampleRate) * 1000,
          tailGapMs: ((bounds.tailStart - end) / sampleRate) * 1000,
        }
      }
    }
  }

  return best
}

function scoreLoopCandidate(samples, start, end, sampleRate) {
  const loopLength = end - start
  const crossfadeSamples = Math.min(msToSamples(COMPARE_MS, sampleRate), Math.floor(loopLength / 3))
  let diffSquares = 0
  let bodySquares = 0
  let seamJump = 0
  let count = 0

  for (let i = 0; i < crossfadeSamples; i += 2) {
    const head = samples[start + i] ?? 0
    const tail = samples[end - crossfadeSamples + i] ?? 0
    const diff = head - tail
    diffSquares += diff * diff
    bodySquares += (head * head + tail * tail) / 2
    seamJump = Math.max(seamJump, Math.abs(diff))
    count += 1
  }

  const residualRms = Math.sqrt(diffSquares / Math.max(1, count))
  const bodyRms = Math.sqrt(bodySquares / Math.max(1, count))
  return {
    crossfadeSamples,
    residualRms,
    bodyRms,
    residualRatio: residualRms / Math.max(bodyRms, 1e-6),
    seamJump,
  }
}

function makeSourceWindow(sourceLength, sampleRate, entry) {
  const offset = msToSamples(entry.offsetMs ?? 0, sampleRate)
  const cutoff = entry.cutoffMs ?? 0
  const start = clampInt(offset, 0, Math.max(0, sourceLength - 1))
  const end =
    cutoff < 0
      ? clampInt(start + msToSamples(Math.abs(cutoff), sampleRate), start + 1, sourceLength)
      : clampInt(sourceLength - msToSamples(cutoff, sampleRate), start + 1, sourceLength)
  const consonantEnd = clampInt(
    start + msToSamples(Math.max(entry.consonantMs ?? 0, entry.preutteranceMs ?? 0, 80), sampleRate),
    start,
    end,
  )
  return { start, end, consonantEnd }
}

function makeLoopBounds(sourceWindow, sampleRate, hasCoda) {
  const minLoopSamples = msToSamples(MIN_LOOP_MS, sampleRate)
  const maxLoopSamples = msToSamples(MAX_LOOP_MS, sampleRate)
  if (hasCoda) {
    const tailStart = clampInt(
      sourceWindow.end - msToSamples(CODA_RELEASE_TAIL_MS, sampleRate),
      sourceWindow.consonantEnd + 1,
      sourceWindow.end,
    )
    const latestEnd = Math.max(
      sourceWindow.consonantEnd + 1,
      tailStart - msToSamples(CODA_LOOP_TAIL_GAP_MS, sampleRate),
    )
    const codaLatestEnd = Math.min(sourceWindow.consonantEnd + msToSamples(CODA_LOOP_BODY_MS, sampleRate), latestEnd)
    return {
      earliestStart: sourceWindow.consonantEnd,
      latestEnd: codaLatestEnd,
      tailStart,
      minLoopSamples: Math.min(minLoopSamples, Math.max(16, codaLatestEnd - sourceWindow.consonantEnd)),
      maxLoopSamples,
    }
  }

  const latestEnd = Math.max(
    sourceWindow.consonantEnd + minLoopSamples,
    sourceWindow.end - msToSamples(LOOP_RELEASE_GUARD_MS, sampleRate),
  )
  return {
    earliestStart: sourceWindow.consonantEnd,
    latestEnd,
    tailStart: latestEnd,
    minLoopSamples,
    maxLoopSamples,
  }
}

function summarizeLoopAudits(audits) {
  const metrics = audits.map((audit) => audit.metrics).filter(Boolean)
  return {
    okCount: audits.filter((audit) => audit.ok).length,
    problemCount: audits.filter((audit) => !audit.ok).length,
    maxResidualRatio: max(metrics.map((metric) => metric.residualRatio)),
    maxSeamJump: max(metrics.map((metric) => metric.seamJump)),
    minLoopDurationMs: min(metrics.map((metric) => metric.loopDurationMs)),
    maxLoopDurationMs: max(metrics.map((metric) => metric.loopDurationMs)),
    minTailGapMs: min(metrics.filter((metric) => metric.tailGapMs > 0).map((metric) => metric.tailGapMs)),
  }
}

function worstLoopAudits(audits) {
  return [...audits]
    .sort((a, b) => loopRiskScore(b) - loopRiskScore(a))
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

function loopRiskScore(audit) {
  if (!audit.metrics) {
    return 100000
  }
  return (
    (audit.ok ? 0 : 1000) +
    audit.metrics.residualRatio * 100 +
    audit.metrics.seamJump * 20 +
    Math.max(0, 180 - audit.metrics.loopDurationMs)
  )
}

function basename(path) {
  return path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
}

function msToSamples(ms, sampleRate) {
  return Math.round((ms / 1000) * sampleRate)
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function min(values) {
  return values.length ? Math.min(...values) : null
}

function max(values) {
  return values.length ? Math.max(...values) : null
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
    } else if (arg === '--max-residual-ratio' && next) {
      options.thresholds.maxResidualRatio = Number(next)
      index += 1
    } else if (arg === '--max-seam-jump' && next) {
      options.thresholds.maxSeamJump = Number(next)
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
    analyzeKoreanV3Loops(options)
      .then((report) => {
        console.log(JSON.stringify({ ...report, loop: { ...report.loop, samples: undefined } }, null, 2))
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
