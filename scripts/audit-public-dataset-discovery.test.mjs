import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditPublicDatasetDiscovery } from './audit-public-dataset-discovery.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('public dataset discovery audit', () => {
  it('separates research singing evidence from production release evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-public-datasets-'))
    tempRoots.push(root)
    const singingManifest = writeManifest(root, 'gtsinger.json', {
      source: 'huggingface:GTSinger/GTSinger',
      sourceUrl: 'https://huggingface.co/datasets/GTSinger/GTSinger',
      licenseStatus: 'cc-by-nc-sa-4.0-research-only',
      metrics: {
        presentFileCount: 12_281,
        totalPresentBytes: 5_859_165_056,
      },
    })
    const speechManifest = writeManifest(root, 'zeroth.json', {
      source: 'openslr:zeroth-korean',
      sourceUrl: 'https://www.openslr.org/40/',
      licenseStatus: 'cc-by-4.0-speech-auxiliary',
      metrics: {
        presentFileCount: 1,
        totalPresentBytes: 10_339_720_618,
      },
    })

    const report = auditPublicDatasetDiscovery({
      candidates: [
        {
          id: 'gtsinger-korean-research-baseline',
          label: 'GTSinger Korean subset',
          manifest: singingManifest,
          kind: 'singing',
          role: 'research-training-baseline',
          minPresentFiles: 12_000,
          expectedLicense: 'cc-by-nc-sa-4.0-research-only',
          productionEligible: false,
          blocker: 'Noncommercial research baseline.',
        },
        {
          id: 'zeroth-korean-speech-aux',
          label: 'Zeroth Korean',
          manifest: speechManifest,
          kind: 'speech',
          role: 'pronunciation-asr-auxiliary',
          minPresentFiles: 1,
          expectedLicense: 'cc-by-4.0-speech-auxiliary',
          productionEligible: false,
          blocker: 'Speech-only.',
        },
      ],
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('public-dataset-discovery-ready')
    expect(report.summary).toMatchObject({
      candidateCount: 2,
      researchSingingReadyCount: 1,
      productionEligibleCount: 0,
    })
    expect(report.productionConclusion).toContain('No currently acquired public Korean dataset')
  })

  it('flags stale partial manifests before they are used as full local evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-public-datasets-stale-'))
    tempRoots.push(root)
    const manifest = writeManifest(root, 'gtsinger.json', {
      source: 'huggingface:GTSinger/GTSinger',
      sourceUrl: 'https://huggingface.co/datasets/GTSinger/GTSinger',
      licenseStatus: 'cc-by-nc-sa-4.0-research-only',
      metrics: {
        presentFileCount: 227,
        totalPresentBytes: 120_725_208,
      },
    })

    const report = auditPublicDatasetDiscovery({
      candidates: [
        {
          id: 'gtsinger-korean-research-baseline',
          label: 'GTSinger Korean subset',
          manifest,
          kind: 'singing',
          role: 'research-training-baseline',
          minPresentFiles: 12_000,
          expectedLicense: 'cc-by-nc-sa-4.0-research-only',
          productionEligible: false,
          blocker: 'Noncommercial research baseline.',
        },
      ],
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('only 227 present files')
    expect(report.candidates[0]).toMatchObject({
      present: true,
      meetsLocalEvidenceGate: false,
    })
  })

  it('flags license drift against the expected source review', () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-public-datasets-license-'))
    tempRoots.push(root)
    const manifest = writeManifest(root, 'csd.json', {
      source: 'zenodo:4916302',
      sourceUrl: 'https://zenodo.org/records/4916302',
      licenseStatus: 'unknown',
      file: {
        sizeBytes: 1_851_131_390,
        md5: '74d121dd8706fded26a15526a379f7a2',
      },
    })

    const report = auditPublicDatasetDiscovery({
      candidates: [
        {
          id: 'csd-korean-research-baseline',
          label: 'CSD',
          manifest,
          kind: 'singing',
          role: 'research-training-baseline',
          minPresentFiles: 1,
          expectedLicense: 'cc-by-nc-sa-4.0-research-only',
          productionEligible: false,
          blocker: 'Noncommercial research baseline.',
        },
      ],
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('licenseStatus is unknown')
  })
})

function writeManifest(root, name, value) {
  const path = join(root, name)
  mkdirSync(root, { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}
