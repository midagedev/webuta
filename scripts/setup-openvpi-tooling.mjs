#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_OPENVPI_REPOS = [
  {
    id: 'MakeDiffSinger',
    url: 'https://github.com/openvpi/MakeDiffSinger.git',
  },
  {
    id: 'DiffSinger',
    url: 'https://github.com/openvpi/DiffSinger.git',
  },
  {
    id: 'dataset-tools',
    url: 'https://github.com/openvpi/dataset-tools.git',
  },
]

export function setupOpenVpiTooling(options = {}) {
  const root = resolve(options.root ?? '.local/neural-singer/openvpi')
  const repos = options.repos ?? DEFAULT_OPENVPI_REPOS
  const dryRun = options.dryRun === true
  const manifestPath = join(root, 'tooling-manifest.json')
  const repoResults = repos.map((repo) => setupRepo(root, repo, dryRun))
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    dryRun,
    repos: repoResults,
    tools: detectTools(),
    notes: [
      'OpenVPI repositories are local tooling only and must stay outside the WebUtau app dependency graph.',
      'MakeDiffSinger prepares datasets; DiffSinger contains the training and inference runtime.',
    ],
  }

  if (!dryRun) {
    mkdirSync(root, { recursive: true })
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return {
    ...manifest,
    manifestPath: dryRun ? null : manifestPath,
  }
}

function setupRepo(root, repo, dryRun) {
  const target = join(root, repo.id)
  if (dryRun) {
    return {
      id: repo.id,
      url: repo.url,
      target,
      action: existsSync(target) ? 'reuse' : 'clone',
      commit: existsSync(join(target, '.git')) ? git(target, ['rev-parse', 'HEAD']) : null,
    }
  }

  mkdirSync(root, { recursive: true })
  if (existsSync(target)) {
    if (!existsSync(join(target, '.git'))) {
      throw new Error(`Tooling path exists but is not a git checkout: ${target}`)
    }
    return repoInfo(repo, target, 'reuse')
  }

  git(root, ['clone', '--depth', '1', repo.url, target])
  return repoInfo(repo, target, 'clone')
}

function repoInfo(repo, target, action) {
  return {
    id: repo.id,
    url: repo.url,
    target,
    action,
    commit: git(target, ['rev-parse', 'HEAD']),
    remote: git(target, ['remote', 'get-url', 'origin']),
  }
}

function detectTools() {
  return {
    git: commandVersion('git', ['--version']),
    python3: commandVersion('python3', ['--version']),
    conda: commandVersion('conda', ['--version']),
    mfa: commandVersion('mfa', ['version']),
  }
}

function commandVersion(command, args) {
  try {
    return {
      available: true,
      path: commandPath(command),
      version: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
    }
  } catch (error) {
    return {
      available: false,
      path: null,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function commandPath(command) {
  try {
    return execFileSync('which', [command], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') {
      parsed.root = argv[++index]
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/setup-openvpi-tooling.mjs [options]',
          '',
          'Options:',
          '  --root path   Local ignored OpenVPI tooling root, default .local/neural-singer/openvpi',
          '  --dry-run     Print the planned clone/reuse actions without changing files',
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return parsed
}

export function assertIgnoredLocalRoot(path) {
  const resolved = resolve(path)
  const stats = existsSync(resolved) ? statSync(resolved) : null
  if (stats && !stats.isDirectory()) {
    throw new Error(`Expected tooling root to be a directory: ${resolved}`)
  }
  return existsSync(resolved) ? readdirSync(resolved).sort() : []
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = setupOpenVpiTooling(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
