#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_OUT_DIR = 'docs/screenshots'

export async function captureReadmeScreenshots(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const outDir = resolve(cwd, options.outDir ?? DEFAULT_OUT_DIR)
  mkdirSync(outDir, { recursive: true })

  const started = options.url
    ? { url: options.url, server: null }
    : await startViteServer({ cwd, host: options.host ?? DEFAULT_HOST, port: options.port })
  let browser = null
  try {
    browser = await chromium.launch({ headless: !options.headed })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    await page.goto(started.url, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS })
    await waitForAppReady(page)

    const desktopPath = join(outDir, 'webuta-desktop.jpg')
    await page.screenshot({ path: desktopPath, type: 'jpeg', quality: 88, fullPage: false })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByLabel('Touch performance keyboard').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.getByRole('button', { name: 'WAV 공유' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    await page.screenshot({ path: join(outDir, 'webuta-mobile.jpg'), type: 'jpeg', quality: 88, fullPage: false })

    return {
      desktopPath,
      mobilePath: join(outDir, 'webuta-mobile.jpg'),
    }
  } finally {
    if (browser) {
      await browser.close()
    }
    if (started.server) {
      started.server.kill('SIGTERM')
      await onceExit(started.server, 1500)
    }
  }
}

async function waitForAppReady(page) {
  await page.getByLabel('Current project').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText('WebUtau Korean V3 Synthetic').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText(/8\/8 matched/u).first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Voicebank lyric coverage').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Community release readiness').getByText('V3 자동 점검 통과').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
}

async function startViteServer({ cwd, host, port }) {
  const selectedPort = port ? Number(port) : await findFreePort()
  const viteBin = resolve(cwd, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) {
    throw new Error(`Missing Vite binary: ${viteBin}`)
  }
  const child = spawn(process.execPath, [viteBin, '--host', host, '--port', String(selectedPort), '--strictPort'], {
    cwd,
    env: {
      ...process.env,
      BROWSER: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out-dir') {
      options.outDir = argv[++index]
    } else if (arg === '--url') {
      options.url = argv[++index]
    } else if (arg === '--host') {
      options.host = argv[++index]
    } else if (arg === '--port') {
      options.port = argv[++index]
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node scripts/capture-readme-screenshots.mjs [options]',
          '',
          'Options:',
          `  --out-dir path  Output directory, default ${DEFAULT_OUT_DIR}`,
          '  --url url       Reuse an already running app URL',
          '  --host host     Vite host, default 127.0.0.1',
          '  --port port     Vite port; defaults to a free port',
          '  --headed        Show Chromium while capturing',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  captureReadmeScreenshots(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error))
      process.exit(1)
    })
}
