#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = '.local/neural-singer/mamba'
const DEFAULT_ENV_NAME = 'webuta-diffsinger'
const DEFAULT_PYTHON = '3.10'
const DEFAULT_DIFFSINGER_ROOT = '.local/neural-singer/openvpi/DiffSinger'

export function setupDiffSingerEnv(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT)
  const envName = options.envName ?? DEFAULT_ENV_NAME
  const pythonVersion = options.python ?? DEFAULT_PYTHON
  const platform = options.platform ?? detectMicromambaPlatform()
  const micromambaUrl = options.micromambaUrl ?? `https://micro.mamba.pm/api/micromamba/${platform}/latest`
  const micromambaBin = resolve(options.micromambaBin ?? join(root, 'bin', 'micromamba'))
  const rootPrefix = resolve(options.rootPrefix ?? join(root, 'root-prefix'))
  const envPrefix = resolve(options.envPrefix ?? join(root, 'envs', envName))
  const diffSingerRoot = resolve(options.diffSingerRoot ?? DEFAULT_DIFFSINGER_ROOT)
  const requirements = resolve(options.requirements ?? join(diffSingerRoot, 'requirements.txt'))
  const manifestPath = resolve(options.manifest ?? join(root, `${envName}-env-manifest.json`))
  const dryRun = options.dryRun === true
  const installMicromamba = options.installMicromamba === true
  const createEnv = options.createEnv === true
  const installTorch = options.installTorch === true
  const installRequirements = options.installRequirements === true
  const torchPackages = normalizePackages(options.torchPackages ?? ['torch', 'torchvision', 'torchaudio'])
  const torchIndexUrl = options.torchIndexUrl

  const planned = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    envName,
    pythonVersion,
    platform,
    micromambaUrl,
    micromambaBin,
    rootPrefix,
    envPrefix,
    diffSingerRoot,
    requirements,
    dryRun,
    installMicromamba,
    createEnv,
    installTorch,
    installRequirements,
    torchPackages,
    torchIndexUrl: torchIndexUrl ?? null,
    actions: [],
    toolsBefore: detectTools({ micromambaBin, envPrefix, diffSingerRoot }),
  }

  if (dryRun) {
    planned.actions.push(micromambaExists(micromambaBin) ? 'reuse-micromamba' : 'install-micromamba')
    planned.actions.push(createEnv ? (envExists(envPrefix) ? 'reuse-env' : 'create-env') : envExists(envPrefix) ? 'env-present' : 'env-not-created')
    if (installTorch) {
      planned.actions.push('install-pytorch')
    }
    if (installRequirements) {
      planned.actions.push('install-diffsinger-requirements')
    }
    planned.toolsAfter = planned.toolsBefore
    return planned
  }

  mkdirSync(root, { recursive: true })
  if (installMicromamba || !micromambaExists(micromambaBin)) {
    installMicromambaBinary({ root, micromambaBin, micromambaUrl })
    planned.actions.push('install-micromamba')
  } else {
    planned.actions.push('reuse-micromamba')
  }

  if (createEnv) {
    if (envExists(envPrefix)) {
      planned.actions.push('reuse-env')
    } else {
      createDiffSingerEnvironment({ micromambaBin, rootPrefix, envPrefix, pythonVersion })
      planned.actions.push('create-env')
    }
  } else {
    planned.actions.push(envExists(envPrefix) ? 'env-present' : 'env-not-created')
  }

  if (installTorch) {
    installPipPackages({ envPrefix, packages: torchPackages, indexUrl: torchIndexUrl })
    planned.actions.push('install-pytorch')
  }

  if (installRequirements) {
    installPythonRequirements({ envPrefix, requirements })
    planned.actions.push('install-diffsinger-requirements')
  }

  planned.toolsAfter = detectTools({ micromambaBin, envPrefix, diffSingerRoot })
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, `${JSON.stringify(planned, null, 2)}\n`)
  return {
    ...planned,
    manifestPath,
  }
}

function installMicromambaBinary({ root, micromambaBin, micromambaUrl }) {
  const archive = join(root, 'micromamba.tar.bz2')
  const extractDir = join(root, 'micromamba-extract')
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  execFileSync('curl', ['-L', '--fail', micromambaUrl, '-o', archive], { stdio: 'inherit' })
  execFileSync('tar', ['-xjf', archive, '-C', extractDir], { stdio: 'inherit' })
  const extracted = join(extractDir, 'bin', 'micromamba')
  if (!existsSync(extracted)) {
    throw new Error(`Downloaded micromamba archive did not contain bin/micromamba from ${micromambaUrl}`)
  }
  mkdirSync(dirname(micromambaBin), { recursive: true })
  rmSync(micromambaBin, { force: true })
  execFileSync('cp', [extracted, micromambaBin])
  execFileSync('chmod', ['755', micromambaBin])
}

function createDiffSingerEnvironment({ micromambaBin, rootPrefix, envPrefix, pythonVersion }) {
  mkdirSync(dirname(envPrefix), { recursive: true })
  execFileSync(
    micromambaBin,
    ['create', '-y', '-p', envPrefix, '-r', rootPrefix, '-c', 'conda-forge', `python=${pythonVersion}`, 'pip'],
    { stdio: 'inherit' },
  )
}

function installPipPackages({ envPrefix, packages, indexUrl }) {
  assertEnvExists(envPrefix)
  const args = ['install', ...packages]
  if (indexUrl) {
    args.push('--index-url', indexUrl)
  }
  execFileSync(join(envPrefix, 'bin', 'python'), ['-m', 'pip', ...args], {
    env: pythonEnv(envPrefix),
    stdio: 'inherit',
  })
}

