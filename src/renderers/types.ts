import type { RendererCapability, SongProject } from '../types'

export type RenderResult = {
  samples: Float32Array
  sampleRate: number
  durationSeconds: number
}

export type VocalRenderer = {
  capability: RendererCapability
  render(project: SongProject): Promise<RenderResult>
}
