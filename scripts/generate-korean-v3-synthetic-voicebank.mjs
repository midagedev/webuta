#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const SAMPLE_RATE = 44100
const OUTPUT = join(process.cwd(), 'public/voicebanks/webuta-ko-v3.zip')
const ZIP_FILE_DATE = '2026-01-01T00:00:00.000Z'

const PITCHES = [
  { name: 'C4', midi: 60, hz: 261.625565 },
  { name: 'F4', midi: 65, hz: 349.228231 },
  { name: 'A4', midi: 69, hz: 440 },
]

const ONSETS = [
  ['g', 'ㄱ'],
  ['kk', 'ㄲ'],
  ['n', 'ㄴ'],
  ['d', 'ㄷ'],
  ['tt', 'ㄸ'],
  ['r', 'ㄹ'],
  ['m', 'ㅁ'],
  ['b', 'ㅂ'],
  ['pp', 'ㅃ'],
  ['s', 'ㅅ'],
  ['ss', 'ㅆ'],
  ['', 'ㅇ'],
  ['j', 'ㅈ'],
  ['jj', 'ㅉ'],
  ['ch', 'ㅊ'],
  ['k', 'ㅋ'],
  ['t', 'ㅌ'],
  ['p', 'ㅍ'],
  ['h', 'ㅎ'],
]

const VOWELS = [
  ['a', 'ㅏ'],
  ['ae', 'ㅐ'],
  ['ya', 'ㅑ'],
  ['yae', 'ㅒ'],
  ['eo', 'ㅓ'],
  ['e', 'ㅔ'],
  ['yeo', 'ㅕ'],
  ['ye', 'ㅖ'],
  ['o', 'ㅗ'],
  ['wa', 'ㅘ'],
  ['wae', 'ㅙ'],
  ['oe', 'ㅚ'],
  ['yo', 'ㅛ'],
  ['u', 'ㅜ'],
  ['wo', 'ㅝ'],
  ['we', 'ㅞ'],
  ['wi', 'ㅟ'],
  ['yu', 'ㅠ'],
  ['eu', 'ㅡ'],
  ['ui', 'ㅢ'],
  ['i', 'ㅣ'],
]

const CODAS = [
  ['n', 'ㄴ'],
  ['ng', 'ㅇ'],
  ['m', 'ㅁ'],
  ['r', 'ㄹ'],
  ['g', 'ㄱ'],
  ['d', 'ㄷ'],
  ['b', 'ㅂ'],
  ['s', 'ㅅ'],
]

const DEMO_CODA_SYLLABLES = ['연', '한', '랑', '밤', '빛']
const DEMO_CV_SYLLABLES = ['도', '히', '다', '이', '스', '키']

const VOWEL_FORMANTS = {
  'ㅏ': [820, 1220, 2700, 3600],
  'ㅐ': [620, 1760, 2600, 3500],
  'ㅑ': [780, 1360, 2750, 3650],
  'ㅒ': [600, 1840, 2650, 3550],
  'ㅓ': [610, 980, 2550, 3400],
  'ㅔ': [500, 1900, 2650, 3550],
  'ㅕ': [560, 1120, 2600, 3500],
  'ㅖ': [480, 1980, 2700, 3600],
  'ㅗ': [470, 830, 2450, 3300],
  'ㅘ': [650, 1050, 2600, 3500],
  'ㅙ': [590, 1700, 2600, 3500],
  'ㅚ': [430, 1980, 2700, 3600],
  'ㅛ': [440, 900, 2500, 3400],
  'ㅜ': [360, 720, 2350, 3200],
  'ㅝ': [520, 900, 2500, 3400],
  'ㅞ': [470, 1780, 2600, 3500],
  'ㅟ': [320, 2100, 2750, 3600],
  'ㅠ': [340, 800, 2400, 3300],
  'ㅡ': [370, 1480, 2450, 3300],
  'ㅢ': [380, 1760, 2600, 3500],
  'ㅣ': [300, 2300, 3000, 3800],
}

