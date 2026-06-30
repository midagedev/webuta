import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import {
  evaluateWav,
  fixedListeningReviewProjects,
  LISTENING_SCORE_FIELDS,
  makeListeningTemplate,
  renderHtml,
} from './prepare-utau-v3-listening-review.mjs'

describe('UTAU V3 listening review pack', () => {
  it('defines fixed review phrases for default, coda, CV, and vowel checks', () => {
    const projects = fixedListeningReviewProjects()

    expect(projects.map((project) => project.id)).toEqual([
      'first-run-demo',
      'coda-release-check',
      'clear-cv-line',
      'vowel-color-check',
    ])
    expect(projects[0].project.notes.map((note) => note.lyric).join('')).toBe('도히도히다이스키')
    expect(projects[0].project.notes.map((note) => note.tone)).toEqual([64, 67, 64, 69, 67, 69, 65, 64])
    expect(projects[1].project.notes.map((note) => note.lyric)).toContain('연')
    expect(projects[2].project.notes.map((note) => note.lyric)).toEqual(['가', '나', '다', '라', '마', '사'])
  })

  it('builds a score template with release-focused listening fields', () => {
    const phrases = [
      {
        id: 'first-run-demo',
        title: 'First Run',
        wavPath: '/tmp/first.wav',
      },
    ]

    const template = makeListeningTemplate(phrases)

    expect(template.thresholds.minKoreanClarityScore).toBe(4)
    expect(template.thresholds.minV3PreferenceScore).toBe(4)
    expect(template.instructions.join('\n')).toContain('Do not record new voice material')
    expect(template.reviewEnvironment.noRecordingRequired).toBe(true)
    expect(template.rubric.map((field) => field.key)).toEqual(LISTENING_SCORE_FIELDS.map((field) => field.key))
    expect(template.phraseScores[0]).toMatchObject({
      id: 'first-run-demo',
      koreanClarityScore: null,
      vowelStabilityScore: null,
      consonantClarityScore: null,
      musicalityScore: null,
      artifactScore: null,
    })
    expect(template.comparisonScores).toEqual([])
  })

  it('renders an offline scorecard that can generate the listening-score JSON', () => {
    const phrase = {
      id: 'first-run-demo',
      title: 'First Run',
      description: 'Default hook.',
      lyricLine: '도 히 도 히 다 이 스 키',
      wavPath: '/tmp/first.wav',
      audioHref: 'audio/01-first-run-demo.wav',
      gates: { passed: true, problems: [] },
    }

    const html = renderHtml({
      phrases: [phrase],
      listeningTemplatePath: '/tmp/listening-scores.local.template.json',
    })

    expect(html).toContain('id="scorecardForm"')
    expect(html).toContain('Build listening-scores.local.json')
    expect(html).toContain('Clear saved draft')
    expect(html).toContain('webuta.v3ListeningReviewDraft.v1')
    expect(html).toContain('No recording step')
    expect(html).toContain('noRecordingRequired')
    expect(html).toContain('data-score-key="koreanClarityScore"')
    expect(html).toContain('listening-scores.local.json')
    expect(html).toContain('voicebank:accept-review-v3')
  })

  it('builds a passing score JSON from the offline scorecard controls', async () => {
    const html = renderHtml({
      phrases: [
        {
          id: 'first-run-demo',
          title: 'First Run',
          description: 'Default hook.',
          lyricLine: '도 히 도 히 다 이 스 키',
          wavPath: '/tmp/first.wav',
          audioHref: 'audio/01-first-run-demo.wav',
          gates: { passed: true, problems: [] },
        },
      ],
      listeningTemplatePath: '/tmp/listening-scores.local.template.json',
    })
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await page.fill('#reviewer', 'fixture reviewer')
      await page.selectOption('#decision', 'community-ready')
      await page.fill('#playback', 'fixture headphones')
      for (const field of LISTENING_SCORE_FIELDS) {
        await page.selectOption(`[data-score-key="${field.key}"]`, '5')
      }
      await page.click('#buildJson')
      const status = await page.locator('#status').textContent()
      const payload = JSON.parse(await page.locator('#scoreJson').inputValue())

      expect(status).toContain('passes')
      expect(payload.reviewEnvironment.noRecordingRequired).toBe(true)
      expect(payload.reviewer).toBe('fixture reviewer')
      expect(payload.decision).toBe('community-ready')
      expect(payload.phraseScores[0].koreanClarityScore).toBe(5)
    } finally {
      await browser.close()
    }
  }, 30_000)

  it('adds legacy V2 comparison scoring to the offline scorecard', async () => {
    const phrase = {
      id: 'first-run-demo',
      title: 'First Run',
      description: 'Default hook.',
      lyricLine: '도 히 도 히 다 이 스 키',
      wavPath: '/tmp/first-v3.wav',
      audioHref: 'audio/01-first-run-demo.wav',
      gates: { passed: true, problems: [] },
    }
    const comparison = {
      id: 'first-run-demo',
      title: 'First Run',
      voicebankName: 'WebUtau Korean V2 Legacy',
      wavPath: '/tmp/first-v2.wav',
      audioHref: 'audio/legacy-v2/01-first-run-demo-legacy-v2.wav',
      coverageText: '8/8 matched',
      warningText: '렌더 경고 없음',
      gates: { passed: true, problems: [] },
    }
    const html = renderHtml({
      phrases: [phrase],
      comparisons: [comparison],
      listeningTemplatePath: '/tmp/listening-scores.local.template.json',
    })

    expect(html).toContain('Legacy V2 baseline')
    expect(html).toContain('data-comparison-score')

    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await page.fill('#reviewer', 'fixture reviewer')
      await page.selectOption('#decision', 'community-ready')
      for (const field of LISTENING_SCORE_FIELDS) {
        await page.selectOption(`[data-score-key="${field.key}"]`, '5')
      }
      await page.selectOption('[data-comparison-score]', '5')
      await page.click('#buildJson')
      const status = await page.locator('#status').textContent()
      const payload = JSON.parse(await page.locator('#scoreJson').inputValue())

      expect(status).toContain('passes')
      expect(payload.thresholds.minV3PreferenceScore).toBe(4)
      expect(payload.comparisonScores[0]).toMatchObject({
        id: 'first-run-demo',
        v3WavPath: '/tmp/first-v3.wav',
        legacyV2WavPath: '/tmp/first-v2.wav',
        v3PreferenceScore: 5,
      })
    } finally {
      await browser.close()
    }
  }, 30_000)

  it('restores an in-progress listening scorecard draft after reload', async () => {
    const html = renderHtml({
      phrases: [
        {
          id: 'first-run-demo',
          title: 'First Run',
          description: 'Default hook.',
          lyricLine: '도 히 도 히 다 이 스 키',
          wavPath: '/tmp/first.wav',
          audioHref: 'audio/01-first-run-demo.wav',
          gates: { passed: true, problems: [] },
        },
      ],
      listeningTemplatePath: '/tmp/listening-scores.local.template.json',
    })
    const server = await serveHtml(html)
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.goto(server.url)
      await page.fill('#reviewer', 'draft reviewer')
      await page.fill('#playback', 'phone speaker')
      await page.selectOption('[data-score-key="koreanClarityScore"]', '4')
      await page.fill('[data-notes]', 'ㄷ attack is understandable')
      await expectDraftStatus(page, 'Draft saved')

      await page.reload()

      await page.waitForSelector('#reviewer')
      expect(await page.locator('#reviewer').inputValue()).toBe('draft reviewer')
      expect(await page.locator('#playback').inputValue()).toBe('phone speaker')
      expect(await page.locator('[data-score-key="koreanClarityScore"]').inputValue()).toBe('4')
      expect(await page.locator('[data-notes]').inputValue()).toBe('ㄷ attack is understandable')
      await expectDraftStatus(page, 'Saved draft restored')
    } finally {
      await browser.close()
      await server.close()
    }
  }, 30_000)

  it('evaluates DAW-ready WAV metrics for review artifacts', () => {
    expect(
      evaluateWav({
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
        durationSeconds: 4.2,
        bytes: 300000,
      }),
    ).toEqual({ passed: true, problems: [] })

    const failed = evaluateWav({
      sampleRate: 48000,
      channels: 2,
      bitsPerSample: 24,
      durationSeconds: 0.5,
      bytes: 1000,
    })

    expect(failed.passed).toBe(false)
    expect(failed.problems.join('\n')).toContain('sampleRate 48000')
    expect(failed.problems.join('\n')).toContain('duration 0.500s')
  })
})

async function serveHtml(html) {
  const server = createServer((req, res) => {
    if (req.url?.endsWith('.wav')) {
      res.writeHead(200, { 'content-type': 'audio/wav' })
      res.end('RIFF')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to start test server.')
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function expectDraftStatus(page, text) {
  await page.waitForFunction(
    (expected) => document.querySelector('#draftStatus')?.textContent?.includes(expected),
    text,
  )
}
