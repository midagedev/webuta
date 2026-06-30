#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditDiffSingerEnhancedDataset } from './audit-diffsinger-enhanced-dataset.mjs'
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
import { prepareMakeDiffSingerAlignmentJob } from './prepare-makediffsinger-alignment-job.mjs'
import { prepareOpenVpiSeed } from './prepare-openvpi-seed.mjs'

const DEFAULT_REGISTRY = 'experiments/neural-singer/datasets/aihub-guide-vocal/dataset-registry.local-template.json'
const DEFAULT_DATASET = 'aihub-guide-vocal'
const DEFAULT_WORK_ROOT = 'experiments/neural-singer/work'
const DEFAULT_MIN_LOCAL_TRAINING_MINUTES = 30
const DEFAULT_MIN_ANNOTATED_RATIO = 0.95
const DEFAULT_LIMIT_FILES = 10

export function runNeuralDatasetHandoff(options = {}) {
  const registry = resolve(options.registry ?? DEFAULT_REGISTRY)
  const dataset = options.dataset ?? DEFAULT_DATASET
  const production = Boolean(options.production)
  const limitFiles = production || options.fullIngest ? 0 : nonNegativeInteger(options.limitFiles, DEFAULT_LIMIT_FILES)
  const workDir = resolve(options.workDir ?? join(DEFAULT_WORK_ROOT, `${dataset}-handoff`))
  const reportPath = options.report ? resolve(options.report) : null
  const providerDropAuditPath = resolve(options.providerDropAudit ?? join(DEFAULT_WORK_ROOT, `${dataset}-provider-drop.json`))
  const minLocalTrainingMinutes = positiveNumber(options.minLocalTrainingMinutes, DEFAULT_MIN_LOCAL_TRAINING_MINUTES)
  const minReadinessMinutes = positiveNumber(options.minReadinessMinutes, production ? minLocalTrainingMinutes : 0.03)
  const minAnnotatedRatio = ratioNumber(options.minAnnotatedRatio, DEFAULT_MIN_ANNOTATED_RATIO)
  const ingestDir = resolve(options.ingestDir ?? join(workDir, limitFiles > 0 ? `ingest-slice-${limitFiles}` : 'ingest-full'))
  const readinessPath = resolve(options.readinessReport ?? join(workDir, 'training-readiness.json'))
  const openVpiDir = resolve(options.openVpiDir ?? join(workDir, 'openvpi-seed'))
  const dictionaryDir = resolve(options.dictionaryDir ?? join(workDir, 'mfa-dictionary'))
  const labelAuditDir = resolve(options.labelAuditDir ?? join(workDir, 'mfa-label-audit'))
  const alignmentJobDir = resolve(options.alignmentJobDir ?? join(workDir, 'makediffsinger-alignment-job'))
  const trainingDir = resolve(options.trainingDir ?? join(workDir, 'diffsinger-training'))
  const gpuJobDir = resolve(options.gpuJobDir ?? join(trainingDir, 'gpu-job'))
  const steps = []
  const failures = []
  const nextActions = []
  const dryRun = Boolean(options.dryRun)

  mkdirSync(workDir, { recursive: true })

  let inspection = runStep(steps, failures, {
    id: 'inspect-intake',
    label: 'Inspect licensed dataset intake',
    run: () => inspectNeuralDatasetIntake({ registry, dataset, report: join(workDir, 'inspect-initial.json') }),
    summarize: summarizeInspection,
  })

  if (!inspection) {
    return finish({
      reportPath,
      report: baseReport({
        registry,
        dataset,
        workDir,
        production,
        limitFiles,
        status: 'failed-inspection',
        ok: false,
        steps,
        failures,
        nextActions: ['Fix the dataset registry/localPath and rerun the handoff runner.'],
      }),
    })
  }

  if (dryRun) {
    return finish({
      reportPath,
      report: baseReport({
        registry,
        dataset,
        workDir,
        production,
        limitFiles,
        status: `dry-run-${inspection.acquisition.stage}`,
        ok: false,
        steps,
        failures,
        nextActions: inspection.acquisition.nextActions,
      }),
    })
  }

  for (let pass = 0; pass < 4; pass += 1) {
    if (inspection.acquisition.stage === 'archive-ready-for-extraction') {
      const providerDrop = runStep(steps, failures, {
        id: 'audit-provider-archive-drop',
        label: 'Audit provider archive drop',
        run: () =>
          auditProviderArchiveDrop({
            registry,
            dataset,
            production,
            minArchiveCount: options.minProviderArchiveCount,
            minTotalBytes: options.minProviderArchiveTotalBytes,
            minArchiveBytes: options.minProviderArchiveBytes,
            inspectEntries: Boolean(options.inspectProviderArchiveEntries),
            hashArchives: options.hashProviderArchives !== false,
            report: providerDropAuditPath,
          }),
        summarize: summarizeProviderDrop,
      })
      if (!providerDrop?.ok) {
        return finish({
          reportPath,
          report: baseReport({
            registry,
            dataset,
            workDir,
            production,
            limitFiles,
            status: 'blocked-provider-archive-drop',
            ok: false,
            steps,
            failures,
            acquisition: summarizeInspection(inspection),
            handoff: buildHandoff({ inspection, registry, dataset, workDir, providerDropAuditPath, production, limitFiles, reportPath }),
            nextActions: providerDrop?.nextActions ?? ['Fix the provider archive drop before extraction.'],
          }),
        })
      }
      const extraction = runStep(steps, failures, {
        id: 'extract-provider-archives',
        label: 'Extract provider archives from raw/',
        run: () =>
          extractNeuralDatasetArchives({
            registry,
            dataset,
            report: join(workDir, 'extract-provider-archives.json'),
            overwrite: Boolean(options.overwriteExtraction),
          }),
        summarize: summarizeExtraction,
      })
      if (!extraction) break
      inspection = runStep(steps, failures, {
        id: 'inspect-after-extraction',
        label: 'Inspect intake after extraction',
        run: () => inspectNeuralDatasetIntake({ registry, dataset, report: join(workDir, 'inspect-after-extraction.json') }),
        summarize: summarizeInspection,
      })
      if (!inspection) break
      continue
    }

    if (inspection.acquisition.stage === 'metadata-ready-needs-sidecars') {
      const sidecars = runStep(steps, failures, {
        id: 'materialize-sidecars',
        label: 'Materialize ingest-compatible sidecars',
        run: () =>
          materializeNeuralDatasetSidecars({
            registry,
            dataset,
            report: join(workDir, 'materialize-sidecars.json'),
            overwrite: Boolean(options.overwriteSidecars),
          }),
        summarize: summarizeSidecars,
      })
      if (!sidecars) break
      inspection = runStep(steps, failures, {
        id: 'inspect-after-sidecars',
        label: 'Inspect intake after sidecar materialization',
        run: () => inspectNeuralDatasetIntake({ registry, dataset, report: join(workDir, 'inspect-after-sidecars.json') }),
        summarize: summarizeInspection,
      })
      if (!inspection) break
      continue
    }

    break
  }

  if (!inspection) {
    return finish({
      reportPath,
      report: baseReport({
        registry,
        dataset,
        workDir,
        production,
        limitFiles,
        status: 'failed-automation',
        ok: false,
        steps,
        failures,
        nextActions: ['Fix the failed handoff step and rerun.'],
      }),
    })
  }

  const blocked = blockerForInspection(inspection)
  if (blocked) {
    return finish({
      reportPath,
      report: baseReport({
        registry,
        dataset,
        workDir,
        production,
        limitFiles,
        status: blocked.status,
        ok: false,
        steps,
        failures,
        acquisition: summarizeInspection(inspection),
        handoff: buildHandoff({ inspection, registry, dataset, workDir, providerDropAuditPath, production, limitFiles, reportPath }),
        nextActions: blocked.nextActions,
      }),
    })
  }

  if (inspection.acquisition.stage !== 'ready-for-audit-and-ingest') {
    return finish({
      reportPath,
      report: baseReport({
        registry,
        dataset,
        workDir,
        production,
        limitFiles,
        status: `unsupported-stage-${inspection.acquisition.stage}`,
        ok: false,
        steps,
        failures,
        acquisition: summarizeInspection(inspection),
        handoff: buildHandoff({ inspection, registry, dataset, workDir, providerDropAuditPath, production, limitFiles, reportPath }),
        nextActions: inspection.acquisition.nextActions,
      }),
    })
  }

  const datasetAudit = runStep(steps, failures, {
    id: 'audit-dataset',
    label: 'Audit dataset rights, duration, and annotations',
    run: () =>
      auditNeuralDatasets({
        registry,
        dataset,
        minLocalTrainingMinutes,
        minAnnotatedRatio,
        report: join(workDir, 'dataset-audit.json'),
      }),
    summarize: summarizeDatasetAudit,
  })
  if (!datasetAudit?.ok) {
    return finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions: ['Fix dataset audit failures before ingest.'] })
  }

  const ingest = runStep(steps, failures, {
    id: 'ingest-dataset',
    label: limitFiles > 0 ? `Ingest dataset slice (${limitFiles} files)` : 'Ingest full dataset',
    run: () =>
      ingestNeuralDataset({
        registry,
        dataset,
        out: ingestDir,
        targetRate: positiveNumber(options.targetRate, 44100),
        segmentSeconds: positiveNumber(options.segmentSeconds, 8),
        minSegmentSeconds: positiveNumber(options.minSegmentSeconds, 0.35),
        silenceThreshold: positiveNumber(options.silenceThreshold, 0.012),
        limitFiles,
      }),
    summarize: summarizeIngest,
  })
  if (!ingest) {
    return finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions: ['Fix audio decoding or sidecar problems before training readiness.'] })
  }

  const readiness = runStep(steps, failures, {
    id: 'audit-training-readiness',
    label: 'Audit neural training readiness',
    run: () =>
      auditNeuralTrainingReadiness({
        ingestDir,
        registry,
        dataset,
        minMinutes: minReadinessMinutes,
        minAnnotatedRatio,
        minUniquePhonemes: positiveInteger(options.minUniquePhonemes, production ? 18 : 4),
        minMedianRms: positiveNumber(options.minMedianRms, 0.008),
        maxMedianRms: positiveNumber(options.maxMedianRms, 0.3),
        maxMeanSilenceRatio: ratioNumber(options.maxMeanSilenceRatio, 0.55),
        minMeanVoicedRatio: ratioNumber(options.minMeanVoicedRatio, 0.3),
        report: readinessPath,
      }),
    summarize: summarizeReadiness,
  })
  if (!readiness?.ok) {
    return finishFailure({
      reportPath,
      registry,
      dataset,
      workDir,
      production,
      limitFiles,
      steps,
      failures,
      nextActions: ['Fix recording quality, duration, phoneme coverage, or annotation coverage before OpenVPI alignment.'],
    })
  }

  const openVpi = runStep(steps, failures, {
    id: 'prepare-openvpi-seed',
    label: 'Prepare OpenVPI pre-alignment seed corpus',
    run: () => prepareOpenVpiSeed({ ingestDir, out: openVpiDir, copyAudio: options.copyAudio !== false }),
    summarize: summarizeOpenVpi,
  })
  if (!openVpi) {
    return finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions: ['Fix ingest output before OpenVPI seed generation.'] })
  }

  const dictionary = runStep(steps, failures, {
    id: 'prepare-korean-mfa-dictionary',
    label: 'Prepare Korean MFA dictionary from labels',
    run: () => prepareKoreanMfaDictionary({ seedDir: openVpiDir, out: dictionaryDir }),
    summarize: summarizeDictionary,
  })
  if (!dictionary) {
    return finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions: ['Fix unsupported Korean label tokens before alignment.'] })
  }

  const mfaCoverage = runStep(steps, failures, {
    id: 'audit-mfa-label-coverage',
    label: 'Audit MFA label coverage',
    run: () => auditMfaLabelCoverage({ seedDir: openVpiDir, dictionary: dictionary.dictionary, out: labelAuditDir }),
    summarize: summarizeMfaCoverage,
  })
  if (!mfaCoverage) {
    return finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions: ['Fix MFA dictionary OOV tokens before alignment.'] })
  }

  const alignmentJob = runStep(steps, failures, {
    id: 'prepare-makediffsinger-alignment-job',
    label: 'Prepare MakeDiffSinger/MFA alignment job bundle',
    run: () =>
      prepareMakeDiffSingerAlignmentJob({
        seedDir: openVpi.outputDir,
        dictionary: dictionary.dictionary,
        out: alignmentJobDir,
        makeDiffSingerRoot: options.makeDiffSingerRoot,
        python: options.alignmentPython ?? options.python,
        mfaCommand: options.mfaCommand,
        mfaModel: options.mfaModel,
        production,
        normalize: Boolean(options.normalizeAlignment),
        skipSilenceInsertion: Boolean(options.skipSilenceInsertion),
        enhancedDatasetDir: options.plannedEnhancedDatasetDir,
        enhancedDatasetAudit: join(workDir, 'enhanced-dataset-audit.json'),
      }),
    summarize: summarizeAlignmentJob,
  })
  if (!alignmentJob) {
    return finishFailure({
      reportPath,
      registry,
      dataset,
      workDir,
      production,
      limitFiles,
      steps,
      failures,
      nextActions: ['Run npm run neural:setup-openvpi and npm run neural:setup-mfa, then rerun the dataset handoff.'],
    })
  }

  if (!options.enhancedDatasetDir) {
    nextActions.push('Run the generated MakeDiffSinger alignment job scripts in order.')
    nextActions.push('Rerun this command with --enhanced-dataset-dir <MakeDiffSinger-enhanced-dataset> to prepare the DiffSinger training run and GPU job.')
    return finish({
      reportPath,
      report: baseReport({
        registry,
        dataset,
        workDir,
        production,
        limitFiles,
        status: 'alignment-ready-needs-makediffsinger',
        ok: true,
        steps,
        failures,
        acquisition: summarizeInspection(inspection),
        handoff: buildHandoff({ inspection, registry, dataset, workDir, providerDropAuditPath, production, limitFiles, reportPath }),
        artifacts: {
          providerDropAudit: existsSync(providerDropAuditPath) ? providerDropAuditPath : null,
          ingestDir,
          readiness: readinessPath,
          openVpiSeed: openVpi.outputDir,
          mfaDictionary: dictionary.dictionary,
          mfaCoverage: mfaCoverage.report,
          alignmentJob: alignmentJob.manifest,
          plannedEnhancedDatasetDir: alignmentJob.enhancedDatasetDir,
        },
        nextActions,
      }),
    })
  }

  const enhancedDatasetDir = resolve(options.enhancedDatasetDir)
  if (!existsSync(enhancedDatasetDir)) {
    failures.push({ id: 'enhanced-dataset-dir', error: `Missing enhanced dataset dir: ${enhancedDatasetDir}` })
    return finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions: ['Run MakeDiffSinger enhancement before preparing a training run.'] })
  }

  const enhancedAudit = runStep(steps, failures, {
    id: 'audit-diffsinger-enhanced-dataset',
    label: 'Audit MakeDiffSinger-enhanced dataset',
    run: () =>
      auditDiffSingerEnhancedDataset({
        datasetDir: enhancedDatasetDir,
        production,
        minItems: options.minEnhancedItems,
        minTotalSeconds: options.minEnhancedTotalSeconds,
        report: join(workDir, 'enhanced-dataset-audit.json'),
      }),
    summarize: summarizeEnhancedDataset,
  })
  if (!enhancedAudit?.ok) {
    return finishFailure({
      reportPath,
      registry,
      dataset,
      workDir,
      production,
      limitFiles,
      steps,
      failures,
      nextActions: ['Fix the MakeDiffSinger-enhanced dataset before preparing the training manifest.'],
    })
  }

  const trainingRun = runStep(steps, failures, {
    id: 'prepare-diffsinger-training',
    label: 'Prepare DiffSinger training run',
    run: () =>
      prepareDiffSingerTrainingRun({
        datasetDir: enhancedDatasetDir,
        out: trainingDir,
        dataset,
        datasetIds: [dataset],
        trainingReadiness: readinessPath,
        providerDropAudit: existsSync(providerDropAuditPath) ? providerDropAuditPath : options.providerDropAudit,
        production,
        modelId: options.modelId ?? 'webuta-ko-neural-candidate',
        modelName: options.modelName ?? 'WebUtau KO Neural Candidate',
        diffSingerRoot: options.diffSingerRoot,
        python: options.python,
        maxUpdates: positiveInteger(options.maxUpdates, production ? 200000 : 50000),
        checkpointStep: positiveInteger(options.checkpointStep, production ? 200000 : 50000),
        minCheckpointStep: positiveInteger(options.minCheckpointStep, production ? 50000 : 1000),
      }),
    summarize: summarizeTrainingRun,
  })
  if (!trainingRun) {
    return finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions: ['Fix the enhanced DiffSinger dataset or runtime paths before GPU job preparation.'] })
  }

  const gpuJob = runStep(steps, failures, {
    id: 'prepare-gpu-job',
    label: 'Prepare guarded remote GPU job bundle',
    run: () =>
      prepareDiffSingerGpuJob({
        manifest: trainingRun.manifest,
        out: gpuJobDir,
        remoteHost: options.remoteHost,
        remoteWorkDir: options.remoteWorkDir,
        remoteDiffSingerRoot: options.remoteDiffSingerRoot,
        remotePython: options.remotePython,
        checkpointStep: positiveInteger(options.checkpointStep, trainingRun.checkpointStep),
        maxUpdates: positiveInteger(options.maxUpdates, trainingRun.maxUpdates),
      }),
    summarize: summarizeGpuJob,
  })
  if (!gpuJob) {
    return finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions: ['Fix GPU job options and regenerate the bundle.'] })
  }

  return finish({
    reportPath,
    report: baseReport({
      registry,
      dataset,
      workDir,
      production,
      limitFiles,
      status: 'gpu-job-ready',
      ok: true,
      steps,
      failures,
      acquisition: summarizeInspection(inspection),
      handoff: buildHandoff({ inspection, registry, dataset, workDir, providerDropAuditPath, production, limitFiles, reportPath }),
      artifacts: {
        ingestDir,
        readiness: readinessPath,
        openVpiSeed: openVpi.outputDir,
        mfaDictionary: dictionary.dictionary,
        mfaCoverage: mfaCoverage.report,
        alignmentJob: alignmentJob.manifest,
        enhancedDatasetAudit: enhancedAudit ? join(workDir, 'enhanced-dataset-audit.json') : null,
        providerDropAudit: existsSync(providerDropAuditPath) ? providerDropAuditPath : null,
        trainingManifest: trainingRun.manifest,
        checkpointManifest: trainingRun.checkpointManifest,
        gpuJob: gpuJob.manifest,
      },
      nextActions: [
        'Review dataset terms for private remote GPU compute, then run the generated upload/run/download scripts.',
        'After checkpoint download, run neural:audit-checkpoint, promote the checkpoint, run browser neural smoke, and update release evidence.',
      ],
    }),
  })
}

