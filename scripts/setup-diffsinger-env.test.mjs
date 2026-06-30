import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setupDiffSingerEnv } from './setup-diffsinger-env.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('DiffSinger environment setup', () => {
  it('supports dry-run without creating the mamba root', () => {
    const root = makeTempRoot()
    const mambaRoot = join(root, 'mamba')
    const result = setupDiffSingerEnv({
      root: mambaRoot,
      diffSingerRoot: makeDiffSingerFixture(root),
      dryRun: true,
      createEnv: true,
      installTorch: true,
      installRequirements: true,
    })

    expect(result.envName).toBe('webuta-diffsinger')
    expect(result.actions).toEqual(['install-micromamba', 'create-env', 'install-pytorch', 'install-diffsinger-requirements'])
    expect(result.toolsAfter.envPython.available).toBe(false)
  })

  it('reuses an existing env and writes a manifest without installing packages', () => {
    const root = makeTempRoot()
    const mambaRoot = join(root, 'mamba')
    const envPrefix = join(mambaRoot, 'envs', 'webuta-diffsinger')
    mkdirSync(join(mambaRoot, 'bin'), { recursive: true })
    mkdirSync(join(envPrefix, 'bin'), { recursive: true })
    mkdirSync(join(envPrefix, 'conda-meta'), { recursive: true })
    writeFileSync(join(mambaRoot, 'bin', 'micromamba'), '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 })
    writeFileSync(join(envPrefix, 'bin', 'python'), '#!/bin/sh\necho Python 3.10.0\n', { mode: 0o755 })

    const result = setupDiffSingerEnv({
      root: mambaRoot,
      diffSingerRoot: makeDiffSingerFixture(root),
      createEnv: true,
    })

    expect(result.actions).toEqual(['reuse-micromamba', 'reuse-env'])
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8')).envPrefix).toBe(envPrefix)
  })
})

function makeDiffSingerFixture(root) {
  const diffSingerRoot = join(root, 'DiffSinger')
  mkdirSync(diffSingerRoot, { recursive: true })
  writeFileSync(join(diffSingerRoot, 'requirements.txt'), 'numpy\n')
  return diffSingerRoot
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-diffsinger-env-'))
  tempRoots.push(root)
  return root
}
