#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_OUT = 'public/review/release-packet.json'
export const DEFAULT_REVIEW_MANIFEST = 'public/review/v3/review-manifest.json'
export const DEFAULT_BUNDLED_VOICEBANK = 'src/bundledVoicebank.ts'
export const DEFAULT_PAGES_URL = 'https://midagedev.github.io/webuta/'

export function buildReleaseReviewPacket(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const outPath = resolve(cwd, options.out ?? DEFAULT_OUT)
  const reviewManifestPath = resolve(cwd, options.reviewManifest ?? DEFAULT_REVIEW_MANIFEST)
  const bundledVoicebankPath = resolve(cwd, options.bundledVoicebank ?? DEFAULT_BUNDLED_VOICEBANK)
  const pagesUrl = normalizePagesUrl(options.pagesUrl ?? DEFAULT_PAGES_URL)
  const problems = []
  const reviewManifest = readJson(reviewManifestPath, 'public V3 listening review manifest', problems)
  const voicebank = readBundledVoicebank(bundledVoicebankPath, problems)

  if (reviewManifest) {
    if (reviewManifest.ok !== true || reviewManifest.decision !== 'v3-listening-review-ready') {
      problems.push('public V3 listening review manifest must be ready')
    }
    if ((reviewManifest.phraseCount ?? 0) < 4) {
      problems.push('release packet requires at least four V3 listening phrases')
    }
    if ((reviewManifest.comparisonCount ?? 0) < 4) {
      problems.push('release packet requires at least four legacy V2 comparison phrases')
    }
  }

  const packet = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'release-review-packet-ready' : 'release-review-packet-blocked',
    pagesUrl,
    reviewHubUrl: new URL('review/', pagesUrl).href,
    evidencePreflightUrl: new URL('review/#evidence-preflight', pagesUrl).href,
    listeningReviewUrl: new URL('review/v3/', pagesUrl).href,
    wavDawHandoffUrl: new URL('review/wav-daw/', pagesUrl).href,
    packetUrl: new URL('review/release-packet.json', pagesUrl).href,
    voicebank: {
      name: voicebank?.name ?? null,
      file: voicebank?.file ?? null,
      version: voicebank?.version ?? null,
      url: voicebank?.file && voicebank?.version ? voicebankUrl(pagesUrl, voicebank) : null,
      bundledByDefault: true,
      origin: 'self-generated synthetic UTAU sample voicebank',
      noRecordingRequired: true,
      kasaneTetoBundled: false,
    },
    requiredEvidence: [
      {
        id: 'human-listening',
        label: 'Human listening review scores',
        publicPage: 'review/v3/index.html',
        downloadFile: 'listening-scores.local.json',
        acceptedPath: 'experiments/utau-v3/work/v3-listening-review/listening-scores.local.json',
        requirement:
          'Score every V3 render and V2 comparison honestly after real listening, with playback device, blind lyric pass, and V2 comparison confirmations present.',
      },
      {
        id: 'wav-daw-handoff',
        label: 'Physical WAV and DAW import report',
        publicPage: 'review/wav-daw/index.html',
        downloadFile: 'handoff-report.local.json',
        acceptedPath: 'experiments/utau-v3/work/wav-daw-handoff/handoff-report.local.json',
        requirement: 'Export the default WAV from the public app, import it on a real device/music app, and confirm audible playback.',
      },
    ],
    reviewAudio: reviewAudioFromManifest(reviewManifest),
    commands: {
      status: 'npm run release:evidence-status',
      accept: 'npm run release:accept-evidence',
      audit: 'npm run release:audit-utau',
      explicitAccept:
        'npm run release:accept-evidence -- --scores path/to/listening-scores.local.json --handoff path/to/handoff-report.local.json',
    },
    checklist: [
      'Open the release review hub.',
      'Follow the Reviewer Runway in order: 01 Listen, 02 Handoff, 03 Preflight, 04 Status, 05 Accept.',
      'Complete the V3 listening scorecard from real playback, including the real playback, blind lyric pass, and V2 comparison confirmations, then download listening-scores.local.json.',
      'Complete the physical-device WAV/DAW handoff report, then download handoff-report.local.json.',
      'Keep both downloaded JSON files in Downloads.',
      'Use Evidence Preflight in the review hub to check both JSON files locally with no upload.',
      'Run npm run release:evidence-status.',
      'Run npm run release:accept-evidence.',
      'Run npm run release:audit-utau.',
    ],
    noRecordingRequired: true,
    problems,
  }

  if (options.write !== false) {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(packet, null, 2)}\n`)
  }
  return packet
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

function readBundledVoicebank(path, problems) {
  if (!existsSync(path)) {
    problems.push(`missing bundled voicebank metadata: ${path}`)
    return null
  }
  const text = readFileSync(path, 'utf8')
  const voicebank = {
    name: readExportedString(text, 'BUNDLED_UTAU_VOICEBANK_NAME') || readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_NAME'),
    file: readExportedString(text, 'BUNDLED_UTAU_VOICEBANK_FILE') || readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_FILE'),
    version:
      readExportedString(text, 'BUNDLED_UTAU_VOICEBANK_VERSION') ||
      readExportedString(text, 'BUNDLED_KOREAN_LITE_VOICEBANK_VERSION'),
  }
  for (const [key, value] of Object.entries(voicebank)) {
    if (!value) {
      problems.push(`bundled voicebank ${key} is missing`)
    }
  }
  return voicebank
}

function readExportedString(text, name) {
  const match = text.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`, 'u'))
  return match?.[1] ?? null
}

function reviewAudioFromManifest(manifest) {
  if (!manifest) {
    return []
  }
  return [
    ...audioItems(manifest.phrases ?? [], 'V3'),
    ...audioItems(manifest.comparisons ?? [], 'legacy V2'),
  ]
}

function audioItems(items, role) {
  return items.map((item, index) => ({
    role,
    id: item.id ?? `${role}-${index + 1}`,
    title: item.title ?? null,
    lyricLine: item.lyricLine ?? null,
    href: item.audioHref ?? item.wavPath ?? null,
    bytes: item.wav?.bytes ?? null,
    durationSeconds: item.wav?.durationSeconds ?? null,
    sampleRate: item.wav?.sampleRate ?? null,
    channels: item.wav?.channels ?? null,
    bitsPerSample: item.wav?.bitsPerSample ?? null,
  }))
}

function normalizePagesUrl(url) {
  const parsed = new URL(url)
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname += '/'
  }
  return parsed.href
}

function voicebankUrl(pagesUrl, voicebank) {
  const url = new URL(`voicebanks/${voicebank.file}`, pagesUrl)
  url.searchParams.set('v', voicebank.version)
  return url.href
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--review-manifest') {
      options.reviewManifest = argv[++index]
    } else if (arg === '--bundled-voicebank') {
      options.bundledVoicebank = argv[++index]
    } else if (arg === '--pages-url') {
      options.pagesUrl = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node scripts/build-release-review-packet.mjs [options]',
          '',
          'Options:',
          `  --out path               Output packet, default ${DEFAULT_OUT}`,
          `  --review-manifest path   Public V3 review manifest, default ${DEFAULT_REVIEW_MANIFEST}`,
          `  --bundled-voicebank path Bundled voicebank metadata, default ${DEFAULT_BUNDLED_VOICEBANK}`,
          `  --pages-url url          Public Pages URL, default ${DEFAULT_PAGES_URL}`,
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
  const report = buildReleaseReviewPacket(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    process.exit(1)
  }
}
