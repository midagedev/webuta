import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeKoreanV3Clarity } from './analyze-korean-v3-clarity.mjs'
import { generateKoreanV3SyntheticVoicebank } from './generate-korean-v3-synthetic-voicebank.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Korean V3 clarity audit', () => {
  it('passes a generated no-recording tiny voicebank with measurable vowel color and consonant onsets', async () => {
    const root = makeTempRoot()
    const zip = join(root, 'webuta-ko-v3.zip')
    const reportPath = join(root, 'clarity.json')
    await generateKoreanV3SyntheticVoicebank({ output: zip, profile: 'tiny' })

    const report = await analyzeKoreanV3Clarity({
      zip,
      report: reportPath,
      thresholds: {
        minVowelSamples: 4,
        minConsonantSamples: 10,
        minVowelDistance: 0.001,
        maxWeakConsonantRatio: 0.25,
      },
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('v3-clarity-audit-pass')
    expect(report.manifest).toMatchObject({
      name: 'WebUtau Korean V3 Synthetic',
      synthesisProfile: 'deterministic-dsp-bright-formant-v3-starter-multipitch',
    })
    expect(report.clarity.vowels.auditedCount).toBeGreaterThanOrEqual(4)
    expect(report.clarity.vowels.summary.minFormantEnergyRatio).toBeGreaterThan(0.1)
    expect(report.clarity.consonants.auditedCount).toBeGreaterThanOrEqual(10)
  })

  it('fails when the vowel and consonant clarity thresholds are set beyond the generated evidence', async () => {
    const root = makeTempRoot()
    const zip = join(root, 'webuta-ko-v3.zip')
    await generateKoreanV3SyntheticVoicebank({ output: zip, profile: 'tiny' })

    const report = await analyzeKoreanV3Clarity({
      zip,
      report: false,
      thresholds: {
        minVowelSamples: 4,
        minConsonantSamples: 10,
        minFormantEnergyRatio: 100,
        maxWeakConsonantRatio: 0,
      },
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('v3-clarity-audit-fail')
    expect(report.problems.join('\n')).toContain('formant energy ratio')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-v3-clarity-'))
  tempRoots.push(root)
  return root
}
