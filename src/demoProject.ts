import { TICKS_PER_BEAT, type SongProject } from './types'

const trackId = 'track-main'
const partId = 'part-main'

export const demoProject: SongProject = {
  id: 'demo-ipad-garageband',
  name: 'First Vocal Sketch',
  comment: 'A small WebUtau project that can render a GarageBand-ready WAV.',
  bpm: 112,
  beatPerBar: 4,
  beatUnit: 4,
  source: {
    fileName: 'built-in-demo',
    format: 'webuta',
  },
  tracks: [
    {
      id: trackId,
      name: 'Main Vocal',
      color: 'Coral',
      singer: 'Korean Demo Voice',
      phonemizer: 'hangul syllable demo',
    },
  ],
  parts: [
    {
      id: partId,
      trackId,
      name: 'Verse',
      start: 0,
      duration: TICKS_PER_BEAT * 10,
    },
  ],
  notes: [
    { id: 'n1', trackId, partId, start: 0, duration: 420, tone: 60, lyric: '도' },
    { id: 'n2', trackId, partId, start: 480, duration: 360, tone: 62, lyric: '히' },
    { id: 'n3', trackId, partId, start: 960, duration: 420, tone: 64, lyric: '도' },
    { id: 'n4', trackId, partId, start: 1440, duration: 600, tone: 65, lyric: '히' },
    { id: 'n5', trackId, partId, start: 2160, duration: 420, tone: 67, lyric: '다' },
    { id: 'n6', trackId, partId, start: 2640, duration: 360, tone: 69, lyric: '이' },
    { id: 'n7', trackId, partId, start: 3120, duration: 420, tone: 67, lyric: '스' },
    { id: 'n8', trackId, partId, start: 3600, duration: 1080, tone: 64, lyric: '키' },
  ],
}
