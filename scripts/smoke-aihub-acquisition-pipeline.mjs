#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { auditMfaLabelCoverage } from './audit-mfa-label-coverage.mjs'
import { auditNeuralDatasets } from './audit-neural-datasets.mjs'
import { auditNeuralTrainingReadiness } from './audit-neural-training-readiness.mjs'
import { auditProviderArchiveDrop } from './audit-provider-archive-drop.mjs'
import { extractNeuralDatasetArchives } from './extract-neural-dataset-archives.mjs'
import { ingestNeuralDataset } from './ingest-neural-dataset.mjs'
import { inspectNeuralDatasetIntake } from './inspect-neural-dataset-intake.mjs'
import { materializeNeuralDatasetSidecars } from './materialize-neural-dataset-sidecars.mjs'
import { prepareDiffSingerGpuJob } from './prepare-diffsinger-gpu-job.mjs'
import { prepareDiffSingerTrainingRun } from './prepare-diffsinger-training-run.mjs'
import { prepareKoreanMfaDictionary } from './prepare-korean-mfa-dictionary.mjs'
import { prepareLicensedDatasetIntake } from './prepare-licensed-dataset-intake.mjs'
import { prepareMakeDiffSingerAlignmentJob } from './prepare-makediffsinger-alignment-job.mjs'
import { prepareOpenVpiSeed } from './prepare-openvpi-seed.mjs'

const DEFAULT_PRESET = 'aihub-guide-vocal'
const DEFAULT_MIN_LOCAL_TRAINING_MINUTES = 0.03
const ONSET_SYMBOLS = [
  'g',
  'kk',
  'n',
  'd',
  'tt',
  'r',
  'm',
  'b',
  'pp',
  's',
  'ss',
  '',
  'j',
  'jj',
  'ch',
  'k',
  't',
  'p',
  'h',
]
const VOWEL_SYMBOLS = [
  'a',
  'ae',
  'ya',
  'yae',
  'eo',
  'e',
  'yeo',
  'ye',
  'o',
  'wa',
  'wae',
  'oe',
  'yo',
  'u',
  'wo',
  'we',
  'wi',
  'yu',
  'eu',
  'ui',
  'i',
]
const CODA_SYMBOLS = [
  '',
  'g',
  'kk',
  'gs',
  'n',
  'nj',
  'nh',
  'd',
  'r',
  'rg',
  'rm',
  'rb',
  'rs',
  'rt',
  'rp',
  'rh',
  'm',
  'b',
  'bs',
  's',
  'ss',
  'ng',
  'j',
  'ch',
  'k',
  't',
  'p',
  'h',
]

