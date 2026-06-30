#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DEFAULT_RECORD_URL = 'https://zenodo.org/api/records/4916302'
const DEFAULT_OUT_DIR = 'experiments/neural-singer/datasets/csd'
const DEFAULT_ZIP_NAME = 'CSD.zip'

export async function downloadCsd(options = {}) {
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR)
  const recordUrl = options.recordUrl ?? DEFAULT_RECORD_URL
  const zipPath = resolve(options.zipPath ?? join(outDir, DEFAULT_ZIP_NAME))
  const extractDir = resolve(options.extractDir ?? join(outDir, 'extracted'))
  const manifestPath = resolve(options.manifest ?? join(outDir, 'csd.manifest.json'))
  const registryPath = resolve(options.registry ?? join(outDir, 'dataset-registry.local.json'))
  const force = options.force === true
  const skipDownload = options.skipDownload === true
  const extract = options.extract === true
  const retries = nonNegativeInteger(options.retries, 6)

  mkdirSync(outDir, { recursive: true })
  const record = await fetchJson(recordUrl)
  const file = findCsdZip(record)
  const expectedMd5 = md5FromChecksum(file.checksum)
  const existing = existsSync(zipPath)
  const existingSize = existing ? statSync(zipPath).size : null
  const existingMd5 = existing ? md5File(zipPath) : null
  const canReuse = existing && !force && existingSize === file.size && (!expectedMd5 || existingMd5 === expectedMd5)

  if (!skipDownload && !canReuse) {
    await downloadFile(file.links.self, zipPath, { retries })
  }
  const present = existsSync(zipPath)
  const presentSize = present ? statSync(zipPath).size : null
  const presentMd5 = present ? md5File(zipPath) : null
  if (present && file.size && presentSize !== file.size) {
    throw new Error(`CSD.zip size mismatch: expected ${file.size}, got ${presentSize}.`)
  }
  if (present && expectedMd5 && presentMd5 !== expectedMd5) {
    throw new Error(`CSD.zip md5 mismatch: expected ${expectedMd5}, got ${presentMd5}.`)
  }
  if (extract && present) {
    mkdirSync(extractDir, { recursive: true })
    const result = spawnSync('unzip', ['-q', '-o', zipPath, '-d', extractDir], { stdio: 'pipe' })
    if (result.status !== 0) {
      throw new Error(`Failed to extract CSD.zip: ${result.stderr?.toString() || result.stdout?.toString() || 'unzip failed'}`)
    }
  }

  const datasetEntry = csdDatasetEntry(outDir)
  const registry = {
    version: 1,
    notes:
      'Local registry generated from the public Zenodo CSD record. CSD is CC BY-NC-SA 4.0; keep this as research/noncommercial evidence until model-publishing rights are reviewed.',
    datasets: [datasetEntry],
  }
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'zenodo:4916302',
    sourceUrl: 'https://zenodo.org/records/4916302',
    recordUrl,
    doi: record.doi ?? '10.5281/zenodo.4916302',
    licenseStatus: 'cc-by-nc-sa-4.0-research-only',
    outDir,
    zipPath,
    extractDir,
    registryPath,
    file: {
      key: file.key,
      url: file.links.self,
      expectedSizeBytes: file.size,
      expectedMd5,
      sizeBytes: presentSize,
      md5: presentMd5,
      status: skipDownload ? (present ? 'present-skip-download' : 'planned') : canReuse ? 'reused' : 'downloaded',
    },
    extracted: inspectExtractedCsd(extractDir),
    nextCommands: [
      `npm run neural:audit-datasets -- --registry ${relativePath(registryPath)} --dataset csd-korean-research-baseline --min-local-training-minutes 10 --min-annotated-ratio 0.95 --report experiments/neural-singer/work/csd-dataset-audit.json`,
      `npm run neural:prepare-csd-smoke -- --ids all --limit 12 --out experiments/neural-singer/work/csd-mfa-smoke`,
    ],
  }

  writeJson(registryPath, registry)
  writeJson(manifestPath, manifest)
  writeFileSync(join(outDir, 'README.md'), datasetReadme({ manifestPath, registryPath }))
  return manifest
}

