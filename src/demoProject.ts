import { TICKS_PER_BEAT, type SongProject } from './types'
import { makeId } from './music'

const trackId = 'track-main'
const partId = 'part-main'

export type DemoSampleId = 'neon-lift' | 'blue-hour' | 'retro-run'

export type DemoSample = {
  id: DemoSampleId
  title: string
  mood: string
  detail: string
  lyricLine: string
  chordLine: string
  project: SongProject
}

export const defaultDemoSampleId: DemoSampleId = 'neon-lift'

export const demoSamples: DemoSample[] = [
  {
    id: 'neon-lift',
    title: 'Neon Lift',
    mood: 'Cyber Pop',
    detail: '반짝이는 첫 훅',
    lyricLine: '네 오 빛 이 메 로 디 로 데 려 가',
    chordLine: 'Am -> F -> C -> G',
    project: makeSampleProject({
      id: 'demo-neon-lift',
      fileName: 'sample-neon-lift',
      name: 'First Vocal Sketch',
      comment: 'A cyber-pop Korean vocal hook for the first WebUtau sketch.',
      bpm: 128,
      partDuration: TICKS_PER_BEAT * 11,
      chords: [
        { symbol: 'Am', start: 0, duration: TICKS_PER_BEAT * 2, tone: 69, quality: 'min', tones: [69, 72, 76] },
        { symbol: 'F', start: TICKS_PER_BEAT * 2, duration: TICKS_PER_BEAT * 2, tone: 65, quality: 'maj', tones: [65, 69, 72] },
        { symbol: 'C', start: TICKS_PER_BEAT * 4, duration: TICKS_PER_BEAT * 2, tone: 60, quality: 'maj', tones: [60, 64, 67] },
        { symbol: 'G', start: TICKS_PER_BEAT * 6, duration: TICKS_PER_BEAT * 4, tone: 67, quality: 'maj', tones: [67, 71, 74] },
      ],
      notes: [
        { id: 'n1', start: 0, duration: 360, tone: 69, lyric: '네' },
        { id: 'n2', start: 480, duration: 360, tone: 71, lyric: '오' },
        { id: 'n3', start: 960, duration: 480, tone: 72, lyric: '빛' },
        { id: 'n4', start: 1440, duration: 240, tone: 71, lyric: '이' },
        { id: 'n5', start: 1680, duration: 240, tone: 74, lyric: '메' },
        { id: 'n6', start: 1920, duration: 360, tone: 72, lyric: '로' },
        { id: 'n7', start: 2400, duration: 360, tone: 71, lyric: '디' },
        { id: 'n8', start: 2880, duration: 360, tone: 69, lyric: '로' },
        { id: 'n9', start: 3360, duration: 360, tone: 72, lyric: '데' },
        { id: 'n10', start: 3840, duration: 360, tone: 74, lyric: '려' },
        {
          id: 'n11',
          start: 4320,
          duration: 960,
          tone: 76,
          lyric: '가',
          vibrato: { enabled: true, depthCents: 18, rateHz: 5.4, startPercent: 46 },
        },
      ],
    }),
  },
  {
    id: 'blue-hour',
    title: 'Blue Hour',
    mood: 'Dream Pop',
    detail: '밤 공기의 부드러운 훅',
    lyricLine: '밤 이 와 너 와 나 노 래 해',
    chordLine: 'F -> C -> G -> Am',
    project: makeSampleProject({
      id: 'demo-blue-hour',
      fileName: 'sample-blue-hour',
      name: 'Blue Hour Vocal',
      comment: 'A slower dream-pop Korean sample focused on long vowels and soft phrasing.',
      bpm: 94,
      partDuration: TICKS_PER_BEAT * 10,
      chords: [
        { symbol: 'F', start: 0, duration: TICKS_PER_BEAT * 2, tone: 65, quality: 'maj', tones: [65, 69, 72] },
        { symbol: 'C', start: TICKS_PER_BEAT * 2, duration: TICKS_PER_BEAT * 2, tone: 60, quality: 'maj', tones: [60, 64, 67] },
        { symbol: 'G', start: TICKS_PER_BEAT * 4, duration: TICKS_PER_BEAT * 2, tone: 67, quality: 'maj', tones: [67, 71, 74] },
        { symbol: 'Am', start: TICKS_PER_BEAT * 6, duration: TICKS_PER_BEAT * 4, tone: 69, quality: 'min', tones: [69, 72, 76] },
      ],
      notes: [
        { id: 'blue-1', start: 0, duration: 600, tone: 65, lyric: '밤' },
        { id: 'blue-2', start: 720, duration: 240, tone: 67, lyric: '이' },
        { id: 'blue-3', start: 960, duration: 600, tone: 69, lyric: '와' },
        { id: 'blue-4', start: 1680, duration: 480, tone: 72, lyric: '너' },
        { id: 'blue-5', start: 2160, duration: 480, tone: 71, lyric: '와' },
        { id: 'blue-6', start: 2640, duration: 480, tone: 69, lyric: '나' },
        { id: 'blue-7', start: 3120, duration: 480, tone: 67, lyric: '노' },
        { id: 'blue-8', start: 3600, duration: 360, tone: 69, lyric: '래' },
        {
          id: 'blue-9',
          start: 4080,
          duration: 720,
          tone: 65,
          lyric: '해',
          vibrato: { enabled: true, depthCents: 14, rateHz: 5.1, startPercent: 50 },
        },
      ],
    }),
  },
  {
    id: 'retro-run',
    title: 'Retro Run',
    mood: 'Retro Game',
    detail: '도트 게임 같은 빠른 훅',
    lyricLine: '레 트 로 비 트 로 뛰 어 가',
    chordLine: 'Dm -> Bb -> F -> C',
    project: makeSampleProject({
      id: 'demo-retro-run',
      fileName: 'sample-retro-run',
      name: 'Retro Run Vocal',
      comment: 'A bright retro-game Korean sample with short notes and a punchy final sustain.',
      bpm: 150,
      partDuration: TICKS_PER_BEAT * 8,
      chords: [
        { symbol: 'Dm', start: 0, duration: TICKS_PER_BEAT * 2, tone: 62, quality: 'min', tones: [62, 65, 69] },
        { symbol: 'Bb', start: TICKS_PER_BEAT * 2, duration: TICKS_PER_BEAT * 2, tone: 58, quality: 'maj', tones: [58, 62, 65] },
        { symbol: 'F', start: TICKS_PER_BEAT * 4, duration: TICKS_PER_BEAT * 2, tone: 65, quality: 'maj', tones: [65, 69, 72] },
        { symbol: 'C', start: TICKS_PER_BEAT * 6, duration: TICKS_PER_BEAT * 2, tone: 60, quality: 'maj', tones: [60, 64, 67] },
      ],
      notes: [
        { id: 'retro-1', start: 0, duration: 240, tone: 62, lyric: '레' },
        { id: 'retro-2', start: 240, duration: 240, tone: 65, lyric: '트' },
        { id: 'retro-3', start: 480, duration: 480, tone: 69, lyric: '로' },
        { id: 'retro-4', start: 960, duration: 240, tone: 74, lyric: '비' },
        { id: 'retro-5', start: 1200, duration: 240, tone: 72, lyric: '트' },
        { id: 'retro-6', start: 1440, duration: 480, tone: 69, lyric: '로' },
        { id: 'retro-7', start: 1920, duration: 360, tone: 77, lyric: '뛰' },
        { id: 'retro-8', start: 2400, duration: 360, tone: 76, lyric: '어' },
        {
          id: 'retro-9',
          start: 2880,
          duration: 960,
          tone: 74,
          lyric: '가',
          vibrato: { enabled: true, depthCents: 16, rateHz: 5.8, startPercent: 42 },
        },
      ],
    }),
  },
]

