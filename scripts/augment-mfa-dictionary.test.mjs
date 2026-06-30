import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { augmentMfaDictionary } from './augment-mfa-dictionary.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('MFA dictionary augmentation', () => {
  it('appends missing G2P entries without duplicating base words', () => {
    const { base, additions, out } = makeFixture()
    const result = augmentMfaDictionary({ base, additions, out })

    expect(result).toMatchObject({
      baseEntryCount: 2,
      additionInputCount: 2,
      addedCount: 1,
      skippedExistingCount: 1,
    })
    expect(readFileSync(out, 'utf8')).toBe(['도\t0.99\t0.1\t0.2\t0.3\tt o', '얀\tj ɐ n', '끗\tk͈ ɨ t̚', ''].join('\n'))
    const manifest = JSON.parse(readFileSync(`${out}.manifest.json`, 'utf8'))
    expect(manifest.addedWords).toEqual(['끗'])
    expect(manifest.skippedExistingWords).toEqual(['도'])
  })

  it('runs through the command-line entrypoint', () => {
    const { base, additions, out } = makeFixture()
    const stdout = execFileSync(
      process.execPath,
      ['scripts/augment-mfa-dictionary.mjs', '--base', base, '--additions', additions, '--out', out],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.addedCount).toBe(1)
    expect(readFileSync(out, 'utf8')).toContain('끗\tk͈ ɨ t̚\n')
  })
})

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-mfa-dict-'))
  tempRoots.push(root)
  const base = join(root, 'base.dict')
  const additions = join(root, 'additions.dict')
  const out = join(root, 'out.dict')
  writeFileSync(base, ['도\t0.99\t0.1\t0.2\t0.3\tt o', '얀\tj ɐ n', ''].join('\n'))
  writeFileSync(additions, ['끗\tk͈ ɨ t̚', '도\tt o', ''].join('\n'))
  return { root, base, additions, out }
}