export async function smokeAihubAcquisitionPipeline(options = {}) {
  const preset = options.preset ?? DEFAULT_PRESET
  const workDir = resolve(options.workDir ?? join('experiments/neural-singer/work/aihub-acquisition-smoke', `${preset}-${runStamp()}`))
  const datasetRoot = resolve(options.datasetRoot ?? join(workDir, preset))
  const registryPath = resolve(options.registry ?? join(workDir, 'dataset-registry.local.json'))
  const reportPath = options.out ? resolve(options.out) : null
  const minLocalTrainingMinutes = positiveNumber(options.minLocalTrainingMinutes, DEFAULT_MIN_LOCAL_TRAINING_MINUTES)
  const ingestDir = resolve(options.ingestDir ?? join(workDir, 'ingest-slice'))
  const readinessPath = join(workDir, 'readiness.json')
  const openVpiDir = resolve(options.openVpiDir ?? join(workDir, 'openvpi-seed'))
  const dictionaryDir = resolve(options.dictionaryDir ?? join(workDir, 'mfa-dictionary'))
  const labelAuditDir = resolve(options.labelAuditDir ?? join(workDir, 'mfa-label-audit'))
  const smokeEnhancedDir = resolve(options.smokeEnhancedDir ?? join(workDir, 'diffsinger-dataset-smoke-enhanced'))
  const makeDiffSingerRoot = resolve(options.makeDiffSingerRoot ?? join(workDir, 'MakeDiffSinger'))
  const alignmentJobDir = resolve(options.alignmentJobDir ?? join(workDir, 'makediffsinger-alignment-job'))
  const mfaModel = resolve(options.mfaModel ?? join(workDir, 'korean-acoustic-model.zip'))
  const diffSingerRoot = resolve(options.diffSingerRoot ?? join(workDir, 'DiffSinger'))
  const trainingDir = resolve(options.trainingDir ?? join(workDir, 'diffsinger-training'))
  const gpuJobDir = resolve(options.gpuJobDir ?? join(trainingDir, 'gpu-job'))
  const providerDropAuditPath = join(workDir, 'provider-archive-drop.json')

  mkdirSync(workDir, { recursive: true })
  prepareLicensedDatasetIntake({
    preset,
    localPath: datasetRoot,
    registryOut: registryPath,
  })

  const emptyInspection = inspectNeuralDatasetIntake({
    registry: registryPath,
    dataset: preset,
    report: join(workDir, 'inspect-empty.json'),
  })
  assertStage(emptyInspection, 'awaiting-provider-download')

  const archivePath = join(datasetRoot, 'raw', 'synthetic-aihub-provider.zip')
  await writeSyntheticProviderZip(archivePath)

  const archiveInspection = inspectNeuralDatasetIntake({
    registry: registryPath,
    dataset: preset,
    report: join(workDir, 'inspect-archive.json'),
  })
  assertStage(archiveInspection, 'archive-ready-for-extraction')

  const providerDrop = auditProviderArchiveDrop({
    registry: registryPath,
    dataset: preset,
    minTotalBytes: 100,
    inspectEntries: true,
    report: providerDropAuditPath,
  })
  if (!providerDrop.ok || providerDrop.metrics.archiveCount !== 1 || providerDrop.archives[0]?.entryInspection?.entryCount < 3) {
    throw new Error(`Synthetic acquisition provider-drop audit failed: ${JSON.stringify(providerDrop.problems)}`)
  }

  const extraction = extractNeuralDatasetArchives({
    registry: registryPath,
    dataset: preset,
    report: join(workDir, 'extract.json'),
  })
  if (!extraction.ok || extraction.archiveCount !== 1 || extraction.results[0]?.filesAfter < 3) {
    throw new Error(`Synthetic acquisition extraction failed: ${JSON.stringify(extraction.results)}`)
  }

  const extractedInspection = inspectNeuralDatasetIntake({
    registry: registryPath,
    dataset: preset,
    report: join(workDir, 'inspect-extracted.json'),
  })
  assertStage(extractedInspection, 'metadata-ready-needs-sidecars')

  const sidecars = materializeNeuralDatasetSidecars({
    registry: registryPath,
    dataset: preset,
    report: join(workDir, 'sidecars.json'),
  })
  if (sidecars.sidecars.writtenCount !== 2 || sidecars.rows.unmatchedCount > 0 || sidecars.rows.ambiguousCount > 0) {
    throw new Error(`Synthetic acquisition sidecar materialization failed: ${JSON.stringify(sidecars.rows)}`)
  }

  const sidecarInspection = inspectNeuralDatasetIntake({
    registry: registryPath,
    dataset: preset,
    report: join(workDir, 'inspect-sidecars.json'),
  })
  assertStage(sidecarInspection, 'ingest-ready-needs-license-review')

  writeLicenseReview(join(datasetRoot, 'metadata', 'license-review.local.md'))
  enableLocalTraining(registryPath, preset)

  const readyInspection = inspectNeuralDatasetIntake({
    registry: registryPath,
    dataset: preset,
    report: join(workDir, 'inspect-ready.json'),
  })
  assertStage(readyInspection, 'ready-for-audit-and-ingest')

  const datasetAudit = auditNeuralDatasets({
    registry: registryPath,
    dataset: preset,
    minLocalTrainingMinutes,
    minAnnotatedRatio: 0.95,
    report: join(workDir, 'dataset-audit.json'),
  })
  if (!datasetAudit.ok) {
    throw new Error(`Synthetic acquisition dataset audit failed: ${JSON.stringify(datasetAudit.datasets[0]?.problems ?? datasetAudit.problems)}`)
  }

  const ingest = ingestNeuralDataset({
    registry: registryPath,
    dataset: preset,
    out: ingestDir,
    targetRate: 16000,
    segmentSeconds: 1,
    minSegmentSeconds: 0.2,
    limitFiles: 2,
  })
  if (ingest.summary.files.audioCount !== 2 || ingest.summary.files.skippedCount > 0) {
    throw new Error(`Synthetic acquisition ingest failed: ${JSON.stringify(ingest.summary.files)}`)
  }

  const readiness = auditNeuralTrainingReadiness({
    ingestDir,
    registry: registryPath,
    dataset: preset,
    minMinutes: minLocalTrainingMinutes,
    minAnnotatedRatio: 0.95,
    minUniquePhonemes: 4,
    maxMedianRms: 0.4,
    maxMeanSilenceRatio: 0.8,
    minMeanVoicedRatio: 0.1,
    report: readinessPath,
  })
  if (!readiness.ok) {
    throw new Error(`Synthetic acquisition readiness failed: ${JSON.stringify(readiness.gates.filter((gate) => !gate.passed))}`)
  }

  const openVpi = prepareOpenVpiSeed({
    ingestDir,
    out: openVpiDir,
    copyAudio: true,
  })
  if (openVpi.segmentCount !== ingest.summary.segments.count) {
    throw new Error(`Synthetic acquisition OpenVPI seed mismatch: ${openVpi.segmentCount} vs ${ingest.summary.segments.count}`)
  }

  const dictionary = prepareKoreanMfaDictionary({
    seedDir: openVpiDir,
    out: dictionaryDir,
  })
  if (dictionary.unsupportedTokenCount > 0) {
    throw new Error(`Synthetic acquisition dictionary has unsupported tokens: ${dictionary.unsupportedTokenCount}`)
  }

  const mfaCoverage = auditMfaLabelCoverage({
    seedDir: openVpiDir,
    dictionary: dictionary.dictionary,
    out: labelAuditDir,
  })
  if (mfaCoverage.oovUniqueTokenCount > 0) {
    throw new Error(`Synthetic acquisition MFA coverage has OOV tokens: ${mfaCoverage.oovUniqueTokenCount}`)
  }

  makeMakeDiffSingerAlignmentFixture(makeDiffSingerRoot)
  writeFileSync(mfaModel, 'synthetic acoustic model placeholder')
  const alignmentJob = prepareMakeDiffSingerAlignmentJob({
    seedDir: openVpiDir,
    dictionary: dictionary.dictionary,
    out: alignmentJobDir,
    makeDiffSingerRoot,
    mfaModel,
  })

  const smokeEnhanced = materializeSmokeDiffSingerDataset({
    seedDir: openVpiDir,
    out: smokeEnhancedDir,
  })
  if (smokeEnhanced.itemCount < 2 || smokeEnhanced.phoneInventoryCount < 4) {
    throw new Error(`Synthetic acquisition enhanced dataset is too small: ${JSON.stringify(smokeEnhanced)}`)
  }

  makeDiffSingerFixture(diffSingerRoot)
  const trainingRun = prepareDiffSingerTrainingRun({
    datasetDir: smokeEnhanced.datasetDir,
    diffSingerRoot,
    python: join(workDir, 'python'),
    out: trainingDir,
    dataset: preset,
    trainingReadiness: readinessPath,
    modelId: 'webuta-ko-aihub-acquisition-smoke',
    modelName: 'WebUtau KO AI Hub Acquisition Smoke',
    runId: 'aihub-acquisition-smoke',
    providerDropAudit: providerDropAuditPath,
    validationRatio: 0.25,
    maxUpdates: 1200,
    checkpointStep: 1200,
    minCheckpointStep: 1,
    accelerator: 'cpu',
    devices: 1,
  })
  const gpuJob = prepareDiffSingerGpuJob({
    manifest: trainingRun.manifest,
    out: gpuJobDir,
    remoteHost: 'gpu.example.invalid',
    remoteWorkDir: '/srv/webuta-diffsinger-runs/aihub-acquisition-smoke',
    remoteDiffSingerRoot: '/opt/DiffSinger',
    remotePython: '/opt/venv/bin/python',
    checkpointStep: 1200,
    accelerator: 'gpu',
    devices: 1,
    maxUpdates: 1200,
  })

  const report = {
    ok: true,
    mode: 'aihub-acquisition-smoke',
    preset,
    workDir,
    datasetRoot,
    registryPath,
    archivePath,
    gates: {
      emptyInspection: summarizeInspection(emptyInspection),
      archiveInspection: summarizeInspection(archiveInspection),
      providerDrop: {
        ok: providerDrop.ok,
        decision: providerDrop.decision,
        archiveCount: providerDrop.metrics.archiveCount,
        hashedArchiveCount: providerDrop.metrics.hashedArchiveCount,
        totalSizeBytes: providerDrop.metrics.totalSizeBytes,
        sha256: providerDrop.archives[0]?.sha256 ?? null,
        entryCount: providerDrop.archives[0]?.entryInspection?.entryCount ?? null,
        reportPath: providerDropAuditPath,
      },
      extractedInspection: summarizeInspection(extractedInspection),
      sidecarInspection: summarizeInspection(sidecarInspection),
      readyInspection: summarizeInspection(readyInspection),
      extraction: {
        archiveCount: extraction.archiveCount,
        extractedFileCount: extraction.results.reduce((sum, result) => sum + result.extractedFileCount, 0),
      },
      sidecars: {
        writtenCount: sidecars.sidecars.writtenCount,
        matchedAudioCount: sidecars.rows.matchedAudioCount,
        matchedRowCount: sidecars.rows.matchedRowCount,
      },
      datasetAudit: {
        ok: datasetAudit.ok,
        audioCount: datasetAudit.datasets[0].audio.fileCount,
        knownDurationSeconds: datasetAudit.datasets[0].audio.knownDurationSeconds,
        annotatedRatio: datasetAudit.datasets[0].annotations.annotatedRatio,
      },
      ingest: {
        audioCount: ingest.summary.files.audioCount,
        segmentCount: ingest.summary.segments.count,
        totalDurationSeconds: ingest.summary.segments.totalDurationSeconds,
        uniquePhonemes: ingest.summary.lyricCoverage.uniquePhonemes,
      },
      readiness: {
        ok: readiness.ok,
        metrics: readiness.metrics,
        reportPath: readinessPath,
      },
      openVpi: {
        segmentCount: openVpi.segmentCount,
        copiedAudio: openVpi.copiedAudio,
        outputDir: openVpi.outputDir,
      },
      mfaDictionary: {
        labFileCount: dictionary.labFileCount,
        dictionaryEntryCount: dictionary.dictionaryEntryCount,
        unsupportedTokenCount: dictionary.unsupportedTokenCount,
        phoneInventoryCount: dictionary.phoneInventoryCount,
        dictionary: dictionary.dictionary,
      },
      mfaCoverage: {
        labFileCount: mfaCoverage.labFileCount,
        coveredUniqueTokenCount: mfaCoverage.coveredUniqueTokenCount,
        oovUniqueTokenCount: mfaCoverage.oovUniqueTokenCount,
        report: mfaCoverage.report,
      },
      alignmentJob: {
        manifest: alignmentJob.manifest,
        enhancedDatasetDir: alignmentJob.enhancedDatasetDir,
        warningCount: alignmentJob.warnings.length,
      },
      smokeEnhancedDataset: {
        datasetDir: smokeEnhanced.datasetDir,
        itemCount: smokeEnhanced.itemCount,
        phoneInventoryCount: smokeEnhanced.phoneInventoryCount,
        transcriptions: smokeEnhanced.transcriptions,
      },
      trainingRun: {
        manifest: trainingRun.manifest,
        checkpointManifest: trainingRun.checkpointManifest,
        itemCount: trainingRun.itemCount,
        trainItemCount: trainingRun.trainItemCount,
        validationItemCount: trainingRun.validationItemCount,
        phoneInventoryCount: trainingRun.phoneInventoryCount,
        maxUpdates: trainingRun.maxUpdates,
        checkpointStep: trainingRun.checkpointStep,
      },
      gpuJob: {
        manifest: gpuJob.manifest,
        remoteWorkDir: gpuJob.remoteWorkDir,
        checkpointStep: gpuJob.checkpointStep,
      },
    },
    checks: [
      'prepared AI Hub-style intake starts as awaiting-provider-download',
      'provider archive detection reaches archive-ready-for-extraction',
      'provider archive drop audit rejects placeholder-scale downloads before extraction',
      'supported ZIP archive extracts into ignored extracted/ folder',
      'global note metadata is materialized into per-audio sidecars',
      'license review and registry flip are required before audit/ingest',
      'dataset audit and limited ingest pass on the prepared acquisition fixture',
      'training readiness gates pass with smoke-scale thresholds',
      'OpenVPI pre-alignment seed corpus and Korean MFA dictionary are generated',
      'MFA label coverage has no OOV tokens with the generated dictionary',
      'MakeDiffSinger/MFA alignment job bundle is generated from the seed corpus',
      'smoke-only enhanced DiffSinger dataset can produce a training manifest',
      'GPU job bundle is generated with guarded remote dataset upload scripts',
    ],
    note:
      'This smoke uses synthetic audio and metadata. It proves acquisition pipeline wiring only; it is not model quality or release evidence.',
  }
  if (reportPath) {
    writeJson(reportPath, report)
  }
  return report
}

