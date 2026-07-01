import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { createChordMidi, createMelodyMidi } from './midi'

describe('MIDI export', () => {
  it('writes a type-1 melody MIDI with tempo, lyrics, and note events', () => {
    const midi = createMelodyMidi(demoProject)

    expect(ascii(midi, 0, 4)).toBe('MThd')
    expect(readU16(midi, 8)).toBe(1)
    expect(readU16(midi, 10)).toBe(2)
    expect(readU16(midi, 12)).toBe(480)
    expect(text(midi)).toContain('WebUtau Vocal Melody')
    expect(text(midi)).toContain('도')
    expect([...midi]).toEqual(expect.arrayContaining([0xff, 0x51, 0x03]))
    expect(hasEvent(midi, [0x90, 64, 96])).toBe(true)
    expect(hasEvent(midi, [0x80, 64, 0])).toBe(true)
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
