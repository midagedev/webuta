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

  it('prefers the lyric melody track when chord-guide notes are present in the same MIDI file', () => {
    const project = parseMelodyMidi(createMelodyAndChordMidi(demoProject), 'full-song.mid')

    expect(project.notes.map((note) => note.lyric)).toEqual(['네', '오', '빛', '이', '메', '로', '디', '로', '데', '려', '가'])
    expect(project.notes.map((note) => note.tone)).toEqual([69, 71, 72, 71, 74, 72, 71, 69, 72, 74, 76])
    expect(project.notes).toHaveLength(demoProject.notes.length)
    expect(project.comment).toContain('WebUtau Vocal Melody')
  })

  it('rejects chord-guide MIDI instead of importing stacked harmony notes as vocals', () => {
    expect(() => parseMelodyMidi(createChordMidi(demoProject), 'chords.mid')).toThrow(/melody-like MIDI track/u)
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

function createMelodyAndChordMidi(project: typeof demoProject) {
  const melodyTracks = readTracks(createMelodyMidi(project))
  const chordTracks = readTracks(createChordMidi(project))
  return concatBytes([
    asciiBytes('MThd'),
    u32(6),
    u16(1),
    u16(3),
    u16(480),
    melodyTracks[0],
    melodyTracks[1],
    chordTracks[1],
  ])
}

function readTracks(midi: Uint8Array) {
  const tracks: Uint8Array[] = []
  let offset = 14
  while (offset < midi.length) {
    const length = readU32(midi, offset + 4)
    tracks.push(midi.slice(offset, offset + 8 + length))
    offset += 8 + length
  }
  return tracks
}

function readU32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function asciiBytes(value: string) {
  return Uint8Array.from([...value].map((char) => char.charCodeAt(0)))
}

function u16(value: number) {
  return Uint8Array.from([(value >> 8) & 0xff, value & 0xff])
}

function u32(value: number) {
  return Uint8Array.from([(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff])
}

function concatBytes(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
