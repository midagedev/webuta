import { TICKS_PER_BEAT, type SongNote, type SongProject } from './types'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToHz(tone: number) {
  return 440 * 2 ** ((tone - 69) / 12)
}

export function toneName(tone: number) {
  const name = NOTE_NAMES[((tone % 12) + 12) % 12]
  const octave = Math.floor(tone / 12) - 1
  return `${name}${octave}`
}

export function ticksToSeconds(ticks: number, bpm: number) {
  return (ticks / TICKS_PER_BEAT) * (60 / bpm)
}

export function secondsToTicks(seconds: number, bpm: number) {
  return Math.round((seconds / 60) * bpm * TICKS_PER_BEAT)
}

export function projectDurationTicks(project: SongProject) {
  const noteEnd = project.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0)
  const partEnd = project.parts.reduce((max, part) => Math.max(max, part.start + part.duration), 0)
  return Math.max(noteEnd, partEnd, TICKS_PER_BEAT * 4)
}

export function projectDurationSeconds(project: SongProject) {
  return ticksToSeconds(projectDurationTicks(project), project.bpm)
}

export function sortedNotes(notes: SongNote[]) {
  return [...notes].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start
    }
    return a.tone - b.tone
  })
}

export function clampTone(tone: number) {
  return Math.min(84, Math.max(48, Math.round(tone)))
}

export function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

export function sanitizeFileName(name: string) {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'webuta-song'
  )
}

export function pitchRange(notes: SongNote[]) {
  if (notes.length === 0) {
    return { min: 55, max: 76 }
  }
  const min = Math.min(...notes.map((note) => note.tone))
  const max = Math.max(...notes.map((note) => note.tone))
  return {
    min: Math.max(36, Math.min(min - 3, 60)),
    max: Math.min(96, Math.max(max + 3, 76)),
  }
}
