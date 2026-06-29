import type { SongProject } from './types'

const DEFAULT_HISTORY_LIMIT = 80

export type ProjectHistory = {
  past: SongProject[]
  present: SongProject
  future: SongProject[]
}

export function createProjectHistory(project: SongProject): ProjectHistory {
  return {
    past: [],
    present: project,
    future: [],
  }
}

export function commitProjectChange(
  history: ProjectHistory,
  update: SongProject | ((project: SongProject) => SongProject),
  limit = DEFAULT_HISTORY_LIMIT,
) {
  const nextProject = typeof update === 'function' ? update(history.present) : update
  if (nextProject === history.present) {
    return history
  }
  return {
    past: [...history.past, history.present].slice(-limit),
    present: nextProject,
    future: [],
  }
}

export function replacePresentProject(
  history: ProjectHistory,
  update: SongProject | ((project: SongProject) => SongProject),
) {
  const nextProject = typeof update === 'function' ? update(history.present) : update
  if (nextProject === history.present) {
    return history
  }
  return {
    ...history,
    present: nextProject,
  }
}

export function commitPresentFromSnapshot(history: ProjectHistory, snapshot: SongProject, limit = DEFAULT_HISTORY_LIMIT) {
  if (snapshot === history.present) {
    return history
  }
  return {
    past: [...history.past, snapshot].slice(-limit),
    present: history.present,
    future: [],
  }
}

export function replaceProjectHistory(project: SongProject): ProjectHistory {
  return createProjectHistory(project)
}

export function undoProjectChange(history: ProjectHistory) {
  const previous = history.past.at(-1)
  if (!previous) {
    return history
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoProjectChange(history: ProjectHistory) {
  const next = history.future[0]
  if (!next) {
    return history
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  }
}
