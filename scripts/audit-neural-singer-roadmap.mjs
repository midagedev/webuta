#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectNeuralDatasetIntake } from './inspect-neural-dataset-intake.mjs'

const DEFAULT_AIHUB_REGISTRY = 'experiments/neural-singer/datasets/aihub-guide-vocal/dataset-registry.local-template.json'
const DEFAULT_AIHUB_DATASET = 'aihub-guide-vocal'
const DEFAULT_ACQUISITION_SMOKE = 'experiments/neural-singer/work/aihub-acquisition-smoke/latest.json'
const DEFAULT_DATASET_SMOKE = 'experiments/neural-singer/work/dataset-first-pipeline-smoke/latest-aihub-training-contract.json'
const DEFAULT_PROVIDER_DROP_AUDIT = 'experiments/neural-singer/work/aihub-guide-vocal-provider-drop.json'
const DEFAULT_PUBLIC_DATASET_DISCOVERY_AUDIT = 'experiments/neural-singer/work/public-dataset-discovery-audit.json'
const DEFAULT_STATIC_BROWSER_SMOKE = 'experiments/neural-singer/work/browser-smoke/static-latest.json'
const DEFAULT_NEURAL_BROWSER_SMOKE =
  'experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/browser-smoke-actual-local-neural.json'
const DEFAULT_ENHANCED_DATASET_AUDIT = 'experiments/neural-singer/work/gtsinger-korean-diffsinger-full/enhanced-dataset-audit.json'
const DEFAULT_CHECKPOINT_AUDIT =
  'experiments/neural-singer/work/gtsinger-korean-diffsinger-training-full/model-checkpoint-mps-ramp-6000-audit.json'
const DEFAULT_RENDER_PROFILE_AUDIT = 'experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/render-profile-audit.json'
const DEFAULT_RELEASE_AUDIT = 'experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/release-audit.json'
const DEFAULT_CONTRACT_SMOKE = 'experiments/neural-singer/work/openutau-neural-contract/latest.json'

const NON_PRODUCTION_RELEASE_STATUSES = new Set(['(missing)', 'local-research', 'planned', 'smoke', 'demo', 'example'])

