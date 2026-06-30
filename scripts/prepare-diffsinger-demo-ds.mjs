#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_OUT = 'experiments/neural-singer/work/csd-diffsinger-smoke/demo-do-hi-do-hi.ds'
const DEFAULT_DICTIONARY = 'experiments/neural-singer/work/csd-diffsinger-smoke/dictionary-ko.txt'
const DEFAULT_TIMESTEP = 0.005

const DEFAULT_SEGMENT = {
  offset: 0,
  text: 'SP 도 히 도 히 다 이 스 키 SP',
  ph_seq: 'SP d o h i d o h i d ɐ i sʰ u k i SP',
  ph_dur: '0.08 0.05 0.25 0.05 0.25 0.05 0.25 0.05 0.25 0.05 0.25 0.30 0.08 0.22 0.06 0.34 0.20',
  ph_num: '1 2 2 2 2 2 1 2 2 1',
  note_seq: 'rest C4 D4 C4 D4 E4 E4 F4 G4 rest',
  note_dur: '0.08 0.30 0.30 0.30 0.30 0.30 0.30 0.30 0.40 0.20',
  note_slur: '0 0 0 0 0 0 0 0 0 0',
}

export function prepareDiffSingerDemoDs(options = {}) {
  const out = resolve(options.out ?? DEFAULT_OUT)
  const dictionary = options.dictionary === false ? null : resolve(options.dictionary ?? DEFAULT_DICTIONARY)
  const timestep = Number(options.timestep ?? DEFAULT_TIMESTEP)
  const segment = {
    ...DEFAULT_SEGMENT,
    f0_seq: makeF0Sequence(timestep),
    f0_timestep: String(timestep),
  }

  validateSegment(segment)
  if (dictionary) {
    assertDictionaryCoversPhones(dictionary, segment.ph_seq.split(/\s+/u))
  }

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify([segment], null, 2)}\n`)
  return {
    out,
    dictionary,
    timestep,
    text: segment.text,
    phoneCount: segment.ph_seq.split(/\s+/u).length,
    durationSeconds: sumNumbers(segment.ph_dur),
    f0FrameCount: segment.f0_seq.split(/\s+/u).length,
  }
}

function makeF0Sequence(timestep) {
  const phoneDurations = DEFAULT_SEGMENT.ph_dur.split(/\s+/u).map(Number)
  const syllableFrequencies = [
    0,
    midiToHz(60),
    midiToHz(62),
    midiToHz(60),
    midiToHz(62),
    midiToHz(64),
    midiToHz(64),
    midiToHz(65),
    midiToHz(67),
    0,
  ]
  const phNum = DEFAULT_SEGMENT.ph_num.split(/\s+/u).map(Number)
  const phoneFrequencies = []
  for (let syllableIndex = 0; syllableIndex < phNum.length; syllableIndex += 1) {
    for (let index = 0; index < phNum[syllableIndex]; index += 1) {
      phoneFrequencies.push(syllableFrequencies[syllableIndex])
    }
  }
  if (phoneFrequencies.length !== phoneDurations.length) {
    throw new Error('Internal demo phrase mismatch between ph_num and ph_dur.')
  }

  const frames = []
  for (let index = 0; index < phoneDurations.length; index += 1) {
    const frameCount = Math.max(1, Math.round(phoneDurations[index] / timestep))
    for (let frame = 0; frame < frameCount; frame += 1) {
      frames.push(phoneFrequencies[index].toFixed(2))
    }
  }
  return frames.join(' ')
}

function validateSegment(segment) {
  const phSeq = segment.ph_seq.split(/\s+/u)
  const phDur = segment.ph_dur.split(/\s+/u).map(Number)
  const phNumTotal = sumNumbers(segment.ph_num)
  const noteSeq = segment.note_seq.split(/\s+/u)
  const noteDur = segment.note_dur.split(/\s+/u).map(Number)
  const noteSlur = segment.note_slur.split(/\s+/u)
  if (phSeq.length !== phDur.length) {
    throw new Error(`ph_seq/ph_dur mismatch: ${phSeq.length} vs ${phDur.length}`)
  }
  if (phSeq.length !== phNumTotal) {
    throw new Error(`ph_num does not sum to ph_seq length: ${phNumTotal} vs ${phSeq.length}`)
  }
  if (noteSeq.length !== noteDur.length || noteSeq.length !== noteSlur.length) {
    throw new Error('note_seq, note_dur, and note_slur must have matching lengths.')
  }
}

function assertDictionaryCoversPhones(dictionary, phones) {
  if (!existsSync(dictionary)) {
    throw new Error(`Missing DiffSinger dictionary: ${dictionary}`)
  }
  const inventory = new Set(['AP', 'SP'])
  for (const rawLine of readFileSync(dictionary, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const [, phoneText] = line.split('\t')
    for (const phone of phoneText.trim().split(/\s+/u)) {
      inventory.add(phone)
    }
  }
  const missing = [...new Set(phones.filter((phone) => !inventory.has(phone)))]
  if (missing.length > 0) {
    throw new Error(`Demo DS uses phones missing from dictionary: ${missing.join(', ')}`)
  }
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function sumNumbers(value) {
  const numbers = Array.isArray(value) ? value : String(value).split(/\s+/u)
  return numbers.reduce((sum, item) => sum + Number(item), 0)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--dictionary') {
      parsed.dictionary = argv[++index]
    } else if (arg === '--no-dictionary-check') {
      parsed.dictionary = false
    } else if (arg === '--timestep') {
      parsed.timestep = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-diffsinger-demo-ds.mjs [options]',
          '',
          'Options:',
          `  --out path          Output .ds file, default ${DEFAULT_OUT}`,
          `  --dictionary path   Compact DiffSinger dictionary, default ${DEFAULT_DICTIONARY}`,
          '  --no-dictionary-check',
          '                      Skip dictionary inventory validation',
          `  --timestep seconds  F0 timestep, default ${DEFAULT_TIMESTEP}`,
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
    const result = prepareDiffSingerDemoDs(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
