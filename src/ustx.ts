import * as yaml from 'js-yaml'
import {
  TICKS_PER_BEAT,
  type NotePitchBend,
  type NoteVibrato,
  type SongNote,
  type SongProject,
  type TempoChange,
  type Track,
  type VoicePart,
} from './types'
import {
  normalizeNoteIntensity,
  normalizeNoteModulation,
  normalizeNoteVelocity,
  sanitizeOptionalNoteIntensity,
  sanitizeOptionalNoteModulation,
  sanitizeOptionalNoteVelocity,
} from './expression'
import { makeId } from './music'
import { normalizedTempoChanges } from './music'
import { sanitizeOptionalNotePitchBend } from './pitchBend'
import { normalizeNoteVibrato, sanitizeOptionalNoteVibrato } from './vibrato'

type AnyRecord = Record<string, unknown>

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: AnyRecord, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      return value
    }
  }
  return fallback
}

function numberField(record: AnyRecord, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return fallback
}

function arrayField(record: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value
    }
  }
  return []
}

function parseRawProject(text: string) {
  try {
    return { data: JSON.parse(text) as unknown, format: 'ustx-json' as const }
  } catch {
    return { data: yaml.load(text), format: 'ustx-yaml' as const }
  }
}

export function parseUstx(text: string, fileName = 'project.ustx'): SongProject {
  const { data, format } = parseRawProject(text)
  if (!isRecord(data)) {
    throw new Error('USTX root must be an object.')
  }

  const tempos = arrayField(data, ['tempos'])
  const firstTempo = isRecord(tempos[0]) ? tempos[0] : undefined
  const tempoChanges = parseUstxTempos(tempos, numberField(firstTempo ?? data, ['bpm'], 120))
  const timeSignatures = arrayField(data, ['time_signatures', 'timeSignatures'])
  const firstSignature = isRecord(timeSignatures[0]) ? timeSignatures[0] : undefined
  const rawTracks = arrayField(data, ['tracks'])
  const rawParts = arrayField(data, ['voice_parts', 'voiceParts'])

  const tracks: Track[] =
    rawTracks.length > 0
      ? rawTracks.map((item, index) => {
          const record = isRecord(item) ? item : {}
          return {
            id: `track-${index}`,
            name: stringField(record, ['TrackName', 'track_name', 'trackName'], `Track ${index + 1}`),
            color: stringField(record, ['TrackColor', 'track_color', 'trackColor'], 'Blue'),
            singer: stringField(record, ['singer'], ''),
            phonemizer: stringField(record, ['phonemizer'], ''),
          }
        })
      : [{ id: 'track-0', name: 'Main Vocal', color: 'Blue' }]

  const parts: VoicePart[] = []
  const notes: SongNote[] = []

  rawParts.forEach((item, partIndex) => {
    const record = isRecord(item) ? item : {}
    const trackNo = Math.max(0, Math.min(tracks.length - 1, numberField(record, ['track_no', 'trackNo'], 0)))
    const partStart = numberField(record, ['position'], 0)
    const partId = `part-${partIndex}`
    const partNotes = arrayField(record, ['notes'])
    const parsedNotes = partNotes
      .map((noteItem, noteIndex) => {
        const noteRecord = isRecord(noteItem) ? noteItem : {}
        const start = partStart + numberField(noteRecord, ['position'], noteIndex * TICKS_PER_BEAT)
        const duration = Math.max(10, numberField(noteRecord, ['duration'], TICKS_PER_BEAT))
        const pitchBend = parseUstxPitchBend(noteRecord, start, duration, tempoChanges)
        const vibrato = parseUstxVibrato(noteRecord)
        const expressions = parseUstxPhonemeExpressions(noteRecord)
        return {
          id: `note-${partIndex}-${noteIndex}`,
          trackId: tracks[trackNo].id,
          partId,
          start,
          duration,
          tone: numberField(noteRecord, ['tone'], 60),
          lyric: stringField(noteRecord, ['lyric'], 'la'),
          ...expressions,
          ...(pitchBend ? { pitchBend } : {}),
          ...(vibrato ? { vibrato } : {}),
        }
      })
      .filter((note) => note.duration > 0)

    const inferredDuration =
      parsedNotes.reduce((max, note) => Math.max(max, note.start - partStart + note.duration), 0) ||
      TICKS_PER_BEAT * 4

    parts.push({
      id: partId,
      trackId: tracks[trackNo].id,
      name: stringField(record, ['name'], `Part ${partIndex + 1}`),
      start: partStart,
      duration: Math.max(numberField(record, ['duration'], inferredDuration), inferredDuration),
    })
    notes.push(...parsedNotes)
  })

  if (parts.length === 0) {
    const partId = makeId('part')
    parts.push({
      id: partId,
      trackId: tracks[0].id,
      name: 'Verse',
      start: 0,
      duration: TICKS_PER_BEAT * 4,
    })
  }

  return {
    id: makeId('project'),
    name: stringField(data, ['name'], fileName.replace(/\.[^.]+$/, '') || 'Imported Project'),
    comment: stringField(data, ['comment'], ''),
    bpm: tempoChanges[0]?.bpm ?? numberField(firstTempo ?? data, ['bpm'], 120),
    tempoChanges,
    beatPerBar: numberField(firstSignature ?? data, ['beat_per_bar', 'beatPerBar'], 4),
    beatUnit: numberField(firstSignature ?? data, ['beat_unit', 'beatUnit'], 4),
    tracks,
    parts,
    notes,
    source: {
      fileName,
      format,
    },
  }
}

