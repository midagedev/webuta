#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_REGISTRY = 'experiments/neural-singer/dataset-registry.example.json'
const AUDIO_EXTENSIONS = new Set(['.wav', '.flac', '.mp3', '.ogg', '.m4a', '.aac'])
const METADATA_EXTENSIONS = new Set(['.csv', '.json'])
const GUIDE_DIR_NAMES = new Set(['guides', 'guide-tracks'])

export function materializeNeuralDatasetSidecars(options = {}) {
  const registryPath = resolve(options.registry ?? DEFAULT_REGISTRY)
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : null
  const dataset = findDataset(registry, options.dataset)
  if (!dataset && !options.localPath) {
    throw new Error('Missing --dataset or --local-path.')
  }
  const datasetRoot = resolve(options.localPath ?? dataset.localPath)
  if (!existsSync(datasetRoot)) {
    throw new Error(`Dataset localPath does not exist: ${datasetRoot}`)
  }

  const audioFiles = findTrainingAudioFiles(datasetRoot)
  const audioIndex = buildAudioIndex(datasetRoot, audioFiles)
  const metadataFiles = metadataInputFiles(datasetRoot, options.metadataFiles, audioIndex)
  const groups = new Map()
  const unmatchedRows = []
  const ambiguousRows = []
  const parsedFiles = []

  for (const metadataFile of metadataFiles) {
    const rows = parseMetadataRows(metadataFile.path)
    parsedFiles.push({
      path: relative(datasetRoot, metadataFile.path),
      extension: extname(metadataFile.path).toLowerCase(),
      rowCount: rows.length,
    })
    for (const row of rows) {
      const match = matchAudio(row.audioRef, audioIndex)
      if (match.status === 'matched') {
        const existing = groups.get(match.audio.path) ?? {
          audio: match.audio,
          rows: [],
        }
        existing.rows.push({
          ...row,
          sourceMetadata: relative(datasetRoot, metadataFile.path),
        })
        groups.set(match.audio.path, existing)
      } else if (match.status === 'ambiguous') {
        ambiguousRows.push({
          sourceMetadata: relative(datasetRoot, metadataFile.path),
          sourceRow: row.sourceRow,
          audioRef: row.audioRef,
          candidates: match.candidates.map((candidate) => relative(datasetRoot, candidate.path)),
        })
      } else {
        unmatchedRows.push({
          sourceMetadata: relative(datasetRoot, metadataFile.path),
          sourceRow: row.sourceRow,
          audioRef: row.audioRef,
          lyric: row.lyric,
        })
      }
    }
  }

  const dryRun = options.dryRun === true
  const overwrite = options.overwrite === true
  const sidecars = []
  let writtenCount = 0
  let skippedExistingCount = 0
  for (const group of [...groups.values()].sort((a, b) => a.audio.path.localeCompare(b.audio.path))) {
    const sidecarPath = sidecarOutputPath(datasetRoot, group.audio.path, options.outDir)
    const exists = existsSync(sidecarPath)
    const action = exists && !overwrite ? 'skipped-existing' : dryRun ? 'dry-run' : 'written'
    if (action === 'written') {
      mkdirSync(dirname(sidecarPath), { recursive: true })
      writeFileSync(sidecarPath, csvRows(sidecarRows(group.rows)))
      writtenCount += 1
    } else if (action === 'skipped-existing') {
      skippedExistingCount += 1
    }
    sidecars.push({
      audio: relative(datasetRoot, group.audio.path),
      sidecar: relative(datasetRoot, sidecarPath),
      action,
      rowCount: group.rows.length,
      lyricCount: group.rows.filter((row) => row.lyric).length,
      timingCount: group.rows.filter((row) => row.startSeconds !== null || row.durationSeconds !== null || row.endSeconds !== null).length,
      pitchCount: group.rows.filter((row) => row.midi !== null || row.pitchHz !== null).length,
    })
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    registryPath,
    datasetId: dataset?.id ?? null,
    datasetRoot,
    dryRun,
    overwrite,
    metadataFiles: parsedFiles,
    audio: {
      trainingFileCount: audioFiles.length,
    },
    rows: {
      matchedAudioCount: groups.size,
      matchedRowCount: [...groups.values()].reduce((sum, group) => sum + group.rows.length, 0),
      unmatchedCount: unmatchedRows.length,
      ambiguousCount: ambiguousRows.length,
      unmatchedSamples: unmatchedRows.slice(0, 24),
      ambiguousSamples: ambiguousRows.slice(0, 24),
    },
    sidecars: {
      writtenCount,
      skippedExistingCount,
      plannedCount: sidecars.length,
      entries: sidecars,
    },
    nextCommands: nextCommands(dataset, registryPath),
  }

  if (options.report) {
    const reportPath = resolve(options.report)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

function findDataset(registry, datasetId) {
  if (!datasetId) {
    return null
  }
  const datasets = Array.isArray(registry?.datasets) ? registry.datasets : []
  const dataset = datasets.find((entry) => entry.id === datasetId)
  if (!dataset) {
    throw new Error(`Dataset not found in registry: ${datasetId}`)
  }
  return dataset
}

function metadataInputFiles(root, explicitFiles, audioIndex) {
  if (Array.isArray(explicitFiles) && explicitFiles.length > 0) {
    return explicitFiles.map((path) => {
      const resolved = resolve(path)
      return { path: resolved, sizeBytes: statSync(resolved).size }
    })
  }
  const files = []
  walk(root, (path) => {
    if (isMetadataCandidate(root, path, audioIndex)) {
      files.push({ path, sizeBytes: statSync(path).size })
    }
  })
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function findTrainingAudioFiles(root) {
  const files = []
  walk(root, (path) => {
    if (AUDIO_EXTENSIONS.has(extname(path).toLowerCase()) && !isGuideAudioArtifact(root, path)) {
      files.push({ path, sizeBytes: statSync(path).size })
    }
  })
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function walk(path, onFile) {
  const stats = statSync(path)
  if (stats.isFile()) {
    onFile(path)
    return
  }
  if (!stats.isDirectory()) {
    return
  }
  for (const entry of readdirSync(path)) {
    walk(join(path, entry), onFile)
  }
}

function isMetadataCandidate(root, path, audioIndex) {
  const extension = extname(path).toLowerCase()
  if (!METADATA_EXTENSIONS.has(extension)) {
    return false
  }
  const relativePath = relative(root, path)
  const fileName = basename(path).toLowerCase()
  if (fileName.startsWith('dataset-registry.') || fileName.endsWith('.manifest.json') || fileName === 'manifest.json') {
    return false
  }
  if (/license-review|consent-form/u.test(fileName)) {
    return false
  }
  if (relativePath.includes(`${join('generated-sidecars', '')}`)) {
    return false
  }
  if (audioIndex?.stems?.has(basename(path, extension).toLowerCase())) {
    return false
  }
  return true
}

function buildAudioIndex(root, audioFiles) {
  const byExact = new Map()
  const byBasename = new Map()
  const stems = new Set()
  for (const file of audioFiles) {
    const relativePath = normalizePath(relative(root, file.path))
    const fileName = basename(file.path).toLowerCase()
    stems.add(basename(file.path, extname(file.path)).toLowerCase())
    byExact.set(relativePath, file)
    byExact.set(normalizePath(file.path), file)
    const bucket = byBasename.get(fileName) ?? []
    bucket.push(file)
    byBasename.set(fileName, bucket)
  }
  return { root, audioFiles, byExact, byBasename, stems }
}

function parseMetadataRows(path) {
  const extension = extname(path).toLowerCase()
  if (extension === '.csv') {
    return parseCsvMetadata(path)
  }
  if (extension === '.json') {
    return parseJsonMetadata(path)
  }
  return []
}

function parseCsvMetadata(path) {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  if (rows.length < 2) {
    return []
  }
  const header = rows[0].map((cell) => cell.trim())
  return rows
    .slice(1)
    .map((row, index) => normalizeMetadataRecord(Object.fromEntries(header.map((key, cellIndex) => [key, row[cellIndex] ?? ''])), index + 2))
    .filter((row) => row.audioRef || row.lyric || row.midi !== null || row.pitchHz !== null)
}

function parseJsonMetadata(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'))
  const records = []
  collectJsonRecords(value, {}, records)
  return records.map((record, index) => normalizeMetadataRecord(record, index + 1)).filter((row) => row.audioRef || row.lyric || row.midi !== null || row.pitchHz !== null)
}

function collectJsonRecords(value, context, records) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonRecords(item, context, records)
    }
    return
  }
  if (!value || typeof value !== 'object') {
    return
  }

  const ownFlat = {}
  const nested = []
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child) || (child && typeof child === 'object')) {
      nested.push([key, child])
    } else {
      ownFlat[key] = child
    }
  }

  const merged = { ...context, ...ownFlat }
  if (looksLikeNoteRecord(merged)) {
    records.push(merged)
  }
  for (const [, child] of nested) {
    collectJsonRecords(child, merged, records)
  }
}