const VOWEL_WEIGHTS = {
  default: [1.0, 0.52, 0.2, 0.08],
  'ㅣ': [0.68, 0.82, 0.24, 0.08],
  'ㅟ': [0.66, 0.82, 0.24, 0.08],
  'ㅡ': [0.72, 0.58, 0.18, 0.07],
}

const ALT_ROMAN_ALIASES = new Map([
  ['스', ['su', 'seu']],
  ['즈', ['zu', 'jeu']],
  ['츠', ['tsu', 'cheu']],
  ['쓰', ['ssu', 'sseu']],
  ['크', ['ku', 'keu']],
  ['그', ['gu', 'geu']],
  ['드', ['du', 'deu']],
  ['트', ['tu', 'teu']],
  ['브', ['bu', 'beu']],
  ['프', ['pu', 'peu']],
  ['흐', ['hu', 'heu', 'fu']],
  ['르', ['ru', 'reu']],
  ['느', ['nu', 'neu']],
  ['므', ['mu', 'meu']],
  ['으', ['u', 'eu']],
  ['연', ['yeon']],
])

export async function generateKoreanV3SyntheticVoicebank(options = {}) {
  const profile = options.profile ?? 'web'
  const output = options.output ?? OUTPUT
  const pitches = profile === 'tiny' ? [PITCHES[0]] : PITCHES
  const units = buildUnits({ profile, pitches })
  const zip = new JSZip()
  const otoLines = []
  const sampleReports = []

  for (const [index, unit] of units.entries()) {
    const fileName = `${unit.fileStem}_${unit.pitch.name}.wav`
    const samples = renderUnit(unit)
    zip.file(`samples/${fileName}`, encodeWav(samples), zipFileOptions())
    for (const alias of unit.aliases) {
      otoLines.push(otoLine({ fileName, alias, unit }))
    }
    sampleReports.push({
      index,
      type: unit.type,
      alias: unit.aliases[0],
      aliases: unit.aliases,
      pitch: unit.pitch.name,
      midi: unit.pitch.midi,
      baseHz: unit.pitch.hz,
      fileName: `samples/${fileName}`,
      durationSeconds: samples.length / SAMPLE_RATE,
    })
  }

  const manifest = {
    version: 1,
    id: 'webuta-ko-v3-synthetic',
    name: 'WebUtau Korean V3 Synthetic',
    type: 'generated-synthetic-utau-cv-vc',
    profile,
    generatedAt: new Date().toISOString(),
    sampleRate: SAMPLE_RATE,
    basePitches: pitches.map((pitch) => pitch.name),
    license: 'Original deterministic DSP-generated samples and metadata; redistributable under the MIT license of the WebUtau repository.',
    sourceLineage: {
      method: 'deterministic-dsp-only',
      noHumanRecordingSource: true,
      noPublicOrPrivateRecordedDatasetSource: true,
      noThirdPartySingerOrCharacterSource: true,
      noTtsOrModelCheckpointOutput: true,
    },
    qualityIntent:
      'License-clean stylized cyber singer with stable musical vowels. It does not imitate a real singer or third-party character.',
    coverage: summarizeUnits(sampleReports),
    samples: sampleReports,
  }

  zip.file('oto.ini', `${otoLines.join('\r\n')}\r\n`, zipFileOptions())
  zip.file(
    'character.yaml',
    [
      'name: WebUtau Korean V3 Synthetic',
      'text_file_encoding: utf-8',
      'portrait: portrait.png',
      'author: WebUtau Project',
      'web: https://midagedev.github.io/webuta/',
      '',
    ].join('\n'),
    zipFileOptions(),
  )
  zip.file(
    'readme.txt',
    [
      'WebUtau Korean V3 Synthetic',
      '',
      'A license-clean, fully generated UTAU-style Korean voicebank for WebUtau.',
      'The samples are produced by deterministic DSP synthesis, not by cloning, recording, or redistributing a human singer.',
      'No public or private recorded voice dataset is used as source audio for the bundled samples.',
      'The voice is designed as a stylized cyber vocal: stable pitch, clear demo syllables, and DAW-ready browser rendering.',
      '',
    ].join('\r\n'),
    zipFileOptions(),
  )
  zip.file(
    'license.txt',
    [
      'WebUtau Korean V3 Synthetic voicebank',
      '',
      'Copyright (c) WebUtau Project contributors.',
      'Generated original sample data and metadata may be redistributed under the MIT license of the WebUtau repository.',
      '',
      'No third-party voice, singer likeness, TTS service output, model checkpoint output, Kasane Teto asset, or Vocaloid asset is included.',
      'No public or private recorded voice dataset is used as source audio for the bundled samples.',
      'Generated user audio may be used freely, subject to the repository license and without implying third-party singer endorsement.',
      '',
    ].join('\r\n'),
    zipFileOptions(),
  )
  zip.file('webuta-ko-v3.manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, zipFileOptions())

  await mkdir(dirname(output), { recursive: true })
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: profile === 'tiny' ? 'STORE' : 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  const existingBytes = await readExistingOutput(output)
  if (existingBytes && (await voicebankContentHash(existingBytes)) === (await voicebankContentHash(bytes))) {
    return { output, kept: true, bytes: bytes.length, manifest }
  }
  await writeFile(output, bytes)
  return { output, kept: false, bytes: bytes.length, manifest }
}

export function buildUnits({ profile = 'release', pitches = PITCHES } = {}) {
  const units = []
  const onsetLimit = profile === 'tiny' ? ONSETS.slice(0, 3) : ONSETS
  const vowelLimit = profile === 'tiny' ? VOWELS.slice(0, 4) : VOWELS
  const mainPitch = PITCHES[1]
  const cvPitches = profile === 'web' ? [mainPitch] : pitches
  const supportPitches = profile === 'web' ? [mainPitch] : pitches
  const demoPitches = profile === 'web' ? PITCHES.filter((pitch) => pitch.name !== mainPitch.name) : []
  const codaPitches = profile === 'web' ? PITCHES : pitches

  for (const pitch of cvPitches) {
    for (let onsetIndex = 0; onsetIndex < onsetLimit.length; onsetIndex += 1) {
      const [onsetRoman, onset] = onsetLimit[onsetIndex]
      for (let vowelIndex = 0; vowelIndex < vowelLimit.length; vowelIndex += 1) {
        const [vowelRoman, vowel] = vowelLimit[vowelIndex]
        const syllable = hangulSyllable(
          ONSETS.findIndex((item) => item[1] === onset),
          VOWELS.findIndex((item) => item[1] === vowel),
        )
        const roman = `${onsetRoman}${vowelRoman}`
        units.push({
          type: 'CV',
          onset,
          vowel,
          coda: '',
          pitch,
          seconds: 0.94,
          fileStem: `cv_${String(units.length).padStart(4, '0')}_${safeName(roman || vowelRoman)}`,
          aliases: aliasesFor(syllable, roman || vowelRoman),
        })
      }
    }
    if (profile === 'tiny') {
      for (const syllable of DEMO_CV_SYLLABLES) {
        const decomposed = decomposeHangul(syllable)
        if (!decomposed) {
          continue
        }
        const roman = `${romanForOnset(decomposed.onset)}${romanForVowel(decomposed.vowel)}`
        units.push({
          type: 'CV',
          onset: decomposed.onset,
          vowel: decomposed.vowel,
          coda: '',
          pitch,
          seconds: 0.94,
          fileStem: `cv_${String(units.length).padStart(4, '0')}_${safeName(roman || syllable)}`,
          aliases: aliasesFor(syllable, roman),
        })
      }
    }
  }

  for (const pitch of demoPitches) {
    for (const syllable of DEMO_CV_SYLLABLES) {
      const decomposed = decomposeHangul(syllable)
      if (!decomposed) {
        continue
      }
      const roman = `${romanForOnset(decomposed.onset)}${romanForVowel(decomposed.vowel)}`
      units.push({
        type: 'CV',
        onset: decomposed.onset,
        vowel: decomposed.vowel,
        coda: '',
        pitch,
        seconds: 0.94,
        fileStem: `cv_${String(units.length).padStart(4, '0')}_${safeName(roman || syllable)}`,
        aliases: aliasesFor(syllable, roman),
      })
    }
  }

  for (const pitch of supportPitches) {
    for (const [vowelRoman, vowel] of vowelLimit) {
      units.push({
        type: 'V',
        onset: '',
        vowel,
        coda: '',
        pitch,
        seconds: 1.18,
        fileStem: `v_${String(units.length).padStart(4, '0')}_${vowelRoman}`,
        aliases: [`-${vowel}`, `v ${vowel}`, vowelRoman],
      })
      for (const [codaRoman, coda] of CODAS.slice(0, profile === 'tiny' ? 2 : CODAS.length)) {
        units.push({
          type: 'VC',
          onset: '',
          vowel,
          coda,
          pitch,
          seconds: 0.86,
          fileStem: `vc_${String(units.length).padStart(4, '0')}_${vowelRoman}_${codaRoman}`,
          aliases: [`${vowel}${coda}`, `${vowelRoman}${codaRoman}`, `-${vowel}${coda}`],
        })
      }
    }
  }

  for (const pitch of codaPitches) {
    for (const syllable of profile === 'tiny' ? ['연'] : DEMO_CODA_SYLLABLES) {
      const decomposed = decomposeHangul(syllable)
      if (!decomposed?.coda) {
        continue
      }
      units.push({
        type: 'CVC',
        onset: decomposed.onset,
        vowel: decomposed.vowel,
        coda: decomposed.coda,
        pitch,
        seconds: 0.98,
        fileStem: `cvc_${String(units.length).padStart(4, '0')}_${safeName(syllable)}`,
        aliases: aliasesFor(syllable, `${romanForOnset(decomposed.onset)}${romanForVowel(decomposed.vowel)}${romanForCoda(decomposed.coda)}`),
      })
    }
  }
  return units
}

function renderUnit(unit) {
  const length = Math.floor(unit.seconds * SAMPLE_RATE)
  const source = new Float32Array(length)
  const output = new Float32Array(length)
  const seed = seedFor(unit)
  let phase = 0
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE
    const p = i / length
    const shimmer = Math.sin(2 * Math.PI * 6.1 * t + seed * 0.001) * 0.0009
    const frequency = unit.pitch.hz * (1 + shimmer)
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE
    const glottal =
      Math.sin(phase) * 0.9 +
      Math.sin(phase * 2) * 0.33 +
      Math.sin(phase * 3) * 0.17 +
      Math.sin(phase * 5) * 0.055
    const sawSoft = 2 * ((phase / (2 * Math.PI)) % 1) - 1
    const breath = pseudoNoise(seed + i * 7) * 0.018
    source[i] = (glottal * 0.82 + sawSoft * 0.14 + breath) * singerEnvelope(p, unit.type)
  }

  const formants = VOWEL_FORMANTS[unit.vowel] ?? VOWEL_FORMANTS['ㅏ']
  const weights = VOWEL_WEIGHTS[unit.vowel] ?? VOWEL_WEIGHTS.default
  for (let band = 0; band < formants.length; band += 1) {
    const filtered = bandPass(source, formants[band], band < 2 ? 7.5 : 11)
    for (let i = 0; i < output.length; i += 1) {
      output[i] += filtered[i] * weights[band]
    }
  }

  addConsonant(output, unit, seed)
  addCoda(output, unit, seed)
  addMicroChorus(output, unit.pitch.hz)
  deEss(output)
  normalize(output, 0.86)
  fadeEdges(output, Math.floor(0.002 * SAMPLE_RATE), Math.floor(0.018 * SAMPLE_RATE))
  return output
}

