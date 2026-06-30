import { describe, expect, it } from 'vitest'
import {
  evaluateWav,
  fixedListeningReviewProjects,
  makeListeningTemplate,
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
    expect(template.phraseScores[0]).toMatchObject({
      id: 'first-run-demo',
      koreanClarityScore: null,
      vowelStabilityScore: null,
      consonantClarityScore: null,
      musicalityScore: null,
      artifactScore: null,
    })
  })

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