export function auditNeuralSingerRoadmap(options = {}) {
  const paths = {
    aihubRegistry: resolve(options.aihubRegistry ?? DEFAULT_AIHUB_REGISTRY),
    aihubDataset: options.aihubDataset ?? DEFAULT_AIHUB_DATASET,
    acquisitionSmoke: resolve(options.acquisitionSmoke ?? DEFAULT_ACQUISITION_SMOKE),
    datasetSmoke: resolve(options.datasetSmoke ?? DEFAULT_DATASET_SMOKE),
    providerDropAudit: resolve(options.providerDropAudit ?? DEFAULT_PROVIDER_DROP_AUDIT),
    publicDatasetDiscoveryAudit: resolve(options.publicDatasetDiscoveryAudit ?? DEFAULT_PUBLIC_DATASET_DISCOVERY_AUDIT),
    staticBrowserSmoke: resolve(options.staticBrowserSmoke ?? DEFAULT_STATIC_BROWSER_SMOKE),
    neuralBrowserSmoke: resolve(options.neuralBrowserSmoke ?? DEFAULT_NEURAL_BROWSER_SMOKE),
    enhancedDatasetAudit: resolve(options.enhancedDatasetAudit ?? DEFAULT_ENHANCED_DATASET_AUDIT),
    checkpointAudit: resolve(options.checkpointAudit ?? DEFAULT_CHECKPOINT_AUDIT),
    renderProfileAudit: resolve(options.renderProfileAudit ?? DEFAULT_RENDER_PROFILE_AUDIT),
    releaseAudit: resolve(options.releaseAudit ?? DEFAULT_RELEASE_AUDIT),
    contractSmoke: resolve(options.contractSmoke ?? DEFAULT_CONTRACT_SMOKE),
  }

  const intake = inspectIntakeSafely(paths.aihubRegistry, paths.aihubDataset)
  const evidence = {
    acquisitionSmoke: readOptionalJson(paths.acquisitionSmoke),
    datasetSmoke: readOptionalJson(paths.datasetSmoke),
    providerDropAudit: readOptionalJson(paths.providerDropAudit),
    publicDatasetDiscoveryAudit: readOptionalJson(paths.publicDatasetDiscoveryAudit),
    staticBrowserSmoke: readOptionalJson(paths.staticBrowserSmoke),
    neuralBrowserSmoke: readOptionalJson(paths.neuralBrowserSmoke),
    enhancedDatasetAudit: readOptionalJson(paths.enhancedDatasetAudit),
    checkpointAudit: readOptionalJson(paths.checkpointAudit),
    renderProfileAudit: readOptionalJson(paths.renderProfileAudit),
    releaseAudit: readOptionalJson(paths.releaseAudit),
    contractSmoke: readOptionalJson(paths.contractSmoke),
  }

  const checks = [
    checkRealDataset(intake, evidence.providerDropAudit),
    checkAcquisitionSmoke(evidence.acquisitionSmoke),
    checkDatasetSmoke(evidence.datasetSmoke),
    checkPublicDatasetDiscovery(evidence.publicDatasetDiscoveryAudit),
    checkStaticBrowserSmoke(evidence.staticBrowserSmoke),
    checkNeuralBrowserSmoke(evidence.neuralBrowserSmoke),
    checkOpenUtauContract(evidence.contractSmoke),
    checkEnhancedDatasetAudit(evidence.enhancedDatasetAudit),
    checkRealCheckpoint(evidence.checkpointAudit),
    checkRenderProfile(evidence.renderProfileAudit),
    checkReleaseReadiness(evidence.releaseAudit),
  ]
  const summary = summarizeChecks(checks)
  const blockers = checks
    .filter((check) => check.requiredForCompletion && check.status !== 'passed')
    .map((check) => `${check.label}: ${check.nextAction}`)
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: blockers.length === 0,
    decision: blockers.length === 0 ? 'roadmap-complete' : 'roadmap-incomplete',
    paths,
    summary,
    blockers,
    checks,
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

function checkRealDataset(intake, providerDropSource) {
  const acquisition = intake.report?.acquisition ?? {}
  const blockers = Array.isArray(acquisition.blockers) ? acquisition.blockers : [intake.error].filter(Boolean)
  const providerDrop = providerDropSource.value
  const providerDropReady =
    providerDropSource.exists &&
    !providerDropSource.error &&
    providerDrop?.ok === true &&
    providerDrop.decision === 'provider-archive-ready' &&
    providerDrop.production === true &&
    Number(providerDrop.metrics?.archiveCount ?? 0) > 0 &&
    Number(providerDrop.metrics?.hashedArchiveCount ?? 0) >= Number(providerDrop.metrics?.archiveCount ?? 0) &&
    Number(providerDrop.metrics?.totalSizeBytes ?? 0) >= Number(providerDrop.gates?.minTotalBytes ?? 0)
  const passed =
    intake.ok &&
    providerDropReady &&
    acquisition.stage === 'ready-for-audit-and-ingest' &&
    acquisition.providerDataAcquired === true &&
    Number(acquisition.trainingAudioCount ?? 0) > 0 &&
    acquisition.licenseReviewComplete === true &&
    acquisition.annotationPairingReady === true &&
    acquisition.canStartDatasetAudit === true &&
    acquisition.canStartIngest === true

  return roadmapCheck({
    id: 'real-dataset-acquired',
    label: 'Licensed Korean singing dataset acquired',
    requiredForCompletion: true,
    status: passed ? 'passed' : intake.ok ? 'pending' : 'failed',
    evidence: {
      registryPath: intake.registryPath,
      datasetId: intake.datasetId,
      stage: acquisition.stage ?? null,
      providerDataAcquired: acquisition.providerDataAcquired ?? false,
      providerArchiveCount: acquisition.providerArchiveCount ?? 0,
      providerDropAuditPath: providerDropSource.path,
      providerDropAuditExists: providerDropSource.exists,
      providerDropReady,
      providerDropDecision: providerDrop?.decision ?? null,
      providerDropProduction: providerDrop?.production ?? false,
      providerDropTotalSizeBytes: providerDrop?.metrics?.totalSizeBytes ?? 0,
      providerDropMinTotalBytes: providerDrop?.gates?.minTotalBytes ?? 0,
      providerDropHashedArchiveCount: providerDrop?.metrics?.hashedArchiveCount ?? 0,
      trainingAudioCount: acquisition.trainingAudioCount ?? 0,
      licenseReviewComplete: acquisition.licenseReviewComplete ?? false,
      annotationPairingReady: acquisition.annotationPairingReady ?? false,
      canStartDatasetAudit: acquisition.canStartDatasetAudit ?? false,
      canStartIngest: acquisition.canStartIngest ?? false,
      blockers,
    },
    nextAction: passed
      ? 'Run dataset audit, ingest, readiness, alignment, and training from this intake.'
      : 'Acquire the licensed provider dataset, pass provider-drop audit with SHA-256 archive hashes, place original archives under raw/, extract/sidecar it, then complete the local license review.',
  })
}

function checkAcquisitionSmoke(source) {
  const report = source.value
  const providerDropReport = report?.gates?.providerDrop?.reportPath ?? null
  const trainingManifest = readOptionalJson(report?.gates?.trainingRun?.manifest)
  const gpuJobManifest = readOptionalJson(report?.gates?.gpuJob?.manifest)
  const alignmentJobManifest = readOptionalJson(report?.gates?.alignmentJob?.manifest)
  const trainingProviderDropAudit = trainingManifest.value?.providerDropAudit ?? null
  const gpuProviderDropAudit = gpuJobManifest.value?.lineage?.providerDropAudit ?? null
  const alignmentJobReady =
    alignmentJobManifest.exists &&
    !alignmentJobManifest.error &&
    alignmentJobManifest.value?.source === 'webuta-makediffsinger-alignment-job' &&
    Boolean(alignmentJobManifest.value?.scripts?.['02-run-mfa-align.sh'])
  const providerLineageReady =
    typeof providerDropReport === 'string' &&
    providerDropReport.length > 0 &&
    trainingProviderDropAudit === providerDropReport &&
    gpuProviderDropAudit === providerDropReport
  const passed =
    source.exists &&
    !source.error &&
    report?.ok === true &&
    report.mode === 'aihub-acquisition-smoke' &&
    report.gates?.providerDrop?.ok === true &&
    Boolean(report.gates?.trainingRun?.manifest) &&
    Boolean(report.gates?.gpuJob?.manifest) &&
    alignmentJobReady &&
    providerLineageReady

  return roadmapCheck({
    id: 'acquisition-pipeline-smoke',
    label: 'Dataset acquisition pipeline smoke',
    requiredForCompletion: false,
    status: statusForOptionalJson(source, passed),
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      mode: report?.mode ?? null,
      providerDropOk: report?.gates?.providerDrop?.ok ?? false,
      providerDropReport,
      providerLineageReady,
      trainingManifest: report?.gates?.trainingRun?.manifest ?? null,
      trainingManifestExists: trainingManifest.exists,
      trainingManifestError: trainingManifest.error,
      trainingProviderDropAudit,
      alignmentJobManifest: report?.gates?.alignmentJob?.manifest ?? null,
      alignmentJobManifestExists: alignmentJobManifest.exists,
      alignmentJobManifestError: alignmentJobManifest.error,
      alignmentJobReady,
      gpuJobManifest: report?.gates?.gpuJob?.manifest ?? null,
      gpuJobManifestExists: gpuJobManifest.exists,
      gpuJobManifestError: gpuJobManifest.error,
      gpuProviderDropAudit,
      note: report?.note ?? null,
    },
    nextAction: passed
      ? 'Keep this as wiring evidence only; replace the synthetic fixture with real provider data for completion.'
      : 'Run npm run smoke:aihub-acquisition and inspect the report.',
  })
}

