import type { SongNote, SongProject, TempoChange, Track, VoicePart } from './types'
import { isValidNoteEnvelope } from './envelope'
import { isValidNoteIntensity } from './expression'
import { sanitizeOptionalNotePitchBend } from './pitchBend'
import { sanitizeOptionalNoteVibrato } from './vibrato'

export const WEBUTA_PROJECT_FORMAT = 'webuta-project'
export const WEBUTA_PROJECT_VERSION = 1

export type WebutaProjectFile = {
  format: typeof WEBUTA_PROJECT_FORMAT
  version: typeof WEBUTA_PROJECT_VERSION
  app: 'WebUtau'
  exportedAt: string
  project: SongProject
}

export function serializeWebutaProject(project: SongProject, exportedAt = new Date().toISOString()) {
  const payload: WebutaProjectFile = {
    format: WEBUTA_PROJECT_FORMAT,
    version: WEBUTA_PROJECT_VERSION,
    app: 'WebUtau',
    exportedAt,
    project,
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function parseWebutaProject(text: string, fileName = 'project.webutau.json') {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('WebUtau project must be a JSON file.')
  }

  const project = extractProject(parsed)
  if (!project) {
    throw new Error('WebUtau project file is missing a valid project snapshot.')
  }

  return {
    ...cloneProject(project),
    source: {
      fileName,
      format: 'webuta' as const,
    },
  }
}

export function isWebutaProjectFileName(fileName: string) {
  return /\.webutau\.json$/iu.test(fileName)
}

export function isSongProject(value: unknown): value is SongProject {
  if (!isObject(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.comment === 'string' &&
    isFiniteNumber(value.bpm) &&
    (value.tempoChanges === undefined || (Array.isArray(value.tempoChanges) && value.tempoChanges.every(isTempoChange))) &&
    isFiniteNumber(value.beatPerBar) &&
    isFiniteNumber(value.beatUnit) &&
    Array.isArray(value.tracks) &&
    value.tracks.every(isTrack) &&
    Array.isArray(value.parts) &&
    value.parts.every(isVoicePart) &&
    Array.isArray(value.notes) &&
    value.notes.every(isSongNote) &&
    (value.source === undefined || isProjectSource(value.source))
  )
}

function extractProject(value: unknown) {
  if (isSongProject(value)) {
    return value
  }
  if (!isObject(value)) {
    return null
  }
  if (
    value.format === WEBUTA_PROJECT_FORMAT &&
    value.version === WEBUTA_PROJECT_VERSION &&
    value.app === 'WebUtau' &&
    typeof value.exportedAt === 'string' &&
    isSongProject(value.project)
  ) {
    return value.project
  }
  return null
}

function cloneProject(project: SongProject): SongProject {
  return JSON.parse(JSON.stringify(project)) as SongProject
}

function isTrack(value: unknown): value is Track {
  if (!isObject(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.color === 'string' &&
    (value.singer === undefined || typeof value.singer === 'string') &&
    (value.phonemizer === undefined || typeof value.phonemizer === 'string')
  )
}

function isVoicePart(value: unknown): value is VoicePart {
  if (!isObject(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.trackId === 'string' &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.duration)
  )
}

function isTempoChange(value: unknown): value is TempoChange {
  if (!isObject(value)) {
    return false
  }
  return isFiniteNumber(value.position) && isFiniteNumber(value.bpm)
}

function isSongNote(value: unknown): value is SongNote {
  if (!isObject(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.trackId === 'string' &&
    typeof value.partId === 'string' &&
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.duration) &&
    isFiniteNumber(value.tone) &&
    typeof value.lyric === 'string' &&
    (value.intensity === undefined || isValidNoteIntensity(value.intensity)) &&
    (value.envelope === undefined || isValidNoteEnvelope(value.envelope)) &&
    (value.vibrato === undefined || isNoteVibrato(value.vibrato)) &&
    (value.pitchBend === undefined || isNotePitchBend(value.pitchBend))
  )
}

function isNoteVibrato(value: unknown) {
  if (!isObject(value)) {
    return false
  }
  return sanitizeOptionalNoteVibrato(value) !== undefined
}

function isNotePitchBend(value: unknown) {
  if (!isObject(value)) {
    return false
  }
  return sanitizeOptionalNotePitchBend(value) !== undefined
}

function isProjectSource(value: unknown) {
  if (!isObject(value)) {
    return false
  }
  return (
    typeof value.fileName === 'string' &&
    (value.format === 'ust' || value.format === 'ustx-yaml' || value.format === 'ustx-json' || value.format === 'webuta')
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
