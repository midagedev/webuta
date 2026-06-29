import type { SongNote, SongProject, Track, VoicePart } from './types'

const PROJECT_STORAGE_KEY = 'webuta.project.v1'

type StoredProject = {
  version: 1
  savedAt: string
  project: SongProject
}

export function loadSavedProject() {
  const storage = getStorage()
  if (!storage) {
    return null
  }
  const raw = storage.getItem(PROJECT_STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    return isStoredProject(parsed) ? parsed.project : null
  } catch {
    return null
  }
}

export function saveProject(project: SongProject) {
  const storage = getStorage()
  if (!storage) {
    return false
  }
  const payload: StoredProject = {
    version: 1,
    savedAt: new Date().toISOString(),
    project,
  }
  try {
    storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function clearSavedProject() {
  const storage = getStorage()
  if (!storage) {
    return false
  }
  try {
    storage.removeItem(PROJECT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

function getStorage() {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isStoredProject(value: unknown): value is StoredProject {
  if (!isObject(value)) {
    return false
  }
  return value.version === 1 && typeof value.savedAt === 'string' && isSongProject(value.project)
}

function isSongProject(value: unknown): value is SongProject {
  if (!isObject(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.comment === 'string' &&
    isFiniteNumber(value.bpm) &&
    isFiniteNumber(value.beatPerBar) &&
    isFiniteNumber(value.beatUnit) &&
    Array.isArray(value.tracks) &&
    value.tracks.every(isTrack) &&
    Array.isArray(value.parts) &&
    value.parts.every(isVoicePart) &&
    Array.isArray(value.notes) &&
    value.notes.every(isSongNote)
  )
}

function isTrack(value: unknown): value is Track {
  if (!isObject(value)) {
    return false
  }
  return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.color === 'string'
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
    typeof value.lyric === 'string'
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
