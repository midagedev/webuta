import { clampTone, makeId } from './music'
import { TICKS_PER_BEAT, type SongNote, type SongProject, type VoicePart } from './types'

export const GRID_SNAP_TICKS = 120
export const DEFAULT_NOTE_DURATION_TICKS = TICKS_PER_BEAT

export type GridNoteInput = {
  x: number
  y: number
  tickWidth: number
  rowHeight: number
  maxTone: number
  minTone: number
  lyric: string
}

export function addNoteAfter(project: SongProject, anchor: SongNote | undefined, lyric = '라') {
  const part = ensurePrimaryPart(project)
  const start = anchor ? anchor.start + anchor.duration : project.notes.at(-1)?.start ?? 0
  return insertNote(project, {
    part,
    start,
    duration: DEFAULT_NOTE_DURATION_TICKS,
    tone: clampTone(anchor ? anchor.tone : 60),
    lyric,
  })
}

export function addNoteFromGrid(project: SongProject, input: GridNoteInput) {
  const part = ensurePrimaryPart(project)
  const duration = DEFAULT_NOTE_DURATION_TICKS
  const rawTick = input.x / input.tickWidth
  const start = Math.max(0, snapTick(rawTick))
  const row = Math.max(0, Math.floor(input.y / input.rowHeight))
  const tone = clampTone(input.maxTone - row)
  const boundedTone = Math.max(input.minTone, Math.min(input.maxTone, tone))
  return insertNote(project, {
    part,
    start,
    duration,
    tone: boundedTone,
    lyric: input.lyric.trim() || '라',
  })
}

function insertNote(
  project: SongProject,
  noteInput: {
    part: VoicePart
    start: number
    duration: number
    tone: number
    lyric: string
  },
) {
  const note: SongNote = {
    id: makeId('note'),
    trackId: noteInput.part.trackId,
    partId: noteInput.part.id,
    start: noteInput.start,
    duration: noteInput.duration,
    tone: noteInput.tone,
    lyric: noteInput.lyric,
  }
  const nextPart = {
    ...noteInput.part,
    duration: Math.max(noteInput.part.duration, note.start - noteInput.part.start + note.duration),
  }
  const parts = project.parts.some((part) => part.id === nextPart.id)
    ? project.parts.map((part) => (part.id === nextPart.id ? nextPart : part))
    : [nextPart, ...project.parts]
  return {
    project: {
      ...project,
      parts,
      notes: [...project.notes, note].sort((a, b) => a.start - b.start || a.tone - b.tone),
    },
    note,
  }
}

function ensurePrimaryPart(project: SongProject): VoicePart {
  return (
    project.parts[0] ?? {
      id: makeId('part'),
      trackId: project.tracks[0]?.id ?? makeId('track'),
      name: 'Verse',
      start: 0,
      duration: TICKS_PER_BEAT * 4,
    }
  )
}

function snapTick(tick: number) {
  return Math.round(tick / GRID_SNAP_TICKS) * GRID_SNAP_TICKS
}
