import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareKoreanMfaDictionary, pronunciationForToken } from './prepare-korean-mfa-dictionary.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Korean MFA dictionary preparation', () => {
  it('writes a dictionary and phone inventory from OpenVPI seed labels', () => {
    const { seedDir, out } = makeSeedFixture()
    const result = prepareKoreanMfaDictionary({ seedDir, out })

    expect(result).toMatchObject({
      labFileCount: 2,
      tokenCount: 13,
      dictionaryEntryCount: 11,
      unsupportedTokenCount: 0,
    })
    const dictionary = readFileSync(join(out, 'korean.dict'), 'utf8')
    expect(dictionary).toContain('도\td o\n')
    expect(dictionary).toContain('히\th i\n')
    expect(dictionary).toContain('스\ts eu\n')
    expect(dictionary).toContain('키\tk i\n')
    expect(dictionary).toContain('강\tg a ng\n')
    expect(dictionary).toContain('밤\tb a m\n')

    const phones = readFileSync(join(out, 'phones.txt'), 'utf8').trim().split('\n')
    expect(phones).toContain('eu')
    expect(phones).toContain('ng')

    const manifest = JSON.parse(readFileSync(join(out, 'mfa-dictionary.manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      uniqueTokenCount: 11,
      phoneInventoryCount: phones.length,
    })
    expect(manifest.phoneCounts.ng).toBe(1)
  })

  it('keeps multi-syllable tokens pronounceable but reports them for label cleanup', () => {
    const root = makeTempRoot()
    const labelDir = join(root, 'labels')
    const out = join(root, 'mfa')
    mkdirSync(labelDir, { recursive: true })
    writeFileSync(join(labelDir, 'phrase.lab'), '사랑 하늘\n')

    prepareKoreanMfaDictionary({ labelDir, out })
    const dictionary = readFileSync(join(out, 'korean.dict'), 'utf8')
    const report = JSON.parse(readFileSync(join(out, 'oov-report.json'), 'utf8'))

    expect(dictionary).toContain('사랑\ts a r a ng\n')
    expect(report.multiSyllableTokens.map((entry) => entry.token)).toEqual(['사랑', '하늘'])
  })

  it('rejects unsupported label tokens unless explicitly allowed', () => {
    const root = makeTempRoot()
    const labelDir = join(root, 'labels')
    const out = join(root, 'mfa')
    mkdirSync(labelDir, { recursive: true })
    writeFileSync(join(labelDir, 'phrase.lab'), '도 AI\n')

    expect(() => prepareKoreanMfaDictionary({ labelDir, out })).toThrow(/Unsupported MFA label tokens/)

    const allowed = prepareKoreanMfaDictionary({ labelDir, out, allowUnsupported: true })
    expect(allowed.unsupportedTokenCount).toBe(1)
    const report = JSON.parse(readFileSync(join(out, 'oov-report.json'), 'utf8'))
    expect(report.unsupportedTokens).toEqual([{ token: 'AI', count: 1 }])
  })

  it('ignores AP and SP pause labels when building pronunciation entries', () => {
    const root = makeTempRoot()
    const labelDir = join(root, 'labels')
    const out = join(root, 'mfa')
    mkdirSync(labelDir, { recursive: true })
    writeFileSync(join(labelDir, 'phrase.lab'), '도 AP 히 SP\n')

    const result = prepareKoreanMfaDictionary({ labelDir, out })

    expect(result).toMatchObject({
      tokenCount: 2,
      uniqueTokenCount: 2,
      dictionaryEntryCount: 2,
      unsupportedTokenCount: 0,
    })
    expect(readFileSync(join(out, 'korean.dict'), 'utf8')).toBe(['도\td o', '히\th i', ''].join('\n'))
  })

  it('runs through the command-line entrypoint', () => {
    const { seedDir, out } = makeSeedFixture()
    const stdout = execFileSync(
      process.execPath,
      ['scripts/prepare-korean-mfa-dictionary.mjs', '--seed-dir', seedDir, '--out', out],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.dictionaryEntryCount).toBe(11)
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('Korean-compatible acoustic model')
  })
})

describe('Korean MFA pronunciation helper', () => {
  it('decomposes Hangul syllables using the WebUtau phone inventory', () => {
    expect(pronunciationForToken('도')).toEqual(['d', 'o'])
    expect(pronunciationForToken('강')).toEqual(['g', 'a', 'ng'])
    expect(pronunciationForToken('안')).toEqual(['a', 'n'])
    expect(pronunciationForToken('AP')).toBeNull()
    expect(pronunciationForToken('AI')).toBeNull()
  })
})

function makeSeedFixture() {
  const root = makeTempRoot()
  const seedDir = join(root, 'seed')
  const labelDir = join(seedDir, 'raw', 'wavs')
  const out = join(root, 'mfa')
  mkdirSync(labelDir, { recursive: true })
  writeFileSync(join(labelDir, 'demo.lab'), '도 히 도 히 다 이 스 키\n')
  writeFileSync(join(labelDir, 'coda.lab'), '강 남 밤 하 늘\n')
  return { root, seedDir, out }
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-korean-mfa-'))
  tempRoots.push(root)
  return root
}
