import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditNeuralSingerRoadmap } from './audit-neural-singer-roadmap.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural singer roadmap audit', () => {
  it('keeps the roadmap incomplete when only smoke evidence exists', () => {
    const fixture = makeRoadmapFixture({
      withRealDataset: false,
      withEnhancedDatasetAudit: false,
      withProductionCheckpoint: false,
      withContractEvidence: false,
      withReleaseEvidence: false,
    })

    const report = auditNeuralSingerRoadmap(fixture.options)

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('roadmap-incomplete')
    expect(checkById(report, 'real-dataset-acquired')).toMatchObject({
      requiredForCompletion: true,
      status: 'pending',
      evidence: {
        stage: 'awaiting-provider-download',
        providerDataAcquired: false,
        providerDropReady: false,
        trainingAudioCount: 0,
      },
    })
    expect(checkById(report, 'acquisition-pipeline-smoke')).toMatchObject({
      status: 'passed',
      evidence: {
        providerLineageReady: true,
        alignmentJobReady: true,
      },
    })
    expect(checkById(report, 'real-trained-checkpoint').status).toBe('smoke-only')
    expect(checkById(report, 'production-enhanced-dataset').status).toBe('pending')
    expect(checkById(report, 'openutau-compatibility-contract').status).toBe('pending')
    expect(checkById(report, 'public-dataset-discovery').status).toBe('passed')
    expect(report.blockers.join('\n')).toContain('Licensed Korean singing dataset acquired')
  })

  it('passes when real dataset, production checkpoint, compatibility, and release evidence all agree', () => {
    const fixture = makeRoadmapFixture()

    const report = auditNeuralSingerRoadmap(fixture.options)

    expect(report).toMatchObject({
      ok: true,
      decision: 'roadmap-complete',
      summary: {
        requiredPassedCount: 7,
        requiredCount: 7,
      },
      blockers: [],
    })
    expect(checkById(report, 'real-dataset-acquired')).toMatchObject({
      status: 'passed',
      evidence: {
        stage: 'ready-for-audit-and-ingest',
        providerDataAcquired: true,
        providerDropReady: true,
        providerDropHashedArchiveCount: 1,
        trainingAudioCount: 1,
        licenseReviewComplete: true,
      },
    })
    expect(checkById(report, 'browser-neural-contract').status).toBe('smoke-only')
    expect(checkById(report, 'public-dataset-discovery')).toMatchObject({
      requiredForCompletion: false,
      status: 'passed',
    })
  })

  it('fails acquisition smoke when provider archive provenance does not reach the GPU job', () => {
    const fixture = makeRoadmapFixture({ breakAcquisitionGpuLineage: true })

    const report = auditNeuralSingerRoadmap(fixture.options)
    const smoke = checkById(report, 'acquisition-pipeline-smoke')

    expect(smoke.status).toBe('failed')
    expect(smoke.evidence).toMatchObject({
      providerLineageReady: false,
      trainingProviderDropAudit: fixture.acquisitionProviderDropAudit,
      gpuProviderDropAudit: null,
    })
  })

  it('runs from the command line and writes a roadmap report', () => {
    const fixture = makeRoadmapFixture()
    const reportPath = join(fixture.root, 'roadmap-report.json')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-neural-singer-roadmap.mjs',
        '--aihub-registry',
        fixture.options.aihubRegistry,
        '--acquisition-smoke',
        fixture.options.acquisitionSmoke,
        '--dataset-smoke',
        fixture.options.datasetSmoke,
        '--provider-drop-audit',
        fixture.options.providerDropAudit,
        '--public-dataset-discovery-audit',
        fixture.options.publicDatasetDiscoveryAudit,
        '--static-browser-smoke',
        fixture.options.staticBrowserSmoke,
        '--neural-browser-smoke',
        fixture.options.neuralBrowserSmoke,
        '--enhanced-dataset-audit',
        fixture.options.enhancedDatasetAudit,
        '--checkpoint-audit',
        fixture.options.checkpointAudit,
        '--render-profile-audit',
        fixture.options.renderProfileAudit,
        '--release-audit',
        fixture.options.releaseAudit,
        '--contract-smoke',
        fixture.options.contractSmoke,
        '--report',
        reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).decision).toBe('roadmap-complete')
  })
})

function makeRoadmapFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-roadmap-audit-'))
  tempRoots.push(root)
  const datasetRoot = join(root, 'aihub-guide-vocal')
  const registryPath = join(root, 'dataset-registry.local.json')
  const acquisitionSmoke = join(root, 'aihub-acquisition-smoke.json')
  const datasetSmoke = join(root, 'dataset-smoke.json')
  const providerDropAudit = join(root, 'provider-drop-audit.json')
  const publicDatasetDiscoveryAudit = join(root, 'public-dataset-discovery-audit.json')
  const staticBrowserSmoke = join(root, 'static-browser-smoke.json')
  const neuralBrowserSmoke = join(root, 'neural-browser-smoke.json')
  const enhancedDatasetAudit = join(root, 'enhanced-dataset-audit.json')
  const checkpointAudit = join(root, 'checkpoint-audit.json')
  const renderProfileAudit = join(root, 'render-profile-audit.json')
  const releaseAudit = join(root, 'release-audit.json')
  const contractSmoke = join(root, 'contract-smoke.json')
  const acquisitionProviderDropAudit = join(root, 'acquisition-provider-drop-audit.json')
  const acquisitionTrainingManifest = join(root, 'acquisition-training.manifest.json')
  const acquisitionGpuManifest = join(root, 'acquisition-gpu-job.manifest.json')
  const acquisitionAlignmentManifest = join(root, 'acquisition-alignment-job.manifest.json')

  materializeDatasetFixture(datasetRoot, options)
  writeJson(registryPath, makeRegistry(datasetRoot, options.withRealDataset !== false))
  writeJson(acquisitionTrainingManifest, {
    version: 1,
    source: 'webuta-diffsinger-training-run',
    providerDropAudit: acquisitionProviderDropAudit,
  })
  writeJson(acquisitionGpuManifest, {
    version: 1,
    source: 'webuta-diffsinger-gpu-job',
    lineage: {
      providerDropAudit: options.breakAcquisitionGpuLineage ? null : acquisitionProviderDropAudit,
    },
  })
  writeJson(acquisitionAlignmentManifest, {
    version: 1,
    source: 'webuta-makediffsinger-alignment-job',
    scripts: {
      '02-run-mfa-align.sh': join(root, 'alignment', '02-run-mfa-align.sh'),
    },
  })
  writeJson(
    acquisitionSmoke,
    makeAcquisitionSmoke({
      providerDropAudit: acquisitionProviderDropAudit,
      trainingManifest: acquisitionTrainingManifest,
      gpuManifest: acquisitionGpuManifest,
      alignmentManifest: acquisitionAlignmentManifest,
    }),
  )
  writeJson(datasetSmoke, makeDatasetSmoke())
  if (options.withRealDataset !== false && options.withProviderDropAudit !== false) {
    writeJson(providerDropAudit, makeProviderDropAudit())
  }
  writeJson(publicDatasetDiscoveryAudit, makePublicDatasetDiscoveryAudit())
  writeJson(staticBrowserSmoke, makeBrowserSmoke('static'))
  writeJson(neuralBrowserSmoke, makeBrowserSmoke('local-neural'))
  if (options.withEnhancedDatasetAudit !== false) {
    writeJson(enhancedDatasetAudit, makeEnhancedDatasetAudit(options.withProductionEnhancedDataset !== false))
  }
  writeJson(checkpointAudit, makeCheckpointAudit(options.withProductionCheckpoint !== false))
  writeJson(renderProfileAudit, makeRenderProfileAudit(options.withProductionCheckpoint !== false))
  if (options.withReleaseEvidence !== false) {
    writeJson(releaseAudit, makeReleaseAudit())
  }
  if (options.withContractEvidence !== false) {
    writeJson(contractSmoke, {
      version: 1,
      ok: true,
      mode: 'openutau-neural-contract',
      checks: ['UTAU/OpenUtau import compatibility', 'neural render request preserves notes'],
    })
  }

  return {
    root,
    options: {
      aihubRegistry: registryPath,
      acquisitionSmoke,
      datasetSmoke,
      providerDropAudit,
      publicDatasetDiscoveryAudit,
      staticBrowserSmoke,
      neuralBrowserSmoke,
      enhancedDatasetAudit,
      checkpointAudit,
      renderProfileAudit,
      releaseAudit,
      contractSmoke,
    },
    acquisitionProviderDropAudit,
  }
}