export function serializeUstx(project: SongProject) {
  const tracks = project.tracks.map((track) => ({
    singer: track.singer ?? '',
    phonemizer: track.phonemizer ?? '',
    track_name: track.name,
    track_color: track.color,
    mute: false,
    solo: false,
    volume: 0,
    pan: 0,
  }))

  const voiceParts = project.parts.map((part) => {
    const trackNo = Math.max(0, project.tracks.findIndex((track) => track.id === part.trackId))
    return {
      name: part.name,
      comment: '',
      track_no: trackNo,
      position: part.start,
      duration: part.duration,
      notes: project.notes
        .filter((note) => note.partId === part.id)
        .sort((a, b) => a.start - b.start)
        .map((note) => {
          const phonemeExpressions = serializeUstxPhonemeExpressions(note)
          const pitch = serializeUstxPitchBend(note.pitchBend, note.start, note.duration, project)
          return {
            position: note.start - part.start,
            duration: note.duration,
            tone: note.tone,
            lyric: note.lyric,
            ...(phonemeExpressions.length > 0 ? { phonemeExpressions } : {}),
            ...(pitch ? { pitch } : {}),
            ...(note.vibrato ? { vibrato: serializeUstxVibrato(note.vibrato) } : {}),
          }
        }),
      curves: [],
    }
  })

  return yaml.dump(
    {
      name: project.name,
      comment: project.comment,
      output_dir: 'Vocal',
      cache_dir: 'UCache',
      ustx_version: '0.9',
      time_signatures: [
        {
          bar_position: 0,
          beat_per_bar: project.beatPerBar,
          beat_unit: project.beatUnit,
        },
      ],
      tempos: normalizedTempoChanges(project).map((tempo) => ({
        position: tempo.position,
        bpm: tempo.bpm,
      })),
      tracks,
      voice_parts: voiceParts,
      wave_parts: [],
    },
    {
      noRefs: true,
      lineWidth: -1,
      sortKeys: false,
    },
  )
}

function parseUstxTempos(values: unknown[], fallbackBpm: number): TempoChange[] {
  const tempos = values
    .map((item) => {
      const record = isRecord(item) ? item : {}
      return {
        position: Math.max(0, Math.round(numberField(record, ['position'], 0))),
        bpm: numberField(record, ['bpm'], fallbackBpm),
      }
    })
    .filter((tempo) => Number.isFinite(tempo.bpm) && tempo.bpm > 0)
    .sort((a, b) => a.position - b.position)
  const withFallback = tempos[0]?.position === 0 ? tempos : [{ position: 0, bpm: fallbackBpm }, ...tempos]
  const byPosition = new Map<number, number>()
  for (const tempo of withFallback) {
    byPosition.set(tempo.position, tempo.bpm)
  }
  return [...byPosition.entries()]
    .map(([position, bpm]) => ({ position, bpm }))
    .sort((a, b) => a.position - b.position)
}

