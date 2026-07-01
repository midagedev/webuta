#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

export const DEFAULT_ZIP = 'public/voicebanks/webuta-ko-v3.zip'
export const DEFAULT_REPORT = 'experiments/utau-v3/work/v3-voicebank-audit.json'

const REQUIRED_FILES = [
  'oto.ini',
  'character.yaml',
  'readme.txt',
  'license.txt',
  'webuta-ko-v3.manifest.json',
]

const DEMO_ALIASES = ['도', '히', '다', '이', '스', '키']
const CODA_ALIASES = ['연']
const EXPECTED_SAMPLE_RATE = 40000

export async function auditKoreanV3Voicebank(options = {}) {
  const zipPath = resolve(options.zip ?? DEFAULT_ZIP)
  const maxBytes = Number(options.maxBytes ?? 50_000_000)
  const minWavs = Number(options.minWavs ?? 600)
  const minAliases = Number(options.minAliases ?? 1400)
  const maxSamples = Number(options.maxSamples ?? Number.POSITIVE_INFINITY)
  const bytes = readFileSync(zipPath)
  const zip = await JSZip.loadAsync(bytes)
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir)
  const wavPaths = paths.filter((path) => /\.wav$/i.test(path)).sort()
  const missingFiles = REQUIRED_FILES.filter((path) => !zip.files[path])
  const otoText = zip.files['oto.ini'] ? await zip.files['oto.ini'].async('string') : ''
  const licenseText = zip.files['license.txt'] ? await zip.files['license.txt'].async('string') : ''
  const manifestText = zip.files['webuta-ko-v3.manifest.json']
    ? await zip.files['webuta-ko-v3.manifest.json'].async('string')
    : '{}'
  const manifest = parseJson(manifestText)
  const otoEntries = parseOto(otoText)
  const aliases = new Set(otoEntries.map((entry) => entry.alias).filter(Boolean))
  const wavSet = new Set(wavPaths)
  const missingSamples = otoEntries
    .map((entry) => `samples/${entry.fileName}`)
    .filter((path) => !wavSet.has(path))
    .slice(0, 20)
  const wavAudits = []
  const sampleLimit = Math.min(wavPaths.length, maxSamples)
  for (const wavPath of wavPaths.slice(0, sampleLimit)) {
    wavAudits.push(auditWav(wavPath, await zip.files[wavPath].async('uint8array')))
  }
  const wavSummary = summarizeWavs(wavAudits)
  const problems = [
    ...(existsSync(zipPath) ? [] : [`Missing voicebank zip: ${zipPath}`]),
    ...missingFiles.map((path) => `Missing required file: ${path}`),
    ...(bytes.length > maxBytes ? [`Voicebank zip is ${bytes.length} bytes; max for web default is ${maxBytes}.`] : []),
    ...(wavPaths.length < minWavs ? [`Only ${wavPaths.length} WAV files; expected at least ${minWavs}.`] : []),
    ...(otoEntries.length < minAliases ? [`Only ${otoEntries.length} oto aliases; expected at least ${minAliases}.`] : []),
    ...DEMO_ALIASES.filter((alias) => !aliases.has(alias)).map((alias) => `Missing first-run demo alias: ${alias}`),
    ...CODA_ALIASES.filter((alias) => !aliases.has(alias)).map((alias) => `Missing coda demo alias: ${alias}`),
    ...missingSamples.map((path) => `oto.ini references missing sample: ${path}`),
    ...licenseProblems(licenseText),
    ...manifestProblems(manifest, wavPaths.length, otoEntries.length),
    ...wavAudits.flatMap((audit) => audit.problems.map((problem) => `${audit.path}: ${problem}`)).slice(0, 50),
  ]
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'v3-voicebank-audit-pass' : 'v3-voicebank-audit-fail',
    zip: {
      path: zipPath,
      bytes: bytes.length,
      maxBytes,
    },
    package: {
      requiredFiles: REQUIRED_FILES,
      missingFiles,
      wavCount: wavPaths.length,
      otoAliasCount: otoEntries.length,
      uniqueAliasCount: aliases.size,
      demoAliases: DEMO_ALIASES.map((alias) => ({ alias, present: aliases.has(alias) })),
      codaAliases: CODA_ALIASES.map((alias) => ({ alias, present: aliases.has(alias) })),
      missingSampleReferenceCount: missingSamples.length,
    },
    manifest: {
      id: manifest?.id ?? null,
      name: manifest?.name ?? null,
      type: manifest?.type ?? null,
      profile: manifest?.profile ?? null,
      coverage: manifest?.coverage ?? null,
    },
    wav: {
      auditedCount: wavAudits.length,
      totalCount: wavPaths.length,
      summary: wavSummary,
      worst: worstWavs(wavAudits),
    },
    problems,
  }
  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

