#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const DEFAULT_API_URL = 'https://huggingface.co/api/datasets/Bingsu/KSS_Dataset'
const DEFAULT_RESOLVE_BASE = 'https://huggingface.co/datasets/Bingsu/KSS_Dataset/resolve/main'
const DEFAULT_OUT_DIR = 'experiments/neural-singer/datasets/kss-korean-speech'

export async function downloadKss(options = {}) {
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR)
  const repositoryDir = resolve(options.repositoryDir ?? join(outDir, 'repository'))
  const manifestPath = resolve(options.manifest ?? join(outDir, 'kss.manifest.json'))
  const registryPath = resolve(options.registry ?? join(outDir, 'dataset-registry.local.json'))
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL
  const resolveBase = stripTrailingSlash(options.resolveBase ?? DEFAULT_RESOLVE_BASE)
  const force = options.force === true
  const skipDownload = options.skipDownload === true
  const maxFiles = nonNegativeInteger(options.maxFiles, 0)
  const concurrency = positiveInteger(options.concurrency, 2)
  const retries = nonNegativeInteger(options.retries, 8)
  const retryBaseDelayMs = positiveInteger(options.retryBaseDelayMs, 1500)

  mkdirSync(repositoryDir, { recursive: true })
  const dataset = await fetchJson(apiUrl)
  const files = selectKssFiles(dataset)
  const selectedFiles = maxFiles > 0 ? files.slice(0, maxFiles) : files

  const downloaded = await mapLimit(selectedFiles, concurrency, async (file) => {
    const localPath = join(repositoryDir, file.path)
    const url = `${resolveBase}/${encodePath(file.path)}`
    const remote = await inspectRemoteFile(url)
    const expectedSizeBytes = remote.sizeBytes
    const existed = existsSync(localPath)
    const existingSize = existed ? statSync(localPath).size : null
    const canReuse = existed && !force && (expectedSizeBytes == null || existingSize === expectedSizeBytes)

    if (!skipDownload && !canReuse) {
      await downloadFile(url, localPath, { retries, retryBaseDelayMs })
    }

    const present = existsSync(localPath)
    const sizeBytes = present ? statSync(localPath).size : null
    if (present && expectedSizeBytes != null && sizeBytes !== expectedSizeBytes) {
      throw new Error(`KSS file size mismatch for ${file.path}: expected ${expectedSizeBytes}, got ${sizeBytes}.`)
    }
    return {
      path: file.path,
      url,
      localPath,
      expectedSizeBytes,
      etag: remote.etag,
      sizeBytes,
      sha256: present ? await sha256File(localPath) : null,
      status: skipDownload ? (present ? 'present-skip-download' : 'planned') : canReuse ? 'reused' : 'downloaded',
    }
  })

  const registry = {
    version: 1,
    notes:
      'Local registry generated from the public KSS Hugging Face dataset. KSS is speech, not singing; use only as Korean pronunciation/normalization auxiliary evidence.',
    datasets: [kssDatasetEntry(outDir)],
  }
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'huggingface:Bingsu/KSS_Dataset',
    sourceUrl: 'https://huggingface.co/datasets/Bingsu/KSS_Dataset',
    licenseStatus: 'cc-by-nc-sa-4.0-research-only',
    datasetSha: dataset.sha ?? null,
    outDir,
    repositoryDir,
    registryPath,
    files: downloaded,
    metrics: {
      fileCount: downloaded.length,
      presentFileCount: downloaded.filter((file) => file.sha256).length,
      parquetCount: downloaded.filter((file) => file.path.toLowerCase().endsWith('.parquet')).length,
      totalExpectedBytes: downloaded.reduce((sum, file) => sum + (file.expectedSizeBytes ?? 0), 0),
      totalPresentBytes: downloaded.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
    },
    nextCommands: [
      `npm run neural:audit-datasets -- --registry ${relativePath(registryPath)} --dataset kss-korean-speech-pronunciation-aux`,
      'Add a parquet-to-WAV adapter before using KSS for acoustic or pronunciation experiments.',
    ],
  }

  writeJson(registryPath, registry)
  writeJson(manifestPath, manifest)
  writeFileSync(join(outDir, 'README.md'), datasetReadme({ manifestPath, registryPath }))
  return manifest
}

