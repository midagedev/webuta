import type { NoteEnvelope, SongNote } from './types'

export const DEFAULT_NOTE_ENVELOPE: NoteEnvelope = {
  p1Ms: 0,
  p2Ms: 5,
  p3Ms: 35,
  v1: 0,
  v2: 100,
  v3: 100,
  v4: 0,
}

const MAX_ENVELOPE_TIME_MS = 5000
const MAX_ENVELOPE_LEVEL = 200

export function parseUstEnvelope(value: string) {
  if (!value.trim()) {
    return undefined
  }
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && item !== '%')
    .map(Number)
  if (values.length < 7 || values.slice(0, 7).some((item) => !Number.isFinite(item))) {
    return undefined
  }
  return sanitizeOptionalNoteEnvelope({
    p1Ms: values[0],
    p2Ms: values[1],
    p3Ms: values[2],
    v1: values[3],
    v2: values[4],
    v3: values[5],
    v4: values[6],
    ...(Number.isFinite(values[7]) ? { p4Ms: values[7] } : {}),
    ...(Number.isFinite(values[8]) ? { p5Ms: values[8] } : {}),
    ...(Number.isFinite(values[9]) ? { v5: values[9] } : {}),
  })
}

export function serializeNoteEnvelope(envelope: NoteEnvelope) {
  const normalized = normalizeNoteEnvelope(envelope)
  const base = [
    normalized.p1Ms,
    normalized.p2Ms,
    normalized.p3Ms,
    normalized.v1,
    normalized.v2,
    normalized.v3,
    normalized.v4,
  ].map(formatEnvelopeNumber)
  if (normalized.p4Ms !== undefined || normalized.p5Ms !== undefined || normalized.v5 !== undefined) {
    return [
      ...base,
      '%',
      formatEnvelopeNumber(normalized.p4Ms ?? 0),
      formatEnvelopeNumber(normalized.p5Ms ?? 0),
      formatEnvelopeNumber(normalized.v5 ?? normalized.v4),
    ].join(',')
  }
  return base.join(',')
}

export function normalizeNoteEnvelope(value: unknown): NoteEnvelope {
  if (!isRecord(value)) {
    return { ...DEFAULT_NOTE_ENVELOPE }
  }
  const normalized: NoteEnvelope = {
    p1Ms: clampEnvelopeTime(readNumber(value.p1Ms, DEFAULT_NOTE_ENVELOPE.p1Ms)),
    p2Ms: clampEnvelopeTime(readNumber(value.p2Ms, DEFAULT_NOTE_ENVELOPE.p2Ms)),
    p3Ms: clampEnvelopeTime(readNumber(value.p3Ms, DEFAULT_NOTE_ENVELOPE.p3Ms)),
    v1: clampEnvelopeLevel(readNumber(value.v1, DEFAULT_NOTE_ENVELOPE.v1)),
    v2: clampEnvelopeLevel(readNumber(value.v2, DEFAULT_NOTE_ENVELOPE.v2)),
    v3: clampEnvelopeLevel(readNumber(value.v3, DEFAULT_NOTE_ENVELOPE.v3)),
    v4: clampEnvelopeLevel(readNumber(value.v4, DEFAULT_NOTE_ENVELOPE.v4)),
  }
  if (value.p4Ms !== undefined) {
    normalized.p4Ms = clampEnvelopeTime(readNumber(value.p4Ms, 0))
  }
  if (value.p5Ms !== undefined) {
    normalized.p5Ms = clampEnvelopeTime(readNumber(value.p5Ms, 0))
  }
  if (value.v5 !== undefined) {
    normalized.v5 = clampEnvelopeLevel(readNumber(value.v5, normalized.v4))
  }
  return normalized
}

export function sanitizeOptionalNoteEnvelope(value: unknown) {
  if (value === undefined || value === null) {
    return undefined
  }
  const envelope = normalizeNoteEnvelope(value)
  return envelopesEqual(envelope, DEFAULT_NOTE_ENVELOPE) ? undefined : envelope
}

export function isValidNoteEnvelope(value: unknown) {
  if (!isRecord(value)) {
    return false
  }
  return (
    isFiniteEnvelopeTime(value.p1Ms) &&
    isFiniteEnvelopeTime(value.p2Ms) &&
    isFiniteEnvelopeTime(value.p3Ms) &&
    isFiniteEnvelopeLevel(value.v1) &&
    isFiniteEnvelopeLevel(value.v2) &&
    isFiniteEnvelopeLevel(value.v3) &&
    isFiniteEnvelopeLevel(value.v4) &&
    (value.p4Ms === undefined || isFiniteEnvelopeTime(value.p4Ms)) &&
    (value.p5Ms === undefined || isFiniteEnvelopeTime(value.p5Ms)) &&
    (value.v5 === undefined || isFiniteEnvelopeLevel(value.v5))
  )
}

export function noteEnvelopeGainAt(note: Pick<SongNote, 'envelope'>, progressSeconds: number, durationSeconds: number) {
  if (!note.envelope) {
    return 1
  }
  const envelope = normalizeNoteEnvelope(note.envelope)
  const duration = Math.max(0.001, durationSeconds)
  const p1 = clamp(envelope.p1Ms / 1000, 0, duration)
  const p2 = clamp(p1 + envelope.p2Ms / 1000, p1, duration)
  const p3 = clamp(duration - envelope.p3Ms / 1000, p2, duration)
  const points = [
    { time: 0, gain: envelope.v1 / 100 },
    { time: p1, gain: envelope.v1 / 100 },
    { time: p2, gain: envelope.v2 / 100 },
    { time: p3, gain: envelope.v3 / 100 },
    { time: duration, gain: envelope.v4 / 100 },
  ]
  const time = clamp(progressSeconds, 0, duration)
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const next = points[index]
    if (time <= next.time) {
      const span = Math.max(0.001, next.time - previous.time)
      const ratio = clamp((time - previous.time) / span, 0, 1)
      return previous.gain + (next.gain - previous.gain) * ratio
    }
  }
  return points.at(-1)?.gain ?? 1
}

function envelopesEqual(left: NoteEnvelope, right: NoteEnvelope) {
  return (
    left.p1Ms === right.p1Ms &&
    left.p2Ms === right.p2Ms &&
    left.p3Ms === right.p3Ms &&
    left.v1 === right.v1 &&
    left.v2 === right.v2 &&
    left.v3 === right.v3 &&
    left.v4 === right.v4 &&
    left.p4Ms === right.p4Ms &&
    left.p5Ms === right.p5Ms &&
    left.v5 === right.v5
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isFiniteEnvelopeTime(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ENVELOPE_TIME_MS
}

function isFiniteEnvelopeLevel(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ENVELOPE_LEVEL
}

function clampEnvelopeTime(value: number) {
  return Math.round(clamp(value, 0, MAX_ENVELOPE_TIME_MS))
}

function clampEnvelopeLevel(value: number) {
  return Math.round(clamp(value, 0, MAX_ENVELOPE_LEVEL))
}

function formatEnvelopeNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/u, '')
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