export function parseOto(text) {
  const entries = []
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#') || !line.includes('=')) {
      continue
    }
    const [fileName, config] = splitOnce(line, '=')
    const fields = config.split(',')
    entries.push({
      fileName: fileName.trim(),
      alias: (fields[0] ?? '').trim(),
      offsetMs: numberField(fields[1]),
      consonantMs: numberField(fields[2]),
      cutoffMs: numberField(fields[3]),
      preutteranceMs: numberField(fields[4]),
      overlapMs: numberField(fields[5]),
    })
  }
  return entries
}

export function auditWav(path, bytes) {
  const parsed = parsePcm16Wav(bytes)
  if (!parsed.ok) {
    return { path, ok: false, problems: [parsed.error], metrics: null }
  }
  const samples = parsed.samples
  let peak = 0
  let sumSquares = 0
  let active = 0
  for (const sample of samples) {
    const abs = Math.abs(sample)
    peak = Math.max(peak, abs)
    sumSquares += sample * sample
    if (abs >= 0.003) {
      active += 1
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length))
  const leadingSilenceMs = silenceMs(samples, parsed.sampleRate, 'leading')
  const trailingSilenceMs = silenceMs(samples, parsed.sampleRate, 'trailing')
  const durationSeconds = samples.length / parsed.sampleRate
  const activeRatio = active / Math.max(1, samples.length)
  const problems = [
    ...(parsed.sampleRate !== EXPECTED_SAMPLE_RATE
      ? [`sampleRate ${parsed.sampleRate}; expected ${EXPECTED_SAMPLE_RATE} for web-optimized V3 source samples`]
      : []),
    ...(parsed.channels !== 1 ? [`channels ${parsed.channels}; expected mono`] : []),
    ...(parsed.bitsPerSample !== 16 ? [`bitsPerSample ${parsed.bitsPerSample}; expected 16`] : []),
    ...(durationSeconds < 0.45 ? [`duration ${durationSeconds.toFixed(3)}s is too short`] : []),
    ...(durationSeconds > 1.35 ? [`duration ${durationSeconds.toFixed(3)}s is too long for web V3 sample`] : []),
    ...(peak < 0.08 ? [`peak ${peak.toFixed(4)} is too quiet`] : []),
    ...(peak > 0.98 ? [`peak ${peak.toFixed(4)} is near clipping`] : []),
    ...(rms < 0.012 ? [`rms ${rms.toFixed(4)} is too quiet`] : []),
    ...(activeRatio < 0.28 ? [`activeRatio ${activeRatio.toFixed(3)} is too sparse`] : []),
    ...(leadingSilenceMs > 80 ? [`leading silence ${leadingSilenceMs.toFixed(1)}ms is too long`] : []),
    ...(trailingSilenceMs > 160 ? [`trailing silence ${trailingSilenceMs.toFixed(1)}ms is too long`] : []),
  ]
  return {
    path,
    ok: problems.length === 0,
    problems,
    metrics: {
      sampleRate: parsed.sampleRate,
      channels: parsed.channels,
      bitsPerSample: parsed.bitsPerSample,
      durationSeconds,
      peak,
      rms,
      activeRatio,
      leadingSilenceMs,
      trailingSilenceMs,
    },
  }
}

function parsePcm16Wav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 44 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') {
    return { ok: false, error: 'not a RIFF/WAVE file' }
  }
  let offset = 12
  let format = null
  let dataOffset = -1
  let dataSize = 0
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (id === 'fmt ') {
      format = {
        audioFormat: view.getUint16(chunkStart, true),
        channels: view.getUint16(chunkStart + 2, true),
        sampleRate: view.getUint32(chunkStart + 4, true),
        bitsPerSample: view.getUint16(chunkStart + 14, true),
      }
    } else if (id === 'data') {
      dataOffset = chunkStart
      dataSize = size
      break
    }
    offset = chunkStart + size + (size % 2)
  }
  if (!format) {
    return { ok: false, error: 'missing fmt chunk' }
  }
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    return { ok: false, error: `unsupported WAV format ${format.audioFormat}/${format.bitsPerSample}` }
  }
  if (dataOffset < 0) {
    return { ok: false, error: 'missing data chunk' }
  }
  const frameCount = Math.floor(dataSize / 2 / format.channels)
  const samples = new Float32Array(frameCount)
  let cursor = dataOffset
  for (let i = 0; i < frameCount; i += 1) {
    let mixed = 0
    for (let channel = 0; channel < format.channels; channel += 1) {
      mixed += view.getInt16(cursor, true) / 32768
      cursor += 2
    }
    samples[i] = mixed / format.channels
  }
  return { ok: true, ...format, samples }
}

