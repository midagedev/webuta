import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditNeuralReleaseReadiness } from './audit-neural-release-readiness.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural release readiness audit', () => {
  it('passes a private-family release with license, quality, comparison, browser, and listening evidence', () => {
    const fixture = makeReleaseFixture({
      manifest: {
        evidence: {
          listeningScores: 'LISTENING_PATH',
        },
      },
    })
    rewriteListeningPath(fixture)

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('release-ready')
    expect(report.evidence.datasets[0]).toMatchObject({
      id: 'licensed-local-singer',
      found: true,
    })
    expect(report.nextActions).toEqual(['Model release gate passed. Keep the report with release artifacts.'])
  })

  it('blocks private-family release until human listening scores are attached', () => {
    const fixture = makeReleaseFixture()

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems).toContain('Non-research release requires human listening score evidence.')
    expect(report.nextActions.join('\n')).toContain('listening scores')
  })

  it('blocks public release when dataset and model terms are still private or research-only', () => {
    const fixture = makeReleaseFixture({
      dataset: {
        allowedActions: {
          localTraining: true,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        licenseStatus: 'cc-by-nc-sa-4.0-research-only',
        redistribution: 'private-until-written-release',
        modelPublishing: 'requires-separate-written-release',
      },
      manifest: {
        model: {
          releaseIntent: 'public-model',
          releaseStatus: 'local-research',
        },
      },
    })

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('release-blocked')
    expect(report.problems.join('\n')).toContain('not approved for public model release')
    expect(report.problems.join('\n')).toContain('Public release cannot use model.releaseStatus=local-research')
    expect(report.nextActions.join('\n')).toContain('keep this model private')
  })

  it('blocks a release when quality comparison does not promote the candidate', () => {
    const fixture = makeReleaseFixture({
      comparison: {
        ok: false,
        decision: 'candidate-hold',
        totals: {
          blockingRegressionCount: 1,
        },
      },
    })

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems).toContain('Quality comparison did not promote the candidate.')
    expect(report.problems).toContain('Quality comparison contains blocking regressions.')
  })

  it('blocks a release until checkpoint runtime evidence is attached', () => {
    const fixture = makeReleaseFixture({
      manifest: {
        evidence: {
          modelCheckpoint: undefined,
        },
      },
    })
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8'))
    delete manifest.evidence.modelCheckpoint
    writeJson(fixture.manifestPath, manifest)

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems).toContain('Missing model checkpoint audit evidence.')
    expect(report.nextActions.join('\n')).toContain('audit-checkpoint')
  })

  it('blocks a release when checkpoint evidence belongs to another model', () => {
    const fixture = makeReleaseFixture({
      checkpointAudit: {
        model: {
          id: 'different-model',
        },
      },
    })

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('does not match manifest model id')
  })

  it('blocks non-research release when checkpoint provider archive evidence is missing', () => {
    const fixture = makeReleaseFixture({
      manifest: {
        evidence: {
          listeningScores: 'LISTENING_PATH',
        },
      },
      checkpointAudit: {
        evidence: {
          providerDropAudit: null,
        },
      },
    })
    rewriteListeningPath(fixture)

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems).toContain('Non-research release requires provider archive-drop evidence in the checkpoint audit.')
    expect(report.nextActions.join('\n')).toContain('provider-drop audit evidence')
  })

  it('allows local-research release diagnostics without provider archive evidence', () => {
    const fixture = makeReleaseFixture({
      manifest: {
        model: {
          releaseIntent: 'local-research',
          releaseStatus: 'local-research',
        },
      },
      checkpointAudit: {
        evidence: {
          providerDropAudit: null,
        },
      },
    })

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.problems).not.toContain('Non-research release requires provider archive-drop evidence in the checkpoint audit.')
  })

  it('blocks public release until human listening scores are attached', () => {
    const fixture = makeReleaseFixture(publicReadyOverrides())

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems).toContain('Public release requires human listening score evidence.')
    expect(report.nextActions.join('\n')).toContain('listening scores')
  })

  it('blocks public release when human listening scores are below beta thresholds', () => {
    const fixture = makeReleaseFixture(
      publicReadyOverrides({
        manifest: {
          evidence: {
            listeningScores: 'LISTENING_PATH',
          },
        },
        listeningScores: {
          phraseScores: [
            {
              id: 'do-hi-do-hi-daisuki',
              koreanClarityScore: 3,
              vowelStabilityScore: 5,
              artifactScore: 5,
              notes: 'Still unclear.',
            },
          ],
        },
      }),
    )
    rewriteListeningPath(fixture)

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('koreanClarityScore 3 is below required 4')
  })

  it('passes public release when rights, quality, browser, and listening evidence all pass', () => {
    const fixture = makeReleaseFixture(
      publicReadyOverrides({
        manifest: {
          evidence: {
            listeningScores: 'LISTENING_PATH',
          },
        },
      }),
    )
    rewriteListeningPath(fixture)

    const report = auditNeuralReleaseReadiness({
      manifest: fixture.manifestPath,
      registry: fixture.registryPath,
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('release-ready')
    expect(report.evidence.listeningScores).toMatchObject({ exists: true })
  })

  it('runs through the command-line entrypoint and writes a report file', () => {
    const fixture = makeReleaseFixture({
      manifest: {
        evidence: {
          listeningScores: 'LISTENING_PATH',
        },
      },
    })
    rewriteListeningPath(fixture)
    const reportPath = join(fixture.root, 'release-report.json')
    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-neural-release-readiness.mjs',
        '--manifest',
        fixture.manifestPath,
        '--registry',
        fixture.registryPath,
        '--report',
        reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )

    expect(JSON.parse(stdout).decision).toBe('release-ready')
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).ok).toBe(true)

    const blocked = spawnSync(
      process.execPath,
      ['scripts/audit-neural-release-readiness.mjs', '--manifest', join(fixture.root, 'missing.json'), '--registry', fixture.registryPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(blocked.status).toBe(1)
  })
})

