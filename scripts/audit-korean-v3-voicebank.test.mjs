import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  auditKoreanV3Voicebank,
  auditWav,
  parseOto,
} from './audit-korean-v3-voicebank.mjs'
import { generateKoreanV3SyntheticVoicebank } from './generate-korean-v3-synthetic-voicebank.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Korean V3 voicebank audit', () => {
  it('passes the generated tiny voicebank when thresholds are scaled for the fixture', async () => {
    const root = makeTempRoot()
    const zip = join(root, 'webuta-ko-v3.zip')
    await generateKoreanV3SyntheticVoicebank({ output: zip, profile: 'tiny' })

    const report = await auditKoreanV3Voicebank({
      zip,
      minWavs: 25,
      minAliases: 60,
      maxBytes: 5 * 1024 * 1024,
    })

    expect(report.ok).toBe(true)
    expect(report.package.demoAliases.every((item) => item.present)).toBe(true)
    expect(report.package.codaAliases.every((item) => item.present)).toBe(true)
    expect(report.wav.summary.problemCount).toBe(0)
  })

  it('flags missing demo aliases and package files', async () => {
    const root = makeTempRoot()
    const zip = join(root, 'webuta-ko-v3.zip')
    await generateKoreanV3SyntheticVoicebank({ output: zip, profile: 'tiny' })

    const report = await auditKoreanV3Voicebank({
      zip,
      minWavs: 999,
      minAliases: 999,
      maxBytes: 1024,
    })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('Only')
    expect(report.problems.join('\n')).toContain('Voicebank zip')
  })

  it('parses oto.ini aliases', () => {
    expect(parseOto('a.wav=아,0,120,-500,60,20\n')).toEqual([
      {
        fileName: 'a.wav',
        alias: '아',
        offsetMs: 0,
        consonantMs: 120,
        cutoffMs: -500,
        preutteranceMs: 60,
        overlapMs: 20,
      },
    ])
  })

  it('rejects invalid WAV bytes', () => {
    const result = auditWav('bad.wav', new Uint8Array([1, 2, 3, 4]))

    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('RIFF/WAVE')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-v3-audit-'))
  tempRoots.push(root)
  return root
}
