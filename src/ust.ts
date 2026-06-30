import { sanitizeOptionalNotePitchBend } from './pitchBend'
import { TICKS_PER_BEAT, type NotePitchBend, type NoteVibrato, type SongNote, type SongProject, type Track, type VoicePart } from './types'
import { makeId, normalizedTempoChanges, sanitizeFileName } from './music'
import { normalizeNoteVibrato, sanitizeOptionalNoteVibrato } from './vibrato'

type UstSection = {
  id: string
  fields: Map<string, string>
}

export function parseUst(text: string, fileName = 'project.ust'): SongProject {
  const sections = parseUstSections(text)
  const settings = sections.find((section) => section.id.toUpperCase() === 'SETTING')
  const noteSections = sections.filter((section) => /^\d+$/u.test(section.id)).sort((a, b) => Number(a.id) - Number(b.id))
  const firstNoteTempo = noteSections.map((section) => numberField(section, 'Tempo', NaN)).find(Number.isFinite)
  const bpm = numberField(settings, 'Tempo', firstNoteTempo ?? 120)
  const projectName = stringField(settings, 'ProjectName', fileName.replace(/\.[^.]+$/u, '') || 'Imported UST')
  const trackId = 'track-0'
  const partId = 'part-0'
  const singer = stringField(settings, 'VoiceDir', '')
  let cursor = 0
  const notes: SongNote[] = []
  const tempoChanges = [{ position: 0, bpm }]

  for (const [index, section] of noteSections.entries()) {
    const duration = Math.max(1, Math.round(numberField(section, 'Length', TICKS_PER_BEAT)))
    const lyric = stringField(section, 'Lyric', 'a')
    const tone = Math.round(numberField(section, 'NoteNum', 60))
    const sectionTempo = numberField(section, 'Tempo', NaN)
    if (Number.isFinite(sectionTempo) && sectionTempo > 0) {
      tempoChanges.push({ position: cursor, bpm: sectionTempo })
    }
    if (!isRestLyric(lyric)) {
      const vibrato = parseUstVibrato(stringField(section, 'VBR', ''))
      const pitchBend = parseUstPitchBend(section, duration)
      notes.push({
        id: `note-${index}`,
        trackId,
        partId,
        start: cursor,
        duration,
        tone,
        lyric,
        ...(vibrato ? { vibrato } : {}),
        ...(pitchBend ? { pitchBend } : {}),
      })
    }
    cursor += duration
  }

  const tracks: Track[] = [
    {
      id: trackId,
      name: stringField(settings, 'TrackName', 'Main Vocal'),
      color: 'Blue',
      singer,
      phonemizer: 'classic UTAU',
    },
  ]
  const parts: VoicePart[] = [
    {
      id: partId,
      trackId,
      name: 'UST Part',
      start: 0,
      duration: Math.max(cursor, TICKS_PER_BEAT * 4),
    },
  ]

  return {
    id: makeId('project'),
    name: projectName,
    comment: stringField(settings, 'Comment', ''),
    bpm,
    tempoChanges: dedupeTempoChanges(tempoChanges),
    beatPerBar: 4,
    beatUnit: 4,
    tracks,
    parts,
    notes,
    source: {
      fileName,
      format: 'ust',
    },
  }
}

export function serializeUst(project: SongProject) {
  const sections: string[] = [
    '[#VERSION]',
    'UST Version1.2',
    '[#SETTING]',
    `Tempo=${formatNumber(project.bpm, 2)}`,
    'Tracks=1',
    `ProjectName=${cleanUstValue(project.name)}`,
    `VoiceDir=${cleanUstValue(project.tracks[0]?.singer ?? '')}`,
    `OutFile=${sanitizeFileName(project.name)}.wav`,
    'CacheDir=UCache',
    'Tool1=',
    'Tool2=',
    'Mode2=True',
  ]
  const notes = [...project.notes].sort((a, b) => a.start - b.start || a.tone - b.tone)
  const tempos = normalizedTempoChanges(project)
  const tempoByPosition = new Map(tempos.map((tempo) => [tempo.position, tempo.bpm]))
  let cursor = 0
  let sectionIndex = 0

  function tempoAt(tick: number) {
    return tick === 0 ? undefined : tempoByPosition.get(tick)
  }

  function nextTempoPositionBefore(targetTick: number) {
    return tempos.find((tempo) => tempo.position > cursor && tempo.position < targetTick)?.position
  }

  function pushRestUntil(targetTick: number) {
    while (cursor < targetTick) {
      const nextTempoPosition = nextTempoPositionBefore(targetTick)
      const endTick = nextTempoPosition ?? targetTick
      pushNoteSection(sections, sectionIndex, {
        length: endTick - cursor,
        lyric: 'R',
        tone: 60,
        tempo: tempoAt(cursor),
      })
      sectionIndex += 1
      cursor = endTick
    }
  }

  for (const note of notes) {
    pushRestUntil(note.start)
    pushNoteSection(sections, sectionIndex, {
      length: note.duration,
      lyric: note.lyric,
      tone: note.tone,
      vibrato: note.vibrato,
      pitchBend: note.pitchBend,
      tempo: tempoAt(note.start),
    })
    sectionIndex += 1
    cursor = Math.max(cursor, note.start + note.duration)
  }

  sections.push('[#TRACKEND]')
  return `${sections.join('\r\n')}\r\n`
}

