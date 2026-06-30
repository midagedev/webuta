import { describe, expect, it } from 'vitest'
import { neuralRequestToDiffSingerDs } from './diffsinger-ds-adapter.mjs'

describe('DiffSinger DS adapter', () => {
  it('converts WebUtau neural note data into a DiffSinger segment', () => {
    const result = neuralRequestToDiffSingerDs(makeRequest())
    const segment = result.segments[0]

    expect(segment.text).toContain('도 SP 히')
    expect(segment.ph_seq).toContain('d o')
    expect(segment.ph_seq).toContain('h i')
    expect(segment.ph_seq).toContain('SP')
    expect(segment.note_seq.split(' ')).toEqual(['C4', 'rest', 'D4'])
    expect(segment.ph_num.split(' ').map(Number)).toEqual([2, 1, 2])
    expect(segment.f0_timestep).toBe('0.005')
    expect(segment.energy_timestep).toBe('0.005')
    expect(segment.voicing_timestep).toBe('0.005')
    expect(segment.energy.split(' ')).toHaveLength(segment.f0_seq.split(' ').length)
    expect(segment.voicing.split(' ')).toHaveLength(segment.f0_seq.split(' ').length)
    expect(segment.energy.split(' ')).toContain('-96')
    expect(segment.voicing.split(' ')).toContain('-96')
    expect(result.diagnostics).toMatchObject({
      renderer: 'diffsinger',
      modelId: 'webuta-ko-neural-dev',
      noteCount: 2,
      eventCount: 3,
      phoneCount: 5,
    })
  })

  it('preserves coda through the Korean phone map when supported', () => {
    const result = neuralRequestToDiffSingerDs({
      ...makeRequest(),
      notes: [
        {
          ...makeRequest().notes[0],
          lyric: '강',
          phonemes: [
            { symbol: 'g', role: 'onset', source: '강' },
            { symbol: 'a', role: 'vowel', source: '강' },
            { symbol: 'ng', role: 'coda', source: '강' },
          ],
        },
      ],
    })

    expect(result.segments[0].ph_seq).toBe('k ɐ ŋ')
  })

  it('keeps Korean coda tails short while sustaining the vowel on long notes', () => {
    const result = neuralRequestToDiffSingerDs({
      ...makeRequest(),
      notes: [
        {
          ...makeRequest().notes[0],
          durationTick: 2304,
          durationSeconds: 1.2,
          lyric: '연',
          phonemes: [
            { symbol: 'yeo', role: 'vowel', source: '연' },
            { symbol: 'n', role: 'coda', source: '연' },
          ],
        },
      ],
    })
    const segment = result.segments[0]
    const phones = segment.ph_seq.split(' ')
    const durations = segment.ph_dur.split(' ').map(Number)

    expect(phones).toEqual(['j', 'ʌ', 'n'])
    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBeCloseTo(1.2, 5)
    expect(durations[1]).toBeGreaterThan(1)
    expect(durations[2]).toBeLessThanOrEqual(0.055)
  })

  it('reports unsupported phones instead of silently dropping them', () => {
    const result = neuralRequestToDiffSingerDs({
      ...makeRequest(),
      notes: [
        {
          ...makeRequest().notes[0],
          lyric: 'AI',
          phonemes: [{ symbol: 'A', role: 'literal', source: 'A' }],
        },
      ],
    })

    expect(result.segments[0].ph_seq).toBe('SP')
    expect(result.diagnostics.warnings[0]).toContain('Unsupported phoneme A')
  })

  it('rejects unsupported languages with a stable error code', () => {
    expect(() => neuralRequestToDiffSingerDs({ ...makeRequest(), voice: { ...makeRequest().voice, language: 'ja' } })).toThrow(
      /Unsupported neural language/,
    )
  })
})

function makeRequest() {
  return {
    version: 1,
    project: {
      id: 'demo',
      title: 'Demo',
      bpm: 120,
      timebase: 480,
    },
    voice: {
      id: 'webuta-ko-neural-dev',
      language: 'ko',
      renderer: 'diffsinger',
    },
    render: {
      sampleRate: 44100,
      format: 'wav',
      includeDiagnostics: true,
    },
    notes: [
      {
        kind: 'note',
        id: 'n1',
        trackId: 'main',
        partId: 'part',
        startTick: 0,
        durationTick: 240,
        startSeconds: 0,
        durationSeconds: 0.25,
        midi: 60,
        targetHz: 261.625565,
        lyric: '도',
        pitchCurve: [],
        phonemes: [
          { symbol: 'd', role: 'onset', source: '도' },
          { symbol: 'o', role: 'vowel', source: '도' },
        ],
      },
      {
        kind: 'note',
        id: 'n2',
        trackId: 'main',
        partId: 'part',
        startTick: 480,
        durationTick: 240,
        startSeconds: 0.5,
        durationSeconds: 0.25,
        midi: 62,
        targetHz: 293.664768,
        lyric: '히',
        pitchCurve: [],
        phonemes: [
          { symbol: 'h', role: 'onset', source: '히' },
          { symbol: 'i', role: 'vowel', source: '히' },
        ],
      },
    ],
  }
}
