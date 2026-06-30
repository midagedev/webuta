#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PACK_DIR = 'experiments/neural-singer/datasets/original-private-singer'
const DEFAULT_SAMPLE_RATE = 44100
const DEFAULT_COUNT_IN_BEATS = 4
const DEFAULT_TAIL_SECONDS = 0.5
const DEFAULT_GUIDE_GAIN = 0.22
const DEFAULT_CLICK_GAIN = 0.35

export function preparePrivateSingerGuideTracks(options = {}) {
  const packDir = resolve(options.packDir ?? DEFAULT_PACK_DIR)
  const sessionPath = resolve(options.session ?? join(packDir, 'recording-session.json'))
  const outDir = resolve(options.outDir ?? join(packDir, 'guides'))
  if (!existsSync(sessionPath)) {
    throw new Error(`Missing recording session: ${sessionPath}`)
  }
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
  const takeFilter = parseTakeFilter(options.takes)
  const takes = Array.isArray(session.takes) ? session.takes.filter((take) => !takeFilter || takeFilter.has(take.id)) : []
  if (takes.length === 0) {
    throw new Error('No recording takes selected for guide generation.')
  }

  const sampleRate = integerNumber(options.sampleRate, DEFAULT_SAMPLE_RATE)
  const countInBeats = integerNumber(options.countInBeats, DEFAULT_COUNT_IN_BEATS)
  const tailSeconds = positiveNumber(options.tailSeconds, DEFAULT_TAIL_SECONDS)
  const guideGain = positiveNumber(options.guideGain, DEFAULT_GUIDE_GAIN)
  const clickGain = positiveNumber(options.clickGain, DEFAULT_CLICK_GAIN)
  mkdirSync(outDir, { recursive: true })
  const staleDeleted = takeFilter ? [] : removeStaleGuideWavs(outDir, takes)

  const guides = takes.map((take) =>
    renderGuideTrack({
      packDir,
      outDir,
      take,
      sampleRate,
      countInBeats,
      tailSeconds,
      guideGain,
      clickGain,
    }),
  )
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    packDir,
    sessionPath,
    outDir,
    sessionId: session.sessionId ?? '(unknown)',
    singerId: session.singerId ?? '(unknown)',
    guideUse: {
      purpose: 'Headphone pitch/click guide for recording original Korean singer takes.',
      warning: 'Do not train on guide tracks. Record/export the dry vocal WAV using the exact wavPath and trim any count-in before audit.',
    },
    settings: {
      sampleRate,
      countInBeats,
      tailSeconds,
      guideGain,
      clickGain,
    },
    totals: {
      takeCount: guides.length,
      totalGuideSeconds: roundMetric(guides.reduce((sum, guide) => sum + guide.durationSeconds, 0)),
      totalExpectedVocalSeconds: roundMetric(guides.reduce((sum, guide) => sum + guide.expectedVocalSeconds, 0)),
      staleDeletedCount: staleDeleted.length,
    },
    staleDeleted,
    guides,
  }

  const manifestPath = resolve(options.report ?? join(outDir, 'guide-manifest.json'))
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(outDir, 'README.md'), guideReadme(manifest))
  return {
    ...manifest,
    manifestPath,
  }
}

function removeStaleGuideWavs(outDir, takes) {
  const expected = new Set(takes.map((take) => `${take.id}.guide.wav`))
  const stale = readdirSync(outDir)
    .filter((entry) => entry.endsWith('.guide.wav') && !expected.has(entry))
    .sort((a, b) => a.localeCompare(b))
  for (const entry of stale) {
    unlinkSync(join(outDir, entry))
  }
  return stale
}

function renderGuideTrack({ packDir, outDir, take, sampleRate, countInBeats, tailSeconds, guideGain, clickGain }) {
  const requestPath = resolve(packDir, take.neuralRequestPath)
  if (!existsSync(requestPath)) {
    throw new Error(`Missing neural request for ${take.id}: ${requestPath}`)
  }
  const request = JSON.parse(readFileSync(requestPath, 'utf8'))
  const bpm = Number(request.project?.bpm ?? take.tempo ?? 120)
  const beatSeconds = 60 / Math.max(1, bpm)
  const countInSeconds = countInBeats * beatSeconds
  const notes = (request.notes ?? []).filter((note) => note.kind === 'note')
  const expectedVocalSeconds = notes.reduce((max, note) => Math.max(max, Number(note.startSeconds) + Number(note.durationSeconds)), 0)
  const durationSeconds = countInSeconds + expectedVocalSeconds + tailSeconds
  const samples = new Float32Array(Math.ceil(durationSeconds * sampleRate))
  const warnings = []

  for (let beat = 0; beat < countInBeats; beat += 1) {
    mixClick(samples, sampleRate, beat * beatSeconds, beat === 0 ? 1200 : 850, clickGain)
  }

  for (const note of notes) {
    if (!Number.isFinite(Number(note.targetHz)) || Number(note.targetHz) <= 0) {
      warnings.push(`Missing targetHz for note ${note.id ?? note.lyric ?? '(unknown)'}.`)
      continue
    }
    mixGuideTone({
      samples,
      sampleRate,
      startSeconds: countInSeconds + Number(note.startSeconds),
      durationSeconds: Number(note.durationSeconds),
      hz: Number(note.targetHz),
      gain: guideGain,
    })
    mixLyricTick(samples, sampleRate, countInSeconds + Number(note.startSeconds), guideGain * 0.5)
  }

  const guidePath = join(outDir, `${take.id}.guide.wav`)
  writeFileSync(guidePath, encodePcm16Wav(samples, sampleRate))
  return {
    id: take.id,
    takeNumber: take.takeNumber,
    promptId: take.promptId,
    lyric: take.lyric,
    key: take.key,
    tempo: bpm,
    wavPath: resolve(packDir, take.wavPath),
    guidePath,
    requestPath,
    vocalStartSeconds: roundMetric(countInSeconds),
    expectedVocalSeconds: roundMetric(expectedVocalSeconds),
    durationSeconds: roundMetric(durationSeconds),
    noteCount: notes.length,
    warnings,
  }
}

