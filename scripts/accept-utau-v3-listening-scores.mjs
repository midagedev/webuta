#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_OUT = 'experiments/utau-v3/work/v3-listening-review/listening-scores.local.json'
export const EXPECTED_REVIEW_ID = 'webuta-ko-v3-synthetic-listening-review'
export const EXPECTED_PHRASE_SCORES = [
  ['first-run-demo', 'audio/01-first-run-demo.wav'],
  ['coda-release-check', 'audio/02-coda-release-check.wav'],
  ['clear-cv-line', 'audio/03-clear-cv-line.wav'],
  ['vowel-color-check', 'audio/04-vowel-color-check.wav'],
]
export const EXPECTED_COMPARISON_SCORES = [
  ['first-run-demo', 'audio/01-first-run-demo.wav', 'audio/legacy-v2/01-first-run-demo-legacy-v2.wav'],
  ['coda-release-check', 'audio/02-coda-release-check.wav', 'audio/legacy-v2/02-coda-release-check-legacy-v2.wav'],
  ['clear-cv-line', 'audio/03-clear-cv-line.wav', 'audio/legacy-v2/03-clear-cv-line-legacy-v2.wav'],
  ['vowel-color-check', 'audio/04-vowel-color-check.wav', 'audio/legacy-v2/04-vowel-color-check-legacy-v2.wav'],
]

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
  if (scores.reviewId !== EXPECTED_REVIEW_ID) {
    problems.push(`listening score reviewId must be ${EXPECTED_REVIEW_ID}`)
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
  if (typeof scores.reviewEnvironment?.playback !== 'string' || scores.reviewEnvironment.playback.trim().length === 0) {
    problems.push('reviewEnvironment.playback must describe the real playback device')
  }
  if (scores.reviewEnvironment?.realPlaybackConfirmed !== true) {
    problems.push('reviewEnvironment.realPlaybackConfirmed must be true')
  }
  if (scores.reviewEnvironment?.lyricBlindPassConfirmed !== true) {
    problems.push('reviewEnvironment.lyricBlindPassConfirmed must be true')
  }
  if (scores.reviewEnvironment?.v2ComparisonConfirmed !== true) {
    problems.push('reviewEnvironment.v2ComparisonConfirmed must be true')
  }
  validateExpectedPhraseScores(scores.phraseScores, problems)
  validateExpectedComparisonScores(scores.comparisonScores, problems)
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

function validateExpectedPhraseScores(phraseScores, problems) {
  const scoresById = mapById(phraseScores)
  const actualIds = Array.isArray(phraseScores) ? phraseScores.map((phrase) => phrase.id).sort() : []
  const expectedIds = EXPECTED_PHRASE_SCORES.map(([id]) => id).sort()
  if (actualIds.join('|') !== expectedIds.join('|')) {
    problems.push(`human listening phrase IDs must be exactly ${expectedIds.join(', ')}`)
  }
  for (const [id, wavPath] of EXPECTED_PHRASE_SCORES) {
    const score = scoresById.get(id)
    if (!score) {
      continue
    }
    if (score.wavPath !== wavPath) {
      problems.push(`phrase ${id} wavPath must be ${wavPath}`)
    }
  }
}

function validateExpectedComparisonScores(comparisonScores, problems) {
  const scoresById = mapById(comparisonScores)
  const actualIds = Array.isArray(comparisonScores) ? comparisonScores.map((comparison) => comparison.id).sort() : []
  const expectedIds = EXPECTED_COMPARISON_SCORES.map(([id]) => id).sort()
  if (actualIds.join('|') !== expectedIds.join('|')) {
    problems.push(`human listening comparison IDs must be exactly ${expectedIds.join(', ')}`)
  }
  for (const [id, v3WavPath, legacyV2WavPath] of EXPECTED_COMPARISON_SCORES) {
    const score = scoresById.get(id)
    if (!score) {
      continue
    }
    if (score.v3WavPath !== v3WavPath) {
      problems.push(`comparison ${id} v3WavPath must be ${v3WavPath}`)
    }
    if (score.legacyV2WavPath !== legacyV2WavPath) {
      problems.push(`comparison ${id} legacyV2WavPath must be ${legacyV2WavPath}`)
    }
  }
}

function mapById(items) {
  return new Map(Array.isArray(items) ? items.map((item) => [item.id, item]) : [])
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