function checkDatasetSmoke(source) {
  const report = source.value
  const passed =
    source.exists &&
    !source.error &&
    report?.ok === true &&
    report.gates?.readiness?.ok === true &&
    Number(report.gates?.mfaCoverage?.oovUniqueTokenCount ?? 1) === 0

  return roadmapCheck({
    id: 'dataset-prep-smoke',
    label: 'Dataset preparation and MFA smoke',
    requiredForCompletion: false,
    status: statusForOptionalJson(source, passed),
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      mode: report?.mode ?? null,
      datasetId: report?.datasetId ?? null,
      readinessOk: report?.gates?.readiness?.ok ?? false,
      oovUniqueTokenCount: report?.gates?.mfaCoverage?.oovUniqueTokenCount ?? null,
      note: report?.note ?? null,
    },
    nextAction: passed
      ? 'Use the same audit/ingest/readiness sequence on the real licensed dataset.'
      : 'Run npm run smoke:dataset-pipeline and fix readiness or MFA coverage failures.',
  })
}

function checkPublicDatasetDiscovery(source) {
  const report = source.value
  const passed = source.exists && !source.error && report?.ok === true && report.decision === 'public-dataset-discovery-ready'

  return roadmapCheck({
    id: 'public-dataset-discovery',
    label: 'Public Korean dataset discovery audit',
    requiredForCompletion: false,
    status: statusForOptionalJson(source, passed),
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      decision: report?.decision ?? null,
      summary: report?.summary ?? null,
      productionConclusion: report?.productionConclusion ?? null,
      problems: report?.problems ?? [],
    },
    nextAction: passed
      ? 'Keep this as public dataset discovery evidence; it does not replace licensed production data.'
      : 'Run npm run neural:audit-public-datasets and inspect the candidate blockers.',
  })
}

