#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_REGISTRY = 'experiments/neural-singer/dataset-registry.example.json'
const AUDIO_EXTENSIONS = new Set(['.wav', '.flac', '.mp3', '.ogg', '.m4a', '.aac'])
const ANNOTATION_EXTENSIONS = new Set(['.txt', '.lab', '.json', '.csv'])
const SCORE_EXTENSIONS = new Set(['.mid', '.midi', '.ust', '.ustx'])
const MAX_TEXT_PROBE_BYTES = 256 * 1024

export function inspectNeuralDatasetIntake(options = {}) {
  const registryPath = resolve(options.registry ?? DEFAULT_REGISTRY)
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : null
  const dataset = findDataset(registry, options.dataset)
  if (!dataset && !options.localPath) {
    throw new Error('Missing --dataset or --local-path.')
  }
  const localPath = resolve(options.localPath ?? dataset?.localPath ?? '')
  const reportPath = options.report ? resolve(options.report) : null
  const maxSamples = positiveInteger(options.maxSamples, 24)
  const expectedAnnotatedRatio = ratioNumber(dataset?.qualityGates?.minAnnotatedRatio, ratioNumber(options.minAnnotatedRatio, 0.95))
  const report = buildIntakeReport({
    registryPath,
    dataset,
    localPath,
    expectedAnnotatedRatio,
    maxSamples,
  })

  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

function buildIntakeReport({ registryPath, dataset, localPath, expectedAnnotatedRatio, maxSamples }) {
  const exists = Boolean(localPath && existsSync(localPath))
  const files = exists ? collectFiles(localPath) : []
  const roots = inspectRoots(localPath, files)
  const archiveFiles = files.filter((file) => isArchiveFile(file.path))
  const audioFiles = files.filter((file) => AUDIO_EXTENSIONS.has(extname(file.path).toLowerCase()) && !isGuideAudioArtifact(localPath, file.path))
  const ignoredGuideAudioFiles = files.filter((file) => AUDIO_EXTENSIONS.has(extname(file.path).toLowerCase()) && isGuideAudioArtifact(localPath, file.path))
  const annotationFiles = files.filter((file) => isAnnotationCandidate(localPath, file.path))
  const scoreFiles = files.filter((file) => SCORE_EXTENSIONS.has(extname(file.path).toLowerCase()))
  const annotationPairing = exists ? inspectAnnotationPairing(localPath, audioFiles, maxSamples, expectedAnnotatedRatio) : emptyPairing(expectedAnnotatedRatio)
  const structuredMetadata = inspectStructuredMetadata(localPath, annotationFiles, maxSamples)
  const licenseReview = inspectLicenseReview(localPath, dataset)
  const readiness = intakeReadiness({
    exists,
    archiveFiles,
    audioFiles,
    annotationPairing,
    structuredMetadata,
    expectedAnnotatedRatio,
    dataset,
    localPath,
    registryPath,
    licenseReview,
  })
  const acquisition = inspectAcquisitionStage({
    dataset,
    readiness,
    licenseReview,
    archiveFiles,
    audioFiles,
    annotationPairing,
    structuredMetadata,
    expectedAnnotatedRatio,
    registryPath,
  })

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    registryPath,
    datasetId: dataset?.id ?? null,
    datasetName: dataset?.name ?? null,
    sourceUrl: dataset?.sourceUrl ?? null,
    localPath,
    ok: readiness.pathReady && (readiness.hasProviderArchive || readiness.hasTrainingAudio),
    roots,
    files: {
      totalCount: files.length,
      totalSizeBytes: sumSizes(files),
      extensions: extensionCounts(files),
      samples: sampleRelativePaths(localPath, files, maxSamples),
    },
    archives: {
      count: archiveFiles.length,
      totalSizeBytes: sumSizes(archiveFiles),
      extensions: extensionCounts(archiveFiles),
      samples: sampleRelativePaths(localPath, archiveFiles, maxSamples),
    },
    audio: {
      trainingFileCount: audioFiles.length,
      ignoredGuideAudioCount: ignoredGuideAudioFiles.length,
      extensions: extensionCounts(audioFiles),
      samples: sampleRelativePaths(localPath, audioFiles, maxSamples),
    },
    annotations: {
      fileCount: annotationFiles.length,
      extensions: extensionCounts(annotationFiles),
      samples: sampleRelativePaths(localPath, annotationFiles, maxSamples),
      pairing: annotationPairing,
      structuredMetadata,
    },
    scores: {
      fileCount: scoreFiles.length,
      extensions: extensionCounts(scoreFiles),
      samples: sampleRelativePaths(localPath, scoreFiles, maxSamples),
    },
    licenseReview,
    acquisition,
    readiness,
    nextCommands: nextCommands(dataset, registryPath),
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
  const files = []
  walk(root, (path) => {
    const stats = statSync(path)
    files.push({
      path,
      sizeBytes: stats.size,
    })
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

function inspectRoots(localPath, files) {
  return Object.fromEntries(
    ['raw', 'extracted', 'metadata'].map((name) => {
      const path = join(localPath, name)
      const childFiles = files.filter((file) => relative(path, file.path) && !relative(path, file.path).startsWith('..'))
      return [
        name,
        {
          path,
          exists: existsSync(path),
          fileCount: childFiles.length,
          sizeBytes: sumSizes(childFiles),
          extensions: extensionCounts(childFiles),
        },
      ]
    }),
  )
}

function isArchiveFile(path) {
  const lower = path.toLowerCase()
  return ['.zip', '.7z', '.rar', '.tar', '.tgz', '.tar.gz', '.tar.bz2', '.tar.xz'].some((suffix) => lower.endsWith(suffix))
}

function inspectAnnotationPairing(root, audioFiles, maxSamples, expectedAnnotatedRatio) {
  const missing = []
  const paired = []
  const extensionCountsByPair = {}
  for (const file of audioFiles) {
    const sidecar = findAnnotationSidecar(file.path)
    if (sidecar) {
      paired.push(file)
      extensionCountsByPair[sidecar.extension] = (extensionCountsByPair[sidecar.extension] ?? 0) + 1
    } else if (missing.length < maxSamples) {
      missing.push(relative(root, file.path))
    }
  }
  const missingCount = audioFiles.length - paired.length
  return {
    expectedAnnotatedRatio,
    pairedCount: paired.length,
    missingCount,
    annotatedRatio: audioFiles.length > 0 ? paired.length / audioFiles.length : 0,
    missing,
    missingOmittedCount: Math.max(0, missingCount - missing.length),
    extensions: extensionCountsByPair,
  }
}

function emptyPairing(expectedAnnotatedRatio) {
  return {
    expectedAnnotatedRatio,
    pairedCount: 0,
    missingCount: 0,
    annotatedRatio: 0,
    missing: [],
    missingOmittedCount: 0,
    extensions: {},
  }
}

function findAnnotationSidecar(audioPath) {
  for (const candidate of sidecarCandidates(audioPath)) {
    if (existsSync(candidate.path) && statSync(candidate.path).isFile()) {
      return candidate
    }
  }
  return null
}

function sidecarCandidates(audioPath) {
  const extensionOrder = ['.txt', '.lab', '.json', '.csv']
  const audioExtension = extname(audioPath)
  const stem = basename(audioPath, audioExtension)
  const audioDir = dirname(audioPath)
  const base = join(audioDir, stem)
  const parentDir = dirname(audioDir)
  const siblingDirs = ['lyric', 'lyrics', 'label', 'labels', 'csv', 'json', 'metadata']
  const candidates = []
  for (const extension of extensionOrder) {
    candidates.push({ path: `${base}${extension}`, extension })
    for (const siblingDir of siblingDirs) {
      candidates.push({ path: join(parentDir, siblingDir, `${stem}${extension}`), extension })
    }
  }
  const seen = new Set()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) {
      return false
    }
    seen.add(candidate.path)
    return true
  })
}

function inspectStructuredMetadata(root, annotationFiles, maxSamples) {
  const inspected = []
  const aggregate = {
    timingFileCount: 0,
    lyricFileCount: 0,
    pitchFileCount: 0,
    hangulFileCount: 0,
    audioReferenceFileCount: 0,
  }

  for (const file of annotationFiles) {
    const extension = extname(file.path).toLowerCase()
    if (!['.json', '.csv', '.txt', '.lab'].includes(extension)) {
      continue
    }
    const text = readTextProbe(file.path)
    const features = {
      timing: hasTimingFields(text),
      lyric: hasLyricFields(text),
      pitch: hasPitchFields(text),
      hangul: /[\uac00-\ud7a3]/u.test(text),
      audioReference: /\.(wav|flac|mp3|ogg|m4a|aac)\b/iu.test(text) || /\b(audio|wav|filename|file_name)\b/iu.test(text),
    }
    if (features.timing) aggregate.timingFileCount += 1
    if (features.lyric) aggregate.lyricFileCount += 1
    if (features.pitch) aggregate.pitchFileCount += 1
    if (features.hangul) aggregate.hangulFileCount += 1
    if (features.audioReference) aggregate.audioReferenceFileCount += 1
    if (inspected.length < maxSamples) {
      inspected.push({
        path: relative(root, file.path),
        extension,
        sizeBytes: file.sizeBytes,
        features,
      })
    }
  }

  return {
    inspectedCount: annotationFiles.length,
    ...aggregate,
    hasNoteTimingAndPitch: aggregate.timingFileCount > 0 && aggregate.pitchFileCount > 0,
    hasKoreanLyrics: aggregate.hangulFileCount > 0 || aggregate.lyricFileCount > 0,
    samples: inspected,
  }
}

function isAnnotationCandidate(root, path) {
  if (!ANNOTATION_EXTENSIONS.has(extname(path).toLowerCase())) {
    return false
  }
  const relativePath = relative(root, path)
  const fileName = basename(path).toLowerCase()
  if (
    fileName.startsWith('dataset-registry.') ||
    fileName.endsWith('.manifest.json') ||
    fileName === 'manifest.json' ||
    fileName === 'package.json' ||
    fileName === 'readme.txt' ||
    fileName === 'license.txt'
  ) {
    return false
  }
  if (/license-review|consent-form/u.test(fileName)) {
    return false
  }
  return !relativePath.startsWith('node_modules/')
}

function readTextProbe(path) {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(MAX_TEXT_PROBE_BYTES)
    const bytesRead = readSync(fd, buffer, 0, MAX_TEXT_PROBE_BYTES, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function hasTimingFields(text) {
  return /\b(start|start[_ -]?time|onset|offset|end|end[_ -]?time|duration|dur)\b/iu.test(text)
}

function hasLyricFields(text) {
  return /\b(lyric|lyrics|text|syllable|phoneme|phone|pronunciation|가사|발음)\b/iu.test(text)
}

function hasPitchFields(text) {
  return /\b(midi|midi[_ -]?num|note[_ -]?num|pitch|f0|frequency|hz)\b/iu.test(text)
}

function inspectLicenseReview(localPath, dataset) {
  const review = dataset?.licenseReview && typeof dataset.licenseReview === 'object' ? dataset.licenseReview : {}
  const templatePath = resolveDatasetPath(localPath, review.templatePath)
  const reviewedPath = resolveDatasetPath(localPath, review.reviewedPath)
  const reviewedExists = Boolean(reviewedPath && existsSync(reviewedPath))
  const fields = reviewedExists ? readLicenseReviewFields(reviewedPath) : {}
  return {
    requiresReview: review.requiresReview === true,
    templatePath,
    templateExists: Boolean(templatePath && existsSync(templatePath)),
    reviewedPath,
    reviewedExists,
    filledFields: {
      reviewer: Boolean(fields.reviewer),
      reviewDate: Boolean(fields.reviewDate),
      accountDownloadApprovalConfirmed: isYes(fields.accountDownloadApprovalConfirmed),
      localTrainingAllowed: isYes(fields.localTrainingAllowed),
      publicModelReleaseAllowed: isYes(fields.publicModelReleaseAllowed),
      publicAudioExamplesAllowed: isYes(fields.publicAudioExamplesAllowed),
    },
  }
}

function intakeReadiness({
  exists,
  archiveFiles,
  audioFiles,
  annotationPairing,
  structuredMetadata,
  expectedAnnotatedRatio,
  dataset,
  localPath,
  registryPath,
  licenseReview,
}) {
  const hasProviderArchive = archiveFiles.length > 0
  const hasTrainingAudio = audioFiles.length > 0
  const sameStemReady = hasTrainingAudio && annotationPairing.annotatedRatio >= expectedAnnotatedRatio
  const hasStructuredNoteMetadata = structuredMetadata.hasNoteTimingAndPitch && structuredMetadata.hasKoreanLyrics
  const needsMetadataAdapter = hasTrainingAudio && !sameStemReady && hasStructuredNoteMetadata
  const warnings = []
  const blockers = []

  if (!exists) {
    blockers.push('Local dataset path does not exist.')
  } else if (!hasProviderArchive && !hasTrainingAudio) {
    blockers.push('No provider archives or extracted training audio found yet.')
  }
  if (hasProviderArchive && !hasTrainingAudio) {
    warnings.push('Provider archives are present, but no extracted training audio was found.')
  }
  if (hasTrainingAudio && !sameStemReady) {
    blockers.push(
      `Only ${(annotationPairing.annotatedRatio * 100).toFixed(1)}% of training audio has same-stem or sibling annotations; expected ${(expectedAnnotatedRatio * 100).toFixed(1)}%.`,
    )
  }
  if (needsMetadataAdapter) {
    warnings.push('Structured note metadata is present, but it is not paired by same stem yet. Add a dataset-specific mapping adapter before ingest.')
  }
  if (dataset?.allowedActions?.localTraining === true && licenseReview.requiresReview && !licenseReview.filledFields.localTrainingAllowed) {
    blockers.push('Local training is enabled, but the license review does not confirm Local training allowed: yes.')
  }
  if (dataset?.allowedActions?.localTraining !== true) {
    warnings.push('Dataset registry still has allowedActions.localTraining=false; audit/ingest requires review or --allow-unreviewed.')
  }

  return {
    pathReady: exists,
    hasProviderArchive,
    hasTrainingAudio,
    sameStemAnnotationReady: sameStemReady,
    structuredNoteMetadataReady: hasStructuredNoteMetadata,
    needsExtraction: hasProviderArchive && !hasTrainingAudio,
    needsMetadataAdapter,
    ingestReady: hasTrainingAudio && sameStemReady,
    expectedAnnotatedRatio,
    blockers,
    warnings,
    suggestedDatasetRoot: suggestedDatasetRoot(localPath, audioFiles),
    suggestedRegistry: registryPath,
  }
}

function inspectAcquisitionStage({
  dataset,
  readiness,
  licenseReview,
  archiveFiles,
  audioFiles,
  annotationPairing,
  structuredMetadata,
  expectedAnnotatedRatio,
  registryPath,
}) {
  const hasArchives = archiveFiles.length > 0
  const hasAudio = audioFiles.length > 0
  const reviewComplete = !licenseReview.requiresReview || (
    licenseReview.filledFields.reviewer &&
    licenseReview.filledFields.reviewDate &&
    licenseReview.filledFields.accountDownloadApprovalConfirmed &&
    licenseReview.filledFields.localTrainingAllowed
  )
  const sidecarCandidate = hasAudio && structuredMetadata.hasNoteTimingAndPitch && structuredMetadata.hasKoreanLyrics && !readiness.sameStemAnnotationReady
  const stage = acquisitionStage({ readiness, hasArchives, hasAudio, reviewComplete, sidecarCandidate })
  const blockers = []
  const nextActions = []

  if (!readiness.pathReady) {
    blockers.push('Create the local ignored intake folder before downloading provider data.')
    nextActions.push('Run neural:prepare-dataset-intake for the chosen preset.')
  } else if (!hasArchives && !hasAudio) {
    blockers.push('Provider data has not been acquired yet.')
    nextActions.push(`Download the dataset from ${dataset?.sourceUrl ?? 'the provider'} after account/access approval, then place original archives under raw/.`)
  }
  if (hasArchives && !hasAudio) {
    nextActions.push('Extract provider archives into extracted/ and rerun inspect-intake.')
  }
  if (hasAudio && !reviewComplete) {
    blockers.push('License review is not complete enough to allow local training.')
    nextActions.push('Copy metadata/license-review.local.template.md to metadata/license-review.local.md and fill reviewer, date, account/download approval, and Local training allowed: yes.')
  }
  if (hasAudio && annotationPairing.annotatedRatio < expectedAnnotatedRatio) {
    blockers.push(`Training audio annotation pairing is below ${(expectedAnnotatedRatio * 100).toFixed(1)}%.`)
    if (sidecarCandidate) {
      nextActions.push(`Run neural:materialize-sidecars with --registry ${registryPath} --dataset ${dataset?.id ?? '<dataset-id>'}, then rerun inspect-intake.`)
    } else {
      nextActions.push('Add same-stem or sibling lyric/note sidecars beside the extracted audio before ingest.')
    }
  }
  if (readiness.ingestReady && !reviewComplete) {
    nextActions.push('Keep ingest blocked until the local license review is complete.')
  }
  if (readiness.ingestReady && reviewComplete) {
    nextActions.push(`Run neural:audit-datasets and a limited neural:ingest-dataset slice for ${dataset?.id ?? 'this dataset'}.`)
  }

  return {
    stage,
    sourceUrl: dataset?.sourceUrl ?? null,
    providerDataAcquired: hasArchives || hasAudio,
    providerArchiveCount: archiveFiles.length,
    trainingAudioCount: audioFiles.length,
    licenseReviewComplete: reviewComplete,
    annotationPairingReady: readiness.sameStemAnnotationReady,
    structuredMetadataReady: readiness.structuredNoteMetadataReady,
    sidecarMaterializationCandidate: sidecarCandidate,
    canStartDatasetAudit: hasAudio && reviewComplete,
    canStartIngest: readiness.ingestReady && reviewComplete,
    blockers,
    nextActions: dedupe(nextActions),
  }
}

function acquisitionStage({ readiness, hasArchives, hasAudio, reviewComplete, sidecarCandidate }) {
  if (!readiness.pathReady) {
    return 'missing-intake-folder'
  }
  if (!hasArchives && !hasAudio) {
    return 'awaiting-provider-download'
  }
  if (hasArchives && !hasAudio) {
    return 'archive-ready-for-extraction'
  }
  if (sidecarCandidate) {
    return 'metadata-ready-needs-sidecars'
  }
  if (hasAudio && !readiness.sameStemAnnotationReady) {
    return 'extracted-needs-annotations'
  }
  if (readiness.ingestReady && !reviewComplete) {
    return 'ingest-ready-needs-license-review'
  }
  if (readiness.ingestReady && reviewComplete) {
    return 'ready-for-audit-and-ingest'
  }
  return 'needs-review'
}

function suggestedDatasetRoot(localPath, audioFiles) {
  const extracted = join(localPath, 'extracted')
  if (audioFiles.some((file) => !relative(extracted, file.path).startsWith('..'))) {
    return extracted
  }
  return localPath
}

function dedupe(values) {
  return [...new Set(values)]
}

function nextCommands(dataset, registryPath) {
  if (!dataset?.id) {
    return []
  }
  return [
    `npm run neural:inspect-intake -- --registry ${registryPath} --dataset ${dataset.id}`,
    `npm run neural:extract-dataset -- --registry ${registryPath} --dataset ${dataset.id} --report experiments/neural-singer/work/${dataset.id}-extract.json`,
    `npm run neural:audit-datasets -- --registry ${registryPath} --dataset ${dataset.id} --min-local-training-minutes 30`,
    `npm run neural:ingest-dataset -- --registry ${registryPath} --dataset ${dataset.id} --out experiments/neural-singer/work/${dataset.id}-ingest-slice --limit-files 10`,
  ]
}

function sampleRelativePaths(root, files, maxSamples) {
  return files.slice(0, maxSamples).map((file) => relative(root, file.path))
}

function extensionCounts(files) {
  return files.reduce((counts, file) => {
    const extension = (archiveExtension(file.path) ?? extname(file.path).toLowerCase()) || '(none)'
    counts[extension] = (counts[extension] ?? 0) + 1
    return counts
  }, {})
}

function archiveExtension(path) {
  const lower = path.toLowerCase()
  for (const suffix of ['.tar.gz', '.tar.bz2', '.tar.xz']) {
    if (lower.endsWith(suffix)) {
      return suffix
    }
  }
  return null
}

function sumSizes(files) {
  return files.reduce((sum, file) => sum + file.sizeBytes, 0)
}

function isGuideAudioArtifact(root, path) {
  const relativeParts = relative(root, path).split(/[\\/]+/u)
  const fileName = relativeParts.at(-1)?.toLowerCase() ?? ''
  return fileName.endsWith('.guide.wav') || relativeParts.slice(0, -1).some((part) => isGuideDirectoryName(part))
}

function isGuideDirectoryName(value) {
  return ['guides', 'guide-tracks'].includes(value.toLowerCase())
}

function resolveDatasetPath(localPath, value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  if (value.startsWith('/')) {
    return resolve(value)
  }
  if (value.startsWith('experiments/') || value.startsWith('docs/') || value.startsWith('scripts/')) {
    return resolve(value)
  }
  return resolve(localPath || '.', value)
}

function readLicenseReviewFields(path) {
  const text = readFileSync(path, 'utf8')
  return {
    reviewer: reviewFieldValue(text, 'Reviewer'),
    reviewDate: reviewFieldValue(text, 'Review date'),
    accountDownloadApprovalConfirmed: reviewFieldValue(text, 'Account/download approval confirmed'),
    localTrainingAllowed: reviewFieldValue(text, 'Local training allowed'),
    publicModelReleaseAllowed: reviewFieldValue(text, 'Public model release allowed'),
    publicAudioExamplesAllowed: reviewFieldValue(text, 'Public audio examples allowed'),
  }
}

function reviewFieldValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = text.match(new RegExp(`^-?\\s*${escaped}:\\s*(.+?)\\s*$`, 'imu'))
  return match?.[1]?.trim() ?? ''
}

function isYes(value) {
  return /^(yes|y|true|allowed|확인|예)$/iu.test(String(value ?? '').trim())
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function ratioNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback
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
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--max-samples') {
      parsed.maxSamples = Number(argv[++index])
    } else if (arg === '--min-annotated-ratio') {
      parsed.minAnnotatedRatio = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/inspect-neural-dataset-intake.mjs [options]',
          '',
          'Options:',
          `  --registry path              Dataset registry JSON, default ${DEFAULT_REGISTRY}`,
          '  --dataset id                 Dataset id from the registry',
          '  --local-path path            Inspect a local intake folder without a registry dataset',
          '  --report path                Write JSON report to path',
          '  --max-samples n              Maximum sample paths in the report, default 24',
          '  --min-annotated-ratio ratio  Expected same-stem/sibling annotation ratio, default 0.95',
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
    const report = inspectNeuralDatasetIntake(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
