import * as yaml from 'js-yaml'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareDiffSingerSmoke } from './prepare-diffsinger-smoke.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('DiffSinger smoke config preparation', () => {
  it('writes a compact dictionary and acoustic smoke config', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root)
    const diffSingerRoot = makeDiffSingerFixture(root)
    const out = join(root, 'out')

    const result = prepareDiffSingerSmoke({
      datasetDir,
      diffSingerRoot,
      out,
      testPrefixes: 'kr007a-02',
    })

    expect(result).toMatchObject({
      itemCount: 2,
      trainItemCount: 1,
      validationItemCount: 1,
      phoneInventoryCount: 6,
    })
    expect(readFileSync(join(out, 'dictionary-ko.txt'), 'utf8')).toBe(['ph_0001\tk', 'ph_0002\to', 'ph_0003\tt', 'ph_0004\tu', ''].join('\n'))

    const config = yaml.load(readFileSync(join(out, 'config.yaml'), 'utf8'))
    expect(config.datasets[0]).toMatchObject({
      raw_data_dir: datasetDir,
      language: 'ko',
      test_prefixes: ['kr007a-02'],
    })
    expect(config.hnsep).toBe('world')
    expect(config.val_with_vocoder).toBe(false)
    expect(config.backbone_args).toMatchObject({ num_layers: 2, num_channels: 64 })

    const manifest = JSON.parse(readFileSync(join(out, 'diffsinger-smoke.manifest.json'), 'utf8'))
    expect(manifest.phoneCounts).toMatchObject({ AP: 1, SP: 1, k: 1, o: 2, t: 1, u: 1 })
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('scripts/binarize.py')
  })

  it('fails early when validation prefixes would leave no training rows', () => {
    const root = makeTempRoot()
    expect(() =>
      prepareDiffSingerSmoke({
        datasetDir: makeDatasetFixture(root),
        diffSingerRoot: makeDiffSingerFixture(root),
        out: join(root, 'out'),
        testPrefixes: 'kr007a',
      }),
    ).toThrow(/empty training set/)
  })

  it('fails early when AP or SP is absent from the smoke inventory', () => {
    const root = makeTempRoot()
    const datasetDir = makeDatasetFixture(root, 'name,ph_seq,ph_dur\nkr007a-01,k o,0.1 0.2\nkr007a-02,t u,0.1 0.2\n')
    expect(() =>
      prepareDiffSingerSmoke({
        datasetDir,
        diffSingerRoot: makeDiffSingerFixture(root),
        out: join(root, 'out'),
      }),
    ).toThrow(/always includes AP/)
  })
})

function makeDatasetFixture(root, transcriptions = null) {
  const datasetDir = join(root, 'dataset')
  const wavDir = join(datasetDir, 'wavs')
  mkdirSync(wavDir, { recursive: true })
  writeFileSync(
    join(datasetDir, 'transcriptions.csv'),
    transcriptions ?? 'name,ph_seq,ph_dur\nkr007a-01,k o SP,0.1 0.2 0.3\nkr007a-02,AP t u o,0.1 0.2 0.3 0.4\n',
  )
  writeFileSync(join(wavDir, 'kr007a-01.wav'), '')
  writeFileSync(join(wavDir, 'kr007a-02.wav'), '')
  return datasetDir
}

function makeDiffSingerFixture(root) {
  const diffSingerRoot = join(root, 'DiffSinger')
  mkdirSync(join(diffSingerRoot, 'configs'), { recursive: true })
  writeFileSync(join(diffSingerRoot, 'configs', 'acoustic.yaml'), 'base_config: []\n')
  return diffSingerRoot
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-diffsinger-smoke-'))
  tempRoots.push(root)
  return root
}