function looksLikeNoteRecord(record) {
  const pitch = extractPitch(record)
  const timing = extractTiming(record)
  return Boolean(extractExplicitLyric(record) || pitch.midi !== null || pitch.pitchHz !== null || timing.startSeconds !== null || timing.durationSeconds !== null)
}

function normalizeMetadataRecord(record, sourceRow) {
  const timing = extractTiming(record)
  const pitch = extractPitch(record)
  return {
    sourceRow,
    audioRef: extractAudioRef(record),
    lyric: extractLyric(record),
    startSeconds: timing.startSeconds,
    endSeconds: timing.endSeconds,
    durationSeconds: timing.durationSeconds,
    midi: pitch.midi,
    pitchHz: pitch.pitchHz,
    raw: record,
  }
}

function extractAudioRef(record) {
  for (const [key, value] of Object.entries(record)) {
    if (isAudioRefKey(key) && audioLike(value)) {
      return String(value).trim()
    }
  }
  for (const value of Object.values(record)) {
    if (audioLike(value)) {
      return String(value).trim()
    }
  }
  return ''
}

function extractLyric(record) {
  const explicit = extractExplicitLyric(record)
  if (explicit) {
    return explicit
  }
  for (const value of Object.values(record)) {
    const text = String(value ?? '').trim()
    if (/[\uac00-\ud7a3]/u.test(text)) {
      return text
    }
  }
  return ''
}

