#!/usr/bin/env node

const DEFAULT_F0_TIMESTEP = 0.005
const DEFAULT_VARIANCE_TIMESTEP = 0.005
const DEFAULT_NOTE_ENERGY_DB = -24
const DEFAULT_NOTE_VOICING_DB = -18
const DEFAULT_SILENCE_DB = -96
const CONTINUANT_CODA_PHONES = new Set(['n', 'm', 'ŋ', 'ɭ'])
const DEFAULT_PHONE_MAP = {
  a: 'ɐ',
  ae: 'ɛː',
  eo: 'ʌ',
  eu: 'u',
  g: 'k',
  kk: 'k͈',
  ng: 'ŋ',
  s: 'sʰ',
  ss: 'sʰ',
  ch: 'tɕʰ',
  k: 'kʰ',
  p: 'p',
  t: 't',
  d: 'd',
  h: 'h',
  i: 'i',
  m: 'm',
  n: 'n',
  o: 'o',
  r: 'ɾ',
  u: 'u',
  ya: 'j ɐ',
  yeo: 'j ʌ',
  yo: 'j o',
  yu: 'j u',
  wa: 'w ɐ',
  wi: 'ɥ i',
  ui: 'ɨ i',
  b: 'p',
  j: 'tɕ',
}

const CODA_PHONE_MAP = {
  g: 'k̚',
  kk: 'k̚',
  gs: 'k̚ sʰ',
  n: 'n',
  nj: 'n tɕ',
  nh: 'n h',
  d: 't̚',
  r: 'ɭ',
  rg: 'ɭ k̚',
  rm: 'ɭ m',
  rb: 'ɭ p',
  rs: 'ɭ sʰ',
  rt: 'ɭ t̚',
  rp: 'ɭ p',
  rh: 'ɭ h',
  m: 'm',
  b: 'p̚',
  bs: 'p̚ sʰ',
  s: 't̚',
  ss: 't̚',
  ng: 'ŋ',
  j: 't̚',
  ch: 't̚',
  k: 'k̚',
  t: 't̚',
  p: 'p̚',
  h: 't̚',
}

export function neuralRequestToDiffSingerDs(request, options = {}) {
  validateRequest(request)
  const f0Timestep = Number(options.f0Timestep ?? DEFAULT_F0_TIMESTEP)
  const varianceTimestep = Number(options.varianceTimestep ?? DEFAULT_VARIANCE_TIMESTEP)
  const warnings = []
  const phoneMap = { ...DEFAULT_PHONE_MAP, ...(options.phoneMap ?? {}) }
  const codaPhoneMap = { ...CODA_PHONE_MAP, ...(options.codaPhoneMap ?? {}) }
  const events = normalizedEvents(request, warnings)
  const phSeq = []
  const phDur = []
  const phNum = []
  const noteSeq = []
  const noteDur = []
  const noteSlur = []
  const f0Frames = []
  const energyFrames = []
  const voicingFrames = []
  const text = []

  for (const event of events) {
    const phoneUnits = phonesForEvent(event, { phoneMap, codaPhoneMap, warnings })
    const duration = Math.max(0.001, event.durationSeconds)
    phSeq.push(...phoneUnits.map((unit) => unit.phone))
    phDur.push(...allocatePhoneDurations(phoneUnits, duration))
    phNum.push(phoneUnits.length)
    noteSeq.push(event.kind === 'rest' ? 'rest' : midiToNoteName(event.midi))
    noteDur.push(duration)
    noteSlur.push(event.kind === 'tie' ? 1 : 0)
    text.push(event.kind === 'rest' ? 'SP' : event.lyric)
    appendF0Frames(f0Frames, event, duration, f0Timestep)
    appendVarianceFrames(energyFrames, event, duration, varianceTimestep, {
      noteValue: Number(options.noteEnergyDb ?? DEFAULT_NOTE_ENERGY_DB),
      silenceValue: Number(options.silenceEnergyDb ?? DEFAULT_SILENCE_DB),
    })
    appendVarianceFrames(voicingFrames, event, duration, varianceTimestep, {
      noteValue: Number(options.noteVoicingDb ?? DEFAULT_NOTE_VOICING_DB),
      silenceValue: Number(options.silenceVoicingDb ?? DEFAULT_SILENCE_DB),
    })
  }

  return {
    segments: [
      {
        offset: 0,
        text: text.join(' '),
        ph_seq: phSeq.join(' '),
        ph_dur: phDur.map(formatNumber).join(' '),
        ph_num: phNum.join(' '),
        note_seq: noteSeq.join(' '),
        note_dur: noteDur.map(formatNumber).join(' '),
        note_slur: noteSlur.join(' '),
        f0_seq: f0Frames.map(formatNumber).join(' '),
        f0_timestep: String(f0Timestep),
        energy: energyFrames.map(formatNumber).join(' '),
        energy_timestep: String(varianceTimestep),
        voicing: voicingFrames.map(formatNumber).join(' '),
        voicing_timestep: String(varianceTimestep),
      },
    ],
    diagnostics: {
      renderer: request.voice.renderer,
      modelId: request.voice.id,
      warnings,
      noteCount: request.notes.length,
      eventCount: events.length,
      phoneCount: phSeq.length,
      durationSeconds: noteDur.reduce((sum, duration) => sum + duration, 0),
    },
  }
}

