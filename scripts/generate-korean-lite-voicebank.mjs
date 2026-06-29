import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'

const SAMPLE_RATE = 24000
const SAMPLE_SECONDS = 0.72
const BASE_FREQUENCY = 261.625565
const OUTPUT = join(process.cwd(), 'public/voicebanks/webuta-ko-lite.zip')
const ZIP_FILE_DATE = '2026-01-01T00:00:00.000Z'

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

const VOWEL_WEIGHTS = [1.0, 0.48, 0.22, 0.1]
const VOWEL_WEIGHT_OVERRIDES = {
  'ㅣ': [0.72, 0.74, 0.25, 0.08],
  'ㅟ': [0.68, 0.76, 0.25, 0.08],
  'ㅢ': [0.76, 0.66, 0.24, 0.08],
}

const ALT_ROMAN_ALIASES = new Map([
  ['스', ['su']],
  ['즈', ['zu']],
  ['츠', ['tsu']],
  ['쓰', ['ssu']],
  ['크', ['ku']],
  ['그', ['gu']],
  ['드', ['du']],
  ['트', ['tu']],
  ['브', ['bu']],
  ['프', ['pu']],
  ['흐', ['hu', 'fu']],
  ['르', ['ru']],
  ['느', ['nu']],
  ['므', ['mu']],
  ['으', ['u']],
])

const zip = new JSZip()
const otoLines = []
const manifest = {
  id: 'webuta-ko-lite',
  name: 'WebUtau Korean Lite',
  type: 'procedural-utau-cv',
  sampleRate: SAMPLE_RATE,
  baseTone: 'C4',
  description: 'A redistributable starter UTAU-style Korean CV voicebank generated for WebUtau.',
  coverage: {
    hangulCvAliases: ONSETS.length * VOWELS.length,
    exactCodaSupport: false,
  },
}

let index = 0
for (let onsetIndex = 0; onsetIndex < ONSETS.length; onsetIndex++) {
  const [onsetRoman, onset] = ONSETS[onsetIndex]
  for (let vowelIndex = 0; vowelIndex < VOWELS.length; vowelIndex++) {
    const [vowelRoman, vowel] = VOWELS[vowelIndex]
    const syllable = hangulSyllable(onsetIndex, vowelIndex)
    const fileName = `ko_${String(index).padStart(3, '0')}_C4.wav`
    const aliases = aliasesFor(syllable, onsetRoman, vowelRoman)
    zip.file(`samples/${fileName}`, encodeWav(renderSyllable({ onset, vowel })), zipFileOptions())
    for (const alias of aliases) {
      otoLines.push(`${fileName}=${alias},0,120,-560,28,14`)
    }
    index += 1
  }
}

zip.file('oto.ini', otoLines.join('\r\n') + '\r\n', zipFileOptions())
zip.file(
  'character.yaml',
  [
    'name: WebUtau Korean Lite',
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
    'WebUtau Korean Lite',
    '',
    'A small UTAU-style Korean CV starter voicebank bundled with WebUtau.',
    'It contains generated original WAV samples for Hangul onset+vowel syllables.',
    'Final consonants are approximated by the WebUtau lyric matcher in this first version.',
    '',
    'This is not Kasane Teto, not Vocaloid, and not a third-party singer sample pack.',
    '',
  ].join('\r\n'),
  zipFileOptions(),
)
zip.file(
  'license.txt',
  [
    'WebUtau Korean Lite voicebank',
    '',
    'Copyright (c) WebUtau Project contributors.',
    'Generated original sample data and metadata may be redistributed under the MIT license of the WebUtau repository.',
    '',
    'No third-party voice, singer likeness, TTS service output, or Kasane Teto asset is included in this zip.',
    '',
  ].join('\r\n'),
  zipFileOptions(),
)
zip.file('webuta-ko-lite.manifest.json', JSON.stringify(manifest, null, 2) + '\n', zipFileOptions())

