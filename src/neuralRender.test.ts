import { describe, expect, it } from 'vitest'
import { createNeuralRenderRequest, phonemesForLyric } from './neuralRender'
import { demoProject } from './demoProject'
import type { SongProject } from './types'

describe('neural render contract export', () => {
  it('exports the built-in demo phrase as deterministic note data', () => {
    const request = createNeuralRenderRequest(demoProject)

    expect(request).toMatchObject({
      version: 1,
      project: {
        id: 'demo-vocal-synth',
        title: 'First Vocal Sketch',
        bpm: 112,
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
    })
    expect(request.notes).toHaveLength(8)
    expect(request.notes.map((note) => note.lyric).join('')).toBe('도히도히다이스키')
    expect(request.notes[0]).toMatchObject({
      kind: 'note',
      id: 'n1',
      startTick: 0,
      durationTick: 420,
      midi: 64,
      lyric: '도',
      phonemes: [
        { symbol: 'd', role: 'onset', source: '도' },
        { symbol: 'o', role: 'vowel', source: '도' },
      ],
    })
    expect(request.notes[0].targetHz).toBeCloseTo(329.627557, 5)
  })

  it('preserves Korean coda phonemes instead of reducing to CV', () => {
    expect(phonemesForLyric('강')).toMatchObject([
      { symbol: 'g', role: 'onset', source: '강' },
      { symbol: 'a', role: 'vowel', source: '강' },
      { symbol: 'ng', role: 'coda', source: '강' },
    ])
  })

  it('places Korean coda phonemes in a short final tail instead of the sustain body', () => {
    const phonemes = phonemesForLyric('연')
    const vowel = phonemes.find((phoneme) => phoneme.role === 'vowel')
    const coda = phonemes.find((phoneme) => phoneme.role === 'coda')

    expect(vowel).toMatchObject({ symbol: 'yeo', startRatio: 0 })
    expect(coda).toMatchObject({ symbol: 'n', role: 'coda' })
    expect(coda?.startRatio).toBeGreaterThan(0.92)
    expect(coda?.endRatio).toBe(1)
  })

  it('keeps multiple Hangul syllables in one lyric token', () => {
    expect(phonemesForLyric('사랑')).toMatchObject([
      { symbol: 's', role: 'onset', source: '사' },
      { symbol: 'a', role: 'vowel', source: '사' },
      { symbol: 'r', role: 'onset', source: '랑' },
      { symbol: 'a', role: 'vowel', source: '랑' },
      { symbol: 'ng', role: 'coda', source: '랑' },
    ])
  })

  it('keeps literal non-Hangul characters for mixed lyrics', () => {
    expect(phonemesForLyric('사랑AI')).toMatchObject([
      { symbol: 's', role: 'onset', source: '사' },
      { symbol: 'a', role: 'vowel', source: '사' },
      { symbol: 'r', role: 'onset', source: '랑' },
      { symbol: 'a', role: 'vowel', source: '랑' },
      { symbol: 'ng', role: 'coda', source: '랑' },
      { symbol: 'A', role: 'literal', source: 'A' },
      { symbol: 'I', role: 'literal', source: 'I' },
    ])
  })

  it('exports coda-heavy notes in score order', () => {
    const project: SongProject = {
      ...demoProject,
      id: 'coda-fixture',
      name: 'Coda Fixture',
      notes: [
        { id: 'late', trackId: 'track-main', partId: 'part-main', start: 480, duration: 240, tone: 62, lyric: '밤' },
        { id: 'early', trackId: 'track-main', partId: 'part-main', start: 0, duration: 480, tone: 60, lyric: '강' },
      ],
    }
    const request = createNeuralRenderRequest(project)

    expect(request.notes.map((note) => note.lyric)).toEqual(['강', '밤'])
    expect(request.notes[0].phonemes.at(-1)).toMatchObject({ symbol: 'ng', role: 'coda' })
    expect(request.notes[1].phonemes.at(-1)).toMatchObject({ symbol: 'm', role: 'coda' })
  })

  it('can export explicit rests between notes', () => {
    const request = createNeuralRenderRequest(demoProject, { includeRests: true })

    expect(request.notes[0]).toMatchObject({ kind: 'note', lyric: '도', startTick: 0, durationTick: 420 })
    expect(request.notes[1]).toMatchObject({
      kind: 'rest',
      lyric: 'R',
      startTick: 420,
      durationTick: 60,
      midi: null,
      targetHz: null,
      phonemes: [{ symbol: 'sil', role: 'silence' }],
      pitchCurve: [],
    })
  })

  it('treats rest lyrics as silent events instead of pitched syllables', () => {
    const project: SongProject = {
      ...demoProject,
      id: 'rest-fixture',
      name: 'Rest Fixture',
      notes: [{ id: 'r1', trackId: 'track-main', partId: 'part-main', start: 0, duration: 480, tone: 60, lyric: '쉼' }],
    }

    expect(createNeuralRenderRequest(project).notes[0]).toMatchObject({
      kind: 'rest',
      lyric: '쉼',
      midi: null,
      targetHz: null,
      phonemes: [{ symbol: 'sil', role: 'silence' }],
    })
  })

  it('exports tie lyrics as pitched hold events', () => {
    const project: SongProject = {
      ...demoProject,
      id: 'tie-fixture',
      name: 'Tie Fixture',
      notes: [
        { id: 'n1', trackId: 'track-main', partId: 'part-main', start: 0, duration: 480, tone: 60, lyric: '사' },
        { id: 'tie1', trackId: 'track-main', partId: 'part-main', start: 480, duration: 480, tone: 62, lyric: '-' },
      ],
    }
    const request = createNeuralRenderRequest(project)

    expect(request.notes[1]).toMatchObject({
      kind: 'tie',
      lyric: '-',
      midi: 62,
      phonemes: [{ symbol: 'tie', role: 'tie', source: '-' }],
    })
    expect(request.notes[1].targetHz).toBeCloseTo(293.664767, 5)
    expect(phonemesForLyric('-')).toMatchObject([{ symbol: 'tie', role: 'tie' }])
  })

  it('exports breath lyrics as unpitched breath events', () => {
    const project: SongProject = {
      ...demoProject,
      id: 'breath-fixture',
      name: 'Breath Fixture',
      notes: [{ id: 'br1', trackId: 'track-main', partId: 'part-main', start: 0, duration: 240, tone: 60, lyric: '숨' }],
    }
    const request = createNeuralRenderRequest(project)

    expect(request.notes[0]).toMatchObject({
      kind: 'breath',
      lyric: '숨',
      midi: null,
      targetHz: null,
      phonemes: [{ symbol: 'br', role: 'breath', source: '숨' }],
    })
    expect(phonemesForLyric('br')).toMatchObject([{ symbol: 'br', role: 'breath' }])
  })

  it('accepts optional per-note pitch curves for later neural adapters', () => {
    const request = createNeuralRenderRequest(demoProject, {
      pitchCurves: {
        n1: [
          { timeRatio: 1.4, cents: 25 },
          { timeRatio: 0.2, cents: -15 },
          { timeRatio: -0.5, cents: Number.NaN },
        ],
      },
    })

    expect(request.notes[0].pitchCurve).toEqual([
      { timeRatio: 0, cents: 0 },
      { timeRatio: 0.2, cents: -15 },
      { timeRatio: 1, cents: 25 },
    ])
  })
})
