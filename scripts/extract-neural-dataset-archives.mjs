#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_REGISTRY = 'experiments/neural-singer/dataset-registry.example.json'
const SUPPORTED_ARCHIVE_SUFFIXES = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tgz', '.zip', '.tar']

export function extractNeuralDatasetArchives(options = {}) {
  const registryPath = resolve(options.registry ?? DEFAULT_REGISTRY)
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : null
  const dataset = findDataset(registry, options.dataset)
  if (!dataset && !options.localPath) {
    throw new Error('Missing --dataset or --local-path.')
  }
  const localPath = resolve(options.localPath ?? dataset?.localPath ?? '')
  const rawDir = resolve(options.rawDir ?? join(localPath, 'raw'))
  const extractedDir = resolve(options.extractedDir ?? join(localPath, 'extracted'))
  const reportPath = options.report ? resolve(options.report) : null
  const dryRun = options.dryRun === true
  const overwrite = options.overwrite === true
  const archives = options.archive ? [resolve(options.archive)] : collectSupportedArchives(rawDir)
  const results = []

  for (const archivePath of archives) {
    if (!existsSync(archivePath)) {
      throw new Error(`Archive not found: ${archivePath}`)
    }
    if (!isSupportedArchive(archivePath)) {
      throw new Error(`Unsupported archive type: ${archivePath}`)
    }
    const entries = listArchiveEntries(archivePath)
    const unsafeEntries = entries.filter(isUnsafeArchiveEntry)
    if (unsafeEntries.length > 0) {
      throw new Error(`Refusing unsafe archive paths in ${archivePath}: ${unsafeEntries.slice(0, 5).join(', ')}`)
    }
    const destination = join(extractedDir, archiveStem(archivePath))
    const existedBefore = existsSync(destination)
    const filesBefore = existedBefore ? collectFiles(destination).length : 0
    if (filesBefore > 0 && !overwrite && !dryRun) {
      throw new Error(`Destination already contains files: ${destination}. Pass --overwrite to replace it.`)
    }
    const command = extractionCommand(archivePath, destination)
    if (!dryRun) {
      if (overwrite) {
        rmSync(destination, { recursive: true, force: true })
      }
      mkdirSync(destination, { recursive: true })
      execFileSync(command.bin, command.args, { stdio: 'pipe' })
    }
    const filesAfter = !dryRun && existsSync(destination) ? collectFiles(destination).length : filesBefore
    results.push({
      archive: archivePath,
      destination,
      command: [command.bin, ...command.args],
      entryCount: entries.length,
      dryRun,
      existedBefore,
      filesBefore,
      filesAfter,
      extractedFileCount: Math.max(0, filesAfter - filesBefore),
    })
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: archives.length > 0,
    datasetId: dataset?.id ?? null,
    datasetName: dataset?.name ?? null,
    sourceUrl: dataset?.sourceUrl ?? null,
    registryPath,
    localPath,
    rawDir,
    extractedDir,
    dryRun,
    overwrite,
    archiveCount: archives.length,
    results,
    nextCommands: nextCommands(dataset, registryPath),
  }

  if (reportPath) {
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

function collectSupportedArchives(rawDir) {
  if (!existsSync(rawDir)) {
    return []
  }
  return collectFiles(rawDir)
    .filter((path) => isSupportedArchive(path))
    .sort((a, b) => a.localeCompare(b))
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
  return files
}

function isSupportedArchive(path) {
  const lower = path.toLowerCase()
  return SUPPORTED_ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
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

function extractionCommand(archivePath, destination) {
  if (archivePath.toLowerCase().endsWith('.zip')) {
    return {
      bin: 'unzip',
      args: ['-q', archivePath, '-d', destination],
    }
  }
  return {
    bin: 'tar',
    args: ['-xf', archivePath, '-C', destination],
  }
}

function archiveStem(archivePath) {
  const name = basename(archivePath)
  const lower = name.toLowerCase()
  for (const suffix of SUPPORTED_ARCHIVE_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return name.slice(0, -suffix.length)
    }
  }
  return basename(name, extname(name))
}

function nextCommands(dataset, registryPath) {
  if (!dataset?.id) {
    return []
  }
  return [
    `npm run neural:inspect-intake -- --registry ${registryPath} --dataset ${dataset.id}`,
    `npm run neural:materialize-sidecars -- --registry ${registryPath} --dataset ${dataset.id} --report experiments/neural-singer/work/${dataset.id}-sidecars.json`,
    `npm run neural:audit-datasets -- --registry ${registryPath} --dataset ${dataset.id} --min-local-training-minutes 30`,
    `npm run neural:ingest-dataset -- --registry ${registryPath} --dataset ${dataset.id} --out experiments/neural-singer/work/${dataset.id}-ingest-slice --limit-files 10`,
  ]
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
    } else if (arg === '--extracted-dir') {
      parsed.extractedDir = argv[++index]
    } else if (arg === '--archive') {
      parsed.archive = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '--overwrite') {
      parsed.overwrite = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/extract-neural-dataset-archives.mjs [options]',
          '',
          'Options:',
          `  --registry path       Dataset registry JSON, default ${DEFAULT_REGISTRY}`,
          '  --dataset id          Dataset id from the registry',
          '  --local-path path     Dataset intake folder without a registry dataset',
          '  --raw-dir path        Archive source directory, default <local-path>/raw',
          '  --extracted-dir path  Extraction output directory, default <local-path>/extracted',
          '  --archive path        Extract one archive instead of all supported raw archives',
          '  --report path         Write JSON report',
          '  --dry-run             Validate archives and print extraction plan only',
          '  --overwrite           Replace destination archive folders if they already contain files',
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
    const report = extractNeuralDatasetArchives(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
