import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { TICKS_PER_BEAT, type SongProject } from './types'
import { addNoteAfter, addNoteFromGrid, updateNoteInProject } from './projectEditing'

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

  it('keeps the project unchanged when a note is missing', () => {
    const result = updateNoteInProject(demoProject, 'missing-note', { lyric: '라' })

    expect(result.note).toBeNull()
    expect(result.project).toBe(demoProject)
  })
})
