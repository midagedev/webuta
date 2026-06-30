#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PROMPTS = 'experiments/neural-singer/private-singer-prompts.ko.json'
const DEFAULT_OUT = 'experiments/neural-singer/datasets/original-private-singer'
const DEFAULT_TARGET_MINUTES = 35
const DEFAULT_SESSION_ID = 'ops-001'
const DEFAULT_SINGER_ID = 'private-singer'
const DEFAULT_REST_SECONDS = 2
const TICKS_PER_BEAT = 480
const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const VOWEL_COUNT = 21
const CODA_COUNT = 28
const NOTE_OFFSETS = {
  c: 0,
  'c#': 1,
  db: 1,
  d: 2,
  'd#': 3,
  eb: 3,
  e: 4,
  f: 5,
  'f#': 6,
  gb: 6,
  g: 7,
  'g#': 8,
  ab: 8,
  a: 9,
  'a#': 10,
  bb: 10,
  b: 11,
}
const MELODY_OFFSETS = [0, 2, 4, 7, 9, 7, 4, 2, 0, 2, 5, 4]
const ONSET_SYMBOLS = [
  'g',
  'kk',
  'n',
  'd',
  'tt',
  'r',
  'm',
  'b',
  'pp',
  's',
  'ss',
  '',
  'j',
  'jj',
  'ch',
  'k',
  't',
  'p',
  'h',
]
const VOWEL_SYMBOLS = [
  'a',
  'ae',
  'ya',
  'yae',
  'eo',
  'e',
  'yeo',
  'ye',
  'o',
  'wa',
  'wae',
  'oe',
  'yo',
  'u',
  'wo',
  'we',
  'wi',
  'yu',
  'eu',
  'ui',
  'i',
]
const CODA_SYMBOLS = [
  '',
  'g',
  'kk',
  'gs',
  'n',
  'nj',
  'nh',
  'd',
  'r',
  'rg',
  'rm',
  'rb',
  'rs',
  'rt',
  'rp',
  'rh',
  'm',
  'b',
  'bs',
  's',
  'ss',
  'ng',
  'j',
  'ch',
  'k',
  't',
  'p',
  'h',
]