function checkStaticBrowserSmoke(source) {
  const report = source.value
  const passed = source.exists && !source.error && report?.ok === true && report.mode === 'static' && wavDownloadOk(report)

  return roadmapCheck({
    id: 'browser-static-export',
    label: 'Browser WAV export surface',
    requiredForCompletion: true,
    status: statusForOptionalJson(source, passed),
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      mode: report?.mode ?? null,
      wav: report?.download?.wav ?? null,
      checks: report?.checks ?? [],
    },
    nextAction: passed
      ? 'Keep browser export smoke attached when UI changes.'
      : 'Run npm run smoke:browser and preserve the DAW-ready WAV export checks.',
  })
}

function checkNeuralBrowserSmoke(source) {
  const report = source.value
  const passed = source.exists && !source.error && report?.ok === true && report.mode === 'local-neural' && wavDownloadOk(report)

  return roadmapCheck({
    id: 'browser-neural-contract',
    label: 'Browser neural render contract smoke',
    requiredForCompletion: false,
    status: passed ? 'smoke-only' : statusForOptionalJson(source, false),
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      mode: report?.mode ?? null,
      neuralEndpoint: report?.neuralEndpoint ?? null,
      wav: report?.download?.wav ?? null,
      checks: report?.checks ?? [],
    },
    nextAction: passed
      ? 'Keep this as actual local neural wiring evidence; replace the smoke checkpoint with a quality-trained checkpoint for completion.'
      : 'Run npm run smoke:browser:neural:actual after the render service contract changes.',
  })
}

function checkOpenUtauContract(source) {
  const report = source.value
  const passed = source.exists && !source.error && report?.ok === true

  return roadmapCheck({
    id: 'openutau-compatibility-contract',
    label: 'UTAU/OpenUtau compatibility contract',
    requiredForCompletion: true,
    status: statusForOptionalJson(source, passed),
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      mode: report?.mode ?? null,
      checks: report?.checks ?? [],
    },
    nextAction: passed
      ? 'Keep compatibility smoke evidence with release artifacts.'
      : 'Run the UTAU/OpenUtau contract smoke and persist its JSON evidence for this roadmap audit.',
  })
}

function checkEnhancedDatasetAudit(source) {
  const report = source.value
  const ready = source.exists && !source.error && report?.ok === true && report.decision === 'enhanced-dataset-ready'
  const productionReady = ready && report.production === true
  const status = productionReady ? 'passed' : ready ? 'smoke-only' : statusForOptionalJson(source, false)

  return roadmapCheck({
    id: 'production-enhanced-dataset',
    label: 'Production MakeDiffSinger enhanced dataset audit',
    requiredForCompletion: true,
    status,
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      decision: report?.decision ?? null,
      production: report?.production ?? false,
      metrics: report?.metrics ?? null,
      problems: report?.problems ?? [],
    },
    nextAction: productionReady
      ? 'Use this enhanced dataset audit as training-run evidence.'
      : ready
        ? 'Rerun the enhanced dataset audit in production mode on the real MakeDiffSinger-aligned dataset.'
        : 'Run neural:audit-enhanced-dataset on the MakeDiffSinger-enhanced real dataset before preparing the training run.',
  })
}

function checkRealCheckpoint(source) {
  const report = source.value
  const ready = source.exists && !source.error && report?.ok === true && report.decision === 'checkpoint-ready'
  const production = ready && productionModelEvidence(report)
  const status = production ? 'passed' : ready ? 'smoke-only' : statusForOptionalJson(source, false)

  return roadmapCheck({
    id: 'real-trained-checkpoint',
    label: 'Production-track trained Korean singer checkpoint',
    requiredForCompletion: true,
    status,
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      decision: report?.decision ?? null,
      model: report?.model ?? null,
      datasets: report?.datasets ?? [],
      training: report?.training ?? null,
      problems: report?.problems ?? [],
    },
    nextAction: production
      ? 'Use this checkpoint for render-profile, quality, listening, and release audits.'
      : ready
        ? 'Train or attach a non-smoke checkpoint from a license-reviewed Korean singing dataset.'
        : 'Run npm run neural:audit-checkpoint against a trained DiffSinger checkpoint.',
  })
}