function validateRequest(request) {
  if (!request || request.version !== 1) {
    throw Object.assign(new Error('Unsupported neural render request version.'), { code: 'invalid-score' })
  }
  if (request.voice?.language !== 'ko') {
    throw Object.assign(new Error(`Unsupported neural language: ${request.voice?.language ?? 'unknown'}`), {
      code: 'unsupported-language',
    })
  }
  if (!Array.isArray(request.notes) || request.notes.length === 0) {
    throw Object.assign(new Error('Neural render request has no notes.'), { code: 'invalid-score' })
  }
}

function normalizedEvents(request, warnings) {
  const result = []
  let cursor = 0
  for (const note of [...request.notes].sort((a, b) => a.startSeconds - b.startSeconds || a.durationSeconds - b.durationSeconds)) {
    if (note.startSeconds > cursor + 0.002) {
      result.push(restEvent(cursor, note.startSeconds - cursor))
    }
    if (note.kind === 'breath') {
      warnings.push(`Breath note ${note.id} is rendered as aspiration silence in the DiffSinger smoke adapter.`)
      result.push(restEvent(note.startSeconds, note.durationSeconds, 'AP'))
    } else if (note.kind === 'rest') {
      result.push(restEvent(note.startSeconds, note.durationSeconds))
    } else if (note.kind === 'note' || note.kind === 'tie') {
      result.push(note)
    }
    cursor = Math.max(cursor, note.startSeconds + note.durationSeconds)
  }
  return result
}

function restEvent(startSeconds, durationSeconds, lyric = 'SP') {
  return {
    kind: 'rest',
    id: `rest-${startSeconds}`,
    startSeconds,
    durationSeconds,
    midi: null,
    targetHz: null,
    lyric,
    phonemes: [{ symbol: lyric, role: 'silence', source: lyric, startRatio: 0, endRatio: 1 }],
    pitchCurve: [],
  }
}

function phonesForEvent(event, { phoneMap, codaPhoneMap, warnings }) {
  if (event.kind === 'rest') {
    return [phoneUnit(event.lyric === 'AP' ? 'AP' : 'SP', 'silence')]
  }
  if (event.kind === 'tie') {
    warnings.push(`Tie note ${event.id} is rendered as a vowel hold without a new consonant.`)
    return [phoneUnit('SP', 'silence')]
  }
  const phoneUnits = []
  for (const phoneme of event.phonemes ?? []) {
    if (phoneme.role === 'tie') {
      continue
    }
    if (phoneme.role === 'silence') {
      phoneUnits.push(phoneUnit('SP', 'silence'))
      continue
    }
    if (phoneme.role === 'breath') {
      phoneUnits.push(phoneUnit('AP', 'silence'))
      continue
    }
    const mapped = phoneme.role === 'coda' ? codaPhoneMap[phoneme.symbol] : phoneMap[phoneme.symbol]
    if (!mapped) {
      warnings.push(`Unsupported phoneme ${phoneme.symbol} from ${phoneme.source}; using SP placeholder.`)
      phoneUnits.push(phoneUnit('SP', 'silence'))
      continue
    }
    phoneUnits.push(...phoneUnitsForMappedPhoneme(mapped, phoneme.role))
  }
  if (phoneUnits.length === 0) {
    warnings.push(`Note ${event.id} produced no DiffSinger phones; using SP placeholder.`)
    return [phoneUnit('SP', 'silence')]
  }
  return phoneUnits
}