function addConsonant(output, unit, seed) {
  const profile = onsetProfile(unit.onset, unit.vowel)
  if (!profile.duration) {
    return
  }
  const count = Math.min(output.length, Math.floor(profile.duration * SAMPLE_RATE))
  let previousNoise = 0
  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE
    const p = i / count
    const burst = (1 - smoothstep(p)) * Math.min(1, t / 0.005)
    const rawNoise = pseudoNoise(seed + i * profile.noiseStride)
    const brightNoise = rawNoise - previousNoise * (profile.brightness ?? 0)
    previousNoise = rawNoise
    const transient = Math.exp(-t / (profile.burstDecay ?? 0.018)) * Math.min(1, t / 0.003)
    const noise = brightNoise * profile.noise
    const tone = Math.sin(2 * Math.PI * unit.pitch.hz * profile.toneRatio * t) * profile.tone
    const burstTone =
      Math.sin(2 * Math.PI * unit.pitch.hz * (profile.burstToneRatio ?? profile.toneRatio) * t) *
      (profile.burstTone ?? 0) *
      transient
    output[i] += (noise + tone) * burst + burstTone
  }
}

function addCoda(output, unit, seed) {
  if (!unit.coda) {
    return
  }
  const duration = codaProfile(unit.coda).duration
  const count = Math.min(output.length, Math.floor(duration * SAMPLE_RATE))
  const start = Math.max(0, output.length - count - Math.floor(0.025 * SAMPLE_RATE))
  const profile = codaProfile(unit.coda)
  for (let i = 0; i < count && start + i < output.length; i += 1) {
    const t = i / SAMPLE_RATE
    const p = i / count
    const env = smoothstep(p / 0.22) * smoothstep((1 - p) / 0.35)
    const noise = pseudoNoise(seed * 3 + i * profile.noiseStride) * profile.noise
    const tone =
      Math.sin(2 * Math.PI * unit.pitch.hz * profile.toneRatio * t) * profile.tone +
      Math.sin(2 * Math.PI * unit.pitch.hz * profile.toneRatio * 2 * t) * profile.tone * 0.25
    output[start + i] = output[start + i] * (1 - profile.duck * env) + (noise + tone) * env
  }
}