function runStep(steps, failures, { id, label, run, summarize }) {
  try {
    const result = run()
    steps.push({
      id,
      label,
      status: 'passed',
      summary: summarize ? summarize(result) : result,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    steps.push({
      id,
      label,
      status: 'failed',
      error: message,
    })
    failures.push({ id, error: message })
    return null
  }
}

function blockerForInspection(inspection) {
  const stage = inspection.acquisition.stage
  if (stage === 'awaiting-provider-download' || stage === 'missing-intake-folder') {
    return {
      status: 'blocked-awaiting-provider-download',
      nextActions: inspection.acquisition.nextActions,
    }
  }
  if (stage === 'ingest-ready-needs-license-review') {
    return {
      status: 'blocked-license-review',
      nextActions: inspection.acquisition.nextActions,
    }
  }
  if (stage === 'extracted-needs-annotations') {
    return {
      status: 'blocked-annotations',
      nextActions: inspection.acquisition.nextActions,
    }
  }
  return null
}

function finishFailure({ reportPath, registry, dataset, workDir, production, limitFiles, steps, failures, nextActions }) {
  return finish({
    reportPath,
    report: baseReport({
      registry,
      dataset,
      workDir,
      production,
      limitFiles,
      status: 'failed-automation',
      ok: false,
      steps,
      failures,
      nextActions,
    }),
  })
}

function baseReport({ registry, dataset, workDir, production, limitFiles, status, ok, steps, failures, acquisition, handoff, artifacts, nextActions }) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'neural-dataset-handoff',
    ok,
    status,
    registry,
    dataset,
    workDir,
    production,
    limitFiles,
    acquisition: acquisition ?? null,
    handoff: handoff ?? null,
    artifacts: artifacts ?? {},
    steps,
    failures,
    nextActions: dedupe(nextActions ?? []),
  }
}

