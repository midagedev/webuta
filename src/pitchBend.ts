import type { NotePitchBend, NotePitchPoint, SongNote } from './types'
import { noteVibratoCentsAt } from './vibrato'

const MAX_PITCH_BEND_CENTS = 2400

export function normalizeNotePitchBend(pitchBend: Partial<NotePitchBend> | null | undefined): NotePitchBend {
  const points = Array.isArray(pitchBend?.points) ? pitchBend.points : []
  const normalizedPoints = normalizePitchPoints(points)
  const modes = Array.isArray(pitchBend?.modes) ? normalizePitchBendModes(pitchBend.modes, normalizedPoints.length - 1) : []
  const snapFirst = typeof pitchBend?.snapFirst === 'boolean' ? pitchBend.snapFirst : undefined
  return {
    points: normalizedPoints,
    ...(modes.length > 0 ? { modes } : {}),
    ...(snapFirst !== undefined ? { snapFirst } : {}),
  }
}

export function sanitizeOptionalNotePitchBend(pitchBend: Partial<NotePitchBend> | null | undefined) {
  if (!pitchBend) {
    return undefined
  }
  const normalized = normalizeNotePitchBend(pitchBend)
  return normalized.points.length > 0 ? normalized : undefined
}

export function notePitchBendCentsAt(note: SongNote, progress: number) {
  const pitchBend = normalizeNotePitchBend(note.pitchBend)
  const points = pitchBend.points
  if (points.length === 0) {
    return 0
  }
  const timePercent = clampNumber(progress * 100, 0, 100)
  if (timePercent <= points[0].timePercent) {
    return points[0].cents
  }
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (timePercent <= current.timePercent) {
      const span = Math.max(0.0001, current.timePercent - previous.timePercent)
      const mode = pitchBend.modes?.[index - 1]
      const ratio = pitchBendRatio((timePercent - previous.timePercent) / span, mode)
      return previous.cents + (current.cents - previous.cents) * ratio
    }
  }
  return points.at(-1)?.cents ?? 0
}

export function notePitchCentsAt(note: SongNote, progress: number, seconds: number) {
  return notePitchBendCentsAt(note, progress) + noteVibratoCentsAt(note, progress, seconds)
}

function normalizePitchPoints(points: unknown[]) {
  const byTime = new Map<number, NotePitchPoint>()
  for (const point of points) {
    if (!point || typeof point !== 'object' || Array.isArray(point)) {
      continue
    }
    const record = point as Record<string, unknown>
    const timePercent = clampNumber(record.timePercent, 0, 100)
    const cents = clampNumber(record.cents, -MAX_PITCH_BEND_CENTS, MAX_PITCH_BEND_CENTS)
    byTime.set(round(timePercent, 3), {
      timePercent: round(timePercent, 3),
      cents: round(cents, 3),
    })
  }
  return [...byTime.values()].sort((a, b) => a.timePercent - b.timePercent)
}

function normalizePitchBendModes(modes: unknown[], maxLength: number) {
  if (maxLength <= 0) {
    return []
  }
  return modes.slice(0, maxLength).map((mode) => sanitizeMode(mode))
}

function sanitizeMode(mode: unknown) {
  const value = String(mode ?? '').trim().slice(0, 12)
  return /^[a-z0-9_-]*$/iu.test(value) ? value : 's'
}

function pitchBendRatio(ratio: number, mode: string | undefined) {
  const value = clampNumber(ratio, 0, 1)
  switch (mode) {
    case 'i':
      return 1 - Math.cos((value * Math.PI) / 2)
    case 'o':
      return Math.sin((value * Math.PI) / 2)
    case 'io':
    case 'sp':
      return (1 - Math.cos(value * Math.PI)) / 2
    default:
      return value
  }
}

function clampNumber(value: unknown, min: number, max: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.max(min, Math.min(max, number))
}

function round(value: number, decimals: number) {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}
