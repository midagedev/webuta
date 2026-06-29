import { masterMonoMix } from '../audio/mastering'
import { projectDurationSeconds, sortedNotes, ticksToSeconds } from '../music'
import type { SongNote, SongProject } from '../types'
import { findBestEntryForLyric, playbackRateForTone, type LoadedVoicebank, type OtoEntry } from '../voicebank'
import type { VocalRenderer } from './types'

const SAMPLE_RATE = 44100
const MIN_LOOP_MS = 36
const MAX_LOOP_MS = 130
const LOOP_CROSSFADE_MS = 18
const LOOP_RELEASE_GUARD_MS = 120
const CONSONANT_GUARD_FADE_MS = 2
const VIBRATO_RATE_HZ = 5.4
const VIBRATO_DEPTH_CENTS = 16

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
      const notes = sortedNotes(project.notes)
      for (const [index, note] of notes.entries()) {
        const entry = findBestEntryForLyric(voicebank, note.lyric, note.tone)
        const sample = await getSample(entry.path, async () => {
          const buffer = await voicebank.readSample(entry)
          return audioContext.decodeAudioData(buffer.slice(0))
        })
        mixSample(samples, project, note, notes[index + 1], sample, playbackRateForTone(entry, note.tone), entry)
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
  nextNote: SongNote | undefined,
  sample: AudioBuffer,
  playbackRate: number,
  entry: OtoEntry,
) {
  const source = getMonoSampleData(sample)
  mixPreparedSample(output, project, note, nextNote, source, sample.sampleRate, playbackRate, entry)
}

function getMonoSampleData(sample: AudioBuffer) {
  const channelCount = Math.max(1, sample.numberOfChannels || 1)
  if (channelCount === 1) {
    return sample.getChannelData(0)
  }

  const length = sample.length || sample.getChannelData(0).length
  const mixed = new Float32Array(length)
  const gain = 1 / Math.sqrt(channelCount)
  for (let channel = 0; channel < channelCount; channel++) {
    const source = sample.getChannelData(channel)
    for (let i = 0; i < mixed.length; i++) {
      mixed[i] += (source[i] ?? 0) * gain
    }
  }
  return mixed
}

function mixPreparedSample(
  output: Float32Array,
  project: SongProject,
  note: SongNote,
  nextNote: SongNote | undefined,
  source: Float32Array,
  sourceSampleRate: number,
  playbackRate: number,
  entry?: OtoEntry,
) {
  const noteStartSeconds = ticksToSeconds(note.start, project.bpm)
  const noteDurationSeconds = ticksToSeconds(note.duration, project.bpm)
  const preutteranceSeconds = Math.max(0, (entry?.preutteranceMs ?? 0) / 1000)
  const overlapSeconds = clamp((entry?.overlapMs ?? 18) / 1000, 0.008, 0.14)
  const releaseSeconds = releaseSecondsForNote(project, note, nextNote, noteDurationSeconds)
  const renderStartSeconds = noteStartSeconds - preutteranceSeconds
  const startSample = Math.max(0, Math.floor(renderStartSeconds * SAMPLE_RATE))
  const renderLengthSeconds = preutteranceSeconds + noteDurationSeconds + releaseSeconds
  const length = Math.max(1, Math.ceil(renderLengthSeconds * SAMPLE_RATE))
  const sourceRateRatio = sourceSampleRate / SAMPLE_RATE
  const rate = Math.max(0.25, Math.min(4, playbackRate)) * sourceRateRatio
  const sourceWindow = makeSourceWindow(source.length, sourceSampleRate, entry)
  const loop = makeLoopWindow(sourceWindow, sourceSampleRate)
  const fadeInSamples = Math.max(16, Math.floor(overlapSeconds * SAMPLE_RATE))
  const consonantGuardFadeSamples = Math.max(12, msToSamples(CONSONANT_GUARD_FADE_MS, SAMPLE_RATE))
  const fadeOutSamples = Math.max(128, Math.floor(releaseSeconds * SAMPLE_RATE))
  const noteBodySamples = Math.max(1, Math.floor(noteDurationSeconds * SAMPLE_RATE))
  const consonantOutputSamples = Math.max(
    Math.floor(preutteranceSeconds * SAMPLE_RATE),
    Math.floor((sourceWindow.consonantEnd - sourceWindow.start) / Math.max(0.001, rate)),
  )
  let sourcePosition = sourceWindow.start

  for (let i = 0; i < length && startSample + i < output.length; i++) {
    const elapsedOutputSamples = i
    const sampleValue = readLoopedLinear(source, sourcePosition, loop)
    const preutteranceSamples = Math.floor(preutteranceSeconds * SAMPLE_RATE)
    const noteProgress = elapsedOutputSamples - preutteranceSamples
    const attack =
      elapsedOutputSamples <= consonantOutputSamples
        ? smoothstep(Math.min(1, elapsedOutputSamples / consonantGuardFadeSamples))
        : smoothstep(Math.min(1, elapsedOutputSamples / fadeInSamples))
    const release = smoothstep(Math.min(1, (noteBodySamples + fadeOutSamples - noteProgress) / fadeOutSamples))
    const envelope = Math.max(0, Math.min(attack, release))
    output[startSample + i] += sampleValue * envelope * 0.66
    sourcePosition += rate * vibratoRateMultiplier(noteProgress, noteBodySamples)
  }
}