function buildHandoff({ inspection, registry, dataset, workDir, providerDropAuditPath, production, limitFiles, reportPath }) {
  const datasetRoot = inspection.localPath ?? null
  const rawDir = inspection.roots?.raw?.path ?? (datasetRoot ? join(datasetRoot, 'raw') : null)
  const extractedDir = inspection.roots?.extracted?.path ?? (datasetRoot ? join(datasetRoot, 'extracted') : null)
  const metadataDir = inspection.roots?.metadata?.path ?? (datasetRoot ? join(datasetRoot, 'metadata') : null)
  const licenseReview = inspection.licenseReview ?? {}
  const report = reportPath ?? join(workDir, 'latest.json')
  const runBase = [
    'npm run neural:run-dataset-handoff --',
    `--registry ${shellQuote(registry)}`,
    `--dataset ${shellQuote(dataset)}`,
    `--work-dir ${shellQuote(workDir)}`,
    `--report ${shellQuote(report)}`,
    production ? '--production' : '',
    limitFiles > 0 ? `--limit-files ${limitFiles}` : '--full-ingest',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    datasetName: inspection.datasetName ?? dataset,
    sourceUrl: inspection.sourceUrl ?? null,
    datasetRoot,
    rawDir,
    extractedDir,
    metadataDir,
    licenseReview: {
      templatePath: licenseReview.templatePath ?? null,
      templateExists: licenseReview.templateExists ?? false,
      reviewedPath: licenseReview.reviewedPath ?? null,
      reviewedExists: licenseReview.reviewedExists ?? false,
      requiresReview: licenseReview.requiresReview ?? false,
    },
    providerDropAudit: providerDropAuditPath,
    checklist: [
      inspection.sourceUrl ? `Get access to the provider dataset at ${inspection.sourceUrl}.` : 'Get access to the provider dataset.',
      rawDir ? `Place the complete original provider archives under ${rawDir}.` : 'Place the complete original provider archives under the dataset raw/ folder.',
      'Keep provider archives unchanged; do not train from preview clips, screenshots, or hand-trimmed WAVs.',
      `Run ${commandName('auditProviderDrop')} before extraction and keep the SHA-256 report.`,
      licenseReview.reviewedPath
        ? `Fill ${licenseReview.reviewedPath} after account/download approval and local-training rights review.`
        : 'Fill the local license review file after account/download approval and local-training rights review.',
      `Rerun ${commandName('runHandoff')} until the status reaches alignment-ready-needs-makediffsinger or gpu-job-ready.`,
    ],
    commands: {
      inspect: `npm run neural:inspect-intake -- --registry ${shellQuote(registry)} --dataset ${shellQuote(dataset)}`,
      auditProviderDrop: [
        'npm run neural:audit-provider-drop --',
        `--registry ${shellQuote(registry)}`,
        `--dataset ${shellQuote(dataset)}`,
        production ? '--production' : '',
        `--report ${shellQuote(providerDropAuditPath)}`,
      ]
        .filter(Boolean)
        .join(' '),
      runHandoff: runBase,
    },
    nextCommandsFromIntake: inspection.nextCommands ?? [],
  }
}

