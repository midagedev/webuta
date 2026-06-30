#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neuralRequestToDiffSingerDs } from './diffsinger-ds-adapter.mjs'

const DEFAULT_WORK_DIR = 'experiments/neural-singer/work/local-neural-render'
const DEFAULT_DIFFSINGER_ROOT = '.local/neural-singer/openvpi/DiffSinger'
const DEFAULT_PYTHON = '.local/neural-singer/mamba/envs/webuta-diffsinger/bin/python'
const DEFAULT_EXP = 'experiments/neural-singer/work/csd-diffsinger-smoke/train-smoke'
const DEFAULT_CKPT = 1
const DEFAULT_VOCODER = 'checkpoints/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt'

export async function renderNeuralRequest(request, options = {}) {
  const startedAt = Date.now()
  const config = serviceConfig(options)
  if (!config.acceptLocalResearchLicense) {
    return errorResponse('license-not-accepted', 'Accept local research model and vocoder terms before rendering.')
  }

  const missing = missingRuntimePaths(config)
  if (missing.length > 0) {
    return errorResponse('model-missing', `Missing local neural runtime files: ${missing.join(', ')}`)
  }

  let ds
  try {
    ds = neuralRequestToDiffSingerDs(request)
  } catch (error) {
    return errorResponse(error.code ?? 'invalid-score', error instanceof Error ? error.message : String(error))
  }

  const requestDir = join(config.workDir, safeName(`${new Date().toISOString()}-${request.project?.id ?? 'project'}`))
  const outputDir = join(requestDir, 'outputs')
  const title = 'webuta-neural-render'
  const dsPath = join(requestDir, 'input.ds')
  const requestPath = join(requestDir, 'request.json')
  const diagnosticsPath = join(requestDir, 'diagnostics.json')
  const wavPath = join(outputDir, `${title}.wav`)
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`)
  writeFileSync(dsPath, `${JSON.stringify(ds.segments, null, 2)}\n`)

  try {
    await runDiffSingerInference({ ...config, dsPath, outputDir, title })
  } catch (error) {
    return errorResponse(
      renderErrorCode(error),
      error instanceof Error ? error.message : String(error),
      { artifacts: { requestPath, dsPath } },
    )
  }

  if (!existsSync(wavPath)) {
    return errorResponse('internal-render-error', `DiffSinger did not create expected WAV: ${wavPath}`, {
      artifacts: { requestPath, dsPath },
    })
  }

  const wav = readWavDiagnostics(wavPath)
  const response = {
    version: 1,
    ok: true,
    audio: {
      contentType: 'audio/wav',
      sampleRate: wav.sampleRate,
      durationSeconds: wav.durationSeconds,
      fileName: `${safeName(request.project?.title ?? 'webuta-neural-render')}.wav`,
      wavBase64: readFileSync(wavPath).toString('base64'),
    },
    diagnostics: {
      renderer: 'diffsinger',
      modelId: request.voice?.id ?? 'unknown',
      renderSeconds: (Date.now() - startedAt) / 1000,
      warnings: ds.diagnostics.warnings,
      artifacts: {
        requestPath,
        dsPath,
        wavPath,
      },
      wav,
    },
  }
  writeFileSync(diagnosticsPath, `${JSON.stringify(response.diagnostics, null, 2)}\n`)
  return response
}

export function createNeuralRenderHttpServer(options = {}) {
  return createServer(async (req, res) => {
    writeCorsHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'GET' && req.url === '/health') {
      const config = serviceConfig(options)
      const missing = missingRuntimePaths(config)
      writeJson(res, 200, {
        version: 1,
        ok: true,
        licenseAccepted: config.acceptLocalResearchLicense,
        missingRuntimePaths: missing,
        model: serviceModelCard(config, missing),
      })
      return
    }
    if (req.method !== 'POST' || req.url !== '/render') {
      writeJson(res, 404, errorResponse('server-unavailable', 'Unknown local neural render endpoint.'))
      return
    }

    try {
      const abortController = new AbortController()
      req.on('aborted', () => abortController.abort())
      res.on('close', () => {
        if (!res.writableEnded) {
          abortController.abort()
        }
      })
      const body = await readJsonBody(req, options.maxBodyBytes ?? 2_000_000)
      const result = await renderNeuralRequest(body, { ...options, signal: abortController.signal })
      writeJson(res, result.ok ? 200 : 400, result)
    } catch (error) {
      writeJson(res, 400, errorResponse('invalid-score', error instanceof Error ? error.message : String(error)))
    }
  })
}

async function runDiffSingerInference(config) {
  throwIfAborted(config.signal)
  if (config.runner) {
    await config.runner(config)
    throwIfAborted(config.signal)
    return
  }
  await new Promise((resolvePromise, reject) => {
    let settled = false
    const child = execFile(
      config.python,
      [
      'scripts/infer.py',
      'acoustic',
      config.dsPath,
      '--exp',
      config.exp,
      '--ckpt',
      String(config.ckpt),
      '--out',
      config.outputDir,
      '--title',
      config.title,
      '--num',
      '1',
      '--steps',
      String(config.steps),
    ],
      {
        cwd: config.diffSingerRoot,
        encoding: 'utf8',
        timeout: config.timeoutMs,
      },
      (error) => {
        if (settled) {
          return
        }
        settled = true
        config.signal?.removeEventListener('abort', abort)
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      },
    )
    const abort = () => {
      if (settled) {
        return
      }
      settled = true
      child.kill('SIGTERM')
      reject(abortError())
    }
    config.signal?.addEventListener('abort', abort, { once: true })
  })
}

function serviceConfig(options) {
  const diffSingerRoot = resolve(options.diffSingerRoot ?? DEFAULT_DIFFSINGER_ROOT)
  return {
    workDir: resolve(options.workDir ?? DEFAULT_WORK_DIR),
    diffSingerRoot,
    python: resolve(options.python ?? DEFAULT_PYTHON),
    exp: resolve(options.exp ?? DEFAULT_EXP),
    ckpt: Number(options.ckpt ?? DEFAULT_CKPT),
    steps: Number(options.steps ?? 5),
    timeoutMs: Number(options.timeoutMs ?? 120_000),
    vocoderPath: resolve(diffSingerRoot, options.vocoder ?? DEFAULT_VOCODER),
    modelManifest: options.modelManifest ? resolve(options.modelManifest) : null,
    acceptLocalResearchLicense: options.acceptLocalResearchLicense === true,
    runner: options.runner,
    signal: options.signal,
  }
}

function missingRuntimePaths(config) {
  return [
    ['python', config.python],
    ['DiffSinger infer.py', join(config.diffSingerRoot, 'scripts', 'infer.py')],
    ['experiment checkpoint directory', config.exp],
    [`checkpoint step ${config.ckpt}`, join(config.exp, `model_ckpt_steps_${config.ckpt}.ckpt`)],
    ['vocoder checkpoint', config.vocoderPath],
  ]
    .filter(([, path]) => !existsSync(path))
    .map(([label, path]) => `${label} (${path})`)
}

function serviceModelCard(config, missingRuntimePaths) {
  const manifest = config.modelManifest ? readOptionalJson(config.modelManifest) : null
  const model = manifest?.model ?? {
    id: 'webuta-ko-diffsinger-smoke',
    name: 'WebUtau KO DiffSinger Smoke',
    releaseStatus: 'local-research',
  }
  const terms = manifest?.terms ?? {}
  const datasetIds = Array.isArray(manifest?.datasetIds) ? manifest.datasetIds : []
  const checkpointStep = Number(manifest?.runtime?.ckpt ?? config.ckpt)
  const status = config.acceptLocalResearchLicense && missingRuntimePaths.length === 0 ? 'ready' : 'blocked'
  const blockers = [
    ...(config.acceptLocalResearchLicense ? [] : ['license not accepted']),
    ...missingRuntimePaths,
  ]
  return {
    id: stringOr(model.id, 'webuta-ko-diffsinger-smoke'),
    name: stringOr(model.name, 'WebUtau KO DiffSinger Smoke'),
    rendererId: 'local-neural',
    language: stringOr(manifest?.language, 'ko'),
    status,
    releaseStatus: normalizeReleaseStatus(model.releaseStatus),
    licenseSummary: stringOr(
      terms.licenseSummary,
      'Local DiffSinger model and vocoder artifacts stay local until dataset/model terms are reviewed.',
    ),
    usageNote:
      status === 'ready'
        ? `Local DiffSinger checkpoint ${checkpointStep} is available${datasetIds.length ? ` for ${datasetIds.join(', ')}` : ''}.`
        : `Local neural model is blocked: ${blockers.join('; ') || 'runtime unavailable'}.`,
  }
}

function readWavDiagnostics(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Invalid WAV output: ${path}`)
  }
  let offset = 12
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === 'fmt ') {
      channels = buffer.readUInt16LE(chunkStart + 2)
      sampleRate = buffer.readUInt32LE(chunkStart + 4)
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14)
    }
    if (chunkId === 'data') {
      dataBytes = chunkSize
      break
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationSeconds: sampleRate > 0 && channels > 0 && bitsPerSample > 0 ? dataBytes / (sampleRate * channels * (bitsPerSample / 8)) : 0,
  }
}