function materializeSmokeDiffSingerDataset({ seedDir, out }) {
  const labelDir = join(seedDir, 'raw', 'wavs')
  const wavDir = join(out, 'wavs')
  mkdirSync(wavDir, { recursive: true })
  const labFiles = readdirSync(labelDir)
    .filter((name) => name.endsWith('.lab'))
    .sort((a, b) => a.localeCompare(b))
  const rows = [['name', 'ph_seq', 'ph_dur']]
  const phoneCounts = new Map()

  for (const [index, labName] of labFiles.entries()) {
    const itemName = basename(labName, '.lab')
    const sourceWav = join(labelDir, `${itemName}.wav`)
    const targetWav = join(wavDir, `${itemName}.wav`)
    const labelText = readFileSync(join(labelDir, labName), 'utf8')
    const phones = phonesForSmokeLabel(labelText)
    if (index === 0) {
      phones.unshift('AP')
    }
    if (index === 1 || index === labFiles.length - 1) {
      phones.push('SP')
    }
    for (const phone of phones) {
      phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1)
    }
    const durations = phones.map((phone) => (phone === 'AP' || phone === 'SP' ? '0.08' : '0.12'))
    writeFileSync(targetWav, readFileSync(sourceWav))
    rows.push([itemName, phones.join(' '), durations.join(' ')])
  }

  const transcriptions = join(out, 'transcriptions.csv')
  writeFileSync(transcriptions, csvRows(rows))
  writeJson(join(out, 'smoke-enhanced-dataset.manifest.json'), {
    version: 1,
    source: 'webuta-aihub-acquisition-smoke-enhanced-dataset',
    generatedAt: new Date().toISOString(),
    seedDir,
    datasetDir: out,
    transcriptions,
    itemCount: labFiles.length,
    phoneInventoryCount: phoneCounts.size,
    phoneCounts: Object.fromEntries([...phoneCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    note:
      'Smoke-only DiffSinger dataset materialized from synthetic acquisition labels. Real training must use MakeDiffSinger-enhanced aligned data.',
  })
  return {
    datasetDir: out,
    transcriptions,
    itemCount: labFiles.length,
    phoneInventoryCount: phoneCounts.size,
  }
}

function phonesForSmokeLabel(text) {
  const phones = []
  for (const token of text.split(/\s+/u).map((item) => item.trim()).filter(Boolean)) {
    phones.push(...phonesForToken(token))
  }
  return phones.length > 0 ? phones : ['SP']
}

function phonesForToken(token) {
  const phones = []
  for (const char of token) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0xac00 || code > 0xd7a3) {
      phones.push(char)
      continue
    }
    const offset = code - 0xac00
    const onset = Math.floor(offset / (21 * 28))
    const vowel = Math.floor((offset % (21 * 28)) / 28)
    const coda = offset % 28
    const onsetPhone = ONSET_SYMBOLS[onset]
    const vowelPhone = VOWEL_SYMBOLS[vowel]
    const codaPhone = CODA_SYMBOLS[coda]
    if (onsetPhone) phones.push(onsetPhone)
    if (vowelPhone) phones.push(vowelPhone)
    if (codaPhone) phones.push(codaPhone)
  }
  return phones
}

