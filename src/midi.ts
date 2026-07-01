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
const textDecoder = new TextDecoder()

type ParsedMidiNote = {
  start: number
  duration: number
  tone: number
  lyric: string
  channel: number
}

type ParsedMidiLyric = {
  tick: number
  text: string
}

type ParsedMidiTempo = {
  position: number
  bpm: number
}

type ParsedMidiTimeSignature = {
  beatPerBar: number
  beatUnit: number
}

type ParsedMidiTrack = {
  index: number
  name: string
  notes: ParsedMidiNote[]
  lyrics: ParsedMidiLyric[]
}

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

export function parseMelodyMidi(bytes: Uint8Array | ArrayBuffer, fileName = 'melody.mid'): SongProject {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const reader = new MidiReader(data)
  const header = reader.readChunk()
  if (header.id !== 'MThd' || header.data.length < 6) {
    throw new Error('MIDI file is missing a valid MThd header.')
  }
  const format = readU16(header.data, 0)
  const trackCount = readU16(header.data, 2)
  const division = readU16(header.data, 4)
  if (format > 1) {
    throw new Error('Only type 0 and type 1 MIDI files are supported.')
  }
  if (division & 0x8000) {
    throw new Error('SMPTE-time MIDI files are not supported.')
  }
  if (trackCount <= 0 || division <= 0) {
    throw new Error('MIDI file has no PPQ tracks to import.')
  }

  const importedTracks: ParsedMidiTrack[] = []
  const tempos: ParsedMidiTempo[] = []
  const signatures: ParsedMidiTimeSignature[] = []
  for (let trackIndex = 0; trackIndex < trackCount && !reader.done; trackIndex += 1) {
    const chunk = reader.readChunk()
    if (chunk.id !== 'MTrk') {
      continue
    }
    const track: ParsedMidiTrack = {
      index: trackIndex,
      name: `Track ${trackIndex + 1}`,
      notes: [],
      lyrics: [],
    }
    parseMidiTrack(chunk.data, division, track, tempos, signatures)
    if (track.notes.length > 0) {
      importedTracks.push(track)
    }
  }

  if (importedTracks.length === 0) {
    throw new Error('No playable MIDI notes were found.')
  }

  const selectedTrack = chooseMelodyTrack(importedTracks)
  if (!selectedTrack) {
    throw new Error('No melody-like MIDI track was found. Import a vocal melody MIDI, not a chord guide MIDI.')
  }

  const sortedLyrics = selectedTrack.lyrics.sort((a, b) => a.tick - b.tick)
  const selectedNotes = vocalNotesForTrack(selectedTrack, sortedLyrics)
  const projectNotes = selectedNotes
    .sort((a, b) => a.start - b.start || a.tone - b.tone)
    .map((note, index) => ({
      id: `midi-note-${index + 1}`,
      trackId: 'track-main',
      partId: 'part-main',
      start: note.start,
      duration: Math.max(1, note.duration),
      tone: note.tone,
      lyric: note.lyric || lyricForMidiNote(note, sortedLyrics, index),
    }))
  if (projectNotes.length === 0) {
    throw new Error('No vocal melody notes were found in the selected MIDI track.')
  }
  const sortedTempos = normalizeImportedTempos(tempos)
  const firstTempo = sortedTempos[0]?.bpm ?? 120
  const timeSignature = signatures[0] ?? { beatPerBar: 4, beatUnit: 4 }
  const duration = Math.max(TICKS_PER_BEAT * 4, ...projectNotes.map((note) => note.start + note.duration + TICKS_PER_BEAT))
  const projectName = inferMidiProjectName(fileName)
  return {
    id: `midi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'import'}`,
    name: projectName,
    comment: `Imported from ${fileName} · ${selectedTrack.name}`,
    bpm: firstTempo,
    tempoChanges: sortedTempos,
    beatPerBar: timeSignature.beatPerBar,
    beatUnit: timeSignature.beatUnit,
    tracks: [{ id: 'track-main', name: 'MIDI Vocal', color: 'Cyan' }],
    parts: [{ id: 'part-main', trackId: 'track-main', name: 'Imported MIDI', start: 0, duration }],
    notes: projectNotes,
    source: {
      fileName,
      format: 'midi',
    },
  }
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

function parseMidiTrack(
  data: Uint8Array,
  division: number,
  track: ParsedMidiTrack,
  tempos: ParsedMidiTempo[],
  signatures: ParsedMidiTimeSignature[],
) {
  const reader = new MidiEventReader(data)
  const active = new Map<string, Array<{ tick: number; lyric: string }>>()
  let tick = 0
  let runningStatus = 0
  let pendingLyric = ''
  while (!reader.done) {
    tick += reader.readVarLen()
    let status = reader.readByte()
    if (status < 0x80) {
      if (!runningStatus) {
        throw new Error('MIDI running status appeared before a status byte.')
      }
      reader.backtrack()
      status = runningStatus
    } else if (status < 0xf0) {
      runningStatus = status
    }

    if (status === 0xff) {
      const type = reader.readByte()
      const length = reader.readVarLen()
      const payload = reader.readBytes(length)
      if (type === 0x2f) {
        break
      }
      const scaledTick = scaleMidiTick(tick, division)
      if (type === 0x51 && payload.length === 3) {
        const micros = (payload[0] << 16) | (payload[1] << 8) | payload[2]
        tempos.push({ position: scaledTick, bpm: Math.round((60_000_000 / Math.max(1, micros)) * 100) / 100 })
      } else if (type === 0x58 && payload.length >= 2) {
        signatures.push({
          beatPerBar: Math.max(1, payload[0]),
          beatUnit: Math.max(1, 2 ** payload[1]),
        })
      } else if (type === 0x03) {
        track.name = decodeMidiText(payload).trim() || track.name
      } else if (type === 0x05 || type === 0x01) {
        const text = decodeMidiText(payload).trim()
        if (text) {
          track.lyrics.push({ tick: scaledTick, text })
          pendingLyric = text
        }
      }
      continue
    }

    if (status === 0xf0 || status === 0xf7) {
      reader.readBytes(reader.readVarLen())
      runningStatus = 0
      continue
    }

    const command = status & 0xf0
    const channel = status & 0x0f
    if (command === 0x80 || command === 0x90) {
      const tone = reader.readByte()
      const velocity = reader.readByte()
      if (channel === 9) {
        continue
      }
      const key = `${channel}:${tone}`
      const scaledTick = scaleMidiTick(tick, division)
      if (command === 0x90 && velocity > 0) {
        const stack = active.get(key) ?? []
        stack.push({ tick: scaledTick, lyric: pendingLyric })
        active.set(key, stack)
        pendingLyric = ''
      } else {
        const stack = active.get(key)
        const start = stack?.shift()
        if (start) {
          track.notes.push({
            start: start.tick,
            duration: Math.max(1, scaledTick - start.tick),
            tone: sanitizeMidiNote(tone),
            lyric: start.lyric,
            channel,
          })
        }
        if (stack && stack.length === 0) {
          active.delete(key)
        }
      }
      continue
    }

    const byteCount = midiChannelDataLength(command)
    if (byteCount <= 0) {
      throw new Error(`Unsupported MIDI status 0x${status.toString(16)}.`)
    }
    reader.readBytes(byteCount)
  }
}

function chooseMelodyTrack(tracks: ParsedMidiTrack[]) {
  const lyricTracks = tracks.filter((track) => track.lyrics.length > 0)
  if (lyricTracks.length > 0) {
    return lyricTracks.sort((a, b) => melodyTrackScore(b, true) - melodyTrackScore(a, true))[0]
  }
  const melodyCandidates = tracks
    .map((track) => ({ track, score: melodyTrackScore(track, false) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score)
  return melodyCandidates[0]?.track ?? null
}

function melodyTrackScore(track: ParsedMidiTrack, hasLyrics: boolean) {
  const noteCount = track.notes.length
  if (noteCount === 0) {
    return -1
  }
  const starts = new Map<number, number>()
  for (const note of track.notes) {
    starts.set(note.start, (starts.get(note.start) ?? 0) + 1)
  }
  const startCounts = [...starts.values()]
  const polyphonicStartCount = startCounts.filter((count) => count > 1).length
  const polyphonicStartRatio = polyphonicStartCount / Math.max(1, startCounts.length)
  const maxStartStack = Math.max(1, ...startCounts)
  const uniqueToneCount = new Set(track.notes.map((note) => note.tone)).size
  const namePenalty = /chord|guide|harmony|accomp|backing|pad|bass|코드|화음/iu.test(track.name) ? 20 : 0
  if (!hasLyrics && maxStartStack >= 3 && polyphonicStartRatio >= 0.35) {
    return -1
  }
  return noteCount + uniqueToneCount * 0.25 + (hasLyrics ? track.lyrics.length * 2 : 0) - polyphonicStartRatio * 12 - (maxStartStack - 1) * 3 - namePenalty
}

function vocalNotesForTrack(track: ParsedMidiTrack, lyrics: ParsedMidiLyric[]) {
  if (lyrics.length === 0) {
    return track.notes
  }
  const usedIndexes = new Set<number>()
  return lyrics
    .map((lyric, lyricIndex) => {
      const nextLyric = lyrics[lyricIndex + 1]
      const maxStart = nextLyric ? Math.max(lyric.tick, nextLyric.tick - 1) : lyric.tick + TICKS_PER_BEAT
      const candidates = track.notes
        .map((note, noteIndex) => ({ note, noteIndex }))
        .filter(({ note, noteIndex }) => !usedIndexes.has(noteIndex) && note.start >= lyric.tick && note.start <= maxStart)
        .sort((a, b) => lyricCandidateScore(a.note, lyric) - lyricCandidateScore(b.note, lyric))
      const match = candidates[0]
      if (!match) {
        return null
      }
      usedIndexes.add(match.noteIndex)
      return {
        ...match.note,
        lyric: lyric.text,
      }
    })
    .filter((note): note is ParsedMidiNote => note !== null)
}

function lyricCandidateScore(note: ParsedMidiNote, lyric: ParsedMidiLyric) {
  const channelPenalty = note.channel === MELODY_CHANNEL ? 0 : 20
  const lyricPenalty = note.lyric === lyric.text ? 0 : note.lyric.trim().length > 0 ? 10 : 4
  const startPenalty = Math.abs(note.start - lyric.tick) / TICKS_PER_BEAT
  return channelPenalty + lyricPenalty + startPenalty
}

function lyricForMidiNote(note: ParsedMidiNote, lyrics: ParsedMidiLyric[], index: number) {
  const exact = lyrics.find((lyric) => lyric.tick === note.start)
  return exact?.text || ['라', '라', '라', '라'][index % 4]
}

function normalizeImportedTempos(tempos: ParsedMidiTempo[]) {
  const byPosition = new Map<number, number>()
  byPosition.set(0, tempos.find((tempo) => tempo.position === 0)?.bpm ?? tempos[0]?.bpm ?? 120)
  for (const tempo of tempos) {
    byPosition.set(tempo.position, sanitizeBpm(tempo.bpm))
  }
  return [...byPosition.entries()]
    .map(([position, bpm]) => ({ position, bpm }))
    .sort((a, b) => a.position - b.position)
}

function scaleMidiTick(tick: number, division: number) {
  return Math.max(0, Math.round((tick / division) * TICKS_PER_BEAT))
}

function decodeMidiText(bytes: Uint8Array) {
  return textDecoder.decode(bytes).replaceAll(String.fromCharCode(0), '').trim()
}

function inferMidiProjectName(fileName: string) {
  const base = fileName.replace(/\.(midi?|smf)$/iu, '').replace(/[_-]+/g, ' ').trim()
  return base || 'Imported MIDI'
}

function midiChannelDataLength(command: number) {
  return command === 0xc0 || command === 0xd0 ? 1 : command >= 0x80 && command <= 0xe0 ? 2 : 0
}

function readU16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

class MidiReader {
  private offset = 0
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get done() {
    return this.offset >= this.bytes.length
  }

  readChunk() {
    const id = String.fromCharCode(...this.readBytes(4))
    const length = this.readU32()
    return {
      id,
      data: this.readBytes(length),
    }
  }

  private readU32() {
    const bytes = this.readBytes(4)
    return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  }

  private readBytes(length: number) {
    if (this.offset + length > this.bytes.length) {
      throw new Error('Unexpected end of MIDI file.')
    }
    const out = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return out
  }
}

class MidiEventReader {
  private offset = 0
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get done() {
    return this.offset >= this.bytes.length
  }

  readByte() {
    if (this.offset >= this.bytes.length) {
      throw new Error('Unexpected end of MIDI track.')
    }
    return this.bytes[this.offset++]
  }

  backtrack() {
    this.offset = Math.max(0, this.offset - 1)
  }

  readBytes(length: number) {
    if (this.offset + length > this.bytes.length) {
      throw new Error('Unexpected end of MIDI track.')
    }
    const out = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return out
  }

  readVarLen() {
    let value = 0
    for (let index = 0; index < 4; index += 1) {
      const byte = this.readByte()
      value = (value << 7) | (byte & 0x7f)
      if ((byte & 0x80) === 0) {
        return value
      }
    }
    throw new Error('Invalid MIDI variable length value.')
  }
}