function onsetProfile(onset, vowel) {
  if (!onset || onset === 'ㅇ') {
    return { duration: 0.012, noise: 0.01, tone: 0.01, toneRatio: 1.2, noiseStride: 2 }
  }
  if (['ㄱ', 'ㄲ', 'ㅋ'].includes(onset)) {
    return { duration: onset === 'ㅋ' ? 0.072 : 0.055, noise: onset === 'ㅋ' ? 0.42 : 0.3, tone: 0.05, toneRatio: isFrontVowel(vowel) ? 3.4 : 2.7, noiseStride: 5, brightness: 0.34 }
  }
  if (['ㄷ', 'ㄸ', 'ㅌ'].includes(onset)) {
    return { duration: onset === 'ㅌ' ? 0.066 : 0.05, noise: onset === 'ㅌ' ? 0.46 : 0.28, tone: 0.05, toneRatio: 3.1, noiseStride: 7, brightness: 0.28 }
  }
  if (['ㅂ', 'ㅃ', 'ㅍ'].includes(onset)) {
    return { duration: onset === 'ㅍ' ? 0.064 : 0.045, noise: onset === 'ㅍ' ? 0.38 : 0.2, tone: 0.08, toneRatio: 1.8, noiseStride: 3, brightness: 0.18 }
  }
  if (['ㅅ', 'ㅆ', 'ㅎ'].includes(onset)) {
    return { duration: 0.092, noise: onset === 'ㅆ' ? 0.58 : 0.4, tone: 0.02, toneRatio: 5.4, noiseStride: 11, brightness: 0.55 }
  }
  if (['ㅈ', 'ㅉ', 'ㅊ'].includes(onset)) {
    return { duration: onset === 'ㅊ' ? 0.074 : 0.058, noise: onset === 'ㅊ' ? 0.48 : 0.36, tone: 0.04, toneRatio: 4.2, noiseStride: 13, brightness: 0.45 }
  }
  if (['ㄴ', 'ㄹ', 'ㅁ'].includes(onset)) {
    return { duration: 0.075, noise: 0.04, tone: 0.2, toneRatio: onset === 'ㅁ' ? 0.5 : 0.75, noiseStride: 2, brightness: 0.05 }
  }
  return { duration: 0.05, noise: 0.14, tone: 0.04, toneRatio: 2.2, noiseStride: 5, brightness: 0.2 }
}