function extractExplicitLyric(record) {
  for (const [key, value] of Object.entries(record)) {
    if (isLyricKey(key) && String(value ?? '').trim()) {
      return String(value).trim()
    }
  }
  return ''
}

function extractTiming(record) {
  const startSeconds = firstNumber(record, ['start', 'start_time', 'startTime', 'onset', 'begin', 'begin_time', 'from'])
  const endSeconds = firstNumber(record, ['end', 'end_time', 'endTime', 'offset', 'stop', 'to'])
  const durationSeconds = firstNumber(record, ['duration', 'dur', 'length', 'note_duration'])
  return { startSeconds, endSeconds, durationSeconds }
}

function extractPitch(record) {
  const midi = firstNumber(record, ['midi', 'midi_num', 'midiNum', 'note_num', 'noteNumber', 'note_number', 'pitch'])
  const pitchHz = firstNumber(record, ['f0', 'hz', 'frequency', 'freq'])
  return { midi, pitchHz }
}

function firstNumber(record, keys) {
  for (const key of keys) {
    if (record[key] === undefined || record[key] === null || record[key] === '') {
      continue
    }
    const number = Number(record[key])
    if (Number.isFinite(number)) {
      return number
    }
  }
  return null
}

function isAudioRefKey(key) {
  return /^(audio|wav|file|filename|file_name|path|audio_path|recording|track)$/iu.test(key)
}

function isLyricKey(key) {
  return /^(lyric|lyrics|text|syllable|label|word|가사|발음)$/iu.test(key)
}

function audioLike(value) {
  return typeof value === 'string' && /\.(wav|flac|mp3|ogg|m4a|aac)\b/iu.test(value)
}