export const demoProject: SongProject = demoSamples[0].project

export const starterProject: SongProject = {
  id: 'starter-vocal-project',
  name: 'Untitled Vocal Sketch',
  comment: 'A fresh WebUtau project for drawing a new vocal line.',
  bpm: 112,
  beatPerBar: 4,
  beatUnit: 4,
  source: {
    fileName: 'new-project',
    format: 'webuta',
  },
  tracks: [
    {
      id: trackId,
      name: 'Main Vocal',
      color: 'Coral',
      singer: 'WebUtau Korean V3 Synthetic',
      phonemizer: 'hangul cv/vc synthetic',
    },
  ],
  parts: [
    {
      id: partId,
      trackId,
      name: 'Verse',
      start: 0,
      duration: TICKS_PER_BEAT * 4,
    },
  ],
  notes: [
    { id: 's1', trackId, partId, start: 0, duration: 480, tone: 60, lyric: '라' },
    { id: 's2', trackId, partId, start: 480, duration: 480, tone: 62, lyric: '라' },
    { id: 's3', trackId, partId, start: 960, duration: 480, tone: 64, lyric: '라' },
    { id: 's4', trackId, partId, start: 1440, duration: 960, tone: 67, lyric: '라' },
  ],
}

export function createDemoProject(sampleId: DemoSampleId = defaultDemoSampleId): SongProject {
  return cloneProject(findDemoSample(sampleId).project)
}

