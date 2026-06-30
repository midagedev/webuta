import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mfaEnvBasename, readMfaEnvManifest, setupMfaEnv } from './setup-mfa-env.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('MFA environment setup', () => {
  it('plans local micromamba and MFA environment setup in dry-run mode', () => {
    const root = makeTempRoot()
    const result = setupMfaEnv({ root, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.actions).toEqual(['install-micromamba', 'env-not-created'])
    expect(result.micromambaUrl).toContain('/api/micromamba/')
    expect(result.mfaRootDir).toContain('mfa-root')
    expect(existsSync(root)).toBe(false)
  })

  it('writes a manifest when micromamba already exists and env creation is deferred', () => {
    const root = makeTempRoot()
    const micromambaBin = join(root, 'bin', 'micromamba')
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(micromambaBin, '#!/bin/sh\necho "2.0.0"\n')
    chmodSync(micromambaBin, 0o755)

    const result = setupMfaEnv({
      root,
      micromambaBin,
      installMicromamba: false,
      createEnv: false,
    })

    expect(result.actions).toEqual(['reuse-micromamba', 'env-not-created'])
    expect(result.toolsAfter.micromamba).toMatchObject({ available: true, version: '2.0.0' })
    expect(readMfaEnvManifest(result.manifestPath).root).toBe(root)
    expect(readMfaEnvManifest(result.manifestPath).mfaRootDir).toContain('mfa-root')
    expect(mfaEnvBasename(result.envPrefix)).toBe('webuta-mfa')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-mfa-env-'))
  rmSync(root, { recursive: true, force: true })
  tempRoots.push(root)
  return root
}
