import { normalizedTempoChanges, sortedNotes } from './music'
import { TICKS_PER_BEAT, type ChordMarker, type SongProject } from './types'

type MidiEvent = {
  tick: number
  priority: number
  data: number[]
}

const MELODY_CHANNEL = 0
const CHORD_CHANNEL = 1
const textEncoder = new TextEncoder()

export function createMelodyMidi(project: SongProject): Uint8Array {
  return createTypeOneMidi([
    createConductorTrack(project),
    createMelodyTrack(project),
  ])
}

export function createChordMidi(project: SongProject): Uint8Array {
  return createTypeOneMidi([
    createConductorTrack(project),
    createChordTrack(project),
  ])
}

function createConductorTrack(project: SongProject) {
  const events: MidiEvent[] = [
    metaEvent(0, 0, 0x03, 'WebUtau tempo map'),
    timeSignatureEvent(project),
  ]
  for (const tempo of normalizedTempoChanges(project)) {
    events.push(tempoEvent(tempo.position, tempo.bpm))
  }
  return createTrack(events)
}

function createMelodyTrack(project: SongProject) {
  const events: MidiEvent[] = [
    metaEvent(0, 0, 0x03, 'WebUtau Vocal Melody'),
    { tick: 0, priority: 1, data: [0xc0 | MELODY_CHANNEL, 53] },
  ]
  for (const note of sortedNotes(project.notes)) {
    const start = sanitizeTick(note.start)
    const end = Math.max(start + 1, sanitizeTick(note.start + note.duration))
    const tone = sanitizeMidiNote(note.tone)
    events.push(metaEvent(start, 1, 0x05, note.lyric))
    events.push({ tick: start, priority: 2, data: [0x90 | MELODY_CHANNEL, tone, 96] })
    events.push({ tick: end, priority: 0, data: [0x80 | MELODY_CHANNEL, tone, 0] })
  }
  return createTrack(events)
}

function createChordTrack(project: SongProject) {
  const events: MidiEvent[] = [
    metaEvent(0, 0, 0x03, 'WebUtau Chord Guide'),
    { tick: 0, priority: 1, data: [0xc0 | CHORD_CHANNEL, 0] },
  ]
  for (const chord of sortedChords(project)) {
    const start = sanitizeTick(chord.start)
    const end = Math.max(start + 1, sanitizeTick(chord.start + chord.duration))
    const tones = chordTones(chord)
    events.push(metaEvent(start, 1, 0x06, chord.symbol))
    for (const tone of tones) {
      events.push({ tick: start, priority: 2, data: [0x90 | CHORD_CHANNEL, sanitizeMidiNote(tone), 72] })
      events.push({ tick: end, priority: 0, data: [0x80 | CHORD_CHANNEL, sanitizeMidiNote(tone), 0] })
    }
  }
  return createTrack(events)
}

function createTypeOneMidi(tracks: Uint8Array[]) {
  return concatBytes([
    ascii('MThd'),
    u32(6),
    u16(1),
    u16(tracks.length),
    u16(TICKS_PER_BEAT),
    ...tracks,
  ])
}

function createTrack(events: MidiEvent[]) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.priority - b.priority)
  const bytes: number[] = []
  let cursor = 0
  for (const event of sorted) {
    const tick = sanitizeTick(event.tick)
    bytes.push(...varLen(tick - cursor), ...event.data)
    cursor = tick
  }
  bytes.push(0, 0xff, 0x2f, 0)
  return concatBytes([ascii('MTrk'), u32(bytes.length), Uint8Array.from(bytes)])
}

function metaEvent(tick: number, priority: number, type: number, text: string): MidiEvent {
  const encoded = [...textEncoder.encode(text)]
  return {
    tick,
    priority,
    data: [0xff, type, ...varLen(encoded.length), ...encoded],
  }
}

function tempoEvent(tick: number, bpm: number): MidiEvent {
  const microsecondsPerQuarter = Math.max(1, Math.round(60_000_000 / sanitizeBpm(bpm)))
  return {
    tick,
    priority: 0,
    data: [
      0xff,
      0x51,
      0x03,
      (microsecondsPerQuarter >> 16) & 0xff,
      (microsecondsPerQuarter >> 8) & 0xff,
      microsecondsPerQuarter & 0xff,
    ],
  }
}

function timeSignatureEvent(project: SongProject): MidiEvent {
  const denominatorPower = Math.max(0, Math.round(Math.log2(project.beatUnit || 4)))
  return {
    tick: 0,
    priority: 0,
    data: [0xff, 0x58, 0x04, Math.max(1, Math.round(project.beatPerBar || 4)), denominatorPower, 24, 8],
  }
}

function sortedChords(project: SongProject) {
  return [...(project.chords ?? [])].sort((a, b) => a.start - b.start || a.symbol.localeCompare(b.symbol))
}

function chordTones(chord: ChordMarker) {
  if (chord.tones?.length) {
    return chord.tones
  }
  const root = chord.tone ?? 60
  const third = chord.quality === 'min' ? root + 3 : root + 4
  return [root, third, root + 7]
}

function sanitizeBpm(bpm: number) {
  return Number.isFinite(bpm) && bpm > 0 ? Math.min(360, Math.max(20, bpm)) : 120
}

function sanitizeTick(tick: number) {
  return Number.isFinite(tick) ? Math.max(0, Math.round(tick)) : 0
}

function sanitizeMidiNote(tone: number) {
  return Number.isFinite(tone) ? Math.min(127, Math.max(0, Math.round(tone))) : 60
}

function varLen(value: number) {
  let buffer = Math.max(0, Math.round(value)) & 0x7f
  const bytes = [buffer]
  while ((value >>= 7) > 0) {
    buffer = (value & 0x7f) | 0x80
    bytes.unshift(buffer)
  }
  return bytes
}

function ascii(text: string) {
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)))
}

function u16(value: number) {
  return Uint8Array.from([(value >> 8) & 0xff, value & 0xff])
}

function u32(value: number) {
  return Uint8Array.from([(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff])
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
