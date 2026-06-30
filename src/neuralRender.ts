import { midiToHz, sortedNotes, ticksToSeconds } from './music'
import { TICKS_PER_BEAT, type SongProject } from './types'

const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const VOWEL_COUNT = 21
const CODA_COUNT = 28

const ONSET_SYMBOLS = [
  'g',
  'kk',
  'n',
  'd',
  'tt',
  'r',
  'm',
  'b',
  'pp',
  's',
  'ss',
  '',
  'j',
  'jj',
  'ch',
  'k',
  't',
  'p',
  'h',
] as const

const VOWEL_SYMBOLS = [
  'a',
  'ae',
  'ya',
  'yae',
  'eo',
  'e',
  'yeo',
  'ye',
  'o',
  'wa',
  'wae',
  'oe',
  'yo',
  'u',
  'wo',
  'we',
  'wi',
  'yu',
  'eu',
  'ui',
  'i',
] as const

const CODA_SYMBOLS = [
  '',
  'g',
  'kk',
  'gs',
  'n',
  'nj',
  'nh',
  'd',
  'r',
  'rg',
  'rm',
  'rb',
  'rs',
  'rt',
  'rp',
  'rh',
  'm',
  'b',
  'bs',
  's',
  'ss',
  'ng',
  'j',
  'ch',
  'k',
  't',
  'p',
  'h',
] as const

export type NeuralPhonemeRole = 'onset' | 'vowel' | 'coda' | 'literal' | 'silence' | 'tie' | 'breath'

export type NeuralPhoneme = {
  symbol: string
  role: NeuralPhonemeRole
  source: string
  startRatio: number
  endRatio: number
}

export type NeuralPitchPoint = {
  timeRatio: number
  cents: number
}

export type NeuralRenderNote = {
  kind: 'note' | 'rest' | 'tie' | 'breath'
  id: string
  trackId: string
  partId: string
  startTick: number
  durationTick: number
  startSeconds: number
  durationSeconds: number
  midi: number | null
  targetHz: number | null
  lyric: string
  phonemes: NeuralPhoneme[]
  pitchCurve: NeuralPitchPoint[]
}

export type NeuralRenderRequest = {
  version: 1
  project: {
    id: string
    title: string
    bpm: number
    timebase: number
  }
  voice: {
    id: string
    language: string
    renderer: string
  }
  render: {
    sampleRate: number
    format: 'wav'
    includeDiagnostics: boolean
  }
  notes: NeuralRenderNote[]
}

export type NeuralRenderErrorCode =
  | 'server-unavailable'
  | 'model-missing'
  | 'license-not-accepted'
  | 'invalid-score'
  | 'invalid-phoneme'
  | 'unsupported-language'
  | 'render-timeout'
  | 'render-cancelled'
  | 'internal-render-error'

export type NeuralRenderDiagnostics = {
  renderer: string
  modelId: string
  renderSeconds: number
  warnings: string[]
  artifacts?: Record<string, string>
}

export type NeuralRenderServiceResponse =
  | {
      version: 1
      ok: true
      audio: {
        contentType: 'audio/wav'
        sampleRate: number
        durationSeconds: number
        fileName: string
        wavBase64: string
      }
      diagnostics: NeuralRenderDiagnostics
    }
  | {
      version: 1
      ok: false
      error: {
        code: NeuralRenderErrorCode
        message: string
      }
      diagnostics?: Partial<NeuralRenderDiagnostics>
    }

export type NeuralRenderRequestOptions = {
  voiceId?: string
  language?: string
  renderer?: string
  sampleRate?: number
  includeDiagnostics?: boolean
  includeRests?: boolean
  pitchCurves?: Record<string, NeuralPitchPoint[]>
}

export function createNeuralRenderRequest(
  project: SongProject,
  options: NeuralRenderRequestOptions = {},
): NeuralRenderRequest {
  return {
    version: 1,
    project: {
      id: project.id,
      title: project.name,
      bpm: project.bpm,
      timebase: TICKS_PER_BEAT,
    },
    voice: {
      id: options.voiceId ?? 'webuta-ko-neural-dev',
      language: options.language ?? 'ko',
      renderer: options.renderer ?? 'diffsinger',
    },
    render: {
      sampleRate: options.sampleRate ?? 44100,
      format: 'wav',
      includeDiagnostics: options.includeDiagnostics ?? true,
    },
    notes: buildNeuralNotes(project, options),
  }
}

