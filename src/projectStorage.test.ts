import { beforeEach, describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { clearSavedProject, loadSavedProject, saveProject } from './projectStorage'

describe('project storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves and restores a project snapshot', () => {
    const project = { ...demoProject, name: 'Saved Song' }

    expect(saveProject(project)).toBe(true)
    expect(loadSavedProject()?.name).toBe('Saved Song')
  })

  it('ignores corrupt saved data', () => {
    localStorage.setItem('webuta.project.v1', '{not-json')

    expect(loadSavedProject()).toBeNull()
  })

  it('ignores snapshots that do not match the project shape', () => {
    localStorage.setItem(
      'webuta.project.v1',
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        project: { name: 'Broken' },
      }),
    )

    expect(loadSavedProject()).toBeNull()
  })

  it('clears a saved project', () => {
    saveProject(demoProject)

    expect(clearSavedProject()).toBe(true)
    expect(loadSavedProject()).toBeNull()
  })
})
