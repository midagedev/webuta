import { isSongProject } from './projectFile'
import type { SongProject } from './types'

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
