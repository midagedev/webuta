#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

export const DEFAULT_ARCHIVE =
  'experiments/neural-singer/datasets/zeroth-korean-speech/archives/zeroth_korean.tar.gz'
export const DEFAULT_OUTPUT = 'experiments/neural-singer/work/zeroth-korean-utau-preview/webuta-ko-zeroth-preview.zip'
export const DEFAULT_REPORT = 'experiments/neural-singer/work/zeroth-korean-utau-preview/plan.json'
export const ZEROTH_SOURCE_URL = 'https://www.openslr.org/40/'

export const CORE_TARGETS = [
  '도',
  '히',
  '다',
  '이',
  '스',
  '키',
  '가',
  '나',
  '라',
  '마',
  '바',
  '사',
  '아',
  '자',
  '차',
  '카',
  '타',
  '파',
  '하',
  '연',
]

const ROMAN_ALIASES = new Map([
  ['도', ['do']],
  ['히', ['hi']],
  ['다', ['da']],
  ['이', ['i']],
  ['스', ['seu', 'su']],
  ['키', ['ki']],
  ['가', ['ga', 'ka']],
  ['나', ['na']],
  ['라', ['ra', 'la']],
  ['마', ['ma']],
  ['바', ['ba']],
  ['사', ['sa']],
  ['아', ['a']],
  ['자', ['ja']],
  ['차', ['cha']],
  ['카', ['ka']],
  ['타', ['ta']],
  ['파', ['pa']],
  ['하', ['ha']],
  ['연', ['yeon']],
])

const ZIP_FILE_DATE = '2026-01-01T00:00:00.000Z'

export function createZerothUtauPlan(options = {}) {
  const archive = resolve(options.archive ?? DEFAULT_ARCHIVE)
  const targets = parseTargets(options.targets ?? CORE_TARGETS)
  const maxTranscripts = Number(options.maxTranscripts ?? 240)
  const singleSpeaker = options.singleSpeaker !== false
  if (!existsSync(archive)) {
    throw new Error(`Missing Zeroth-Korean archive: ${archive}`)
  }

  const archivePaths = listArchivePaths(archive)
  const audioByUtterance = indexAudioByUtterance(archivePaths)
  const transcriptPaths = archivePaths.filter((path) => path.endsWith('.trans.txt')).slice(0, maxTranscripts)
  const transcriptText = extractArchiveText(archive, transcriptPaths)
  const inventory = buildUtteranceInventory(transcriptText, audioByUtterance, targets)
  const selection = selectUtauCandidates(inventory, targets, { singleSpeaker })
  const coverage = {
    targetCount: targets.length,
    selectedCount: selection.selected.length,
    missing: selection.missing,
    selectedAliases: selection.selected.map((candidate) => candidate.alias),
    singleSpeaker,
    speakerKey: selection.speakerKey,
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'openslr:zeroth-korean',
    sourceUrl: ZEROTH_SOURCE_URL,
    licenseStatus: 'cc-by-4.0-attribution-required',
    releaseMode: 'source-derived-utau-preview',
    archive,
    scanned: {
      archivePathCount: archivePaths.length,
      transcriptPathCount: transcriptPaths.length,
      utteranceCandidateCount: inventory.length,
    },
    coverage,
    selected: selection.selected,
    warnings: warningsForPlan(coverage),
    nextActions: [
      'Run with --accept-cc-by to generate a zip after accepting CC BY 4.0 attribution obligations.',
      'Listen to every selected sample before bundling it as a default voicebank.',
      'Treat this as a license-clean speech-derived preview, not a production singing bank.',
    ],
  }
}

