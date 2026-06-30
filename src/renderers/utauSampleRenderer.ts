import { masterMonoMix } from '../audio/mastering'
import { durationTicksToSeconds, projectDurationSeconds, sortedNotes, ticksToSecondsInProject } from '../music'
import { noteEnvelopeGainAt } from '../envelope'
import { noteIntensityGain, noteVelocityRate } from '../expression'
import { notePitchCentsAt } from '../pitchBend'
import { normalizeNoteTiming } from '../timing'
import type { SongNote, SongProject } from '../types'
import {
  findBestEntryForLyric,
  findCodaTailEntryForLyric,
  findSustainEntryForLyric,
  playbackRateForTone,
  type LoadedVoicebank,
  type OtoEntry,
} from '../voicebank'
import type { VocalRenderer } from './types'

const SAMPLE_RATE = 44100
const MIN_LOOP_MS = 180
const MAX_LOOP_MS = 620
const LOOP_CROSSFADE_MS = 110
const LOOP_RELEASE_GUARD_MS = 180
const CODA_RELEASE_TAIL_MS = 240
const CODA_LOOP_BODY_MS = 420
const CODA_LOOP_TAIL_GAP_MS = 70
const CONSONANT_GUARD_FADE_MS = 2
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
    async render(project, options = {}) {
      throwIfAborted(options.signal)
      const durationSeconds = projectDurationSeconds(project) + 1.2
      const samples = new Float32Array(Math.ceil(durationSeconds * SAMPLE_RATE))
      const notes = sortedNotes(project.notes)
      for (const [index, note] of notes.entries()) {
        throwIfAborted(options.signal)
        const sustainEntry = findSustainEntryForLyric(voicebank, note.lyric, note.tone)
        const entry = sustainEntry ?? findBestEntryForLyric(voicebank, note.lyric, note.tone)
        const codaTailEntry = resolveCodaTailEntry(voicebank, note.lyric, note.tone, entry, Boolean(sustainEntry))
        const sample = await getSample(entry.path, async () => {
          const buffer = await voicebank.readSample(entry)
          return audioContext.decodeAudioData(buffer.slice(0))
        })
        const codaTailSample = codaTailEntry
          ? await getSample(codaTailEntry.path, async () => {
              const buffer = await voicebank.readSample(codaTailEntry)
              return audioContext.decodeAudioData(buffer.slice(0))
            })
          : undefined
        throwIfAborted(options.signal)
        mixSample(samples, project, note, notes[index + 1], sample, playbackRateForTone(entry, note.tone), entry)
        if (codaTailEntry && codaTailSample) {
          mixCodaTailSample(
            samples,
            project,
            note,
            codaTailSample,
            playbackRateForTone(codaTailEntry, note.tone),
            codaTailEntry,
          )
        }
      }
      throwIfAborted(options.signal)
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

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Render cancelled.', 'AbortError')
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

function mixCodaTailSample(
  output: Float32Array,
  project: SongProject,
  note: SongNote,
  sample: AudioBuffer,
  playbackRate: number,
  entry: OtoEntry,
) {
  const source = getMonoSampleData(sample)
  const sourceSampleRate = sample.sampleRate
  const sourceRateRatio = sourceSampleRate / SAMPLE_RATE
  const rate = Math.max(0.25, Math.min(4, playbackRate)) * sourceRateRatio
  const intensityGain = noteIntensityGain(note)
  const tailSamples = Math.min(
    source.length,
    Math.max(
      msToSamples(Math.max(120, Math.abs(entry.cutoffMs || 0)), sourceSampleRate),
      msToSamples(CODA_RELEASE_TAIL_MS, sourceSampleRate),
    ),
  )
  const sourceStart = Math.max(0, source.length - tailSamples)
  const outputTailSamples = Math.ceil(tailSamples / Math.max(0.001, rate))
  const noteEndSample = Math.floor((ticksToSecondsInProject(note.start + note.duration, project) + 0.02) * SAMPLE_RATE)
  const startSample = clampInt(noteEndSample - Math.floor(outputTailSamples * 0.55), 0, output.length - 1)
  const noteStartSample = Math.floor(ticksToSecondsInProject(note.start, project) * SAMPLE_RATE)
  const noteDurationSeconds = durationTicksToSeconds(project, note.start, note.duration)
  const fadeInSamples = Math.max(24, Math.floor(outputTailSamples * 0.18))
  const fadeOutSamples = Math.max(48, Math.floor(outputTailSamples * 0.26))
  for (let i = 0; i < outputTailSamples && startSample + i < output.length; i += 1) {
    const sourcePosition = sourceStart + i * rate
    const fadeIn = smoothstep(i / fadeInSamples)
    const fadeOut = smoothstep((outputTailSamples - i) / fadeOutSamples)
    const progressSeconds = (startSample + i - noteStartSample) / SAMPLE_RATE
    const envelopeGain = noteEnvelopeGainAt(note, progressSeconds, noteDurationSeconds)
    output[startSample + i] +=
      readLinearUntil(source, sourcePosition, source.length) * Math.min(fadeIn, fadeOut) * 0.5 * intensityGain * envelopeGain
  }
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
  const timing = normalizeNoteTiming(note.timing)
  const noteStartSeconds = ticksToSecondsInProject(note.start, project)
  const noteDurationSeconds = durationTicksToSeconds(project, note.start, note.duration)
  const preutteranceSeconds = Math.max(0, (timing.preutteranceMs ?? entry?.preutteranceMs ?? 0) / 1000)
  const overlapSeconds = clamp((timing.voiceOverlapMs ?? entry?.overlapMs ?? 18) / 1000, 0.008, 0.14)
  const releaseSeconds = releaseSecondsForNote(project, note, nextNote, noteDurationSeconds)
  const renderStartSeconds = noteStartSeconds - preutteranceSeconds
  const startSample = Math.max(0, Math.floor(renderStartSeconds * SAMPLE_RATE))
  const renderLengthSeconds = preutteranceSeconds + noteDurationSeconds + releaseSeconds
  const length = Math.max(1, Math.ceil(renderLengthSeconds * SAMPLE_RATE))
  const sourceRateRatio = sourceSampleRate / SAMPLE_RATE
  const rate = Math.max(0.25, Math.min(4, playbackRate)) * sourceRateRatio
  const sourceWindow = makeSourceWindow(source.length, sourceSampleRate, entry, timing.sampleStartMs ?? 0)
  const loop = makeLoopWindow(sourceWindow, sourceSampleRate, hasHangulCoda(note.lyric))
  const fadeInSamples = Math.max(16, Math.floor(overlapSeconds * SAMPLE_RATE))
  const consonantGuardFadeSamples = Math.max(12, msToSamples(CONSONANT_GUARD_FADE_MS, SAMPLE_RATE))
  const fadeOutSamples = Math.max(128, Math.floor(releaseSeconds * SAMPLE_RATE))
  const noteBodySamples = Math.max(1, Math.floor(noteDurationSeconds * SAMPLE_RATE))
  const intensityGain = noteIntensityGain(note)
  const velocityRate = noteVelocityRate(note)
  const consonantOutputSamples = Math.max(
    Math.floor(preutteranceSeconds * SAMPLE_RATE),
    Math.floor((sourceWindow.consonantEnd - sourceWindow.start) / Math.max(0.001, rate)),
  )
  let sourcePosition = sourceWindow.start

  for (let i = 0; i < length && startSample + i < output.length; i++) {
    const elapsedOutputSamples = i
    const preutteranceSamples = Math.floor(preutteranceSeconds * SAMPLE_RATE)
    const noteProgress = elapsedOutputSamples - preutteranceSamples
    const sampleValue =
      noteProgress >= noteBodySamples
        ? readLinearUntil(source, loop.tailStart + (noteProgress - noteBodySamples) * rate, sourceWindow.end)
        : readLoopedLinear(source, sourcePosition, loop)
    const attack =
      elapsedOutputSamples <= consonantOutputSamples
        ? smoothstep(Math.min(1, elapsedOutputSamples / consonantGuardFadeSamples))
        : smoothstep(Math.min(1, elapsedOutputSamples / fadeInSamples))
    const release = smoothstep(Math.min(1, (noteBodySamples + fadeOutSamples - noteProgress) / fadeOutSamples))
    const envelope = Math.max(0, Math.min(attack, release))
    const expressionGain = noteEnvelopeGainAt(note, noteProgress / SAMPLE_RATE, noteDurationSeconds)
    output[startSample + i] += sampleValue * envelope * 0.66 * intensityGain * expressionGain
    const consonantRate = elapsedOutputSamples <= consonantOutputSamples ? velocityRate : 1
    sourcePosition += rate * consonantRate * pitchRateMultiplier(note, noteProgress, noteBodySamples)
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
  const noteEndSeconds = ticksToSecondsInProject(note.start + note.duration, project)
  const nextStartSeconds = ticksToSecondsInProject(nextNote.start, project)
  const gapSeconds = nextStartSeconds - noteEndSeconds
  if (gapSeconds <= 0.03) {
    return 0.035
  }
  if (gapSeconds <= 0.18) {
    return clamp(gapSeconds * 0.6, 0.04, 0.1)
  }
  return clamp(noteDurationSeconds * 0.2, 0.055, 0.16)
}

function pitchRateMultiplier(note: SongNote, noteProgressSamples: number, noteBodySamples: number) {
  if (noteBodySamples < SAMPLE_RATE * 0.42 || noteProgressSamples <= 0) {
    return 1
  }
  const progress = noteProgressSamples / noteBodySamples
  const seconds = noteProgressSamples / SAMPLE_RATE
  const cents = notePitchCentsAt(note, progress, seconds)
  return 2 ** (cents / 1200)
}

function makeSourceWindow(sourceLength: number, sampleRate: number, entry?: OtoEntry, sampleStartMs = 0) {
  const offset = msToSamples((entry?.offsetMs ?? 0) + sampleStartMs, sampleRate)
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

function makeLoopWindow(sourceWindow: { start: number; end: number; consonantEnd: number }, sampleRate: number, hasCoda: boolean) {
  const maxLoop = msToSamples(MAX_LOOP_MS, sampleRate)
  const minLoop = msToSamples(MIN_LOOP_MS, sampleRate)
  if (hasCoda) {
    return makeCodaAwareLoopWindow(sourceWindow, sampleRate, minLoop, maxLoop)
  }
  const guardedEnd = Math.max(sourceWindow.consonantEnd + minLoop, sourceWindow.end - msToSamples(LOOP_RELEASE_GUARD_MS, sampleRate))
  const available = guardedEnd - sourceWindow.consonantEnd
  if (available <= minLoop) {
    const start = Math.max(sourceWindow.start, guardedEnd - Math.max(minLoop, available))
    return {
      start,
      end: guardedEnd,
      tailStart: guardedEnd,
      crossfade: Math.max(8, Math.floor((guardedEnd - start) / 4)),
    }
  }
  const loopLength = Math.min(maxLoop, available)
  const start = guardedEnd - loopLength
  return {
    start,
    end: guardedEnd,
    tailStart: guardedEnd,
    crossfade: Math.min(msToSamples(LOOP_CROSSFADE_MS, sampleRate), Math.floor(loopLength / 2)),
  }
}

function makeCodaAwareLoopWindow(
  sourceWindow: { start: number; end: number; consonantEnd: number },
  sampleRate: number,
  minLoop: number,
  maxLoop: number,
) {
  const tailStart = clampInt(
    sourceWindow.end - msToSamples(CODA_RELEASE_TAIL_MS, sampleRate),
    sourceWindow.consonantEnd + 1,
    sourceWindow.end,
  )
  const latestLoopEnd = Math.max(
    sourceWindow.consonantEnd + 1,
    tailStart - msToSamples(CODA_LOOP_TAIL_GAP_MS, sampleRate),
  )
  const preferredLoopEnd = Math.min(sourceWindow.consonantEnd + msToSamples(CODA_LOOP_BODY_MS, sampleRate), latestLoopEnd)
  const loopEnd = clampInt(preferredLoopEnd, sourceWindow.consonantEnd + 1, latestLoopEnd)
  const available = loopEnd - sourceWindow.consonantEnd
  if (available <= minLoop) {
    const start = Math.max(sourceWindow.start, loopEnd - Math.max(16, available))
    return {
      start,
      end: loopEnd,
      tailStart,
      crossfade: Math.max(8, Math.floor((loopEnd - start) / 4)),
    }
  }
  const loopLength = Math.min(maxLoop, available)
  const start = Math.max(sourceWindow.consonantEnd, loopEnd - loopLength)
  return {
    start,
    end: loopEnd,
    tailStart,
    crossfade: Math.min(msToSamples(LOOP_CROSSFADE_MS, sampleRate), Math.floor(loopLength / 2)),
  }
}

function readLoopedLinear(
  source: Float32Array,
  sourcePosition: number,
  loop: { start: number; end: number; crossfade: number },
) {
  const loopLength = Math.max(1, loop.end - loop.start)
  let position = sourcePosition
  let wrappedOffset = -1
  if (position >= loop.end) {
    wrappedOffset = (position - loop.end) % loopLength
    position = loop.start + wrappedOffset
  }
  if (wrappedOffset >= 0) {
    const wrapFadeSamples = Math.min(loop.crossfade, Math.max(16, Math.floor(loopLength * 0.03)))
    if (wrappedOffset < wrapFadeSamples) {
      const blend = smoothstep(wrappedOffset / Math.max(1, wrapFadeSamples))
      const loopHead = linearSample(source, position)
      const loopTail = linearSample(source, loop.end - 1)
      return loopTail * (1 - blend) + loopHead * blend
    }
  }
  return linearSample(source, Math.min(position, loop.end - 1))
}

function readLinearUntil(source: Float32Array, sourcePosition: number, end: number) {
  if (sourcePosition >= end - 1) {
    return 0
  }
  return linearSample(source, sourcePosition)
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

function shouldOverlayCodaTail(entry: OtoEntry, lyric: string) {
  return hasHangulCoda(lyric) && entry.alias.trim() !== lyric.trim()
}

function resolveCodaTailEntry(
  voicebank: LoadedVoicebank,
  lyric: string,
  targetTone: number,
  entry: OtoEntry,
  hasSustainEntry: boolean,
) {
  if (!hasSustainEntry && !shouldOverlayCodaTail(entry, lyric)) {
    return undefined
  }
  const codaTailEntry = findCodaTailEntryForLyric(voicebank, lyric, targetTone)
  return codaTailEntry?.path === entry.path ? undefined : codaTailEntry
}

function hasHangulCoda(text: string) {
  for (const char of text.trim()) {
    const code = char.charCodeAt(0)
    if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0) {
      return true
    }
  }
  return false
}
