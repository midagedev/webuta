import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { demoProject } from './demoProject'
import { loadSavedProject, saveProject } from './projectStorage'
import { clearSavedVoicebankFile, saveVoicebankFile } from './voicebankStorage'

describe('App editing workflow', () => {
  beforeEach(async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    localStorage.clear()
    await clearSavedVoicebankFile()
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

  it('restores the last imported voicebank zip', async () => {
    await saveVoicebankFile(await makeVoicebankZip())

    render(<App />)

    await screen.findByText('WebUtau // Test Teto')
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

  it('nudges the selected note timing and pitch from the note panel', async () => {
    render(<App />)

    fireEvent.click(screen.getByTitle('뒤로 이동'))
    fireEvent.click(screen.getByTitle('음 높게'))

    await waitFor(() => {
      const savedNote = loadSavedProject()?.notes.find((note) => note.id === 'n1')
      expect(savedNote?.start).toBe(120)
      expect(savedNote?.tone).toBe(61)
    })
  })

  it('drags a piano-roll note to edit timing and pitch', async () => {
    const { container } = render(<App />)
    const noteBlock = container.querySelector('.note-block') as HTMLButtonElement
    noteBlock.getBoundingClientRect = makeRect({ left: 0, top: 0, width: 80, height: 24 })

    fireEvent.pointerDown(noteBlock, { pointerId: 1, clientX: 18, clientY: 18 })
    fireEvent.pointerMove(noteBlock, { pointerId: 1, clientX: 36, clientY: -8 })
    fireEvent.pointerUp(noteBlock, { pointerId: 1, clientX: 36, clientY: -8 })

    await waitFor(() => {
      const savedNote = loadSavedProject()?.notes.find((note) => note.id === 'n1')
      expect(savedNote?.start).toBe(120)
      expect(savedNote?.tone).toBe(61)
    })
  })

  it('resizes a piano-roll note from the right edge', async () => {
    const { container } = render(<App />)
    const noteBlock = container.querySelector('.note-block') as HTMLButtonElement
    noteBlock.getBoundingClientRect = makeRect({ left: 0, top: 0, width: 80, height: 24 })

    fireEvent.pointerDown(noteBlock, { pointerId: 1, clientX: 74, clientY: 18 })
    fireEvent.pointerMove(noteBlock, { pointerId: 1, clientX: 92, clientY: 18 })
    fireEvent.pointerUp(noteBlock, { pointerId: 1, clientX: 92, clientY: 18 })

    await waitFor(() => {
      const savedNote = loadSavedProject()?.notes.find((note) => note.id === 'n1')
      expect(savedNote?.duration).toBe(540)
    })
  })

  it('edits a focused note with arrow keys', async () => {
    const { container } = render(<App />)
    const noteBlock = container.querySelector('.note-block') as HTMLButtonElement

    fireEvent.keyDown(noteBlock, { key: 'ArrowRight' })
    fireEvent.keyDown(noteBlock, { key: 'ArrowUp' })

    await waitFor(() => {
      const savedNote = loadSavedProject()?.notes.find((note) => note.id === 'n1')
      expect(savedNote?.start).toBe(120)
      expect(savedNote?.tone).toBe(61)
    })
  })
})

async function makeVoicebankZip() {
  const zip = new JSZip()
  zip.file('Teto/character.yaml', 'name: Test Teto\n')
  zip.file('Teto/oto.ini', 'a.wav=あ,0,120,0,40,20\n')
  zip.file('Teto/a.wav', new Uint8Array([1, 2, 3, 4]))
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], 'test-teto.zip', { type: 'application/zip' })
}

function makeRect(input: { left: number; top: number; width: number; height: number }) {
  const { left, top, width, height } = input
  return () =>
    ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect
}