await mkdir(dirname(OUTPUT), { recursive: true })
const bytes = await zip.generateAsync({
  type: 'uint8array',
  compression: 'STORE',
})
const existingBytes = await readExistingOutput()
if (existingBytes && (await voicebankContentHash(existingBytes)) === (await voicebankContentHash(bytes))) {
  console.log(`Kept ${OUTPUT} (${bytes.length} bytes, ${index} samples, ${otoLines.length} aliases)`)
  process.exit(0)
}
await writeFile(OUTPUT, bytes)
console.log(`Wrote ${OUTPUT} (${bytes.length} bytes, ${index} samples, ${otoLines.length} aliases)`)

function aliasesFor(syllable, onsetRoman, vowelRoman) {
  const aliases = new Set([syllable])
  const roman = `${onsetRoman}${vowelRoman}`
  if (roman) {
    aliases.add(roman)
  }
  for (const alias of ALT_ROMAN_ALIASES.get(syllable) ?? []) {
    aliases.add(alias)
  }
  return [...aliases]
}

function zipFileOptions() {
  return { date: new Date(ZIP_FILE_DATE) }
}

async function readExistingOutput() {
  try {
    return await readFile(OUTPUT)
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

function hangulSyllable(onsetIndex, vowelIndex) {
  return String.fromCharCode(0xac00 + onsetIndex * 21 * 28 + vowelIndex * 28)
}

function renderSyllable({ onset, vowel }) {
  const length = Math.floor(SAMPLE_SECONDS * SAMPLE_RATE)
  const source = new Float32Array(length)
  const output = new Float32Array(length)
  const noiseSeed = onset.charCodeAt(0) * 131 + vowel.charCodeAt(0) * 17

  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE
    const p = i / length
    const vibrato = Math.sin(2 * Math.PI * 5.2 * t) * 0.0025 * smoothstep((p - 0.32) / 0.32)
    const frequency = BASE_FREQUENCY * (1 + vibrato)
    const phase = 2 * Math.PI * frequency * t
    const glottal =
      Math.sin(phase) * 0.9 +
      Math.sin(phase * 2) * 0.35 +
      Math.sin(phase * 3) * 0.18 +
      Math.sin(phase * 4) * 0.08
    const breath = pseudoNoise(i + noiseSeed) * 0.035
    source[i] = (glottal + breath) * singerEnvelope(p)
  }

  const formants = VOWEL_FORMANTS[vowel] ?? VOWEL_FORMANTS['ㅏ']
  const vowelWeights = VOWEL_WEIGHT_OVERRIDES[vowel] ?? VOWEL_WEIGHTS
  for (let band = 0; band < formants.length; band++) {
    const filtered = bandPass(source, formants[band], band < 2 ? 6.5 : 9.5)
    for (let i = 0; i < output.length; i++) {
      output[i] += filtered[i] * vowelWeights[band]
    }
  }

  addConsonant(output, onset, vowel, noiseSeed)
  deEss(output)
  normalize(output, 0.86)
  fadeEdges(output, Math.floor(0.0015 * SAMPLE_RATE), Math.floor(0.012 * SAMPLE_RATE))
  return output
}

function addConsonant(output, onset, vowel, seed) {
  const profile = onsetProfile(onset, vowel)
  if (profile.duration <= 0) {
    return
  }
  const count = Math.min(output.length, Math.floor(profile.duration * SAMPLE_RATE))
  let previousNoise = 0
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE
    const p = i / count
    const burst = (1 - smoothstep(p)) * Math.min(1, t / 0.006)
    const rawNoise = pseudoNoise(seed + i * profile.noiseStride)
    const brightNoise = rawNoise - previousNoise * (profile.brightness ?? 0)
    previousNoise = rawNoise
    const transient = Math.exp(-t / (profile.burstDecay ?? 0.018)) * Math.min(1, t / 0.003)
    const noise = brightNoise * profile.noise
    const tone = Math.sin(2 * Math.PI * BASE_FREQUENCY * profile.toneRatio * t) * profile.tone
    const burstTone =
      Math.sin(2 * Math.PI * BASE_FREQUENCY * (profile.burstToneRatio ?? profile.toneRatio) * t) *
      (profile.burstTone ?? 0) *
      transient
    output[i] += (noise + tone) * burst + burstTone
  }
}

