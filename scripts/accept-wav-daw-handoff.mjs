#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_OUT = 'experiments/utau-v3/work/wav-daw-handoff/handoff-report.local.json'
export const EXPECTED_REVIEW_ID = 'webuta-wav-daw-handoff-v1'
export const EXPECTED_DEFAULT_VOICEBANK = 'WebUtau Korean V3 Synthetic'

const PASSING_DECISIONS = new Set(['community-ready', 'release-ready', 'pass'])
const REQUIRED_ENVIRONMENT_FIELDS = ['device', 'osVersion', 'browser', 'targetDaw', 'webutaUrl']
const REQUIRED_CHECKS = [
  'openedFromPublicUrl',
  'defaultVoicebankSelected',
  'firstRunGuideVisible',
  'starterLyricInputVisible',
  'defaultLyricsMatched',
  'audioPreviewWorked',
  'wavExportWorked',
  'targetDawImportWorked',
  'targetDawPlaybackAudible',
  'browserDraftRestored',
  'noHorizontalOverflowPortrait',
  'userVoicebankPrivacyConfirmed',
]

export function acceptWavDawHandoff(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const sourcePath = options.handoff ? resolve(cwd, options.handoff) : null
  const outPath = resolve(cwd, options.out ?? DEFAULT_OUT)
  const problems = []

  if (!sourcePath) {
    problems.push('missing --handoff path')
  } else if (!existsSync(sourcePath)) {
    problems.push(`handoff report not found: ${sourcePath}`)
  }

  const handoff = problems.length === 0 ? readJson(sourcePath, problems) : null
  if (handoff) {
    validateHandoffReport(handoff, problems)
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'wav-daw-handoff-accepted' : 'wav-daw-handoff-rejected',
    sourcePath,
    outPath,
    summary: handoff
      ? {
          reviewer: handoff.reviewer ?? null,
          verifiedAt: handoff.verifiedAt ?? null,
          decision: handoff.decision ?? null,
          device: handoff.environment?.device ?? null,
          targetDaw: handoff.environment?.targetDaw ?? null,
          exportMethod: handoff.handoff?.exportMethod ?? null,
        }
      : null,
    problems,
  }

  if (report.ok) {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(handoff, null, 2)}\n`)
  }
  if (options.auditReport) {
    writeFileSync(resolve(cwd, options.auditReport), `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

export function validateHandoffReport(handoff, problems = []) {
  if (handoff.version !== 1) {
    problems.push('WAV DAW handoff version must be 1')
  }
  if (handoff.reviewId !== EXPECTED_REVIEW_ID) {
    problems.push(`WAV DAW handoff reviewId must be ${EXPECTED_REVIEW_ID}`)
  }
  if (typeof handoff.reviewer !== 'string' || handoff.reviewer.trim().length === 0) {
    problems.push('WAV DAW handoff must include reviewer')
  }
  if (typeof handoff.verifiedAt !== 'string' || handoff.verifiedAt.trim().length === 0) {
    problems.push('WAV DAW handoff must include verifiedAt')
  }
  const decision = String(handoff.decision ?? '').trim().toLowerCase()
  if (!PASSING_DECISIONS.has(decision)) {
    problems.push('WAV DAW handoff decision must be community-ready, release-ready, or pass')
  }
  if (handoff.physicalDevice !== true) {
    problems.push('WAV DAW handoff must be verified on a physical device')
  }
  if (handoff.defaultVoicebank !== EXPECTED_DEFAULT_VOICEBANK) {
    problems.push(`WAV DAW handoff defaultVoicebank must be ${EXPECTED_DEFAULT_VOICEBANK}`)
  }

  for (const field of REQUIRED_ENVIRONMENT_FIELDS) {
    if (typeof handoff.environment?.[field] !== 'string' || handoff.environment[field].trim().length === 0) {
      problems.push(`WAV DAW handoff environment.${field} is required`)
    }
  }
  if (!/^https:\/\/midagedev\.github\.io\/webuta\/?/u.test(String(handoff.environment?.webutaUrl ?? ''))) {
    problems.push('WAV DAW handoff webutaUrl must point to the public GitHub Pages app')
  }

  for (const key of REQUIRED_CHECKS) {
    if (handoff.checks?.[key] !== true) {
      problems.push(`WAV DAW handoff check ${key} must be true`)
    }
  }

  validateWav(handoff.renderedWav, problems)
  validateHandoffDetails(handoff.handoff, problems)
  validateHomeScreen(handoff.homeScreen, problems)
  return problems
}

function validateWav(wav, problems) {
  if (!wav || typeof wav !== 'object' || Array.isArray(wav)) {
    problems.push('WAV DAW handoff renderedWav metadata is required')
    return
  }
  if (wav.sampleRate !== 44100) {
    problems.push(`WAV DAW handoff renderedWav.sampleRate ${wav.sampleRate ?? 'missing'} must be 44100`)
  }
  if (wav.channels !== 1) {
    problems.push(`WAV DAW handoff renderedWav.channels ${wav.channels ?? 'missing'} must be 1`)
  }
  if (wav.bitsPerSample !== 16) {
    problems.push(`WAV DAW handoff renderedWav.bitsPerSample ${wav.bitsPerSample ?? 'missing'} must be 16`)
  }
  if (typeof wav.durationSeconds !== 'number' || wav.durationSeconds < 2) {
    problems.push('WAV DAW handoff renderedWav.durationSeconds must be at least 2')
  }
  if (!String(wav.fileName ?? '').endsWith('.wav')) {
    problems.push('WAV DAW handoff renderedWav.fileName must end with .wav')
  }
}

function validateHandoffDetails(handoff, problems) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    problems.push('WAV DAW handoff details are required')
    return
  }
  const method = String(handoff.exportMethod ?? '').trim().toLowerCase()
  if (!['share', 'download', 'files'].includes(method)) {
    problems.push('WAV DAW handoff exportMethod must be share, download, or files')
  }
  if (handoff.importedRegionVisible !== true) {
    problems.push('WAV DAW handoff importedRegionVisible must be true')
  }
  if (handoff.noConversionError !== true) {
    problems.push('WAV DAW handoff noConversionError must be true')
  }
}

function validateHomeScreen(homeScreen, problems) {
  const status = String(homeScreen?.status ?? '').trim().toLowerCase()
  if (!['pass', 'not-supported'].includes(status)) {
    problems.push('WAV DAW handoff homeScreen.status must be pass or not-supported')
  }
}

function readJson(path, problems) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(`handoff report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--handoff') {
      options.handoff = argv[++index]
    } else if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--report') {
      options.auditReport = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node scripts/accept-wav-daw-handoff.mjs --handoff path [options]',
          '',
          'Options:',
          '  --handoff path  Completed physical-device WAV/DAW handoff JSON',
          `  --out path      Accepted handoff path, default ${DEFAULT_OUT}`,
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
  const report = acceptWavDawHandoff(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    process.exit(1)
  }
}