function makeDiffSingerFixture(root) {
  mkdirSync(join(root, 'configs'), { recursive: true })
  writeFileSync(join(root, 'configs', 'acoustic.yaml'), 'base_config: []\n')
}

function makeMakeDiffSingerAlignmentFixture(root) {
  const toolDir = join(root, 'acoustic_forced_alignment')
  mkdirSync(toolDir, { recursive: true })
  for (const script of ['validate_labels.py', 'reformat_wavs.py', 'check_tg.py', 'enhance_tg.py', 'build_dataset.py']) {
    writeFileSync(join(toolDir, script), '# synthetic fixture\n')
  }
}

function csvRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

function assertStage(report, expectedStage) {
  if (report.acquisition?.stage !== expectedStage) {
    throw new Error(`Expected acquisition stage ${expectedStage}, got ${report.acquisition?.stage ?? '(missing)'}.`)
  }
}

function summarizeInspection(report) {
  return {
    ok: report.ok,
    stage: report.acquisition.stage,
    providerArchiveCount: report.acquisition.providerArchiveCount,
    trainingAudioCount: report.acquisition.trainingAudioCount,
    licenseReviewComplete: report.acquisition.licenseReviewComplete,
    canStartDatasetAudit: report.acquisition.canStartDatasetAudit,
    canStartIngest: report.acquisition.canStartIngest,
    blockers: report.acquisition.blockers,
  }
}