function summarizeWavs(wavs) {
  const metrics = wavs.map((wav) => wav.metrics).filter(Boolean)
  return {
    okCount: wavs.filter((wav) => wav.ok).length,
    problemCount: wavs.filter((wav) => !wav.ok).length,
    minPeak: min(metrics.map((metric) => metric.peak)),
    maxPeak: max(metrics.map((metric) => metric.peak)),
    minRms: min(metrics.map((metric) => metric.rms)),
    maxRms: max(metrics.map((metric) => metric.rms)),
    minDurationSeconds: min(metrics.map((metric) => metric.durationSeconds)),
    maxDurationSeconds: max(metrics.map((metric) => metric.durationSeconds)),
    maxLeadingSilenceMs: max(metrics.map((metric) => metric.leadingSilenceMs)),
    maxTrailingSilenceMs: max(metrics.map((metric) => metric.trailingSilenceMs)),
  }
}

function worstWavs(wavs) {
  return wavs
    .filter((wav) => !wav.ok)
    .slice(0, 10)
    .map((wav) => ({ path: wav.path, problems: wav.problems, metrics: wav.metrics }))
}

function licenseProblems(text) {
  return [
    ...(text.includes('No third-party voice') ? [] : ['license.txt must say no third-party voice is included.']),
    ...(text.includes('No third-party voice, singer likeness, TTS service output, model checkpoint output')
      ? []
      : ['license.txt must explicitly exclude TTS/model checkpoint output.']),
    ...(text.includes('Generated user audio may be used freely')
      ? []
      : ['license.txt must state generated user audio usage permission.']),
  ]
}

function manifestProblems(manifest, wavCount, aliasCount) {
  if (!manifest || typeof manifest !== 'object') {
    return ['webuta-ko-v3.manifest.json is not valid JSON.']
  }
  const coverage = manifest.coverage ?? {}
  return [
    ...(manifest.id === 'webuta-ko-v3-synthetic' ? [] : [`manifest id is ${manifest.id}; expected webuta-ko-v3-synthetic.`]),
    ...(manifest.type === 'generated-synthetic-utau-cv-vc'
      ? []
      : [`manifest type is ${manifest.type}; expected generated-synthetic-utau-cv-vc.`]),
    ...(coverage.sampleCount === wavCount
      ? []
      : [`manifest sampleCount ${coverage.sampleCount}; actual wavCount ${wavCount}.`]),
    ...(coverage.aliasCount === aliasCount
      ? []
      : [`manifest aliasCount ${coverage.aliasCount}; actual oto alias count ${aliasCount}.`]),
  ]
}

function silenceMs(samples, sampleRate, side) {
  const threshold = 0.002
  let count = 0
  if (side === 'leading') {
    for (let i = 0; i < samples.length && Math.abs(samples[i]) < threshold; i += 1) {
      count += 1
    }
  } else {
    for (let i = samples.length - 1; i >= 0 && Math.abs(samples[i]) < threshold; i -= 1) {
      count += 1
    }
  }
  return (count / sampleRate) * 1000
}

function ascii(view, offset, length) {
  let text = ''
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i))
  }
  return text
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function splitOnce(text, separator) {
  const index = text.indexOf(separator)
  return [text.slice(0, index), text.slice(index + separator.length)]
}

function numberField(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function min(values) {
  return values.length ? Math.min(...values) : null
}

function max(values) {
  return values.length ? Math.max(...values) : null
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--zip') {
      options.zip = argv[++index]
    } else if (arg === '--report') {
      options.report = argv[++index]
    } else if (arg === '--max-bytes') {
      options.maxBytes = Number(argv[++index])
    } else if (arg === '--min-wavs') {
      options.minWavs = Number(argv[++index])
    } else if (arg === '--min-aliases') {
      options.minAliases = Number(argv[++index])
    } else if (arg === '--max-samples') {
      options.maxSamples = Number(argv[++index])
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/audit-korean-v3-voicebank.mjs [options]',
          '',
          'Options:',
          '  --zip path            Voicebank zip, default public/voicebanks/webuta-ko-v3.zip',
          '  --report path         JSON report path',
          '  --max-bytes n         Max zip bytes for web default',
          '  --min-wavs n          Minimum WAV sample count',
          '  --min-aliases n       Minimum oto.ini alias count',
          '  --max-samples n       Audit only first n WAV files',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  auditKoreanV3Voicebank(parseArgs(process.argv.slice(2)))
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