function matchAudio(audioRef, audioIndex) {
  if (!audioRef) {
    return { status: 'missing' }
  }
  const normalized = normalizePath(audioRef)
  if (audioIndex.byExact.has(normalized)) {
    return { status: 'matched', audio: audioIndex.byExact.get(normalized) }
  }
  const suffixMatches = audioIndex.audioFiles.filter((file) => normalizePath(relative(audioIndex.root, file.path)).endsWith(normalized))
  if (suffixMatches.length === 1) {
    return { status: 'matched', audio: suffixMatches[0] }
  }
  if (suffixMatches.length > 1) {
    return { status: 'ambiguous', candidates: suffixMatches }
  }
  const basenameMatches = audioIndex.byBasename.get(basename(normalized).toLowerCase()) ?? []
  if (basenameMatches.length === 1) {
    return { status: 'matched', audio: basenameMatches[0] }
  }
  if (basenameMatches.length > 1) {
    return { status: 'ambiguous', candidates: basenameMatches }
  }
  return { status: 'missing' }
}

function sidecarOutputPath(datasetRoot, audioPath, explicitOutDir) {
  const audioDir = dirname(audioPath)
  const stem = basename(audioPath, extname(audioPath))
  if (explicitOutDir) {
    return join(resolve(explicitOutDir), `${stem}.csv`)
  }
  const parentDir = dirname(audioDir)
  if (!relative(datasetRoot, parentDir).startsWith('..')) {
    return join(parentDir, 'metadata', `${stem}.csv`)
  }
  return join(audioDir, `${stem}.csv`)
}

function sidecarRows(rows) {
  return rows.map((row) => ({
    start: row.startSeconds ?? '',
    end: row.endSeconds ?? '',
    duration: row.durationSeconds ?? '',
    lyric: row.lyric,
    midi_num: row.midi ?? '',
    pitch_hz: row.pitchHz ?? '',
    source_metadata: row.sourceMetadata,
    source_row: row.sourceRow,
  }))
}

function csvRows(rows) {
  const header = ['start', 'end', 'duration', 'lyric', 'midi_num', 'pitch_hz', 'source_metadata', 'source_row']
  return `${[header, ...rows.map((row) => header.map((key) => row[key]))].map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  row.push(cell)
  if (row.some((value) => value.length > 0)) {
    rows.push(row)
  }
  return rows
}

function nextCommands(dataset, registryPath) {
  if (!dataset?.id) {
    return []
  }
  return [
    `npm run neural:inspect-intake -- --registry ${registryPath} --dataset ${dataset.id}`,
    `npm run neural:audit-datasets -- --registry ${registryPath} --dataset ${dataset.id} --min-local-training-minutes 30`,
    `npm run neural:ingest-dataset -- --registry ${registryPath} --dataset ${dataset.id} --out experiments/neural-singer/work/${dataset.id}-ingest-slice --limit-files 10`,
  ]
}

function isGuideAudioArtifact(root, path) {
  const relativeParts = relative(root, path).split(/[\\/]+/u)
  const fileName = relativeParts.at(-1)?.toLowerCase() ?? ''
  return fileName.endsWith('.guide.wav') || relativeParts.slice(0, -1).some((part) => GUIDE_DIR_NAMES.has(part.toLowerCase()))
}

function normalizePath(path) {
  return String(path).replace(/\\/gu, '/').replace(/^\.\//u, '').toLowerCase()
}

function parseArgs(argv) {
  const parsed = { metadataFiles: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--dataset') {
      parsed.dataset = argv[++index]
    } else if (arg === '--local-path') {
      parsed.localPath = argv[++index]
    } else if (arg === '--metadata-file') {
      parsed.metadataFiles.push(argv[++index])
    } else if (arg === '--out-dir') {
      parsed.outDir = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '--overwrite') {
      parsed.overwrite = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/materialize-neural-dataset-sidecars.mjs [options]',
          '',
          'Options:',
          `  --registry path       Dataset registry JSON, default ${DEFAULT_REGISTRY}`,
          '  --dataset id          Dataset id from the registry',
          '  --local-path path     Inspect a local dataset folder without a registry dataset',
          '  --metadata-file path  Metadata CSV/JSON file to scan, repeatable',
          '  --out-dir path        Write all generated sidecars to this directory',
          '  --report path         Write JSON report to path',
          '  --dry-run             Plan sidecars without writing them',
          '  --overwrite           Replace existing generated sidecar CSV files',
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return parsed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = materializeNeuralDatasetSidecars(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
