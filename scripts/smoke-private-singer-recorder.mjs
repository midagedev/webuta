#!/usr/bin/env node

import { createServer as createNetServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preparePrivateSingerRecordingPack } from './prepare-private-singer-recording-pack.mjs'
import { preparePrivateSingerGuideTracks } from './prepare-private-singer-guide-tracks.mjs'
import { createPrivateSingerRecorderServer } from './serve-private-singer-recorder.mjs'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_TIMEOUT_MS = 45_000

export async function smokePrivateSingerRecorder(options = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'webuta-recorder-smoke-'))
  let server = null
  let browser = null
  try {
    const usesExternalPack = Boolean(options.packDir)
    const packDir = usesExternalPack ? resolve(options.packDir) : join(tempRoot, 'pack')
    const setup = usesExternalPack ? null : prepareSmokePack({ tempRoot, packDir })
    const port = options.port ? Number(options.port) : await findFreePort()
    const recorderServer = createPrivateSingerRecorderServer({ packDir })
    await listen(recorderServer, port, options.host ?? DEFAULT_HOST)
    server = recorderServer
    const url = `http://${options.host ?? DEFAULT_HOST}:${port}/`

    browser = await chromium.launch({ headless: !options.headed })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
    })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS })
    await page.getByRole('heading', { name: 'WebUtau Recording Companion' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })

    const sessionBefore = await fetchJson(`${url}api/session`)
    if (!sessionBefore.totals?.takeCount) {
      throw new Error('Recorder session has no takes.')
    }
    if (sessionBefore.totals.guideCount < 1) {
      throw new Error('Recorder session has no guide WAVs. Run npm run experimental:neural:prepare-guides first.')
    }

    const desktop = await inspectRecorderPage(page)
    assertPageState(desktop, 'desktop-initial')
    await assertVisibleButtonsAreLabelled(page, 'desktop-initial')

    let upload = null
    if (!usesExternalPack || options.writeSynthetic) {
      const takeId = sessionBefore.takes[0].id
      upload = await uploadSyntheticWavFromBrowser(page, takeId)
      if (!upload.ok || upload.takeId !== takeId) {
        throw new Error(`Synthetic recorder upload failed: ${JSON.stringify(upload)}`)
      }
      await page.reload({ waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS })
      await page.getByText('WAV', { exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT_MS })
    await page.getByRole('heading', { name: 'WebUtau Recording Companion' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
    const mobile = await inspectRecorderPage(page)
    assertPageState(mobile, 'mobile')
    await assertVisibleButtonsAreLabelled(page, 'mobile')

    const sessionAfter = await fetchJson(`${url}api/session`)
    const report = {
      ok: true,
      mode: usesExternalPack ? 'external-pack' : 'temp-pack',
      url,
      packDir,
      generatedPack: setup,
      session: {
        sessionId: sessionAfter.sessionId,
        takeCount: sessionAfter.totals.takeCount,
        guideCount: sessionAfter.totals.guideCount,
        recordedCount: sessionAfter.totals.recordedCount,
      },
      firstTake: {
        id: sessionAfter.takes[0].id,
        lyric: sessionAfter.takes[0].lyric,
        guideExists: sessionAfter.takes[0].guide.exists,
        recordedExists: sessionAfter.takes[0].recorded.exists,
      },
      syntheticUpload: upload
        ? {
            takeId: upload.takeId,
            sampleRate: upload.wav.sampleRate,
            channels: upload.wav.channels,
            bitsPerSample: upload.wav.bitsPerSample,
            durationSeconds: upload.wav.durationSeconds,
          }
        : null,
      checks: [
        'recorder page loaded',
        'session API returned takes',
        'guide WAV available',
        'visible buttons labelled',
        'desktop no page horizontal overflow',
        upload ? 'browser synthetic WAV upload saved' : 'read-only pack check',
        'mobile recorder controls visible',
        'mobile no page horizontal overflow',
      ],
      page: {
        desktop,
        mobile,
      },
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
      await closeServer(server)
    }
    if (!options.keepTemp) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }
}

function prepareSmokePack({ tempRoot, packDir }) {
  preparePrivateSingerRecordingPack({
    out: packDir,
    registryOut: join(tempRoot, 'registry.json'),
    targetMinutes: 0.15,
    sessionId: 'smoke-001',
    singerId: 'smoke-singer',
  })
  const session = JSON.parse(readFileSync(join(packDir, 'recording-session.json'), 'utf8'))
  const firstTake = session.takes[0]
  const guide = preparePrivateSingerGuideTracks({
    packDir,
    takes: firstTake.id,
    countInBeats: 2,
    sampleRate: 22050,
  })
  return {
    takeCount: session.takes.length,
    firstTakeId: firstTake.id,
    guideCount: guide.totals.takeCount,
  }
}

async function inspectRecorderPage(page) {
  return page.evaluate(() => {
    const list = document.querySelector('#takeList')
    const audio = document.querySelector('#guideAudio')
    const recordButton = document.querySelector('#recordButton')
    const stopButton = document.querySelector('#stopButton')
    return {
      title: document.title,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 2,
      listClientWidth: list?.clientWidth ?? null,
      listScrollWidth: list?.scrollWidth ?? null,
      sessionMeta: document.querySelector('#sessionMeta')?.textContent?.trim() ?? '',
      takeCountText: document.querySelector('#takeCount')?.textContent?.trim() ?? '',
      lyric: document.querySelector('#lyric')?.textContent?.trim() ?? '',
      audioSrc: audio?.getAttribute('src') ?? '',
      recordVisible: Boolean(recordButton && getComputedStyle(recordButton).display !== 'none'),
      stopDisabled: Boolean(stopButton?.disabled),
    }
  })
}

function assertPageState(state, label) {
  if (state.title !== 'WebUtau Recording Companion') {
    throw new Error(`${label}: unexpected title ${state.title}`)
  }
  if (state.horizontalOverflow) {
    throw new Error(`${label}: page has horizontal overflow (${JSON.stringify(state)})`)
  }
  if (!state.lyric) {
    throw new Error(`${label}: missing current lyric`)
  }
  if (!state.audioSrc.endsWith('.guide.wav')) {
    throw new Error(`${label}: guide audio is not selected (${state.audioSrc})`)
  }
  if (!state.recordVisible || !state.stopDisabled) {
    throw new Error(`${label}: recorder controls are not in the expected idle state`)
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

async function uploadSyntheticWavFromBrowser(page, takeId) {
  const bytes = [...makeSineWav({ sampleRate: 16000, seconds: 0.5, hz: 440 })]
  return page.evaluate(
    async ({ id, wavBytes }) => {
      const response = await fetch(`/api/takes/${encodeURIComponent(id)}/wav`, {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: new Uint8Array(wavBytes),
      })
      return response.json()
    },
    { id: takeId, wavBytes: bytes },
  )
}

function makeSineWav({ sampleRate, seconds, hz }) {
  const sampleCount = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(sampleCount * 2)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * hz) * 0.5
    data.writeInt16LE(Math.round(sample * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`)
  }
  return response.json()
}

function findFreePort() {
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

function listen(server, port, host) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolveListen()
    })
  })
}

function closeServer(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolveClose()
      }
    })
  })
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pack-dir') {
      options.packDir = argv[++index]
    } else if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--host') {
      options.host = argv[++index]
    } else if (arg === '--port') {
      options.port = Number(argv[++index])
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--write-synthetic') {
      options.writeSynthetic = true
    } else if (arg === '--keep-temp') {
      options.keepTemp = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/smoke-private-singer-recorder.mjs [options]',
          '',
          'Options:',
          '  --pack-dir path       Check an existing recording pack instead of a temp smoke pack',
          '  --write-synthetic     With --pack-dir, write a synthetic WAV to the first take',
          '  --out path            Write JSON smoke report to path',
          '  --host address        Bind address, default 127.0.0.1',
          '  --port port           Bind port for the temporary recorder server',
          '  --headed              Run Chromium with a visible window',
          '  --keep-temp           Keep the generated temp pack for inspection',
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await smokePrivateSingerRecorder(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