async function writeSyntheticProviderZip(path) {
  mkdirSync(dirname(path), { recursive: true })
  const zip = new JSZip()
  zip.file('wav/song-a.wav', makeSineWav({ sampleRate: 16000, seconds: 1.2, hz: 220 }))
  zip.file('wav/song-b.wav', makeSineWav({ sampleRate: 16000, seconds: 1.2, hz: 330 }))
  zip.file(
    'metadata/global-notes.csv',
    [
      'audio,start,end,lyric,midi_num',
      'wav/song-a.wav,0.0,0.4,도,60',
      'wav/song-a.wav,0.4,0.8,히,64',
      'wav/song-a.wav,0.8,1.2,도,67',
      'wav/song-b.wav,0.0,0.4,다,62',
      'wav/song-b.wav,0.4,0.8,이,65',
      'wav/song-b.wav,0.8,1.2,스키,69',
      '',
    ].join('\n'),
  )
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  writeFileSync(path, bytes)
}

function writeLicenseReview(path) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    [
      '# License Review Fixture',
      '',
      '- Reviewer: Synthetic Smoke',
      '- Review date: 2026-06-30',
      '- Account/download approval confirmed: yes',
      '- Local training allowed: yes',
      '- Public model release allowed: no',
      '- Public audio examples allowed: no',
      '- Commercial use allowed: no',
      '- Required attribution: Synthetic fixture only',
      '- Notes: Synthetic acquisition smoke fixture; not a real provider license.',
      '',
    ].join('\n'),
  )
}

