#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parsePcm16Wav } from './analyze-korean-v3-pitch.mjs'

export const DEFAULT_ZIP = 'public/voicebanks/webuta-ko-v3.zip'
export const DEFAULT_REPORT = 'experiments/utau-v3/work/v3-clarity-audit.json'

const MAIN_PITCH = 'F4'
const FIXED_SIGNATURE_BANDS = [300, 450, 650, 850, 1100, 1450, 1800, 2250, 2800, 3400]

const DEFAULT_THRESHOLDS = {
  minVowelSamples: 21,
  minConsonantSamples: 300,
  minFormantEnergyRatio: 0.12,
  minVowelDistance: 0.012,
  maxWeakConsonantRatio: 0.08,
  minStopOnsetRatio: 0.09,
  minFricativeOnsetRatio: 0.12,
  minSonorantOnsetRatio: 0.045,
  minBrightConsonantRatio: 0.035,
}

const VOWEL_FORMANTS = {
  'ㅏ': [820, 1220, 2700],
  'ㅐ': [620, 1760, 2600],
  'ㅑ': [780, 1360, 2750],
  'ㅒ': [600, 1840, 2650],
  'ㅓ': [610, 980, 2550],
  'ㅔ': [500, 1900, 2650],
  'ㅕ': [560, 1120, 2600],
  'ㅖ': [480, 1980, 2700],
  'ㅗ': [470, 830, 2450],
  'ㅘ': [650, 1050, 2600],
  'ㅙ': [590, 1700, 2600],
  'ㅚ': [430, 1980, 2700],
  'ㅛ': [440, 900, 2500],
  'ㅜ': [360, 720, 2350],
  'ㅝ': [520, 900, 2500],
  'ㅞ': [470, 1780, 2600],
  'ㅟ': [320, 2100, 2750],
  'ㅠ': [340, 800, 2400],
  'ㅡ': [370, 1480, 2450],
  'ㅢ': [380, 1760, 2600],
  'ㅣ': [300, 2300, 3000],
}

const ONSET_GROUPS = {
  stop: new Set(['ㄱ', 'ㄲ', 'ㄷ', 'ㄸ', 'ㅂ', 'ㅃ', 'ㅋ', 'ㅌ', 'ㅍ']),
  fricative: new Set(['ㅅ', 'ㅆ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅎ']),
  sonorant: new Set(['ㄴ', 'ㄹ', 'ㅁ']),
}

export async function analyzeKoreanV3Clarity(options = {}) {
  const zipPath = resolve(options.zip ?? DEFAULT_ZIP)
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(options.thresholds ?? {}),
  }
  const bytes = readFileSync(zipPath)
  const zip = await JSZip.loadAsync(bytes)
  const manifest = parseJson(
    zip.files['webuta-ko-v3.manifest.json']
      ? await zip.files['webuta-ko-v3.manifest.json'].async('string')
      : '{}',
  )
  const manifestSamples = Array.isArray(manifest?.samples) ? manifest.samples : []
  const vowelSamples = selectMainPitchSamples(manifestSamples, (sample) => sample.type === 'V')
  const consonantSamples = selectMainPitchSamples(
    manifestSamples,
    (sample) => sample.type === 'CV' && !['', 'ㅇ'].includes(phonemeFromSample(sample).onset),
  )

  const vowelAudits = []
  for (const sample of vowelSamples) {
    vowelAudits.push(await analyzeSample(zip, sample, (parsed) => analyzeVowel(sample, parsed.samples, parsed.sampleRate, thresholds)))
  }

  const consonantAudits = []
  for (const sample of consonantSamples) {
    consonantAudits.push(await analyzeSample(zip, sample, (parsed) => analyzeConsonant(sample, parsed.samples, parsed.sampleRate, thresholds)))
  }

  const vowelDistance = summarizeVowelDistance(vowelAudits)
  const weakConsonants = consonantAudits.filter((audit) => audit.weak)
  const weakConsonantRatio = weakConsonants.length / Math.max(1, consonantAudits.length)
  const problems = [
    ...(vowelAudits.length >= thresholds.minVowelSamples
      ? []
      : [`only ${vowelAudits.length} vowel color samples audited; expected at least ${thresholds.minVowelSamples}`]),
    ...(consonantAudits.length >= thresholds.minConsonantSamples
      ? []
      : [`only ${consonantAudits.length} consonant onset samples audited; expected at least ${thresholds.minConsonantSamples}`]),
    ...vowelAudits.flatMap((audit) => audit.problems.map((problem) => `${audit.fileName}: ${problem}`)),
    ...consonantAudits.flatMap((audit) => audit.problems.map((problem) => `${audit.fileName}: ${problem}`)),
    ...(vowelDistance.minDistance !== null && vowelDistance.minDistance >= thresholds.minVowelDistance
      ? []
      : [`minimum vowel spectral distance ${formatNumber(vowelDistance.minDistance, 4)} below ${thresholds.minVowelDistance}`]),
    ...(weakConsonantRatio <= thresholds.maxWeakConsonantRatio
      ? []
      : [`weak consonant onset ratio ${formatNumber(weakConsonantRatio, 4)} exceeds ${thresholds.maxWeakConsonantRatio}`]),
  ]

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'v3-clarity-audit-pass' : 'v3-clarity-audit-fail',
    zip: {
      path: zipPath,
      bytes: bytes.length,
    },
    thresholds,
    manifest: {
      id: manifest?.id ?? null,
      name: manifest?.name ?? null,
      profile: manifest?.profile ?? null,
      synthesisProfile: manifest?.synthesis?.profile ?? null,
    },
    clarity: {
      vowels: {
        auditedCount: vowelAudits.length,
        summary: summarizeVowels(vowelAudits, vowelDistance),
        worst: worstVowels(vowelAudits),
        samples: vowelAudits,
      },
      consonants: {
        auditedCount: consonantAudits.length,
        weakCount: weakConsonants.length,
        weakRatio: weakConsonantRatio,
        summary: summarizeConsonants(consonantAudits),
        worst: worstConsonants(consonantAudits),
        samples: consonantAudits,
      },
    },
    problems,
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

