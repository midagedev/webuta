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
    expect(notePitchBendCentsAt(note, 0.25)).toBeCloseTo(-1140, 3)
    expect(notePitchBendCentsAt(note, 0.75)).toBeCloseTo(60, 3)
  })
})
