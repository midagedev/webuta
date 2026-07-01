#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import {
  DEFAULT_OUT as DEFAULT_LISTENING_OUT,
  validateScores as validateListeningScores,
} from './accept-utau-v3-listening-scores.mjs'
import {
  DEFAULT_OUT as DEFAULT_HANDOFF_OUT,
  validateHandoffReport,
} from './accept-wav-daw-handoff.mjs'
import { auditUtauCommunityRelease } from './audit-utau-community-release.mjs'

export const DEFAULT_PAGES_URL = 'https://midagedev.github.io/webuta/'
export const LISTENING_FILE_NAME = 'listening-scores.local.json'
export const HANDOFF_FILE_NAME = 'handoff-report.local.json'
export const PUBLIC_REVIEW_URLS = {
  hub: 'https://midagedev.github.io/webuta/review/',
  listening: 'https://midagedev.github.io/webuta/review/v3/',
  wavDawHandoff: 'https://midagedev.github.io/webuta/review/wav-daw/',
}

export function inspectReleaseEvidence(options = {}) {
  const { cwd, listeningOut, handoffOut, listening, handoff, problems } = collectReleaseEvidence(options)
  const ok = problems.length === 0
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok,
    decision: ok ? 'release-evidence-ready' : 'release-evidence-missing',
    listening: summarizeEvidenceStatus(listening, listeningOut),
    wavDawHandoff: summarizeEvidenceStatus(handoff, handoffOut),
    problems,
    nextActions: evidenceStatusNextActions({ ok }),
  }
  if (options.report) {
    writeJson(resolve(cwd, options.report), report)
  }
  return report
}

export async function acceptReleaseEvidence(options = {}) {
  const { cwd, listeningOut, handoffOut, listening, handoff, problems } = collectReleaseEvidence(options)
  let audit = null

  if (problems.length === 0) {
    writeJson(listeningOut, listening.data)
    writeJson(handoffOut, handoff.data)
    if (!options.skipAudit) {
      audit = await auditUtauCommunityRelease({
        cwd,
        pagesUrl: options.pagesUrl ?? DEFAULT_PAGES_URL,
        pagesReport: options.pagesReport,
        report: options.auditReport,
        listeningScores: options.listeningOut ?? DEFAULT_LISTENING_OUT,
        wavDawHandoff: options.handoffOut ?? DEFAULT_HANDOFF_OUT,
      })
      if (!audit.ok) {
        problems.push('release-audit: accepted evidence, but release audit is still blocked')
      }
    }
  }

  const ok = problems.length === 0
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok,
    decision: ok ? 'release-evidence-accepted' : 'release-evidence-rejected',
    listening: summarizeEvidence(listening, listeningOut),
    wavDawHandoff: summarizeEvidence(handoff, handoffOut),
    audit: audit ? summarizeAudit(audit) : null,
    problems,
    nextActions: nextActions({ ok, skipAudit: options.skipAudit, audit }),
  }
  if (options.report) {
    writeJson(resolve(cwd, options.report), report)
  }
  return report
}

function collectReleaseEvidence(options) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const downloadsDir = options.downloadsDir ? resolve(cwd, options.downloadsDir) : null
  const listeningOut = resolve(cwd, options.listeningOut ?? DEFAULT_LISTENING_OUT)
  const handoffOut = resolve(cwd, options.handoffOut ?? DEFAULT_HANDOFF_OUT)
  const listening = readAndValidateEvidence({
    cwd,
    explicitPath: options.scores,
    downloadsDir,
    fileName: LISTENING_FILE_NAME,
    label: 'human listening scores',
    validate: validateListeningScores,
  })
  const handoff = readAndValidateEvidence({
    cwd,
    explicitPath: options.handoff,
    downloadsDir,
    fileName: HANDOFF_FILE_NAME,
    label: 'physical WAV DAW handoff report',
    validate: validateHandoffReport,
  })
  const problems = [
    ...listening.problems.map((problem) => `human-listening: ${problem}`),
    ...handoff.problems.map((problem) => `wav-daw-handoff: ${problem}`),
  ]
  return {
    cwd,
    listeningOut,
    handoffOut,
    listening,
    handoff,
    problems,
  }
}

function readAndValidateEvidence({ cwd, explicitPath, downloadsDir, fileName, label, validate }) {
  const sourcePath = explicitPath
    ? resolve(cwd, explicitPath)
    : findDownloadedEvidence(cwd, fileName, downloadsDir)
  const problems = []
  let data = null
  if (!sourcePath) {
    problems.push(`missing ${fileName}; pass --${fileName === LISTENING_FILE_NAME ? 'scores' : 'handoff'} path or place it in Downloads`)
  } else if (!existsSync(sourcePath)) {
    problems.push(`${label} file not found: ${sourcePath}`)
  } else {
    data = readJson(sourcePath, label, problems)
    if (data) {
      validate(data, problems)
    }
  }
  return {
    sourcePath,
    data,
    problems,
  }
}

