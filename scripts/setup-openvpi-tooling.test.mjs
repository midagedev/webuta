import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setupOpenVpiTooling } from './setup-openvpi-tooling.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('OpenVPI tooling setup', () => {
  it('clones local fixture repositories and writes a manifest', () => {
    const root = makeTempRoot()
    const sourceA = makeGitRepo(root, 'source-a')
    const sourceB = makeGitRepo(root, 'source-b')
    const toolingRoot = join(root, 'tooling')
    const result = setupOpenVpiTooling({
      root: toolingRoot,
      repos: [
        { id: 'MakeDiffSinger', url: sourceA },
        { id: 'dataset-tools', url: sourceB },
      ],
    })

    expect(result.repos).toMatchObject([
      { id: 'MakeDiffSinger', action: 'clone', remote: sourceA },
      { id: 'dataset-tools', action: 'clone', remote: sourceB },
    ])
    expect(result.manifestPath).toBe(join(toolingRoot, 'tooling-manifest.json'))
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8')).repos).toHaveLength(2)

    const reused = setupOpenVpiTooling({
      root: toolingRoot,
      repos: [
        { id: 'MakeDiffSinger', url: sourceA },
        { id: 'dataset-tools', url: sourceB },
      ],
    })
    expect(reused.repos.map((repo) => repo.action)).toEqual(['reuse', 'reuse'])
  })

  it('supports dry-run without creating the tooling root', () => {
    const root = makeTempRoot()
    const toolingRoot = join(root, 'dry-tooling')
    const result = setupOpenVpiTooling({
      root: toolingRoot,
      dryRun: true,
      repos: [{ id: 'MakeDiffSinger', url: 'https://example.invalid/repo.git' }],
    })

    expect(result.manifestPath).toBeNull()
    expect(result.repos[0]).toMatchObject({ action: 'clone', target: join(toolingRoot, 'MakeDiffSinger') })
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-openvpi-tooling-'))
  tempRoots.push(root)
  return root
}

function makeGitRepo(root, name) {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init'], { cwd: path, stdio: 'ignore' })
  writeFileSync(join(path, 'README.md'), `# ${name}\n`)
  execFileSync('git', ['add', 'README.md'], { cwd: path, stdio: 'ignore' })
  execFileSync('git', ['-c', 'user.name=WebUtau Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Initial fixture'], {
    cwd: path,
    stdio: 'ignore',
  })
  return path
}