function errorResponse(code, message, diagnostics = undefined) {
  return {
    version: 1,
    ok: false,
    error: { code, message },
    ...(diagnostics ? { diagnostics } : {}),
  }
}

function readOptionalJson(path) {
  if (!path || !existsSync(path)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function normalizeReleaseStatus(value) {
  return ['bundled', 'local-research', 'private-lab', 'public-beta', 'planned', 'user-provided'].includes(value)
    ? value
    : 'local-research'
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function renderErrorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined
  if (code === 'render-timeout' || code === 'invalid-phoneme' || code === 'invalid-score') {
    return code
  }
  if (code === 'ABORT_ERR' || error?.name === 'AbortError') {
    return 'render-cancelled'
  }
  if (code === 'ETIMEDOUT') {
    return 'render-timeout'
  }
  return 'internal-render-error'
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw abortError()
  }
}

function abortError() {
  return Object.assign(new Error('Neural render cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' })
}

function writeCorsHeaders(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
}

function writeJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(value, null, 2)}\n`)
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        fail(new Error('Request body too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) {
        return
      }
      try {
        settled = true
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        fail(new Error('Request body must be JSON.'))
      }
    })
    req.on('aborted', () => fail(abortError()))
    req.on('error', fail)
  })
}

function safeName(value) {
  return String(value)
    .trim()
    .replace(/[^\w.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'webuta-neural-render'
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--host') {
      parsed.host = argv[++index]
    } else if (arg === '--port') {
      parsed.port = Number(argv[++index])
    } else if (arg === '--work-dir') {
      parsed.workDir = argv[++index]
    } else if (arg === '--diffsinger-root') {
      parsed.diffSingerRoot = argv[++index]
    } else if (arg === '--python') {
      parsed.python = argv[++index]
    } else if (arg === '--exp') {
      parsed.exp = argv[++index]
    } else if (arg === '--ckpt') {
      parsed.ckpt = Number(argv[++index])
    } else if (arg === '--model-manifest') {
      parsed.modelManifest = argv[++index]
    } else if (arg === '--vocoder') {
      parsed.vocoder = argv[++index]
    } else if (arg === '--steps') {
      parsed.steps = Number(argv[++index])
    } else if (arg === '--accept-local-research-license') {
      parsed.acceptLocalResearchLicense = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/neural-render-service.mjs [options]',
          '',
          'Options:',
          '  --host address                       Bind address, default 127.0.0.1',
          '  --port port                          Bind port, default 8787',
          '  --accept-local-research-license      Required before rendering local research models/vocoders',
          '  --work-dir path                      Ignored request/output workspace',
          '  --diffsinger-root path               Local DiffSinger checkout',
          '  --python path                        Python executable for DiffSinger env',
          '  --exp path                           DiffSinger experiment checkpoint directory',
          '  --ckpt steps                         Checkpoint step, default 1',
          '  --model-manifest path                Optional checkpoint manifest for /health model metadata',
          '  --vocoder path                       Vocoder checkpoint path relative to DiffSinger root or absolute',
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const host = options.host ?? '127.0.0.1'
    const port = options.port ?? 8787
    mkdirSync(dirname(resolve(options.workDir ?? DEFAULT_WORK_DIR)), { recursive: true })
    createNeuralRenderHttpServer(options).listen(port, host, () => {
      process.stdout.write(`WebUtau neural render service listening on http://${host}:${port}/render\n`)
    })
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
