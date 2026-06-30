import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDiffSingerDemoDs } from './prepare-diffsinger-demo-ds.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('DiffSinger demo DS preparation', () => {
  it('writes a dictionary-validated Korean demo DS file', () => {
    const root = makeTempRoot()
    const dictionary = join(root, 'dictionary-ko.txt')
    writeFileSync(dictionary, ['ph_0001\td', 'ph_0002\th', 'ph_0003\ti', 'ph_0004\tk', 'ph_0005\to', 'ph_0006\tsʰ', 'ph_0007\tu', 'ph_0008\tɐ', ''].join('\n'))
    const out = join(root, 'demo.ds')

    const result = prepareDiffSingerDemoDs({ out, dictionary })
    const ds = JSON.parse(readFileSync(out, 'utf8'))

    expect(result).toMatchObject({
      text: 'SP 도 히 도 히 다 이 스 키 SP',
      phoneCount: 17,
    })
    expect(result.durationSeconds).toBeCloseTo(2.78)
    expect(ds[0].ph_seq).toContain('sʰ')
    expect(ds[0].f0_seq.split(/\s+/u).length).toBeGreaterThan(500)
  })

  it('fails when the target dictionary cannot encode the demo phones', () => {
    const root = makeTempRoot()
    const dictionary = join(root, 'dictionary-ko.txt')
    writeFileSync(dictionary, 'ph_0001\td\n')

    expect(() => prepareDiffSingerDemoDs({ out: join(root, 'demo.ds'), dictionary })).toThrow(/missing from dictionary/)
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-diffsinger-demo-'))
  mkdirSync(root, { recursive: true })
  tempRoots.push(root)
  return root
}
