import { clampTone } from './music'
import { TICKS_PER_BEAT, type SongNote, type SongProject } from './types'

export type ComposerMood = 'bright' | 'citypop' | 'minor'

export type ChordSuggestion = {
  symbol: string
  tone: number
  quality: 'maj' | 'min'
  start: number
  duration: number
  tones: number[]
}

export type MelodySuggestion = {
  mood: ComposerMood
  bpm: number
  lyricTokens: string[]
  chords: ChordSuggestion[]
  notes: SongNote[]
}

type MoodTemplate = {
  bpm: number
  keyRoot: number
  scale: number[]
  progression: Array<{ symbol: string; degree: number; quality: ChordSuggestion['quality'] }>
  contour: number[]
  durations: number[]
}

const MOOD_TEMPLATES: Record<ComposerMood, MoodTemplate> = {
  bright: {
    bpm: 118,
    keyRoot: 60,
    scale: [0, 2, 4, 5, 7, 9, 11],
    progression: [
      { symbol: 'C', degree: 0, quality: 'maj' },
      { symbol: 'G', degree: 7, quality: 'maj' },
      { symbol: 'Am', degree: 9, quality: 'min' },
      { symbol: 'F', degree: 5, quality: 'maj' },
    ],
    contour: [4, 2, 4, 5, 7, 5, 4, 2, 0, 2, 4, 7, 9, 7, 5, 4],
    durations: [240, 240, 360, 120, 480, 240, 240, 480],
  },
  citypop: {
    bpm: 104,
    keyRoot: 57,
    scale: [0, 2, 4, 6, 7, 9, 11],
    progression: [
      { symbol: 'Fmaj7', degree: 8, quality: 'maj' },
      { symbol: 'E7', degree: 7, quality: 'maj' },
      { symbol: 'Am7', degree: 0, quality: 'min' },
      { symbol: 'C/G', degree: 3, quality: 'maj' },
    ],
    contour: [7, 9, 11, 9, 7, 6, 4, 2, 4, 6, 7, 11, 9, 7, 6, 4],
    durations: [360, 120, 240, 240, 480, 240, 240, 480],
  },
  minor: {
    bpm: 96,
    keyRoot: 57,
    scale: [0, 2, 3, 5, 7, 8, 10],
    progression: [
      { symbol: 'Am', degree: 0, quality: 'min' },
      { symbol: 'F', degree: 5, quality: 'maj' },
      { symbol: 'C', degree: 3, quality: 'maj' },
      { symbol: 'G', degree: 10, quality: 'maj' },
    ],
    contour: [7, 5, 3, 2, 0, 2, 3, 5, 7, 8, 7, 5, 3, 2, 0, -2],
    durations: [240, 240, 480, 240, 240, 480, 360, 120],
  },
}

export function composeFromLyrics(lyrics: string, mood: ComposerMood = 'bright'): MelodySuggestion {
  const template = MOOD_TEMPLATES[mood]
  const lyricTokens = tokenizeComposerLyrics(lyrics)
  const tokens = lyricTokens.length > 0 ? lyricTokens : ['라', '라', '라', '라']
  const notes = tokens.map((lyric, index) => {
    const duration = durationForIndex(template, index, tokens.length)
    const start = previousDuration(template, index)
    const chord = chordAtTick(template, start)
    return {
      id: `generated-note-${index + 1}`,
      trackId: 'track-main',
      partId: 'part-main',
      start,
      duration,
      tone: clampTone(melodyTone(template, chord, index)),
      lyric,
    }
  })

  const songEnd = notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0)
  const chordBars = Math.max(4, Math.ceil(songEnd / TICKS_PER_BEAT))
  const chords = Array.from({ length: chordBars }, (_, index) => {
    const base = template.progression[index % template.progression.length]
    const tone = template.keyRoot + base.degree
    return {
      symbol: base.symbol,
      tone,
      quality: base.quality,
      start: index * TICKS_PER_BEAT,
      duration: TICKS_PER_BEAT,
      tones: chordTones(tone, base.quality),
    }
  })

  return {
    mood,
    bpm: template.bpm,
    lyricTokens: tokens,
    chords,
    notes,
  }
}