function commandName(key) {
  return `handoff.commands.${key}`
}

function finish({ reportPath, report }) {
  if (reportPath) {
    writeJson(reportPath, report)
  }
  return report
}

function summarizeInspection(report) {
  return {
    ok: report.ok,
    stage: report.acquisition.stage,
    providerDataAcquired: report.acquisition.providerDataAcquired,
    providerArchiveCount: report.acquisition.providerArchiveCount,
    trainingAudioCount: report.acquisition.trainingAudioCount,
    licenseReviewComplete: report.acquisition.licenseReviewComplete,
    annotationPairingReady: report.acquisition.annotationPairingReady,
    canStartDatasetAudit: report.acquisition.canStartDatasetAudit,
    canStartIngest: report.acquisition.canStartIngest,
    blockers: report.acquisition.blockers,
  }
}

function summarizeExtraction(report) {
  return {
    ok: report.ok,
    archiveCount: report.archiveCount,
    extractedFileCount: report.results.reduce((sum, result) => sum + result.extractedFileCount, 0),
    destinations: report.results.map((result) => result.destination),
  }
}

function summarizeProviderDrop(report) {
  return {
    ok: report.ok,
    decision: report.decision,
    production: report.production,
    archiveCount: report.metrics.archiveCount,
    supportedArchiveCount: report.metrics.supportedArchiveCount,
    unsupportedArchiveCount: report.metrics.unsupportedArchiveCount,
    totalSizeBytes: report.metrics.totalSizeBytes,
    hashedArchiveCount: report.metrics.hashedArchiveCount,
    minTotalBytes: report.gates.minTotalBytes,
    problemCount: report.problems.length,
  }
}

