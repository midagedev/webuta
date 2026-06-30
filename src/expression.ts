import type { SongNote } from './types'

export const DEFAULT_NOTE_INTENSITY = 100
export const MIN_NOTE_INTENSITY = 0
export const MAX_NOTE_INTENSITY = 200

export function normalizeNoteIntensity(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_NOTE_INTENSITY
  }
  return Math.max(MIN_NOTE_INTENSITY, Math.min(MAX_NOTE_INTENSITY, Math.round(value)))
}

export function sanitizeOptionalNoteIntensity(value: unknown) {
  if (value === undefined || value === null) {
    return undefined
  }
  const intensity = normalizeNoteIntensity(value)
  return intensity === DEFAULT_NOTE_INTENSITY ? undefined : intensity
}

export function isValidNoteIntensity(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_NOTE_INTENSITY && value <= MAX_NOTE_INTENSITY
}

export function noteIntensityGain(note: Pick<SongNote, 'intensity'>) {
  return normalizeNoteIntensity(note.intensity) / 100
}
