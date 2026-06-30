#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = '.local/neural-singer/mamba'
const DEFAULT_ENV_NAME = 'webuta-mfa'
const DEFAULT_PYTHON = '3.8'
const DEFAULT_MFA = '2.0.6'
const DEFAULT_MFA_ROOT_DIR = '.local/neural-singer/mfa-root'

export function setupMfaEnv(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT)
  const envName = options.envName ?? DEFAULT_ENV_NAME
  const pythonVersion = options.python ?? DEFAULT_PYTHON
  const mfaVersion = options.mfa ?? DEFAULT_MFA
  const platform = options.platform ?? detectMicromambaPlatform()
  const micromambaUrl = options.micromambaUrl ?? `https://micro.mamba.pm/api/micromamba/${platform}/latest`
  const micromambaBin = resolve(options.micromambaBin ?? join(root, 'bin', 'micromamba'))
  const rootPrefix = resolve(options.rootPrefix ?? join(root, 'root-prefix'))
  const envPrefix = resolve(options.envPrefix ?? join(root, 'envs', envName))
  const mfaRootDir = resolve(options.mfaRootDir ?? DEFAULT_MFA_ROOT_DIR)
  const defaultManifestName = envName === DEFAULT_ENV_NAME ? 'mfa-env-manifest.json' : `${envName}-env-manifest.json`
  const manifestPath = resolve(options.manifest ?? join(root, defaultManifestName))
  const dryRun = options.dryRun === true
  const installMicromamba = options.installMicromamba === true
  const createEnv = options.createEnv === true
  const installMakeDiffSingerRequirements = options.installMakeDiffSingerRequirements === true
  const makeDiffSingerRequirements = resolve(
    options.makeDiffSingerRequirements ??
      '.local/neural-singer/openvpi/MakeDiffSinger/acoustic_forced_alignment/requirements.txt',
  )

  const planned = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    envName,
    pythonVersion,
    mfaVersion,
    platform,
    micromambaUrl,
    micromambaBin,
    rootPrefix,
    envPrefix,
    mfaRootDir,
    dryRun,
    installMicromamba,
    createEnv,
    installMakeDiffSingerRequirements,
    makeDiffSingerRequirements,
    actions: [],
    toolsBefore: detectTools(micromambaBin, envPrefix, mfaRootDir, { allowMfaProbe: !dryRun || existsSync(mfaRootDir) }),
  }

  if (dryRun) {
    planned.actions.push(micromambaExists(micromambaBin) ? 'reuse-micromamba' : 'install-micromamba')
    if (createEnv) {
      planned.actions.push(envExists(envPrefix) ? 'reuse-env' : 'create-env')
    } else {
      planned.actions.push(envExists(envPrefix) ? 'env-present' : 'env-not-created')
    }
    if (installMakeDiffSingerRequirements) {
      planned.actions.push('install-makediffsinger-requirements')
    }
    planned.toolsAfter = planned.toolsBefore
    return planned
  }

  mkdirSync(root, { recursive: true })
  mkdirSync(mfaRootDir, { recursive: true })
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
      createMfaEnvironment({ micromambaBin, rootPrefix, envPrefix, pythonVersion, mfaVersion })
      planned.actions.push('create-env')
    }
  } else {
    planned.actions.push(envExists(envPrefix) ? 'env-present' : 'env-not-created')
  }

  if (installMakeDiffSingerRequirements) {
    installPythonRequirements({ envPrefix, requirements: makeDiffSingerRequirements })
    planned.actions.push('install-makediffsinger-requirements')
  }

  planned.toolsAfter = detectTools(micromambaBin, envPrefix, mfaRootDir)
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

function createMfaEnvironment({ micromambaBin, rootPrefix, envPrefix, pythonVersion, mfaVersion }) {
  mkdirSync(dirname(envPrefix), { recursive: true })
  execFileSync(
    micromambaBin,
    [
      'create',
      '-y',
      '-p',
      envPrefix,
      '-r',
      rootPrefix,
      '-c',
      'conda-forge',
      `python=${pythonVersion}`,
      `montreal-forced-aligner=${mfaVersion}`,
    ],
    { stdio: 'inherit' },
  )
}