export async function generateZerothUtauPreview(options = {}) {
  assertCcByAccepted(options)
  const plan = options.plan ?? createZerothUtauPlan(options)
  if (plan.selected.length === 0) {
    throw new Error('No matching Zeroth-Korean utterances were selected for the requested aliases.')
  }
  const output = resolve(options.output ?? DEFAULT_OUTPUT)
  const sampleMs = Number(options.sampleMs ?? 920)
  const tmp = mkdtempSync(join(tmpdir(), 'webuta-zeroth-utau-'))
  try {
    const extractedRoot = join(tmp, 'source')
    mkdirSync(extractedRoot, { recursive: true })
    extractArchiveFiles(plan.archive, extractedRoot, [...new Set(plan.selected.map((candidate) => candidate.audioPath))])

    const zip = new JSZip()
    const otoLines = []
    const sampleReports = []
    for (const [index, candidate] of plan.selected.entries()) {
      const safeAlias = safeName(candidate.alias)
      const fileName = `ko_zeroth_${String(index).padStart(3, '0')}_${safeAlias}_C4.wav`
      const sourcePath = join(extractedRoot, candidate.audioPath)
      const wavPath = join(tmp, fileName)
      convertSpeechHeadToUtauSample(sourcePath, wavPath, { sampleMs })
      zip.file(`samples/${fileName}`, readFileSync(wavPath), zipFileOptions())
      for (const alias of aliasesFor(candidate.alias)) {
        otoLines.push(`${fileName}=${alias},0,150,-${Math.max(220, sampleMs - 150)},55,20`)
      }
      sampleReports.push({
        alias: candidate.alias,
        fileName: `samples/${fileName}`,
        utteranceId: candidate.utteranceId,
        speakerKey: candidate.speakerKey,
        sourceText: candidate.text,
        sourceAudioPath: candidate.audioPath,
      })
    }

    const manifest = {
      id: 'webuta-ko-zeroth-preview',
      name: 'WebUtau Korean Zeroth Preview',
      type: 'source-derived-utau-cv-preview',
      source: 'OpenSLR Zeroth-Korean',
      sourceUrl: ZEROTH_SOURCE_URL,
      license: 'CC BY 4.0; attribution required',
      sampleCount: sampleReports.length,
      aliasCount: otoLines.length,
      coverage: plan.coverage,
      samples: sampleReports,
      warnings: plan.warnings,
    }

    zip.file('oto.ini', `${otoLines.join('\r\n')}\r\n`, zipFileOptions())
    zip.file(
      'character.yaml',
      [
        'name: WebUtau Korean Zeroth Preview',
        'text_file_encoding: utf-8',
        'author: WebUtau Project',
        `web: ${ZEROTH_SOURCE_URL}`,
        '',
      ].join('\n'),
      zipFileOptions(),
    )
    zip.file(
      'readme.txt',
      [
        'WebUtau Korean Zeroth Preview',
        '',
        'This is a speech-derived UTAU-style preview voicebank built from OpenSLR Zeroth-Korean.',
        'It is intended to test a legally cleaner source-derived sample path, not to represent final singing quality.',
        'Review every WAV before bundling it in the public app.',
        '',
      ].join('\r\n'),
      zipFileOptions(),
    )
    zip.file(
      'license.txt',
      [
        'WebUtau Korean Zeroth Preview voicebank',
        '',
        'Source dataset: OpenSLR SLR40 Zeroth-Korean',
        `Source URL: ${ZEROTH_SOURCE_URL}`,
        'Source license: Creative Commons Attribution 4.0 International (CC BY 4.0).',
        '',
        'This derived preview pack must preserve attribution to the source dataset.',
        'It should not be described as CC0 or no-obligation license-free material.',
        '',
      ].join('\r\n'),
      zipFileOptions(),
    )
    zip.file('webuta-ko-zeroth-preview.manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, zipFileOptions())

    mkdirSync(dirname(output), { recursive: true })
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    writeFileSync(output, bytes)
    return {
      ...plan,
      output,
      outputSha256: sha256(bytes),
      outputBytes: bytes.length,
      manifest,
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function assertCcByAccepted(options = {}) {
  if (options.acceptCcBy !== true) {
    throw new Error('Refusing to generate a derived Zeroth-Korean zip without --accept-cc-by.')
  }
}

export function buildUtteranceInventory(transcriptText, audioByUtterance, targets = CORE_TARGETS) {
  const targetSet = new Set(targets)
  const candidates = []
  for (const line of transcriptText.split(/\r?\n/u)) {
    const match = line.match(/^(\S+)\s+(.+)$/u)
    if (!match) {
      continue
    }
    const [, utteranceId, text] = match
    const alias = firstHangulSyllable(text)
    const audioPath = audioByUtterance.get(utteranceId)
    if (!targetSet.has(alias) || !audioPath) {
      continue
    }
    candidates.push({
      alias,
      utteranceId,
      text: text.trim(),
      audioPath,
      speakerKey: speakerKeyFromAudioPath(audioPath),
      match: 'utterance-initial-syllable',
    })
  }
  return candidates
}

export function selectUtauCandidates(inventory, targets = CORE_TARGETS, options = {}) {
  const targetSet = new Set(targets)
  const singleSpeaker = options.singleSpeaker !== false
  if (!singleSpeaker) {
    const selected = firstByAlias(inventory, targetSet)
    return {
      selected,
      missing: targets.filter((target) => !selected.some((candidate) => candidate.alias === target)),
      speakerKey: selected.length > 0 ? 'mixed-speaker-preview' : null,
    }
  }

  const bySpeaker = new Map()
  for (const candidate of inventory) {
    if (!bySpeaker.has(candidate.speakerKey)) {
      bySpeaker.set(candidate.speakerKey, [])
    }
    bySpeaker.get(candidate.speakerKey).push(candidate)
  }
  let bestSpeaker = null
  let bestSelected = []
  for (const [speakerKey, candidates] of bySpeaker) {
    const selected = firstByAlias(candidates, targetSet)
    if (
      selected.length > bestSelected.length ||
      (selected.length === bestSelected.length && speakerKey.localeCompare(bestSpeaker ?? '') < 0)
    ) {
      bestSpeaker = speakerKey
      bestSelected = selected
    }
  }
  return {
    selected: bestSelected,
    missing: targets.filter((target) => !bestSelected.some((candidate) => candidate.alias === target)),
    speakerKey: bestSpeaker,
  }
}

function listArchivePaths(archive) {
  return execFileSync('tar', ['-tf', archive], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split(/\r?\n/u)
    .filter(Boolean)
}

function indexAudioByUtterance(paths) {
  const audioByUtterance = new Map()
  for (const path of paths) {
    const match = path.match(/([^/]+)\.flac$/u)
    if (match) {
      audioByUtterance.set(match[1], path)
    }
  }
  return audioByUtterance
}

function extractArchiveText(archive, paths) {
  if (paths.length === 0) {
    return ''
  }
  const chunks = []
  const chunkSize = 160
  for (let start = 0; start < paths.length; start += chunkSize) {
    const chunk = paths.slice(start, start + chunkSize)
    chunks.push(
      execFileSync('tar', ['-xOf', archive, ...chunk], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    )
  }
  return chunks.join('\n')
}

function extractArchiveFiles(archive, outDir, paths) {
  if (paths.length === 0) {
    return
  }
  execFileSync('tar', ['-xf', archive, '-C', outDir, ...paths], {
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  })
}

function convertSpeechHeadToUtauSample(sourcePath, wavPath, options = {}) {
  const seconds = Math.max(0.25, Number(options.sampleMs ?? 920) / 1000)
  const fadeOutStart = Math.max(0, seconds - 0.08)
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-ac',
      '1',
      '-ar',
      '44100',
      '-af',
      [
        'silenceremove=start_periods=1:start_duration=0.01:start_threshold=-42dB',
        `atrim=0:${seconds.toFixed(3)}`,
        'asetpts=N/SR/TB',
        'afade=t=in:st=0:d=0.01',
        `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.08`,
        'loudnorm=I=-20:TP=-3:LRA=8',
      ].join(','),
      wavPath,
    ],
    { stdio: 'pipe' },
  )
}

function firstByAlias(candidates, targetSet) {
  const selected = []
  const seen = new Set()
  for (const candidate of candidates) {
    if (targetSet.has(candidate.alias) && !seen.has(candidate.alias)) {
      selected.push(candidate)
      seen.add(candidate.alias)
    }
  }
  return selected
}

function parseTargets(targets) {
  if (Array.isArray(targets)) {
    return targets
  }
  return String(targets)
    .split(',')
    .map((target) => target.trim())
    .filter(Boolean)
}

function firstHangulSyllable(text) {
  return text.trim().match(/[가-힣]/u)?.[0] ?? ''
}

function speakerKeyFromAudioPath(path) {
  const parts = path.split('/')
  return parts.length >= 3 ? parts.slice(0, -1).join('/') : 'unknown'
}

function aliasesFor(alias) {
  return [alias, ...(ROMAN_ALIASES.get(alias) ?? [])]
}

function safeName(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 40)
}

function zipFileOptions() {
  return { date: new Date(ZIP_FILE_DATE) }
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

function warningsForPlan(coverage) {
  const warnings = [
    'Zeroth-Korean is a speech corpus, so these samples are pronunciation/source-license probes rather than polished singing vowels.',
    'The script crops utterance-initial speech. It does not perform forced alignment or pitch normalization yet.',
  ]
  if (coverage.missing.length > 0) {
    warnings.push(`Missing requested aliases: ${coverage.missing.join(', ')}`)
  }
  if (!coverage.singleSpeaker) {
    warnings.push('Mixed-speaker output is useful for coverage tests only and should not become a default singer.')
  }
  return warnings
}

async function main(argv) {
  const options = parseArgs(argv)
  const plan = createZerothUtauPlan(options)
  const reportPath = resolve(options.report ?? DEFAULT_REPORT)
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(plan, null, 2)}\n`)
  if (options.planOnly) {
    console.log(`Wrote ${reportPath}`)
    console.log(`Selected ${plan.coverage.selectedCount}/${plan.coverage.targetCount} aliases`)
    return
  }
  const result = await generateZerothUtauPreview({ ...options, plan })
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`Wrote ${result.output} (${result.outputBytes} bytes)`)
  console.log(`Selected ${result.coverage.selectedCount}/${result.coverage.targetCount} aliases`)
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--archive') {
      options.archive = argv[++index]
    } else if (arg === '--out') {
      options.output = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--targets') {
      options.targets = argv[++index]
    } else if (arg === '--max-transcripts') {
      options.maxTranscripts = Number(argv[++index])
    } else if (arg === '--sample-ms') {
      options.sampleMs = Number(argv[++index])
    } else if (arg === '--multi-speaker') {
      options.singleSpeaker = false
    } else if (arg === '--accept-cc-by') {
      options.acceptCcBy = true
    } else if (arg === '--plan-only') {
      options.planOnly = true
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/generate-zeroth-korean-utau-preview.mjs [options]',
          '',
          'Options:',
          '  --archive path          Zeroth-Korean tar.gz archive',
          '  --out path              Output UTAU zip path',
          '  --report path           JSON plan/report path',
          '  --targets 가,나,다      Comma-separated Hangul aliases',
          '  --max-transcripts n     Transcript files to scan, default 240',
          '  --sample-ms n           Cropped source sample length, default 920',
          '  --multi-speaker         Fill aliases from multiple speakers for preview coverage',
          '  --plan-only             Write only the source-selection plan',
          '  --accept-cc-by          Required before writing derived WAV/zip output',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