async function analyzeSample(zip, sample, analyzer) {
  const zipFile = zip.files[sample.fileName]
  if (!zipFile) {
    return {
      fileName: sample.fileName,
      alias: sample.alias ?? null,
      type: sample.type ?? null,
      pitch: sample.pitch ?? null,
      ok: false,
      weak: true,
      problems: [`missing WAV file: ${sample.fileName}`],
      metrics: null,
    }
  }
  const parsed = parsePcm16Wav(await zipFile.async('uint8array'))
  if (!parsed.ok) {
    return {
      fileName: sample.fileName,
      alias: sample.alias ?? null,
      type: sample.type ?? null,
      pitch: sample.pitch ?? null,
      ok: false,
      weak: true,
      problems: [parsed.error],
      metrics: null,
    }
  }
  return analyzer(parsed)
}

function analyzeVowel(sample, samples, sampleRate, thresholds) {
  const phoneme = phonemeFromSample(sample)
  const formants = VOWEL_FORMANTS[phoneme.vowel] ?? null
  const body = sliceByFraction(samples, 0.22, 0.78)
  const totalRms = rms(body)
  const formantBands = formants
    ? formants.map((centerHz, index) => ({
        centerHz,
        rms: bandRms(body, sampleRate, centerHz, index < 2 ? 4.5 : 6.5),
      }))
    : []
  const formantEnergyRatio =
    formantBands.reduce((sum, band, index) => sum + band.rms * (index < 2 ? 1 : 0.45), 0) /
    Math.max(totalRms, 1e-6)
  const signature = spectralSignature(body, sampleRate)
  const problems = [
    ...(formants ? [] : [`unknown vowel ${phoneme.vowel ?? 'missing'}`]),
    ...(totalRms > 0.01 ? [] : [`body RMS ${formatNumber(totalRms, 4)} is too quiet for vowel color analysis`]),
    ...(formantEnergyRatio >= thresholds.minFormantEnergyRatio
      ? []
      : [`formant energy ratio ${formatNumber(formantEnergyRatio, 4)} below ${thresholds.minFormantEnergyRatio}`]),
  ]
  return {
    fileName: sample.fileName,
    alias: sample.alias ?? null,
    type: sample.type ?? null,
    pitch: sample.pitch ?? null,
    vowel: phoneme.vowel,
    ok: problems.length === 0,
    weak: problems.length > 0,
    problems,
    metrics: {
      bodyRms: totalRms,
      formantEnergyRatio,
      formantBands,
      signature,
    },
  }
}