function phoneUnitsForMappedPhoneme(mapped, role) {
  const phones = mapped.split(/\s+/u).filter(Boolean)
  if (role === 'vowel') {
    return phones.map((phone, index) => phoneUnit(phone, index === phones.length - 1 ? 'vowel' : 'glide'))
  }
  return phones.map((phone) => phoneUnit(phone, role === 'coda' ? 'coda' : 'onset'))
}

function phoneUnit(phone, role) {
  return { phone, role }
}

function allocatePhoneDurations(phoneUnits, totalDuration) {
  if (phoneUnits.length <= 1) {
    return [totalDuration]
  }
  const sustainIndex = findSustainPhoneIndex(phoneUnits)
  const minimumSustain = Math.min(0.04, totalDuration * 0.5)
  const targets = phoneUnits.map((unit, index) => (index === sustainIndex ? 0 : targetShortPhoneDuration(unit, totalDuration)))
  const shortTotal = targets.reduce((sum, duration) => sum + duration, 0)
  const availableForShortPhones = Math.max(0, totalDuration - minimumSustain)
  const scale = shortTotal > availableForShortPhones && shortTotal > 0 ? availableForShortPhones / shortTotal : 1
  const durations = targets.map((duration, index) => (index === sustainIndex ? 0 : Math.max(0.001, duration * scale)))
  const used = durations.reduce((sum, duration) => sum + duration, 0)
  durations[sustainIndex] = Math.max(0.001, totalDuration - used)
  return durations
}

function findSustainPhoneIndex(phoneUnits) {
  for (let index = phoneUnits.length - 1; index >= 0; index -= 1) {
    if (phoneUnits[index].role === 'vowel') {
      return index
    }
  }
  for (let index = 0; index < phoneUnits.length; index += 1) {
    if (phoneUnits[index].role !== 'coda' && phoneUnits[index].role !== 'silence') {
      return index
    }
  }
  return phoneUnits.length - 1
}

function targetShortPhoneDuration(unit, totalDuration) {
  if (unit.role === 'coda') {
    const cap = CONTINUANT_CODA_PHONES.has(unit.phone) ? 0.055 : 0.042
    return Math.min(cap, totalDuration * 0.12)
  }
  if (unit.role === 'glide') {
    return Math.min(0.04, totalDuration * 0.12)
  }
  if (unit.role === 'onset') {
    return Math.min(0.055, totalDuration * 0.16)
  }
  return Math.min(0.08, totalDuration * 0.2)
}

function appendF0Frames(frames, event, duration, timestep) {
  const frameCount = Math.max(1, Math.round(duration / timestep))
  for (let index = 0; index < frameCount; index += 1) {
    const timeRatio = frameCount <= 1 ? 0 : index / (frameCount - 1)
    frames.push(event.targetHz ? event.targetHz * 2 ** (interpolateCents(event.pitchCurve ?? [], timeRatio) / 1200) : 0)
  }
}

function appendVarianceFrames(frames, event, duration, timestep, { noteValue, silenceValue }) {
  const frameCount = Math.max(1, Math.round(duration / timestep))
  const value = event.kind === 'rest' || event.midi === null || event.targetHz === null ? silenceValue : noteValue
  for (let index = 0; index < frameCount; index += 1) {
    frames.push(value)
  }
}

function interpolateCents(points, timeRatio) {
  if (points.length === 0) {
    return 0
  }
  const sorted = [...points].sort((a, b) => a.timeRatio - b.timeRatio)
  if (timeRatio <= sorted[0].timeRatio) {
    return sorted[0].cents
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const next = sorted[index]
    if (timeRatio <= next.timeRatio) {
      const local = (timeRatio - previous.timeRatio) / Math.max(0.0001, next.timeRatio - previous.timeRatio)
      return previous.cents + (next.cents - previous.cents) * local
    }
  }
  return sorted.at(-1).cents
}

function midiToNoteName(midi) {
  if (!Number.isFinite(midi)) {
    return 'rest'
  }
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return Number(value.toFixed(6)).toString()
}