function makeReleaseFixture(overrides = {}) {
  const root = makeTempRoot()
  const registryPath = join(root, 'registry.json')
  const qualitySummaryPath = join(root, 'quality-summary.json')
  const comparisonPath = join(root, 'quality-comparison.json')
  const browserSmokePath = join(root, 'browser-smoke.json')
  const checkpointAuditPath = join(root, 'checkpoint-audit.json')
  const listeningScoresPath = join(root, 'listening-scores.json')
  const manifestPath = join(root, 'release-manifest.json')

  const dataset = {
    id: 'licensed-local-singer',
    name: 'Licensed Local Singer',
    sourceUrl: null,
    localPath: root,
    licenseStatus: 'original-consent-reviewed-local-training',
    redistribution: 'private-until-written-release',
    modelPublishing: 'not-for-public-release',
    singerIdentity: 'private',
    language: ['ko'],
    audioHours: 4,
    annotationTypes: ['audio', 'lyrics', 'score', 'consent'],
    allowedActions: {
      localTraining: true,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
    reviewNotes: ['Fixture consent allows private local training only.'],
    ...(overrides.dataset ?? {}),
  }
  writeJson(registryPath, {
    version: 1,
    datasets: [dataset],
  })

  const qualitySummary = {
    version: 1,
    runId: 'candidate-run',
    generatedAt: '2026-06-30T00:00:00.000Z',
    modelId: 'webuta-ko-private-v1',
    renderer: 'diffsinger',
    rendered: true,
    totals: {
      phraseCount: 5,
      renderedCount: 5,
      okCount: 5,
      failedRenderCount: 0,
      passedGateCount: 5,
      failedGateCount: 0,
    },
    thresholds: {
      minListeningKoreanClarityScore: 4,
      minListeningVowelStabilityScore: 4,
      minListeningArtifactScore: 4,
    },
    results: [{ id: 'do-hi-do-hi-daisuki', ok: true }],
    ...(overrides.qualitySummary ?? {}),
  }
  writeJson(qualitySummaryPath, qualitySummary)

  const comparison = {
    version: 1,
    ok: true,
    decision: 'candidate-promote',
    candidate: {
      runId: 'candidate-run',
      modelId: 'webuta-ko-private-v1',
    },
    totals: {
      blockingRegressionCount: 0,
      candidateFailedGateCount: 0,
    },
    ...(overrides.comparison ?? {}),
  }
  writeJson(comparisonPath, comparison)

  const browserSmoke = {
    ok: true,
    mode: 'local-neural',
    download: {
      wav: {
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
        durationSeconds: 6.5,
      },
    },
    checks: [
      'desktop neural WAV download',
      'render history visible',
      'mobile export controls visible',
      'mobile no page horizontal overflow',
    ],
    ...(overrides.browserSmoke ?? {}),
  }
  writeJson(browserSmokePath, browserSmoke)

  const checkpointAudit = deepMerge(
    {
      version: 1,
      ok: true,
      decision: 'checkpoint-ready',
      model: {
        id: 'webuta-ko-private-v1',
        name: 'WebUtau KO Private V1',
        renderer: 'diffsinger',
        releaseStatus: 'private-family',
      },
      datasets: [
        {
          id: 'licensed-local-singer',
          found: true,
          localTraining: true,
          publicModelRelease: false,
          licenseStatus: 'original-consent-reviewed-local-training',
          modelPublishing: 'not-for-public-release',
        },
      ],
      runtime: {
        exp: join(root, 'train-run'),
        checkpointPath: join(root, 'train-run', 'model_ckpt_steps_2000.ckpt'),
        vocoder: join(root, 'DiffSinger', 'checkpoints', 'vocoder.ckpt'),
      },
      evidence: {
        providerDropAudit: join(root, 'provider-drop-audit.json'),
      },
    },
    overrides.checkpointAudit ?? {},
  )
  writeJson(checkpointAuditPath, checkpointAudit)

  const listeningScores = deepMerge(
    {
      version: 1,
      runId: 'candidate-run',
      modelId: 'webuta-ko-private-v1',
      reviewer: 'Test Listener',
      reviewedAt: '2026-06-30',
      decision: 'pass',
      phraseScores: [
        {
          id: 'do-hi-do-hi-daisuki',
          koreanClarityScore: 4,
          vowelStabilityScore: 4,
          artifactScore: 4,
          notes: 'Fixture passes the public beta listening floor.',
        },
      ],
    },
    overrides.listeningScores ?? {},
  )
  writeJson(listeningScoresPath, listeningScores)

  const manifest = deepMerge(
    {
      version: 1,
      model: {
        id: 'webuta-ko-private-v1',
        name: 'WebUtau KO Private V1',
        releaseIntent: 'private-family',
        releaseStatus: 'private-family',
      },
      datasetIds: ['licensed-local-singer'],
      evidence: {
        modelCheckpoint: checkpointAuditPath,
        qualitySummary: qualitySummaryPath,
        qualityComparison: comparisonPath,
        browserSmoke: browserSmokePath,
      },
      terms: {
        licenseSummary: 'Private local model trained on consent-reviewed original Korean singing recordings.',
        allowedUse: ['Private local rendering'],
        disallowedUse: ['Public model release', 'Public audio examples'],
      },
    },
    overrides.manifest ?? {},
  )
  writeJson(manifestPath, manifest)

  return { root, registryPath, manifestPath, qualitySummaryPath, comparisonPath, browserSmokePath, checkpointAuditPath, listeningScoresPath }
}

function publicReadyOverrides(overrides = {}) {
  return deepMerge(
    {
      dataset: {
        allowedActions: {
          localTraining: true,
          publicModelRelease: true,
          publicAudioExamples: true,
        },
        licenseStatus: 'public-release-ready',
        redistribution: 'public-release-ready',
        modelPublishing: 'public-release-ready',
      },
      manifest: {
        model: {
          releaseIntent: 'public-demo',
          releaseStatus: 'user-provided',
        },
        terms: {
          publicReleaseNotes: 'Fixture public demo terms are reviewed.',
        },
      },
    },
    overrides,
  )
}

function rewriteListeningPath(fixture) {
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8'))
  manifest.evidence.listeningScores = fixture.listeningScoresPath
  writeJson(fixture.manifestPath, manifest)
}

function deepMerge(base, patch) {
  const result = Array.isArray(base) ? [...base] : { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-release-audit-'))
  tempRoots.push(root)
  return root
}