function checkRenderProfile(source) {
  const report = source.value
  const ready = source.exists && !source.error && report?.ok === true && report.decision === 'render-profile-ready'
  const production = ready && productionModelEvidence(report)
  const status = production ? 'passed' : ready ? 'smoke-only' : statusForOptionalJson(source, false)

  return roadmapCheck({
    id: 'real-render-profile',
    label: 'Audited local neural render profile',
    requiredForCompletion: true,
    status,
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      decision: report?.decision ?? null,
      model: report?.model ?? null,
      endpoint: report?.endpoint ?? null,
      problems: report?.problems ?? [],
    },
    nextAction: production
      ? 'Run the real render service and browser neural smoke against this endpoint.'
      : ready
        ? 'Promote a render profile from the real trained checkpoint rather than the local-research smoke model.'
        : 'Run npm run neural:audit-render-profile for the promoted real checkpoint.',
  })
}

function checkReleaseReadiness(source) {
  const report = source.value
  const ready = source.exists && !source.error && report?.ok === true && report.decision === 'release-ready'
  const production = ready && productionModelEvidence(report)
  const status = production ? 'passed' : ready ? 'smoke-only' : statusForOptionalJson(source, false)

  return roadmapCheck({
    id: 'release-readiness',
    label: 'Model and browser release readiness',
    requiredForCompletion: true,
    status,
    evidence: {
      path: source.path,
      exists: source.exists,
      error: source.error,
      decision: report?.decision ?? null,
      model: report?.model ?? null,
      evidence: report?.evidence ?? null,
      problems: report?.problems ?? [],
    },
    nextAction: production
      ? 'Keep the release audit with the final model bundle.'
      : ready
        ? 'Replace the smoke/research release audit with a real private-family or public-release audit.'
        : 'Run npm run neural:audit-release with checkpoint, quality, listening, browser, and license evidence.',
  })
}

