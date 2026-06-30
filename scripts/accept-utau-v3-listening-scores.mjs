#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_OUT = 'experiments/utau-v3/work/v3-listening-review/listening-scores.local.json'

const SCORE_KEYS = [
  'koreanClarityScore',
  'vowelStabilityScore',
  'consonantClarityScore',
  'musicalityScore',
  'artifactScore',
]
const PASSING_DECISIONS = new Set(['community-ready', 'release-ready', 'pass'])

export function acceptUtauV3ListeningScores(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const sourcePath = options.scores ? resolve(cwd, options.scores) : null
  const outPath = resolve(cwd, options.out ?? DEFAULT_OUT)
  const problems = []

  if (!sourcePath) {
    problems.push('missing --scores path')
  } else if (!existsSync(sourcePath)) {
    problems.push(`scores file not found: ${sourcePath}`)
  }

  const scores = problems.length === 0 ? readJson(sourcePath, problems) : null
  if (scores) {
    validateScores(scores, problems)
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'v3-listening-scores-accepted' : 'v3-listening-scores-rejected',
    sourcePath,
    outPath,
    summary: scores
      ? {
          reviewer: scores.reviewer ?? null,
          reviewedAt: scores.reviewedAt ?? null,
          decision: scores.decision ?? null,
          phraseCount: scores.phraseScores?.length ?? 0,
          comparisonCount: scores.comparisonScores?.length ?? 0,
        }
      : null,
    problems,
  }

  if (report.ok) {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(scores, null, 2)}\n`)
  }
  if (options.report) {
    writeFileSync(resolve(cwd, options.report), `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

export function validateScores(scores, problems = []) {
  if (scores.version !== 1) {
    problems.push('listening score version must be 1')
  }
  if (typeof scores.reviewer !== 'string' || scores.reviewer.trim().length === 0) {
    problems.push('human listening scores must include reviewer')
  }
  if (typeof scores.reviewedAt !== 'string' || scores.reviewedAt.trim().length === 0) {
    problems.push('human listening scores must include reviewedAt')
  }
  const decision = String(scores.decision ?? '').trim().toLowerCase()
  if (!PASSING_DECISIONS.has(decision)) {
    problems.push('human listening decision must be community-ready, release-ready, or pass')
  }
  if (scores.reviewEnvironment?.noRecordingRequired !== true) {
    problems.push('reviewEnvironment.noRecordingRequired must be true')
  }
  const thresholds = scores.thresholds ?? {}
  for (const [index, phrase] of (scores.phraseScores ?? []).entries()) {
    for (const key of SCORE_KEYS) {
      const score = phrase[key]
      const threshold = thresholds[`min${capitalize(key)}`] ?? 4
      if (typeof score !== 'number') {
        problems.push(`phrase ${phrase.id ?? index} ${key} must be scored`)
      } else if (score < threshold) {
        problems.push(`phrase ${phrase.id ?? index} ${key} ${score} is below ${threshold}`)
      }
    }
  }
  if (!Array.isArray(scores.phraseScores) || scores.phraseScores.length < 4) {
    problems.push('human listening scores must include at least four phrase scores')
  }
  for (const [index, comparison] of (scores.comparisonScores ?? []).entries()) {
    const score = comparison.v3PreferenceScore
    const threshold = thresholds.minV3PreferenceScore ?? 4
    if (typeof score !== 'number') {
      problems.push(`comparison ${comparison.id ?? index} v3PreferenceScore must be scored`)
    } else if (score < threshold) {
      problems.push(`comparison ${comparison.id ?? index} v3PreferenceScore ${score} is below ${threshold}`)
    }
  }
  if (!Array.isArray(scores.comparisonScores) || scores.comparisonScores.length < 4) {
    problems.push('human listening scores must include at least four V2/V3 comparison scores')
  }
  return problems
}

function readJson(path, problems) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(`scores file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function capitalize(text) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--scores') {
      options.scores = argv[++index]
    } else if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node scripts/accept-utau-v3-listening-scores.mjs --scores path [options]',
          '',
          'Options:',
          '  --scores path   Downloaded listening-scores.local.json from the review scorecard',
          `  --out path      Accepted score path, default ${DEFAULT_OUT}`,
          '  --report path   Optional JSON acceptance report',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = acceptUtauV3ListeningScores(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    process.exit(1)
  }
}
