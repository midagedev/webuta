#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_REGISTRY = 'experiments/neural-singer/dataset-registry.example.json'
const SUPPORTED_ARCHIVE_SUFFIXES = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tgz', '.zip', '.tar']
const ARCHIVE_LIKE_SUFFIXES = [...SUPPORTED_ARCHIVE_SUFFIXES, '.7z', '.rar']
const GIB = 1024 ** 3

export function auditProviderArchiveDrop(options = {}) {
  const registryPath = resolve(options.registry ?? DEFAULT_REGISTRY)
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : null
  const dataset = findDataset(registry, options.dataset)
  if (!dataset && !options.localPath) {
    throw new Error('Missing --dataset or --local-path.')
  }

  const production = options.production === true
  const localPath = resolve(options.localPath ?? dataset?.localPath ?? '')
  const rawDir = resolve(options.rawDir ?? join(localPath, 'raw'))
  const reportPath = options.report ? resolve(options.report) : null
  const inspectEntries = options.inspectEntries === true
  const hashArchives = options.hashArchives !== false
  const minArchiveCount = positiveInteger(options.minArchiveCount, dataset?.qualityGates?.minProviderArchiveCount ?? 1)
  const minTotalBytes = nonNegativeNumber(
    options.minTotalBytes,
    dataset?.qualityGates?.minProviderArchiveTotalBytes ?? (production ? GIB : 1),
  )
  const minArchiveBytes = nonNegativeNumber(options.minArchiveBytes, dataset?.qualityGates?.minProviderArchiveBytes ?? 1)
  const files = existsSync(rawDir) ? collectFiles(rawDir) : []
  const archives = files.filter((path) => isArchiveFile(path))
  const nonArchiveFiles = files.filter((path) => !isArchiveFile(path))
  const archiveReports = archives.map((archivePath) =>
    inspectArchive({
      rawDir,
      archivePath,
      inspectEntries,
      hashArchives,
      minArchiveBytes,
    }),
  )
  const totalSizeBytes = archiveReports.reduce((sum, archive) => sum + archive.sizeBytes, 0)
  const supportedArchiveCount = archiveReports.filter((archive) => archive.supported).length
  const unsupportedArchiveCount = archiveReports.filter((archive) => !archive.supported).length
  const problems = []
  const warnings = []

  if (!existsSync(rawDir)) {
    problems.push(`Raw provider archive directory does not exist: ${rawDir}.`)
  }
  if (archiveReports.length < minArchiveCount) {
    problems.push(`Provider archive drop has ${archiveReports.length} archive(s); required at least ${minArchiveCount}.`)
  }
  if (unsupportedArchiveCount > 0) {
    problems.push(`Provider archive drop contains ${unsupportedArchiveCount} unsupported archive type(s).`)
  }
  if (totalSizeBytes < minTotalBytes) {
    problems.push(`Provider archive drop is ${formatBytes(totalSizeBytes)}; required at least ${formatBytes(minTotalBytes)}.`)
  }
  for (const archive of archiveReports) {
    if (archive.sizeBytes < minArchiveBytes) {
      problems.push(`${archive.relativePath} is ${formatBytes(archive.sizeBytes)}; required at least ${formatBytes(minArchiveBytes)}.`)
    }
    if (archive.entryInspection?.unsafeEntries?.length > 0) {
      problems.push(`${archive.relativePath} contains unsafe archive paths: ${archive.entryInspection.unsafeEntries.slice(0, 5).join(', ')}.`)
    }
    if (archive.entryInspection?.entryCount === 0) {
      problems.push(`${archive.relativePath} contains no archive entries.`)
    }
    if (archive.entryInspection?.error) {
      problems.push(`${archive.relativePath} could not be inspected: ${archive.entryInspection.error}.`)
    }
  }
  if (nonArchiveFiles.length > 0) {
    warnings.push(`raw/ also contains ${nonArchiveFiles.length} non-archive file(s); they are ignored by provider extraction.`)
  }
  if (production && !dataset?.qualityGates?.minProviderArchiveTotalBytes && !options.minTotalBytes) {
    warnings.push('Production archive drop is using the generic 1 GiB minimum; add qualityGates.minProviderArchiveTotalBytes for this provider.')
  }
  if (archiveReports.length > 0 && !inspectEntries) {
    warnings.push('Archive entry inspection was skipped; extraction will still perform unsafe path checks before unpacking.')
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'provider-archive-ready' : 'provider-archive-blocked',
    production,
    registryPath,
    datasetId: dataset?.id ?? null,
    datasetName: dataset?.name ?? null,
    sourceUrl: dataset?.sourceUrl ?? null,
    localPath,
    rawDir,
    gates: {
      minArchiveCount,
      minTotalBytes,
      minArchiveBytes,
      inspectEntries,
      hashArchives,
    },
    metrics: {
      archiveCount: archiveReports.length,
      supportedArchiveCount,
      unsupportedArchiveCount,
      totalSizeBytes,
      nonArchiveFileCount: nonArchiveFiles.length,
      hashedArchiveCount: archiveReports.filter((archive) => typeof archive.sha256 === 'string' && archive.sha256.length > 0).length,
    },
    archives: archiveReports,
    problems,
    warnings,
    nextActions: nextActions({ dataset, rawDir, problems, production }),
  }

  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

function inspectArchive({ rawDir, archivePath, inspectEntries, hashArchives, minArchiveBytes }) {
  const stats = statSync(archivePath)
  const supported = isSupportedArchive(archivePath)
  return {
    path: archivePath,
    relativePath: relative(rawDir, archivePath),
    extension: archiveExtension(archivePath),
    supported,
    sizeBytes: stats.size,
    sha256: hashArchives ? sha256File(archivePath) : null,
    tooSmall: stats.size < minArchiveBytes,
    entryInspection: supported && inspectEntries ? inspectArchiveEntries(archivePath) : null,
  }
}

function sha256File(path) {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024)
  try {
    for (;;) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead === 0) {
        break
      }
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

function inspectArchiveEntries(archivePath) {
  try {
    const entries = listArchiveEntries(archivePath)
    return {
      entryCount: entries.length,
      unsafeEntries: entries.filter(isUnsafeArchiveEntry).slice(0, 20),
      samples: entries.slice(0, 20),
    }
  } catch (error) {
    return {
      entryCount: null,
      unsafeEntries: [],
      samples: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
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

function collectFiles(root) {
  const stats = statSync(root)
  if (stats.isFile()) {
    return [root]
  }
  if (!stats.isDirectory()) {
    return []
  }
  const files = []
  for (const entry of readdirSync(root)) {
    files.push(...collectFiles(join(root, entry)))
  }
  return files.sort((a, b) => a.localeCompare(b))
}

function isArchiveFile(path) {
  const lower = path.toLowerCase()
  return ARCHIVE_LIKE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

function isSupportedArchive(path) {
  const lower = path.toLowerCase()
  return SUPPORTED_ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

function archiveExtension(path) {
  const lower = path.toLowerCase()
  const suffix = SUPPORTED_ARCHIVE_SUFFIXES.find((candidate) => lower.endsWith(candidate))
  return suffix ?? extname(path).toLowerCase()
}

function listArchiveEntries(archivePath) {
  const lower = archivePath.toLowerCase()
  if (lower.endsWith('.zip')) {
    return execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
  }
  return execFileSync('tar', ['-tf', archivePath], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
}

function isUnsafeArchiveEntry(entry) {
  if (entry.startsWith('/') || /^[a-z]:[/\\]/iu.test(entry)) {
    return true
  }
  return entry.split(/[\\/]+/u).some((part) => part === '..')
}

function nextActions({ dataset, rawDir, problems, production }) {
  if (problems.length === 0) {
    return [
      `Run npm run neural:extract-dataset -- --registry <local-registry> --dataset ${dataset?.id ?? '<dataset-id>'} to unpack the provider archive drop.`,
      'Then rerun neural:run-dataset-handoff so extraction, sidecar materialization, dataset audit, and ingest happen from the same evidence chain.',
    ]
  }
  const actions = [
    `Place the complete original provider archives under ${rawDir}.`,
    'Do not use screenshots, sample clips, guide tracks, or manually trimmed WAVs as the provider archive drop.',
  ]
  if (production) {
    actions.push('For production mode, verify the downloaded archive total matches the provider page or documented license package before training.')
  }
  return actions
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return 'unknown bytes'
  }
  if (bytes >= GIB) {
    return `${(bytes / GIB).toFixed(2)} GiB`
  }
  const mib = 1024 ** 2
  if (bytes >= mib) {
    return `${(bytes / mib).toFixed(2)} MiB`
  }
  const kib = 1024
  if (bytes >= kib) {
    return `${(bytes / kib).toFixed(2)} KiB`
  }
  return `${bytes} bytes`
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--dataset') {
      parsed.dataset = argv[++index]
    } else if (arg === '--local-path') {
      parsed.localPath = argv[++index]
    } else if (arg === '--raw-dir') {
      parsed.rawDir = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--production') {
      parsed.production = true
    } else if (arg === '--min-archive-count') {
      parsed.minArchiveCount = Number(argv[++index])
    } else if (arg === '--min-total-bytes') {
      parsed.minTotalBytes = Number(argv[++index])
    } else if (arg === '--min-total-gb') {
      parsed.minTotalBytes = Number(argv[++index]) * GIB
    } else if (arg === '--min-archive-bytes') {
      parsed.minArchiveBytes = Number(argv[++index])
    } else if (arg === '--inspect-entries') {
      parsed.inspectEntries = true
    } else if (arg === '--skip-hash') {
      parsed.hashArchives = false
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-provider-archive-drop.mjs [options]',
          '',
          'Options:',
          `  --registry path           Dataset registry JSON, default ${DEFAULT_REGISTRY}`,
          '  --dataset id              Dataset id from the registry',
          '  --local-path path         Dataset intake folder without a registry dataset',
          '  --raw-dir path            Archive source directory, default <local-path>/raw',
          '  --report path             Write JSON report',
          '  --production              Use production archive-size expectations',
          '  --min-archive-count n     Require at least this many archive files',
          '  --min-total-bytes bytes   Require this many bytes across raw archives',
          '  --min-total-gb gb         Require this many GiB across raw archives',
          '  --min-archive-bytes bytes Require each archive to be at least this large',
          '  --inspect-entries         List archive entries and reject unsafe paths now',
          '  --skip-hash               Skip SHA-256 hashing of raw archives',
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
    const report = auditProviderArchiveDrop(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