export function applyMelodySuggestion(project: SongProject, suggestion: MelodySuggestion): SongProject {
  const track = project.tracks[0] ?? {
    id: 'track-main',
    name: 'Main Vocal',
    color: 'Coral',
  }
  const endTick = suggestion.notes.reduce((max, note) => Math.max(max, note.start + note.duration), TICKS_PER_BEAT * 4)
  const part = {
    ...(project.parts[0] ?? {
      id: 'part-main',
      trackId: track.id,
      name: 'Verse',
      start: 0,
      duration: endTick,
    }),
    id: project.parts[0]?.id ?? 'part-main',
    trackId: track.id,
    name: 'Generated Hook',
    start: 0,
    duration: Math.max(endTick, TICKS_PER_BEAT * 4),
  }

  return {
    ...project,
    name: project.name.trim() ? project.name : 'Generated Vocal Sketch',
    bpm: suggestion.bpm,
    chords: suggestion.chords.map((chord) => ({
      symbol: chord.symbol,
      start: chord.start,
      duration: chord.duration,
      tone: chord.tone,
      quality: chord.quality,
      tones: [...chord.tones],
    })),
    tracks: [
      {
        ...track,
        singer: track.singer ?? 'WebUtau Korean V3 Synthetic',
        phonemizer: track.phonemizer ?? 'generated melody',
      },
    ],
    parts: [part],
    notes: suggestion.notes.map((note) => ({
      ...note,
      trackId: track.id,
      partId: part.id,
    })),
  }
}

export function formatChordLine(chords: ChordSuggestion[]) {
  return chords.map((chord) => chord.symbol).join('  ')
}

export function tokenizeComposerLyrics(lyrics: string) {
  const tokens: string[] = []
  for (const chunk of lyrics.trim().split(/\s+/)) {
    const cleaned = chunk.trim().replace(/[,.!?;:()[\]{}"“”'‘’]+/g, '')
    if (!cleaned) {
      continue
    }
    const segments = cleaned.match(/[가-힣]|[ぁ-ゖァ-ヺー]|[a-zA-Z]+|\d+/g)
    if (segments) {
      tokens.push(...segments.map((segment) => segment.toLowerCase()))
    }
  }
  return tokens
}

function previousDuration(template: MoodTemplate, index: number) {
  let start = 0
  for (let i = 0; i < index; i++) {
    start += durationForIndex(template, i, index + 1)
  }
  return start
}

function durationForIndex(template: MoodTemplate, index: number, tokenCount: number) {
  if (index === tokenCount - 1) {
    return TICKS_PER_BEAT
  }
  return template.durations[index % template.durations.length]
}

function chordAtTick(template: MoodTemplate, tick: number) {
  return template.progression[Math.floor(tick / TICKS_PER_BEAT) % template.progression.length]
}

function melodyTone(template: MoodTemplate, chord: MoodTemplate['progression'][number], index: number) {
  const contourDegree = template.contour[index % template.contour.length]
  const chordTone = chordTones(template.keyRoot + chord.degree, chord.quality)[index % 3] - 12
  const scaleTone = scaleDegreeToTone(template.keyRoot, template.scale, contourDegree)
  const phraseAccent = index % 4 === 0 ? 12 : 0
  return nearestTone(scaleTone + phraseAccent, chordTone + 12, 5)
}

function scaleDegreeToTone(root: number, scale: number[], degree: number) {
  const octave = Math.floor(degree / scale.length)
  const index = ((degree % scale.length) + scale.length) % scale.length
  return root + octave * 12 + scale[index]
}

function chordTones(root: number, quality: ChordSuggestion['quality']) {
  const intervals = quality === 'maj' ? [0, 4, 7] : [0, 3, 7]
  return intervals.map((interval) => root + interval)
}

function nearestTone(tone: number, target: number, tolerance: number) {
  let best = tone
  for (const candidate of [tone - 12, tone, tone + 12]) {
    if (Math.abs(candidate - target) < Math.abs(best - target)) {
      best = candidate
    }
  }
  if (Math.abs(best - target) <= tolerance) {
    return best
  }
  return tone
}
