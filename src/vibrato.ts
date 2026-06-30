import type { NoteVibrato, SongNote } from './types'

export const DEFAULT_NOTE_VIBRATO: NoteVibrato = {
  enabled: true,
  depthCents: 16,
  rateHz: 5.4,
  startPercent: 52,
}

export function normalizeNoteVibrato(vibrato: Partial<NoteVibrato> | null | undefined): NoteVibrato {
  return {
    enabled: vibrato?.enabled ?? DEFAULT_NOTE_VIBRATO.enabled,
    depthCents: clampNumber(vibrato?.depthCents, 0, 80, DEFAULT_NOTE_VIBRATO.depthCents),
    rateHz: clampNumber(vibrato?.rateHz, 3, 9, DEFAULT_NOTE_VIBRATO.rateHz),
    startPercent: clampNumber(vibrato?.startPercent, 0, 90, DEFAULT_NOTE_VIBRATO.startPercent),
  }
}

export function sanitizeOptionalNoteVibrato(vibrato: Partial<NoteVibrato> | null | undefined) {
  if (!vibrato) {
    return undefined
  }
  return normalizeNoteVibrato(vibrato)
}

export function noteVibratoCentsAt(note: SongNote, progress: number, seconds: number) {
  const vibrato = normalizeNoteVibrato(note.vibrato)
  if (!vibrato.enabled || vibrato.depthCents <= 0) {
    return 0
  }
  const start = vibrato.startPercent / 100
  if (progress < start || progress > 0.98) {
    return 0
  }
  const ramp = smoothstep(Math.min(1, Math.max(0, (progress - start) / 0.18)))
  return Math.sin(seconds * Math.PI * 2 * vibrato.rateHz) * vibrato.depthCents * ramp
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, number))
}

function smoothstep(value: number) {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}
