import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { isWebutaProjectFileName, parseWebutaProject, serializeWebutaProject } from './projectFile'

describe('WebUtau project files', () => {
  it('round-trips a WebUtau project JSON file', () => {
    const text = serializeWebutaProject({ ...demoProject, name: 'Saved Hook' }, '2026-06-30T00:00:00.000Z')
    const project = parseWebutaProject(text, 'saved-hook.webutau.json')

    expect(project.name).toBe('Saved Hook')
    expect(project.notes.map((note) => note.lyric)).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
    expect(project.source).toEqual({
      fileName: 'saved-hook.webutau.json',
      format: 'webuta',
    })
  })

  it('accepts a raw project snapshot for recovery', () => {
    const project = parseWebutaProject(JSON.stringify(demoProject), 'raw-project.json')

    expect(project.name).toBe('First Vocal Sketch')
    expect(project.source?.format).toBe('webuta')
  })

  it('rejects malformed project payloads', () => {
    expect(() => parseWebutaProject('{}')).toThrow(/valid project/)
    expect(() => parseWebutaProject('not-json')).toThrow(/JSON/)
  })

  it('detects the native file extension', () => {
    expect(isWebutaProjectFileName('demo.webutau.json')).toBe(true)
    expect(isWebutaProjectFileName('demo.ustx')).toBe(false)
  })
})