function summarizeSidecars(report) {
  return {
    writtenCount: report.sidecars.writtenCount,
    skippedExistingCount: report.sidecars.skippedExistingCount,
    plannedCount: report.sidecars.plannedCount,
    matchedAudioCount: report.rows.matchedAudioCount,
    matchedRowCount: report.rows.matchedRowCount,
    unmatchedCount: report.rows.unmatchedCount,
    ambiguousCount: report.rows.ambiguousCount,
  }
}

function summarizeDatasetAudit(report) {
  const dataset = report.datasets[0]
  return {
    ok: report.ok,
    problems: report.problems,
    datasetProblems: dataset?.problems ?? [],
    audioCount: dataset?.audio.fileCount ?? 0,
    knownDurationSeconds: dataset?.audio.knownDurationSeconds ?? 0,
    annotatedRatio: dataset?.annotations.annotatedRatio ?? 0,
  }
}

function summarizeIngest(result) {
  return {
    outputDir: result.summary.outputDir,
    audioCount: result.summary.files.audioCount,
    skippedCount: result.summary.files.skippedCount,
    segmentCount: result.summary.segments.count,
    totalDurationSeconds: result.summary.segments.totalDurationSeconds,
    uniquePhonemeCount: result.summary.lyricCoverage.uniquePhonemes.length,
  }
}

