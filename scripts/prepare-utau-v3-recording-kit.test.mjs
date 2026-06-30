import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReclist, prepareUtauV3RecordingKit } from './prepare-utau-v3-recording-kit.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('UTAU V3 recording kit', () => {
  it('creates a Korean CVVC-lite recording kit with release templates', () => {
    const root = makeTempRoot()
    const out = join(root, 'kit')

    const result = prepareUtauV3RecordingKit({
      out,
      singerId: 'webuta-ko-v3-test',
      singerName: 'WebUtau Korean V3 Test',
      pitches: ['C4', 'G4'],
    })

    expect(result.aliasCount).toBe((399 + 21 + 21 * 12) * 2)
    expect(result.unitCounts.byType).toMatchObject({
      CV: 399 * 2,
      V: 21 * 2,
      VC: 21 * 12 * 2,
    })
    expect(result.unitCounts.demoPriority).toBeGreaterThanOrEqual(12)
    expect(existsSync(join(out, 'reclist', 'v3-cvvc-lite.csv'))).toBe(true)
    expect(existsSync(join(out, 'templates', 'oto-template.ini'))).toBe(true)
    expect(existsSync(join(out, 'templates', 'character.yaml'))).toBe(true)
    expect(existsSync(join(out, 'license-release.template.md'))).toBe(true)

    const reclist = readFileSync(join(out, 'reclist', 'v3-cvvc-lite.csv'), 'utf8')
    expect(reclist).toContain('도')
    expect(reclist).toContain('히')
    expect(reclist).toContain('다')
    expect(reclist).toContain('키')
    expect(reclist).toContain('VC')
    expect(reclist).toContain('48')

    const manifest = JSON.parse(readFileSync(join(out, 'webuta-ko-v3-recording-kit.manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      singerId: 'webuta-ko-v3-test',
      releaseStatus: 'recording-kit-only',
      licenseStatus: 'requires-original-singer-release',
    })
  })

  it('can be run from the command line', () => {
    const root = makeTempRoot()
    const out = join(root, 'kit')
    const stdout = execFileSync(
      process.execPath,
      ['scripts/prepare-utau-v3-recording-kit.mjs', '--out', out, '--pitches', 'C4'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.aliasCount).toBe(399 + 21 + 21 * 12)
    expect(readFileSync(join(out, 'recording-guide.md'), 'utf8')).toContain('Record dry mono WAV')
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('UTAU zip')
  })

  it('keeps demo-priority aliases in the generated reclist', () => {
    const reclist = buildReclist({ pitches: ['C4'] })
    const demoAliases = reclist.filter((row) => row.priority === 'demo').map((row) => row.alias)

    expect(demoAliases).toEqual(expect.arrayContaining(['도', '히', '다', '이', '스', '키']))
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-utau-v3-kit-'))
  tempRoots.push(root)
  return root
}