function parseUstxVibrato(record: AnyRecord): NoteVibrato | undefined {
  const raw = record.vibrato
  if (!isRecord(raw)) {
    return undefined
  }
  const depthCents = numberField(raw, ['depth', 'depth_cents', 'depthCents'], 0)
  const periodMs = numberField(raw, ['period', 'period_ms', 'periodMs'], 185)
  const length = numberField(raw, ['length'], 48)
  const startPercent = length <= 1 ? (1 - length) * 100 : 100 - length
  return sanitizeOptionalNoteVibrato({
    enabled: depthCents > 0 && length > 0,
    depthCents,
    rateHz: periodMs > 0 ? 1000 / periodMs : undefined,
    startPercent,
  })
}

function parseUstxPhonemeExpressions(record: AnyRecord) {
  const rawExpressions = arrayField(record, ['phonemeExpressions', 'phoneme_expressions'])
  const intensity = sanitizeOptionalNoteIntensity(phonemeExpressionValue(rawExpressions, 'vol'))
  const velocity = sanitizeOptionalNoteVelocity(phonemeExpressionValue(rawExpressions, 'vel'))
  const modulation = sanitizeOptionalNoteModulation(phonemeExpressionValue(rawExpressions, 'mod'))
  return {
    ...(intensity !== undefined ? { intensity } : {}),
    ...(velocity !== undefined ? { velocity } : {}),
    ...(modulation !== undefined ? { modulation } : {}),
  }
}

function phonemeExpressionValue(expressions: unknown[], abbr: string) {
  const matches = expressions
    .map((item, order) => ({
      record: isRecord(item) ? item : {},
      order,
    }))
    .filter(({ record }) => stringField(record, ['abbr']).toLowerCase() === abbr)
    .map(({ record, order }) => ({
      value: numberField(record, ['value'], Number.NaN),
      index: optionalNumberField(record, ['index']),
      order,
    }))
    .filter((expression) => Number.isFinite(expression.value))
    .sort((left, right) => expressionIndexScore(left.index) - expressionIndexScore(right.index) || left.order - right.order)
  return matches[0]?.value
}

function expressionIndexScore(index: number | undefined) {
  if (index === 0 || index === undefined) {
    return 0
  }
  return Math.abs(index) + 1
}

function optionalNumberField(record: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return undefined
}

function optionalBooleanField(record: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') {
        return true
      }
      if (normalized === 'false') {
        return false
      }
    }
  }
  return undefined
}

function parseUstxPitchBend(
  record: AnyRecord,
  noteStart: number,
  duration: number,
  tempoChanges: TempoChange[],
): NotePitchBend | undefined {
  const rawPitch = record.pitch
  if (!isRecord(rawPitch)) {
    return undefined
  }
  const durationMs = durationTicksToMilliseconds(noteStart, duration, tempoChanges)
  if (durationMs <= 0) {
    return undefined
  }
  const rawPoints = arrayField(rawPitch, ['data'])
  const parsedPoints = rawPoints.flatMap((item) => {
    const pointRecord = isRecord(item) ? item : {}
    const x = numberField(pointRecord, ['x', 'X'], Number.NaN)
    const y = numberField(pointRecord, ['y', 'Y'], Number.NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return []
    }
    return [
      {
        point: {
          timePercent: (x / durationMs) * 100,
          cents: y * 10,
        },
        shape: sanitizeUstxPitchShape(stringField(pointRecord, ['shape'], 'io')),
      },
    ]
  })
  const points = parsedPoints.map((item) => item.point)
  const modes = parsedPoints.map((item) => item.shape).slice(0, Math.max(0, points.length - 1))
  const snapFirst = optionalBooleanField(rawPitch, ['snap_first', 'snapFirst'])
  return sanitizeOptionalNotePitchBend({
    points,
    ...(modes.length > 0 ? { modes } : {}),
    ...(snapFirst !== undefined ? { snapFirst } : {}),
  })
}

