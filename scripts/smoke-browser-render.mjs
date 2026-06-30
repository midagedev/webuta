#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_TIMEOUT_MS = 45_000

export async function smokeBrowserRender(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const tempRoot = mkdtempSync(join(tmpdir(), 'webuta-browser-smoke-'))
  let server = null
  let fakeNeuralServer = null
  let browser = null
  try {
    let neuralEndpoint = options.neuralEndpoint
    if (options.fakeNeuralService) {
      const fake = await startFakeNeuralService()
      fakeNeuralServer = fake.server
      neuralEndpoint = fake.endpoint
    }
    const neuralMode = Boolean(neuralEndpoint)
    const url = options.url ?? (await startViteServer({ cwd, host: options.host ?? DEFAULT_HOST, port: options.port, neuralEndpoint }))
    server = typeof url === 'string' ? null : url.server
    const baseUrl = typeof url === 'string' ? url : url.url
    browser = await chromium.launch({ headless: !options.headed })
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 860 },
    })
    const page = await context.newPage()
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS })
    await page.getByLabel('Current project').waitFor({ timeout: DEFAULT_TIMEOUT_MS })

    await assertNoPageHorizontalOverflow(page, 'desktop-initial')
    await assertPianoRollReadable(page, 'desktop-initial')
    await assertVisibleButtonsAreLabelled(page, 'desktop-initial')
    if (neuralMode) {
      await selectLocalNeuralModel(page)
    } else {
      await assertLocalNeuralBlockedWhenStatic(page)
    }
    const defaultV3Checks = options.requireDefaultV3 ? await assertDefaultV3DemoReady(page) : []
    await page.getByText('WAV not rendered yet').waitFor({ timeout: DEFAULT_TIMEOUT_MS })

    const downloadPromise = page.waitForEvent('download', { timeout: DEFAULT_TIMEOUT_MS })
    await page.getByRole('button', { name: '하단 WAV 다운로드' }).click()
    const download = await downloadPromise
    const savedDownload = join(tempRoot, download.suggestedFilename())
    await download.saveAs(savedDownload)

    const wav = inspectPcmWav(savedDownload)
    if (wav.sampleRate !== 44100 || wav.channels !== 1 || wav.bitsPerSample !== 16 || wav.durationSeconds < 2) {
      throw new Error(
        `Unexpected WAV export: ${JSON.stringify({
          sampleRate: wav.sampleRate,
          channels: wav.channels,
          bitsPerSample: wav.bitsPerSample,
          durationSeconds: wav.durationSeconds,
        })}`,
      )
    }

    await page.getByText('WAV downloaded', { exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.getByRole('region', { name: 'Render history' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.getByText('DAW-ready WAV · 44.1 kHz PCM mono', { exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    if (neuralMode) {
      await page.waitForFunction(
        () => [...document.querySelectorAll('.render-history-row')].some((element) => element.textContent?.includes('Local Neural DiffSinger')),
        undefined,
        { timeout: DEFAULT_TIMEOUT_MS },
      )
    }
    await assertNoPageHorizontalOverflow(page, 'desktop-after-render')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'WAV 공유' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.getByRole('button', { name: '하단 WAV 다운로드' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.getByLabel('Touch performance keyboard').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await assertPianoRollReadable(page, 'mobile-after-render')
    await assertNoPageHorizontalOverflow(page, 'mobile-after-render')
    await assertVisibleButtonsAreLabelled(page, 'mobile-after-render')

    const report = {
      ok: true,
      mode: neuralMode ? 'local-neural' : 'static',
      url: baseUrl,
      neuralEndpoint: neuralMode ? neuralEndpoint : null,
      download: {
        fileName: download.suggestedFilename(),
        wav,
      },
      checks: [
        'desktop app loaded',
        neuralMode ? 'local neural service model selected' : 'local neural model blocked without endpoint',
        ...defaultV3Checks,
        'visible buttons labelled',
        neuralMode ? 'desktop neural WAV download' : 'desktop WAV download',
        'render history visible',
        'desktop no page horizontal overflow',
        'desktop piano keyboard and bar ruler visible',
        'mobile export controls visible',
        'mobile touch keyboard visible',
        'mobile piano keyboard and bar ruler visible',
        'mobile no page horizontal overflow',
      ],
    }
    if (options.out) {
      writeJson(resolve(options.out), report)
    }
    return report
  } finally {
    if (browser) {
      await browser.close()
    }
    if (server) {
      server.kill('SIGTERM')
      await onceExit(server, 1500)
    }
    if (fakeNeuralServer) {
      await closeServer(fakeNeuralServer)
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

async function startViteServer({ cwd, host, port, neuralEndpoint }) {
  const selectedPort = port ? Number(port) : await findFreePort()
  const viteBin = resolve(cwd, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) {
    throw new Error(`Missing Vite binary: ${viteBin}`)
  }
  const child = spawn(
    process.execPath,
    [viteBin, '--host', host, '--port', String(selectedPort), '--strictPort'],
    {
      cwd,
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_WEBUTA_NEURAL_ENDPOINT: neuralEndpoint ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const logs = []
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))
  const url = `http://${host}:${selectedPort}/`
  await waitForHttp(url, child, logs)
  return { url, server: child }
}

async function waitForHttp(url, child, logs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < DEFAULT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before serving ${url}\n${logs.join('')}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Keep polling while Vite boots.
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${url}\n${logs.join('')}`)
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, DEFAULT_HOST, () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local port.'))
          return
        }
        resolvePort(address.port)
      })
    })
  })
}

async function startFakeNeuralService() {
  const server = createHttpServer(async (req, res) => {
    writeCorsHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'GET' && req.url === '/health') {
      writeJsonResponse(res, 200, {
        version: 1,
        ok: true,
        licenseAccepted: true,
        missingRuntimePaths: [],
        model: {
          id: 'webuta-ko-browser-smoke',
          name: 'WebUtau KO Browser Smoke Model',
          rendererId: 'local-neural',
          language: 'ko',
          status: 'ready',
          releaseStatus: 'local-research',
          licenseSummary: 'Fake browser smoke model; not release evidence.',
          usageNote: 'Fake neural endpoint is ready for UI integration smoke.',
        },
        fake: true,
      })
      return
    }
    if (req.method !== 'POST' || req.url !== '/render') {
      writeJsonResponse(res, 404, {
        version: 1,
        ok: false,
        error: {
          code: 'server-unavailable',
          message: 'Unknown fake neural endpoint.',
        },
      })
      return
    }
    const request = await readJsonRequest(req)
    const wavBase64 = encodePcm16WavBase64(fakeNeuralSamples(44100 * 3), 44100)
    writeJsonResponse(res, 200, {
      version: 1,
      ok: true,
      audio: {
        contentType: 'audio/wav',
        sampleRate: 44100,
        durationSeconds: 3,
        fileName: `${safeName(request?.project?.title ?? 'webuta-neural-render')}.wav`,
        wavBase64,
      },
      diagnostics: {
        renderer: 'fake-diffsinger',
        modelId: request?.voice?.id ?? 'webuta-ko-neural-dev',
        renderSeconds: 0.02,
        warnings: ['Fake neural browser smoke service; not an audio quality proof.'],
        artifacts: {},
      },
    })
  })
  await new Promise((resolveListen) => server.listen(0, DEFAULT_HOST, resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Unable to start fake neural service.')
  }
  return {
    server,
    endpoint: `http://${DEFAULT_HOST}:${address.port}/render`,
  }
}

async function assertNoPageHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
  }))
  const overflow = Math.max(result.documentScroll, result.bodyScroll) - result.viewport
  if (overflow > 2) {
    throw new Error(`${label}: page has ${overflow}px horizontal overflow (${JSON.stringify(result)})`)
  }
}

async function assertVisibleButtonsAreLabelled(page, label) {
  const unlabeled = await page.evaluate(() => {
    function isVisible(element) {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    return [...document.querySelectorAll('button')]
      .filter(isVisible)
      .map((button) => ({
        text: button.textContent?.trim() ?? '',
        aria: button.getAttribute('aria-label') ?? '',
        title: button.getAttribute('title') ?? '',
        className: button.className,
      }))
      .filter((button) => !button.text && !button.aria && !button.title)
  })
  if (unlabeled.length > 0) {
    throw new Error(`${label}: visible buttons without text, aria-label, or title: ${JSON.stringify(unlabeled)}`)
  }
}

async function assertPianoRollReadable(page, label) {
  const result = await page.evaluate(() => {
    function visibleTexts(selector) {
      return [...document.querySelectorAll(selector)]
        .filter((element) => {
          const style = window.getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width >= 8 && rect.height >= 8
        })
        .map((element) => element.textContent?.trim() ?? '')
        .filter(Boolean)
    }
    const rollGrid = document.querySelector('.roll-grid')?.getBoundingClientRect()
    return {
      keyLabels: visibleTexts('.keyboard .key-label'),
      barLabels: visibleTexts('.roll-bar-label'),
      rollGrid: rollGrid ? { width: rollGrid.width, height: rollGrid.height } : null,
    }
  })
  if (!result.rollGrid || result.rollGrid.width < 240 || result.rollGrid.height < 160) {
    throw new Error(`${label}: piano roll grid is not readable (${JSON.stringify(result)})`)
  }
  if (result.keyLabels.length < 6) {
    throw new Error(`${label}: expected visible piano key labels (${JSON.stringify(result)})`)
  }
  if (result.barLabels.length < 2) {
    throw new Error(`${label}: expected visible beat/bar ruler labels (${JSON.stringify(result)})`)
  }
}

async function assertLocalNeuralBlockedWhenStatic(page) {
  const model = page.getByRole('button', { name: /WebUtau KO DiffSinger Smoke/u })
  await model.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  if (!(await model.isDisabled())) {
    throw new Error('Expected local DiffSinger smoke model to be disabled when no neural endpoint is configured.')
  }
  await page.getByText('Local neural endpoint is not configured.').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
}

async function selectLocalNeuralModel(page) {
  const model = page.getByRole('button', {
    name: /WebUtau KO (Browser Smoke Model|GTSinger Full Research Smoke|GTSinger Research Ramp 6000|GTSinger Research Ramp 3000|GTSinger Research Ramp 1000|GTSinger Research Ramp 100|DiffSinger Smoke)/u,
  })
  await model.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  if (await model.isDisabled()) {
    throw new Error('Expected local neural service model to be enabled when a neural endpoint is configured.')
  }
  await page
    .getByText(/Fake browser smoke model|GTSinger is CC BY-NC-SA 4\.0|Local neural companion is configured/u)
    .waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await model.click()
  await page.waitForFunction(
    () => [...document.querySelectorAll('.tracker-strip strong')].some((element) => element.textContent?.trim() === 'NEURAL'),
    undefined,
    { timeout: DEFAULT_TIMEOUT_MS },
  )
}

async function assertDefaultV3DemoReady(page) {
  await page.getByText('WebUtau Korean V3 Synthetic').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText(/8\/8 matched/u).first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText('렌더 경고 없음').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Community release readiness').getByText('V3 자동 점검 통과').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Community release readiness').getByText('listening-scores.local.json 필요').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Voicebank license metadata').getByText('번들 V3 라이선스 포함').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Voicebank license metadata').getByText(/Generated original sample data/u).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Selected note vibrato').getByText('비브라토').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '선택 노트 UTAU 샘플 미리듣기' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const reviewLink = page.getByRole('link', { name: '청취 리뷰 열기' })
  await reviewLink.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const reviewHref = await reviewLink.getAttribute('href')
  if (!reviewHref?.includes('/review/v3/index.html')) {
    throw new Error(`Unexpected listening review href: ${reviewHref ?? 'missing'}`)
  }
  await page.waitForFunction(
    () => {
      const input = document.querySelector('[aria-label="가사 라인"]')
      const value = input && 'value' in input ? String(input.value) : ''
      return value.replace(/\s+/gu, '') === '도히도히다이스키'
    },
    undefined,
    { timeout: DEFAULT_TIMEOUT_MS },
  )
  return [
    'default V3 voicebank loaded',
    'first-run demo aliases fully matched',
    'first-run demo render warnings clear',
    'first-run lyric visible',
    'community release readiness card visible',
    'voicebank license metadata visible',
    'selected-note vibrato controls visible',
    'community listening review scorecard linked',
    'selected-note UTAU sample preview available',
  ]
}

function inspectPcmWav(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Downloaded file is not a RIFF/WAVE file: ${path}`)
  }
  let offset = 12
  let fmt = null
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    } else if (chunkId === 'data') {
      dataBytes = chunkSize
      break
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  if (!fmt || fmt.audioFormat !== 1 || dataBytes <= 0) {
    throw new Error(`Downloaded WAV is not supported PCM: ${path}`)
  }
  const bytesPerFrame = fmt.channels * (fmt.bitsPerSample / 8)
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    durationSeconds: dataBytes / bytesPerFrame / fmt.sampleRate,
    bytes: buffer.length,
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') {
      options.url = argv[++index]
    } else if (arg === '--neural-endpoint') {
      options.neuralEndpoint = argv[++index]
    } else if (arg === '--fake-neural-service') {
      options.fakeNeuralService = true
    } else if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--port') {
      options.port = Number(argv[++index])
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--require-default-v3') {
      options.requireDefaultV3 = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/smoke-browser-render.mjs [options]',
          '',
          'Options:',
          '  --url url     Use an already-running WebUtau URL instead of starting Vite',
          '  --neural-endpoint url  Enable the local neural UI path with this endpoint',
          '  --fake-neural-service  Start a tiny fake neural endpoint for browser integration smoke',
          '  --out path    Write JSON smoke report to path',
          '  --port n      Port for the temporary Vite server',
          '  --headed      Run Chromium with a visible window',
          '  --require-default-v3  Assert bundled V3 voicebank, demo coverage, and render warnings',
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeCorsHeaders(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
}

function writeJsonResponse(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(`${JSON.stringify(value)}\n`)
}

async function readJsonRequest(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : null
}

function fakeNeuralSamples(sampleCount) {
  const samples = new Float32Array(sampleCount)
  for (let index = 0; index < sampleCount; index += 1) {
    const seconds = index / 44100
    const envelope = Math.min(1, seconds / 0.08, (sampleCount - index) / 44100 / 0.12)
    samples[index] = Math.sin(seconds * Math.PI * 2 * 261.625565) * 0.16 * Math.max(0, envelope)
  }
  return samples
}

function encodePcm16WavBase64(samples, sampleRate) {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2)
  }
  return buffer.toString('base64')
}

function safeName(value) {
  return String(value)
    .trim()
    .replace(/[^a-z0-9가-힣._-]+/giu, '-')
    .replace(/^-+|-+$/gu, '') || 'webuta-neural-render'
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function onceExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return
  }
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(timeoutMs).then(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    }),
  ])
}

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(resolveClose))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await smokeBrowserRender(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
