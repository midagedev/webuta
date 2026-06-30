import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { simplifyMfaDictionary } from './simplify-mfa-dictionary.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('MFA dictionary simplification', () => {
  it('keeps the first pronunciation and strips MFA probability columns', () => {
    const { dictionary, out } = makeFixture()
    const result = simplifyMfaDictionary({ dictionary, out })

    expect(result).toMatchObject({
      inputEntryCount: 3,
      outputEntryCount: 2,
      duplicatePronunciationCount: 1,
    })
    expect(readFileSync(out, 'utf8')).toBe(['도\tt o', '끗\tk͈ ɨ t̚', ''].join('\n'))
  })

  it('can keep the last duplicate pronunciation', () => {
    const { dictionary, out } = makeFixture()
    simplifyMfaDictionary({ dictionary, out, keepLast: true })

    expect(readFileSync(out, 'utf8')).toContain('도\tt oː\n')
  })

  it('runs through the command-line entrypoint', () => {
    const { dictionary, out } = makeFixture()
    const stdout = execFileSync(
      process.execPath,
      ['scripts/simplify-mfa-dictionary.mjs', '--dictionary', dictionary, '--out', out],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.outputEntryCount).toBe(2)
    expect(readFileSync(out, 'utf8')).toContain('끗\tk͈ ɨ t̚\n')
  })
})

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-mfa-simple-dict-'))
  tempRoots.push(root)
  const dictionary = join(root, 'korean.dict')
  const out = join(root, 'simple.dict')
  writeFileSync(dictionary, ['도\t0.99\t0.1\t0.2\t0.3\tt o', '도\t0.47\t0.1\t0.2\t0.3\tt oː', '끗\tk͈ ɨ t̚', ''].join('\n'))
  return { root, dictionary, out }
}
