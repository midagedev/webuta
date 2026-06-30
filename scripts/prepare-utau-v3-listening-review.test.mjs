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
