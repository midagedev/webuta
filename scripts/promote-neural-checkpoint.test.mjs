import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { promoteNeuralCheckpoint } from './promote-neural-checkpoint.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural checkpoint promotion', () => {
  it('writes a local render profile, service script, Vite env, and release template', () => {
    const fixture = makePromotionFixture()
    const out = join(fixture.root, 'promoted')

    const result = promoteNeuralCheckpoint({
      checkpointAudit: fixture.auditPath,
      out,
      endpoint: 'http://127.0.0.1:8787/render',
    })

    expect(result).toMatchObject({
      outDir: out,
      modelId: 'webuta-ko-v1',
      endpoint: 'http://127.0.0.1:8787/render',
    })
    const profile = JSON.parse(readFileSync(result.renderProfile, 'utf8'))
    expect(profile).toMatchObject({
      source: 'webuta-neural-checkpoint-promotion',
      model: {
        id: 'webuta-ko-v1',
        renderer: 'diffsinger',
        releaseStatus: 'private-family',
      },
      service: {
        port: 8787,
      },
      vite: {
        env: {
          VITE_WEBUTA_NEURAL_ENDPOINT: 'http://127.0.0.1:8787/render',
        },
      },
    })
    expect(profile.service.command).toContain('--model-manifest')
    expect(profile.service.command).toContain('--vocoder')

    const serveScript = readFileSync(result.serveScript, 'utf8')
    expect(serveScript).toContain('npm run neural:serve-render --')
    expect(serveScript).toContain("--ckpt 200000")
    expect(serveScript).toContain('--model-manifest')

    expect(readFileSync(result.env, 'utf8')).toBe('VITE_WEBUTA_NEURAL_ENDPOINT=http://127.0.0.1:8787/render\n')

    const release = JSON.parse(readFileSync(result.releaseManifest, 'utf8'))
    expect(release).toMatchObject({
      model: {
        id: 'webuta-ko-v1',
        releaseIntent: 'private-family',
      },
      evidence: {
        modelCheckpoint: fixture.auditPath,
        qualitySummary: fixture.qualitySummaryPath,
        browserSmoke: fixture.browserSmokePath,
      },
    })
  })

  it('refuses to promote a blocked checkpoint audit', () => {
    const fixture = makePromotionFixture({ ready: false })

    expect(() =>
      promoteNeuralCheckpoint({
        checkpointAudit: fixture.auditPath,
        out: join(fixture.root, 'promoted'),
      }),
    ).toThrow(/not ready/)
  })

  it('keeps local research checkpoints as local research release templates', () => {
    const fixture = makePromotionFixture({ releaseStatus: 'local-research' })

    const result = promoteNeuralCheckpoint({
      checkpointAudit: fixture.auditPath,
      out: join(fixture.root, 'promoted-research'),
    })

    const release = JSON.parse(readFileSync(result.releaseManifest, 'utf8'))
    expect(release.model).toMatchObject({
      releaseIntent: 'local-research',
      releaseStatus: 'local-research',
    })
  })

  it('runs through the command-line entrypoint', () => {
    const fixture = makePromotionFixture()
    const out = join(fixture.root, 'cli-promoted')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/promote-neural-checkpoint.mjs',
        '--checkpoint-audit',
        fixture.auditPath,
        '--out',
        out,
        '--endpoint',
        'http://127.0.0.1:9797/render',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.endpoint).toBe('http://127.0.0.1:9797/render')
    expect(existsSync(join(out, 'local-render-profile.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'local-render-profile.json'), 'utf8')).service.port).toBe(9797)
  })
})

function makePromotionFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webuta-promote-checkpoint-'))
  tempRoots.push(root)
  const manifestPath = join(root, 'model-checkpoint.json')
  const auditPath = join(root, 'checkpoint-audit.json')
  const qualitySummaryPath = join(root, 'quality-summary.json')
  const browserSmokePath = join(root, 'browser-smoke.json')
  const runtime = {
    diffSingerRoot: join(root, 'DiffSinger'),
    python: join(root, 'python'),
    exp: join(root, 'train'),
    ckpt: 200000,
    vocoder: join(root, 'DiffSinger', 'checkpoints', 'vocoder.ckpt'),
  }

  mkdirSync(dirname(runtime.vocoder), { recursive: true })
  mkdirSync(runtime.exp, { recursive: true })
  writeFileSync(runtime.vocoder, 'fake vocoder\n')
  writeFileSync(qualitySummaryPath, '{}\n')
  writeFileSync(browserSmokePath, '{}\n')
  writeJson(manifestPath, {
    version: 1,
    model: {
      id: 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      renderer: 'diffsinger',
      releaseStatus: options.releaseStatus ?? 'private-family',
    },
    datasetIds: ['licensed-ko'],
    runtime,
    evidence: {
      qualitySummary: qualitySummaryPath,
      browserSmoke: browserSmokePath,
    },
    terms: {
      licenseSummary: 'Consent-reviewed private Korean model.',
      allowedUse: ['Private local rendering'],
      disallowedUse: ['Public release'],
    },
  })
  writeJson(auditPath, {
    version: 1,
    ok: options.ready !== false,
    decision: options.ready === false ? 'checkpoint-blocked' : 'checkpoint-ready',
    manifestPath,
    model: {
      id: 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      renderer: 'diffsinger',
      releaseStatus: options.releaseStatus ?? 'private-family',
    },
    datasets: [
      {
        id: 'licensed-ko',
      },
    ],
    runtime,
    problems: options.ready === false ? ['Missing checkpoint.'] : [],
  })
  return { root, manifestPath, auditPath, qualitySummaryPath, browserSmokePath }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