function makePublicDatasetDiscoveryAudit() {
  return {
    version: 1,
    ok: true,
    decision: 'public-dataset-discovery-ready',
    summary: {
      candidateCount: 8,
      presentCount: 8,
      localEvidenceReadyCount: 8,
      researchSingingReadyCount: 2,
      productionEligibleCount: 0,
    },
    productionConclusion: 'No currently acquired public Korean dataset is production-release evidence.',
    problems: [],
  }
}

function materializeDatasetFixture(datasetRoot, options) {
  mkdirSync(join(datasetRoot, 'raw'), { recursive: true })
  mkdirSync(join(datasetRoot, 'extracted'), { recursive: true })
  mkdirSync(join(datasetRoot, 'metadata'), { recursive: true })
  if (options.withRealDataset === false) {
    return
  }
  writeFileSync(join(datasetRoot, 'extracted', 'song-a.wav'), 'wav placeholder')
  writeFileSync(join(datasetRoot, 'extracted', 'song-a.csv'), 'start,end,lyric,midi_num\n0.0,0.5,도,60\n0.5,1.0,히,64\n')
  writeFileSync(
    join(datasetRoot, 'metadata', 'license-review.local.md'),
    [
      '# License Review Fixture',
      '',
      '- Reviewer: Test Reviewer',
      '- Review date: 2026-06-30',
      '- Account/download approval confirmed: yes',
      '- Local training allowed: yes',
      '- Public model release allowed: no',
      '- Public audio examples allowed: no',
      '',
    ].join('\n'),
  )
}

