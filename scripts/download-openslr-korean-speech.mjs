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

const DEFAULT_OUT_ROOT = 'experiments/neural-singer/datasets'

export const OPENSLR_KOREAN_PRESETS = {
  'zeroth-korean': {
    id: 'zeroth-korean-speech-aux',
    name: 'Zeroth-Korean speech auxiliary corpus',
    sourceUrl: 'https://www.openslr.org/40/',
    outDirName: 'zeroth-korean-speech',
    licenseStatus: 'cc-by-4.0-speech-auxiliary',
    redistribution: 'original-license-cc-by-4.0',
    modelPublishing: 'not-singing-data-release-review-required',
    licenseLabel: 'CC BY 4.0',
    audioHours: 52.8,
    annotationTypes: ['tar.gz', 'audio', 'transcript', 'lexicon', 'language-model'],
    allowedActions: {
      localTraining: false,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: [
      'OpenSLR SLR40 lists Zeroth-Korean as CC BY 4.0 and 51.6 train hours plus 1.2 test hours.',
      'This is speech recognition data, not singing data; use it for Korean pronunciation/front-end/ASR auxiliary experiments only.',
      'It cannot satisfy the Korean singing dataset milestone by itself.',
    ],
    files: [
      {
        name: 'zeroth_korean.tar.gz',
        url: 'https://openslr.trmal.net/resources/40/zeroth_korean.tar.gz',
        description: 'Korean speech data, transcription, lexicon, and language model',
      },
    ],
  },
  'seoul-corpus': {
    id: 'seoul-corpus-speech-aux',
    name: 'Seoul Corpus Korean spontaneous speech auxiliary corpus',
    sourceUrl: 'https://www.openslr.org/113/',
    outDirName: 'seoul-corpus-speech',
    licenseStatus: 'cc-by-nc-2.0-research-only',
    redistribution: 'original-license-noncommercial',
    modelPublishing: 'not-singing-data-release-review-required',
    licenseLabel: 'CC BY-NC 2.0',
    audioHours: null,
    annotationTypes: ['tgz', 'flac', 'textgrid', 'manual'],
    allowedActions: {
      localTraining: false,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: [
      'OpenSLR SLR113 lists Seoul Corpus as CC BY-NC 2.0.',
      'It is phonetically labeled spontaneous Korean speech, not singing data.',
      'Use only as noncommercial auxiliary phonetic-label evidence after local review.',
    ],
    files: [
      {
        name: 'readme.tgz',
        url: 'https://openslr.trmal.net/resources/113/readme.tgz',
        description: 'Readme, manual, search script, sample screenshot, and paper',
      },
      {
        name: 'label.tgz',
        url: 'https://openslr.trmal.net/resources/113/label.tgz',
        description: 'Praat TextGrid label files',
      },
      {
        name: 'sound.tgz',
        url: 'https://openslr.trmal.net/resources/113/sound.tgz',
        description: 'FLAC sound files',
      },
    ],
  },
  'pansori-tedxkr': {
    id: 'pansori-tedxkr-reference-only',
    name: 'Pansori TEDxKR reference corpus',
    sourceUrl: 'https://www.openslr.org/58/',
    outDirName: 'pansori-tedxkr-reference',
    licenseStatus: 'cc-by-nc-nd-4.0-reference-only',
    redistribution: 'no-derivatives-noncommercial',
    modelPublishing: 'not-allowed-without-separate-rights-review',
    licenseLabel: 'CC BY-NC-ND 4.0',
    audioHours: 3,
    annotationTypes: ['tar.gz', 'flac', 'transcript'],
    allowedActions: {
      localTraining: false,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: [
      'OpenSLR SLR58 lists Pansori-TEDxKR as CC BY-NC-ND 4.0.',
      'NoDerivatives makes model training/derivative release risky; keep this reference-only unless separate rights are reviewed.',
      'It is Korean TEDx speech, not singing data.',
    ],
    files: [
      {
        name: 'pansori-tedxkr-corpus-1.0.tar.gz',
        url: 'https://openslr.trmal.net/resources/58/pansori-tedxkr-corpus-1.0.tar.gz',
        description: 'Korean TEDx speech and transcripts',
      },
    ],
  },
  'deeply-korean-read': {
    id: 'deeply-korean-read-reference-only',
    name: 'Deeply Korean read speech reference corpus',
    sourceUrl: 'https://www.openslr.org/97/',
    outDirName: 'deeply-korean-read-reference',
    licenseStatus: 'cc-by-nc-nd-4.0-reference-only',
    redistribution: 'no-derivatives-noncommercial',
    modelPublishing: 'not-allowed-without-separate-rights-review',
    licenseLabel: 'CC BY-NC-ND 4.0',
    audioHours: 3,
    annotationTypes: ['tar.gz', 'audio', 'json', 'text'],
    allowedActions: {
      localTraining: false,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: [
      'OpenSLR SLR97 lists Deeply Korean read speech as CC BY-NC-ND 4.0.',
      'NoDerivatives makes model training/derivative release risky; keep this reference-only unless separate rights are reviewed.',
      'It is read speech, not singing data.',
    ],
    files: [
      {
        name: 'KoreanReadSpeechCorpus.tar.gz',
        url: 'https://openslr.trmal.net/resources/97/KoreanReadSpeechCorpus.tar.gz',
        description: 'Korean read speech corpus',
      },
    ],
  },
  'deeply-parent-child-vocal': {
    id: 'deeply-parent-child-vocal-reference-only',
    name: 'Deeply parent-child vocal interaction reference corpus',
    sourceUrl: 'https://www.openslr.org/98/',
    outDirName: 'deeply-parent-child-vocal-reference',
    licenseStatus: 'cc-by-nc-nd-4.0-reference-only',
    redistribution: 'no-derivatives-noncommercial',
    modelPublishing: 'not-allowed-without-separate-rights-review',
    licenseLabel: 'CC BY-NC-ND 4.0',
    audioHours: 16,
    annotationTypes: ['tar.gz', 'audio', 'json', 'singing-labels'],
    allowedActions: {
      localTraining: false,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: [
      'OpenSLR SLR98 lists Deeply parent-child vocal interaction as CC BY-NC-ND 4.0.',
      'The public sample includes Korean parent/child interactions with label 0 for singing, but NoDerivatives blocks normal model-training use without separate rights review.',
      'Keep this as reference-only evidence for Korean singing/noise/reverb labels, not as a training dataset.',
    ],
    files: [
      {
        name: 'Parent-ChildVocalInteraction.tar.gz',
        url: 'https://openslr.trmal.net/resources/98/Parent-ChildVocalInteraction.tar.gz',
        description: 'Korean parent-child vocal interaction sample with singing/reading/other labels',
      },
    ],
  },
}

export async function downloadOpenSlrKoreanSpeech(options = {}) {
  const presets = { ...OPENSLR_KOREAN_PRESETS, ...(options.presets ?? {}) }
  const presetName = options.preset ?? 'zeroth-korean'
  const preset = presets[presetName]
  if (!preset) {
    throw new Error(`Unknown OpenSLR Korean speech preset: ${presetName}. Available: ${Object.keys(presets).join(', ')}`)
  }
  const outRoot = resolve(options.outRoot ?? DEFAULT_OUT_ROOT)
  const outDir = resolve(options.outDir ?? join(outRoot, preset.outDirName))
  const archiveDir = resolve(options.archiveDir ?? join(outDir, 'archives'))
  const manifestPath = resolve(options.manifest ?? join(outDir, `${presetName}.manifest.json`))
  const registryPath = resolve(options.registry ?? join(outDir, 'dataset-registry.local.json'))
  const force = options.force === true
  const skipDownload = options.skipDownload === true
  const concurrency = positiveInteger(options.concurrency, 1)
  const retries = nonNegativeInteger(options.retries, 6)
  const retryBaseDelayMs = positiveInteger(options.retryBaseDelayMs, 1500)

  mkdirSync(archiveDir, { recursive: true })
  const selectedFiles = options.metadataOnly ? preset.files.filter((file) => file.name.toLowerCase().includes('readme')) : preset.files
  const files = await mapLimit(selectedFiles, concurrency, async (file) => {
    const localPath = join(archiveDir, file.name)
    const remote = await inspectRemoteFile(file.url)
    const expectedSizeBytes = remote.sizeBytes
    const existed = existsSync(localPath)
    const existingSize = existed ? statSync(localPath).size : null
    const canReuse = existed && !force && (expectedSizeBytes == null || existingSize === expectedSizeBytes)

    if (!skipDownload && !canReuse) {
      await downloadFile(file.url, localPath, { retries, retryBaseDelayMs })
    }

    const present = existsSync(localPath)
    const sizeBytes = present ? statSync(localPath).size : null
    if (present && expectedSizeBytes != null && sizeBytes !== expectedSizeBytes) {
      throw new Error(`${presetName} archive size mismatch for ${file.name}: expected ${expectedSizeBytes}, got ${sizeBytes}.`)
    }
    return {
      name: file.name,
      description: file.description,
      url: file.url,
      localPath,
      expectedSizeBytes,
      sizeBytes,
      sha256: present ? await sha256File(localPath) : null,
      status: skipDownload ? (present ? 'present-skip-download' : 'planned') : canReuse ? 'reused' : 'downloaded',
    }
  })

  const registry = {
    version: 1,
    notes:
      'Local registry generated from OpenSLR Korean public speech resources. These are auxiliary speech/reference datasets and do not satisfy the Korean singing dataset milestone.',
    datasets: [openSlrDatasetEntry(preset, outDir)],
  }
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: `openslr:${presetName}`,
    sourceUrl: preset.sourceUrl,
    licenseStatus: preset.licenseStatus,
    outDir,
    archiveDir,
    registryPath,
    files,
    metrics: {
      fileCount: files.length,
      presentFileCount: files.filter((file) => file.sha256).length,
      totalExpectedBytes: files.reduce((sum, file) => sum + (file.expectedSizeBytes ?? 0), 0),
      totalPresentBytes: files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
    },
    nextCommands: [
      `npm run neural:audit-datasets -- --registry ${relativePath(registryPath)} --dataset ${preset.id}`,
      'Extract and map sidecars only if the license and auxiliary-use plan are still acceptable.',
    ],
  }

  writeJson(registryPath, registry)
  writeJson(manifestPath, manifest)
  writeFileSync(join(outDir, 'README.md'), datasetReadme({ preset, manifestPath, registryPath }))
  return manifest
}

export function openSlrDatasetEntry(preset, localPath) {
  return {
    id: preset.id,
    name: preset.name,
    sourceUrl: preset.sourceUrl,
    localPath,
    licenseStatus: preset.licenseStatus,
    redistribution: preset.redistribution,
    modelPublishing: preset.modelPublishing,
    singerIdentity: preset.id.includes('reference-only') ? 'public-speech-reference' : 'public-speech-dataset',
    language: ['ko'],
    audioHours: preset.audioHours,
    annotationTypes: preset.annotationTypes,
    allowedActions: preset.allowedActions,
    reviewNotes: preset.reviewNotes,
  }
}

async function inspectRemoteFile(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    if (!response.ok) {
      return { sizeBytes: null }
    }
    const size = response.headers.get('content-length')
    return {
      sizeBytes: size && /^\d+$/u.test(size) ? Number(size) : null,
    }
  } catch {
    return { sizeBytes: null }
  }
}

async function downloadFile(url, localPath, options = {}) {
  const retries = nonNegativeInteger(options.retries, 6)
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function datasetReadme({ preset, manifestPath, registryPath }) {
  return [
    `# ${preset.name}`,
    '',
    'This ignored folder is generated by `npm run neural:download-openslr-korean`.',
    '',
    `- Source: ${preset.sourceUrl}`,
    `- License: ${preset.licenseLabel}`,
    '- Use: Korean speech auxiliary/reference data only',
    '- Important: this is not singing data and does not satisfy the Korean SVS dataset milestone.',
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
    if (arg === '--preset') {
      parsed.preset = argv[++index]
    } else if (arg === '--out-root') {
      parsed.outRoot = argv[++index]
    } else if (arg === '--out-dir') {
      parsed.outDir = argv[++index]
    } else if (arg === '--archive-dir') {
      parsed.archiveDir = argv[++index]
    } else if (arg === '--manifest') {
      parsed.manifest = argv[++index]
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--metadata-only') {
      parsed.metadataOnly = true
    } else if (arg === '--force') {
      parsed.force = true
    } else if (arg === '--skip-download') {
      parsed.skipDownload = true
    } else if (arg === '--concurrency') {
      parsed.concurrency = Number(argv[++index])
    } else if (arg === '--retries') {
      parsed.retries = Number(argv[++index])
    } else if (arg === '--retry-base-delay-ms') {
      parsed.retryBaseDelayMs = Number(argv[++index])
    } else if (arg === '--summary') {
      parsed.summary = true
    } else if (arg === '--list-presets') {
      process.stdout.write(`${Object.keys(OPENSLR_KOREAN_PRESETS).join('\n')}\n`)
      process.exit(0)
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/download-openslr-korean-speech.mjs [options]',
          '',
          'Options:',
          `  --preset name        One of: ${Object.keys(OPENSLR_KOREAN_PRESETS).join(', ')}`,
          '  --out-root path      Ignored local dataset root',
          '  --out-dir path       Ignored local dataset directory',
          '  --archive-dir path   Archive download directory',
          '  --manifest path      Output manifest JSON',
          '  --registry path      Output local dataset registry JSON',
          '  --metadata-only      Download only readme/manual-like files when the preset has them',
          '  --force              Redownload even when a matching local file exists',
          '  --skip-download      Write a planned manifest without downloading missing files',
          '  --concurrency n      Parallel downloads, default 1',
          '  --retries n          Retry count for 429/5xx/network failures, default 6',
          '  --retry-base-delay-ms n',
          '                       Initial retry backoff in milliseconds, default 1500',
          '  --summary            Print only manifest metrics and next commands',
          '  --list-presets       Print available preset names',
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
    const manifest = await downloadOpenSlrKoreanSpeech(options)
    const presetName = options.preset ?? 'zeroth-korean'
    const output = options.summary
      ? {
          manifestPath: options.manifest ?? join(options.outDir ?? join(options.outRoot ?? DEFAULT_OUT_ROOT, OPENSLR_KOREAN_PRESETS[presetName]?.outDirName ?? presetName), `${presetName}.manifest.json`),
          registryPath: options.registry ?? join(options.outDir ?? join(options.outRoot ?? DEFAULT_OUT_ROOT, OPENSLR_KOREAN_PRESETS[presetName]?.outDirName ?? presetName), 'dataset-registry.local.json'),
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
