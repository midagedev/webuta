import type { SongNote } from './types'

export const DEFAULT_NOTE_INTENSITY = 100
export const MIN_NOTE_INTENSITY = 0
export const MAX_NOTE_INTENSITY = 200
export const DEFAULT_NOTE_VELOCITY = 100
export const MIN_NOTE_VELOCITY = 0
export const MAX_NOTE_VELOCITY = 200
export const DEFAULT_NOTE_MODULATION = 0
export const MIN_NOTE_MODULATION = 0
export const MAX_NOTE_MODULATION = 100
const MAX_NOTE_FLAGS_LENGTH = 128

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

export function normalizeNoteVelocity(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_NOTE_VELOCITY
  }
  return Math.max(MIN_NOTE_VELOCITY, Math.min(MAX_NOTE_VELOCITY, Math.round(value)))
}

export function sanitizeOptionalNoteVelocity(value: unknown) {
  if (value === undefined || value === null) {
    return undefined
  }
  const velocity = normalizeNoteVelocity(value)
  return velocity === DEFAULT_NOTE_VELOCITY ? undefined : velocity
}

export function isValidNoteVelocity(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_NOTE_VELOCITY && value <= MAX_NOTE_VELOCITY
}

export function noteVelocityRate(note: Pick<SongNote, 'velocity'>) {
  return Math.max(0.25, Math.min(4, normalizeNoteVelocity(note.velocity) / 100))
}

export function normalizeNoteModulation(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_NOTE_MODULATION
  }
  return Math.max(MIN_NOTE_MODULATION, Math.min(MAX_NOTE_MODULATION, Math.round(value)))
}

export function sanitizeOptionalNoteModulation(value: unknown) {
  if (value === undefined || value === null) {
    return undefined
  }
  const modulation = normalizeNoteModulation(value)
  return modulation === DEFAULT_NOTE_MODULATION ? undefined : modulation
}

export function isValidNoteModulation(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_NOTE_MODULATION && value <= MAX_NOTE_MODULATION
}

export function sanitizeOptionalNoteFlags(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }
  const flags = value.replace(/[\r\n]/gu, ' ').trim().slice(0, MAX_NOTE_FLAGS_LENGTH)
  return flags || undefined
}

export function isValidNoteFlags(value: unknown) {
  return typeof value === 'string' && value.length <= MAX_NOTE_FLAGS_LENGTH && !/[\r\n]/u.test(value)
}