export function csdDatasetEntry(localPath = DEFAULT_OUT_DIR) {
  return {
    id: 'csd-korean-research-baseline',
    name: "Children's Song Dataset Korean subset",
    sourceUrl: 'https://zenodo.org/records/4916302',
    localPath,
    licenseStatus: 'cc-by-nc-sa-4.0-research-only',
    redistribution: 'original-license-noncommercial-sharealike',
    modelPublishing: 'no-commercial-release-review-required',
    singerIdentity: 'public-dataset',
    language: ['ko'],
    audioHours: null,
    annotationTypes: ['audio', 'lyrics', 'midi', 'csv', 'phoneme-annotations'],
    qualityGates: {
      minAnnotatedRatio: 0.95,
    },
    allowedActions: {
      localTraining: true,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: [
      'Zenodo record 4916302 lists CC BY-NC-SA 4.0 and says the dataset is primarily for research purposes.',
      'Do not use for commercial product demos or public model releases without a separate rights review.',
      'Dataset contains 50 Korean and 50 English songs, 200 total recordings, with WAV, MIDI, lyric, txt, and csv annotations.',
    ],
  }
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`)
  }
  return response.json()
}

function findCsdZip(record) {
  const file = record?.files?.find((candidate) => candidate?.key === DEFAULT_ZIP_NAME)
  if (!file?.links?.self || typeof file.size !== 'number') {
    throw new Error('Zenodo record does not contain a downloadable CSD.zip file.')
  }
  return file
}

async function downloadFile(url, localPath, options = {}) {
  const retries = nonNegativeInteger(options.retries, 6)
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok || !response.body) {
        lastError = Object.assign(new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`), {
          retryable: response.status === 429 || response.status >= 500,
        })
        if (!lastError.retryable || attempt >= retries) {
          throw lastError
        }
        await delay(Math.min(60_000, 1500 * 2 ** attempt))
        continue
      }
      mkdirSync(dirname(localPath), { recursive: true })
      const partPath = `${localPath}.part`
      if (existsSync(partPath)) {
        unlinkSync(partPath)
      }
      try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(partPath))
        renameSync(partPath, localPath)
        return
      } catch (error) {
        rmSync(partPath, { force: true })
        throw error
      }
    } catch (error) {
      lastError = error
      if (error?.retryable === false || attempt >= retries) {
        break
      }
      await delay(Math.min(60_000, 1500 * 2 ** attempt))
    }
  }
  throw lastError
}

function md5FromChecksum(value) {
  const text = String(value ?? '')
  return text.startsWith('md5:') ? text.slice(4) : null
}

function md5File(path) {
  const hash = createHash('md5')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

function inspectExtractedCsd(extractDir) {
  const koreanRoot = join(extractDir, 'CSD', 'korean')
  const directories = ['wav', 'csv', 'lyric', 'mid', 'txt']
  const counts = {}
  for (const directory of directories) {
    const path = join(koreanRoot, directory)
    counts[directory] = existsSync(path) ? countFiles(path) : 0
  }
  return {
    koreanRoot,
    ...counts,
    ready: directories.every((directory) => counts[directory] > 0),
  }
}

function countFiles(path) {
  const stats = statSync(path)
  if (stats.isFile()) {
    return 1
  }
  if (!stats.isDirectory()) {
    return 0
  }
  return readdirSync(path).reduce((sum, entry) => sum + countFiles(join(path, entry)), 0)
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function datasetReadme({ manifestPath, registryPath }) {
  return [
    '# CSD Local Dataset',
    '',
    'This ignored folder is generated by `npm run neural:download-csd`.',
    '',
    '- Source: https://zenodo.org/records/4916302',
    '- DOI: 10.5281/zenodo.4916302',
    '- License: CC BY-NC-SA 4.0',
    '- Use: research/noncommercial Korean singing baseline only',
    '',
    `- Manifest: ${relativePath(manifestPath)}`,
    `- Local registry: ${relativePath(registryPath)}`,
    '',
  ].join('\n')
}

function relativePath(path) {
  const resolved = resolve(path)
  const cwd = process.cwd()
  return resolved.startsWith(cwd) ? relative(cwd, resolved) : path
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Expected a non-negative integer, got ${value}.`)
  }
  return number
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out-dir') {
      parsed.outDir = argv[++index]
    } else if (arg === '--zip-path') {
      parsed.zipPath = argv[++index]
    } else if (arg === '--extract-dir') {
      parsed.extractDir = argv[++index]
    } else if (arg === '--manifest') {
      parsed.manifest = argv[++index]
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--record-url') {
      parsed.recordUrl = argv[++index]
    } else if (arg === '--extract') {
      parsed.extract = true
    } else if (arg === '--force') {
      parsed.force = true
    } else if (arg === '--skip-download') {
      parsed.skipDownload = true
    } else if (arg === '--summary') {
      parsed.summary = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/download-csd.mjs [options]',
          '',
          'Options:',
          '  --out-dir path       Ignored local dataset directory',
          '  --zip-path path      CSD.zip path',
          '  --extract-dir path   Extraction directory',
          '  --manifest path      Output manifest JSON',
          '  --registry path      Output local dataset registry JSON',
          '  --record-url url     Zenodo API record URL',
          '  --extract            Extract CSD.zip after download/verification',
          '  --force              Redownload even when local zip matches',
          '  --skip-download      Write a planned manifest without downloading missing files',
          '  --summary            Print only manifest metrics and next commands',
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
    const options = parseArgs(process.argv.slice(2))
    const manifest = await downloadCsd(options)
    const output = options.summary
      ? {
          manifestPath: options.manifest ?? join(options.outDir ?? DEFAULT_OUT_DIR, 'csd.manifest.json'),
          registryPath: options.registry ?? join(options.outDir ?? DEFAULT_OUT_DIR, 'dataset-registry.local.json'),
          file: manifest.file,
          extracted: manifest.extracted,
          nextCommands: manifest.nextCommands,
        }
      : manifest
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
