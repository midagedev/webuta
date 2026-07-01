#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
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
    const dawBundle = await downloadAndInspectDawBundle(page, tempRoot)
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
      dawBundle,
      checks: [
        'desktop app loaded',
        neuralMode ? 'local neural service model selected' : 'local neural model blocked without endpoint',
        ...defaultV3Checks,
        'visible buttons labelled',
        neuralMode ? 'desktop neural WAV download' : 'desktop WAV download',
        'desktop DAW handoff bundle download',
        'desktop DAW handoff bundle MIDI guides',
        'render history visible',
        'desktop no page horizontal overflow',
        'desktop piano keyboard and bar ruler visible',
        'desktop arrangement chord guide visible',
        'mobile export controls visible',
        'mobile touch keyboard visible',
        'mobile piano keyboard and bar ruler visible',
        'mobile arrangement chord guide visible',
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
      chordLabels: visibleTexts('.chord-marker strong'),
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
  for (const chord of ['C', 'G', 'Am', 'F']) {
    if (!result.chordLabels.includes(chord)) {
      throw new Error(`${label}: expected visible arrangement chord marker ${chord} (${JSON.stringify(result)})`)
    }
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
  const starterGuide = page.getByLabel('First run guide')
  await starterGuide.getByText('처음 시작').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterGuide.getByText('First Vocal Sketch').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterGuide.getByText('듣기 · 가사 · WAV').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const beginnerStartPanel = page.getByLabel('Beginner start panel')
  await beginnerStartPanel.getByText('처음이면 여기부터').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerStartPanel.getByText('기본 샘플 준비 완료').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerStartPanel.getByLabel('첫 사용 순서').getByText('1 듣기').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerStartPanel.getByLabel('Recommended starter action').getByText('01 샘플 듣기').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const topLyricEditor = beginnerStartPanel.getByLabel('Top starter lyric editor')
  await topLyricEditor.getByText('가사 입력').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await topLyricEditor.getByLabel('빠른 가사 입력').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await topLyricEditor.getByRole('button', { name: '빠른 가사 적용' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await topLyricEditor.getByText('현재 도 히 도 히 다 이 스 키').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerStartPanel.getByRole('button', { name: '초보자 첫 버튼' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerStartPanel.getByRole('button', { name: '새 프로젝트 만들기' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const koreanModePath = page.getByLabel('Starter Korean mode path')
  await koreanModePath.getByText('한국어 UTAU 모드').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await koreanModePath.getByText('한글을 쓰면 발음 alias로 바로 연결').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await koreanModePath.getByLabel('Korean mode quick route').getByText('한글 입력').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await koreanModePath.getByLabel('Korean mode quick route').getByText(/alias/u).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await koreanModePath.getByLabel('Korean mode quick route').getByText(/렌더하면 WAV|WAV 준비됨/u).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('First run one-minute path').getByText('처음 1분 가이드').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('First run one-minute path').getByText('먼저 샘플을 들어봐요').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('First run one-minute path').getByText('노란색 단계만 따라가면 첫 WAV까지 갈 수 있어요.').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Starter hook chord guide').getByText('C -> G -> Am -> F').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const contextDrawer = page.getByLabel('Starter context drawer')
  await contextDrawer.getByText('현재 프로젝트').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await contextDrawer.locator('summary').click()
  const onboardingCoach = contextDrawer.getByLabel('Starter onboarding coach')
  await onboardingCoach.getByText('현재 열린 프로젝트').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await onboardingCoach.getByText('First Vocal Sketch').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await onboardingCoach.getByText('샘플 가사').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await onboardingCoach.getByText('도 히 도 히 다 이 스 키').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await onboardingCoach.getByText('다음 버튼').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Starter readiness snapshot').getByText(/바로 시작 가능|보컬 로딩 중/u).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Starter launch panel').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const starterRouteSummary = page.getByLabel('Starter route summary')
  await starterRouteSummary.getByRole('button', { name: '첫 단계 샘플 듣기' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterRouteSummary.getByRole('button', { name: '둘째 단계 가사 바꾸기' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterRouteSummary.getByRole('button', { name: '셋째 단계 WAV 받기' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterRouteSummary.getByText('01').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterRouteSummary.getByText('02').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterRouteSummary.getByText('03').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterRouteSummary.getByText('지금').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterRouteSummary.getByText('다음').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const beginnerLaunchPad = page.getByLabel('Beginner launch pad')
  await beginnerLaunchPad.getByText('가사 자세히').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerLaunchPad.getByText('예시 · 추가 작업').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerLaunchPad.locator('.starter-beginner-details-head').click()
  await beginnerLaunchPad.getByLabel('Starter lyric editor').getByLabel('스타터 가사 라인').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerLaunchPad.getByLabel('Starter lyric editor').getByRole('button', { name: '가사 라인 적용' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const lyricHelper = beginnerLaunchPad.getByLabel('Lyric input helper')
  await lyricHelper.getByText('한글 그대로 입력').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await lyricHelper.getByText('예: 도히도히 다이스키').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await lyricHelper.getByText('현재 멜로디와 같음').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerLaunchPad.getByLabel('Default lyric preview').getByText('현재 가사').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await beginnerLaunchPad.getByLabel('Default lyric preview').getByText('도 히 도 히 다 이 스 키').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const starterUtilities = beginnerLaunchPad.getByLabel('Starter project utilities')
  await starterUtilities.getByText('추가 작업').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterUtilities.getByText('멜로디 · DAW · 프로젝트').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterUtilities.locator('summary').click()
  await starterUtilities.getByLabel('Starter lyric preview').getByText('기본 샘플').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterUtilities.getByLabel('Starter lyric preview').getByText('도 히 도 히 다 이 스 키').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterUtilities.getByRole('button', { name: '스타터 멜로디 추천' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterUtilities.getByRole('button', { name: '스타터 DAW 번들 다운로드' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterUtilities.getByRole('button', { name: '새 프로젝트' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterUtilities.getByRole('button', { name: '데모 프로젝트로 복구' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const starterHandoff = page.getByLabel('Starter handoff checklist')
  await starterHandoff.getByText('고급 도구').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterHandoff.getByText('검수 · 공개 준비').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterHandoff.locator('summary').click()
  await starterHandoff.getByText('다운로드 패키지').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterHandoff.getByText('WAV · melody.mid · chords.mid').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterHandoff.getByText('arrangement.txt · lyrics.txt · notes.csv').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const starterHubLink = starterHandoff.getByRole('link', { name: '스타터 릴리스 허브 열기' })
  await starterHubLink.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const starterHubHref = await starterHubLink.getAttribute('href')
  if (!starterHubHref?.includes('/review/index.html')) {
    throw new Error(`Unexpected starter release review hub href: ${starterHubHref ?? 'missing'}`)
  }
  const starterListeningLink = starterHandoff.getByRole('link', { name: '스타터 청취 리뷰 열기' })
  await starterListeningLink.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const starterListeningHref = await starterListeningLink.getAttribute('href')
  if (!starterListeningHref?.includes('/review/v3/index.html')) {
    throw new Error(`Unexpected starter listening review href: ${starterListeningHref ?? 'missing'}`)
  }
  const starterDawLink = starterHandoff.getByRole('link', { name: '스타터 DAW 리포트 만들기' })
  await starterDawLink.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const starterDawHref = await starterDawLink.getAttribute('href')
  if (!starterDawHref?.includes('/review/wav-daw/index.html')) {
    throw new Error(`Unexpected starter DAW handoff href: ${starterDawHref ?? 'missing'}`)
  }
  await page.getByLabel('Vocal sketch cues').getByText('미리듣기').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Vocal sketch cues').getByText('가사·음정').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Vocal sketch cues').getByText('WAV 저장').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Tempo map').getByText('템포 맵').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Tempo map').getByText('1 marker').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterGuide.getByRole('button', { name: '가사 라인 적용' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await starterUtilities.getByRole('button', { name: '스타터 멜로디 추천' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '작곡', exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '편집', exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '노트', exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '믹서', exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText('WebUtau Korean V3 Synthetic').first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText(/8\/8 matched/u).first().waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Beginner start panel').getByText('샘플 듣기, 가사 바꾸기, WAV 저장 순서로 가면 돼요.').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByText('렌더 경고 없음').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Community release readiness').getByText('V3 자동 점검 통과').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Community release readiness').getByText('listening-scores.local.json 필요').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Manual release evidence checklist').getByText('공개 전 마지막 2개 파일').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Manual release evidence checklist').getByText('자동 3/3 통과 · 수동 0/2 남음').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Manual release evidence checklist').getByText('Evidence Preflight').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Manual release evidence checklist').getByText('no upload').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Manual release evidence checklist').getByText('npm run release:evidence-status').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Manual release evidence checklist').getByText('npm run release:accept-evidence').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Voicebank license metadata').getByText('번들 V3 라이선스 포함').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Voicebank license metadata').getByText(/Generated original sample data/u).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Voicebank origin metadata').getByText('자체 생성 보이스').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Voicebank origin metadata').getByText(/녹음 없음/u).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Selected note dynamics').getByText('세기').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Selected note resampler').getByText('리샘플러').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Selected note timing').getByText('타이밍').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Selected note envelope').getByText('엔벨로프').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Selected note vibrato').getByText('비브라토').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByLabel('Selected note pitch bend').getByText('피치 벤드').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '선택 노트 복제' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByTitle('UST 내보내기').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByTitle('DAW 번들 다운로드').waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '하단 DAW 번들 다운로드' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  await page.locator('input[accept*=".ust"]').waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '선택 노트 UTAU 샘플 미리듣기' }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const hubLink = page.getByRole('link', { name: '릴리스 허브 열기', exact: true })
  await hubLink.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const hubHref = await hubLink.getAttribute('href')
  if (!hubHref?.includes('/review/index.html')) {
    throw new Error(`Unexpected release review hub href: ${hubHref ?? 'missing'}`)
  }
  const preflightLink = page.getByRole('link', { name: 'Preflight 검사', exact: true })
  await preflightLink.waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  const preflightHref = await preflightLink.getAttribute('href')
  if (!preflightHref?.includes('/review/index.html#evidence-preflight')) {
    throw new Error(`Unexpected release evidence preflight href: ${preflightHref ?? 'missing'}`)
  }
  const reviewLink = page.getByRole('link', { name: '청취 리뷰 열기', exact: true })
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
    'first-run starter guide visible',
    'first-run beginner start panel visible',
    'first-run context drawer visible',
    'first-run onboarding coach visible',
    'first-run one-minute path visible',
    'first-run starter chord guide visible',
    'first-run route map visible',
    'first-run route state badges visible',
    'first-run three-step checklist visible',
    'first-run quick-start CTA visible',
    'first-run top lyric editor visible',
    'first-run Korean UTAU path visible',
    'first-run starter launch panel visible',
    'first-run inline lyric input visible',
    'first-run lyric helper visible',
    'first-run current lyric card visible',
    'first-run utility actions visible',
    'first-run DAW handoff checklist visible',
    'first-run release evidence links visible',
    'first-run sketch cues visible',
    'tempo map controls visible',
    'Korean mode navigation visible',
    'first-run demo aliases fully matched',
    'first-run demo render warnings clear',
    'first-run lyric visible',
    'community release readiness card visible',
    'manual release evidence checklist visible',
    'voicebank license metadata visible',
    'voicebank self-generated origin visible',
    'selected-note dynamics controls visible',
    'selected-note resampler controls visible',
    'selected-note timing controls visible',
    'selected-note envelope controls visible',
    'selected-note vibrato controls visible',
    'selected-note pitch bend controls visible',
    'selected-note duplicate controls visible',
    'classic UST import/export controls visible',
    'DAW handoff bundle export visible',
    'community release review hub linked',
    'community evidence preflight linked',
    'community listening review scorecard linked',
    'selected-note UTAU sample preview available',
  ]
}

async function downloadAndInspectDawBundle(page, tempRoot) {
  const downloadPromise = page.waitForEvent('download', { timeout: DEFAULT_TIMEOUT_MS })
  await page.getByRole('button', { name: '하단 DAW 번들 다운로드' }).click()
  const download = await downloadPromise
  const savedBundle = join(tempRoot, download.suggestedFilename())
  await download.saveAs(savedBundle)
  await page.getByText('DAW handoff bundle downloaded', { exact: true }).waitFor({ timeout: DEFAULT_TIMEOUT_MS })
  return inspectDawBundleZip(savedBundle, download.suggestedFilename())
}

async function inspectDawBundleZip(path, fileName) {
  const buffer = readFileSync(path)
  if (!fileName.endsWith('.zip')) {
    throw new Error(`DAW handoff download is not a zip file: ${fileName}`)
  }
  const zip = await JSZip.loadAsync(buffer)
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) {
    throw new Error('DAW handoff bundle is missing manifest.json')
  }
  const manifest = JSON.parse(await manifestFile.async('string'))
  if (manifest.format !== 'webuta-daw-handoff-bundle') {
    throw new Error(`Unexpected DAW bundle format: ${manifest.format ?? 'missing'}`)
  }
  if (manifest.version < 4) {
    throw new Error(`DAW bundle version ${manifest.version ?? 'missing'} does not include MIDI guide files`)
  }
  if (manifest.midi?.ppq !== 480) {
    throw new Error(`DAW bundle MIDI PPQ ${manifest.midi?.ppq ?? 'missing'}; expected 480`)
  }

  const requiredFiles = requiredDawBundleFiles(manifest)
  const missing = requiredFiles.filter((name) => !zip.file(name))
  if (missing.length > 0) {
    throw new Error(`DAW handoff bundle is missing files: ${missing.join(', ')}`)
  }

  const wavFile = zip.file(manifest.wav.file)
  const melodyFile = zip.file(manifest.midi.melodyFile)
  const chordFile = zip.file(manifest.midi.chordFile)
  if (!wavFile || !melodyFile || !chordFile) {
    throw new Error('DAW handoff bundle is missing WAV or MIDI guide files')
  }

  const wavBytes = Buffer.from(await wavFile.async('uint8array'))
  const melodyBytes = Buffer.from(await melodyFile.async('uint8array'))
  const chordBytes = Buffer.from(await chordFile.async('uint8array'))
  assertPcmWavBytes(wavBytes, manifest.wav.file)
  assertMidiFile(melodyBytes, manifest.midi.melodyFile)
  assertMidiFile(chordBytes, manifest.midi.chordFile)

  return {
    fileName,
    bytes: buffer.length,
    format: manifest.format,
    version: manifest.version,
    projectName: manifest.project?.name ?? null,
    files: requiredFiles,
    wav: {
      file: manifest.wav.file,
      bytes: wavBytes.length,
      sampleRate: manifest.wav.sampleRate,
      channels: manifest.wav.channels,
      bitsPerSample: manifest.wav.bitsPerSample,
      durationSeconds: manifest.wav.durationSeconds,
    },
    midi: {
      melodyFile: manifest.midi.melodyFile,
      chordFile: manifest.midi.chordFile,
      ppq: manifest.midi.ppq,
      melodyBytes: melodyBytes.length,
      chordBytes: chordBytes.length,
    },
  }
}

function requiredDawBundleFiles(manifest) {
  const paths = [
    manifest.wav?.file,
    manifest.files?.webuta,
    manifest.files?.ustx,
    manifest.files?.ust,
    manifest.midi?.melodyFile,
    manifest.midi?.chordFile,
    manifest.arrangement?.file,
    manifest.arrangement?.chordFile,
    manifest.lyrics?.file,
    manifest.notes?.file,
    manifest.files?.manifest,
    manifest.files?.readme,
  ]
  const missingFields = paths
    .map((value, index) => ({ value, index }))
    .filter((entry) => typeof entry.value !== 'string' || entry.value.length === 0)
    .map((entry) => entry.index)
  if (missingFields.length > 0) {
    throw new Error(`DAW bundle manifest is missing file path fields: ${missingFields.join(', ')}`)
  }
  return [...new Set(paths)]
}

function assertPcmWavBytes(buffer, label) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Bundled WAV is not a RIFF/WAVE file: ${label}`)
  }
  if (buffer.toString('ascii', 12, 16) !== 'fmt ') {
    throw new Error(`Bundled WAV has no leading fmt chunk: ${label}`)
  }
  const audioFormat = buffer.readUInt16LE(20)
  const channels = buffer.readUInt16LE(22)
  const sampleRate = buffer.readUInt32LE(24)
  const bitsPerSample = buffer.readUInt16LE(34)
  if (audioFormat !== 1 || channels !== 1 || sampleRate !== 44100 || bitsPerSample !== 16) {
    throw new Error(
      `Bundled WAV is not DAW-ready PCM: ${JSON.stringify({
        label,
        audioFormat,
        channels,
        sampleRate,
        bitsPerSample,
      })}`,
    )
  }
}

function assertMidiFile(buffer, label) {
  if (buffer.length < 14 || buffer.toString('ascii', 0, 4) !== 'MThd') {
    throw new Error(`Bundled MIDI guide is missing MThd header: ${label}`)
  }
  const headerLength = buffer.readUInt32BE(4)
  const format = buffer.readUInt16BE(8)
  const trackCount = buffer.readUInt16BE(10)
  const division = buffer.readUInt16BE(12)
  if (headerLength !== 6 || format !== 1 || trackCount < 1 || division !== 480) {
    throw new Error(
      `Bundled MIDI guide has unexpected header: ${JSON.stringify({
        label,
        headerLength,
        format,
        trackCount,
        division,
      })}`,
    )
  }
  if (!buffer.includes(Buffer.from('MTrk', 'ascii'))) {
    throw new Error(`Bundled MIDI guide is missing an MTrk chunk: ${label}`)
  }
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
