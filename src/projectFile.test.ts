import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { isWebutaProjectFileName, parseWebutaProject, serializeWebutaProject } from './projectFile'

describe('WebUtau project files', () => {
  it('round-trips a WebUtau project JSON file', () => {
    const text = serializeWebutaProject(
      {
        ...demoProject,
        name: 'Saved Hook',
        notes: demoProject.notes.map((note, index) =>
          index === 0
            ? {
                ...note,
                intensity: 82,
                velocity: 142,
                modulation: 9,
                flags: 'g-2BRE20',
                timing: { sampleStartMs: 25, preutteranceMs: 72, voiceOverlapMs: 20 },
                envelope: { p1Ms: 0, p2Ms: 24, p3Ms: 140, v1: 0, v2: 100, v3: 60, v4: 12 },
                pitchBend: {
                  points: [
                    { timePercent: 0, cents: 0 },
                    { timePercent: 40, cents: 24 },
                    { timePercent: 100, cents: 0 },
                  ],
                  modes: ['s', 'r'],
                },
              }
            : note,
        ),
      },
      '2026-06-30T00:00:00.000Z',
    )
    const project = parseWebutaProject(text, 'saved-hook.webutau.json')

    expect(project.name).toBe('Saved Hook')
    expect(project.notes.map((note) => note.lyric)).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
    expect(project.notes.at(-1)?.vibrato).toMatchObject({
      enabled: true,
      depthCents: 20,
      rateHz: 5.6,
      startPercent: 44,
    })
    expect(project.notes[0].pitchBend?.points).toEqual([
      { timePercent: 0, cents: 0 },
      { timePercent: 40, cents: 24 },
      { timePercent: 100, cents: 0 },
    ])
    expect(project.notes[0].pitchBend?.modes).toEqual(['s', 'r'])
    expect(project.notes[0].intensity).toBe(82)
    expect(project.notes[0].velocity).toBe(142)
    expect(project.notes[0].modulation).toBe(9)
    expect(project.notes[0].flags).toBe('g-2BRE20')
    expect(project.notes[0].timing).toEqual({ sampleStartMs: 25, preutteranceMs: 72, voiceOverlapMs: 20 })
    expect(project.notes[0].envelope).toEqual({ p1Ms: 0, p2Ms: 24, p3Ms: 140, v1: 0, v2: 100, v3: 60, v4: 12 })
    expect(project.chords?.map((chord) => chord.symbol)).toEqual(['C', 'G', 'Am', 'F'])
    expect(project.source).toEqual({
      fileName: 'saved-hook.webutau.json',
      format: 'webuta',
    })
  })

  it('accepts a raw project snapshot for recovery', () => {
    const project = parseWebutaProject(
      JSON.stringify({
        ...demoProject,
        tempoChanges: [
          { position: 0, bpm: 112 },
          { position: 960, bpm: 96 },
        ],
      }),
      'raw-project.json',
    )

    expect(project.name).toBe('First Vocal Sketch')
    expect(project.source?.format).toBe('webuta')
    expect(project.tempoChanges?.[1]).toEqual({ position: 960, bpm: 96 })
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