export function kssDatasetEntry(localPath = DEFAULT_OUT_DIR) {
  return {
    id: 'kss-korean-speech-pronunciation-aux',
    name: 'KSS Korean Single Speaker Speech auxiliary corpus',
    sourceUrl: 'https://huggingface.co/datasets/Bingsu/KSS_Dataset',
    localPath,
    licenseStatus: 'cc-by-nc-sa-4.0-research-only',
    redistribution: 'original-license-noncommercial-sharealike',
    modelPublishing: 'not-singing-data-release-review-required',
    singerIdentity: 'public-speech-dataset',
    language: ['ko'],
    audioHours: 12,
    annotationTypes: ['parquet', 'audio', 'text', 'tts-transcript'],
    allowedActions: {
      localTraining: false,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: [
      'KSS is a Korean TTS speech corpus, not singing data.',
      'Use only as an auxiliary pronunciation, normalization, or speech-front-end experiment source; it cannot satisfy the Korean singing dataset milestone by itself.',
      'Hugging Face metadata marks it as CC BY-NC-SA 4.0, so keep it research/noncommercial unless a separate rights review approves broader use.',
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

function selectKssFiles(dataset) {
  const siblings = Array.isArray(dataset?.siblings) ? dataset.siblings : []
  const files = siblings
    .map((file) => file?.rfilename)
    .filter((path) => typeof path === 'string')
    .filter((path) => path === 'README.md' || path === 'dataset_infos.json' || /^data\/train-\d+-of-\d+\.parquet$/u.test(path))
    .map((path) => ({ path }))
    .sort((a, b) => a.path.localeCompare(b.path))
  if (files.length === 0) {
    throw new Error('KSS Hugging Face API response did not contain README/dataset_infos/parquet files.')
  }
  return files
}

async function inspectRemoteFile(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    if (!response.ok) {
      return { sizeBytes: null, etag: null }
    }
    const size = response.headers.get('x-linked-size') ?? response.headers.get('content-length')
    return {
      sizeBytes: size && /^\d+$/u.test(size) ? Number(size) : null,
      etag: trimQuotes(response.headers.get('x-linked-etag') ?? response.headers.get('etag')),
    }
  } catch {
    return { sizeBytes: null, etag: null }
  }
}

async function downloadFile(url, localPath, options = {}) {
  const retries = nonNegativeInteger(options.retries, 8)
  const retryBaseDelayMs = positiveInteger(options.retryBaseDelayMs, 1500)
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok && response.body) {
        mkdirSync(dirname(localPath), { recursive: true })
        const partPath = `${localPath}.part`
        rmSync(partPath, { force: true })
        try {
          await pipeline(Readable.fromWeb(response.body), createWriteStream(partPath))
          renameSync(partPath, localPath)
          return
        } catch (error) {
          unlinkSync(partPath)
          throw error
        }
      }
      lastError = Object.assign(new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`), {
        retryable: response.status === 429 || response.status >= 500,
      })
      if (!lastError.retryable || attempt >= retries) {
        throw lastError
      }
      await drainResponse(response)
      await delay(retryDelayMs(response, attempt, retryBaseDelayMs))
    } catch (error) {
      lastError = error
      if (error?.retryable === false || attempt >= retries) {
        break
      }
      await delay(Math.min(60_000, retryBaseDelayMs * 2 ** attempt))
    }
  }
  throw lastError
}

async function sha256File(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function datasetReadme({ manifestPath, registryPath }) {
  return [
    '# KSS Korean Speech Local Dataset',
    '',
    'This ignored folder is generated by `npm run neural:download-kss`.',
    '',
    '- Source: https://huggingface.co/datasets/Bingsu/KSS_Dataset',
    '- License: CC BY-NC-SA 4.0',
    '- Use: Korean speech pronunciation/normalization auxiliary data only',
    '- Important: KSS is not singing data and does not satisfy the Korean SVS dataset milestone.',
    '',
    `- Manifest: ${relativePath(manifestPath)}`,
    `- Local registry: ${relativePath(registryPath)}`,
    '',
  ].join('\n')
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/u, '')
}

function trimQuotes(value) {
  return value ? value.replace(/^"|"$/gu, '') : null
}

async function drainResponse(response) {
  try {
    await response.arrayBuffer()
  } catch {
    // Best effort: release the response before backing off.
  }
}

function retryDelayMs(response, attempt, baseDelayMs) {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.max(seconds * 1000, baseDelayMs)
    }
  }
  return Math.min(60_000, baseDelayMs * 2 ** attempt)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
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

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Expected a positive integer, got ${value}.`)
  }
  return number
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out-dir') {
      parsed.outDir = argv[++index]
    } else if (arg === '--manifest') {
      parsed.manifest = argv[++index]
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--api-url') {
      parsed.apiUrl = argv[++index]
    } else if (arg === '--resolve-base') {
      parsed.resolveBase = argv[++index]
    } else if (arg === '--force') {
      parsed.force = true
    } else if (arg === '--skip-download') {
      parsed.skipDownload = true
    } else if (arg === '--max-files') {
      parsed.maxFiles = Number(argv[++index])
    } else if (arg === '--concurrency') {
      parsed.concurrency = Number(argv[++index])
    } else if (arg === '--retries') {
      parsed.retries = Number(argv[++index])
    } else if (arg === '--retry-base-delay-ms') {
      parsed.retryBaseDelayMs = Number(argv[++index])
    } else if (arg === '--summary') {
      parsed.summary = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/download-kss.mjs [options]',
          '',
          'Options:',
          '  --out-dir path       Ignored local dataset directory',
          '  --manifest path      Output manifest JSON',
          '  --registry path      Output local dataset registry JSON',
          '  --api-url url        Hugging Face dataset API URL',
          '  --resolve-base url   Hugging Face resolve base URL',
          '  --force              Redownload even when a matching local file exists',
          '  --skip-download      Write a planned manifest without downloading missing files',
          '  --max-files n        Limit selected files, useful for script tests',
          '  --concurrency n      Parallel downloads, default 2',
          '  --retries n          Retry count for 429/5xx/network failures, default 8',
          '  --retry-base-delay-ms n',
          '                       Initial retry backoff in milliseconds, default 1500',
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
    const manifest = await downloadKss(options)
    const output = options.summary
      ? {
          manifestPath: options.manifest ?? join(options.outDir ?? DEFAULT_OUT_DIR, 'kss.manifest.json'),
          registryPath: options.registry ?? join(options.outDir ?? DEFAULT_OUT_DIR, 'dataset-registry.local.json'),
          metrics: manifest.metrics,
          nextCommands: manifest.nextCommands,
        }
      : manifest
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
