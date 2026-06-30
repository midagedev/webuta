#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const DEFAULT_API_BASE = 'https://huggingface.co/api/datasets/GTSinger/GTSinger/tree/main'
const DEFAULT_RESOLVE_BASE = 'https://huggingface.co/datasets/GTSinger/GTSinger/resolve/main'
const DEFAULT_OUT_DIR = 'experiments/neural-singer/datasets/gtsinger-korean'
const DEFAULT_ROOTS = ['Korean', 'processed/Korean']
const REPO_DOCS = ['README.md', 'dataset_license.md']

export async function downloadGTSingerKorean(options = {}) {
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR)
  const repositoryDir = resolve(options.repositoryDir ?? join(outDir, 'repository'))
  const manifestPath = resolve(options.manifest ?? join(outDir, 'gtsinger-korean.manifest.json'))
  const registryPath = resolve(options.registry ?? join(outDir, 'dataset-registry.local.json'))
  const apiBase = stripTrailingSlash(options.apiBase ?? DEFAULT_API_BASE)
  const resolveBase = stripTrailingSlash(options.resolveBase ?? DEFAULT_RESOLVE_BASE)
  const roots = options.metadataOnly ? ['processed/Korean'] : options.roots ?? DEFAULT_ROOTS
  const includeDocs = options.includeDocs !== false
  const force = options.force === true
  const skipDownload = options.skipDownload === true
  const maxFiles = nonNegativeInteger(options.maxFiles, 0)
  const concurrency = positiveInteger(options.concurrency, 6)
  const retries = nonNegativeInteger(options.retries, 8)
  const retryBaseDelayMs = positiveInteger(options.retryBaseDelayMs, 1500)

  mkdirSync(repositoryDir, { recursive: true })
  mkdirSync(dirname(manifestPath), { recursive: true })

  const treeFiles = []
  for (const root of roots) {
    treeFiles.push(...(await listHuggingFaceFiles({ apiBase, root })))
  }
  if (includeDocs) {
    treeFiles.push(...REPO_DOCS.map((path) => ({ type: 'file', path, size: null, source: 'repo-doc' })))
  }
  const files = dedupeFiles(treeFiles)
  const selectedFiles = maxFiles > 0 ? files.slice(0, maxFiles) : files
  const downloaded = await mapLimit(selectedFiles, concurrency, async (file) => {
    const localPath = join(repositoryDir, file.path)
    const url = `${resolveBase}/${encodePath(file.path)}`
    const existed = existsSync(localPath)
    const existingSize = existed ? statSync(localPath).size : null
    const canReuse = existed && !force && (file.size == null || existingSize === file.size)

    if (!skipDownload && !canReuse) {
      await downloadFile(url, localPath, { retries, retryBaseDelayMs })
    }

    const present = existsSync(localPath)
    return {
      path: file.path,
      url,
      localPath,
      expectedSizeBytes: file.size ?? null,
      sizeBytes: present ? statSync(localPath).size : null,
      sha256: present ? sha256File(localPath) : null,
      status: skipDownload ? (present ? 'present-skip-download' : 'planned') : canReuse ? 'reused' : 'downloaded',
    }
  })

  const datasetEntry = gtsingerKoreanDatasetEntry(repositoryDir)
  const registry = {
    version: 1,
    notes:
      'Local registry generated from the public GTSinger Hugging Face dataset. GTSinger is CC BY-NC-SA 4.0; keep this as research/noncommercial evidence until model-publishing rights are reviewed.',
    datasets: [datasetEntry],
  }
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'huggingface:GTSinger/GTSinger',
    sourceUrl: 'https://huggingface.co/datasets/GTSinger/GTSinger',
    licenseUrl: 'https://github.com/AaronZ345/GTSinger/blob/master/dataset_license.md',
    licenseStatus: 'cc-by-nc-sa-4.0-research-only',
    language: ['ko'],
    outDir,
    repositoryDir,
    registryPath,
    roots,
    includeDocs,
    concurrency,
    retries,
    files: downloaded,
    metrics: {
      fileCount: downloaded.length,
      presentFileCount: downloaded.filter((file) => file.sha256).length,
      wavCount: downloaded.filter((file) => file.path.toLowerCase().endsWith('.wav')).length,
      jsonCount: downloaded.filter((file) => file.path.toLowerCase().endsWith('.json')).length,
      textGridCount: downloaded.filter((file) => file.path.toLowerCase().endsWith('.textgrid')).length,
      musicXmlCount: downloaded.filter((file) => file.path.toLowerCase().endsWith('.musicxml')).length,
      totalExpectedBytes: downloaded.reduce((sum, file) => sum + (file.expectedSizeBytes ?? 0), 0),
      totalPresentBytes: downloaded.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
    },
    nextCommands: [
      `npm run neural:audit-datasets -- --registry ${relativePath(registryPath)} --dataset gtsinger-korean-research-baseline --min-local-training-minutes 10`,
      `npm run neural:ingest-dataset -- --registry ${relativePath(registryPath)} --dataset gtsinger-korean-research-baseline --out experiments/neural-singer/work/gtsinger-korean-ingest-slice --limit-files 10`,
      `npm run neural:audit-readiness -- --registry ${relativePath(registryPath)} --dataset gtsinger-korean-research-baseline --ingest experiments/neural-singer/work/gtsinger-korean-ingest-slice --min-total-minutes 10 --min-hangul-syllables 100`,
    ],
  }

  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(outDir, 'README.md'), datasetReadme({ manifestPath, registryPath }))
  return manifest
}