function codaProfile(coda) {
  if (coda === 'ㄴ') {
    return { duration: 0.16, noise: 0.018, tone: 0.26, toneRatio: 0.72, noiseStride: 2, duck: 0.58 }
  }
  if (coda === 'ㅇ') {
    return { duration: 0.18, noise: 0.012, tone: 0.28, toneRatio: 0.48, noiseStride: 2, duck: 0.52 }
  }
  if (coda === 'ㅁ') {
    return { duration: 0.15, noise: 0.012, tone: 0.28, toneRatio: 0.5, noiseStride: 2, duck: 0.6 }
  }
  if (coda === 'ㄹ') {
    return { duration: 0.14, noise: 0.025, tone: 0.24, toneRatio: 0.82, noiseStride: 3, duck: 0.5 }
  }
  return { duration: 0.105, noise: 0.24, tone: 0.035, toneRatio: 2.7, noiseStride: 9, duck: 0.72 }
}

function singerEnvelope(progress, type) {
  const attack = type === 'V' ? 0.055 : 0.095
  const release = type === 'VC' ? 0.12 : 0.18
  const body = 0.9 + Math.sin(progress * Math.PI * 2.2) * 0.012
  return Math.min(smoothstep(progress / attack), smoothstep((1 - progress) / release)) * body
}

