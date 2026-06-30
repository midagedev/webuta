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
      metadata: makeVoicebankMetadata(),
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
      metadata: makeVoicebankMetadata(),
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

  it('preserves the first note attack when preutterance would start before the timeline', async () => {
    const entry: OtoEntry = {
      fileName: 'do_C4.wav',
      path: 'WebUtau/do_C4.wav',
      alias: '도',
      offsetMs: 0,
      consonantMs: 100,
      cutoffMs: 0,
      preutteranceMs: 90,
      overlapMs: 18,
    }
    const voicebank: LoadedVoicebank = {
      id: 'test-bank',
      name: 'Test Bank',
      sourceFileName: 'test.zip',
      metadata: makeVoicebankMetadata(),
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
        return makeAudioBuffer(makeAttackOnlySource(0.42, 44100), 44100)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    const result = await renderer.render(makeSingleNoteProject())
    const first80Ms = result.samples.slice(0, Math.floor(0.08 * 44100))

    expect(energy(first80Ms)).toBeGreaterThan(0.015)
  })

  it('sustains long notes from the stable vowel body instead of looping the fading release', async () => {
    const entry: OtoEntry = {
      fileName: 'do_C4.wav',
      path: 'WebUtau/do_C4.wav',
      alias: '도',
      offsetMs: 0,
      consonantMs: 100,
      cutoffMs: 0,
      preutteranceMs: 50,
      overlapMs: 20,
    }
    const voicebank: LoadedVoicebank = {
      id: 'test-bank',
      name: 'Test Bank',
      sourceFileName: 'test.zip',
      metadata: makeVoicebankMetadata(),
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
        return makeAudioBuffer(makeVocalSourceWithRelease(1.1, 44100), 44100)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    const result = await renderer.render(makeLongNoteProject())
    const earlyBody = result.samples.slice(Math.floor(0.28 * 44100), Math.floor(0.48 * 44100))
    const lateBody = result.samples.slice(Math.floor(1.12 * 44100), Math.floor(1.32 * 44100))

    expect(energy(lateBody)).toBeGreaterThan(energy(earlyBody) * 0.45)
  })

  it('plays a Hangul coda tail once at release instead of looping it through the sustain body', async () => {
    const entry: OtoEntry = {
      fileName: 'yeon_C4.wav',
      path: 'WebUtau/yeon_C4.wav',
      alias: '연',
      offsetMs: 0,
      consonantMs: 95,
      cutoffMs: 0,
      preutteranceMs: 40,
      overlapMs: 18,
    }
    const voicebank: LoadedVoicebank = {
      id: 'test-bank',
      name: 'Test Bank',
      sourceFileName: 'test.zip',
      metadata: makeVoicebankMetadata(),
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
        return makeAudioBuffer(makeCodaTailOnlySource(1.0, 44100), 44100)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    const result = await renderer.render({
      ...makeLongNoteProject(),
      notes: [{ ...makeLongNoteProject().notes[0], lyric: '연' }],
    })
    const sustainBody = result.samples.slice(Math.floor(0.8 * 44100), Math.floor(1.2 * 44100))
    const releaseTail = result.samples.slice(Math.floor(2.06 * 44100), Math.floor(2.24 * 44100))

    const sustainEnergy = energy(sustainBody)
    const releaseEnergy = energy(releaseTail)

    expect(sustainEnergy).toBeLessThan(0.002)
    expect(releaseEnergy).toBeGreaterThan(0.01)
    expect(releaseEnergy).toBeGreaterThan(sustainEnergy * 8)
  })

  it('keeps early nasal coda gestures out of the repeated sustain loop', async () => {
    const entry: OtoEntry = {
      fileName: 'yeon_C4.wav',
      path: 'WebUtau/yeon_C4.wav',
      alias: '연',
      offsetMs: 0,
      consonantMs: 95,
      cutoffMs: 0,
      preutteranceMs: 40,
      overlapMs: 18,
    }
    const voicebank: LoadedVoicebank = {
      id: 'test-bank',
      name: 'Test Bank',
      sourceFileName: 'test.zip',
      metadata: makeVoicebankMetadata(),
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
        return makeAudioBuffer(makeEarlyCodaGestureSource(1.0, 44100), 44100)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    const result = await renderer.render({
      ...makeLongNoteProject(),
      notes: [{ ...makeLongNoteProject().notes[0], lyric: '연' }],
    })
    const sustainBody = result.samples.slice(Math.floor(0.8 * 44100), Math.floor(1.2 * 44100))
    const releaseTail = result.samples.slice(Math.floor(2.06 * 44100), Math.floor(2.24 * 44100))

    expect(energy(sustainBody)).toBeLessThan(0.002)
    expect(energy(releaseTail)).toBeGreaterThan(0.003)
  })

  it('overlays a VC coda tail when a Hangul batchim lyric falls back to its CV alias', async () => {
    const cvEntry: OtoEntry = {
      fileName: 'ga_C4.wav',
      path: 'WebUtau/ga_C4.wav',
      alias: '가',
      offsetMs: 0,
      consonantMs: 95,
      cutoffMs: 0,
      preutteranceMs: 40,
      overlapMs: 18,
    }
    const vcEntry: OtoEntry = {
      fileName: 'a_n_C4.wav',
      path: 'WebUtau/a_n_C4.wav',
      alias: 'ㅏㄴ',
      offsetMs: 0,
      consonantMs: 70,
      cutoffMs: -260,
      preutteranceMs: 30,
      overlapMs: 18,
    }
    const voicebank: LoadedVoicebank = {
      id: 'test-bank',
      name: 'Test Bank',
      sourceFileName: 'test.zip',
      metadata: makeVoicebankMetadata(),
      entries: [cvEntry, vcEntry],
      aliases: [cvEntry.alias, vcEntry.alias],
      sampleCount: 2,
      wavCount: 2,
      async readSample(entry) {
        return new Uint8Array([entry.path.includes('a_n') ? 2 : 1]).buffer
      },
    }
    const audioContext = {
      async decodeAudioData(buffer: ArrayBuffer) {
        const marker = new Uint8Array(buffer)[0]
        return marker === 2
          ? makeAudioBuffer(makeCodaTailOnlySource(0.86, 44100), 44100)
          : makeAudioBuffer(makeVocalSourceWithRelease(1.0, 44100), 44100)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    const result = await renderer.render({
      ...makeLongNoteProject(),
      notes: [{ ...makeLongNoteProject().notes[0], lyric: '간' }],
    })
    const releaseTail = result.samples.slice(Math.floor(2.06 * 44100), Math.floor(2.24 * 44100))

    expect(energy(releaseTail)).toBeGreaterThan(0.01)
  })

  it('uses CV sustain plus VC tail for Hangul coda lyrics even when an exact CVC sample exists', async () => {
    const cvEntry: OtoEntry = {
      fileName: 'yeo_C4.wav',
      path: 'WebUtau/yeo_C4.wav',
      alias: '여',
      offsetMs: 0,
      consonantMs: 95,
      cutoffMs: 0,
      preutteranceMs: 40,
      overlapMs: 18,
    }
    const cvcEntry: OtoEntry = {
      fileName: 'yeon_C4.wav',
      path: 'WebUtau/yeon_C4.wav',
      alias: '연',
      offsetMs: 0,
      consonantMs: 95,
      cutoffMs: 0,
      preutteranceMs: 40,
      overlapMs: 18,
    }
    const vcEntry: OtoEntry = {
      fileName: 'yeo_n_C4.wav',
      path: 'WebUtau/yeo_n_C4.wav',
      alias: 'ㅕㄴ',
      offsetMs: 0,
      consonantMs: 70,
      cutoffMs: -260,
      preutteranceMs: 30,
      overlapMs: 18,
    }
    const requestedPaths: string[] = []
    const voicebank: LoadedVoicebank = {
      id: 'test-bank',
      name: 'Test Bank',
      sourceFileName: 'test.zip',
      metadata: makeVoicebankMetadata(),
      entries: [cvcEntry, cvEntry, vcEntry],
      aliases: [cvcEntry.alias, cvEntry.alias, vcEntry.alias],
      sampleCount: 3,
      wavCount: 3,
      async readSample(entry) {
        requestedPaths.push(entry.path)
        return new Uint8Array([entry.path.includes('yeo_n') ? 2 : entry.path.includes('yeon') ? 3 : 1]).buffer
      },
    }
    const audioContext = {
      async decodeAudioData(buffer: ArrayBuffer) {
        const marker = new Uint8Array(buffer)[0]
        if (marker === 2) {
          return makeAudioBuffer(makeCodaTailOnlySource(0.86, 44100), 44100)
        }
        if (marker === 3) {
          return makeAudioBuffer(makeEarlyCodaGestureSource(1.0, 44100), 44100)
        }
        return makeAudioBuffer(makeVocalSourceWithRelease(1.0, 44100), 44100)
      },
    } as unknown as AudioContext

    const renderer = createUtauSampleRenderer(voicebank, audioContext)
    await renderer.render({
      ...makeLongNoteProject(),
      notes: [{ ...makeLongNoteProject().notes[0], lyric: '연' }],
    })

    expect(requestedPaths).toContain('WebUtau/yeo_C4.wav')
    expect(requestedPaths).toContain('WebUtau/yeo_n_C4.wav')
    expect(requestedPaths).not.toContain('WebUtau/yeon_C4.wav')
  })
})

function makeVoicebankMetadata() {
  return {
    characterPath: 'character.yaml',
    readme: {
      path: 'readme.txt',
      excerpt: 'Test UTAU voicebank.',
    },
    license: {
      path: 'license.txt',
      excerpt: 'Test voicebank license.',
    },
    licenseStatus: 'license-file-present' as const,
  }
}

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

function makeSingleNoteProject(): SongProject {
  return {
    id: 'test-project',
    name: 'Renderer Test',
    comment: '',
    bpm: 112,
    beatPerBar: 4,
    beatUnit: 4,
    tracks: [{ id: 'track', name: 'Main Vocal', color: 'Coral' }],
    parts: [{ id: 'part', trackId: 'track', name: 'Verse', start: 0, duration: TICKS_PER_BEAT * 2 }],
    notes: [{ id: 'n1', trackId: 'track', partId: 'part', start: 0, duration: 720, tone: 60, lyric: '도' }],
  }
}

function makeLongNoteProject(): SongProject {
  return {
    id: 'test-project',
    name: 'Renderer Test',
    comment: '',
    bpm: 112,
    beatPerBar: 4,
    beatUnit: 4,
    tracks: [{ id: 'track', name: 'Main Vocal', color: 'Coral' }],
    parts: [{ id: 'part', trackId: 'track', name: 'Verse', start: 0, duration: TICKS_PER_BEAT * 5 }],
    notes: [{ id: 'n1', trackId: 'track', partId: 'part', start: 0, duration: TICKS_PER_BEAT * 4, tone: 60, lyric: '도' }],
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

function makeAttackOnlySource(durationSeconds: number, sampleRate: number) {
  const samples = new Float32Array(Math.floor(durationSeconds * sampleRate))
  const attackSamples = Math.floor(0.045 * sampleRate)
  for (let i = 0; i < attackSamples; i++) {
    const t = i / sampleRate
    const envelope = Math.max(0, 1 - i / attackSamples)
    samples[i] =
      (Math.sin(2 * Math.PI * 261.63 * t) * 0.65 +
        Math.sin(2 * Math.PI * 523.25 * t) * 0.25 +
        Math.sin(2 * Math.PI * 1046.5 * t) * 0.12) *
      envelope
  }
  return samples
}

function makeVocalSourceWithRelease(durationSeconds: number, sampleRate: number) {
  const samples = makeVocalishSource(durationSeconds, sampleRate)
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate
    if (t > durationSeconds - 0.18) {
      samples[i] *= Math.max(0, (durationSeconds - t) / 0.18)
    }
  }
  return samples
}

function makeCodaTailOnlySource(durationSeconds: number, sampleRate: number) {
  const samples = new Float32Array(Math.floor(durationSeconds * sampleRate))
  const tailStart = Math.floor((durationSeconds - 0.22) * sampleRate)
  for (let i = tailStart; i < samples.length; i++) {
    const t = i / sampleRate
    const progress = (i - tailStart) / Math.max(1, samples.length - tailStart)
    const envelope = Math.min(1, progress / 0.15, (1 - progress) / 0.22)
    samples[i] = Math.sin(2 * Math.PI * 180 * t) * 0.55 * Math.max(0, envelope)
  }
  return samples
}

function makeEarlyCodaGestureSource(durationSeconds: number, sampleRate: number) {
  const samples = new Float32Array(Math.floor(durationSeconds * sampleRate))
  const tailStart = Math.floor((durationSeconds - 0.42) * sampleRate)
  for (let i = tailStart; i < samples.length; i++) {
    const t = i / sampleRate
    const progress = (i - tailStart) / Math.max(1, samples.length - tailStart)
    const envelope = Math.min(1, progress / 0.12, (1 - progress) / 0.22)
    samples[i] = Math.sin(2 * Math.PI * 180 * t) * 0.46 * Math.max(0, envelope)
  }
  return samples
}

function energy(samples: Float32Array) {
  return samples.reduce((sum, sample) => sum + Math.abs(sample), 0) / samples.length
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
