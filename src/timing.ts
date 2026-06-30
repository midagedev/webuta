import type { NoteTiming } from './types'

const MAX_TIMING_MS = 5000
const MIN_OVERLAP_MS = -1000

export function normalizeNoteTiming(value: unknown): NoteTiming {
  if (!isRecord(value)) {
    return {}
  }
  return {
    ...(value.sampleStartMs !== undefined ? { sampleStartMs: clampTiming(readNumber(value.sampleStartMs, 0), 0, MAX_TIMING_MS) } : {}),
    ...(value.preutteranceMs !== undefined ? { preutteranceMs: clampTiming(readNumber(value.preutteranceMs, 0), 0, MAX_TIMING_MS) } : {}),
    ...(value.voiceOverlapMs !== undefined
      ? { voiceOverlapMs: clampTiming(readNumber(value.voiceOverlapMs, 0), MIN_OVERLAP_MS, MAX_TIMING_MS) }
      : {}),
  }
}

export function sanitizeOptionalNoteTiming(value: unknown) {
  if (value === undefined || value === null) {
    return undefined
  }
  const timing = normalizeNoteTiming(value)
  return Object.keys(timing).length > 0 ? timing : undefined
}

export function isValidNoteTiming(value: unknown) {
  if (!isRecord(value)) {
    return false
  }
  return (
    (value.sampleStartMs !== undefined || value.preutteranceMs !== undefined || value.voiceOverlapMs !== undefined) &&
    (value.sampleStartMs === undefined || isFiniteTiming(value.sampleStartMs, 0, MAX_TIMING_MS)) &&
    (value.preutteranceMs === undefined || isFiniteTiming(value.preutteranceMs, 0, MAX_TIMING_MS)) &&
    (value.voiceOverlapMs === undefined || isFiniteTiming(value.voiceOverlapMs, MIN_OVERLAP_MS, MAX_TIMING_MS))
  )
}

export function parseUstNoteTiming(fields: {
  startPoint?: number
  preutterance?: number
  voiceOverlap?: number
}) {
  return sanitizeOptionalNoteTiming({
    ...(fields.startPoint !== undefined ? { sampleStartMs: fields.startPoint } : {}),
    ...(fields.preutterance !== undefined ? { preutteranceMs: fields.preutterance } : {}),
    ...(fields.voiceOverlap !== undefined ? { voiceOverlapMs: fields.voiceOverlap } : {}),
  })
}

export function formatTimingNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/u, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isFiniteTiming(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function clampTiming(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)))
}