function parseUstSections(text: string) {
  const sections: UstSection[] = []
  let current: UstSection | null = null
  for (const rawLine of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trimEnd()
    if (!line) {
      continue
    }
    const sectionMatch = line.match(/^\[#(.+)\]$/u)
    if (sectionMatch) {
      current = {
        id: sectionMatch[1],
        fields: new Map(),
      }
      sections.push(current)
      continue
    }
    if (!current) {
      continue
    }
    const equals = line.indexOf('=')
    if (equals === -1) {
      current.fields.set(line, '')
    } else {
      current.fields.set(line.slice(0, equals), line.slice(equals + 1))
    }
  }
  return sections
}

function dedupeTempoChanges(tempoChanges: Array<{ position: number; bpm: number }>) {
  const byPosition = new Map<number, number>()
  for (const tempo of tempoChanges) {
    byPosition.set(Math.max(0, Math.round(tempo.position)), tempo.bpm)
  }
  return [...byPosition.entries()]
    .map(([position, bpm]) => ({ position, bpm }))
    .sort((a, b) => a.position - b.position)
}

function pushNoteSection(
  sections: string[],
  index: number,
  note: {
    length: number
    lyric: string
    tone: number
    vibrato?: NoteVibrato
    pitchBend?: NotePitchBend
    tempo?: number
  },
) {
  sections.push(`[#${String(index).padStart(4, '0')}]`)
  sections.push(`Length=${Math.max(1, Math.round(note.length))}`)
  sections.push(`Lyric=${cleanUstValue(note.lyric)}`)
  sections.push(`NoteNum=${Math.round(note.tone)}`)
  if (note.tempo !== undefined) {
    sections.push(`Tempo=${formatNumber(note.tempo, 2)}`)
  }
  sections.push('Intensity=100')
  sections.push('Modulation=0')
  if (note.vibrato) {
    sections.push(`VBR=${serializeUstVibrato(note.vibrato)}`)
  }
  if (note.pitchBend) {
    sections.push(...serializeUstPitchBend(note.pitchBend, note.length))
  }
}

function parseUstVibrato(value: string) {
  if (!value.trim()) {
    return undefined
  }
  const values = value.split(',').map((item) => Number(item.trim()))
  const lengthPercent = values[0]
  const periodMs = values[1]
  const depthCents = values[2]
  if (!Number.isFinite(lengthPercent) || !Number.isFinite(periodMs) || !Number.isFinite(depthCents)) {
    return undefined
  }
  return sanitizeOptionalNoteVibrato({
    enabled: depthCents > 0 && lengthPercent > 0,
    depthCents,
    rateHz: periodMs > 0 ? 1000 / periodMs : undefined,
    startPercent: 100 - lengthPercent,
  })
}

function serializeUstVibrato(vibrato: NoteVibrato) {
  const normalized = normalizeNoteVibrato(vibrato)
  const lengthPercent = Math.max(0, Math.min(100, Math.round(100 - normalized.startPercent)))
  const periodMs = Math.round(1000 / normalized.rateHz)
  const depthCents = normalized.enabled ? Math.round(normalized.depthCents) : 0
  return [lengthPercent, periodMs, depthCents, 10, 10, 0, 0].join(',')
}

function parseUstPitchBend(section: UstSection, duration: number) {
  const yValues = numberListField(section, 'PBY')
  if (yValues.length === 0) {
    return undefined
  }
  const pbs = numberListField(section, 'PBS')
  const widths = numberListField(section, 'PBW')
  const modes = stringListField(section, 'PBM')
  let cursor = Number.isFinite(pbs[0]) ? pbs[0] : 0
  const points = yValues.map((cents, index) => {
    if (index > 0) {
      cursor += Number.isFinite(widths[index - 1]) ? widths[index - 1] : 0
    }
    return {
      timePercent: duration > 0 ? (cursor / duration) * 100 : 0,
      cents,
    }
  })
  return sanitizeOptionalNotePitchBend({ points, modes })
}

function serializeUstPitchBend(pitchBend: NotePitchBend, length: number) {
  const normalized = sanitizeOptionalNotePitchBend(pitchBend)
  if (!normalized) {
    return []
  }
  const points = normalized.points
  const ticks = points.map((point) => Math.round((point.timePercent / 100) * Math.max(1, length)))
  const widths = ticks.slice(1).map((tick, index) => Math.max(0, tick - ticks[index]))
  const lines = [
    `PBS=${Math.max(0, ticks[0])},0`,
    `PBY=${points.map((point) => formatPitchBendNumber(point.cents)).join(',')}`,
  ]
  if (widths.length > 0) {
    const modes = normalized.modes ?? []
    lines.splice(1, 0, `PBW=${widths.join(',')}`)
    lines.push(`PBM=${widths.map((_, index) => cleanPitchBendMode(modes[index] ?? 's')).join(',')}`)
  }
  return lines
}

function stringField(section: UstSection | undefined, key: string, fallback = '') {
  const value = section?.fields.get(key)
  return value === undefined ? fallback : value
}

function numberField(section: UstSection | undefined, key: string, fallback: number) {
  const value = section?.fields.get(key)
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function numberListField(section: UstSection | undefined, key: string) {
  return (section?.fields.get(key) ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite)
}

function stringListField(section: UstSection | undefined, key: string) {
  return (section?.fields.get(key) ?? '').split(',').map((item) => item.trim())
}

function isRestLyric(lyric: string) {
  const trimmed = lyric.trim()
  return !trimmed || trimmed === 'R' || trimmed.toLowerCase() === 'rest' || trimmed === '쉼'
}

function cleanUstValue(value: string) {
  return value.replace(/[\r\n]/gu, ' ').trim()
}

function formatNumber(value: number, fractionDigits: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(fractionDigits)
}

function formatPitchBendNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/u, '')
}

function cleanPitchBendMode(value: string) {
  return /^[a-z0-9_-]*$/iu.test(value) ? value : 's'
}
