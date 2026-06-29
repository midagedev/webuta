import { describe, expect, it } from 'vitest'
import { TICKS_PER_BEAT, type SongProject } from './types'
import { applyMelodySuggestion, composeFromLyrics, formatChordLine, tokenizeComposerLyrics } from './composer'

describe('composer', () => {
  it('tokenizes Hangul lyrics by syllable', () => {
    expect(tokenizeComposerLyrics('도히도히 다이스키')).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
  })

  it('generates notes and prepared chords from lyrics', () => {
    const suggestion = composeFromLyrics('도히도히 다이스키', 'bright')

    expect(suggestion.bpm).toBe(118)
    expect(suggestion.notes).toHaveLength(8)
    expect(suggestion.notes.map((note) => note.lyric)).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
    expect(formatChordLine(suggestion.chords.slice(0, 4))).toBe('C  G  Am  F')
    expect(suggestion.notes[0].start).toBe(0)
    expect(suggestion.notes.at(-1)?.duration).toBe(TICKS_PER_BEAT)
    expect(suggestion.notes.every((note) => note.tone >= 48 && note.tone <= 84)).toBe(true)
  })

  it('applies generated melody as the active vocal part', () => {
    const project = makeProject()
    const suggestion = composeFromLyrics('사랑해', 'minor')
    const nextProject = applyMelodySuggestion(project, suggestion)

    expect(nextProject.bpm).toBe(96)
    expect(nextProject.notes).toHaveLength(3)
    expect(nextProject.notes.every((note) => note.trackId === 'track')).toBe(true)
    expect(nextProject.notes.every((note) => note.partId === 'part')).toBe(true)
    expect(nextProject.parts[0].name).toBe('Generated Hook')
  })
})

function makeProject(): SongProject {
  return {
    id: 'project',
    name: 'Draft',
    comment: '',
    bpm: 112,
    beatPerBar: 4,
    beatUnit: 4,
    tracks: [{ id: 'track', name: 'Main Vocal', color: 'Coral' }],
    parts: [{ id: 'part', trackId: 'track', name: 'Verse', start: 0, duration: TICKS_PER_BEAT * 4 }],
    notes: [{ id: 'note', trackId: 'track', partId: 'part', start: 0, duration: 480, tone: 60, lyric: '라' }],
  }
}