function analyzeConsonant(sample, samples, sampleRate, thresholds) {
  const phoneme = phonemeFromSample(sample)
  const onset = phoneme.onset
  const group = onsetGroup(onset)
  const attack = sliceByTime(samples, sampleRate, 0.012, group === 'fricative' ? 0.118 : 0.095)
  const body = sliceByFraction(samples, 0.34, 0.72)
  const attackRms = rms(attack)
  const bodyRms = rms(body)
  const onsetRatio = attackRms / Math.max(bodyRms, 1e-6)
  const brightRms = highPassRms(attack, sampleRate, group === 'fricative' ? 2600 : 1800)
  const brightRatio = brightRms / Math.max(attackRms, 1e-6)
  const minOnsetRatio =
    group === 'fricative'
      ? thresholds.minFricativeOnsetRatio
      : group === 'sonorant'
        ? thresholds.minSonorantOnsetRatio
        : thresholds.minStopOnsetRatio
  const needsBrightRatio = group !== 'sonorant'
  const weak = onsetRatio < minOnsetRatio || (needsBrightRatio && brightRatio < thresholds.minBrightConsonantRatio)
  return {
    fileName: sample.fileName,
    alias: sample.alias ?? null,
    type: sample.type ?? null,
    pitch: sample.pitch ?? null,
    onset,
    vowel: phoneme.vowel,
    group,
    ok: true,
    weak,
    problems: [],
    metrics: {
      attackRms,
      bodyRms,
      onsetRatio,
      brightRms,
      brightRatio,
      minOnsetRatio,
      minBrightRatio: needsBrightRatio ? thresholds.minBrightConsonantRatio : null,
    },
  }
}

function selectMainPitchSamples(samples, predicate) {
  const main = samples.filter((sample) => sample.pitch === MAIN_PITCH && predicate(sample))
  return main.length ? main : samples.filter(predicate)
}

function phonemeFromSample(sample) {
  if (sample?.vowel || sample?.onset || sample?.coda) {
    return {
      onset: sample.onset ?? '',
      vowel: sample.vowel ?? '',
      coda: sample.coda ?? '',
    }
  }
  const alias = String(sample?.alias ?? sample?.aliases?.[0] ?? '')
  if (alias.startsWith('-') && alias.length >= 2) {
    return { onset: '', vowel: alias.slice(1, 2), coda: alias.slice(2) }
  }
  const decomposed = decomposeHangul(alias.slice(0, 1))
  return decomposed ?? { onset: '', vowel: '', coda: '' }
}

function summarizeVowels(audits, distance) {
  const ratios = audits.map((audit) => audit.metrics?.formantEnergyRatio).filter(isFiniteNumber)
  return {
    okCount: audits.filter((audit) => audit.ok).length,
    problemCount: audits.filter((audit) => !audit.ok).length,
    minFormantEnergyRatio: min(ratios),
    medianFormantEnergyRatio: median(ratios),
    minVowelDistance: distance.minDistance,
    closestVowels: distance.closestPair,
  }
}

function summarizeConsonants(audits) {
  const onsetRatios = audits.map((audit) => audit.metrics?.onsetRatio).filter(isFiniteNumber)
  const brightRatios = audits.map((audit) => audit.metrics?.brightRatio).filter(isFiniteNumber)
  return {
    okCount: audits.filter((audit) => audit.ok).length,
    weakCount: audits.filter((audit) => audit.weak).length,
    minOnsetRatio: min(onsetRatios),
    medianOnsetRatio: median(onsetRatios),
    minBrightRatio: min(brightRatios),
    medianBrightRatio: median(brightRatios),
  }
}

function worstVowels(audits) {
  return [...audits]
    .sort((left, right) => (left.metrics?.formantEnergyRatio ?? 0) - (right.metrics?.formantEnergyRatio ?? 0))
    .slice(0, 8)
    .map((audit) => ({
      fileName: audit.fileName,
      alias: audit.alias,
      vowel: audit.vowel,
      pitch: audit.pitch,
      ok: audit.ok,
      problems: audit.problems,
      metrics: {
        formantEnergyRatio: round(audit.metrics?.formantEnergyRatio, 4),
        bodyRms: round(audit.metrics?.bodyRms, 4),
      },
    }))
}

function worstConsonants(audits) {
  return [...audits]
    .sort((left, right) => (left.metrics?.onsetRatio ?? 0) - (right.metrics?.onsetRatio ?? 0))
    .slice(0, 12)
    .map((audit) => ({
      fileName: audit.fileName,
      alias: audit.alias,
      onset: audit.onset,
      vowel: audit.vowel,
      group: audit.group,
      pitch: audit.pitch,
      weak: audit.weak,
      metrics: {
        onsetRatio: round(audit.metrics?.onsetRatio, 4),
        brightRatio: round(audit.metrics?.brightRatio, 4),
        minOnsetRatio: round(audit.metrics?.minOnsetRatio, 4),
      },
    }))
}

