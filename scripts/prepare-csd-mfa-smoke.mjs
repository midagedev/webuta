#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3

export function prepareCsdMfaSmoke(options) {
  const csdRoot = resolve(options.csdRoot ?? 'experiments/neural-singer/datasets/csd/extracted/CSD/korean')
  if (!existsSync(csdRoot)) {
    throw new Error(`Missing CSD Korean root: ${csdRoot}`)
  }
  const outputDir = resolve(options.out ?? 'experiments/neural-singer/work/csd-mfa-smoke')
  const ids = resolveIds(csdRoot, options.ids ?? ['kr007a'], options.limit)
  const targetRate = Number(options.targetRate ?? 16000)
  const gapSeconds = Number(options.gapSeconds ?? 0.75)
  const maxSegmentSeconds = Number(options.maxSegmentSeconds ?? 12)
  const paddingSeconds = Number(options.paddingSeconds ?? 0.08)
  const wavDir = join(outputDir, 'raw', 'wavs')
  const rows = [['name', 'text']]
  const manifestSegments = []

  mkdirSync(wavDir, { recursive: true })

  for (const id of ids) {
    const source = readCsdItem(csdRoot, id)
    const alignedRows = alignCsdRowsToHangul(source.rows, source.hangulSyllables, id)
    const groups = groupRows(alignedRows, { gapSeconds, maxSegmentSeconds })
    const decoded = decodeWav(readFileSync(source.wavPath))
    const mono = mixToMono(decoded)
    const resampled = resampleLinear(mono, decoded.sampleRate, targetRate)

    groups.forEach((group, index) => {
      const name = `${id}-${String(index + 1).padStart(2, '0')}`
      const startSeconds = Math.max(0, group[0].start - paddingSeconds)
      const endSeconds = group[group.length - 1].end + paddingSeconds
      const text = group.map((row) => row.hangul).join(' ')
      const wavPath = join(wavDir, `${name}.wav`)
      const labPath = join(wavDir, `${name}.lab`)
      writeSegmentWav(resampled, targetRate, wavPath, startSeconds, endSeconds)
      writeFileSync(labPath, `${text}\n`)
      rows.push([name, text])
      manifestSegments.push({
        name,
        sourceId: id,
        sourceWav: source.wavPath,
        sourceCsv: source.csvPath,
        sourceLyric: source.lyricPath,
        startSeconds,
        endSeconds,
        durationSeconds: endSeconds - startSeconds,
        label: text,
        rowCount: group.length,
        midi: group.map((row) => row.pitch),
        csdSyllables: group.map((row) => row.csdSyllable),
      })
    })
  }

  writeFileSync(join(outputDir, 'raw', 'transcriptions.csv'), csvRows(rows))
  const summary = {
    version: 1,
    source: 'webuta-csd-mfa-smoke',
    generatedAt: new Date().toISOString(),
    csdRoot,
    ids,
    targetRate,
    gapSeconds,
    maxSegmentSeconds,
    paddingSeconds,
    segmentCount: manifestSegments.length,
    totalDurationSeconds: manifestSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    segments: manifestSegments,
    note: 'CSD is CC BY-NC-SA 4.0 research data. Keep extracted audio under ignored paths.',
  }
  writeFileSync(join(outputDir, 'csd-mfa-smoke.manifest.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(outputDir, 'README.md'), seedReadme(ids))

  return {
    outputDir,
    wavs: wavDir,
    ids,
    segmentCount: manifestSegments.length,
    totalDurationSeconds: summary.totalDurationSeconds,
    transcriptions: join(outputDir, 'raw', 'transcriptions.csv'),
    manifest: join(outputDir, 'csd-mfa-smoke.manifest.json'),
  }
}

function readCsdItem(csdRoot, id) {
  const wavPath = join(csdRoot, 'wav', `${id}.wav`)
  const csvPath = join(csdRoot, 'csv', `${id}.csv`)
  const lyricPath = join(csdRoot, 'lyric', `${id}.txt`)
  for (const path of [wavPath, csvPath, lyricPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing CSD input for ${id}: ${path}`)
    }
  }
  return {
    wavPath,
    csvPath,
    lyricPath,
    rows: parseCsdCsv(readFileSync(csvPath, 'utf8')),
    hangulSyllables: hangulSyllables(readFileSync(lyricPath, 'utf8')),
  }
}

function alignCsdRowsToHangul(rows, syllables, id) {
  if (rows.length !== syllables.length) {
    throw new Error(`CSD row/lyric syllable mismatch for ${id}: ${rows.length} CSV rows vs ${syllables.length} Hangul syllables.`)
  }
  return rows.map((row, index) => ({
    ...row,
    hangul: syllables[index],
  }))
}

function groupRows(rows, { gapSeconds, maxSegmentSeconds }) {
  const groups = []
  let current = []
  for (const row of rows) {
    const previous = current.at(-1)
    const gap = previous ? row.start - previous.end : 0
    const wouldExceedMax = current.length > 0 && row.end - current[0].start > maxSegmentSeconds
    if (current.length > 0 && (gap >= gapSeconds || wouldExceedMax)) {
      groups.push(current)
      current = []
    }
    current.push(row)
  }
  if (current.length > 0) {
    groups.push(current)
  }
  return groups
}

function parseCsdCsv(text) {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const header = lines.shift()?.split(',') ?? []
  const startIndex = header.indexOf('start')
  const endIndex = header.indexOf('end')
  const pitchIndex = header.indexOf('pitch')
  const syllableIndex = header.indexOf('syllable')
  if ([startIndex, endIndex, pitchIndex, syllableIndex].includes(-1)) {
    throw new Error('CSD CSV must contain start,end,pitch,syllable columns.')
  }
  return lines.map((line) => {
    const columns = line.split(',')
    return {
      start: Number(columns[startIndex]),
      end: Number(columns[endIndex]),
      pitch: Number(columns[pitchIndex]),
      csdSyllable: columns[syllableIndex],
    }
  })
}

function hangulSyllables(text) {
  return [...text].filter((char) => {
    const code = char.codePointAt(0) ?? 0
    return code >= HANGUL_BASE && code <= HANGUL_END
  })
}

function resolveIds(csdRoot, ids, limit) {
  const normalized = normalizeIds(ids)
  const resolved = normalized.includes('all') ? listCsdIds(csdRoot) : normalized
  const max = Number(limit ?? 0)
  return Number.isFinite(max) && max > 0 ? resolved.slice(0, max) : resolved
}

function normalizeIds(ids) {
  if (Array.isArray(ids)) {
    return ids
  }
  return String(ids).split(',').map((id) => id.trim()).filter(Boolean)
}

function listCsdIds(csdRoot) {
  const wavDir = join(csdRoot, 'wav')
  if (!existsSync(wavDir)) {
    throw new Error(`Missing CSD wav directory: ${wavDir}`)
  }
  return readdirSync(wavDir)
    .filter((name) => /^kr\d+[ab]\.wav$/u.test(name))
    .map((name) => name.replace(/\.wav$/u, ''))
    .sort((left, right) => left.localeCompare(right))
}

function writeSegmentWav(samples, sampleRate, outputPath, startSeconds, endSeconds) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate))
  const end = Math.min(samples.length, Math.ceil(endSeconds * sampleRate))
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, encodeWav16(samples.subarray(start, end), sampleRate))
}

function decodeWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Unsupported WAV container.')
  }
  let offset = 12
  let fmt = null
  let dataOffset = null
  let dataSize = null
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channelCount: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    } else if (chunkId === 'data') {
      dataOffset = chunkStart
      dataSize = chunkSize
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }
  if (!fmt || dataOffset === null || dataSize === null) {
    throw new Error('WAV is missing fmt or data chunk.')
  }
  if (![1, 3].includes(fmt.audioFormat)) {
    throw new Error(`Unsupported WAV format: ${fmt.audioFormat}`)
  }
  const frameCount = Math.floor(dataSize / fmt.blockAlign)
  const channels = Array.from({ length: fmt.channelCount }, () => new Float32Array(frameCount))
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * fmt.blockAlign
    for (let channel = 0; channel < fmt.channelCount; channel += 1) {
      channels[channel][frame] = readSample(buffer, frameOffset + channel * (fmt.bitsPerSample / 8), fmt.audioFormat, fmt.bitsPerSample)
    }
  }
  return {
    sampleRate: fmt.sampleRate,
    channelCount: fmt.channelCount,
    channels,
  }
}

function readSample(buffer, offset, audioFormat, bitsPerSample) {
  if (audioFormat === 3 && bitsPerSample === 32) {
    return clamp(buffer.readFloatLE(offset), -1, 1)
  }
  if (bitsPerSample === 8) {
    return (buffer.readUInt8(offset) - 128) / 128
  }
  if (bitsPerSample === 16) {
    return buffer.readInt16LE(offset) / 32768
  }
  if (bitsPerSample === 24) {
    return buffer.readIntLE(offset, 3) / 8388608
  }
  if (bitsPerSample === 32) {
    return buffer.readInt32LE(offset) / 2147483648
  }
  throw new Error(`Unsupported sample depth: ${bitsPerSample}`)
}

function mixToMono(decoded) {
  if (decoded.channelCount === 1) {
    return decoded.channels[0]
  }
  const mono = new Float32Array(decoded.channels[0].length)
  const gain = 1 / Math.sqrt(decoded.channelCount)
  for (const channel of decoded.channels) {
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] += channel[index] * gain
    }
  }
  return mono
}

function resampleLinear(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return samples
  }
  const targetLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate))
  const output = new Float32Array(targetLength)
  const ratio = sourceRate / targetRate
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio
    const left = Math.floor(sourcePosition)
    const right = Math.min(samples.length - 1, left + 1)
    const fraction = sourcePosition - left
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction
  }
  return output
}

function encodeWav16(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let index = 0; index < samples.length; index += 1) {
    data.writeInt16LE(Math.round(clamp(samples[index], -1, 1) * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function csvRows(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function seedReadme(ids) {
  return [
    '# CSD MFA Smoke Corpus',
    '',
    `Generated CSD Korean item(s): ${ids.join(', ')}`,
    '',
    'This is an OpenVPI/MFA-style seed corpus for alignment smoke tests.',
    'Keep it under ignored experiment paths because CSD is CC BY-NC-SA 4.0 research data.',
    '',
    '- `raw/wavs/*.wav`: 16 kHz mono segment audio',
    '- `raw/wavs/*.lab`: Hangul syllable labels',
    '- `raw/transcriptions.csv`: segment name/text rows',
    '- `csd-mfa-smoke.manifest.json`: source mapping and timings',
    '',
  ].join('\n')
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--csd-root') {
      parsed.csdRoot = argv[++index]
    } else if (arg === '--ids') {
      parsed.ids = argv[++index]
    } else if (arg === '--limit') {
      parsed.limit = Number(argv[++index])
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--target-rate') {
      parsed.targetRate = Number(argv[++index])
    } else if (arg === '--gap-seconds') {
      parsed.gapSeconds = Number(argv[++index])
    } else if (arg === '--max-segment-seconds') {
      parsed.maxSegmentSeconds = Number(argv[++index])
    } else if (arg === '--padding-seconds') {
      parsed.paddingSeconds = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-csd-mfa-smoke.mjs [options]',
          '',
          'Options:',
          '  --csd-root path            Extracted CSD/korean root',
          '  --ids id[,id...]|all       CSD Korean item ids, default kr007a',
          '  --limit n                  Limit selected ids after sorting, useful with --ids all',
          '  --out path                 Output OpenVPI/MFA seed corpus directory',
          '  --target-rate hz           Output sample rate, default 16000',
          '  --gap-seconds seconds      Split at note gaps, default 0.75',
          '  --max-segment-seconds n    Split before this duration, default 12',
          '  --padding-seconds seconds  Segment padding, default 0.08',
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return parsed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = prepareCsdMfaSmoke(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