export function preparePrivateSingerRecordingPack(options = {}) {
  const promptPath = resolve(options.prompts ?? DEFAULT_PROMPTS)
  const outDir = resolve(options.out ?? DEFAULT_OUT)
  const registryOut = resolve(options.registryOut ?? join(outDir, 'dataset-registry.local-template.json'))
  const targetMinutes = positiveNumber(options.targetMinutes, DEFAULT_TARGET_MINUTES)
  const restSeconds = positiveNumber(options.restSeconds, DEFAULT_REST_SECONDS)
  const sessionId = sanitizeId(options.sessionId ?? DEFAULT_SESSION_ID)
  const singerId = sanitizeId(options.singerId ?? DEFAULT_SINGER_ID)
  const allowLocalTraining = options.allowLocalTraining === true
  const promptBook = JSON.parse(readFileSync(promptPath, 'utf8'))
  const takes = expandPromptBook(promptBook, { targetMinutes, restSeconds, sessionId })
  const generatedAt = new Date().toISOString()

  mkdirSync(join(outDir, 'lyrics'), { recursive: true })
  mkdirSync(join(outDir, 'wavs'), { recursive: true })
  mkdirSync(join(outDir, 'scores'), { recursive: true })
  mkdirSync(join(outDir, 'requests'), { recursive: true })
  mkdirSync(dirname(registryOut), { recursive: true })

  for (const take of takes) {
    const project = buildTakeProject(take)
    const request = buildNeuralRequest(project)
    writeFileSync(join(outDir, 'lyrics', `${take.id}.txt`), `${take.lyric}\n`)
    writeFileSync(join(outDir, 'wavs', `${take.id}.txt`), `${take.lyric}\n`)
    writeFileSync(join(outDir, 'scores', `${take.id}.ustx.json`), `${JSON.stringify(toUstxJson(project), null, 2)}\n`)
    writeFileSync(join(outDir, 'requests', `${take.id}.neural-request.json`), `${JSON.stringify(request, null, 2)}\n`)
  }

  const sessionPlan = {
    version: 1,
    generatedAt,
    promptPath,
    sessionId,
    singerId,
    targetMinutes,
    restSeconds,
    recommendedRecording: {
      format: 'wav',
      sampleRate: 48000,
      bitDepth: 24,
      channels: 'mono preferred, stereo accepted before ingest',
      room: 'quiet, dry room; keep the mic distance and gain fixed for the whole session',
    },
    totals: summarizeTakes(takes),
    takes,
  }
  writeFileSync(join(outDir, 'recording-session.json'), `${JSON.stringify(sessionPlan, null, 2)}\n`)
  writeFileSync(join(outDir, 'cue-sheet.csv'), cueSheetCsv(takes))
  writeFileSync(join(outDir, 'README.md'), readmeForPack(sessionPlan, outDir, registryOut))
  writeFileSync(join(outDir, 'consent-form.template.md'), consentTemplate({ singerId, sessionId }))
  writeFileSync(join(outDir, 'wavs', 'README.md'), wavsReadme())

  const registry = {
    version: 1,
    notes: 'Private local registry template generated for consent-based original singer recording. Keep private singer identity and signed consent outside git.',
    datasets: [
      {
        id: 'original-private-singer',
        name: 'Original private Korean singer recording',
        sourceUrl: null,
        localPath: outDir,
        licenseStatus: allowLocalTraining ? 'original-consent-reviewed-local-training' : 'consent-required-before-training',
        redistribution: 'private-until-written-release',
        modelPublishing: 'requires-separate-written-release',
        singerIdentity: 'private',
        language: ['ko'],
        audioHours: 0,
        annotationTypes: ['audio', 'lyrics', 'score-cue-sheet', 'consent'],
        consent: {
          requiresSignedConsent: true,
          templatePath: join(outDir, 'consent-form.template.md'),
          signedConsentPath: join(outDir, 'consent-form.signed.local.md'),
          localTrainingScope: 'Local WebUtau Korean neural singer training only.',
          publicReleaseScope: 'Public model release and public audio examples require a separate written release.',
        },
        allowedActions: {
          localTraining: allowLocalTraining,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        reviewNotes: allowLocalTraining
          ? [
              'Local training was explicitly enabled when generating this template. Keep signed consent outside git.',
              'Public model release and public audio examples still require a separate release review.',
            ]
          : [
              'Do not ingest or train until the singer consent and model usage scope are signed.',
              'Copy this registry to a private path and change allowedActions.localTraining only after consent review.',
            ],
      },
    ],
  }
  writeFileSync(registryOut, `${JSON.stringify(registry, null, 2)}\n`)

  return {
    outDir,
    registryOut,
    promptPath,
    sessionId,
    singerId,
    allowLocalTraining,
    totals: sessionPlan.totals,
  }
}

function expandPromptBook(promptBook, { targetMinutes, restSeconds, sessionId }) {
  const base = []
  const defaults = promptBook.defaults ?? {}
  for (const set of promptBook.sets ?? []) {
    const repeats = Math.max(1, Math.round(set.repeats ?? 1))
    for (const prompt of set.prompts ?? []) {
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        base.push({
          setId: set.id,
          promptId: prompt.id,
          lyric: prompt.lyric,
          tempo: prompt.tempo ?? set.tempo ?? defaults.tempo ?? 96,
          estimatedSeconds: positiveNumber(prompt.estimatedSeconds ?? set.estimatedSeconds, defaults.estimatedSeconds ?? 7.5),
          keys: nonEmptyArray(prompt.keys) ?? nonEmptyArray(set.keys) ?? nonEmptyArray(defaults.keys) ?? ['C4'],
          tags: [...(set.tags ?? []), ...(prompt.tags ?? [])],
          notes: prompt.notes ?? '',
        })
      }
    }
  }
  if (base.length === 0) {
    throw new Error('Prompt book must contain at least one prompt.')
  }

  const takes = []
  const targetSeconds = targetMinutes * 60
  let totalSeconds = 0
  let cycle = 0
  while (totalSeconds < targetSeconds) {
    for (const prompt of base) {
      const takeNumber = takes.length + 1
      const key = prompt.keys[(cycle + takeNumber - 1) % prompt.keys.length]
      const estimatedSeconds = prompt.estimatedSeconds + restSeconds
      takes.push({
        id: `${sessionId}-${String(takeNumber).padStart(4, '0')}-${sanitizeId(prompt.promptId)}`,
        takeNumber,
        setId: prompt.setId,
        promptId: prompt.promptId,
        key,
        tempo: prompt.tempo,
        lyric: prompt.lyric,
        tags: [...new Set(prompt.tags)].sort(),
        singingSeconds: prompt.estimatedSeconds,
        restSeconds,
        estimatedSeconds,
        lyricPath: `lyrics/${sessionId}-${String(takeNumber).padStart(4, '0')}-${sanitizeId(prompt.promptId)}.txt`,
        wavPath: `wavs/${sessionId}-${String(takeNumber).padStart(4, '0')}-${sanitizeId(prompt.promptId)}.wav`,
        scorePath: `scores/${sessionId}-${String(takeNumber).padStart(4, '0')}-${sanitizeId(prompt.promptId)}.ustx.json`,
        neuralRequestPath: `requests/${sessionId}-${String(takeNumber).padStart(4, '0')}-${sanitizeId(prompt.promptId)}.neural-request.json`,
        notes: prompt.notes,
      })
      totalSeconds += estimatedSeconds
      if (totalSeconds >= targetSeconds) {
        break
      }
    }
    cycle += 1
  }
  return takes
}

