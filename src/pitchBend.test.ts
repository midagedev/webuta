import { describe, expect, it } from 'vitest'
import { notePitchBendCentsAt, sanitizeOptionalNotePitchBend } from './pitchBend'
import type { SongNote } from './types'

describe('note pitch bend curves', () => {
  it('normalizes points for deterministic storage and interpolation', () => {
    const pitchBend = sanitizeOptionalNotePitchBend({
      points: [
        { timePercent: 100, cents: 0 },
        { timePercent: 50, cents: 120 },
        { timePercent: -20, cents: -3000 },
      ],
      modes: ['s', 'r'],
      snapFirst: false,
    })
    const note: SongNote = {
      id: 'bend-note',
      trackId: 'track',
      partId: 'part',
      start: 0,
      duration: 480,
      tone: 60,
      lyric: '라',
      pitchBend,
    }

    expect(pitchBend?.points).toEqual([
      { timePercent: 0, cents: -2400 },
      { timePercent: 50, cents: 120 },
      { timePercent: 100, cents: 0 },
    ])
    expect(pitchBend?.modes).toEqual(['s', 'r'])
    expect(pitchBend?.snapFirst).toBe(false)
    expect(notePitchBendCentsAt(note, 0.25)).toBeCloseTo(-1140, 3)
    expect(notePitchBendCentsAt(note, 0.75)).toBeCloseTo(60, 3)
  })

  it('applies OpenUtau-style pitch point easing modes', () => {
    const note: SongNote = {
      id: 'bend-note',
      trackId: 'track',
      partId: 'part',
      start: 0,
      duration: 480,
      tone: 60,
      lyric: '라',
      pitchBend: {
        points: [
          { timePercent: 0, cents: 0 },
          { timePercent: 100, cents: 100 },
        ],
        modes: ['io'],
      },
    }

    expect(notePitchBendCentsAt(note, 0.25)).toBeCloseTo(14.645, 3)
    expect(notePitchBendCentsAt(note, 0.5)).toBeCloseTo(50, 3)
    expect(notePitchBendCentsAt(note, 0.75)).toBeCloseTo(85.355, 3)
  })

  it('treats OpenUtau spline mode as a smooth curve for browser rendering', () => {
    const note: SongNote = {
      id: 'spline-note',
      trackId: 'track',
      partId: 'part',
      start: 0,
      duration: 480,
      tone: 60,
      lyric: '라',
      pitchBend: {
        points: [
          { timePercent: 0, cents: 0 },
          { timePercent: 100, cents: 100 },
        ],
        modes: ['sp'],
      },
    }

    expect(notePitchBendCentsAt(note, 0.25)).toBeCloseTo(14.645, 3)
    expect(notePitchBendCentsAt(note, 0.75)).toBeCloseTo(85.355, 3)
  })
})
