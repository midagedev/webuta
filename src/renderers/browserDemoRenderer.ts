import { midiToHz, projectDurationSeconds, sortedNotes, ticksToSeconds } from '../music'
import type { SongNote, SongProject } from '../types'
import { masterMonoMix } from '../audio/mastering'
import type { VocalRenderer } from './types'

const SAMPLE_RATE = 44100

export const browserDemoRenderer: VocalRenderer = {
  capability: {
    id: 'browser-demo',
    name: 'Korean Demo Voice',
    status: 'ready',
    exportWav: true,
    realtimePreview: true,
    notes: 'A browser-safe Korean guide voice that shapes Hangul syllables for editing and GarageBand export tests.',
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
  const voice = koreanDemoVoiceProfile(note.lyric)

  for (let i = 0; i < length && startSample + i < output.length; i++) {
    const t = i / SAMPLE_RATE
    const p = i / length
    const attack = smoothstep(Math.min(1, p / 0.08))
    const release = smoothstep(Math.min(1, (1 - p) / 0.12))
    const envelope = Math.min(attack, release)
    const vibratoDepth = smoothstep(Math.min(1, Math.max(0, (p - 0.42) / 0.28))) * 0.0048
    const vibrato = Math.sin(2 * Math.PI * 5.2 * t) * vibratoDepth
    const phase = 2 * Math.PI * frequency * (1 + vibrato) * t
    const onsetSeconds = Math.max(0.01, voice.onsetSeconds)
    const onsetProgress = Math.min(1, t / onsetSeconds)
    const onsetEdge = Math.min(1, t / 0.006)
    const onsetEnvelope = (1 - smoothstep(onsetProgress)) * onsetEdge
    const secondsLeft = (length - i) / SAMPLE_RATE
    const codaProgress = secondsLeft < voice.codaSeconds ? 1 - secondsLeft / Math.max(0.001, voice.codaSeconds) : 0
    const codaAmount = smoothstep(Math.max(0, Math.min(1, codaProgress)))
    const codaDamp = 1 - codaAmount * (1 - voice.codaDamp)
    const breath = pseudoNoise(i + Math.floor(frequency)) * voice.air
    const consonant =
      pseudoNoise(i * 3 + voice.noiseSeed) * voice.onsetNoise * onsetEnvelope +
      Math.sin(phase * voice.onsetToneRatio) * voice.onsetTone * onsetEnvelope
    const vowelTone =
      Math.sin(phase) * voice.fundamental +
      Math.sin(phase * 2) * voice.second +
      Math.sin(phase * 3.01) * voice.third +
      Math.sin(phase * 5.02) * voice.brightness
    const nasalOrLiquidTail = Math.sin(phase * 0.5) * voice.codaTone * codaAmount
    output[startSample + i] += ((vowelTone * codaDamp + nasalOrLiquidTail + breath) * envelope + consonant) * 0.32
  }
}

export type KoreanDemoVoiceProfile = {
  lyric: string
  onset: string
  vowel: string
  coda: string
  fundamental: number
  second: number
  third: number
  brightness: number
  air: number
  onsetNoise: number
  onsetTone: number
  onsetToneRatio: number
  onsetSeconds: number
  codaDamp: number
  codaTone: number
  codaSeconds: number
  noiseSeed: number
}

export function koreanDemoVoiceProfile(lyric: string): KoreanDemoVoiceProfile {
  const hangul = decomposeFirstHangulSyllable(lyric)
  const vowel = hangul ? vowelColor(hangul.vowel) : fallbackVowelColor(lyric)
  const onset = onsetColor(hangul?.onset ?? '')
  const coda = codaColor(hangul?.coda ?? '')
  return {
    lyric,
    onset: hangul?.onset ?? '',
    vowel: hangul?.vowel ?? '',
    coda: hangul?.coda ?? '',
    ...vowel,
    ...onset,
    ...coda,
    noiseSeed: lyricSeed(lyric),
  }
}

const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const HANGUL_ONSETS = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
]
const HANGUL_VOWELS = [
  'ㅏ',
  'ㅐ',
  'ㅑ',
  'ㅒ',
  'ㅓ',
  'ㅔ',
  'ㅕ',
  'ㅖ',
  'ㅗ',
  'ㅘ',
  'ㅙ',
  'ㅚ',
  'ㅛ',
  'ㅜ',
  'ㅝ',
  'ㅞ',
  'ㅟ',
  'ㅠ',
  'ㅡ',
  'ㅢ',
  'ㅣ',
]
const HANGUL_CODAS = [
  '',
  'ㄱ',
  'ㄲ',
  'ㄳ',
  'ㄴ',
  'ㄵ',
  'ㄶ',
  'ㄷ',
  'ㄹ',
  'ㄺ',
  'ㄻ',
  'ㄼ',
  'ㄽ',
  'ㄾ',
  'ㄿ',
  'ㅀ',
  'ㅁ',
  'ㅂ',
  'ㅄ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
]