function summarizeReadiness(report) {
  return {
    ok: report.ok,
    datasetId: report.datasetId,
    metrics: report.metrics,
    failedGates: report.gates.filter((gate) => !gate.passed).map((gate) => gate.id),
  }
}

function summarizeOpenVpi(report) {
  return {
    outputDir: report.outputDir,
    copiedAudio: report.copiedAudio,
    segmentCount: report.segmentCount,
    transcriptions: report.transcriptions,
  }
}

function summarizeDictionary(report) {
  return {
    dictionary: report.dictionary,
    labFileCount: report.labFileCount,
    dictionaryEntryCount: report.dictionaryEntryCount,
    unsupportedTokenCount: report.unsupportedTokenCount,
    phoneInventoryCount: report.phoneInventoryCount,
  }
}

function summarizeMfaCoverage(report) {
  return {
    report: report.report,
    labFileCount: report.labFileCount,
    coveredUniqueTokenCount: report.coveredUniqueTokenCount,
    oovUniqueTokenCount: report.oovUniqueTokenCount,
    phoneInventoryCount: report.phoneInventoryCount,
  }
}

function summarizeAlignmentJob(report) {
  return {
    manifest: report.manifest,
    enhancedDatasetDir: report.enhancedDatasetDir,
    enhancedDatasetAudit: report.enhancedDatasetAudit,
    warningCount: report.warnings.length,
  }
}

