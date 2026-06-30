#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_SOURCE = 'experiments/utau-v3/work/v3-listening-review'
export const DEFAULT_OUT = 'public/review/v3'

const REQUIRED_TOP_LEVEL_FILES = ['index.html', 'README.md', 'listening-scores.local.template.json']

export function publishUtauV3ListeningReview(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const sourceDir = resolve(cwd, options.source ?? DEFAULT_SOURCE)
  const outDir = resolve(cwd, options.out ?? DEFAULT_OUT)
  const manifestPath = join(sourceDir, 'review-manifest.json')
  const problems = []

  if (!existsSync(manifestPath)) {
    problems.push(`missing review manifest: ${manifestPath}`)
  }
  const manifest = problems.length === 0 ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
  if (manifest) {
    if (manifest.ok !== true || manifest.decision !== 'v3-listening-review-ready') {
      problems.push('review manifest must be ready before publishing')
    }
    if ((manifest.phraseCount ?? 0) < 4) {
      problems.push('review manifest must include at least four V3 phrases')
    }
    if ((manifest.comparisonCount ?? 0) < 4) {
      problems.push('review manifest must include at least four legacy V2 comparisons')
    }
  }

  const files = collectPublishFiles(sourceDir, manifest, problems)
  if (problems.length > 0) {
    return makeReport({ sourceDir, outDir, manifest, files: [], problems })
  }

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const file of files) {
    const target = join(outDir, file.relativePath)
    mkdirSync(dirname(target), { recursive: true })
    if (file.relativePath === 'review-manifest.json') {
      writeFileSync(target, `${JSON.stringify(sanitizeManifest(manifest, sourceDir), null, 2)}\n`)
    } else if (isTextAsset(file.relativePath)) {
      writeFileSync(target, sanitizePublicText(readFileSync(file.sourcePath, 'utf8'), sourceDir))
    } else {
      copyFileSync(file.sourcePath, target)
    }
  }

  const report = makeReport({
    sourceDir,
    outDir,
    manifest,
    files: files.map((file) => ({
      path: toPosix(file.relativePath),
      bytes: statSync(join(outDir, file.relativePath)).size,
    })),
    problems: [],
  })
  if (options.report) {
    writeFileSync(resolve(cwd, options.report), `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

function collectPublishFiles(sourceDir, manifest, problems) {
  const files = []
  for (const fileName of REQUIRED_TOP_LEVEL_FILES) {
    addFile(files, sourceDir, fileName, problems)
  }
  if (manifest) {
    addFile(files, sourceDir, 'review-manifest.json', problems)
    for (const item of [...(manifest.phrases ?? []), ...(manifest.comparisons ?? [])]) {
      const sourcePath = item.wavPath ? resolve(item.wavPath) : resolve(sourceDir, item.audioHref ?? '')
      if (!sourcePath.startsWith(`${sourceDir}${sep}`)) {
        problems.push(`review audio must stay inside source dir: ${sourcePath}`)
        continue
      }
      if (!existsSync(sourcePath)) {
        problems.push(`missing review audio: ${sourcePath}`)
        continue
      }
      const bytes = statSync(sourcePath).size
      if (bytes < 180_000) {
        problems.push(`review audio is unexpectedly small: ${sourcePath}`)
      }
      files.push({
        sourcePath,
        relativePath: relative(sourceDir, sourcePath),
      })
    }
  }
  return dedupeFiles(files)
}

function addFile(files, sourceDir, relativePath, problems) {
  const sourcePath = join(sourceDir, relativePath)
  if (!existsSync(sourcePath)) {
    problems.push(`missing review file: ${sourcePath}`)
    return
  }
  files.push({ sourcePath, relativePath })
}

function dedupeFiles(files) {
  const seen = new Set()
  return files.filter((file) => {
    const key = file.relativePath
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function sanitizeManifest(manifest, sourceDir) {
  const output = {
    ...manifest,
    publishedForWeb: true,
    sourceOutDir: undefined,
    outDir: 'public/review/v3',
    audioDir: 'public/review/v3/audio',
    indexHtmlPath: 'public/review/v3/index.html',
    readmePath: 'public/review/v3/README.md',
    listeningTemplatePath: 'public/review/v3/listening-scores.local.template.json',
    phrases: (manifest.phrases ?? []).map((phrase) => sanitizeReviewItem(phrase, sourceDir)),
    comparisons: (manifest.comparisons ?? []).map((comparison) => sanitizeReviewItem(comparison, sourceDir)),
  }
  delete output.sourceOutDir
  return sanitizeValue(output, sourceDir)
}

function sanitizeReviewItem(item, sourceDir) {
  const sourcePath = item.wavPath ? resolve(item.wavPath) : resolve(sourceDir, item.audioHref ?? '')
  const audioHref = item.audioHref ?? toPosix(relative(sourceDir, sourcePath))
  return {
    ...item,
    wavPath: audioHref,
    audioHref,
    wav: item.wav
      ? {
          ...item.wav,
          path: audioHref,
        }
      : item.wav,
  }
}

function isTextAsset(path) {
  return /\.(html|json|md|txt)$/iu.test(path)
}

function sanitizePublicText(text, sourceDir) {
  const source = toPosix(sourceDir)
  return text
    .replaceAll(`${source}/`, '')
    .replaceAll(source, '.')
    .replaceAll(`${sourceDir}${sep}`, '')
    .replaceAll(sourceDir, '.')
}

function sanitizeValue(value, sourceDir) {
  if (typeof value === 'string') {
    return sanitizePublicText(value, sourceDir)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, sourceDir))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, sourceDir)]))
  }
  return value
}

function makeReport({ sourceDir, outDir, manifest, files, problems }) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'v3-listening-review-published' : 'v3-listening-review-publish-blocked',
    sourceDir,
    outDir,
    reviewUrlPath: 'review/v3/index.html',
    phraseCount: manifest?.phraseCount ?? 0,
    comparisonCount: manifest?.comparisonCount ?? 0,
    files,
    problems,
  }
}

function toPosix(path) {
  return path.split(sep).join('/')
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--source') {
      options.source = argv[++index]
    } else if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node scripts/publish-utau-v3-listening-review.mjs [options]',
          '',
          'Options:',
          `  --source path   Source review dir, default ${DEFAULT_SOURCE}`,
          `  --out path      Public output dir, default ${DEFAULT_OUT}`,
          '  --report path   Optional JSON report path',
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
  const report = publishUtauV3ListeningReview(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    process.exit(1)
  }
}