function decomposeFirstHangulSyllable(text: string) {
  for (const char of text.trim()) {
    const code = char.charCodeAt(0)
    if (code < HANGUL_BASE || code > HANGUL_END) {
      continue
    }
    const offset = code - HANGUL_BASE
    const onsetIndex = Math.floor(offset / (21 * 28))
    const vowelIndex = Math.floor((offset % (21 * 28)) / 28)
    const codaIndex = offset % 28
    return {
      onset: HANGUL_ONSETS[onsetIndex] ?? '',
      vowel: HANGUL_VOWELS[vowelIndex] ?? '',
      coda: HANGUL_CODAS[codaIndex] ?? '',
    }
  }
  return null
}

function vowelColor(vowel: string) {
  if (['ㅣ', 'ㅟ', 'ㅚ'].includes(vowel)) {
    return { fundamental: 0.62, second: 0.15, third: 0.36, brightness: 0.18, air: 0.018 }
  }
  if (['ㅐ', 'ㅒ', 'ㅔ', 'ㅖ', 'ㅢ'].includes(vowel)) {
    return { fundamental: 0.68, second: 0.2, third: 0.3, brightness: 0.15, air: 0.017 }
  }
  if (['ㅏ', 'ㅑ', 'ㅘ', 'ㅙ'].includes(vowel)) {
    return { fundamental: 0.72, second: 0.3, third: 0.18, brightness: 0.12, air: 0.016 }
  }
  if (['ㅓ', 'ㅕ', 'ㅝ', 'ㅞ'].includes(vowel)) {
    return { fundamental: 0.78, second: 0.24, third: 0.12, brightness: 0.08, air: 0.016 }
  }
  if (['ㅗ', 'ㅛ'].includes(vowel)) {
    return { fundamental: 0.84, second: 0.2, third: 0.08, brightness: 0.05, air: 0.014 }
  }
  if (['ㅜ', 'ㅠ'].includes(vowel)) {
    return { fundamental: 0.88, second: 0.15, third: 0.07, brightness: 0.04, air: 0.014 }
  }
  if (vowel === 'ㅡ') {
    return { fundamental: 0.86, second: 0.18, third: 0.06, brightness: 0.035, air: 0.014 }
  }
  return { fundamental: 0.7, second: 0.28, third: 0.18, brightness: 0.1, air: 0.017 }
}

function fallbackVowelColor(lyric: string) {
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

function onsetColor(onset: string) {
  if (!onset || onset === 'ㅇ') {
    return { onsetNoise: 0.012, onsetTone: 0.02, onsetToneRatio: 1.5, onsetSeconds: 0.018 }
  }
  if (['ㄱ', 'ㄲ', 'ㅋ'].includes(onset)) {
    return { onsetNoise: onset === 'ㅋ' ? 0.24 : 0.17, onsetTone: 0.05, onsetToneRatio: 2.7, onsetSeconds: 0.042 }
  }
  if (['ㄷ', 'ㄸ', 'ㅌ'].includes(onset)) {
    return { onsetNoise: onset === 'ㅌ' ? 0.25 : 0.16, onsetTone: 0.045, onsetToneRatio: 3.1, onsetSeconds: 0.04 }
  }
  if (['ㅂ', 'ㅃ', 'ㅍ'].includes(onset)) {
    return { onsetNoise: onset === 'ㅍ' ? 0.22 : 0.12, onsetTone: 0.06, onsetToneRatio: 1.9, onsetSeconds: 0.036 }
  }
  if (['ㅅ', 'ㅆ', 'ㅎ'].includes(onset)) {
    return { onsetNoise: onset === 'ㅆ' ? 0.3 : 0.22, onsetTone: 0.025, onsetToneRatio: 5.2, onsetSeconds: 0.064 }
  }
  if (['ㅈ', 'ㅉ', 'ㅊ'].includes(onset)) {
    return { onsetNoise: onset === 'ㅊ' ? 0.26 : 0.2, onsetTone: 0.045, onsetToneRatio: 4.0, onsetSeconds: 0.05 }
  }
  if (['ㄴ', 'ㄹ', 'ㅁ'].includes(onset)) {
    return { onsetNoise: 0.035, onsetTone: 0.12, onsetToneRatio: onset === 'ㅁ' ? 0.5 : 0.75, onsetSeconds: 0.052 }
  }
  return { onsetNoise: 0.05, onsetTone: 0.05, onsetToneRatio: 2.0, onsetSeconds: 0.04 }
}

function codaColor(coda: string) {
  if (!coda) {
    return { codaDamp: 1, codaTone: 0, codaSeconds: 0.04 }
  }
  if (/[ㄴㄵㄶㅁㅇ]/.test(coda)) {
    return { codaDamp: 0.82, codaTone: 0.12, codaSeconds: 0.1 }
  }
  if (/[ㄹㄺㄻㄼㄽㄾㄿㅀ]/.test(coda)) {
    return { codaDamp: 0.74, codaTone: 0.08, codaSeconds: 0.09 }
  }
  return { codaDamp: 0.46, codaTone: 0.015, codaSeconds: 0.055 }
}

function lyricSeed(lyric: string) {
  return [...lyric].reduce((seed, char) => seed + char.charCodeAt(0), 17)
}

function smoothstep(value: number) {
  const x = Math.max(0, Math.min(1, value))
  return x * x * (3 - 2 * x)
}

function pseudoNoise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return (value - Math.floor(value) - 0.5) * 2
}
