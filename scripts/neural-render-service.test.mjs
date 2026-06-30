import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNeuralRenderHttpServer, renderNeuralRequest } from './neural-render-service.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('local neural render service', () => {
  it('requires explicit local research license acceptance before rendering', async () => {
    const response = await renderNeuralRequest(makeRequest(), makeRuntime())

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'license-not-accepted',
      },
    })
  })

  it('reports missing local model runtime files with a stable error code', async () => {
    const root = makeTempRoot()
    const response = await renderNeuralRequest(makeRequest(), {
      acceptLocalResearchLicense: true,
      workDir: join(root, 'work'),
      diffSingerRoot: join(root, 'missing-diffsinger'),
      python: join(root, 'missing-python'),
      exp: join(root, 'missing-exp'),
      ckpt: 1,
      vocoder: 'missing-vocoder/model.ckpt',
    })

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'model-missing',
      },
    })
  })

  it('converts a WebUtau neural request, runs the configured runner, and returns WAV base64', async () => {
    const runtime = makeRuntime()
    const response = await renderNeuralRequest(makeRequest(), {
      ...runtime,
      acceptLocalResearchLicense: true,
      runner: fakeRunner,
    })

    if (!response.ok) {
      throw new Error(JSON.stringify(response))
    }
    expect(response.audio).toMatchObject({
      contentType: 'audio/wav',
      sampleRate: 44100,
      fileName: 'Do-Hi-Demo.wav',
    })
    expect(response.audio.wavBase64).toMatch(/^[A-Za-z0-9+/]+=*$/u)
    expect(Buffer.from(response.audio.wavBase64, 'base64').toString('ascii', 0, 4)).toBe('RIFF')
    expect(response.diagnostics.wav).toMatchObject({
      channels: 1,
      bitsPerSample: 16,
    })

    const ds = JSON.parse(readFileSync(response.diagnostics.artifacts.dsPath, 'utf8'))
    expect(ds[0].ph_seq).toContain('d o')
    expect(ds[0].ph_seq).toContain('h i')
  })

  it('preserves stable render timeout errors from the runner', async () => {
    const response = await renderNeuralRequest(makeRequest(), {
      ...makeRuntime(),
      acceptLocalResearchLicense: true,
      runner: () => {
        throw Object.assign(new Error('DiffSinger render timed out.'), { code: 'render-timeout' })
      },
    })

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'render-timeout',
        message: 'DiffSinger render timed out.',
      },
    })
  })

  it('maps aborted renders to a stable cancellation code before running inference', async () => {
    const controller = new AbortController()
    const runner = vi.fn(fakeRunner)
    controller.abort()

    const response = await renderNeuralRequest(makeRequest(), {
      ...makeRuntime(),
      acceptLocalResearchLicense: true,
      signal: controller.signal,
      runner,
    })

    expect(runner).not.toHaveBeenCalled()
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'render-cancelled',
      },
    })
  })

  it('serves health and render endpoints over local HTTP', async () => {
    const runtime = makeRuntime()
    const modelManifest = join(runtime.root, 'model-checkpoint.json')
    writeFileSync(
      modelManifest,
      JSON.stringify(
        {
          version: 1,
          model: {
            id: 'webuta-ko-v1',
            name: 'WebUtau KO V1',
            renderer: 'diffsinger',
            releaseStatus: 'private-family',
          },
          datasetIds: ['licensed-ko'],
          runtime: {
            ckpt: 1,
          },
          terms: {
            licenseSummary: 'Consent-reviewed private model.',
          },
        },
        null,
        2,
      ),
    )
    const server = createNeuralRenderHttpServer({
      ...runtime,
      modelManifest,
      acceptLocalResearchLicense: true,
      runner: fakeRunner,
    })
    await listen(server)
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`
      const health = await fetchJson(`${baseUrl}/health`)
      expect(health).toMatchObject({
        ok: true,
        licenseAccepted: true,
        missingRuntimePaths: [],
        model: {
          id: 'webuta-ko-v1',
          name: 'WebUtau KO V1',
          status: 'ready',
          releaseStatus: 'private-family',
          licenseSummary: 'Consent-reviewed private model.',
        },
      })

      const render = await fetchJson(`${baseUrl}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeRequest()),
      })
      expect(render).toMatchObject({
        ok: true,
        audio: {
          contentType: 'audio/wav',
          sampleRate: 44100,
        },
      })
    } finally {
      await close(server)
    }
  })
})

function makeRuntime() {
  const root = makeTempRoot()
  const diffSingerRoot = join(root, 'DiffSinger')
  const python = join(root, 'python')
  const exp = join(root, 'train-smoke')
  const vocoder = 'checkpoints/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt'

  mkdirSync(join(diffSingerRoot, 'scripts'), { recursive: true })
  mkdirSync(join(diffSingerRoot, 'checkpoints/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02'), { recursive: true })
  mkdirSync(exp, { recursive: true })
  writeFileSync(join(diffSingerRoot, 'scripts/infer.py'), '# fake infer.py\n')
  writeFileSync(join(diffSingerRoot, vocoder), 'fake vocoder\n')
  writeFileSync(join(exp, 'model_ckpt_steps_1.ckpt'), 'fake checkpoint\n')
  writeFileSync(python, '# fake python\n')

  return {
    root,
    workDir: join(root, 'work'),
    diffSingerRoot,
    python,
    exp,
    ckpt: 1,
    vocoder,
  }
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-neural-render-'))
  tempRoots.push(root)
  return root
}

function fakeRunner(config) {
  writePcmWav(join(config.outputDir, `${config.title}.wav`), new Float32Array([0, 0.25, -0.25, 0.1]), 44100)
}

function writePcmWav(path, samples, sampleRate) {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, 44 + index * 2)
  }
  writeFileSync(path, buffer)
}

function makeRequest() {
  return {
    version: 1,
    project: {
      id: 'do-hi-demo',
      title: 'Do Hi Demo',
      bpm: 120,
      timebase: 480,
    },
    voice: {
      id: 'webuta-ko-neural-dev',
      language: 'ko',
      renderer: 'diffsinger',
    },
    render: {
      sampleRate: 44100,
      format: 'wav',
      includeDiagnostics: true,
    },
    notes: [
      {
        kind: 'note',
        id: 'n1',
        trackId: 'main',
        partId: 'part',
        startTick: 0,
        durationTick: 360,
        startSeconds: 0,
        durationSeconds: 0.375,
        midi: 60,
        targetHz: 261.625565,
        lyric: '도',
        pitchCurve: [],
        phonemes: [
          { symbol: 'd', role: 'onset', source: '도', startRatio: 0, endRatio: 0.2 },
          { symbol: 'o', role: 'vowel', source: '도', startRatio: 0.2, endRatio: 1 },
        ],
      },
      {
        kind: 'note',
        id: 'n2',
        trackId: 'main',
        partId: 'part',
        startTick: 480,
        durationTick: 360,
        startSeconds: 0.5,
        durationSeconds: 0.375,
        midi: 64,
        targetHz: 329.627557,
        lyric: '히',
        pitchCurve: [],
        phonemes: [
          { symbol: 'h', role: 'onset', source: '히', startRatio: 0, endRatio: 0.2 },
          { symbol: 'i', role: 'vowel', source: '히', startRatio: 0.2, endRatio: 1 },
        ],
      },
    ],
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  return response.json()
}
