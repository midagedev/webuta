import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compareNeuralQualityRuns } from './compare-neural-quality-runs.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural quality run comparison', () => {
  it('promotes a candidate that keeps gates passing and improves objective metrics', () => {
    const root = makeTempRoot()
    const baselinePath = join(root, 'baseline.json')
    const candidatePath = join(root, 'candidate.json')
    writeSummary(baselinePath, makeSummary({ runId: 'ckpt-1000', medianAbsCents: 32, voicedFrameRatio: 0.84 }))
    writeSummary(candidatePath, makeSummary({ runId: 'ckpt-2000', medianAbsCents: 18, voicedFrameRatio: 0.91 }))

    const report = compareNeuralQualityRuns({
      baseline: baselinePath,
      candidate: candidatePath,
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('candidate-promote')
    expect(report.totals).toMatchObject({
      phraseCount: 2,
      blockingRegressionCount: 0,
      candidateFailedGateCount: 0,
    })
    expect(report.phraseComparisons[0].metrics.find((metric) => metric.id === 'medianAbsCents')).toMatchObject({
      change: 'improved',
      passed: true,
    })
  })

  it('holds a candidate when a blocking objective metric regresses past tolerance', () => {
    const root = makeTempRoot()
    const baselinePath = join(root, 'baseline.json')
    const candidatePath = join(root, 'candidate.json')
    const out = join(root, 'comparison.json')
    const markdown = join(root, 'comparison.md')
    writeSummary(baselinePath, makeSummary({ runId: 'ckpt-1000', medianAbsCents: 12 }))
    writeSummary(candidatePath, makeSummary({ runId: 'ckpt-2000', medianAbsCents: 65 }))

    const report = compareNeuralQualityRuns({
      baseline: baselinePath,
      candidate: candidatePath,
      out,
      markdown,
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('candidate-hold')
    expect(report.totals.blockingRegressionCount).toBeGreaterThan(0)
    expect(report.phraseComparisons[0].blockingRegressions).toContain('medianAbsCents')
    expect(JSON.parse(readFileSync(out, 'utf8')).ok).toBe(false)
    expect(readFileSync(markdown, 'utf8')).toContain('candidate-hold')
  })

  it('holds a candidate when coda sustain bursts regress', () => {
    const root = makeTempRoot()
    const baselinePath = join(root, 'baseline.json')
    const candidatePath = join(root, 'candidate.json')
    writeSummary(baselinePath, makeSummary({ runId: 'ckpt-1000', maxCodaSustainBurstCount: 0 }))
    writeSummary(candidatePath, makeSummary({ runId: 'ckpt-2000', maxCodaSustainBurstCount: 3 }))

    const report = compareNeuralQualityRuns({
      baseline: baselinePath,
      candidate: candidatePath,
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('candidate-hold')
    expect(report.phraseComparisons[0].blockingRegressions).toContain('maxCodaSustainBurstCount')
  })


  it('runs through the command-line entrypoint and exits nonzero on hold', () => {
    const root = makeTempRoot()
    const baselinePath = join(root, 'baseline.json')
    const candidatePath = join(root, 'candidate.json')
    const out = join(root, 'comparison.json')
    writeSummary(baselinePath, makeSummary({ runId: 'ckpt-1000', medianAbsCents: 10 }))
    writeSummary(candidatePath, makeSummary({ runId: 'ckpt-2000', medianAbsCents: 55 }))

    const failed = spawnSync(
      process.execPath,
      [
        'scripts/compare-neural-quality-runs.mjs',
        '--baseline',
        baselinePath,
        '--candidate',
        candidatePath,
        '--out',
        out,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(failed.status).toBe(1)
    expect(JSON.parse(readFileSync(out, 'utf8')).decision).toBe('candidate-hold')

    writeSummary(candidatePath, makeSummary({ runId: 'ckpt-2000', medianAbsCents: 8 }))
    const stdout = execFileSync(
      process.execPath,
      ['scripts/compare-neural-quality-runs.mjs', '--baseline', baselinePath, '--candidate', candidatePath],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(JSON.parse(stdout).decision).toBe('candidate-promote')
  })

  it('fails early when a summary came from no-render request generation', () => {
    const root = makeTempRoot()
    const baselinePath = join(root, 'baseline.json')
    const candidatePath = join(root, 'candidate.json')
    writeSummary(baselinePath, { ...makeSummary({ runId: 'no-render' }), rendered: false })
    writeSummary(candidatePath, makeSummary({ runId: 'ckpt-2000' }))

    expect(() => compareNeuralQualityRuns({ baseline: baselinePath, candidate: candidatePath })).toThrow(/rendered run/u)
  })
})

function makeSummary(overrides = {}) {
  const runId = overrides.runId ?? 'ckpt'
  const medianAbsCents = overrides.medianAbsCents ?? 24
  const voicedFrameRatio = overrides.voicedFrameRatio ?? 0.88
  const resultA = makeResult('do-hi-do-hi-daisuki', {
    medianAbsCents,
    voicedFrameRatio,
    maxCodaSustainBurstCount: overrides.maxCodaSustainBurstCount ?? 0,
    renderSeconds: overrides.renderSeconds ?? 4.1,
  })
  const resultB = makeResult('batchim-heavy', {
    medianAbsCents: medianAbsCents + 4,
    voicedFrameRatio: Math.max(0, voicedFrameRatio - 0.02),
    maxCodaSustainBurstCount: overrides.maxCodaSustainBurstCount ?? 0,
    renderSeconds: overrides.renderSeconds ?? 4.4,
  })
  return {
    version: 1,
    runId,
    generatedAt: '2026-06-30T00:00:00.000Z',
    modelId: runId,
    renderer: 'diffsinger',
    rendered: true,
    totals: {
      phraseCount: 2,
      renderedCount: 2,
      okCount: 2,
      failedRenderCount: 0,
      passedGateCount: 2,
      failedGateCount: 0,
    },
    results: [resultA, resultB],
  }
}

function makeResult(id, overrides = {}) {
  const summary = {
    passed: true,
    rms: 0.08,
    peak: 0.72,
    clippingSamples: 0,
    durationDeltaSeconds: 0.01,
    voicedFrameRatio: overrides.voicedFrameRatio ?? 0.88,
    medianAbsCents: overrides.medianAbsCents ?? 24,
    medianOnsetLagSeconds: 0.015,
    missingOnsetRatio: 0,
    maxCodaSustainBurstCount: overrides.maxCodaSustainBurstCount ?? 0,
    totalCodaSustainBurstCount: overrides.maxCodaSustainBurstCount ?? 0,
    failedGates: [],
  }
  return {
    id,
    title: id,
    ok: true,
    wavPath: `/tmp/${id}.wav`,
    renderSeconds: overrides.renderSeconds ?? 4.2,
    gates: {
      passed: true,
      failed: [],
    },
    summary,
  }
}

function writeSummary(path, summary) {
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-quality-compare-'))
  tempRoots.push(root)
  return root
}
