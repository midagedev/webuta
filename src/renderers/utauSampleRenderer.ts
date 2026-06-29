import { masterMonoMix } from '../audio/mastering'
import { projectDurationSeconds, sortedNotes, ticksToSeconds } from '../music'
import type { SongNote, SongProject } from '../types'
import { findBestEntryForLyric, playbackRateForTone, type LoadedVoicebank, type OtoEntry } from '../voicebank'
import type { VocalRenderer } from './types'

const SAMPLE_RATE = 44100
const MIN_LOOP_MS = 36
const MAX_LOOP_MS = 130
const LOOP_CROSSFADE_MS = 18

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
        const entry = findBestEntryForLyric(voicebank, note.lyric, note.tone)
        const sample = await getSample(entry.path, async () => {
          const buffer = await voicebank.readSample(entry)
          return audioContext.decodeAudioData(buffer.slice(0))
        })
        mixSample(samples, project, note, sample, playbackRateForTone(entry, note.tone), entry)
      }
      masterMonoMix(samples, { sampleRate: SAMPLE_RATE, maxGain: 2.4, targetPeak: 0.88 })
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

function mixSample(
  output: Float32Array,
  project: SongProject,
  note: SongNote,
  sample: AudioBuffer,
  playbackRate: number,
  entry: OtoEntry,
) {
  const source = sample.getChannelData(0)
  mixPreparedSample(output, project, note, source, sample.sampleRate, playbackRate, entry)
}

function mixPreparedSample(
  output: Float32Array,
  project: SongProject,
  note: SongNote,
  source: Float32Array,
  sourceSampleRate: number,
  playbackRate: number,
  entry?: OtoEntry,
) {
  const noteStartSeconds = ticksToSeconds(note.start, project.bpm)
  const noteDurationSeconds = ticksToSeconds(note.duration, project.bpm)
  const preutteranceSeconds = Math.max(0, (entry?.preutteranceMs ?? 0) / 1000)
  const overlapSeconds = clamp((entry?.overlapMs ?? 18) / 1000, 0.008, 0.14)
  const releaseSeconds = clamp(noteDurationSeconds * 0.22, 0.055, 0.18)
  const renderStartSeconds = noteStartSeconds - preutteranceSeconds
  const startSample = Math.max(0, Math.floor(renderStartSeconds * SAMPLE_RATE))
  const skippedSeconds = Math.max(0, -renderStartSeconds)
  const renderLengthSeconds = preutteranceSeconds + noteDurationSeconds + releaseSeconds - skippedSeconds
  const length = Math.max(1, Math.ceil(renderLengthSeconds * SAMPLE_RATE))
  const sourceRateRatio = sourceSampleRate / SAMPLE_RATE
  const rate = Math.max(0.25, Math.min(4, playbackRate)) * sourceRateRatio
  const sourceWindow = makeSourceWindow(source.length, sourceSampleRate, entry)
  const loop = makeLoopWindow(sourceWindow, sourceSampleRate)
  const fadeInSamples = Math.max(64, Math.floor(overlapSeconds * SAMPLE_RATE))
  const fadeOutSamples = Math.max(128, Math.floor(releaseSeconds * SAMPLE_RATE))
  const noteBodySamples = Math.max(1, Math.floor(noteDurationSeconds * SAMPLE_RATE))

  for (let i = 0; i < length && startSample + i < output.length; i++) {
    const elapsedOutputSamples = i + Math.floor(skippedSeconds * SAMPLE_RATE)
    const sourcePosition = sourceWindow.start + elapsedOutputSamples * rate
    const sampleValue = readLoopedLinear(source, sourcePosition, loop)
    const preutteranceSamples = Math.floor(preutteranceSeconds * SAMPLE_RATE)
    const noteProgress = elapsedOutputSamples - preutteranceSamples
    const attack = Math.min(1, elapsedOutputSamples / fadeInSamples)
    const release = Math.min(1, (noteBodySamples + fadeOutSamples - noteProgress) / fadeOutSamples)
    const envelope = Math.max(0, Math.min(attack, release))
    output[startSample + i] += sampleValue * envelope * 0.66
  }
}

function makeSourceWindow(sourceLength: number, sampleRate: number, entry?: OtoEntry) {
  const offset = msToSamples(entry?.offsetMs ?? 0, sampleRate)
  const cutoff = entry?.cutoffMs ?? 0
  const start = clampInt(offset, 0, Math.max(0, sourceLength - 1))
  const end =
    cutoff < 0
      ? clampInt(start + msToSamples(Math.abs(cutoff), sampleRate), start + 1, sourceLength)
      : clampInt(sourceLength - msToSamples(cutoff, sampleRate), start + 1, sourceLength)
  const consonantEnd = clampInt(
    start + msToSamples(Math.max(entry?.consonantMs ?? 0, entry?.preutteranceMs ?? 0, 80), sampleRate),
    start,
    end,
  )
  return { start, end, consonantEnd }
}

function makeLoopWindow(sourceWindow: { start: number; end: number; consonantEnd: number }, sampleRate: number) {
  const maxLoop = msToSamples(MAX_LOOP_MS, sampleRate)
  const minLoop = msToSamples(MIN_LOOP_MS, sampleRate)
  const available = sourceWindow.end - sourceWindow.consonantEnd
  if (available <= minLoop) {
    const start = Math.max(sourceWindow.start, sourceWindow.end - Math.max(minLoop, available))
    return { start, end: sourceWindow.end, crossfade: Math.max(8, Math.floor((sourceWindow.end - start) / 4)) }
  }
  const loopLength = Math.min(maxLoop, available)
  const start = sourceWindow.end - loopLength
  return {
    start,
    end: sourceWindow.end,
    crossfade: Math.min(msToSamples(LOOP_CROSSFADE_MS, sampleRate), Math.floor(loopLength / 2)),
  }
}

function readLoopedLinear(source: Float32Array, sourcePosition: number, loop: { start: number; end: number; crossfade: number }) {
  const loopLength = Math.max(1, loop.end - loop.start)
  let position = sourcePosition
  if (position >= loop.end) {
    position = loop.start + ((position - loop.start) % loopLength)
  }
  if (position >= loop.start && position < loop.start + loop.crossfade) {
    const blend = (position - loop.start) / Math.max(1, loop.crossfade)
    const loopHead = linearSample(source, position)
    const loopTail = linearSample(source, loop.end - loop.crossfade + (position - loop.start))
    return loopTail * (1 - blend) + loopHead * blend
  }
  return linearSample(source, Math.min(position, loop.end - 1))
}

function linearSample(source: Float32Array, position: number) {
  const index = Math.floor(position)
  const fraction = position - index
  const current = source[clampInt(index, 0, source.length - 1)] ?? 0
  const next = source[clampInt(index + 1, 0, source.length - 1)] ?? current
  return current + (next - current) * fraction
}

function msToSamples(ms: number, sampleRate: number) {
  return Math.max(0, Math.floor((ms / 1000) * sampleRate))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clampInt(value: number, min: number, max: number) {
  if (max < min) {
    return min
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}