function addMicroChorus(samples, hz) {
  const depth = Math.max(1, Math.floor(SAMPLE_RATE / hz / 5))
  for (let i = samples.length - 1; i >= depth; i -= 1) {
    samples[i] = samples[i] * 0.88 + samples[i - depth] * 0.12
  }
}

function bandPass(input, centerHz, q) {
  const output = new Float32Array(input.length)
  const w0 = (2 * Math.PI * centerHz) / SAMPLE_RATE
  const alpha = Math.sin(w0) / (2 * q)
  const cos = Math.cos(w0)
  const b0 = alpha
  const b1 = 0
  const b2 = -alpha
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i += 1) {
    const x0 = input[i]
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
    output[i] = y0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
  }
  return output
}

function deEss(samples) {
  let previous = 0
  for (let i = 0; i < samples.length; i += 1) {
    const current = samples[i]
    samples[i] = current * 0.9 + previous * 0.1
    previous = current
  }
}

function normalize(samples, targetPeak) {
  let peak = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample))
  }
  if (peak <= 0.0001) {
    return
  }
  const gain = targetPeak / peak
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] *= gain
  }
}

function fadeEdges(samples, fadeInCount, fadeOutCount) {
  for (let i = 0; i < fadeInCount; i += 1) {
    samples[i] *= i / fadeInCount
  }
  for (let i = 0; i < fadeOutCount; i += 1) {
    samples[samples.length - i - 1] *= i / fadeOutCount
  }
}

function otoLine({ fileName, alias, unit }) {
  if (unit.type === 'V') {
    return `${fileName}=${alias},0,70,-760,25,12`
  }
  if (unit.type === 'VC') {
    return `${fileName}=${alias},0,95,-260,30,18`
  }
  if (unit.type === 'CVC') {
    return `${fileName}=${alias},0,165,-620,72,34`
  }
  return `${fileName}=${alias},0,165,-650,72,34`
}

function encodeWav(samples) {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += bytesPerSample
  }
  return buffer
}