function summarizeVowelDistance(vowelAudits) {
  const byVowel = new Map()
  for (const audit of vowelAudits) {
    if (audit.ok && audit.vowel && Array.isArray(audit.metrics?.signature)) {
      byVowel.set(audit.vowel, audit.metrics.signature)
    }
  }
  let minDistance = null
  let closestPair = null
  const entries = [...byVowel.entries()]
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const distance = euclideanDistance(entries[i][1], entries[j][1])
      if (minDistance === null || distance < minDistance) {
        minDistance = distance
        closestPair = [entries[i][0], entries[j][0]]
      }
    }
  }
  return { minDistance, closestPair }
}

function spectralSignature(samples, sampleRate) {
  const powers = FIXED_SIGNATURE_BANDS.map((centerHz) => bandRms(samples, sampleRate, centerHz, 5.5))
  const total = powers.reduce((sum, value) => sum + value, 0)
  return powers.map((value) => round(value / Math.max(total, 1e-6), 6))
}

function bandRms(samples, sampleRate, centerHz, q) {
  return rms(bandPass(samples, sampleRate, centerHz, q))
}

function highPassRms(samples, sampleRate, cutoffHz) {
  const low = lowPass(samples, sampleRate, cutoffHz)
  let sumSquares = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] - low[i]
    sumSquares += value * value
  }
  return Math.sqrt(sumSquares / Math.max(1, samples.length))
}

function bandPass(input, sampleRate, centerHz, q) {
  const output = new Float32Array(input.length)
  const w0 = (2 * Math.PI * centerHz) / sampleRate
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

function lowPass(input, sampleRate, cutoffHz) {
  const output = new Float32Array(input.length)
  const rc = 1 / (2 * Math.PI * cutoffHz)
  const dt = 1 / sampleRate
  const alpha = dt / (rc + dt)
  let previous = 0
  for (let i = 0; i < input.length; i += 1) {
    previous += alpha * (input[i] - previous)
    output[i] = previous
  }
  return output
}

function sliceByFraction(samples, startFraction, endFraction) {
  const start = Math.max(0, Math.floor(samples.length * startFraction))
  const end = Math.min(samples.length, Math.floor(samples.length * endFraction))
  return samples.subarray(start, Math.max(start + 1, end))
}

function sliceByTime(samples, sampleRate, startSeconds, endSeconds) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(endSeconds * sampleRate))
  return samples.subarray(start, Math.max(start + 1, end))
}

function rms(samples) {
  let sumSquares = 0
  for (const sample of samples) {
    sumSquares += sample * sample
  }
  return Math.sqrt(sumSquares / Math.max(1, samples.length))
}

function onsetGroup(onset) {
  if (ONSET_GROUPS.fricative.has(onset)) {
    return 'fricative'
  }
  if (ONSET_GROUPS.sonorant.has(onset)) {
    return 'sonorant'
  }
  if (ONSET_GROUPS.stop.has(onset)) {
    return 'stop'
  }
  return 'other'
}

function decomposeHangul(syllable) {
  const code = syllable.codePointAt(0)
  if (!code || code < 0xac00 || code > 0xd7a3) {
    return null
  }
  const onsets = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
  const vowels = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']
  const codas = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
  const offset = code - 0xac00
  return {
    onset: onsets[Math.floor(offset / (21 * 28))] ?? '',
    vowel: vowels[Math.floor((offset % (21 * 28)) / 28)] ?? '',
    coda: codas[offset % 28] ?? '',
  }
}

function euclideanDistance(left, right) {
  let sum = 0
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const diff = left[i] - right[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

function median(values) {
  const sorted = values.filter(isFiniteNumber).sort((left, right) => left - right)
  if (!sorted.length) {
    return null
  }
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function min(values) {
  const filtered = values.filter(isFiniteNumber)
  return filtered.length ? Math.min(...filtered) : null
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value))
}

function round(value, digits = 4) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return null
  }
  const scale = 10 ** digits
  return Math.round(number * scale) / scale
}

function formatNumber(value, digits = 3) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : 'n/a'
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
  }
  const thresholds = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--zip') {
      options.zip = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--min-vowel-samples') {
      thresholds.minVowelSamples = Number(argv[++index])
    } else if (arg === '--min-consonant-samples') {
      thresholds.minConsonantSamples = Number(argv[++index])
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/analyze-korean-v3-clarity.mjs [options]',
          '',
          'Options:',
          '  --zip path                  Voicebank zip, default public/voicebanks/webuta-ko-v3.zip',
          '  --report path               JSON report path',
          '  --min-vowel-samples n       Minimum vowel color samples',
          '  --min-consonant-samples n   Minimum consonant onset samples',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  if (Object.keys(thresholds).length) {
    options.thresholds = thresholds
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  analyzeKoreanV3Clarity(parseArgs(process.argv.slice(2)))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) {
        process.exit(1)
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