function serializeUstxPitchBend(
  pitchBend: NotePitchBend | undefined,
  noteStart: number,
  duration: number,
  project: SongProject,
) {
  const normalized = sanitizeOptionalNotePitchBend(pitchBend)
  if (!normalized) {
    return undefined
  }
  const durationMs = durationTicksToMilliseconds(noteStart, duration, normalizedTempoChanges(project))
  if (durationMs <= 0) {
    return undefined
  }
  return {
    data: normalized.points.map((point, index) => ({
      x: roundPitchValue((point.timePercent / 100) * durationMs),
      y: roundPitchValue(point.cents / 10),
      shape: sanitizeUstxPitchShape(normalized.modes?.[index] ?? 'io'),
    })),
    snap_first: typeof normalized.snapFirst === 'boolean' ? normalized.snapFirst : false,
  }
}

function durationTicksToMilliseconds(startTick: number, durationTicks: number, tempoChanges: TempoChange[]) {
  const start = Math.max(0, Math.round(startTick))
  const end = Math.max(start, start + Math.round(durationTicks))
  const tempos = normalizedTempoList(tempoChanges)
  let cursorTick = 0
  let cursorMs = 0
  let bpm = tempos[0]?.bpm ?? 120
  let startMs = 0
  let endMs = 0

  for (const tempo of tempos.slice(1)) {
    if (tempo.position >= end) {
      break
    }
    const nextMs = cursorMs + ticksToMilliseconds(tempo.position - cursorTick, bpm)
    if (cursorTick <= start && start < tempo.position) {
      startMs = cursorMs + ticksToMilliseconds(start - cursorTick, bpm)
    }
    cursorTick = tempo.position
    cursorMs = nextMs
    bpm = tempo.bpm
  }

  if (cursorTick <= start) {
    startMs = cursorMs + ticksToMilliseconds(start - cursorTick, bpm)
  }
  endMs = cursorMs + ticksToMilliseconds(end - cursorTick, bpm)
  return Math.max(0, endMs - startMs)
}

function normalizedTempoList(tempoChanges: TempoChange[]) {
  const byPosition = new Map<number, number>()
  byPosition.set(0, 120)
  for (const tempo of tempoChanges) {
    const position = Math.max(0, Math.round(tempo.position))
    const bpm = Number.isFinite(tempo.bpm) && tempo.bpm > 0 ? tempo.bpm : 120
    byPosition.set(position, bpm)
  }
  return [...byPosition.entries()]
    .map(([position, bpm]) => ({ position, bpm }))
    .sort((a, b) => a.position - b.position)
}

function ticksToMilliseconds(ticks: number, bpm: number) {
  return (ticks / TICKS_PER_BEAT) * (60_000 / bpm)
}

function sanitizeUstxPitchShape(shape: unknown) {
  const value = String(shape ?? '').trim().toLowerCase()
  return value === 'l' || value === 'i' || value === 'o' || value === 'io' || value === 'sp' ? value : 'io'
}

function roundPitchValue(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return Math.abs(rounded) < 0.0005 ? 0 : rounded
}

function serializeUstxPhonemeExpressions(note: SongNote) {
  const expressions = []
  const velocity = sanitizeOptionalNoteVelocity(note.velocity)
  const intensity = sanitizeOptionalNoteIntensity(note.intensity)
  const modulation = sanitizeOptionalNoteModulation(note.modulation)
  if (velocity !== undefined) {
    expressions.push(ustxPhonemeExpression('vel', normalizeNoteVelocity(velocity)))
  }
  if (intensity !== undefined) {
    expressions.push(ustxPhonemeExpression('vol', normalizeNoteIntensity(intensity)))
  }
  if (modulation !== undefined) {
    expressions.push(ustxPhonemeExpression('mod', normalizeNoteModulation(modulation)))
  }
  return expressions
}

function ustxPhonemeExpression(abbr: string, value: number) {
  return {
    index: 0,
    abbr,
    value,
  }
}

function serializeUstxVibrato(vibrato: NoteVibrato) {
  const normalized = normalizeNoteVibrato(vibrato)
  return {
    length: Math.round(100 - normalized.startPercent),
    period: Math.round(1000 / normalized.rateHz),
    depth: normalized.enabled ? Math.round(normalized.depthCents) : 0,
    in: 10,
    out: 10,
    shift: 0,
    drift: 0,
  }
}