function mixClick(samples, sampleRate, startSeconds, hz, gain) {
  const start = Math.max(0, Math.round(startSeconds * sampleRate))
  const length = Math.min(samples.length - start, Math.round(0.055 * sampleRate))
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate
    const envelope = Math.exp(-t * 55)
    samples[start + index] += Math.sin(Math.PI * 2 * hz * t) * envelope * gain
  }
}

function mixLyricTick(samples, sampleRate, startSeconds, gain) {
  const start = Math.max(0, Math.round(startSeconds * sampleRate))
  const length = Math.min(samples.length - start, Math.round(0.018 * sampleRate))
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate
    const envelope = 1 - index / Math.max(1, length)
    samples[start + index] += Math.sin(Math.PI * 2 * 1800 * t) * envelope * gain
  }
}

function mixGuideTone({ samples, sampleRate, startSeconds, durationSeconds, hz, gain }) {
  const start = Math.max(0, Math.round(startSeconds * sampleRate))
  const length = Math.min(samples.length - start, Math.round(durationSeconds * sampleRate))
  const attack = Math.max(1, Math.round(Math.min(0.04, durationSeconds * 0.2) * sampleRate))
  const release = Math.max(1, Math.round(Math.min(0.08, durationSeconds * 0.25) * sampleRate))
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate
    const fadeIn = Math.min(1, index / attack)
    const fadeOut = Math.min(1, (length - index) / release)
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut))
    const tone = Math.sin(Math.PI * 2 * hz * t) * 0.85 + Math.sin(Math.PI * 2 * hz * 2 * t) * 0.15
    samples[start + index] += tone * envelope * gain
  }
}

function encodePcm16Wav(samples, sampleRate) {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2)
  }
  return buffer
}

function guideReadme(manifest) {
  return [
    '# Private Singer Guide Tracks',
    '',
    'These WAV files are headphone guide tracks for recording original Korean singer takes.',
    '',
    '- Do not train on these guide WAVs.',
    '- Do not commit these generated guide WAVs.',
    '- Record dry vocal WAVs into `../wavs/` using the exact filenames from `../cue-sheet.csv`.',
    '- Trim count-in silence before running `npm run neural:audit-recordings`.',
    '- Keep mic, room, gain, and singer distance consistent across the whole session.',
    '',
    `Generated takes: ${manifest.totals.takeCount}`,
    `Count-in beats: ${manifest.settings.countInBeats}`,
    '',
  ].join('\n')
}

function parseTakeFilter(value) {
  if (!value) {
    return null
  }
  return new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))
}

function integerNumber(value, fallback) {
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback
}

function positiveNumber(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
}

function roundMetric(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pack-dir') {
      parsed.packDir = argv[++index]
    } else if (arg === '--session') {
      parsed.session = argv[++index]
    } else if (arg === '--out-dir') {
      parsed.outDir = argv[++index]
    } else if (arg === '--takes') {
      parsed.takes = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--sample-rate') {
      parsed.sampleRate = Number(argv[++index])
    } else if (arg === '--count-in-beats') {
      parsed.countInBeats = Number(argv[++index])
    } else if (arg === '--tail-seconds') {
      parsed.tailSeconds = Number(argv[++index])
    } else if (arg === '--guide-gain') {
      parsed.guideGain = Number(argv[++index])
    } else if (arg === '--click-gain') {
      parsed.clickGain = Number(argv[++index])
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-private-singer-guide-tracks.mjs [options]',
          '',
          'Options:',
          `  --pack-dir path       Recording pack dir, default ${DEFAULT_PACK_DIR}`,
          '  --session path        recording-session.json path',
          '  --out-dir path        Guide output dir, default <pack-dir>/guides',
          '  --takes id,id         Generate only selected take ids',
          '  --report path         Write guide manifest JSON path',
          `  --sample-rate n       Guide WAV sample rate, default ${DEFAULT_SAMPLE_RATE}`,
          `  --count-in-beats n    Count-in beats before vocal start, default ${DEFAULT_COUNT_IN_BEATS}`,
          `  --tail-seconds n      Tail after vocal guide, default ${DEFAULT_TAIL_SECONDS}`,
          `  --guide-gain n        Pitch guide gain, default ${DEFAULT_GUIDE_GAIN}`,
          `  --click-gain n        Click gain, default ${DEFAULT_CLICK_GAIN}`,
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
    const report = preparePrivateSingerGuideTracks(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
