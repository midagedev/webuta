import { describe, expect, it } from 'vitest'
import { TICKS_PER_BEAT, type SongProject } from '../types'
import type { LoadedVoicebank, OtoEntry } from '../voicebank'
import { createUtauSampleRenderer } from './utauSampleRenderer'

describe('UTAU sample renderer', () => {
  it('renders oto-aligned looped samples with bounded output', async () => {
    const entry: OtoEntry = {
      fileName: 'do_C4.wav',
      path: 'Teto/do_C4.wav',
      alias: 'ど',
      offsetMs: 18,
      consonantMs: 95,
      cutoffMs: 0,
      preutteranceMs: 48,
      overlapMs: 22,
    }
    const sourceSamples = makeVocalishSource(0.52, 44100)
    const voicebank: LoadedVoicebank = {
      id: 'test-bank',
      name: 'Test Bank',
      sourceFileName: 'test.zip',
      entries: [entry],
      aliases: [entry.alias],
      sampleCount: 1,
      wavCount: 1,
      async readSample() {
        return new ArrayBuffer(8)
      },
    }
    const audioContext = {
      async decodeAudioData() {
        return makeAudioBuffer(sourceSamples, 44100)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    const result = await renderer.render(makeProject())
    const peak = result.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
    const hasNonFiniteSample = result.samples.some((sample) => !Number.isFinite(sample))

    expect(result.sampleRate).toBe(44100)
    expect(result.samples.length).toBeGreaterThan(44100)
    expect(peak).toBeGreaterThan(0.04)
    expect(peak).toBeLessThanOrEqual(0.89)
    expect(hasNonFiniteSample).toBe(false)
  })

  it('downmixes stereo decoded samples before rendering', async () => {
    const entry: OtoEntry = {
      fileName: 'do_C4.wav',
      path: 'Teto/do_C4.wav',
      alias: 'ど',
      offsetMs: 0,
      consonantMs: 80,
      cutoffMs: 0,
      preutteranceMs: 30,
      overlapMs: 18,
    }
    const left = makeVocalishSource(0.42, 44100)
    const right = new Float32Array(left.length)
    for (let i = 0; i < right.length; i++) {
      right[i] = left[i] * 0.55
    }
    const voicebank: LoadedVoicebank = {
      id: 'test-bank',
      name: 'Test Bank',
      sourceFileName: 'test.zip',
      entries: [entry],
      aliases: [entry.alias],
      sampleCount: 1,
      wavCount: 1,
      async readSample() {
        return new ArrayBuffer(8)
      },
    }
    const audioContext = {
      async decodeAudioData() {
        return makeAudioBuffer(left, 44100, right)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    const result = await renderer.render(makeProject())
    const peak = result.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)

    expect(peak).toBeGreaterThan(0.04)
    expect(peak).toBeLessThanOrEqual(0.89)
  })
})

function makeProject(): SongProject {
  return {
    id: 'test-project',
    name: 'Renderer Test',
    comment: '',
    bpm: 112,
    beatPerBar: 4,
    beatUnit: 4,
    tracks: [{ id: 'track', name: 'Main Vocal', color: 'Coral' }],
    parts: [{ id: 'part', trackId: 'track', name: 'Verse', start: 0, duration: TICKS_PER_BEAT * 3 }],
    notes: [
      { id: 'n1', trackId: 'track', partId: 'part', start: 0, duration: 600, tone: 60, lyric: '도' },
      { id: 'n2', trackId: 'track', partId: 'part', start: 600, duration: 600, tone: 62, lyric: '도' },
    ],
  }
}

function makeVocalishSource(durationSeconds: number, sampleRate: number) {
  const samples = new Float32Array(Math.floor(durationSeconds * sampleRate))
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate
    const envelope = Math.min(1, t / 0.04, (durationSeconds - t) / 0.04)
    samples[i] =
      (Math.sin(2 * Math.PI * 261.63 * t) * 0.55 +
        Math.sin(2 * Math.PI * 523.25 * t) * 0.18 +
        Math.sin(2 * Math.PI * 784.9 * t) * 0.08) *
      Math.max(0, envelope)
  }
  return samples
}

function makeAudioBuffer(samples: Float32Array, sampleRate: number, rightSamples?: Float32Array) {
  const channels = rightSamples ? [samples, rightSamples] : [samples]
  return {
    sampleRate,
    length: samples.length,
    numberOfChannels: channels.length,
    getChannelData(channel: number) {
      if (!channels[channel]) {
        throw new Error(`Unexpected channel: ${channel}`)
      }
      return channels[channel]
    },
  } as AudioBuffer
}
