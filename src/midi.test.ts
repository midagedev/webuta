import { describe, expect, it } from 'vitest'
import { demoProject, demoSamples } from './demoProject'
import { createChordMidi, createMelodyMidi, parseMelodyMidi } from './midi'

describe('MIDI export', () => {
  it('writes a type-1 melody MIDI with tempo, lyrics, and note events', () => {
    const midi = createMelodyMidi(demoProject)

    expect(ascii(midi, 0, 4)).toBe('MThd')
    expect(readU16(midi, 8)).toBe(1)
    expect(readU16(midi, 10)).toBe(2)
    expect(readU16(midi, 12)).toBe(480)
    expect(text(midi)).toContain('WebUtau Vocal Melody')
    expect(text(midi)).toContain('네')
    expect([...midi]).toEqual(expect.arrayContaining([0xff, 0x51, 0x03]))
    expect(hasEvent(midi, [0x90, 69, 96])).toBe(true)
    expect(hasEvent(midi, [0x80, 69, 0])).toBe(true)
  })

  it('writes a chord MIDI with marker text and triad note events', () => {
    const midi = createChordMidi(demoProject)

    expect(ascii(midi, 0, 4)).toBe('MThd')
    expect(readU16(midi, 8)).toBe(1)
    expect(readU16(midi, 10)).toBe(2)
    expect(readU16(midi, 12)).toBe(480)
    expect(text(midi)).toContain('WebUtau Chord Guide')
    expect(text(midi)).toContain('C')
    expect(text(midi)).toContain('Am')
    expect(hasEvent(midi, [0x91, 60, 72])).toBe(true)
    expect(hasEvent(midi, [0x81, 60, 0])).toBe(true)
  })

  it('imports a melody MIDI as a vocal project with tempo and lyric meta events', () => {
    const project = parseMelodyMidi(createMelodyMidi(demoProject), 'starter-hook.mid')

    expect(project.name).toBe('starter hook')
    expect(project.bpm).toBe(128)
    expect(project.tempoChanges).toEqual([{ position: 0, bpm: 128 }])
    expect(project.beatPerBar).toBe(4)
    expect(project.beatUnit).toBe(4)
    expect(project.source).toEqual({ fileName: 'starter-hook.mid', format: 'midi' })
    expect(project.notes.map((note) => note.lyric)).toEqual(['네', '오', '빛', '이', '메', '로', '디', '로', '데', '려', '가'])
    expect(project.notes.map((note) => note.tone)).toEqual([69, 71, 72, 71, 74, 72, 71, 69, 72, 74, 76])
    expect(project.notes.map((note) => note.start)).toEqual([0, 480, 960, 1440, 1680, 1920, 2400, 2880, 3360, 3840, 4320])
    expect(project.notes.map((note) => note.duration)).toEqual([360, 360, 480, 240, 240, 360, 360, 360, 360, 360, 960])
    expect(project.parts[0].duration).toBeGreaterThanOrEqual(5760)
  })

  it('round-trips every varied starter sample through melody MIDI', () => {
    for (const sample of demoSamples) {
      const project = parseMelodyMidi(createMelodyMidi(sample.project), `${sample.id}.mid`)

      expect(project.bpm).toBe(sample.project.bpm)
      expect(project.tempoChanges).toEqual(sample.project.tempoChanges ?? [{ position: 0, bpm: sample.project.bpm }])
      expect(project.beatPerBar).toBe(sample.project.beatPerBar)
      expect(project.beatUnit).toBe(sample.project.beatUnit)
      expect(project.notes.map((note) => note.lyric)).toEqual(sample.project.notes.map((note) => note.lyric))
      expect(project.notes.map((note) => note.tone)).toEqual(sample.project.notes.map((note) => note.tone))
      expect(project.notes.map((note) => note.start)).toEqual(sample.project.notes.map((note) => note.start))
      expect(project.notes.map((note) => note.duration)).toEqual(sample.project.notes.map((note) => note.duration))
    }
  })
})

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

function text(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes)
}

function readU16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function hasEvent(bytes: Uint8Array, event: number[]) {
  const values = [...bytes]
  return values.some((_, index) => event.every((byte, eventIndex) => values[index + eventIndex] === byte))
}
