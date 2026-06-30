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

export type TickNoteInput = {
  start: number
  duration: number
  tone: number
  lyric: string
  gridTicks?: number
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

export function addNoteAtTick(project: SongProject, input: TickNoteInput) {
  const part = ensurePrimaryPart(project)
  const gridTicks = input.gridTicks ?? 0
  return insertNote(project, {
    part,
    start: gridTicks > 0 ? snapTickToGrid(input.start, gridTicks) : Math.max(0, Math.round(input.start)),
    duration: gridTicks > 0 ? Math.max(gridTicks, snapTickToGrid(input.duration, gridTicks)) : input.duration,
    tone: input.tone,
    lyric: input.lyric.trim() || '라',
  })
}

export function updateNoteInProject(project: SongProject, noteId: string, patch: Partial<SongNote>) {
  const currentNote = project.notes.find((note) => note.id === noteId)
  if (!currentNote) {
    return { project, note: null }
  }
  const note = sanitizeNote({ ...currentNote, ...patch })
  return {
    project: {
      ...project,
      parts: expandPartForNote(project.parts, note),
      notes: project.notes
        .map((item) => (item.id === note.id ? note : item))
        .sort((a, b) => a.start - b.start || a.tone - b.tone),
    },
    note,
  }
}

export function quantizeProjectNotes(project: SongProject, gridTicks = GRID_SNAP_TICKS) {
  let changedCount = 0
  const notes = project.notes
    .map((note) => {
      const nextNote = sanitizeNote({
        ...note,
        start: snapTickToGrid(note.start, gridTicks),
        duration: Math.max(gridTicks, snapTickToGrid(note.duration, gridTicks)),
      })
      if (nextNote.start !== note.start || nextNote.duration !== note.duration) {
        changedCount += 1
      }
      return nextNote
    })
    .sort((a, b) => a.start - b.start || a.tone - b.tone)
  return {
    project: {
      ...project,
      parts: notes.reduce((parts, note) => expandPartForNote(parts, note), project.parts),
      notes,
    },
    changedCount,
  }
}

export function applyLyricLineToProject(project: SongProject, lyricLine: string) {
  const tokens = tokenizeLyricLine(lyricLine)
  if (tokens.length === 0) {
    return { project, tokens, appliedCount: 0 }
  }
  const orderedNotes = [...project.notes].sort((a, b) => a.start - b.start || a.tone - b.tone)
  const lyricById = new Map(
    orderedNotes.slice(0, tokens.length).map((note, index) => [note.id, tokens[index]]),
  )
  return {
    project: {
      ...project,
      notes: project.notes.map((note) =>
        lyricById.has(note.id) ? sanitizeNote({ ...note, lyric: lyricById.get(note.id) ?? note.lyric }) : note,
      ),
    },
    tokens,
    appliedCount: lyricById.size,
  }
}

export function tokenizeLyricLine(lyricLine: string) {
  const tokens: string[] = []
  for (const chunk of lyricLine.trim().split(/\s+/)) {
    const parts = splitLyricChunk(chunk)
    tokens.push(...parts)
  }
  return tokens
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
  const note = sanitizeNote({
    id: makeId('note'),
    trackId: noteInput.part.trackId,
    partId: noteInput.part.id,
    start: noteInput.start,
    duration: noteInput.duration,
    tone: noteInput.tone,
    lyric: noteInput.lyric,
  })
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

function expandPartForNote(parts: VoicePart[], note: SongNote) {
  return parts.map((part) =>
    part.id === note.partId
      ? {
          ...part,
          duration: Math.max(part.duration, note.start - part.start + note.duration),
        }
      : part,
  )
}

function sanitizeNote(note: SongNote): SongNote {
  return {
    ...note,
    start: Math.max(0, Math.round(note.start)),
    duration: Math.max(GRID_SNAP_TICKS, Math.round(note.duration)),
    tone: clampTone(note.tone),
    lyric: note.lyric.trim() || '라',
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
  return snapTickToGrid(tick, GRID_SNAP_TICKS)
}

export function snapTickToGrid(tick: number, gridTicks = GRID_SNAP_TICKS) {
  return Math.max(0, Math.round(tick / gridTicks) * gridTicks)
}

function splitLyricChunk(chunk: string) {
  const clean = chunk.trim().replace(/[,.!?;:()[\]{}"“”'‘’]+/g, '')
  if (!clean) {
    return []
  }
  const segments = clean.match(/[가-힣]|[ぁ-ゖァ-ヺー]|[a-zA-Z]+|\d+/g)
  return segments?.map((segment) => segment.toLowerCase()) ?? []
}
