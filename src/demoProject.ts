import { TICKS_PER_BEAT, type SongProject } from './types'
import { makeId } from './music'

const trackId = 'track-main'
const partId = 'part-main'

export const demoProject: SongProject = {
  id: 'demo-vocal-synth',
  name: 'First Vocal Sketch',
  comment: 'A small WebUtau project for sketching a browser vocal line.',
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
      duration: TICKS_PER_BEAT * 10,
    },
  ],
  notes: [
    { id: 'n1', trackId, partId, start: 0, duration: 420, tone: 64, lyric: '도' },
    { id: 'n2', trackId, partId, start: 480, duration: 360, tone: 67, lyric: '히' },
    { id: 'n3', trackId, partId, start: 960, duration: 420, tone: 64, lyric: '도' },
    { id: 'n4', trackId, partId, start: 1440, duration: 600, tone: 69, lyric: '히' },
    { id: 'n5', trackId, partId, start: 2160, duration: 420, tone: 67, lyric: '다' },
    { id: 'n6', trackId, partId, start: 2640, duration: 360, tone: 69, lyric: '이' },
    { id: 'n7', trackId, partId, start: 3120, duration: 420, tone: 65, lyric: '스' },
    { id: 'n8', trackId, partId, start: 3600, duration: 1080, tone: 64, lyric: '키' },
  ],
}

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

export function createDemoProject(): SongProject {
  return cloneProject(demoProject)
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
    notes: project.notes.map((note) => ({ ...note })),
    source: project.source ? { ...project.source } : undefined,
  }
}
