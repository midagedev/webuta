import * as yaml from 'js-yaml'
import { TICKS_PER_BEAT, type SongNote, type SongProject, type Track, type VoicePart } from './types'
import { makeId } from './music'

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
        return {
          id: `note-${partIndex}-${noteIndex}`,
          trackId: tracks[trackNo].id,
          partId,
          start: partStart + numberField(noteRecord, ['position'], noteIndex * TICKS_PER_BEAT),
          duration: Math.max(10, numberField(noteRecord, ['duration'], TICKS_PER_BEAT)),
          tone: numberField(noteRecord, ['tone'], 60),
          lyric: stringField(noteRecord, ['lyric'], 'la'),
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
    bpm: numberField(firstTempo ?? data, ['bpm'], 120),
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
        .map((note) => ({
          position: note.start - part.start,
          duration: note.duration,
          tone: note.tone,
          lyric: note.lyric,
        })),
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
      tempos: [
        {
          position: 0,
          bpm: project.bpm,
        },
      ],
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