export function gtsingerKoreanDatasetEntry(localPath = DEFAULT_OUT_DIR) {
  return {
    id: 'gtsinger-korean-research-baseline',
    name: 'GTSinger Korean subset',
    sourceUrl: 'https://huggingface.co/datasets/GTSinger/GTSinger',
    localPath,
    inventoryRoots: ['Korean', 'processed/Korean'],
    licenseStatus: 'cc-by-nc-sa-4.0-research-only',
    redistribution: 'original-license-noncommercial-sharealike',
    modelPublishing: 'research-only-review-required',
    singerIdentity: 'public-dataset',
    language: ['ko'],
    audioHours: null,
    annotationTypes: ['audio', 'json', 'textgrid', 'musicxml', 'processed-metadata'],
    qualityGates: {
      minAnnotatedRatio: 0.95,
    },
    allowedActions: {
      localTraining: true,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: [
      'GTSinger README says the full corpus is provided for free and links dataset_license.md.',
      'dataset_license.md declares CC BY-NC-SA 4.0. Use only for research/noncommercial local training unless a separate rights review approves broader release.',
      'Do not use this as product/public-model release evidence; use it to improve Korean SVS preprocessing, alignment, and checkpoint smoke quality.',
    ],
  }
}

async function listHuggingFaceFiles({ apiBase, root }) {
  const files = []
  const seenPages = new Set()
  let url = `${apiBase}/${encodePath(root)}?recursive=true&limit=1000`
  while (url) {
    if (seenPages.has(url)) {
      throw new Error(`Hugging Face tree pagination loop for ${root}: ${url}`)
    }
    seenPages.add(url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to list ${root}: HTTP ${response.status} ${response.statusText}`)
    }
    const entries = await response.json()
    if (!Array.isArray(entries)) {
      throw new Error(`Unexpected Hugging Face tree response for ${root}.`)
    }
    files.push(
      ...entries
        .filter((entry) => entry?.type === 'file' && typeof entry.path === 'string')
        .map((entry) => ({
          type: 'file',
          path: entry.path,
          size: typeof entry.size === 'number' ? entry.size : null,
          oid: entry.oid ?? null,
        })),
    )
    url = nextLink(response.headers.get('link'))
  }
  return files
}

function nextLink(header) {
  if (!header) {
    return null
  }
  const match = header.match(/<([^>]+)>;\s*rel="?next"?/iu)
  return match?.[1] ?? null
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
        if (existsSync(partPath)) {
          unlinkSync(partPath)
        }
        try {
          await pipeline(Readable.fromWeb(response.body), createWriteStream(partPath))
          renameSync(partPath, localPath)
          return
        } catch (error) {
          if (existsSync(partPath)) {
            unlinkSync(partPath)
          }
          throw error
        }
      }
      lastError = Object.assign(new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`), {
        retryable: isRetryableStatus(response.status),
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
      await delay(retryBackoffMs(attempt, retryBaseDelayMs))
    }
  }
  throw lastError
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500
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
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) {
      return Math.max(date - Date.now(), baseDelayMs)
    }
  }
  return retryBackoffMs(attempt, baseDelayMs)
}

function retryBackoffMs(attempt, baseDelayMs) {
  return Math.min(60_000, baseDelayMs * 2 ** attempt)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dedupeFiles(files) {
  const seen = new Set()
  const result = []
  for (const file of files) {
    if (seen.has(file.path)) {
      continue
    }
    seen.add(file.path)
    result.push(file)
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

function sha256File(path) {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

function datasetReadme({ manifestPath, registryPath }) {
  return [
    '# GTSinger Korean Local Dataset',
    '',
    'This ignored folder is generated by `npm run neural:download-gtsinger-korean`.',
    '',
    '- Source: https://huggingface.co/datasets/GTSinger/GTSinger',
    '- License: CC BY-NC-SA 4.0 via the upstream `dataset_license.md`',
    '- Use: research/noncommercial Korean singing baseline only',
    '',
    'Important: this is useful for improving WebUtau Korean neural preprocessing',
    'and training smoke quality, but it is not public product-release evidence.',
    '',
    'Generated files:',
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
  return String(value).replace(/\/+$/, '')
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

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out-dir') {
      parsed.outDir = argv[++index]
    } else if (arg === '--repository-dir') {
      parsed.repositoryDir = argv[++index]
    } else if (arg === '--manifest') {
      parsed.manifest = argv[++index]
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--api-base') {
      parsed.apiBase = argv[++index]
    } else if (arg === '--resolve-base') {
      parsed.resolveBase = argv[++index]
    } else if (arg === '--metadata-only') {
      parsed.metadataOnly = true
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
          'Usage: node scripts/download-gtsinger-korean.mjs [options]',
          '',
          'Options:',
          '  --out-dir path       Ignored local dataset directory',
          '  --repository-dir path',
          '                       Existing or generated Hugging Face repository checkout',
          '  --manifest path      Output manifest JSON',
          '  --registry path      Output local dataset registry JSON',
          '  --metadata-only      Download processed/Korean metadata and repo docs only',
          '  --force              Redownload even when a matching local file exists',
          '  --skip-download      Write a planned manifest without downloading missing files',
          '  --max-files n        Limit selected files, useful for script tests',
          '  --concurrency n      Parallel downloads, default 6',
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
    const manifest = await downloadGTSingerKorean(options)
    const output = options.summary
      ? {
          manifestPath: options.manifest ?? join(options.outDir ?? DEFAULT_OUT_DIR, 'gtsinger-korean.manifest.json'),
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