function releaseSecondsForNote(
  project: SongProject,
  note: SongNote,
  nextNote: SongNote | undefined,
  noteDurationSeconds: number,
) {
  if (!nextNote || nextNote.trackId !== note.trackId) {
    return clamp(noteDurationSeconds * 0.22, 0.055, 0.18)
  }
  const noteEndSeconds = ticksToSeconds(note.start + note.duration, project.bpm)
  const nextStartSeconds = ticksToSeconds(nextNote.start, project.bpm)
  const gapSeconds = nextStartSeconds - noteEndSeconds
  if (gapSeconds <= 0.03) {
    return 0.035
  }
  if (gapSeconds <= 0.18) {
    return clamp(gapSeconds * 0.6, 0.04, 0.1)
  }
  return clamp(noteDurationSeconds * 0.2, 0.055, 0.16)
}

function vibratoRateMultiplier(noteProgressSamples: number, noteBodySamples: number) {
  if (noteBodySamples < SAMPLE_RATE * 0.42 || noteProgressSamples <= 0) {
    return 1
  }
  const progress = noteProgressSamples / noteBodySamples
  if (progress < 0.52 || progress > 0.96) {
    return 1
  }
  const seconds = noteProgressSamples / SAMPLE_RATE
  const depthRamp = smoothstep(clamp((progress - 0.52) / 0.18, 0, 1))
  const cents = Math.sin(seconds * Math.PI * 2 * VIBRATO_RATE_HZ) * VIBRATO_DEPTH_CENTS * depthRamp
  return 2 ** (cents / 1200)
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
  const guardedEnd = Math.max(sourceWindow.consonantEnd + minLoop, sourceWindow.end - msToSamples(LOOP_RELEASE_GUARD_MS, sampleRate))
  const available = guardedEnd - sourceWindow.consonantEnd
  if (available <= minLoop) {
    const start = Math.max(sourceWindow.start, guardedEnd - Math.max(minLoop, available))
    return { start, end: guardedEnd, crossfade: Math.max(8, Math.floor((guardedEnd - start) / 4)) }
  }
  const loopLength = Math.min(maxLoop, available)
  const start = guardedEnd - loopLength
  return {
    start,
    end: guardedEnd,
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

function smoothstep(value: number) {
  const x = clamp(value, 0, 1)
  return x * x * (3 - 2 * x)
}

function clampInt(value: number, min: number, max: number) {
  if (max < min) {
    return min
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}
