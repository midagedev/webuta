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
  vibrato?: NoteVibrato
  pitchBend?: NotePitchBend
}

export type NoteVibrato = {
  enabled: boolean
  depthCents: number
  rateHz: number
  startPercent: number
}

export type NotePitchPoint = {
  timePercent: number
  cents: number
}

export type NotePitchBend = {
  points: NotePitchPoint[]
  modes?: string[]
}

export type TempoChange = {
  position: number
  bpm: number
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
  tempoChanges?: TempoChange[]
  beatPerBar: number
  beatUnit: number
  tracks: Track[]
  parts: VoicePart[]
  notes: SongNote[]
  source?: {
    fileName: string
    format: 'ust' | 'ustx-yaml' | 'ustx-json' | 'webuta'
  }
}

export type RenderedAudio = {
  blob: Blob
  url: string
  durationSeconds: number
  fileName: string
  wavInfo: WavInfo
}

export type RendererId = 'browser-demo' | 'utau-sample' | 'local-neural' | 'openutau-server' | 'worldline-wasm'

export type RendererStatus = 'ready' | 'planned' | 'blocked'

export type RendererCapability = {
  id: RendererId
  name: string
  status: RendererStatus
  exportWav: boolean
  realtimePreview: boolean
  notes: string
}

export type NeuralModelCard = {
  id: string
  name: string
  rendererId: RendererId
  language: string
  status: RendererStatus
  releaseStatus: 'bundled' | 'local-research' | 'private-lab' | 'public-beta' | 'planned' | 'user-provided'
  licenseSummary: string
  usageNote: string
  endpoint?: string
}

export type RenderHistoryEntry = {
  id: string
  createdAt: string
  projectName: string
  rendererId: RendererId
  rendererName: string
  status: 'success' | 'failed' | 'cancelled'
  fileName: string
  durationSeconds: number | null
  detail: string
}

export type RenderProgress = {
  phase: 'idle' | 'preparing' | 'rendering' | 'encoding' | 'ready' | 'failed' | 'cancelling' | 'cancelled'
  label: string
  percent: number
  cancellable: boolean
}

export type WorkspaceMode = 'compose' | 'pattern' | 'rows' | 'mixer'
