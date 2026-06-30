import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditMfaLabelCoverage, readMfaDictionary } from './audit-mfa-label-coverage.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('MFA label coverage audit', () => {
  it('audits OpenVPI seed labels against an MFA probability dictionary', () => {
    const { seedDir, dictionary, out } = makeFixture()
    const result = auditMfaLabelCoverage({ seedDir, dictionary, out })

    expect(result).toMatchObject({
      labFileCount: 2,
      tokenCount: 9,
      uniqueTokenCount: 7,
      coveredUniqueTokenCount: 7,
      oovUniqueTokenCount: 0,
    })

    const report = JSON.parse(readFileSync(join(out, 'mfa-label-coverage.json'), 'utf8'))
    expect(report.coveredTokens).toContainEqual({
      token: '강',
      count: 1,
      pronunciationCount: 1,
      phones: ['k', 'ɐ', 'ŋ'],
    })
    expect(readFileSync(join(out, 'phones-from-labels.txt'), 'utf8')).toContain('ç\n')
  })

  it('fails on OOV labels unless allowed for reporting', () => {
    const { seedDir, dictionary, out } = makeFixture('도 AI\n')

    expect(() => auditMfaLabelCoverage({ seedDir, dictionary, out })).toThrow(/OOV label tokens/)

    const result = auditMfaLabelCoverage({ seedDir, dictionary, out, allowOov: true })
    expect(result.oovUniqueTokenCount).toBe(1)
    expect(readFileSync(join(out, 'oov-tokens.txt'), 'utf8')).toBe('AI\n')
  })

  it('does not count AP and SP pause labels as OOV words', () => {
    const { seedDir, dictionary, out } = makeFixture('도 AP 히 SP\n')

    const result = auditMfaLabelCoverage({ seedDir, dictionary, out })

    expect(result).toMatchObject({
      tokenCount: 3,
      uniqueTokenCount: 3,
      coveredUniqueTokenCount: 3,
      oovUniqueTokenCount: 0,
    })
    expect(readFileSync(join(out, 'oov-tokens.txt'), 'utf8')).toBe('')
  })

  it('runs through the command-line entrypoint', () => {
    const { seedDir, dictionary, out } = makeFixture()
    const stdout = execFileSync(
      process.execPath,
      ['scripts/audit-mfa-label-coverage.mjs', '--seed-dir', seedDir, '--dictionary', dictionary, '--out', out],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.coveredUniqueTokenCount).toBe(7)
    expect(result.oovUniqueTokenCount).toBe(0)
  })
})

describe('MFA dictionary parser', () => {
  it('reads simple and probability-rich dictionary rows', () => {
    const root = makeTempRoot()
    const dictionary = join(root, 'korean.dict')
    writeFileSync(dictionary, ['도\t0.99\t0.28\t0.33\t1.08\tt o', '히\tç i', '도\t0.47\t0.02\t0.28\t1.06\tt oː', ''].join('\n'))

    const parsed = readMfaDictionary(dictionary)

    expect(parsed.entryCount).toBe(3)
    expect(parsed.entries.get('도')).toEqual([
      ['t', 'o'],
      ['t', 'oː'],
    ])
    expect(parsed.entries.get('히')).toEqual([['ç', 'i']])
  })
})

function makeFixture(labelText = null) {
  const root = makeTempRoot()
  const seedDir = join(root, 'seed')
  const labelDir = join(seedDir, 'raw', 'wavs')
  const dictionary = join(root, 'korean_mfa.dict')
  const out = join(root, 'audit')
  mkdirSync(labelDir, { recursive: true })
  writeFileSync(join(labelDir, 'demo.lab'), labelText ?? '도 히 도 히 다 이 스 키\n')
  writeFileSync(join(labelDir, 'coda.lab'), '강\n')
  writeFileSync(
    dictionary,
    [
      '강\t0.99\t0.03\t2.09\t0.79\tk ɐ ŋ',
      '다\t0.99\t0.71\t1.51\t0.88\tt ɐ',
      '도\t0.99\t0.28\t0.33\t1.08\tt o',
      '스\t0.99\t0.12\t1.85\t0.89\tsʰ ɨ',
      '이\t0.99\t0.1\t2.04\t0.92\ti',
      '키\t0.99\t0.07\t2.98\t0.62\tcʰ i',
      '히\t0.99\t0.02\t1.7\t0.73\tç i',
      '',
    ].join('\n'),
  )
  return { root, seedDir, dictionary, out }
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-mfa-audit-'))
  tempRoots.push(root)
  return root
}
