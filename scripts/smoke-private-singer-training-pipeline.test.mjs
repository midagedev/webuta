import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { smokePrivateSingerTrainingPipeline } from './smoke-private-singer-training-pipeline.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('private singer training pipeline smoke', () => {
  it('passes recording, dataset, ingest, readiness, and OpenVPI seed gates with synthetic dry vocals', async () => {
    const root = makeTempRoot()
    const reportPath = join(root, 'pipeline-smoke.json')

    const report = await smokePrivateSingerTrainingPipeline({
      out: reportPath,
      takeLimit: 4,
      targetMinutes: 0.5,
    })

    expect(report).toMatchObject({
      ok: true,
      mode: 'synthetic-dry-vocal-pipeline',
      generatedPack: {
        selectedTakeCount: 4,
        guideCount: 4,
      },
      gates: {
        recordingAudit: {
          ok: true,
          totals: {
            readyCount: 4,
            needsReviewCount: 0,
          },
        },
        datasetAudit: {
          ok: true,
          fileCount: 4,
          ignoredGuideAudioCount: 4,
        },
        ingest: {
          audioCount: 4,
          recordingAuditEligibleCount: 4,
          recordingAuditExcludedCount: 0,
          ignoredGuideAudioCount: 4,
          segmentCount: 4,
        },
        readiness: {
          ok: true,
        },
        openVpi: {
          segmentCount: 4,
          copiedAudio: true,
        },
      },
    })
    expect(report.gates.ingest.uniquePhonemes).toContain('ng')
    expect(report.checks).toContain('dataset ingest used only recording-audit-ready WAVs')
    expect(report.checks).toContain('OpenVPI pre-alignment seed corpus generated')
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).note).toContain('not evidence of production voice quality')
  }, 45_000)

  it('prints help from the command-line entrypoint', () => {
    const stdout = execFileSync(process.execPath, ['scripts/smoke-private-singer-training-pipeline.mjs', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(stdout).toContain('Usage: node scripts/smoke-private-singer-training-pipeline.mjs')
    expect(stdout).toContain('--take-limit')
    expect(stdout).toContain('--keep-temp')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-pipeline-smoke-test-'))
  tempRoots.push(root)
  return root
}