function makeRegistry(localPath, localTraining) {
  return {
    version: 1,
    datasets: [
      {
        id: 'aihub-guide-vocal',
        name: 'AI Hub guide vocal fixture',
        sourceUrl: 'https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=473',
        localPath,
        licenseStatus: localTraining ? 'license-reviewed-local-training' : 'review-required-aihub-terms',
        redistribution: 'private-local-only',
        modelPublishing: localTraining ? 'private-family-allowed' : 'review-required-aihub-terms',
        singerIdentity: 'licensed-dataset',
        language: ['ko'],
        annotationTypes: ['audio', 'midi', 'csv', 'json', 'note-timing', 'pitch'],
        licenseReview: {
          requiresReview: true,
          templatePath: join(localPath, 'metadata', 'license-review.local.template.md'),
          reviewedPath: join(localPath, 'metadata', 'license-review.local.md'),
          requiredFields: ['Reviewer', 'Review date', 'Account/download approval confirmed', 'Local training allowed'],
        },
        qualityGates: {
          minAnnotatedRatio: 0.95,
          minProviderArchiveCount: 1,
          minProviderArchiveTotalBytes: 1,
        },
        allowedActions: {
          localTraining,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
      },
    ],
  }
}

function makeAcquisitionSmoke({ providerDropAudit, trainingManifest, gpuManifest, alignmentManifest }) {
  return {
    ok: true,
    mode: 'aihub-acquisition-smoke',
    gates: {
      providerDrop: {
        ok: true,
        reportPath: providerDropAudit,
      },
      trainingRun: {
        manifest: trainingManifest,
      },
      alignmentJob: {
        manifest: alignmentManifest,
      },
      gpuJob: {
        manifest: gpuManifest,
      },
    },
    note: 'This smoke uses synthetic audio and metadata.',
  }
}

function makeProviderDropAudit() {
  return {
    ok: true,
    decision: 'provider-archive-ready',
    production: true,
    gates: {
      minArchiveCount: 1,
      minTotalBytes: 1,
      minArchiveBytes: 1,
    },
    metrics: {
      archiveCount: 1,
      supportedArchiveCount: 1,
      unsupportedArchiveCount: 0,
      totalSizeBytes: 2048,
      hashedArchiveCount: 1,
      nonArchiveFileCount: 0,
    },
    problems: [],
  }
}

function makeDatasetSmoke() {
  return {
    ok: true,
    mode: 'dataset-first-pipeline',
    datasetId: 'csd-korean-research-baseline',
    gates: {
      readiness: {
        ok: true,
      },
      mfaCoverage: {
        oovUniqueTokenCount: 0,
      },
    },
    note: 'This smoke proves the dataset-first preparation path.',
  }
}

function makeBrowserSmoke(mode) {
  return {
    ok: true,
    mode,
    neuralEndpoint: mode === 'local-neural' ? 'http://127.0.0.1:8787/render' : null,
    download: {
      wav: {
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
        durationSeconds: 3,
      },
    },
    checks: [
      mode === 'local-neural' ? 'desktop neural WAV download' : 'desktop WAV download',
      'render history visible',
      'mobile export controls visible',
      'mobile no page horizontal overflow',
    ],
  }
}

function makeEnhancedDatasetAudit(production) {
  return {
    version: 1,
    ok: true,
    decision: 'enhanced-dataset-ready',
    production,
    datasetDir: '/tmp/webuta-ko-enhanced',
    metrics: {
      itemCount: production ? 40 : 5,
      wavItemCount: production ? 40 : 5,
      validWavDurationSeconds: production ? 1900 : 30,
      totalPhoneDurationSeconds: production ? 1900 : 30,
      phoneInventoryCount: 38,
      hasAp: true,
      hasSp: true,
    },
    problems: [],
    warnings: [],
  }
}

function makeCheckpointAudit(production) {
  return {
    version: 1,
    ok: true,
    decision: 'checkpoint-ready',
    model: production
      ? {
          id: 'webuta-ko-v1',
          name: 'WebUtau KO V1',
          renderer: 'diffsinger',
          releaseStatus: 'private-family',
        }
      : {
          id: 'webuta-ko-neural-dev',
          name: 'WebUtau KO Neural Development Smoke',
          renderer: 'diffsinger',
          releaseStatus: 'local-research',
        },
    datasets: production
      ? [
          {
            id: 'aihub-guide-vocal',
            licenseStatus: 'license-reviewed-local-training',
            modelPublishing: 'private-family-allowed',
          },
        ]
      : [
          {
            id: 'csd-korean-research-baseline',
            licenseStatus: 'cc-by-nc-sa-4.0-research-only',
            modelPublishing: 'no-commercial-release-review-required',
          },
        ],
    training: {
      checkpointStep: production ? 200000 : 1,
    },
    problems: [],
  }
}

function makeRenderProfileAudit(production) {
  return {
    version: 1,
    ok: true,
    decision: 'render-profile-ready',
    model: production
      ? {
          id: 'webuta-ko-v1',
          name: 'WebUtau KO V1',
          releaseStatus: 'private-family',
        }
      : {
          id: 'webuta-ko-neural-dev',
          name: 'WebUtau KO Neural Development Smoke',
          releaseStatus: 'local-research',
        },
    endpoint: 'http://127.0.0.1:8787/render',
    problems: [],
  }
}

function makeReleaseAudit() {
  return {
    version: 1,
    ok: true,
    decision: 'release-ready',
    model: {
      id: 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      releaseIntent: 'private-family',
      releaseStatus: 'private-family',
    },
    evidence: {
      datasets: [
        {
          id: 'aihub-guide-vocal',
          licenseStatus: 'license-reviewed-local-training',
          modelPublishing: 'private-family-allowed',
        },
      ],
    },
    problems: [],
  }
}

function checkById(report, id) {
  return report.checks.find((check) => check.id === id)
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
