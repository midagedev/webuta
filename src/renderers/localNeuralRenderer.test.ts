import { describe, expect, it } from 'vitest'
import { encodeWav } from '../audio/wav'
import { demoProject } from '../demoProject'
import {
  createLocalNeuralRenderer,
  fetchLocalNeuralModelCard,
  localNeuralHealthEndpoint,
  localNeuralRendererCapability,
} from './localNeuralRenderer'

describe('local neural renderer', () => {
  it('reports blocked capability when no endpoint is configured', () => {
    expect(localNeuralRendererCapability('')).toMatchObject({
      id: 'local-neural',
      status: 'blocked',
      exportWav: true,
    })
  })

  it('posts a neural request and decodes WAV response samples', async () => {
    const wavBase64 = await wavResponseBase64(new Float32Array([0, 0.25, -0.25]))
    const controller = new AbortController()
    let fetchSignal: AbortSignal | null | undefined
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
      fetchSignal = init?.signal
      const request = JSON.parse(String(init?.body))
      expect(request.voice.renderer).toBe('diffsinger')
      expect(request.notes.some((note: { kind: string }) => note.kind === 'rest')).toBe(true)
      return new Response(
        JSON.stringify({
          version: 1,
          ok: true,
          audio: {
            contentType: 'audio/wav',
            sampleRate: 44100,
            durationSeconds: 3 / 44100,
            fileName: 'demo.wav',
            wavBase64,
          },
          diagnostics: {
            renderer: 'diffsinger',
            modelId: 'webuta-ko-neural-dev',
            renderSeconds: 0.1,
            warnings: [],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const renderer = createLocalNeuralRenderer({ endpoint: 'http://127.0.0.1:8787/render', fetchImpl })

    const result = await renderer.render(demoProject, { signal: controller.signal })

    expect(fetchSignal).toBe(controller.signal)
    expect(result.sampleRate).toBe(44100)
    expect(result.samples).toHaveLength(3)
    expect(result.samples[1]).toBeCloseTo(0.25, 4)
  })

  it('throws service error codes from failed neural responses', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          version: 1,
          ok: false,
          error: {
            code: 'license-not-accepted',
            message: 'Accept local model license terms before rendering.',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    const renderer = createLocalNeuralRenderer({ endpoint: 'http://127.0.0.1:8787/render', fetchImpl })

    await expect(renderer.render(demoProject)).rejects.toMatchObject({
      name: 'NeuralRenderServiceError',
      code: 'license-not-accepted',
      message: 'Accept local model license terms before rendering.',
    })
  })

  it('fetches the local service model card from the health endpoint', async () => {
    const fetchImpl = async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('http://127.0.0.1:8787/health')
      return new Response(
        JSON.stringify({
          version: 1,
          ok: true,
          licenseAccepted: true,
          missingRuntimePaths: [],
          model: {
            id: 'webuta-ko-v1',
            name: 'WebUtau KO V1',
            language: 'ko',
            status: 'ready',
            releaseStatus: 'private-lab',
            licenseSummary: 'Consent-reviewed private model.',
            usageNote: 'Checkpoint 200000 is available.',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    await expect(fetchLocalNeuralModelCard('http://127.0.0.1:8787/render', fetchImpl)).resolves.toMatchObject({
      id: 'webuta-ko-v1',
      rendererId: 'local-neural',
      status: 'ready',
      releaseStatus: 'private-lab',
      endpoint: 'http://127.0.0.1:8787/render',
    })
  })

  it('derives health endpoint URLs from render endpoints', () => {
    expect(localNeuralHealthEndpoint('http://127.0.0.1:8787/render')).toBe('http://127.0.0.1:8787/health')
    expect(localNeuralHealthEndpoint('http://127.0.0.1:8787/api/render')).toBe('http://127.0.0.1:8787/api/health')
  })

  it('propagates fetch abort errors without wrapping them as service failures', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    const fetchImpl = async () => {
      throw abortError
    }
    const renderer = createLocalNeuralRenderer({ endpoint: 'http://127.0.0.1:8787/render', fetchImpl })

    await expect(renderer.render(demoProject, { signal: new AbortController().signal })).rejects.toBe(abortError)
  })
})

async function wavResponseBase64(samples: Float32Array) {
  const bytes = new Uint8Array(await encodeWav(samples, 44100).arrayBuffer())
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}