function enableLocalTraining(registryPath, datasetId) {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  const dataset = registry.datasets?.find((entry) => entry.id === datasetId)
  if (!dataset) {
    throw new Error(`Dataset not found in registry: ${datasetId}`)
  }
  dataset.licenseStatus = 'license-reviewed-local-training'
  dataset.allowedActions.localTraining = true
  writeJson(registryPath, registry)
}

function makeSineWav({ sampleRate, seconds, hz }) {
  const sampleCount = Math.round(sampleRate * seconds)
  const dataBytes = sampleCount * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * hz * index) / sampleRate) * 0x3000)
    buffer.writeInt16LE(value, 44 + index * 2)
  }
  return buffer
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--preset') {
      parsed.preset = argv[++index]
    } else if (arg === '--work-dir') {
      parsed.workDir = argv[++index]
    } else if (arg === '--dataset-root') {
      parsed.datasetRoot = argv[++index]
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--ingest-dir') {
      parsed.ingestDir = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--min-local-training-minutes') {
      parsed.minLocalTrainingMinutes = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/smoke-aihub-acquisition-pipeline.mjs [options]',
          '',
          'Options:',
          `  --preset id                         Dataset intake preset, default ${DEFAULT_PRESET}`,
          '  --work-dir path                     Output work directory',
          '  --dataset-root path                 Synthetic dataset root',
          '  --registry path                     Local registry path',
          '  --ingest-dir path                   Ingest output directory',
          '  --out path                          Write JSON report',
          `  --min-local-training-minutes value  Dataset audit duration gate, default ${DEFAULT_MIN_LOCAL_TRAINING_MINUTES}`,
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

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function runStamp() {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\..+$/u, 'Z')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await smokeAihubAcquisitionPipeline(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
