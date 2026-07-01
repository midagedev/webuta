import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { TICKS_PER_BEAT, type SongProject } from './types'
import {
  addNoteAfter,
  addNoteAtTick,
  addNoteFromGrid,
  applyLyricLineToProject,
  copyNoteForPaste,
  deleteNoteFromProject,
  duplicateNoteInProject,
  pasteCopiedNoteInProject,
  quantizeProjectNotes,
  splitNoteInProject,
  transposeProject,
  tokenizeLyricLine,
  updateNoteInProject,
} from './projectEditing'

describe('project editing helpers', () => {
  it('adds a note after the selected anchor', () => {
    const anchor = demoProject.notes[0]
    const { project, note } = addNoteAfter(demoProject, anchor, '라')

    expect(note.start).toBe(anchor.start + anchor.duration)
    expect(note.duration).toBe(TICKS_PER_BEAT)
    expect(note.tone).toBe(anchor.tone)
    expect(note.lyric).toBe('라')
    expect(project.notes).toHaveLength(demoProject.notes.length + 1)
  })

  it('creates snapped notes from piano-roll coordinates', () => {
    const { project, note } = addNoteFromGrid(demoProject, {
      x: 167,
      y: 53,
      tickWidth: 0.15,
      rowHeight: 26,
      maxTone: 72,
      minTone: 48,
      lyric: '도',
    })

    expect(note.start).toBe(1080)
    expect(note.duration).toBe(TICKS_PER_BEAT)
    expect(note.tone).toBe(70)
    expect(note.lyric).toBe('도')
    expect(project.notes.at(-1)?.start).toBeGreaterThanOrEqual(note.start)
  })

  it('adds quantized live-recorded notes at a timeline tick', () => {
    const { project, note } = addNoteAtTick(demoProject, {
      start: 233,
      duration: 181,
      tone: 62,
      lyric: '가',
      gridTicks: 120,
    })

    expect(note.start).toBe(240)
    expect(note.duration).toBe(240)
    expect(note.lyric).toBe('가')
    expect(project.notes).toHaveLength(demoProject.notes.length + 1)
  })

  it('extends the active part when a new note lands beyond the current part end', () => {
    const shortProject: SongProject = {
      ...demoProject,
      parts: [{ ...demoProject.parts[0], duration: TICKS_PER_BEAT }],
      notes: [],
    }
    const { project, note } = addNoteFromGrid(shortProject, {
      x: 900,
      y: 0,
      tickWidth: 0.15,
      rowHeight: 26,
      maxTone: 72,
      minTone: 48,
      lyric: '키',
    })

    expect(project.parts[0].duration).toBeGreaterThanOrEqual(note.start + note.duration)
  })

  it('updates notes and expands the owning part for export', () => {
    const target = demoProject.notes[0]
    const { project, note } = updateNoteInProject(demoProject, target.id, {
      start: TICKS_PER_BEAT * 12,
      duration: TICKS_PER_BEAT * 2,
      tone: 120,
      lyric: ' 키 ',
    })

    expect(note?.start).toBe(TICKS_PER_BEAT * 12)
    expect(note?.duration).toBe(TICKS_PER_BEAT * 2)
    expect(note?.tone).toBe(84)
    expect(note?.lyric).toBe('키')
    expect(project.parts[0].duration).toBeGreaterThanOrEqual(TICKS_PER_BEAT * 14)
  })

  it('quantizes note starts and lengths across the project', () => {
    const unquantizedProject: SongProject = {
      ...demoProject,
      notes: demoProject.notes.map((note, index) =>
        index === 0 ? { ...note, start: 61, duration: 421 } : note,
      ),
    }

    const { project, changedCount } = quantizeProjectNotes(unquantizedProject, 120)

    expect(changedCount).toBe(1)
    expect(project.notes[0]).toMatchObject({ start: 120, duration: 480 })
  })

  it('transposes the full vocal project with its chord guide', () => {
    const { project, changedNoteCount, changedChordCount } = transposeProject(demoProject, 2)

    expect(changedNoteCount).toBe(demoProject.notes.length)
    expect(changedChordCount).toBe(demoProject.chords?.length)
    expect(project.notes.map((note) => note.tone)).toEqual(demoProject.notes.map((note) => note.tone + 2))
    expect(project.chords?.map((chord) => chord.symbol)).toEqual(['Bm', 'G', 'D', 'A'])
    expect(project.chords?.[0].tone).toBe((demoProject.chords?.[0].tone ?? 0) + 2)
    expect(project.chords?.[0].tones).toEqual(demoProject.chords?.[0].tones?.map((tone) => tone + 2))
  })

  it('keeps vocal transpose inside the supported note range', () => {
    const highProject: SongProject = {
      ...demoProject,
      notes: demoProject.notes.map((note) => ({ ...note, tone: 84 })),
    }

    const { project, changedNoteCount, clampedNoteCount } = transposeProject(highProject, 12)

    expect(changedNoteCount).toBe(0)
    expect(clampedNoteCount).toBe(highProject.notes.length)
    expect(project.notes.every((note) => note.tone === 84)).toBe(true)
    expect(project.chords?.map((chord) => chord.symbol)).toEqual(highProject.chords?.map((chord) => chord.symbol))
  })

  it('keeps the project unchanged when a note is missing', () => {
    const result = updateNoteInProject(demoProject, 'missing-note', { lyric: '라' })

    expect(result.note).toBeNull()
    expect(result.project).toBe(demoProject)
  })

  it('splits a selected note at a snapped midpoint', () => {
    const { project, leftNote, rightNote } = splitNoteInProject(demoProject, 'n1')

    expect(leftNote?.duration).toBe(240)
    expect(rightNote).toMatchObject({
      start: 240,
      duration: 120,
      tone: 69,
      lyric: '네',
    })
    expect(project.notes).toHaveLength(demoProject.notes.length + 1)
    expect(project.notes.map((note) => note.start)).toEqual([...project.notes.map((note) => note.start)].sort((a, b) => a - b))
  })

  it('does not split notes shorter than two grid cells', () => {
    const shortProject: SongProject = {
      ...demoProject,
      notes: [{ ...demoProject.notes[0], duration: 120 }],
    }
    const { project, rightNote } = splitNoteInProject(shortProject, 'n1')

    expect(project).toBe(shortProject)
    expect(rightNote).toBeNull()
  })

  it('deletes a note while preserving at least one note in the project', () => {
    const { project, deletedNote, nextSelectedNoteId } = deleteNoteFromProject(demoProject, 'n1')

    expect(deletedNote?.id).toBe('n1')
    expect(project.notes).toHaveLength(demoProject.notes.length - 1)
    expect(project.notes.some((note) => note.id === 'n1')).toBe(false)
    expect(nextSelectedNoteId).toBe('n2')

    const singleNoteProject = { ...demoProject, notes: [demoProject.notes[0]] }
    expect(deleteNoteFromProject(singleNoteProject, 'n1').project).toBe(singleNoteProject)
  })

  it('duplicates a note immediately after the source note', () => {
    const sourceProject = {
      ...demoProject,
      notes: demoProject.notes.map((note) =>
        note.id === 'n11'
          ? {
              ...note,
              intensity: 74,
              velocity: 138,
              modulation: 11,
              flags: 'g-3Y0',
              timing: { sampleStartMs: 18, preutteranceMs: 70, voiceOverlapMs: 16 },
              envelope: { p1Ms: 0, p2Ms: 28, p3Ms: 160, v1: 0, v2: 100, v3: 62, v4: 8 },
              pitchBend: {
                points: [
                  { timePercent: 0, cents: 0 },
                  { timePercent: 50, cents: 28 },
                  { timePercent: 100, cents: 0 },
                ],
                modes: ['s', 'j'],
              },
            }
          : note,
      ),
    }
    const { project, sourceNote, duplicatedNote } = duplicateNoteInProject(sourceProject, 'n11')

    expect(sourceNote?.id).toBe('n11')
    expect(duplicatedNote).toMatchObject({
      trackId: 'track-main',
      partId: 'part-main',
      start: 5280,
      duration: 960,
      tone: 76,
      lyric: '가',
      intensity: 74,
      velocity: 138,
      modulation: 11,
      flags: 'g-3Y0',
      timing: { sampleStartMs: 18, preutteranceMs: 70, voiceOverlapMs: 16 },
      envelope: { p1Ms: 0, p2Ms: 28, p3Ms: 160, v1: 0, v2: 100, v3: 62, v4: 8 },
      vibrato: { enabled: true, depthCents: 18, rateHz: 5.4, startPercent: 46 },
      pitchBend: {
        points: [
          { timePercent: 0, cents: 0 },
          { timePercent: 50, cents: 28 },
          { timePercent: 100, cents: 0 },
        ],
        modes: ['s', 'j'],
      },
    })
    expect(duplicatedNote?.id).not.toBe('n11')
    expect(project.notes).toHaveLength(sourceProject.notes.length + 1)
    expect(project.parts[0].duration).toBeGreaterThanOrEqual(6240)
  })

  it('keeps the project unchanged when duplicating a missing note', () => {
    const result = duplicateNoteInProject(demoProject, 'missing-note')

    expect(result.project).toBe(demoProject)
    expect(result.duplicatedNote).toBeNull()
  })

  it('copies and pastes a note after the current anchor with DAW parameters intact', () => {
    const sourceNote = {
      ...demoProject.notes[10],
      intensity: 92,
      velocity: 126,
      modulation: 8,
      flags: 'g-2',
      timing: { sampleStartMs: 22, preutteranceMs: 64, voiceOverlapMs: 20 },
      envelope: { p1Ms: 0, p2Ms: 30, p3Ms: 180, v1: 0, v2: 100, v3: 58, v4: 4 },
      vibrato: { enabled: true, depthCents: 21, rateHz: 5.8, startPercent: 38 },
      pitchBend: {
        points: [
          { timePercent: 0, cents: 0 },
          { timePercent: 44, cents: -24 },
          { timePercent: 100, cents: 6 },
        ],
        modes: ['l', 'io'],
        snapFirst: true,
      },
    }
    const sourceProject = {
      ...demoProject,
      notes: demoProject.notes.map((note) => (note.id === sourceNote.id ? sourceNote : note)),
    }
    const anchor = sourceProject.notes[1]
    const copiedNote = copyNoteForPaste(sourceNote)
    const { project, pastedNote } = pasteCopiedNoteInProject(sourceProject, copiedNote, anchor)

    expect(pastedNote).toMatchObject({
      trackId: anchor.trackId,
      partId: anchor.partId,
      start: anchor.start + anchor.duration,
      duration: sourceNote.duration,
      tone: sourceNote.tone,
      lyric: sourceNote.lyric,
      intensity: 92,
      velocity: 126,
      modulation: 8,
      flags: 'g-2',
      timing: { sampleStartMs: 22, preutteranceMs: 64, voiceOverlapMs: 20 },
      envelope: { p1Ms: 0, p2Ms: 30, p3Ms: 180, v1: 0, v2: 100, v3: 58, v4: 4 },
      vibrato: { enabled: true, depthCents: 21, rateHz: 5.8, startPercent: 38 },
      pitchBend: {
        points: [
          { timePercent: 0, cents: 0 },
          { timePercent: 44, cents: -24 },
          { timePercent: 100, cents: 6 },
        ],
        modes: ['l', 'io'],
        snapFirst: true,
      },
    })
    expect(pastedNote.id).not.toBe(sourceNote.id)
    expect(pastedNote.pitchBend).not.toBe(copiedNote.pitchBend)
    expect(pastedNote.pitchBend?.points).not.toBe(copiedNote.pitchBend?.points)
    expect(project.notes).toHaveLength(sourceProject.notes.length + 1)
  })

  it('tokenizes compact Korean lyric lines by syllable', () => {
    expect(tokenizeLyricLine('네오빛이 메로디로 데려가')).toEqual(['네', '오', '빛', '이', '메', '로', '디', '로', '데', '려', '가'])
  })

  it('keeps spaced romanized lyrics as note tokens', () => {
    expect(tokenizeLyricLine('do hi do hi da i su ki')).toEqual(['do', 'hi', 'do', 'hi', 'da', 'i', 'su', 'ki'])
  })

  it('splits compact Japanese romaji lyric chunks into vocal-synth note tokens', () => {
    expect(tokenizeLyricLine('daisuki tokyo matte')).toEqual(['da', 'i', 'su', 'ki', 'to', 'kyo', 'ma', 'っ', 'te'])
  })

  it('keeps rest markers and unparseable roman words as single lyric tokens', () => {
    expect(tokenizeLyricLine('neon rest br xyz')).toEqual(['ne', 'o', 'n', 'rest', 'br', 'xyz'])
  })

  it('applies a lyric line to notes in timeline order', () => {
    const { project, appliedCount, tokens } = applyLyricLineToProject(demoProject, '네오빛이 메로디로 데려가')

    expect(tokens).toEqual(['네', '오', '빛', '이', '메', '로', '디', '로', '데', '려', '가'])
    expect(appliedCount).toBe(11)
    expect(project.notes.map((note) => note.lyric)).toEqual(['네', '오', '빛', '이', '메', '로', '디', '로', '데', '려', '가'])
  })
})
