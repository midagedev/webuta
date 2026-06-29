import type { WavInfo } from './audio/wav'

export const TICKS_PER_BEAT = 480

export type Track = {
  id: string
  name: string
  color: string
  singer?: string
  phonemizer?: string
}

export type SongNote = {
  id: string
  trackId: string
  partId: string
  start: number
  duration: number
  tone: number
  lyric: string
}

export type VoicePart = {
  id: string
  trackId: string
  name: string
  start: number
  duration: number
}

export type SongProject = {
  id: string
  name: string
  comment: string
  bpm: number
  beatPerBar: number
  beatUnit: number
  tracks: Track[]
  parts: VoicePart[]
  notes: SongNote[]
  source?: {
    fileName: string
    format: 'ustx-yaml' | 'ustx-json' | 'webuta'
  }
}

export type RenderedAudio = {
  blob: Blob
  url: string
  durationSeconds: number
  fileName: string
  wavInfo: WavInfo
}

export type RendererId = 'browser-demo' | 'utau-sample' | 'openutau-server' | 'worldline-wasm'

export type RendererStatus = 'ready' | 'planned' | 'blocked'

export type RendererCapability = {
  id: RendererId
  name: string
  status: RendererStatus
  exportWav: boolean
  realtimePreview: boolean
  notes: string
}