export function findDemoSample(sampleId: string): DemoSample {
  return demoSamples.find((sample) => sample.id === sampleId) ?? demoSamples[0]
}

export function createStarterProject(): SongProject {
  return cloneProject(starterProject)
}

export function duplicateProject(project: SongProject): SongProject {
  return cloneProject({
    ...project,
    name: `${project.name} Copy`,
    source: {
      fileName: 'duplicated-project',
      format: 'webuta',
    },
  })
}

function cloneProject(project: SongProject): SongProject {
  return {
    ...project,
    id: makeId('project'),
    tracks: project.tracks.map((track) => ({ ...track })),
    parts: project.parts.map((part) => ({ ...part })),
    chords: project.chords?.map((chord) => ({ ...chord, tones: chord.tones ? [...chord.tones] : undefined })),
    tempoChanges: project.tempoChanges?.map((tempo) => ({ ...tempo })),
    notes: project.notes.map((note) => ({
      ...note,
      timing: note.timing ? { ...note.timing } : undefined,
      envelope: note.envelope ? { ...note.envelope } : undefined,
      vibrato: note.vibrato ? { ...note.vibrato } : undefined,
      pitchBend: note.pitchBend
        ? {
            ...note.pitchBend,
            points: note.pitchBend.points.map((point) => ({ ...point })),
            modes: note.pitchBend.modes ? [...note.pitchBend.modes] : undefined,
          }
        : undefined,
    })),
    source: project.source ? { ...project.source } : undefined,
  }
}

function makeSampleProject(input: {
  id: string
  fileName: string
  name: string
  comment: string
  bpm: number
  partDuration: number
  chords: NonNullable<SongProject['chords']>
  notes: Array<Omit<SongProject['notes'][number], 'trackId' | 'partId'>>
}): SongProject {
  return {
    id: input.id,
    name: input.name,
    comment: input.comment,
    bpm: input.bpm,
    beatPerBar: 4,
    beatUnit: 4,
    chords: input.chords,
    source: {
      fileName: input.fileName,
      format: 'webuta',
    },
    tracks: [
      {
        id: trackId,
        name: 'Main Vocal',
        color: 'Coral',
        singer: 'WebUtau Korean V3 Synthetic',
        phonemizer: 'hangul cv/vc synthetic',
      },
    ],
    parts: [
      {
        id: partId,
        trackId,
        name: 'Hook',
        start: 0,
        duration: input.partDuration,
      },
    ],
    notes: input.notes.map((note) => ({
      ...note,
      trackId,
      partId,
    })),
  }
}