function onsetProfile(onset, vowel) {
  if (!onset || onset === 'ㅇ') {
    return { duration: 0.018, noise: 0.02, tone: 0.02, toneRatio: 1.5, noiseStride: 2 }
  }
  if (onset === 'ㅋ') {
    const frontVowel = isFrontVowel(vowel)
    return {
      duration: frontVowel ? 0.068 : 0.06,
      noise: frontVowel ? 0.24 : 0.36,
      tone: frontVowel ? 0.08 : 0.05,
      toneRatio: frontVowel ? 3.05 : 2.9,
      burstTone: frontVowel ? 0.24 : 0.11,
      burstToneRatio: frontVowel ? 4.8 : 5.6,
      burstDecay: frontVowel ? 0.015 : 0.018,
      brightness: frontVowel ? 0.24 : 0.32,
      noiseStride: 17,
    }
  }
  if (['ㄱ', 'ㄲ', 'ㅋ'].includes(onset)) {
    return { duration: 0.055, noise: 0.34, tone: 0.05, toneRatio: 2.8, noiseStride: 5 }
  }
  if (['ㄷ', 'ㄸ', 'ㅌ'].includes(onset)) {
    return { duration: 0.05, noise: onset === 'ㅌ' ? 0.48 : 0.3, tone: 0.05, toneRatio: 3.1, noiseStride: 7 }
  }
  if (['ㅂ', 'ㅃ', 'ㅍ'].includes(onset)) {
    return { duration: 0.045, noise: onset === 'ㅍ' ? 0.42 : 0.24, tone: 0.08, toneRatio: 1.8, noiseStride: 3 }
  }
  if (['ㅅ', 'ㅆ', 'ㅎ'].includes(onset)) {
    return { duration: 0.085, noise: onset === 'ㅆ' ? 0.58 : 0.42, tone: 0.02, toneRatio: 5.2, noiseStride: 11 }
  }
  if (['ㅈ', 'ㅉ', 'ㅊ'].includes(onset)) {
    return { duration: 0.06, noise: onset === 'ㅊ' ? 0.5 : 0.38, tone: 0.04, toneRatio: 4.0, noiseStride: 13 }
  }
  if (['ㄴ', 'ㄹ', 'ㅁ'].includes(onset)) {
    return { duration: 0.065, noise: 0.055, tone: 0.18, toneRatio: onset === 'ㅁ' ? 0.5 : 0.75, noiseStride: 2 }
  }
  return { duration: 0.05, noise: 0.16, tone: 0.04, toneRatio: 2.2, noiseStride: 5 }
}

function isFrontVowel(vowel) {
  return ['ㅣ', 'ㅟ', 'ㅢ', 'ㅔ', 'ㅖ', 'ㅐ', 'ㅒ', 'ㅚ'].includes(vowel)
}

function singerEnvelope(progress) {
  const attack = smoothstep(progress / 0.08)
  const release = smoothstep((1 - progress) / 0.16)
  const body = 0.88 + Math.sin(progress * Math.PI * 2.6) * 0.025
  return Math.min(attack, release) * body
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
  for (let i = 0; i < input.length; i++) {
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
  for (let i = 0; i < samples.length; i++) {
    const current = samples[i]
    samples[i] = current * 0.92 + previous * 0.08
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
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= gain
  }
}

function fadeEdges(samples, fadeInCount, fadeOutCount) {
  for (let i = 0; i < fadeInCount; i++) {
    samples[i] *= i / fadeInCount
  }
  for (let i = 0; i < fadeOutCount; i++) {
    const gain = i / fadeOutCount
    samples[samples.length - i - 1] *= gain
  }
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

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

function smoothstep(value) {
  const x = Math.max(0, Math.min(1, value))
  return x * x * (3 - 2 * x)
}

function pseudoNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return (value - Math.floor(value) - 0.5) * 2
}
