import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { TICKS_PER_BEAT, type SongProject } from './types'
import {
  addNoteAfter,
  addNoteAtTick,
  addNoteFromGrid,
  applyLyricLineToProject,
  deleteNoteFromProject,
  duplicateNoteInProject,
  quantizeProjectNotes,
  splitNoteInProject,
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

    expect(changedCount).toBe(4)
    expect(project.notes[0]).toMatchObject({ start: 120, duration: 480 })
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
      duration: 180,
      tone: 64,
      lyric: '도',
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
        note.id === 'n8'
          ? {
              ...note,
              intensity: 74,
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
    const { project, sourceNote, duplicatedNote } = duplicateNoteInProject(sourceProject, 'n8')

    expect(sourceNote?.id).toBe('n8')
    expect(duplicatedNote).toMatchObject({
      trackId: 'track-main',
      partId: 'part-main',
      start: 4680,
      duration: 1080,
      tone: 64,
      lyric: '키',
      intensity: 74,
      timing: { sampleStartMs: 18, preutteranceMs: 70, voiceOverlapMs: 16 },
      envelope: { p1Ms: 0, p2Ms: 28, p3Ms: 160, v1: 0, v2: 100, v3: 62, v4: 8 },
      vibrato: { enabled: true, depthCents: 20, rateHz: 5.6, startPercent: 44 },
      pitchBend: {
        points: [
          { timePercent: 0, cents: 0 },
          { timePercent: 50, cents: 28 },
          { timePercent: 100, cents: 0 },
        ],
        modes: ['s', 'j'],
      },
    })
    expect(duplicatedNote?.id).not.toBe('n8')
    expect(project.notes).toHaveLength(sourceProject.notes.length + 1)
    expect(project.parts[0].duration).toBeGreaterThanOrEqual(5760)
  })

  it('keeps the project unchanged when duplicating a missing note', () => {
    const result = duplicateNoteInProject(demoProject, 'missing-note')

    expect(result.project).toBe(demoProject)
    expect(result.duplicatedNote).toBeNull()
  })

  it('tokenizes compact Korean lyric lines by syllable', () => {
    expect(tokenizeLyricLine('도히도히 다이스키')).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
  })

  it('keeps spaced romanized lyrics as note tokens', () => {
    expect(tokenizeLyricLine('do hi do hi da i su ki')).toEqual(['do', 'hi', 'do', 'hi', 'da', 'i', 'su', 'ki'])
  })

  it('applies a lyric line to notes in timeline order', () => {
    const { project, appliedCount, tokens } = applyLyricLineToProject(demoProject, '도히도히 다이스키')

    expect(tokens).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
    expect(appliedCount).toBe(8)
    expect(project.notes.map((note) => note.lyric)).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
  })
})