function findDownloadedEvidence(cwd, fileName, downloadsDir) {
  const dirs = [
    downloadsDir,
    resolve(cwd, 'downloads'),
    resolve(cwd, 'Downloads'),
    resolve(homedir(), 'Downloads'),
  ].filter(Boolean)
  for (const dir of dirs) {
    const match = newestMatchingFile(dir, fileName)
    if (match) {
      return match
    }
  }
  return null
}

function newestMatchingFile(dir, fileName) {
  if (!existsSync(dir)) {
    return null
  }
  const ext = extname(fileName)
  const base = fileName.slice(0, -ext.length)
  const pattern = new RegExp(`^${escapeRegExp(base)}(?: \\(\\d+\\))?${escapeRegExp(ext)}$`, 'u')
  const matches = readdirSync(dir)
    .filter((entry) => pattern.test(entry))
    .map((entry) => {
      const path = join(dir, entry)
      return { path, mtimeMs: statSync(path).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return matches[0]?.path ?? null
}

function readJson(path, label, problems) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

function summarizeEvidence(evidence, outPath) {
  return {
    sourcePath: evidence.sourcePath,
    outPath,
    accepted: evidence.problems.length === 0,
    problems: evidence.problems,
  }
}

function summarizeEvidenceStatus(evidence, outPath) {
  return {
    found: Boolean(evidence.sourcePath),
    valid: Boolean(evidence.sourcePath && evidence.problems.length === 0),
    sourcePath: evidence.sourcePath,
    outPath,
    problems: evidence.problems,
  }
}

function summarizeAudit(audit) {
  return {
    ok: audit.ok,
    decision: audit.decision,
    problems: audit.problems,
  }
}

function evidenceStatusNextActions({ ok }) {
  if (ok) {
    return [
      'Both release evidence JSON files are found and valid. Run npm run release:accept-evidence to install them atomically and rerun the final release audit.',
    ]
  }
  return [
    `Open the release review hub at ${PUBLIC_REVIEW_URLS.hub}.`,
    `Download ${LISTENING_FILE_NAME} from ${PUBLIC_REVIEW_URLS.listening}.`,
    `Download ${HANDOFF_FILE_NAME} from ${PUBLIC_REVIEW_URLS.wavDawHandoff} after a real physical-device WAV/DAW import pass.`,
    'Keep both files in Downloads, then run npm run release:evidence-status before npm run release:accept-evidence.',
  ]
}

function nextActions({ ok, skipAudit, audit }) {
  if (!ok) {
    return [
      `Download fresh ${LISTENING_FILE_NAME} and ${HANDOFF_FILE_NAME} from the public review pages, then rerun npm run release:accept-evidence.`,
    ]
  }
  if (skipAudit) {
    return ['Run npm run release:audit-utau to verify the final community release gate.']
  }
  if (audit?.ok) {
    return ['Community release gate passed. Keep the accepted evidence files with the release artifacts.']
  }
  return ['Fix the release audit problems above, then rerun npm run release:audit-utau.']
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--scores') {
      options.scores = argv[++index]
    } else if (arg === '--handoff') {
      options.handoff = argv[++index]
    } else if (arg === '--downloads-dir') {
      options.downloadsDir = argv[++index]
    } else if (arg === '--listening-out') {
      options.listeningOut = argv[++index]
    } else if (arg === '--handoff-out') {
      options.handoffOut = argv[++index]
    } else if (arg === '--pages-url') {
      options.pagesUrl = argv[++index]
    } else if (arg === '--pages-report') {
      options.pagesReport = argv[++index]
    } else if (arg === '--audit-report') {
      options.auditReport = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--skip-audit') {
      options.skipAudit = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node scripts/accept-release-evidence.mjs [options]',
          '',
          'Options:',
          `  --scores path        Downloaded ${LISTENING_FILE_NAME}; auto-detected from Downloads when omitted`,
          `  --handoff path       Downloaded ${HANDOFF_FILE_NAME}; auto-detected from Downloads when omitted`,
          '  --downloads-dir path Override the Downloads search folder',
          `  --listening-out path Accepted score path, default ${DEFAULT_LISTENING_OUT}`,
          `  --handoff-out path   Accepted handoff path, default ${DEFAULT_HANDOFF_OUT}`,
          `  --pages-url url      Pages URL for final audit, default ${DEFAULT_PAGES_URL}`,
          '  --pages-report path  Use existing Pages evidence JSON instead of live fetch',
          '  --audit-report path  Optional release audit JSON path',
          '  --report path        Optional acceptance JSON report path',
          '  --skip-audit         Accept files without running the final release audit',
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
  const report = await acceptReleaseEvidence(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    process.exit(1)
  }
}
