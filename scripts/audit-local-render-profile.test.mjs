import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditLocalRenderProfile } from './audit-local-render-profile.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('local render profile audit', () => {
  it('passes a promoted profile whose checkpoint, service, env, release, and browser smoke evidence agree', () => {
    const fixture = makeProfileFixture()

    const report = auditLocalRenderProfile({
      profile: fixture.profilePath,
      releaseManifest: fixture.releaseManifestPath,
      browserSmoke: fixture.browserSmokePath,
    })

    expect(report).toMatchObject({
      ok: true,
      decision: 'render-profile-ready',
      model: {
        id: 'webuta-ko-v1',
        releaseStatus: 'private-family',
      },
      endpoint: 'http://127.0.0.1:8787/render',
      problems: [],
    })
  })

  it('blocks profile drift between Vite env, release manifest, and browser smoke', () => {
    const fixture = makeProfileFixture({
      envEndpoint: 'http://127.0.0.1:9999/render',
      browserEndpoint: 'http://127.0.0.1:9999/render',
      releaseModelId: 'other-model',
    })

    const report = auditLocalRenderProfile({
      profile: fixture.profilePath,
      releaseManifest: fixture.releaseManifestPath,
      browserSmoke: fixture.browserSmokePath,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('Vite env file does not match')
    expect(report.problems.join('\n')).toContain('Release manifest model id other-model')
    expect(report.problems.join('\n')).toContain('Browser smoke endpoint')
  })

  it('runs through the command-line entrypoint and writes a report', () => {
    const fixture = makeProfileFixture()
    const reportPath = join(fixture.root, 'render-profile-audit.json')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/audit-local-render-profile.mjs',
        '--profile',
        fixture.profilePath,
        '--release-manifest',
        fixture.releaseManifestPath,
        '--browser-smoke',
        fixture.browserSmokePath,
        '--report',
        reportPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.decision).toBe('render-profile-ready')
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).ok).toBe(true)
  })
})

function makeProfileFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-render-profile-audit-'))
  tempRoots.push(root)
  const profilePath = join(root, 'local-render-profile.json')
  const checkpointAuditPath = join(root, 'checkpoint-audit.json')
  const checkpointManifestPath = join(root, 'model-checkpoint.json')
  const releaseManifestPath = join(root, 'model-release.local-template.json')
  const serviceScriptPath = join(root, 'serve-render.sh')
  const envPath = join(root, 'vite-local-neural.env')
  const browserSmokePath = join(root, 'browser-smoke.json')
  const endpoint = 'http://127.0.0.1:8787/render'
  const runtime = {
    diffSingerRoot: join(root, 'DiffSinger'),
    python: join(root, 'python'),
    exp: join(root, 'train'),
    ckpt: 200000,
    checkpointPath: join(root, 'train', 'model_ckpt_steps_200000.ckpt'),
    vocoder: join(root, 'DiffSinger', 'checkpoints', 'vocoder.ckpt'),
  }

  mkdirSync(dirname(runtime.checkpointPath), { recursive: true })
  mkdirSync(dirname(runtime.vocoder), { recursive: true })
  writeFileSync(runtime.checkpointPath, 'fake checkpoint\n')
  writeFileSync(runtime.vocoder, 'fake vocoder\n')
  writeJson(checkpointManifestPath, {
    version: 1,
    model: {
      id: 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      renderer: 'diffsinger',
      releaseStatus: 'private-family',
    },
    datasetIds: ['licensed-ko'],
    runtime,
    terms: {
      licenseSummary: 'Consent-reviewed private model.',
    },
  })
  writeJson(checkpointAuditPath, {
    version: 1,
    ok: true,
    decision: 'checkpoint-ready',
    manifestPath: checkpointManifestPath,
    model: {
      id: 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      renderer: 'diffsinger',
      releaseStatus: 'private-family',
    },
    datasets: [{ id: 'licensed-ko' }],
    runtime,
  })
  writeFileSync(
    serviceScriptPath,
    [
      '#!/usr/bin/env bash',
      'npm run neural:serve-render -- --accept-local-research-license --model-manifest model-checkpoint.json --diffsinger-root DiffSinger --python python --exp train --ckpt 200000 --vocoder DiffSinger/checkpoints/vocoder.ckpt',
      '',
    ].join('\n'),
  )
  writeFileSync(envPath, `VITE_WEBUTA_NEURAL_ENDPOINT=${options.envEndpoint ?? endpoint}\n`)
  writeJson(releaseManifestPath, {
    version: 1,
    model: {
      id: options.releaseModelId ?? 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      releaseIntent: 'private-family',
      releaseStatus: 'private-family',
    },
    datasetIds: ['licensed-ko'],
    evidence: {
      modelCheckpoint: checkpointAuditPath,
    },
    terms: {
      licenseSummary: 'Consent-reviewed private model.',
      allowedUse: ['Private local rendering'],
      disallowedUse: ['Public release'],
    },
  })
  writeJson(browserSmokePath, {
    ok: true,
    mode: 'local-neural',
    neuralEndpoint: options.browserEndpoint ?? endpoint,
    download: {
      wav: {
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
        durationSeconds: 3,
      },
    },
    checks: ['desktop neural WAV download'],
  })
  writeJson(profilePath, {
    version: 1,
    source: 'webuta-neural-checkpoint-promotion',
    model: {
      id: 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      renderer: 'diffsinger',
      releaseStatus: 'private-family',
    },
    datasetIds: ['licensed-ko'],
    endpoint,
    checkpointAudit: checkpointAuditPath,
    checkpointManifest: checkpointManifestPath,
    service: {
      command: readFileSync(serviceScriptPath, 'utf8'),
      script: serviceScriptPath,
    },
    vite: {
      envFile: envPath,
      env: {
        VITE_WEBUTA_NEURAL_ENDPOINT: endpoint,
      },
    },
    runtime,
    terms: {
      licenseSummary: 'Consent-reviewed private model.',
    },
  })

  return { root, profilePath, checkpointAuditPath, checkpointManifestPath, releaseManifestPath, browserSmokePath }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
