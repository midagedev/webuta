import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { auditKoreanV3Oto } from './audit-korean-v3-oto.mjs'
import { generateKoreanV3SyntheticVoicebank } from './generate-korean-v3-synthetic-voicebank.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Korean V3 oto timing audit', () => {
  it('passes the generated tiny V3 voicebank when fixture thresholds are scaled', async () => {
    const root = makeTempRoot()
    const zipPath = join(root, 'webuta-ko-v3.zip')
    const reportPath = join(root, 'v3-oto.json')
    await generateKoreanV3SyntheticVoicebank({ output: zipPath, profile: 'tiny' })

    const report = await auditKoreanV3Oto({
      zip: zipPath,
      report: reportPath,
      thresholds: { minSamples: 20, minAliases: 60 },
    })
    const savedReport = JSON.parse(readFileSync(reportPath, 'utf8'))

    expect(report.ok).toBe(true)
    expect(report.oto.summary.problemCount).toBe(0)
    expect(report.oto.summary.byType.CV.count).toBeGreaterThan(0)
    expect(report.oto.summary.byType.VC.count).toBeGreaterThan(0)
    expect(savedReport.decision).toBe('v3-oto-audit-pass')
  })

  it('fails when oto timing would loop attack or hide release regions', async () => {
    const root = makeTempRoot()
    const zipPath = join(root, 'bad-oto.zip')
    await writeBadOtoZip(zipPath)

    const report = await auditKoreanV3Oto({
      zip: zipPath,
      thresholds: { minSamples: 1, minAliases: 1 },
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('v3-oto-audit-fail')
    expect(report.problems.join('\n')).toContain('preutterance must not exceed consonant')
    expect(report.problems.join('\n')).toContain('release gap')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-v3-oto-'))
  tempRoots.push(root)
  return root
}

async function writeBadOtoZip(path) {
  const zip = new JSZip()
  zip.file('samples/bad.wav', new Uint8Array([1, 2, 3, 4]))
  zip.file('oto.ini', 'bad.wav=아,0,80,-900,120,60\n')
  zip.file(
    'webuta-ko-v3.manifest.json',
    `${JSON.stringify({
      id: 'webuta-ko-v3-synthetic',
      name: 'Bad Oto Test',
      profile: 'test',
      sampleRate: 44100,
      samples: [
        {
          type: 'CV',
          alias: '아',
          aliases: ['아'],
          pitch: 'F4',
          midi: 65,
          baseHz: 349.228231,
          fileName: 'samples/bad.wav',
          durationSeconds: 0.94,
        },
      ],
    })}\n`,
  )
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  await writeFile(path, bytes)
}
