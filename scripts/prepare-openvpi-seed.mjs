#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3

export function prepareOpenVpiSeed(options) {
  const ingestDir = resolve(options.ingestDir ?? '')
  if (!ingestDir || !existsSync(ingestDir)) {
    throw new Error('Missing or invalid --ingest-dir path.')
  }
  const outputDir = resolve(options.out ?? join(dirname(ingestDir), `${basename(ingestDir)}-openvpi-seed`))
  const summary = JSON.parse(readFileSync(join(ingestDir, 'summary.json'), 'utf8'))
  const segments = readJsonl(join(ingestDir, 'segments.jsonl'))
  const rawDir = join(outputDir, 'raw')
  const wavDir = join(rawDir, 'wavs')
  const copyAudio = options.copyAudio === true

  mkdirSync(wavDir, { recursive: true })

  const rows = []
  const manifestSegments = []
  const seenNames = new Set()
  const nameCounts = new Map()
  for (const segment of segments) {
    const name = uniqueSegmentName(sanitizeName(segment.id), seenNames, nameCounts)
    const text = labelText(segment.annotationText)
    const sourcePath = resolve(summary.datasetRoot, segment.sourceRelative)
    const wavPath = join(wavDir, `${name}.wav`)
    const labelPath = join(wavDir, `${name}.lab`)

    if (copyAudio) {
      writeSegmentWav(sourcePath, wavPath, segment.startSeconds, segment.durationSeconds, segment.targetSampleRate)
    }
    writeFileSync(labelPath, `${text}\n`)
    rows.push([name, text])
    manifestSegments.push({
      name,
      sourceRelative: segment.sourceRelative,
      startSeconds: segment.startSeconds,
      durationSeconds: segment.durationSeconds,
      copiedAudio: copyAudio,
      rawWav: copyAudio ? `raw/wavs/${name}.wav` : null,
      lab: `raw/wavs/${name}.lab`,
      text,
      diagnostics: segment.stats,
    })
  }

  writeFileSync(join(rawDir, 'transcriptions.csv'), csvRows([['name', 'text'], ...rows]))
  writeFileSync(
    join(outputDir, 'webuta-openvpi-seed.manifest.json'),
    `${JSON.stringify(
      {
        version: 1,
        source: 'webuta-neural-ingest',
        generatedAt: new Date().toISOString(),
        datasetId: summary.datasetId,
        ingestDir,
        openVpiReference: {
          makeDiffSinger: 'https://github.com/openvpi/MakeDiffSinger',
          datasetTools: 'https://github.com/openvpi/dataset-tools',
        },
        copiedAudio: copyAudio,
        note:
          'This is a pre-alignment seed corpus. Run OpenVPI/MakeDiffSinger forced-alignment tooling before treating it as a final DiffSinger dataset.',
        segments: manifestSegments,
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(outputDir, 'README.md'), seedReadme(summary.datasetId, copyAudio))

  return {
    outputDir,
    copiedAudio: copyAudio,
    segmentCount: segments.length,
    transcriptions: join(rawDir, 'transcriptions.csv'),
    wavs: wavDir,
  }
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--ingest-dir') {
      parsed.ingestDir = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--copy-audio') {
      parsed.copyAudio = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-openvpi-seed.mjs --ingest-dir path [options]',
          '',
          'Options:',
          '  --out path       Output directory for the OpenVPI seed corpus',
          '  --copy-audio     Write segment WAVs into raw/wavs',
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

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function labelText(text) {
  const syllables = []
  const normalized = text.replace(/<\s*(AP|SP)\s*>/giu, ' $1 ')
  for (const rawToken of normalized.trim().split(/\s+/u)) {
    const upperToken = rawToken.toUpperCase()
    if (upperToken === 'AP' || upperToken === 'SP') {
      continue
    }
    for (const char of rawToken) {
      const code = char.codePointAt(0) ?? 0
      if (code >= HANGUL_BASE && code <= HANGUL_END) {
        syllables.push(char)
      } else if (!/\s/u.test(char)) {
        syllables.push(char)
      }
    }
  }
  return syllables.join(' ')
}

function writeSegmentWav(sourcePath, outputPath, startSeconds, durationSeconds, targetSampleRate) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing source audio: ${sourcePath}`)
  }
  const decoded = decodeWav(readFileSync(sourcePath))
  const mono = mixToMono(decoded)
  const resampled = resampleLinear(mono, decoded.sampleRate, targetSampleRate)
  const start = Math.max(0, Math.floor(startSeconds * targetSampleRate))
  const end = Math.min(resampled.length, Math.ceil((startSeconds + durationSeconds) * targetSampleRate))
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, encodeWav16(resampled.subarray(start, end), targetSampleRate))
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

function seedReadme(datasetId, copiedAudio) {
  return [
    `# OpenVPI Seed Corpus: ${datasetId}`,
    '',
    'This directory was generated from WebUtau neural ingestion metadata.',
    '',
    'It is a pre-alignment corpus, not a final DiffSinger training dataset.',
    'Use OpenVPI/MakeDiffSinger forced-alignment tooling before training.',
    '',
    '- `raw/wavs/`: segment WAV files' + (copiedAudio ? '' : ' (not copied in this run)'),
    '- `raw/wavs/*.lab`: syllable labels generated from sidecar lyric text',
    '- `raw/transcriptions.csv`: seed name/text rows',
    '- `webuta-openvpi-seed.manifest.json`: WebUtau diagnostics and source mapping',
    '',
  ].join('\n')
}

function sanitizeName(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-|-$/g, '') || 'segment'
}

function uniqueSegmentName(baseName, seenNames, nameCounts) {
  let count = (nameCounts.get(baseName) ?? 0) + 1
  nameCounts.set(baseName, count)
  let candidate = count === 1 ? baseName : `${baseName}-${String(count).padStart(4, '0')}`
  while (seenNames.has(candidate)) {
    count += 1
    nameCounts.set(baseName, count)
    candidate = `${baseName}-${String(count).padStart(4, '0')}`
  }
  seenNames.add(candidate)
  return candidate
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = prepareOpenVpiSeed(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
