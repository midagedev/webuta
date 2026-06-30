import { TICKS_PER_BEAT, type SongNote, type SongProject, type TempoChange } from './types'

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

export function ticksToSecondsInProject(ticks: number, project: SongProject) {
  const targetTick = Math.max(0, Math.round(ticks))
  const tempos = normalizedTempoChanges(project)
  let seconds = 0
  let cursorTick = 0
  let bpm = tempos[0]?.bpm ?? project.bpm

  for (const tempo of tempos.slice(1)) {
    if (tempo.position >= targetTick) {
      break
    }
    seconds += ticksToSeconds(tempo.position - cursorTick, bpm)
    cursorTick = tempo.position
    bpm = tempo.bpm
  }

  return seconds + ticksToSeconds(targetTick - cursorTick, bpm)
}

export function durationTicksToSeconds(project: SongProject, startTick: number, durationTicks: number) {
  const start = Math.max(0, Math.round(startTick))
  const end = Math.max(start, start + Math.round(durationTicks))
  return ticksToSecondsInProject(end, project) - ticksToSecondsInProject(start, project)
}

export function secondsToTicksInProject(seconds: number, project: SongProject) {
  const targetSeconds = Math.max(0, seconds)
  const tempos = normalizedTempoChanges(project)
  let elapsedSeconds = 0
  let cursorTick = 0
  let bpm = tempos[0]?.bpm ?? project.bpm

  for (const tempo of tempos.slice(1)) {
    const segmentSeconds = ticksToSeconds(tempo.position - cursorTick, bpm)
    if (elapsedSeconds + segmentSeconds >= targetSeconds) {
      return cursorTick + secondsToTicks(targetSeconds - elapsedSeconds, bpm)
    }
    elapsedSeconds += segmentSeconds
    cursorTick = tempo.position
    bpm = tempo.bpm
  }

  return cursorTick + secondsToTicks(targetSeconds - elapsedSeconds, bpm)
}

export function normalizedTempoChanges(project: SongProject): TempoChange[] {
  const byPosition = new Map<number, number>()
  byPosition.set(0, sanitizeBpm(project.bpm))
  for (const tempo of project.tempoChanges ?? []) {
    const position = Math.max(0, Math.round(tempo.position))
    byPosition.set(position, sanitizeBpm(tempo.bpm))
  }
  byPosition.set(0, sanitizeBpm(project.bpm))
  return [...byPosition.entries()]
    .map(([position, bpm]) => ({ position, bpm }))
    .sort((a, b) => a.position - b.position)
}

export function projectDurationTicks(project: SongProject) {
  const noteEnd = project.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0)
  const partEnd = project.parts.reduce((max, part) => Math.max(max, part.start + part.duration), 0)
  return Math.max(noteEnd, partEnd, TICKS_PER_BEAT * 4)
}

export function projectDurationSeconds(project: SongProject) {
  return ticksToSecondsInProject(projectDurationTicks(project), project)
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

function sanitizeBpm(bpm: number) {
  return Number.isFinite(bpm) && bpm > 0 ? bpm : 120
}
