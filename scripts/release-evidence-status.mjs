#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PAGES_URL,
  HANDOFF_FILE_NAME,
  inspectReleaseEvidence,
  LISTENING_FILE_NAME,
  PUBLIC_REVIEW_URLS,
} from './accept-release-evidence.mjs'

export { inspectReleaseEvidence }

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
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node scripts/release-evidence-status.mjs [options]',
          '',
          'Checks final release evidence JSON files without copying them or running the release audit.',
          '',
          'Options:',
          `  --scores path        Downloaded ${LISTENING_FILE_NAME}; auto-detected from Downloads when omitted`,
          `  --handoff path       Downloaded ${HANDOFF_FILE_NAME}; auto-detected from Downloads when omitted`,
          '  --downloads-dir path Override the Downloads search folder',
          '  --listening-out path Accepted score path shown in the report',
          '  --handoff-out path   Accepted handoff path shown in the report',
          '  --report path        Optional JSON status report path',
          '',
          'Review pages:',
          `  Hub:       ${PUBLIC_REVIEW_URLS.hub}`,
          `  Preflight: ${PUBLIC_REVIEW_URLS.preflight}`,
          `  Listening: ${PUBLIC_REVIEW_URLS.listening}`,
          `  DAW:       ${PUBLIC_REVIEW_URLS.wavDawHandoff}`,
          `  App:       ${DEFAULT_PAGES_URL}`,
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
  const report = inspectReleaseEvidence(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    process.exit(1)
  }
}
