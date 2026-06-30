import { decodeMonoPcmWav } from '../audio/wav'
import { createNeuralRenderRequest, type NeuralRenderServiceResponse } from '../neuralRender'
import type { NeuralModelCard, RendererCapability, RendererStatus, SongProject } from '../types'
import type { VocalRenderer } from './types'

export type LocalNeuralRendererOptions = {
  endpoint: string
  fetchImpl?: typeof fetch
}

export class NeuralRenderServiceError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.code = code
    this.name = 'NeuralRenderServiceError'
  }
}

export type LocalNeuralServiceHealth = {
  version: 1
  ok: boolean
  licenseAccepted: boolean
  missingRuntimePaths: string[]
  model?: Partial<NeuralModelCard> & {
    id: string
    name: string
    language: string
    releaseStatus: NeuralModelCard['releaseStatus']
    licenseSummary: string
    usageNote: string
    status?: RendererStatus
  }
}

export function localNeuralRendererCapability(endpoint: string | undefined): RendererCapability {
  const configured = Boolean(endpoint?.trim())
  return {
    id: 'local-neural',
    name: 'Local Neural DiffSinger',
    status: configured ? 'ready' : 'blocked',
    exportWav: true,
    realtimePreview: false,
    notes: configured
      ? 'Uses a local WebUtau neural render service to run the DiffSinger path and return WAV audio.'
      : 'Set VITE_WEBUTA_NEURAL_ENDPOINT to enable the local DiffSinger render service.',
  }
}

export function createLocalNeuralRenderer({ endpoint, fetchImpl = fetch }: LocalNeuralRendererOptions): VocalRenderer {
  if (!endpoint.trim()) {
    throw new NeuralRenderServiceError('Local neural render endpoint is not configured.', 'server-unavailable')
  }
  return {
    capability: localNeuralRendererCapability(endpoint),
    async render(project: SongProject, options = {}) {
      const request = createNeuralRenderRequest(project, { includeRests: true, renderer: 'diffsinger' })
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: options.signal,
      })
      if (!response.ok) {
        throw new NeuralRenderServiceError(`Neural render service returned HTTP ${response.status}.`, 'server-unavailable')
      }
      const payload = (await response.json()) as NeuralRenderServiceResponse
      if (!payload.ok) {
        throw new NeuralRenderServiceError(payload.error.message, payload.error.code)
      }
      const wav = decodeMonoPcmWav(base64ToArrayBuffer(payload.audio.wavBase64))
      return {
        samples: wav.samples,
        sampleRate: wav.sampleRate,
        durationSeconds: wav.durationSeconds,
      }
    },
  }
}

export async function fetchLocalNeuralModelCard(endpoint: string, fetchImpl: typeof fetch = fetch): Promise<NeuralModelCard | null> {
  if (!endpoint.trim()) {
    return null
  }
  const response = await fetchImpl(localNeuralHealthEndpoint(endpoint))
  if (!response.ok) {
    return null
  }
  const health = (await response.json()) as LocalNeuralServiceHealth
  if (!health.model) {
    return null
  }
  return {
    id: health.model.id,
    name: health.model.name,
    rendererId: 'local-neural',
    language: health.model.language,
    status: health.model.status ?? (health.licenseAccepted && health.missingRuntimePaths.length === 0 ? 'ready' : 'blocked'),
    releaseStatus: health.model.releaseStatus,
    licenseSummary: health.model.licenseSummary,
    usageNote: health.model.usageNote,
    endpoint,
  }
}

export function localNeuralHealthEndpoint(renderEndpoint: string) {
  try {
    const url = new URL(renderEndpoint)
    url.pathname = url.pathname.replace(/\/render\/?$/u, '/health')
    if (!url.pathname.endsWith('/health')) {
      url.pathname = '/health'
    }
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return renderEndpoint.replace(/\/render\/?$/u, '/health')
  }
}

function base64ToArrayBuffer(base64: string) {
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes.buffer
  }
  const buffer = Buffer.from(base64, 'base64')
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}
