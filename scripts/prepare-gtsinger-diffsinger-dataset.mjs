#!/usr/bin/env node

import { cpSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_REPOSITORY = 'experiments/neural-singer/datasets/gtsinger-korean/repository'
const DEFAULT_METADATA = 'processed/Korean/metadata.json'
const DEFAULT_OUT = 'experiments/neural-singer/work/gtsinger-korean-diffsinger-processed'

export function prepareGTSingerDiffSingerDataset(options = {}) {
  const repository = resolve(options.repository ?? DEFAULT_REPOSITORY)
  const metadataPath = resolve(options.metadata ?? join(repository, DEFAULT_METADATA))
  const out = resolve(options.out ?? DEFAULT_OUT)
  const copyAudio = options.copyAudio !== false
  const linkAudio = options.linkAudio === true
  const materializeAudio = copyAudio || linkAudio
  const normalizePhones = options.normalizePhones !== false
  const limitItems = positiveInteger(options.limitItems, 0)
  if (!existsSync(repository)) {
    throw new Error(`Missing GTSinger repository directory: ${repository}`)
  }
  if (!existsSync(metadataPath)) {
    throw new Error(`Missing GTSinger processed metadata: ${metadataPath}`)
  }
  if (existsSync(out)) {
    if (!options.force) {
      throw new Error(`Output already exists: ${out}. Pass --force to replace it.`)
    }
    rmSync(out, { recursive: true, force: true })
  }

  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  if (!Array.isArray(metadata)) {
    throw new Error('GTSinger metadata must be a JSON array.')
  }

  const wavDir = join(out, 'wavs')
  mkdirSync(wavDir, { recursive: true })

  const rows = []
  const items = []
  const skipped = []
  const phoneCounts = new Map()
  let totalDurationSeconds = 0
  let totalWavDurationSeconds = 0
  let maxPhoneDurationSeconds = 0
  let maxDurationDriftSeconds = 0

  for (const source of metadata) {
    const sourceItemName = String(source.item_name ?? '')
    const wavRelative = String(source.wav_fn ?? sourceItemName.replaceAll('#', '/') + '.wav')
    const wavPath = resolve(repository, wavRelative)
    if (!sourceItemName || !existsSync(wavPath)) {
      skipped.push({
        itemName: sourceItemName || null,
        wavRelative,
        reason: 'missing-wav',
      })
      continue
    }

    const phones = normalizePhoneSequence(source.ph, { normalizePhones })
    const durations = numericArray(source.ph_durs)
    if (phones.length === 0 || phones.length !== durations.length || durations.some((duration) => duration < 0)) {
      skipped.push({
        itemName: sourceItemName,
        wavRelative,
        reason: 'invalid-phone-duration',
        phoneCount: phones.length,
        durationCount: durations.length,
      })
      continue
    }

    const index = rows.length
    const name = `gts-ko-${String(index + 1).padStart(4, '0')}`
    const outputWav = join(wavDir, `${name}.wav`)
    if (materializeAudio) {
      materializeWav(wavPath, outputWav, { linkAudio })
    }
    const phSeq = phones.join(' ')
    const phDur = durations.map(formatNumber).join(' ')
    const text = normalizeText(source.txt)
    const phNum = phNumFromPh2Words(source.ph2words, phones.length)
    const noteSeq = midiSequence(source.ep_pitches)
    const noteDur = numericArray(source.ep_notedurs).map(formatNumber)
    const noteSlur = noteSeq.map(() => '0')
    rows.push({
      name,
      ph_seq: phSeq,
      ph_dur: phDur,
      ph_num: phNum.join(' '),
      note_seq: noteSeq.join(' '),
      note_dur: noteDur.join(' '),
      note_slur: noteSlur.join(' '),
      text,
      source_item_name: sourceItemName,
      source_wav: wavRelative,
    })

    const phoneDurationSeconds = sum(durations)
    const wavStats = readWavStats(wavPath)
    const durationDriftSeconds = Math.abs(phoneDurationSeconds - wavStats.durationSeconds)
    totalDurationSeconds += phoneDurationSeconds
    totalWavDurationSeconds += wavStats.durationSeconds
    maxPhoneDurationSeconds = Math.max(maxPhoneDurationSeconds, ...durations)
    maxDurationDriftSeconds = Math.max(maxDurationDriftSeconds, durationDriftSeconds)
    for (const phone of phones) {
      phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1)
    }
    items.push({
      name,
      sourceItemName,
      sourceWav: wavRelative,
      wav: materializeAudio ? outputWav : wavPath,
      phoneCount: phones.length,
      noteCount: noteSeq.length,
      durationSeconds: round(phoneDurationSeconds),
      wavDurationSeconds: round(wavStats.durationSeconds),
      durationDriftSeconds: round(durationDriftSeconds),
      maxPhoneDurationSeconds: round(Math.max(...durations)),
      text,
    })

    if (limitItems > 0 && rows.length >= limitItems) {
      break
    }
  }

  if (rows.length === 0) {
    throw new Error('No GTSinger metadata rows had usable local WAV files.')
  }

  writeFileSync(join(out, 'transcriptions.csv'), toCsv([Object.keys(rows[0]), ...rows.map((row) => Object.values(row))]))
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'gtsinger-processed-korean',
    repository,
    metadata: metadataPath,
    out,
    copiedAudio: materializeAudio && !linkAudio,
    linkedAudio: materializeAudio && linkAudio,
    audioMode: materializeAudio ? (linkAudio ? 'hardlink' : 'copy') : 'source-only',
    normalizedPhones: normalizePhones,
    metrics: {
      metadataItemCount: metadata.length,
      itemCount: rows.length,
      skippedCount: skipped.length,
      totalDurationSeconds: round(totalDurationSeconds),
      totalWavDurationSeconds: round(totalWavDurationSeconds),
      maxPhoneDurationSeconds: round(maxPhoneDurationSeconds),
      maxDurationDriftSeconds: round(maxDurationDriftSeconds),
      phoneInventoryCount: phoneCounts.size,
      hasAp: phoneCounts.has('AP'),
      hasSp: phoneCounts.has('SP'),
    },
    phoneCounts: Object.fromEntries([...phoneCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    items,
    skipped: skipped.slice(0, 200),
    skippedOmittedCount: Math.max(0, skipped.length - 200),
    nextCommands: [
      `npm run neural:audit-enhanced-dataset -- --dataset-dir ${relativePath(out)} --min-items ${rows.length} --min-total-seconds ${Math.floor(totalWavDurationSeconds)} --max-phone-duration ${Math.ceil(maxPhoneDurationSeconds)} --report ${relativePath(join(out, 'enhanced-dataset-audit.json'))}`,
      `npm run neural:prepare-diffsinger-training -- --dataset-dir ${relativePath(out)} --dataset gtsinger-korean-research-baseline --out experiments/neural-singer/work/gtsinger-korean-diffsinger-training --model-id webuta-ko-gtsinger-research --model-name "WebUtau KO GTSinger Research"`,
    ],
  }
  writeJson(join(out, 'gtsinger-diffsinger-dataset.manifest.json'), report)
  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

function normalizePhoneSequence(value, options) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((phone) => normalizePhone(phone, options)).filter(Boolean)
}

function materializeWav(source, target, options) {
  if (options.linkAudio) {
    try {
      linkSync(source, target)
      return
    } catch {
      // Hard links can fail across volumes; fall back to a normal copy.
    }
  }
  cpSync(source, target)
}

function normalizePhone(value, options) {
  const phone = String(value ?? '').trim()
  if (!phone) {
    return ''
  }
  if (phone === '<AP>') {
    return 'AP'
  }
  if (phone === '<SP>') {
    return 'SP'
  }
  return options.normalizePhones ? phone.replace(/_ko$/u, '') : phone
}

function numericArray(value) {
  return Array.isArray(value) ? value.map(Number).filter((number) => Number.isFinite(number)) : []
}

function normalizeText(value) {
  return Array.isArray(value) ? value.map((token) => String(token ?? '')).join('') : ''
}

function phNumFromPh2Words(value, phoneCount) {
  if (!Array.isArray(value) || value.length !== phoneCount) {
    return Array.from({ length: phoneCount }, () => 1)
  }
  const counts = []
  for (const wordIndex of value.map(Number)) {
    if (!Number.isInteger(wordIndex) || wordIndex < 0) {
      return Array.from({ length: phoneCount }, () => 1)
    }
    counts[wordIndex] = (counts[wordIndex] ?? 0) + 1
  }
  return counts.filter((count) => count > 0)
}

function midiSequence(value) {
  const pitches = numericArray(value)
  return pitches.map((pitch) => (pitch <= 0 ? 'rest' : midiToNoteName(Math.round(pitch))))
}

function midiToNoteName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const pitchClass = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${names[pitchClass]}${octave}`
}

function readWavStats(path) {
  try {
    const buffer = readFileSync(path)
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      return { durationSeconds: 0 }
    }
    let offset = 12
    let byteRate = 0
    let dataSize = 0
    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString('ascii', offset, offset + 4)
      const chunkSize = buffer.readUInt32LE(offset + 4)
      const chunkStart = offset + 8
      if (chunkId === 'fmt ') {
        byteRate = buffer.readUInt32LE(chunkStart + 8)
      } else if (chunkId === 'data') {
        dataSize = chunkSize
      }
      offset = chunkStart + chunkSize + (chunkSize % 2)
    }
    return { durationSeconds: byteRate > 0 ? dataSize / byteRate : 0 }
  } catch {
    return { durationSeconds: 0 }
  }
}

function toCsv(rows) {
  return `${rows.map((row) => row.map(toCsvCell).join(',')).join('\n')}\n`
}

function toCsvCell(cell) {
  const value = String(cell ?? '')
  if (!/[",\r\n]/u.test(value)) {
    return value
  }
  return `"${value.replaceAll('"', '""')}"`
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0)
}