function summarizeTakes(takes) {
  const totalEstimatedSeconds = takes.reduce((sum, take) => sum + take.estimatedSeconds, 0)
  return {
    takeCount: takes.length,
    totalEstimatedSeconds,
    totalEstimatedMinutes: totalEstimatedSeconds / 60,
    uniquePrompts: new Set(takes.map((take) => take.promptId)).size,
    uniqueTags: [...new Set(takes.flatMap((take) => take.tags))].sort(),
  }
}

function cueSheetCsv(takes) {
  const rows = [
    [
      'takeNumber',
      'takeId',
      'setId',
      'promptId',
      'key',
      'tempo',
      'estimatedSeconds',
      'lyric',
      'wavPath',
      'lyricPath',
      'scorePath',
      'neuralRequestPath',
      'tags',
      'notes',
    ],
    ...takes.map((take) => [
      take.takeNumber,
      take.id,
      take.setId,
      take.promptId,
      take.key,
      take.tempo,
      take.estimatedSeconds,
      take.lyric,
      take.wavPath,
      take.lyricPath,
      take.scorePath,
      take.neuralRequestPath,
      take.tags.join('|'),
      take.notes,
    ]),
  ]
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function readmeForPack(sessionPlan, outDir, registryOut) {
  return [
    '# Original Private Singer Recording Pack',
    '',
    'This folder is an ignored local capture kit for a consent-based Korean neural singer dataset.',
    '',
    '## Before Recording',
    '',
    '- Copy `consent-form.template.md` to `consent-form.signed.local.md`, fill the signature fields, and keep the signed copy outside git.',
    '- Record one WAV per cue in `cue-sheet.csv`.',
    '- Save each WAV with the exact file name shown in the `wavPath` column.',
    '- Use the matching `scores/*.ustx.json` or `requests/*.neural-request.json` as the pitch and timing guide.',
    '- Keep mic, room, gain, and distance consistent for the whole session.',
    '- Record clean singing, not copyrighted song lyrics.',
    '',
    'Generate headphone pitch/click guides before recording:',
    '',
    '```sh',
    'npm run neural:audit-prompt-coverage -- \\',
    `  --pack-dir ${relativePath(outDir)} \\`,
    '  --report experiments/neural-singer/work/original-private-singer-prompt-coverage.json',
    '```',
    '',
    'The prompt coverage audit should pass before recording; it checks Korean',
    'onset/vowel/batchim coverage, key balance, score request coverage, and pitch',
    'range.',
    '',
    '```sh',
    'npm run neural:prepare-guides -- \\',
    `  --pack-dir ${relativePath(outDir)}`,
    '```',
    '',
    'Start the local browser recorder when the guide WAVs are ready:',
    '',
    '```sh',
    'npm run neural:serve-recorder -- \\',
    `  --pack-dir ${relativePath(outDir)}`,
    '```',
    '',
    'Open the printed localhost URL, play the guide through headphones, and save',
    'each dry vocal take directly into `wavs/` with the expected filename.',
    '',
    'Use `guides/*.guide.wav` only for monitoring. Do not train on guide tracks,',
    'and trim any count-in before auditing recorded vocal WAVs.',
    '',
    '## After Recording',
    '',
    'Audit recorded takes first and use the generated failed-take CSV as the re-recording queue:',
    '',
    '```sh',
    'npm run neural:audit-recordings -- \\',
    `  --pack-dir ${relativePath(outDir)} \\`,
    '  --report experiments/neural-singer/work/original-private-singer-recording-audit.json \\',
    '  --review-csv experiments/neural-singer/work/original-private-singer-recording-review.csv',
    '```',
    '',
    'Use the generated private registry template only after consent review. The',
    'dataset audit blocks `localTraining=true` until `consent-form.signed.local.md`',
    'has `Singer signature:`, `Date:`, and `Reviewer:` filled:',
    '',
    '```sh',
    `npm run neural:audit-datasets -- --registry ${relativePath(registryOut)}`,
    'npm run neural:ingest-dataset -- \\',
    `  --registry ${relativePath(registryOut)} \\`,
    '  --dataset original-private-singer \\',
    '  --out experiments/neural-singer/work/original-private-singer-ingest',
    '```',
    '',
    'Generated summary:',
    '',
    `- Session id: ${sessionPlan.sessionId}`,
    `- Singer id: ${sessionPlan.singerId}`,
    `- Takes: ${sessionPlan.totals.takeCount}`,
    `- Estimated minutes including rest: ${sessionPlan.totals.totalEstimatedMinutes.toFixed(1)}`,
    '',
  ].join('\n')
}

function consentTemplate({ singerId, sessionId }) {
  return [
    '# WebUtau Private Singer Consent Template',
    '',
    `Singer id: ${singerId}`,
    `Recording session id: ${sessionId}`,
    '',
    'This template is not legal advice. Review it before relying on it.',
    '',
    '## Scope To Fill In',
    '',
    '- The singer allows these original recordings to be used for local WebUtau Korean neural singer training.',
    '- The singer understands that model outputs may resemble their singing voice.',
    '- Public model release is not allowed unless a separate release is signed.',
    '- Public audio examples are not allowed unless a separate release is signed.',
    '- The singer may request that private identity metadata stay outside git and public artifacts.',
    '',
    'Singer signature:',
    '',
    'Date:',
    '',
    'Reviewer:',
    '',
  ].join('\n')
}

function wavsReadme() {
  return [
    '# WAV Drop Folder',
    '',
    'Place recorded WAV files here using the exact basename from `../cue-sheet.csv`.',
    '',
    'For each cue, a matching `.txt` sidecar has already been generated here so',
    '`npm run neural:ingest-dataset` can read lyrics without extra annotation work.',
    '',
  ].join('\n')
}

function buildTakeProject(take) {
  const trackId = 'track-main'
  const partId = 'part-main'
  const tokens = tokenizeLyric(take.lyric)
  const baseMidi = midiForKey(take.key)
  const noteDuration = Math.max(120, secondsToTicks(take.singingSeconds / Math.max(1, tokens.length), take.tempo))
  const notes = tokens.map((lyric, index) => ({
    id: `n${index + 1}`,
    trackId,
    partId,
    start: index * noteDuration,
    duration: noteDuration,
    tone: clampMidi(baseMidi + MELODY_OFFSETS[index % MELODY_OFFSETS.length]),
    lyric,
  }))
  const duration = notes.reduce((max, note) => Math.max(max, note.start + note.duration), TICKS_PER_BEAT)
  return {
    id: take.id,
    name: `Recording Guide ${take.id}`,
    comment: `Private singer recording guide for ${take.lyric}`,
    bpm: take.tempo,
    beatPerBar: 4,
    beatUnit: 4,
    tracks: [
      {
        id: trackId,
        name: 'Guide Vocal',
        color: 'Coral',
        singer: 'Private Singer Guide',
        phonemizer: 'hangul neural guide',
      },
    ],
    parts: [
      {
        id: partId,
        trackId,
        name: take.promptId,
        start: 0,
        duration,
      },
    ],
    notes,
    source: {
      fileName: `${take.id}.ustx.json`,
      format: 'webuta',
    },
  }
}

function toUstxJson(project) {
  return {
    name: project.name,
    comment: project.comment,
    output_dir: 'Vocal',
    cache_dir: 'UCache',
    ustx_version: '0.9',
    time_signatures: [
      {
        bar_position: 0,
        beat_per_bar: project.beatPerBar,
        beat_unit: project.beatUnit,
      },
    ],
    tempos: [
      {
        position: 0,
        bpm: project.bpm,
      },
    ],
    tracks: project.tracks.map((track) => ({
      singer: track.singer ?? '',
      phonemizer: track.phonemizer ?? '',
      track_name: track.name,
      track_color: track.color,
      mute: false,
      solo: false,
      volume: 0,
      pan: 0,
    })),
    voice_parts: project.parts.map((part) => ({
      name: part.name,
      comment: '',
      track_no: 0,
      position: part.start,
      duration: part.duration,
      notes: project.notes.map((note) => ({
        position: note.start - part.start,
        duration: note.duration,
        tone: note.tone,
        lyric: note.lyric,
      })),
      curves: [],
    })),
    wave_parts: [],
  }
}

function buildNeuralRequest(project) {
  return {
    version: 1,
    project: {
      id: project.id,
      title: project.name,
      bpm: project.bpm,
      timebase: TICKS_PER_BEAT,
    },
    voice: {
      id: 'webuta-ko-private-guide',
      language: 'ko',
      renderer: 'diffsinger',
    },
    render: {
      sampleRate: 44100,
      format: 'wav',
      includeDiagnostics: true,
    },
    notes: project.notes.map((note) => ({
      kind: 'note',
      id: note.id,
      trackId: note.trackId,
      partId: note.partId,
      startTick: note.start,
      durationTick: note.duration,
      startSeconds: ticksToSeconds(note.start, project.bpm),
      durationSeconds: ticksToSeconds(note.duration, project.bpm),
      midi: note.tone,
      targetHz: midiToHz(note.tone),
      lyric: note.lyric,
      phonemes: phonemesForLyric(note.lyric),
      pitchCurve: [],
    })),
  }
}

function tokenizeLyric(lyric) {
  const tokens = []
  let latin = ''
  const flushLatin = () => {
    if (latin) {
      tokens.push(latin)
      latin = ''
    }
  }
  for (const char of Array.from(lyric.trim())) {
    const code = char.codePointAt(0) ?? 0
    if (/\s/u.test(char)) {
      flushLatin()
    } else if (code >= HANGUL_BASE && code <= HANGUL_END) {
      flushLatin()
      tokens.push(char)
    } else if (/[A-Za-z0-9]/u.test(char)) {
      latin += char
    } else if (/[가-힣ぁ-ゟ゠-ヿ]/u.test(char)) {
      flushLatin()
      tokens.push(char)
    } else {
      flushLatin()
    }
  }
  flushLatin()
  return tokens.length > 0 ? tokens : ['라']
}

function phonemesForLyric(lyric) {
  const phonemes = Array.from(lyric.trim()).flatMap((char) => phonemesForCharacter(char))
  return distributeRatios(phonemes.length > 0 ? phonemes : [{ symbol: 'a', role: 'vowel', source: lyric, startRatio: 0, endRatio: 1 }])
}

function phonemesForCharacter(char) {
  const code = char.codePointAt(0) ?? 0
  if (code < HANGUL_BASE || code > HANGUL_END) {
    return [{ symbol: char, role: 'literal', source: char, startRatio: 0, endRatio: 1 }]
  }

  const offset = code - HANGUL_BASE
  const onsetIndex = Math.floor(offset / (VOWEL_COUNT * CODA_COUNT))
  const vowelIndex = Math.floor((offset % (VOWEL_COUNT * CODA_COUNT)) / CODA_COUNT)
  const codaIndex = offset % CODA_COUNT
  const result = []
  const onset = ONSET_SYMBOLS[onsetIndex] ?? ''
  const vowel = VOWEL_SYMBOLS[vowelIndex] ?? ''
  const coda = CODA_SYMBOLS[codaIndex] ?? ''
  if (onset) {
    result.push({ symbol: onset, role: 'onset', source: char, startRatio: 0, endRatio: 0 })
  }
  result.push({ symbol: vowel, role: 'vowel', source: char, startRatio: 0, endRatio: 0 })
  if (coda) {
    result.push({ symbol: coda, role: 'coda', source: char, startRatio: 0, endRatio: 0 })
  }
  return result
}

function distributeRatios(phonemes) {
  const weights = phonemes.map((phoneme) => (phoneme.role === 'vowel' ? 4 : phoneme.role === 'coda' ? 1.2 : 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  return phonemes.map((phoneme, index) => {
    const startRatio = cursor / total
    cursor += weights[index]
    return {
      ...phoneme,
      startRatio,
      endRatio: cursor / total,
    }
  })
}

function midiForKey(key) {
  const match = /^([a-gA-G])([#b]?)(-?\d+)$/u.exec(String(key).trim())
  if (!match) {
    return 60
  }
  const note = `${match[1].toLowerCase()}${match[2].toLowerCase()}`
  const octave = Number(match[3])
  return (octave + 1) * 12 + (NOTE_OFFSETS[note] ?? 0)
}

function midiToHz(tone) {
  return 440 * 2 ** ((tone - 69) / 12)
}

function secondsToTicks(seconds, bpm) {
  return Math.round((seconds / 60) * bpm * TICKS_PER_BEAT)
}

function ticksToSeconds(ticks, bpm) {
  return (ticks / TICKS_PER_BEAT) * (60 / bpm)
}

function clampMidi(tone) {
  return Math.min(84, Math.max(48, Math.round(tone)))
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--prompts') {
      parsed.prompts = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--registry-out') {
      parsed.registryOut = argv[++index]
    } else if (arg === '--target-minutes') {
      parsed.targetMinutes = Number(argv[++index])
    } else if (arg === '--rest-seconds') {
      parsed.restSeconds = Number(argv[++index])
    } else if (arg === '--session-id') {
      parsed.sessionId = argv[++index]
    } else if (arg === '--singer-id') {
      parsed.singerId = argv[++index]
    } else if (arg === '--allow-local-training') {
      parsed.allowLocalTraining = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-private-singer-recording-pack.mjs [options]',
          '',
          'Options:',
          `  --prompts path              Prompt JSON, default ${DEFAULT_PROMPTS}`,
          `  --out path                  Output capture folder, default ${DEFAULT_OUT}`,
          '  --registry-out path         Private registry template path',
          `  --target-minutes minutes    Target session length, default ${DEFAULT_TARGET_MINUTES}`,
          `  --rest-seconds seconds      Rest counted per cue, default ${DEFAULT_REST_SECONDS}`,
          `  --session-id id             Session id, default ${DEFAULT_SESSION_ID}`,
          `  --singer-id id              Non-identifying singer id, default ${DEFAULT_SINGER_ID}`,
          '  --allow-local-training      Mark generated registry as locally trainable after consent review',
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

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0 ? value : null
}

function sanitizeId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'item'
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function relativePath(path) {
  return path.startsWith(process.cwd()) ? path.slice(process.cwd().length + 1) : path
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = preparePrivateSingerRecordingPack(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
