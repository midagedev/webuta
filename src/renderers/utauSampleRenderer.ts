import { findEntryForLyric, playbackRateForTone, type LoadedVoicebank } from '../voicebank'
import { projectDurationSeconds, sortedNotes, ticksToSeconds } from '../music'
import type { SongNote, SongProject } from '../types'
import type { VocalRenderer } from './types'

const SAMPLE_RATE = 44100

export function createUtauSampleRenderer(voicebank: LoadedVoicebank, audioContext: AudioContext): VocalRenderer {
  const cache = new Map<string, Promise<AudioBuffer>>()
  return {
    capability: {
      id: 'utau-sample',
      name: `${voicebank.name} Sample Renderer`,
      status: 'ready',
      exportWav: true,
      realtimePreview: true,
      notes: 'A first browser UTAU renderer that uses imported voicebank WAV samples and oto.ini aliases.',
    },
    async render(project) {
      const durationSeconds = projectDurationSeconds(project) + 1.2
      const samples = new Float32Array(Math.ceil(durationSeconds * SAMPLE_RATE))
      for (const note of sortedNotes(project.notes)) {
        const entry = findEntryForLyric(voicebank, note.lyric)
        const sample = await getSample(entry.path, async () => {
          const buffer = await voicebank.readSample(entry)
          return audioContext.decodeAudioData(buffer.slice(0))
        })
        mixSample(samples, project, note, sample, playbackRateForTone(entry, note.tone))
      }
      normalize(samples)
      return {
        samples,
        sampleRate: SAMPLE_RATE,
        durationSeconds,
      }
    },
  }

  function getSample(path: string, load: () => Promise<AudioBuffer>) {
    const cached = cache.get(path)
    if (cached) {
      return cached
    }
    const promise = load()
    cache.set(path, promise)
    return promise
  }
}

function mixSample(output: Float32Array, project: SongProject, note: SongNote, sample: AudioBuffer, playbackRate: number) {
  const source = sample.getChannelData(0)
  const startSample = Math.max(0, Math.floor(ticksToSeconds(note.start, project.bpm) * SAMPLE_RATE))
  const length = Math.max(1, Math.floor(ticksToSeconds(note.duration, project.bpm) * SAMPLE_RATE))
  const sourceRateRatio = sample.sampleRate / SAMPLE_RATE
  const rate = Math.max(0.25, Math.min(4, playbackRate)) * sourceRateRatio

  for (let i = 0; i < length && startSample + i < output.length; i++) {
    const sourceIndex = Math.floor(i * rate)
    const wrapped = sourceIndex < source.length ? sourceIndex : source.length - 1 - ((sourceIndex - source.length) % 2205)
    const sampleValue = source[Math.max(0, Math.min(source.length - 1, wrapped))] ?? 0
    const p = i / length
    const envelope = Math.min(1, p / 0.06, (1 - p) / 0.1)
    output[startSample + i] += sampleValue * envelope * 0.62
  }
}

function normalize(samples: Float32Array) {
  let peak = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample))
  }
  if (peak < 0.01) {
    return
  }
  const gain = Math.min(2.4, 0.88 / peak)
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= gain
  }
}
