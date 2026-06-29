import { midiToHz, projectDurationSeconds, sortedNotes, ticksToSeconds } from '../music'
import type { SongNote, SongProject } from '../types'
import { masterMonoMix } from '../audio/mastering'
import type { VocalRenderer } from './types'

const SAMPLE_RATE = 44100

export const browserDemoRenderer: VocalRenderer = {
  capability: {
    id: 'browser-demo',
    name: 'Browser Demo Voice',
    status: 'ready',
    exportWav: true,
    realtimePreview: true,
    notes: 'A browser-safe placeholder renderer that makes pitched vocal-like tones for editing and GarageBand export tests.',
  },
  async render(project) {
    const durationSeconds = projectDurationSeconds(project) + 0.6
    const samples = new Float32Array(Math.ceil(durationSeconds * SAMPLE_RATE))
    for (const note of sortedNotes(project.notes)) {
      mixNote(samples, project, note)
    }
    masterMonoMix(samples, { sampleRate: SAMPLE_RATE, maxGain: 1.8, targetPeak: 0.82 })
    return {
      samples,
      sampleRate: SAMPLE_RATE,
      durationSeconds,
    }
  },
}

function mixNote(output: Float32Array, project: SongProject, note: SongNote) {
  const startSample = Math.max(0, Math.floor(ticksToSeconds(note.start, project.bpm) * SAMPLE_RATE))
  const length = Math.max(1, Math.floor(ticksToSeconds(note.duration, project.bpm) * SAMPLE_RATE))
  const frequency = midiToHz(note.tone)
  const vowel = vowelColor(note.lyric)

  for (let i = 0; i < length && startSample + i < output.length; i++) {
    const t = i / SAMPLE_RATE
    const p = i / length
    const envelope = Math.min(1, p / 0.08, (1 - p) / 0.12)
    const vibrato = Math.sin(2 * Math.PI * 5.2 * t) * 0.006
    const phase = 2 * Math.PI * frequency * (1 + vibrato) * t
    const breath = pseudoNoise(i + Math.floor(frequency)) * vowel.air * envelope
    const tone =
      Math.sin(phase) * vowel.fundamental +
      Math.sin(phase * 2) * vowel.second +
      Math.sin(phase * 3.01) * vowel.third +
      Math.sin(phase * 5.02) * vowel.brightness
    output[startSample + i] += (tone + breath) * envelope * 0.32
  }
}

function vowelColor(lyric: string) {
  const lower = lyric.toLowerCase()
  if (/[iy이히키기시치지리니미비피]/.test(lower)) {
    return { fundamental: 0.64, second: 0.16, third: 0.34, brightness: 0.16, air: 0.018 }
  }
  if (/[eo에애오어헤해케캐게개세새데대네내레래메매베배페패호허코커고거소서도더노너로러모머보버포퍼]/.test(lower)) {
    return { fundamental: 0.78, second: 0.31, third: 0.12, brightness: 0.08, air: 0.016 }
  }
  if (/[u우으후흐쿠크구그수스두드누느루르무므부브푸프유주즈추츠]/.test(lower)) {
    return { fundamental: 0.86, second: 0.18, third: 0.08, brightness: 0.04, air: 0.014 }
  }
  return { fundamental: 0.7, second: 0.28, third: 0.18, brightness: 0.1, air: 0.017 }
}

function pseudoNoise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return (value - Math.floor(value) - 0.5) * 2
}
