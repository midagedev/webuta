#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AUDIO_EXTENSIONS = new Set(['.wav', '.flac', '.mp3', '.ogg', '.m4a', '.aac'])

export function auditNeuralDatasets(options = {}) {
  const registryPath = resolve(options.registry ?? 'experiments/neural-singer/dataset-registry.example.json')
  const reportPath = options.report ? resolve(options.report) : null
  const minLocalTrainingSeconds = positiveNumber(options.minLocalTrainingMinutes, 0) * 60
  const minAnnotatedRatio = ratioNumber(options.minAnnotatedRatio, 0)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  const problems = validateRegistryShape(registry)
  const registryDatasets = Array.isArray(registry.datasets) ? registry.datasets : []
  const selectedDatasets =
    typeof options.dataset === 'string' && options.dataset.length > 0
      ? registryDatasets.filter((dataset) => dataset.id === options.dataset)
      : registryDatasets
  if (typeof options.dataset === 'string' && options.dataset.length > 0 && selectedDatasets.length === 0) {
    problems.push(`Dataset not found in registry: ${options.dataset}.`)
  }
  const datasets = selectedDatasets.map((dataset) => auditDataset(dataset, { minLocalTrainingSeconds, minAnnotatedRatio }))
  const report = {
    version: 1,
    registryPath,
    generatedAt: new Date().toISOString(),
    gates: {
      minLocalTrainingMinutes: minLocalTrainingSeconds / 60,
      minAnnotatedRatio,
    },
    datasetFilter: options.dataset ?? null,
    ok: problems.length === 0 && datasets.every((dataset) => dataset.problems.length === 0),
    problems,
    datasets,
  }

  if (reportPath) {
    mkdirp(dirname(reportPath))
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--dataset') {
      parsed.dataset = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--min-local-training-minutes') {
      parsed.minLocalTrainingMinutes = Number(argv[++index])
    } else if (arg === '--min-annotated-ratio') {
      parsed.minAnnotatedRatio = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-neural-datasets.mjs [options]',
          '',
          'Options:',
          '  --registry path                       Dataset registry JSON',
          '  --dataset id                          Audit only one dataset id from the registry',
          '  --report path                         Write JSON report to path',
          '  --min-local-training-minutes minutes  Require this much WAV duration when localTraining=true',
          '  --min-annotated-ratio ratio           Require this fraction of audio files to have sidecar lyrics/labels',
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

function validateRegistryShape(registry) {
  const problems = []
  if (!registry || typeof registry !== 'object') {
    return ['Registry must be a JSON object.']
  }
  if (registry.version !== 1) {
    problems.push('Registry version must be 1.')
  }
  if (!Array.isArray(registry.datasets)) {
    problems.push('Registry must contain a datasets array.')
  }
  return problems
}

function auditDataset(dataset, options = {}) {
  const problems = validateDataset(dataset)
  const localPath = typeof dataset.localPath === 'string' ? resolve(dataset.localPath) : ''
  const exists = Boolean(localPath && existsSync(localPath))
  const inventoryRoots = normalizeInventoryRoots(dataset.inventoryRoots)
  const audioInventory = exists ? findTrainingAudioFiles(localPath, inventoryRoots) : { files: [], ignoredGuideAudioFiles: [], missingRoots: [] }
  const audioFiles = audioInventory.files
  const wavStats = audioFiles.filter((file) => extname(file.path).toLowerCase() === '.wav').map(readWavStats)
  const knownDurationSeconds = wavStats.reduce((sum, stats) => sum + (stats.durationSeconds ?? 0), 0)
  const consent = inspectConsent(dataset, localPath)
  const licenseReview = inspectLicenseReview(dataset, localPath)
  const qualityGates = inspectQualityGates(dataset, options)
  const annotations = exists ? inspectAnnotations(localPath, audioFiles) : emptyAnnotationReport()

  if (!exists) {
    problems.push('Local dataset path does not exist yet.')
  }
  if (audioInventory.missingRoots.length > 0) {
    problems.push(`Dataset inventoryRoots are missing: ${audioInventory.missingRoots.join(', ')}.`)
  }
  if (requiresReview(dataset.licenseStatus) && dataset.allowedActions?.localTraining) {
    problems.push('localTraining is true while licenseStatus still requires review.')
  }
  if (dataset.allowedActions?.localTraining && consent.requiresSignedConsent && !consent.signedConsentReady) {
    problems.push('localTraining is true but signed consent is missing or incomplete.')
  }
  if (dataset.allowedActions?.localTraining && licenseReview.requiresReview && !licenseReview.reviewReady) {
    problems.push('localTraining is true but license review is missing or incomplete.')
  }
  if (requiresReview(dataset.modelPublishing) && dataset.allowedActions?.publicModelRelease) {
    problems.push('publicModelRelease is true while modelPublishing still requires review.')
  }
  if (dataset.redistribution?.includes('unknown') && dataset.allowedActions?.publicAudioExamples) {
    problems.push('publicAudioExamples is true while redistribution is unknown.')
  }
  if (
    options.minLocalTrainingSeconds > 0 &&
    dataset.allowedActions?.localTraining === true &&
    knownDurationSeconds < options.minLocalTrainingSeconds
  ) {
    problems.push(
      `Local-training dataset has ${formatMinutes(knownDurationSeconds)} minutes of known WAV audio; required ${formatMinutes(options.minLocalTrainingSeconds)} minutes.`,
    )
  }
  if (
    dataset.allowedActions?.localTraining === true &&
    qualityGates.minAnnotatedRatio > 0 &&
    annotations.annotatedRatio < qualityGates.minAnnotatedRatio
  ) {
    problems.push(
      `Local-training dataset has ${formatPercent(annotations.annotatedRatio)} paired annotations; required ${formatPercent(qualityGates.minAnnotatedRatio)}.`,
    )
  }

  return {
    id: dataset.id ?? '(missing)',
    name: dataset.name ?? '(missing)',
    localPath,
    inventoryRoots,
    exists,
    licenseStatus: dataset.licenseStatus ?? '(missing)',
    allowedActions: dataset.allowedActions ?? {},
    audio: {
      fileCount: audioFiles.length,
      wavCount: wavStats.length,
      knownDurationSeconds,
      knownDurationHours: knownDurationSeconds / 3600,
      extensions: extensionCounts(audioFiles),
      ignoredGuideAudioCount: audioInventory.ignoredGuideAudioFiles.length,
      ignoredGuideExtensions: extensionCounts(audioInventory.ignoredGuideAudioFiles),
      missingInventoryRoots: audioInventory.missingRoots,
    },
    consent,
    licenseReview,
    qualityGates,
    annotations,
    problems,
  }
}

function validateDataset(dataset) {
  const problems = []
  if (!dataset || typeof dataset !== 'object') {
    return ['Dataset entry must be an object.']
  }
  for (const key of ['id', 'name', 'localPath', 'licenseStatus', 'redistribution', 'modelPublishing', 'singerIdentity']) {
    if (typeof dataset[key] !== 'string' || dataset[key].length === 0) {
      problems.push(`Missing string field: ${key}.`)
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(dataset.id ?? '')) {
    problems.push('Dataset id must use lowercase letters, numbers, and hyphens.')
  }
  if (!Array.isArray(dataset.language) || dataset.language.length === 0) {
    problems.push('Dataset language must be a non-empty array.')
  }
  if (!Array.isArray(dataset.annotationTypes)) {
    problems.push('Dataset annotationTypes must be an array.')
  }
  if (!dataset.allowedActions || typeof dataset.allowedActions !== 'object') {
    problems.push('Dataset allowedActions must be an object.')
  } else {
    for (const key of ['localTraining', 'publicModelRelease', 'publicAudioExamples']) {
      if (typeof dataset.allowedActions[key] !== 'boolean') {
        problems.push(`allowedActions.${key} must be boolean.`)
      }
    }
  }
  if (!Array.isArray(dataset.reviewNotes)) {
    problems.push('Dataset reviewNotes must be an array.')
  }
  if (
    dataset.inventoryRoots !== undefined &&
    (!Array.isArray(dataset.inventoryRoots) ||
      dataset.inventoryRoots.some((root) => typeof root !== 'string' || root.length === 0))
  ) {
    problems.push('Dataset inventoryRoots must be an array of non-empty strings when provided.')
  }
  return problems
}

function normalizeInventoryRoots(value) {
  return Array.isArray(value) ? value.filter((root) => typeof root === 'string' && root.length > 0) : []
}

function findTrainingAudioFiles(root, inventoryRoots = []) {
  const files = []
  const ignoredGuideAudioFiles = []
  const missingRoots = []
  const searchRoots = inventoryRoots.length > 0 ? inventoryRoots : ['.']
  for (const inventoryRoot of searchRoots) {
    const searchRoot = resolveInventoryRoot(root, inventoryRoot)
    if (!searchRoot || !existsSync(searchRoot)) {
      missingRoots.push(inventoryRoot)
      continue
    }
    walk(searchRoot, (path) => {
      const extension = extname(path).toLowerCase()
      if (AUDIO_EXTENSIONS.has(extension)) {
        const stats = statSync(path)
        const file = {
          path,
          sizeBytes: stats.size,
        }
        if (isGuideAudioArtifact(root, path)) {
          ignoredGuideAudioFiles.push(file)
        } else {
          files.push(file)
        }
      }
    })
  }
  return { files, ignoredGuideAudioFiles, missingRoots }
}

function resolveInventoryRoot(root, inventoryRoot) {
  const resolved = resolve(root, inventoryRoot)
  const relativePath = relative(root, resolved)
  if (relativePath.startsWith('..') || relativePath === '' || /^[A-Za-z]:/u.test(relativePath)) {
    return relativePath === '' || inventoryRoot === '.' ? resolved : null
  }
  return resolved
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

function readWavStats(file) {
  const buffer = readFileSync(file.path)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { ...file, durationSeconds: null }
  }

  let offset = 12
  let sampleRate = null
  let byteRate = null
  let dataBytes = null
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === 'fmt ' && chunkStart + 16 <= buffer.length) {
      sampleRate = buffer.readUInt32LE(chunkStart + 4)
      byteRate = buffer.readUInt32LE(chunkStart + 8)
    } else if (chunkId === 'data') {
      dataBytes = chunkSize
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }

  return {
    ...file,
    sampleRate,
    durationSeconds: byteRate && dataBytes ? dataBytes / byteRate : null,
  }
}

function extensionCounts(files) {
  return files.reduce((counts, file) => {
    const extension = extname(file.path).toLowerCase() || '(none)'
    counts[extension] = (counts[extension] ?? 0) + 1
    return counts
  }, {})
}

function isGuideAudioArtifact(root, path) {
  const relativeParts = relative(root, path).split(/[\\/]+/u)
  const fileName = relativeParts.at(-1)?.toLowerCase() ?? ''
  return fileName.endsWith('.guide.wav') || relativeParts.slice(0, -1).some((part) => isGuideDirectoryName(part))
}

function isGuideDirectoryName(value) {
  return ['guides', 'guide-tracks'].includes(value.toLowerCase())
}

function inspectQualityGates(dataset, options) {
  const registryGate =
    dataset.qualityGates && typeof dataset.qualityGates === 'object'
      ? ratioNumber(dataset.qualityGates.minAnnotatedRatio, null)
      : null
  return {
    minAnnotatedRatio: registryGate ?? ratioNumber(options.minAnnotatedRatio, 0),
  }
}

function inspectAnnotations(root, audioFiles) {
  const missing = []
  const extensions = {}
  let pairedCount = 0

  for (const file of audioFiles) {
    const sidecar = findAnnotationSidecar(file.path)
    if (sidecar) {
      pairedCount += 1
      extensions[sidecar.extension] = (extensions[sidecar.extension] ?? 0) + 1
    } else if (missing.length < 24) {
      missing.push(relative(root, file.path))
    }
  }

  const missingCount = audioFiles.length - pairedCount
  return {
    pairedCount,
    missingCount,
    annotatedRatio: audioFiles.length > 0 ? pairedCount / audioFiles.length : 0,
    missing,
    missingOmittedCount: Math.max(0, missingCount - missing.length),
    extensions,
  }
}

function emptyAnnotationReport() {
  return {
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

function inspectConsent(dataset, localPath) {
  const consent = dataset.consent && typeof dataset.consent === 'object' ? dataset.consent : {}
  const annotationRequiresConsent = Array.isArray(dataset.annotationTypes) && dataset.annotationTypes.includes('consent')
  const requiresSignedConsent = consent.requiresSignedConsent === true || (annotationRequiresConsent && consent.requiresSignedConsent !== false)
  const templatePath = resolveDatasetPath(localPath, consent.templatePath)
  const signedConsentPath = resolveDatasetPath(localPath, consent.signedConsentPath)
  const templateExists = Boolean(templatePath && existsSync(templatePath))
  const signedConsentExists = Boolean(signedConsentPath && existsSync(signedConsentPath))
  const signedConsentFields = signedConsentExists ? readConsentFields(signedConsentPath) : {}
  const signedConsentReady =
    !requiresSignedConsent ||
    (signedConsentExists &&
      Boolean(signedConsentFields.singerSignature) &&
      Boolean(signedConsentFields.date) &&
      Boolean(signedConsentFields.reviewer))
  return {
    requiresSignedConsent,
    templatePath,
    templateExists,
    signedConsentPath,
    signedConsentExists,
    signedConsentReady,
    filledFields: {
      singerSignature: Boolean(signedConsentFields.singerSignature),
      date: Boolean(signedConsentFields.date),
      reviewer: Boolean(signedConsentFields.reviewer),
    },
    localTrainingScope: consent.localTrainingScope ?? null,
    publicReleaseScope: consent.publicReleaseScope ?? null,
  }
}

function inspectLicenseReview(dataset, localPath) {
  const review = dataset.licenseReview && typeof dataset.licenseReview === 'object' ? dataset.licenseReview : {}
  const requiresLicenseReview = review.requiresReview === true
  const templatePath = resolveDatasetPath(localPath, review.templatePath)
  const reviewedPath = resolveDatasetPath(localPath, review.reviewedPath)
  const templateExists = Boolean(templatePath && existsSync(templatePath))
  const reviewedExists = Boolean(reviewedPath && existsSync(reviewedPath))
  const fields = reviewedExists ? readLicenseReviewFields(reviewedPath) : {}
  const filledFields = {
    reviewer: Boolean(fields.reviewer),
    reviewDate: Boolean(fields.reviewDate),
    accountDownloadApprovalConfirmed: isYes(fields.accountDownloadApprovalConfirmed),
    localTrainingAllowed: isYes(fields.localTrainingAllowed),
  }
  return {
    requiresReview: requiresLicenseReview,
    templatePath,
    templateExists,
    reviewedPath,
    reviewedExists,
    reviewReady:
      !requiresLicenseReview ||
      (reviewedExists &&
        filledFields.reviewer &&
        filledFields.reviewDate &&
        filledFields.accountDownloadApprovalConfirmed &&
        filledFields.localTrainingAllowed),
    filledFields,
    requiredFields: Array.isArray(review.requiredFields) ? review.requiredFields : [],
  }
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
    commercialUseAllowed: reviewFieldValue(text, 'Commercial use allowed'),
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
  const cwdPath = resolve(value)
  if (existsSync(cwdPath)) {
    return cwdPath
  }
  return resolve(localPath || '.', value)
}

function readConsentFields(path) {
  const text = readFileSync(path, 'utf8')
  return {
    singerSignature: consentFieldValue(text, 'Singer signature'),
    date: consentFieldValue(text, 'Date'),
    reviewer: consentFieldValue(text, 'Reviewer'),
  }
}

function consentFieldValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = text.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, 'imu'))
  return match?.[1]?.trim() ?? ''
}

function mkdirp(path) {
  if (existsSync(path)) {
    return
  }
  mkdirSync(path, { recursive: true })
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function ratioNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback
}

function formatMinutes(seconds) {
  return (seconds / 60).toFixed(2)
}

function formatPercent(ratio) {
  return `${(ratio * 100).toFixed(1)}%`
}

function requiresReview(value) {
  return typeof value === 'string' && /(^|[-_ ])review[-_ ]?required($|[-_ ])/u.test(value)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = auditNeuralDatasets(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