function inspectIntakeSafely(registryPath, datasetId) {
  try {
    const report = inspectNeuralDatasetIntake({
      registry: registryPath,
      dataset: datasetId,
    })
    return {
      ok: true,
      registryPath,
      datasetId,
      report,
      error: null,
    }
  } catch (error) {
    return {
      ok: false,
      registryPath,
      datasetId,
      report: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function readOptionalJson(path) {
  if (!path || !existsSync(path)) {
    return {
      path,
      exists: false,
      error: null,
      value: null,
    }
  }
  try {
    return {
      path,
      exists: true,
      error: null,
      value: JSON.parse(readFileSync(path, 'utf8')),
    }
  } catch (error) {
    return {
      path,
      exists: true,
      error: error instanceof Error ? error.message : String(error),
      value: null,
    }
  }
}

function roadmapCheck({ id, label, requiredForCompletion, status, evidence, nextAction }) {
  return {
    id,
    label,
    requiredForCompletion: Boolean(requiredForCompletion),
    status,
    passed: status === 'passed',
    evidence,
    nextAction,
  }
}

function statusForOptionalJson(source, passed) {
  if (passed) {
    return 'passed'
  }
  if (source.error) {
    return 'failed'
  }
  return source.exists ? 'failed' : 'pending'
}

function wavDownloadOk(report) {
  const wav = report?.download?.wav
  return Boolean(wav && wav.sampleRate === 44100 && wav.channels === 1 && wav.bitsPerSample === 16 && Number(wav.durationSeconds ?? 0) >= 2)
}

function productionModelEvidence(report) {
  const status = String(report?.model?.releaseStatus ?? report?.model?.releaseIntent ?? '(missing)').toLowerCase()
  if (NON_PRODUCTION_RELEASE_STATUSES.has(status) || /(local|research|smoke|dev|demo|example|planned)/u.test(status)) {
    return false
  }

  const identity = `${report?.model?.id ?? ''} ${report?.model?.name ?? ''}`.toLowerCase()
  if (/(smoke|research|ramp|dev|demo|fixture|test|example)/u.test(identity)) {
    return false
  }

  const datasets = Array.isArray(report?.datasets)
    ? report.datasets
    : Array.isArray(report?.evidence?.datasets)
      ? report.evidence.datasets
      : []
  for (const dataset of datasets) {
    const datasetEvidence = `${dataset.id ?? ''} ${dataset.licenseStatus ?? ''} ${dataset.modelPublishing ?? ''}`.toLowerCase()
    if (/(csd|smoke|fixture|research-only|noncommercial|no-commercial)/u.test(datasetEvidence)) {
      return false
    }
  }
  return true
}

function summarizeChecks(checks) {
  const summary = {
    passedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    smokeOnlyCount: 0,
    requiredPassedCount: 0,
    requiredCount: 0,
  }
  for (const check of checks) {
    if (check.status === 'passed') {
      summary.passedCount += 1
    } else if (check.status === 'pending') {
      summary.pendingCount += 1
    } else if (check.status === 'failed') {
      summary.failedCount += 1
    } else if (check.status === 'smoke-only') {
      summary.smokeOnlyCount += 1
    }
    if (check.requiredForCompletion) {
      summary.requiredCount += 1
      if (check.status === 'passed') {
        summary.requiredPassedCount += 1
      }
    }
  }
  return summary
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--aihub-registry') {
      parsed.aihubRegistry = argv[++index]
    } else if (arg === '--aihub-dataset') {
      parsed.aihubDataset = argv[++index]
    } else if (arg === '--acquisition-smoke') {
      parsed.acquisitionSmoke = argv[++index]
    } else if (arg === '--dataset-smoke') {
      parsed.datasetSmoke = argv[++index]
    } else if (arg === '--provider-drop-audit') {
      parsed.providerDropAudit = argv[++index]
    } else if (arg === '--public-dataset-discovery-audit') {
      parsed.publicDatasetDiscoveryAudit = argv[++index]
    } else if (arg === '--static-browser-smoke') {
      parsed.staticBrowserSmoke = argv[++index]
    } else if (arg === '--neural-browser-smoke') {
      parsed.neuralBrowserSmoke = argv[++index]
    } else if (arg === '--enhanced-dataset-audit') {
      parsed.enhancedDatasetAudit = argv[++index]
    } else if (arg === '--checkpoint-audit') {
      parsed.checkpointAudit = argv[++index]
    } else if (arg === '--render-profile-audit') {
      parsed.renderProfileAudit = argv[++index]
    } else if (arg === '--release-audit') {
      parsed.releaseAudit = argv[++index]
    } else if (arg === '--contract-smoke') {
      parsed.contractSmoke = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-neural-singer-roadmap.mjs [options]',
          '',
          'Options:',
          `  --aihub-registry path        Local AI Hub registry, default ${DEFAULT_AIHUB_REGISTRY}`,
          `  --aihub-dataset id           Dataset id, default ${DEFAULT_AIHUB_DATASET}`,
          `  --acquisition-smoke path     Acquisition smoke JSON, default ${DEFAULT_ACQUISITION_SMOKE}`,
          `  --dataset-smoke path         Dataset pipeline smoke JSON, default ${DEFAULT_DATASET_SMOKE}`,
          `  --provider-drop-audit path   Provider archive-drop audit JSON, default ${DEFAULT_PROVIDER_DROP_AUDIT}`,
          `  --public-dataset-discovery-audit path Public dataset discovery JSON, default ${DEFAULT_PUBLIC_DATASET_DISCOVERY_AUDIT}`,
          `  --static-browser-smoke path  Static browser smoke JSON, default ${DEFAULT_STATIC_BROWSER_SMOKE}`,
          `  --neural-browser-smoke path  Neural browser smoke JSON, default ${DEFAULT_NEURAL_BROWSER_SMOKE}`,
          `  --enhanced-dataset-audit path MakeDiffSinger enhanced dataset audit JSON, default ${DEFAULT_ENHANCED_DATASET_AUDIT}`,
          `  --checkpoint-audit path      Model checkpoint audit JSON, default ${DEFAULT_CHECKPOINT_AUDIT}`,
          `  --render-profile-audit path  Render profile audit JSON, default ${DEFAULT_RENDER_PROFILE_AUDIT}`,
          `  --release-audit path         Release readiness audit JSON, default ${DEFAULT_RELEASE_AUDIT}`,
          `  --contract-smoke path        UTAU/OpenUtau contract smoke JSON, default ${DEFAULT_CONTRACT_SMOKE}`,
          '  --report path                Write JSON roadmap report',
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
    const report = auditNeuralSingerRoadmap(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