function summarizeUnits(samples) {
  return samples.reduce(
    (summary, sample) => {
      summary.sampleCount += 1
      summary.aliasCount += sample.aliases.length
      summary.byType[sample.type] = (summary.byType[sample.type] ?? 0) + 1
      summary.byPitch[sample.pitch] = (summary.byPitch[sample.pitch] ?? 0) + 1
      return summary
    },
    { sampleCount: 0, aliasCount: 0, byType: {}, byPitch: {} },
  )
}

function aliasesFor(syllable, roman) {
  const aliases = new Set([syllable])
  if (roman) {
    aliases.add(roman)
  }
  for (const alias of ALT_ROMAN_ALIASES.get(syllable) ?? []) {
    aliases.add(alias)
  }
  return [...aliases]
}

function hangulSyllable(onsetIndex, vowelIndex, codaIndex = 0) {
  return String.fromCharCode(0xac00 + onsetIndex * 21 * 28 + vowelIndex * 28 + codaIndex)
}

function decomposeHangul(syllable) {
  const code = syllable.codePointAt(0)
  if (!code || code < 0xac00 || code > 0xd7a3) {
    return null
  }
  const offset = code - 0xac00
  const onsetIndex = Math.floor(offset / (21 * 28))
  const vowelIndex = Math.floor((offset % (21 * 28)) / 28)
  const codaIndex = offset % 28
  const codas = [
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
  return {
    onset: ONSETS[onsetIndex]?.[1] ?? '',
    vowel: VOWELS[vowelIndex]?.[1] ?? 'ㅏ',
    coda: codas[codaIndex] ?? '',
  }
}

function romanForOnset(onset) {
  return ONSETS.find((item) => item[1] === onset)?.[0] ?? ''
}

function romanForVowel(vowel) {
  return VOWELS.find((item) => item[1] === vowel)?.[0] ?? 'a'
}

function romanForCoda(coda) {
  return CODAS.find((item) => item[1] === coda)?.[0] ?? ''
}

function seedFor(unit) {
  return [...`${unit.type}-${unit.onset}-${unit.vowel}-${unit.coda}-${unit.pitch.name}`].reduce(
    (seed, char) => seed + char.charCodeAt(0) * 17,
    97,
  )
}

function isFrontVowel(vowel) {
  return ['ㅣ', 'ㅟ', 'ㅢ', 'ㅔ', 'ㅖ', 'ㅐ', 'ㅒ', 'ㅚ'].includes(vowel)
}

function smoothstep(value) {
  const x = Math.max(0, Math.min(1, value))
  return x * x * (3 - 2 * x)
}

function pseudoNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return (value - Math.floor(value) - 0.5) * 2
}

function safeName(value) {
  return String(value || 'vowel')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48)
}

function zipFileOptions() {
  return { date: new Date(ZIP_FILE_DATE) }
}

async function readExistingOutput(output) {
  try {
    return await readFile(output)
  } catch {
    return null
  }
}

async function voicebankContentHash(bytes) {
  const archive = await JSZip.loadAsync(bytes)
  const hash = createHash('sha256')
  for (const path of Object.keys(archive.files).sort()) {
    const file = archive.files[path]
    if (file.dir) {
      continue
    }
    hash.update(path)
    hash.update('\0')
    hash.update(Buffer.from(await file.async('uint8array')))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      options.output = argv[++index]
    } else if (arg === '--profile') {
      options.profile = argv[++index]
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/generate-korean-v3-synthetic-voicebank.mjs [options]',
          '',
          'Options:',
          '  --out path         Output zip path',
          '  --profile name     web, release, or tiny',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateKoreanV3SyntheticVoicebank(parseArgs(process.argv.slice(2)))
    .then((result) => {
      const action = result.kept ? 'Kept' : 'Wrote'
      console.log(`${action} ${result.output} (${result.bytes} bytes, ${result.manifest.coverage.sampleCount} samples, ${result.manifest.coverage.aliasCount} aliases)`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
