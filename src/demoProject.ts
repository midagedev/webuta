import { TICKS_PER_BEAT, type SongProject } from './types'
import { makeId } from './music'

const trackId = 'track-main'
const partId = 'part-main'

export type DemoSampleId =
  | 'neon-lift'
  | 'blue-hour'
  | 'retro-run'
  | 'moon-signal'
  | 'pink-noise'
  | 'rain-verse'
  | 'city-glide'

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
  {
    id: 'moon-signal',
    title: 'Moon Signal',
    mood: 'Dark Synth',
    detail: '받침이 있는 어두운 프리코러스',
    lyricLine: '달 빛 속 에 숨 은 말 을 켜',
    chordLine: 'Em -> C -> G -> D',
    project: makeSampleProject({
      id: 'demo-moon-signal',
      fileName: 'sample-moon-signal',
      name: 'Moon Signal Vocal',
      comment: 'A darker synth-pop Korean sample that exercises coda consonants and mid-range phrasing.',
      bpm: 112,
      partDuration: TICKS_PER_BEAT * 10,
      chords: [
        { symbol: 'Em', start: 0, duration: TICKS_PER_BEAT * 2, tone: 64, quality: 'min', tones: [64, 67, 71] },
        { symbol: 'C', start: TICKS_PER_BEAT * 2, duration: TICKS_PER_BEAT * 2, tone: 60, quality: 'maj', tones: [60, 64, 67] },
        { symbol: 'G', start: TICKS_PER_BEAT * 4, duration: TICKS_PER_BEAT * 2, tone: 67, quality: 'maj', tones: [67, 71, 74] },
        { symbol: 'D', start: TICKS_PER_BEAT * 6, duration: TICKS_PER_BEAT * 4, tone: 62, quality: 'maj', tones: [62, 66, 69] },
      ],
      notes: [
        { id: 'moon-1', start: 0, duration: 480, tone: 67, lyric: '달' },
        { id: 'moon-2', start: 480, duration: 360, tone: 71, lyric: '빛' },
        { id: 'moon-3', start: 960, duration: 480, tone: 74, lyric: '속' },
        { id: 'moon-4', start: 1440, duration: 240, tone: 72, lyric: '에' },
        { id: 'moon-5', start: 1680, duration: 600, tone: 71, lyric: '숨' },
        { id: 'moon-6', start: 2400, duration: 360, tone: 69, lyric: '은' },
        { id: 'moon-7', start: 2880, duration: 480, tone: 67, lyric: '말' },
        { id: 'moon-8', start: 3360, duration: 360, tone: 69, lyric: '을' },
        {
          id: 'moon-9',
          start: 3840,
          duration: 960,
          tone: 71,
          lyric: '켜',
          vibrato: { enabled: true, depthCents: 15, rateHz: 5.2, startPercent: 48 },
        },
      ],
    }),
  },
  {
    id: 'pink-noise',
    title: 'Pink Noise',
    mood: 'Hyperpop',
    detail: '빠른 당김음과 강한 받침 테스트',
    lyricLine: '핑 크 노 이 즈 가 심 장 을 깨 워',
    chordLine: 'Bm -> G -> D -> A',
    project: makeSampleProject({
      id: 'demo-pink-noise',
      fileName: 'sample-pink-noise',
      name: 'Pink Noise Vocal',
      comment: 'A fast hyperpop Korean sample with syncopated syllables and bright high notes.',
      bpm: 164,
      partDuration: TICKS_PER_BEAT * 8,
      chords: [
        { symbol: 'Bm', start: 0, duration: TICKS_PER_BEAT * 2, tone: 71, quality: 'min', tones: [71, 74, 78] },
        { symbol: 'G', start: TICKS_PER_BEAT * 2, duration: TICKS_PER_BEAT * 2, tone: 67, quality: 'maj', tones: [67, 71, 74] },
        { symbol: 'D', start: TICKS_PER_BEAT * 4, duration: TICKS_PER_BEAT * 2, tone: 62, quality: 'maj', tones: [62, 66, 69] },
        { symbol: 'A', start: TICKS_PER_BEAT * 6, duration: TICKS_PER_BEAT * 2, tone: 69, quality: 'maj', tones: [69, 73, 76] },
      ],
      notes: [
        { id: 'pink-1', start: 0, duration: 240, tone: 74, lyric: '핑' },
        { id: 'pink-2', start: 240, duration: 240, tone: 76, lyric: '크' },
        { id: 'pink-3', start: 480, duration: 480, tone: 78, lyric: '노' },
        { id: 'pink-4', start: 960, duration: 240, tone: 81, lyric: '이' },
        { id: 'pink-5', start: 1200, duration: 240, tone: 79, lyric: '즈' },
        { id: 'pink-6', start: 1440, duration: 360, tone: 78, lyric: '가' },
        { id: 'pink-7', start: 1920, duration: 240, tone: 83, lyric: '심' },
        { id: 'pink-8', start: 2160, duration: 240, tone: 81, lyric: '장' },
        { id: 'pink-9', start: 2400, duration: 240, tone: 79, lyric: '을' },
        { id: 'pink-10', start: 2640, duration: 360, tone: 78, lyric: '깨' },
        {
          id: 'pink-11',
          start: 3000,
          duration: 840,
          tone: 76,
          lyric: '워',
          vibrato: { enabled: true, depthCents: 20, rateHz: 6.1, startPercent: 40 },
        },
      ],
    }),
  },
  {
    id: 'rain-verse',
    title: 'Rain Verse',
    mood: 'Emo Ballad',
    detail: '긴 모음과 낮은 음역',
    lyricLine: '비 가 내 린 밤 너 를 부 르 네',
    chordLine: 'C -> G -> Am -> F',
    project: makeSampleProject({
      id: 'demo-rain-verse',
      fileName: 'sample-rain-verse',
      name: 'Rain Verse Vocal',
      comment: 'A slower emo-ballad Korean sample for sustained vowels and low-register notes.',
      bpm: 82,
      partDuration: TICKS_PER_BEAT * 12,
      chords: [
        { symbol: 'C', start: 0, duration: TICKS_PER_BEAT * 3, tone: 60, quality: 'maj', tones: [60, 64, 67] },
        { symbol: 'G', start: TICKS_PER_BEAT * 3, duration: TICKS_PER_BEAT * 3, tone: 67, quality: 'maj', tones: [67, 71, 74] },
        { symbol: 'Am', start: TICKS_PER_BEAT * 6, duration: TICKS_PER_BEAT * 3, tone: 69, quality: 'min', tones: [69, 72, 76] },
        { symbol: 'F', start: TICKS_PER_BEAT * 9, duration: TICKS_PER_BEAT * 3, tone: 65, quality: 'maj', tones: [65, 69, 72] },
      ],
      notes: [
        { id: 'rain-1', start: 0, duration: 600, tone: 60, lyric: '비' },
        { id: 'rain-2', start: 720, duration: 360, tone: 62, lyric: '가' },
        { id: 'rain-3', start: 1080, duration: 360, tone: 64, lyric: '내' },
        { id: 'rain-4', start: 1440, duration: 720, tone: 67, lyric: '린' },
        { id: 'rain-5', start: 2400, duration: 600, tone: 69, lyric: '밤' },
        { id: 'rain-6', start: 3000, duration: 360, tone: 67, lyric: '너' },
        { id: 'rain-7', start: 3360, duration: 360, tone: 64, lyric: '를' },
        { id: 'rain-8', start: 3840, duration: 480, tone: 62, lyric: '부' },
        { id: 'rain-9', start: 4320, duration: 360, tone: 64, lyric: '르' },
        {
          id: 'rain-10',
          start: 4800,
          duration: 960,
          tone: 60,
          lyric: '네',
          vibrato: { enabled: true, depthCents: 12, rateHz: 4.8, startPercent: 55 },
        },
      ],
    }),
  },
  {
    id: 'city-glide',
    title: 'City Glide',
    mood: 'City Pop',
    detail: '도시적인 코드감의 부드러운 후렴',
    lyricLine: '도 시 불 빛 위 로 우 린 날 아',
    chordLine: 'F -> E -> Am -> C',
    project: makeSampleProject({
      id: 'demo-city-glide',
      fileName: 'sample-city-glide',
      name: 'City Glide Vocal',
      comment: 'A city-pop Korean sample with a gentle chorus contour and warmer chord motion.',
      bpm: 106,
      partDuration: TICKS_PER_BEAT * 10,
      chords: [
        { symbol: 'F', start: 0, duration: TICKS_PER_BEAT * 2, tone: 65, quality: 'maj', tones: [65, 69, 72] },
        { symbol: 'E', start: TICKS_PER_BEAT * 2, duration: TICKS_PER_BEAT * 2, tone: 64, quality: 'maj', tones: [64, 68, 71] },
        { symbol: 'Am', start: TICKS_PER_BEAT * 4, duration: TICKS_PER_BEAT * 2, tone: 69, quality: 'min', tones: [69, 72, 76] },
        { symbol: 'C', start: TICKS_PER_BEAT * 6, duration: TICKS_PER_BEAT * 4, tone: 60, quality: 'maj', tones: [60, 64, 67] },
      ],
      notes: [
        { id: 'city-1', start: 0, duration: 360, tone: 69, lyric: '도' },
        { id: 'city-2', start: 360, duration: 240, tone: 71, lyric: '시' },
        { id: 'city-3', start: 600, duration: 360, tone: 72, lyric: '불' },
        { id: 'city-4', start: 960, duration: 480, tone: 74, lyric: '빛' },
        { id: 'city-5', start: 1440, duration: 360, tone: 76, lyric: '위' },
        { id: 'city-6', start: 1800, duration: 360, tone: 74, lyric: '로' },
        { id: 'city-7', start: 2400, duration: 480, tone: 72, lyric: '우' },
        { id: 'city-8', start: 2880, duration: 360, tone: 71, lyric: '린' },
        { id: 'city-9', start: 3360, duration: 360, tone: 69, lyric: '날' },
        {
          id: 'city-10',
          start: 3840,
          duration: 960,
          tone: 72,
          lyric: '아',
          vibrato: { enabled: true, depthCents: 13, rateHz: 5.0, startPercent: 52 },
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