function installPythonRequirements({ envPrefix, requirements }) {
  assertEnvExists(envPrefix)
  if (!existsSync(requirements)) {
    throw new Error(`Missing DiffSinger requirements file: ${requirements}`)
  }
  execFileSync(join(envPrefix, 'bin', 'python'), ['-m', 'pip', 'install', '-r', requirements], {
    env: pythonEnv(envPrefix),
    stdio: 'inherit',
  })
}

function detectTools({ micromambaBin, envPrefix, diffSingerRoot }) {
  return {
    micromamba: micromambaExists(micromambaBin) ? commandVersion(micromambaBin, ['--version']) : missingTool(micromambaBin),
    envPython: envExists(envPrefix)
      ? commandVersion(join(envPrefix, 'bin', 'python'), ['--version'], pythonEnv(envPrefix))
      : missingTool(join(envPrefix, 'bin', 'python')),
    diffSingerRoot: {
      available: existsSync(join(diffSingerRoot, 'requirements.txt')),
      path: diffSingerRoot,
    },
    diffSingerRuntime: envExists(envPrefix)
      ? pythonImportCheck(envPrefix, ['torch', 'lightning', 'librosa', 'parselmouth', 'pyworld', 'yaml', 'soundfile', 'onnx', 'numpy'])
      : { available: false, missing: [] },
  }
}

function pythonImportCheck(envPrefix, modules) {
  const code = [
    'import importlib, json',
    `mods = ${JSON.stringify(modules)}`,
    'missing = []',
    'versions = {}',
    'for mod in mods:',
    '    try:',
    '        module = importlib.import_module(mod)',
    '        versions[mod] = getattr(module, "__version__", None)',
    '    except Exception as e:',
    '        missing.append({"module": mod, "error": str(e)})',
    'print(json.dumps({"available": len(missing) == 0, "missing": missing, "versions": versions}))',
  ].join('\n')
  try {
    return JSON.parse(
      execFileSync(join(envPrefix, 'bin', 'python'), ['-c', code], {
        encoding: 'utf8',
        env: pythonEnv(envPrefix),
      }),
    )
  } catch (error) {
    return {
      available: false,
      missing: [{ module: '(check failed)', error: error instanceof Error ? error.message : String(error) }],
      versions: {},
    }
  }
}

function commandVersion(command, args, extraEnv = undefined) {
  try {
    return {
      available: true,
      path: command,
      version: execFileSync(command, args, {
        encoding: 'utf8',
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    }
  } catch (error) {
    return {
      available: false,
      path: command,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function missingTool(path) {
  return {
    available: false,
    path,
    version: null,
  }
}

function micromambaExists(path) {
  return existsSync(path) && statSync(path).isFile()
}

function envExists(path) {
  return existsSync(join(path, 'bin')) && existsSync(join(path, 'conda-meta'))
}

function assertEnvExists(envPrefix) {
  if (!envExists(envPrefix)) {
    throw new Error(`Cannot install DiffSinger packages before env exists: ${envPrefix}`)
  }
}

function pythonEnv(envPrefix) {
  return { ...process.env, PATH: `${join(envPrefix, 'bin')}:${process.env.PATH ?? ''}` }
}

function normalizePackages(packages) {
  if (Array.isArray(packages)) {
    return packages
  }
  return String(packages).split(',').map((item) => item.trim()).filter(Boolean)
}

function detectMicromambaPlatform() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'osx-arm64'
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'osx-64'
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return 'linux-64'
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return 'linux-aarch64'
  }
  throw new Error(`Unsupported micromamba platform: ${process.platform}/${process.arch}`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') {
      parsed.root = argv[++index]
    } else if (arg === '--env-name') {
      parsed.envName = argv[++index]
    } else if (arg === '--python') {
      parsed.python = argv[++index]
    } else if (arg === '--diffsinger-root') {
      parsed.diffSingerRoot = argv[++index]
    } else if (arg === '--requirements') {
      parsed.requirements = argv[++index]
    } else if (arg === '--install-micromamba') {
      parsed.installMicromamba = true
    } else if (arg === '--create-env') {
      parsed.createEnv = true
    } else if (arg === '--install-torch') {
      parsed.installTorch = true
    } else if (arg === '--install-requirements') {
      parsed.installRequirements = true
    } else if (arg === '--torch-packages') {
      parsed.torchPackages = argv[++index]
    } else if (arg === '--torch-index-url') {
      parsed.torchIndexUrl = argv[++index]
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/setup-diffsinger-env.mjs [options]',
          '',
          'Options:',
          `  --root path              Local mamba root, default ${DEFAULT_ROOT}`,
          `  --env-name name          Env name, default ${DEFAULT_ENV_NAME}`,
          `  --python version         Python version, default ${DEFAULT_PYTHON}`,
          `  --diffsinger-root path   Local DiffSinger checkout, default ${DEFAULT_DIFFSINGER_ROOT}`,
          '  --install-micromamba     Download micromamba into the local root when missing',
          '  --create-env             Create the DiffSinger conda environment with micromamba',
          '  --install-torch          Install PyTorch packages with pip',
          '  --install-requirements   Install DiffSinger requirements.txt with pip',
          '  --torch-packages list    Comma-separated torch packages, default torch,torchvision,torchaudio',
          '  --torch-index-url url    Optional pip index URL for torch packages',
          '  --dry-run                Show planned actions without changing files',
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

export function readDiffSingerEnvManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function diffSingerEnvBasename(path) {
  return basename(path)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = setupDiffSingerEnv(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
