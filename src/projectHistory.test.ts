import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import {
  commitPresentFromSnapshot,
  commitProjectChange,
  createProjectHistory,
  redoProjectChange,
  replacePresentProject,
  undoProjectChange,
} from './projectHistory'

describe('project history', () => {
  it('undoes and redoes committed project changes', () => {
    const history = createProjectHistory(demoProject)
    const edited = { ...demoProject, name: 'Edited Song' }
    const committed = commitProjectChange(history, edited)

    expect(committed.present.name).toBe('Edited Song')
    expect(committed.past).toHaveLength(1)

    const undone = undoProjectChange(committed)
    expect(undone.present.name).toBe(demoProject.name)
    expect(undone.future).toHaveLength(1)

    const redone = redoProjectChange(undone)
    expect(redone.present.name).toBe('Edited Song')
  })

  it('records a drag edit as one undoable snapshot', () => {
    const history = createProjectHistory(demoProject)
    const snapshot = history.present
    const livePreview = replacePresentProject(history, {
      ...demoProject,
      notes: demoProject.notes.map((note) => (note.id === 'n1' ? { ...note, start: 240 } : note)),
    })
    const committed = commitPresentFromSnapshot(livePreview, snapshot)

    expect(committed.past).toHaveLength(1)
    expect(committed.present.notes[0].start).toBe(240)
    expect(undoProjectChange(committed).present.notes[0].start).toBe(0)
  })
})