function round(value) {
  return Math.round(Number(value ?? 0) * 1000000) / 1000000
}

function formatNumber(value) {
  return Number(value).toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '')
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function relativePath(path) {
  return resolve(path).replace(`${resolve('.')}/`, '')
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--repository') {
      parsed.repository = argv[++index]
    } else if (arg === '--metadata') {
      parsed.metadata = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--limit-items') {
      parsed.limitItems = Number(argv[++index])
    } else if (arg === '--no-copy-audio') {
      parsed.copyAudio = false
    } else if (arg === '--link-audio') {
      parsed.linkAudio = true
    } else if (arg === '--raw-phones') {
      parsed.normalizePhones = false
    } else if (arg === '--force') {
      parsed.force = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-gtsinger-diffsinger-dataset.mjs [options]',
          '',
          'Options:',
          `  --repository path      GTSinger repository root, default ${DEFAULT_REPOSITORY}`,
          `  --metadata path        Processed metadata JSON, default repository/${DEFAULT_METADATA}`,
          `  --out path             Output DiffSinger dataset dir, default ${DEFAULT_OUT}`,
          '  --report path          Write JSON report',
          '  --limit-items n        Stop after n usable local WAV rows',
          '  --no-copy-audio        Write metadata only; do not copy WAVs',
          '  --link-audio           Hard-link WAVs into the dataset when possible',
          '  --raw-phones           Keep GTSinger language suffixes such as _ko',
          '  --force                Replace output directory if it exists',
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
    const report = prepareGTSingerDiffSingerDataset(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
