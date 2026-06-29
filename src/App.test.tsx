import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { demoProject } from './demoProject'
import { loadSavedProject, saveProject } from './projectStorage'

describe('App editing workflow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('restores the last browser project draft', () => {
    saveProject({ ...demoProject, name: 'Recovered Draft' })

    render(<App />)

    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Recovered Draft')
  })

  it('auto-saves project name edits', async () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Dohee Hook' } })

    await waitFor(() => {
      expect(loadSavedProject()?.name).toBe('Dohee Hook')
    })
  })

  it('updates the selected lyric from the quick lyric pads', () => {
    render(<App />)

    const lyricPads = screen.getByLabelText('Quick lyric painter')
    fireEvent.click(within(lyricPads).getByRole('button', { name: '키' }))

    expect((screen.getByLabelText('가사') as HTMLInputElement).value).toBe('키')
  })

  it('adds a note by clicking an empty piano-roll cell', () => {
    const { container } = render(<App />)
    const grid = container.querySelector('.roll-grid') as HTMLDivElement
    grid.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 820,
        bottom: 520,
        width: 820,
        height: 520,
        toJSON: () => ({}),
      }) as DOMRect

    fireEvent.click(grid, { clientX: 167, clientY: 53 })

    expect(screen.getByText(/9 notes/)).toBeTruthy()
  })
})