function installPythonRequirements({ envPrefix, requirements }) {
  if (!envExists(envPrefix)) {
    throw new Error(`Cannot install requirements before env exists: ${envPrefix}`)
  }
  if (!existsSync(requirements)) {
    throw new Error(`Missing requirements file: ${requirements}`)
  }
  execFileSync(join(envPrefix, 'bin', 'pip'), ['install', '-r', requirements], {
    env: { ...process.env, PATH: `${join(envPrefix, 'bin')}:${process.env.PATH ?? ''}` },
    stdio: 'inherit',
  })
}

function detectTools(micromambaBin, envPrefix, mfaRootDir, options = {}) {
  const envPath = join(envPrefix, 'bin')
  const env = envExists(envPrefix) ? { PATH: `${envPath}:${process.env.PATH ?? ''}`, MFA_ROOT_DIR: mfaRootDir } : undefined
  const mfaPath = join(envPrefix, 'bin', 'mfa')
  const allowMfaProbe = options.allowMfaProbe ?? true
  return {
    curl: commandVersion('curl', ['--version']),
    tar: commandVersion('tar', ['--version']),
    micromamba: micromambaExists(micromambaBin) ? commandVersion(micromambaBin, ['--version']) : missingTool(micromambaBin),
    envPython: envExists(envPrefix)
      ? commandVersion(join(envPrefix, 'bin', 'python'), ['--version'], env)
      : missingTool(join(envPrefix, 'bin', 'python')),
    envMfa: envExists(envPrefix)
      ? allowMfaProbe
        ? commandVersion(mfaPath, ['version'], env)
        : { ...missingTool(mfaPath), available: existsSync(mfaPath), note: 'Probe skipped to avoid creating MFA_ROOT_DIR in dry-run mode.' }
      : missingTool(mfaPath),
    makeDiffSingerRequirements: envExists(envPrefix)
      ? pythonImportCheck(envPrefix, ['Bio', 'click', 'librosa', 'matplotlib', 'praatio', 'parselmouth', 'yaml', 'soundfile', 'sox', 'sqlalchemy', 'textgrid'])
      : { available: false, missing: [] },
  }
}

function pythonImportCheck(envPrefix, modules) {
  const code = [
    'import importlib, json',
    `mods = ${JSON.stringify(modules)}`,
    'missing = []',
    'for mod in mods:',
    '    try:',
    '        importlib.import_module(mod)',
    '    except Exception as e:',
    '        missing.append({"module": mod, "error": str(e)})',
    'print(json.dumps({"available": len(missing) == 0, "missing": missing}))',
  ].join('\n')
  try {
    return JSON.parse(
      execFileSync(join(envPrefix, 'bin', 'python'), ['-c', code], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(envPrefix, 'bin')}:${process.env.PATH ?? ''}` },
      }),
    )
  } catch (error) {
    return {
      available: false,
      missing: [{ module: '(check failed)', error: error instanceof Error ? error.message : String(error) }],
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
    } else if (arg === '--mfa') {
      parsed.mfa = argv[++index]
    } else if (arg === '--install-micromamba') {
      parsed.installMicromamba = true
    } else if (arg === '--create-env') {
      parsed.createEnv = true
    } else if (arg === '--install-makediffsinger-reqs') {
      parsed.installMakeDiffSingerRequirements = true
    } else if (arg === '--makediffsinger-reqs') {
      parsed.makeDiffSingerRequirements = argv[++index]
    } else if (arg === '--mfa-root') {
      parsed.mfaRootDir = argv[++index]
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/setup-mfa-env.mjs [options]',
          '',
          'Options:',
          `  --root path              Local mamba root, default ${DEFAULT_ROOT}`,
          `  --env-name name          Env name, default ${DEFAULT_ENV_NAME}`,
          `  --python version         Python version, default ${DEFAULT_PYTHON}`,
          `  --mfa version            Montreal Forced Aligner version, default ${DEFAULT_MFA}`,
          `  --mfa-root path          MFA_ROOT_DIR for caches/temp files, default ${DEFAULT_MFA_ROOT_DIR}`,
          '  --install-micromamba     Download micromamba into the local root',
          '  --create-env             Create the MFA conda environment with micromamba',
          '  --install-makediffsinger-reqs',
          '                           Install MakeDiffSinger acoustic alignment Python requirements',
          '  --makediffsinger-reqs path',
          '                           Requirements file to install',
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

export function readMfaEnvManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function mfaEnvBasename(path) {
  return basename(path)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = setupMfaEnv(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
