import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { smokeAihubAcquisitionPipeline } from './smoke-aihub-acquisition-pipeline.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('AI Hub acquisition smoke pipeline', () => {
  it('proves provider archive acquisition through extraction, sidecars, audit, and ingest', async () => {
    const root = makeTempRoot()
    const report = await smokeAihubAcquisitionPipeline({
      workDir: root,
      minLocalTrainingMinutes: 0.03,
    })

    expect(report.ok).toBe(true)
    expect(report.gates.emptyInspection.stage).toBe('awaiting-provider-download')
    expect(report.gates.archiveInspection.stage).toBe('archive-ready-for-extraction')
    expect(report.gates.providerDrop).toMatchObject({
      ok: true,
      decision: 'provider-archive-ready',
      archiveCount: 1,
      hashedArchiveCount: 1,
    })
    expect(report.gates.providerDrop.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(report.gates.providerDrop.entryCount).toBeGreaterThanOrEqual(3)
    expect(report.gates.extractedInspection.stage).toBe('metadata-ready-needs-sidecars')
    expect(report.gates.sidecarInspection.stage).toBe('ingest-ready-needs-license-review')
    expect(report.gates.readyInspection.stage).toBe('ready-for-audit-and-ingest')
    expect(report.gates.extraction).toMatchObject({ archiveCount: 1, extractedFileCount: 3 })
    expect(report.gates.sidecars).toMatchObject({ writtenCount: 2, matchedAudioCount: 2, matchedRowCount: 6 })
    expect(report.gates.datasetAudit).toMatchObject({ ok: true, audioCount: 2, annotatedRatio: 1 })
    expect(report.gates.ingest.audioCount).toBe(2)
    expect(report.gates.ingest.segmentCount).toBeGreaterThanOrEqual(2)
    expect(report.gates.ingest.uniquePhonemes).toContain('d')
    expect(report.gates.readiness.ok).toBe(true)
    expect(report.gates.openVpi).toMatchObject({
      segmentCount: report.gates.ingest.segmentCount,
      copiedAudio: true,
    })
    expect(report.gates.mfaDictionary).toMatchObject({
      labFileCount: report.gates.ingest.segmentCount,
      unsupportedTokenCount: 0,
    })
    expect(report.gates.mfaCoverage).toMatchObject({
      labFileCount: report.gates.ingest.segmentCount,
      oovUniqueTokenCount: 0,
    })
    expect(report.gates.alignmentJob).toMatchObject({
      warningCount: 0,
    })
    expect(existsSync(report.gates.alignmentJob.manifest)).toBe(true)
    expect(report.gates.smokeEnhancedDataset).toMatchObject({
      itemCount: report.gates.ingest.segmentCount,
    })
    expect(report.gates.smokeEnhancedDataset.phoneInventoryCount).toBeGreaterThanOrEqual(4)
    expect(report.gates.trainingRun).toMatchObject({
      itemCount: report.gates.smokeEnhancedDataset.itemCount,
      trainItemCount: report.gates.smokeEnhancedDataset.itemCount - 1,
      validationItemCount: 1,
      maxUpdates: 1200,
      checkpointStep: 1200,
    })
    expect(JSON.parse(readFileSync(report.gates.trainingRun.manifest, 'utf8')).providerDropAudit).toBe(report.gates.providerDrop.reportPath)
    expect(report.gates.gpuJob).toMatchObject({
      remoteWorkDir: '/srv/webuta-diffsinger-runs/aihub-acquisition-smoke',
      checkpointStep: 1200,
    })
    expect(JSON.parse(readFileSync(report.gates.gpuJob.manifest, 'utf8')).lineage.providerDropAudit).toBe(report.gates.providerDrop.reportPath)
  })

  it('runs from the command line and writes a report', () => {
    const root = makeTempRoot()
    const reportPath = join(root, 'aihub-acquisition-smoke.json')

    const stdout = execFileSync(
      process.execPath,
      ['scripts/smoke-aihub-acquisition-pipeline.mjs', '--work-dir', root, '--out', reportPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(existsSync(reportPath)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).gates.providerDrop.ok).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).gates.readyInspection.stage).toBe('ready-for-audit-and-ingest')
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).gates.mfaCoverage.oovUniqueTokenCount).toBe(0)
    expect(existsSync(JSON.parse(readFileSync(reportPath, 'utf8')).gates.alignmentJob.manifest)).toBe(true)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).gates.gpuJob.checkpointStep).toBe(1200)
    const gpuManifest = JSON.parse(readFileSync(JSON.parse(readFileSync(reportPath, 'utf8')).gates.gpuJob.manifest, 'utf8'))
    expect(gpuManifest.lineage.providerDropAudit).toBe(JSON.parse(readFileSync(reportPath, 'utf8')).gates.providerDrop.reportPath)
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-aihub-acquisition-smoke-'))
  tempRoots.push(root)
  return root
}