function buildNeuralNotes(project: SongProject, options: NeuralRenderRequestOptions): NeuralRenderNote[] {
  const notes: NeuralRenderNote[] = []
  const trackEnds = new Map<string, number>()
  const includeRests = options.includeRests ?? false

  for (const note of sortedNotes(project.notes)) {
    const previousEnd = trackEnds.get(note.trackId) ?? note.start
    if (includeRests && note.start > previousEnd) {
      const duration = note.start - previousEnd
      notes.push({
        kind: 'rest',
        id: `rest-${note.trackId}-${previousEnd}-${note.start}`,
        trackId: note.trackId,
        partId: note.partId,
        startTick: previousEnd,
        durationTick: duration,
        startSeconds: ticksToSeconds(previousEnd, project.bpm),
        durationSeconds: ticksToSeconds(duration, project.bpm),
        midi: null,
        targetHz: null,
        lyric: 'R',
        phonemes: phonemesForLyric('R'),
        pitchCurve: [],
      })
    }

    const kind = renderKindForLyric(note.lyric)
    const isUnpitched = kind === 'rest' || kind === 'breath'
    notes.push({
      kind,
      id: note.id,
      trackId: note.trackId,
      partId: note.partId,
      startTick: note.start,
      durationTick: note.duration,
      startSeconds: ticksToSeconds(note.start, project.bpm),
      durationSeconds: ticksToSeconds(note.duration, project.bpm),
      midi: isUnpitched ? null : note.tone,
      targetHz: isUnpitched ? null : midiToHz(note.tone),
      lyric: note.lyric,
      phonemes: phonemesForLyric(note.lyric),
      pitchCurve: normalizePitchCurve(options.pitchCurves?.[note.id] ?? []),
    })
    trackEnds.set(note.trackId, Math.max(previousEnd, note.start + note.duration))
  }

  return notes.sort((a, b) => {
    if (a.startTick !== b.startTick) {
      return a.startTick - b.startTick
    }
    if (a.kind !== b.kind) {
      return a.kind === 'rest' ? -1 : 1
    }
    return (a.midi ?? -1) - (b.midi ?? -1)
  })
}

export function phonemesForLyric(lyric: string): NeuralPhoneme[] {
  const trimmed = lyric.trim()
  if (isRestLyric(trimmed)) {
    return [
      {
        symbol: 'sil',
        role: 'silence',
        source: lyric,
        startRatio: 0,
        endRatio: 1,
      },
    ]
  }
  if (isBreathLyric(trimmed)) {
    return [
      {
        symbol: 'br',
        role: 'breath',
        source: lyric,
        startRatio: 0,
        endRatio: 1,
      },
    ]
  }
  if (isTieLyric(trimmed)) {
    return [
      {
        symbol: 'tie',
        role: 'tie',
        source: lyric,
        startRatio: 0,
        endRatio: 1,
      },
    ]
  }

  const phonemes = Array.from(trimmed).flatMap((char) => phonemesForCharacter(char))
  return distributeRatios(phonemes)
}

function renderKindForLyric(lyric: string): NeuralRenderNote['kind'] {
  const trimmed = lyric.trim()
  if (isRestLyric(trimmed)) {
    return 'rest'
  }
  if (isBreathLyric(trimmed)) {
    return 'breath'
  }
  if (isTieLyric(trimmed)) {
    return 'tie'
  }
  return 'note'
}

function isRestLyric(lyric: string) {
  return !lyric || lyric === 'R' || lyric.toLowerCase() === 'rest' || lyric === '쉼'
}

function isBreathLyric(lyric: string) {
  return lyric.toLowerCase() === 'br' || lyric.toLowerCase() === 'breath' || lyric === '숨' || lyric === '息'
}

function isTieLyric(lyric: string) {
  return lyric === '-' || lyric === 'ー' || lyric === '―'
}

function phonemesForCharacter(char: string): NeuralPhoneme[] {
  const code = char.codePointAt(0) ?? 0
  if (code < HANGUL_BASE || code > HANGUL_END) {
    return [{ symbol: char, role: 'literal', source: char, startRatio: 0, endRatio: 1 }]
  }

  const offset = code - HANGUL_BASE
  const onsetIndex = Math.floor(offset / (VOWEL_COUNT * CODA_COUNT))
  const vowelIndex = Math.floor((offset % (VOWEL_COUNT * CODA_COUNT)) / CODA_COUNT)
  const codaIndex = offset % CODA_COUNT
  const onset = ONSET_SYMBOLS[onsetIndex] ?? ''
  const vowel = VOWEL_SYMBOLS[vowelIndex] ?? ''
  const coda = CODA_SYMBOLS[codaIndex] ?? ''
  const result: NeuralPhoneme[] = []

  if (onset) {
    result.push({ symbol: onset, role: 'onset', source: char, startRatio: 0, endRatio: 0 })
  }
  result.push({ symbol: vowel, role: 'vowel', source: char, startRatio: 0, endRatio: 0 })
  if (coda) {
    result.push({ symbol: coda, role: 'coda', source: char, startRatio: 0, endRatio: 0 })
  }
  return result
}

function distributeRatios(phonemes: NeuralPhoneme[]) {
  if (phonemes.length === 0) {
    return phonemes
  }

  const weights = phonemes.map(phonemeRatioWeight)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  return phonemes.map((phoneme, index) => {
    const startRatio = cursor / total
    cursor += weights[index]
    return {
      ...phoneme,
      startRatio,
      endRatio: cursor / total,
    }
  })
}

function phonemeRatioWeight(phoneme: NeuralPhoneme) {
  if (phoneme.role === 'vowel') {
    return 7
  }
  if (phoneme.role === 'coda') {
    return 0.45
  }
  if (phoneme.role === 'silence') {
    return 1
  }
  return 0.9
}

function normalizePitchCurve(points: NeuralPitchPoint[]) {
  return points
    .map((point) => ({
      timeRatio: clamp(point.timeRatio, 0, 1),
      cents: Number.isFinite(point.cents) ? point.cents : 0,
    }))
    .sort((a, b) => a.timeRatio - b.timeRatio)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
