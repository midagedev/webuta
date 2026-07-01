#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

export const DEFAULT_OUT = 'public/review/release-review-bundle.zip'
export const DEFAULT_PACKET = 'public/review/release-packet.json'
export const DEFAULT_PUBLIC_REVIEW = 'public/review'

export async function buildReleaseReviewBundle(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const outPath = resolve(cwd, options.out ?? DEFAULT_OUT)
  const packetPath = resolve(cwd, options.packet ?? DEFAULT_PACKET)
  const publicReviewDir = resolve(cwd, options.publicReview ?? DEFAULT_PUBLIC_REVIEW)
  const problems = []
  const packet = readJson(packetPath, 'release review packet', problems)
  validatePacket(packet, problems)

  const zip = new JSZip()
  const files = []
  addText(zip, files, 'webuta-release-review/README.md', renderReadme(packet))
  addFile(zip, files, packetPath, 'webuta-release-review/release-packet.json', problems)
  addFile(zip, files, join(publicReviewDir, 'index.html'), 'webuta-release-review/review/index.html', problems)
  addFile(zip, files, join(publicReviewDir, 'wav-daw', 'index.html'), 'webuta-release-review/review/wav-daw/index.html', problems)
  for (const relativePath of ['index.html', 'README.md', 'listening-scores.local.template.json', 'review-manifest.json']) {
    addFile(zip, files, join(publicReviewDir, 'v3', relativePath), `webuta-release-review/review/v3/${relativePath}`, problems)
  }
  for (const audio of packet?.reviewAudio ?? []) {
    if (typeof audio.href !== 'string' || audio.href.trim().length === 0) {
      problems.push(`release review packet audio ${audio.id ?? 'unknown'} is missing href`)
      continue
    }
    addFile(zip, files, join(publicReviewDir, 'v3', audio.href), `webuta-release-review/review/v3/${audio.href}`, problems)
  }
  addFile(zip, files, resolve(cwd, 'docs/WAV_DAW_QA.md'), 'webuta-release-review/docs/WAV_DAW_QA.md', problems)
  addFile(zip, files, resolve(cwd, 'docs/LICENSE_BOUNDARIES.md'), 'webuta-release-review/docs/LICENSE_BOUNDARIES.md', problems)

  if (problems.length > 0) {
    return makeReport({ outPath, packet, files: [], bytes: 0, problems })
  }

  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, bytes)
  return makeReport({ outPath, packet, files, bytes: bytes.byteLength, problems: [] })
}

function readJson(path, label, problems) {
  if (!existsSync(path)) {
    problems.push(`missing ${label}: ${path}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function validatePacket(packet, problems) {
  if (!packet) {
    return
  }
  if (packet.ok !== true || packet.decision !== 'release-review-packet-ready') {
    problems.push('release review packet must be ready before bundling')
  }
  const evidenceFiles = new Set((packet.requiredEvidence ?? []).map((item) => item.downloadFile))
  for (const fileName of ['listening-scores.local.json', 'handoff-report.local.json']) {
    if (!evidenceFiles.has(fileName)) {
      problems.push(`release review packet must require ${fileName}`)
    }
  }
  if (!Array.isArray(packet.reviewAudio) || packet.reviewAudio.length < 8) {
    problems.push('release review packet must include at least eight review audio files')
  }
  if (packet.noRecordingRequired !== true || packet.voicebank?.noRecordingRequired !== true) {
    problems.push('release review packet must keep noRecordingRequired true')
  }
}

function addFile(zip, files, sourcePath, targetPath, problems) {
  if (!existsSync(sourcePath)) {
    problems.push(`missing bundle file: ${sourcePath}`)
    return
  }
  const bytes = readFileSync(sourcePath)
  zip.file(targetPath, bytes)
  files.push({
    path: targetPath,
    sourcePath,
    bytes: statSync(sourcePath).size,
  })
}

function addText(zip, files, targetPath, text) {
  zip.file(targetPath, text)
  files.push({
    path: targetPath,
    sourcePath: null,
    bytes: Buffer.byteLength(text),
  })
}

function renderReadme(packet) {
  return [
    '# WebUtau Release Review Bundle',
    '',
    'This bundle is an offline reviewer handoff for the WebUtau Korean V3 Synthetic community release.',
    '',
    'It does not ask anyone to record a voice. Review only the generated synthetic V3 WAVs and the physical WAV/DAW import result.',
    '',
    '## Public Links',
    '',
    `- App: ${packet?.pagesUrl ?? 'https://midagedev.github.io/webuta/'}`,
    `- Review hub: ${packet?.reviewHubUrl ?? 'https://midagedev.github.io/webuta/review/'}`,
    `- Listening scorecard: ${packet?.listeningReviewUrl ?? 'https://midagedev.github.io/webuta/review/v3/'}`,
    `- WAV/DAW handoff: ${packet?.wavDawHandoffUrl ?? 'https://midagedev.github.io/webuta/review/wav-daw/'}`,
    '',
    '## Required Evidence',
    '',
    '- `listening-scores.local.json`: generated only after real phrase-by-phrase listening.',
    '- `handoff-report.local.json`: generated only after a real physical-device WAV/DAW import pass.',
    '',
    `Use Evidence Preflight in the public review hub (${packet?.evidencePreflightUrl ?? 'https://midagedev.github.io/webuta/review/#evidence-preflight'}) to check both downloaded JSON files locally with no upload.`,
    '',
    'Keep both downloaded JSON files in Downloads, then run:',
    '',
    '```sh',
    'npm run release:evidence-status',
    'npm run release:accept-evidence',
    'npm run release:audit-utau',
    '```',
    '',
    '## Included Files',
    '',
    '- `release-packet.json`: machine-readable release packet.',
    '- `review/v3/index.html`: listening scorecard.',
    '- `review/v3/audio/`: V3 and legacy V2 comparison WAVs.',
    '- `review/wav-daw/index.html`: physical-device handoff report builder.',
    '- `docs/WAV_DAW_QA.md`: physical-device checklist.',
    '- `docs/LICENSE_BOUNDARIES.md`: bundled voicebank and third-party asset boundaries.',
    '',
  ].join('\n')
}

function makeReport({ outPath, packet, files, bytes, problems }) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'release-review-bundle-ready' : 'release-review-bundle-blocked',
    outPath,
    bytes,
    packetDecision: packet?.decision ?? null,
    fileCount: files.length,
    files: files.map(({ path, bytes }) => ({ path, bytes })),
    problems,
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--packet') {
      options.packet = argv[++index]
    } else if (arg === '--public-review') {
      options.publicReview = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node scripts/build-release-review-bundle.mjs [options]',
          '',
          'Options:',
          `  --out path           Output ZIP, default ${DEFAULT_OUT}`,
          `  --packet path        Release packet JSON, default ${DEFAULT_PACKET}`,
          `  --public-review path Public review directory, default ${DEFAULT_PUBLIC_REVIEW}`,
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
  const report = await buildReleaseReviewBundle(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    process.exit(1)
  }
}
