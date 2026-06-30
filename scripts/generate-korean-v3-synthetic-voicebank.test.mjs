import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { buildUnits, generateKoreanV3SyntheticVoicebank } from './generate-korean-v3-synthetic-voicebank.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Korean V3 synthetic voicebank generator', () => {
  it('builds a deterministic tiny UTAU zip with metadata and aliases', async () => {
    const root = makeTempRoot()
    const out = join(root, 'webuta-ko-v3.zip')

    const result = await generateKoreanV3SyntheticVoicebank({ output: out, profile: 'tiny' })
    const zip = await JSZip.loadAsync(await import('node:fs').then(({ readFileSync }) => readFileSync(out)))
    const oto = await zip.file('oto.ini').async('string')
    const license = await zip.file('license.txt').async('string')
    const manifest = JSON.parse(await zip.file('webuta-ko-v3.manifest.json').async('string'))

    expect(result.manifest.coverage.sampleCount).toBeGreaterThan(10)
    expect(result.manifest.coverage.aliasCount).toBeGreaterThan(result.manifest.coverage.sampleCount)
    expect(oto).toContain('도')
    expect(oto).toContain('연')
    expect(license).toContain('No third-party voice')
    expect(manifest).toMatchObject({
      id: 'webuta-ko-v3-synthetic',
      type: 'generated-synthetic-utau-cv-vc',
      profile: 'tiny',
    })
    expect(Object.keys(zip.files).some((path) => path.endsWith('.wav'))).toBe(true)
  })

  it('includes full Korean CV coverage in the release profile', () => {
    const units = buildUnits({ profile: 'release' })
    const cvUnits = units.filter((unit) => unit.type === 'CV')
    const aliases = new Set(cvUnits.flatMap((unit) => unit.aliases))

    expect(cvUnits).toHaveLength(399 * 3)
    expect(aliases.has('도')).toBe(true)
    expect(aliases.has('히')).toBe(true)
    expect(aliases.has('다')).toBe(true)
    expect(aliases.has('키')).toBe(true)
  })

  it('keeps the web profile compact while covering the default demo', () => {
    const units = buildUnits({ profile: 'web' })
    const aliases = new Set(units.flatMap((unit) => unit.aliases))

    expect(units.length).toBeLessThan(700)
    expect(aliases.has('도')).toBe(true)
    expect(aliases.has('히')).toBe(true)
    expect(aliases.has('다')).toBe(true)
    expect(aliases.has('이')).toBe(true)
    expect(aliases.has('스')).toBe(true)
    expect(aliases.has('키')).toBe(true)
    expect(aliases.has('연')).toBe(true)
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-v3-synth-'))
  tempRoots.push(root)
  return root
}