function summarizeEnhancedDataset(report) {
  return {
    ok: report.ok,
    decision: report.decision,
    itemCount: report.metrics.itemCount,
    validWavDurationSeconds: report.metrics.validWavDurationSeconds,
    phoneInventoryCount: report.metrics.phoneInventoryCount,
    hasAp: report.metrics.hasAp,
    hasSp: report.metrics.hasSp,
    problemCount: report.problems.length,
  }
}

function summarizeTrainingRun(report) {
  return {
    manifest: report.manifest,
    checkpointManifest: report.checkpointManifest,
    itemCount: report.itemCount,
    trainItemCount: report.trainItemCount,
    validationItemCount: report.validationItemCount,
    maxUpdates: report.maxUpdates,
    checkpointStep: report.checkpointStep,
  }
}

function summarizeGpuJob(report) {
  return {
    manifest: report.manifest,
    remoteWorkDir: report.remoteWorkDir,
    checkpointStep: report.checkpointStep,
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : fallback
}

function ratioNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))]
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--dataset') {
      parsed.dataset = argv[++index]
    } else if (arg === '--work-dir') {
      parsed.workDir = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--production') {
      parsed.production = true
    } else if (arg === '--full-ingest') {
      parsed.fullIngest = true
    } else if (arg === '--limit-files') {
      parsed.limitFiles = Number(argv[++index])
    } else if (arg === '--min-local-training-minutes') {
      parsed.minLocalTrainingMinutes = Number(argv[++index])
    } else if (arg === '--min-readiness-minutes') {
      parsed.minReadinessMinutes = Number(argv[++index])
    } else if (arg === '--min-annotated-ratio') {
      parsed.minAnnotatedRatio = Number(argv[++index])
    } else if (arg === '--min-provider-archive-count') {
      parsed.minProviderArchiveCount = Number(argv[++index])
    } else if (arg === '--provider-drop-audit') {
      parsed.providerDropAudit = argv[++index]
    } else if (arg === '--min-provider-archive-total-bytes') {
      parsed.minProviderArchiveTotalBytes = Number(argv[++index])
    } else if (arg === '--min-provider-archive-total-gb') {
      parsed.minProviderArchiveTotalBytes = Number(argv[++index]) * 1024 ** 3
    } else if (arg === '--min-provider-archive-bytes') {
      parsed.minProviderArchiveBytes = Number(argv[++index])
    } else if (arg === '--inspect-provider-archive-entries') {
      parsed.inspectProviderArchiveEntries = true
    } else if (arg === '--skip-provider-archive-hash') {
      parsed.hashProviderArchives = false
    } else if (arg === '--min-unique-phonemes') {
      parsed.minUniquePhonemes = Number(argv[++index])
    } else if (arg === '--target-rate') {
      parsed.targetRate = Number(argv[++index])
    } else if (arg === '--segment-seconds') {
      parsed.segmentSeconds = Number(argv[++index])
    } else if (arg === '--min-segment-seconds') {
      parsed.minSegmentSeconds = Number(argv[++index])
    } else if (arg === '--silence-threshold') {
      parsed.silenceThreshold = Number(argv[++index])
    } else if (arg === '--max-mean-silence-ratio') {
      parsed.maxMeanSilenceRatio = Number(argv[++index])
    } else if (arg === '--min-mean-voiced-ratio') {
      parsed.minMeanVoicedRatio = Number(argv[++index])
    } else if (arg === '--enhanced-dataset-dir') {
      parsed.enhancedDatasetDir = argv[++index]
    } else if (arg === '--alignment-job-dir') {
      parsed.alignmentJobDir = argv[++index]
    } else if (arg === '--planned-enhanced-dataset-dir') {
      parsed.plannedEnhancedDatasetDir = argv[++index]
    } else if (arg === '--make-diffsinger-root') {
      parsed.makeDiffSingerRoot = argv[++index]
    } else if (arg === '--alignment-python') {
      parsed.alignmentPython = argv[++index]
    } else if (arg === '--mfa-command') {
      parsed.mfaCommand = argv[++index]
    } else if (arg === '--mfa-model') {
      parsed.mfaModel = argv[++index]
    } else if (arg === '--normalize-alignment') {
      parsed.normalizeAlignment = true
    } else if (arg === '--skip-silence-insertion') {
      parsed.skipSilenceInsertion = true
    } else if (arg === '--min-enhanced-items') {
      parsed.minEnhancedItems = Number(argv[++index])
    } else if (arg === '--min-enhanced-total-seconds') {
      parsed.minEnhancedTotalSeconds = Number(argv[++index])
    } else if (arg === '--diffsinger-root') {
      parsed.diffSingerRoot = argv[++index]
    } else if (arg === '--python') {
      parsed.python = argv[++index]
    } else if (arg === '--model-id') {
      parsed.modelId = argv[++index]
    } else if (arg === '--model-name') {
      parsed.modelName = argv[++index]
    } else if (arg === '--max-updates') {
      parsed.maxUpdates = Number(argv[++index])
    } else if (arg === '--checkpoint-step') {
      parsed.checkpointStep = Number(argv[++index])
    } else if (arg === '--min-checkpoint-step') {
      parsed.minCheckpointStep = Number(argv[++index])
    } else if (arg === '--remote-host') {
      parsed.remoteHost = argv[++index]
    } else if (arg === '--remote-work-dir') {
      parsed.remoteWorkDir = argv[++index]
    } else if (arg === '--remote-diffsinger-root') {
      parsed.remoteDiffSingerRoot = argv[++index]
    } else if (arg === '--remote-python') {
      parsed.remotePython = argv[++index]
    } else if (arg === '--overwrite-extraction') {
      parsed.overwriteExtraction = true
    } else if (arg === '--overwrite-sidecars') {
      parsed.overwriteSidecars = true
    } else if (arg === '--no-copy-audio') {
      parsed.copyAudio = false
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/run-neural-dataset-handoff.mjs [options]',
          '',
          'Options:',
          `  --registry path                  Dataset registry, default ${DEFAULT_REGISTRY}`,
          `  --dataset id                     Dataset id, default ${DEFAULT_DATASET}`,
          '  --work-dir path                  Ignored work output directory',
          '  --report path                    Write JSON handoff report',
          '  --production                     Use full-ingest and stricter production readiness defaults',
          '  --full-ingest                    Ingest all audio instead of a quick slice',
          `  --limit-files n                  Quick ingest file limit, default ${DEFAULT_LIMIT_FILES}`,
          `  --min-local-training-minutes n   Dataset audit duration gate, default ${DEFAULT_MIN_LOCAL_TRAINING_MINUTES}`,
          '  --min-readiness-minutes n        Readiness duration gate; defaults to 0 unless --production',
          `  --min-annotated-ratio n          Annotation gate, default ${DEFAULT_MIN_ANNOTATED_RATIO}`,
          '  --min-provider-archive-count n   Provider raw archive count gate before extraction',
          '  --provider-drop-audit path   Provider archive-drop audit report to write/read',
          '  --min-provider-archive-total-gb n Provider raw archive total-size gate before extraction',
          '  --inspect-provider-archive-entries Inspect archive entries during provider-drop audit',
          '  --skip-provider-archive-hash Skip SHA-256 hashing during provider-drop audit',
          '  --enhanced-dataset-dir path      MakeDiffSinger-enhanced dataset for training run preparation',
          '  --alignment-job-dir path         Output directory for generated MakeDiffSinger/MFA job scripts',
          '  --planned-enhanced-dataset-dir path  Planned output dataset path for the alignment job',
          '  --make-diffsinger-root path      MakeDiffSinger checkout root for alignment job generation',
          '  --alignment-python path          Python executable for MakeDiffSinger alignment scripts',
          '  --mfa-command path               MFA executable for generated alignment scripts',
          '  --mfa-model path                 MFA acoustic model zip for generated alignment scripts',
          '  --normalize-alignment            Normalize WAVs during MakeDiffSinger reformat step',
          '  --skip-silence-insertion         Skip silence insertion in MakeDiffSinger build_dataset step',
          '  --min-enhanced-items n           Override enhanced dataset item gate',
          '  --min-enhanced-total-seconds n   Override enhanced dataset duration gate',
          '  --overwrite-extraction           Replace existing extracted archive folders',
          '  --overwrite-sidecars             Replace generated sidecars',
          '  --dry-run                        Inspect and print planned next actions only',
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
    const report = runNeuralDatasetHandoff(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
