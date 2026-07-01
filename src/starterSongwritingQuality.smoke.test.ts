import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { demoSamples } from './demoProject'
import { TICKS_PER_BEAT, type ChordMarker, type SongNote } from './types'

const REPORT_PATH = process.env.WEBUTA_STARTER_SONGWRITING_REPORT

type SampleSongwritingReport = {
  id: string
  title: string
  mood: string
  passed: boolean
  metrics: {
    bpm: number
    noteCount: number
    lyricSyllableCount: number
    chordCount: number
    uniqueChordCount: number
    toneRange: number
    uniqueToneCount: number
    maxLeap: number
    directionChangeCount: number
    longNoteCount: number
    finalNoteBeats: number
    chordCoveredNoteCount: number
    chordToneRatio: number
    offGridStartCount: number
    codaSyllableCount: number
    contourSignature: string
  }
  checks: Array<{ check: string; passed: boolean }>
  problems: string[]
}

describe('starter songwriting quality smoke audit', () => {
  it('keeps first-run lyrics, melodies, and chord guides varied enough for vocal sketching', () => {
    const samples = demoSamples.map(analyzeStarterSample)
    const portfolio = summarizePortfolio(samples)
    const problems = [
      ...portfolio.problems,
      ...samples.flatMap((sample) => sample.problems.map((problem) => `${sample.title}: ${problem}`)),
    ]
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ok: problems.length === 0,
      decision: problems.length === 0 ? 'starter-songwriting-quality-audit-pass' : 'starter-songwriting-quality-audit-fail',
      sampleCount: samples.length,
      portfolio: portfolio.summary,
      samples,
      problems,
    }

    if (REPORT_PATH) {
      writeJson(resolve(REPORT_PATH), report)
    }

    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })
})

function analyzeStarterSample(sample: (typeof demoSamples)[number]): SampleSongwritingReport {
  const notes = [...sample.project.notes].sort((a, b) => a.start - b.start)
  const chords = [...(sample.project.chords ?? [])].sort((a, b) => a.start - b.start)
  const lyricTokens = sample.lyricLine.split(/\s+/u).filter(Boolean)
  const tones = notes.map((note) => note.tone)
  const leaps = tones.slice(1).map((tone, index) => tone - tones[index])
  const chordCoveredNoteCount = notes.filter((note) => Boolean(activeChordForNote(chords, note))).length
  const chordToneCount = notes.filter((note) => {
    const chord = activeChordForNote(chords, note)
    return chord ? isChordTone(note.tone, chord) : false
  }).length
  const directionChangeCount = countDirectionChanges(leaps)
  const metrics = {
    bpm: sample.project.bpm,
    noteCount: notes.length,
    lyricSyllableCount: lyricTokens.length,
    chordCount: chords.length,
    uniqueChordCount: new Set(chords.map((chord) => chord.symbol)).size,
    toneRange: Math.max(...tones) - Math.min(...tones),
    uniqueToneCount: new Set(tones).size,
    maxLeap: Math.max(0, ...leaps.map((leap) => Math.abs(leap))),
    directionChangeCount,
    longNoteCount: notes.filter((note) => note.duration >= TICKS_PER_BEAT * 1.5).length,
    finalNoteBeats: roundNumber((notes.at(-1)?.duration ?? 0) / TICKS_PER_BEAT),
    chordCoveredNoteCount,
    chordToneRatio: roundNumber(chordToneCount / Math.max(1, notes.length)),
    offGridStartCount: notes.filter((note) => note.start % (TICKS_PER_BEAT / 2) !== 0).length,
    codaSyllableCount: lyricTokens.filter(hasHangulCoda).length,
    contourSignature: contourSignature(leaps),
  }
  const checks: Array<{ check: string; passed: boolean }> = []
  const problems: string[] = []
  const addCheck = (check: string, passed: boolean, problem = check) => {
    checks.push({ check, passed })
    if (!passed) {
      problems.push(problem)
    }
  }

  addCheck('project has one lyric token per note', metrics.lyricSyllableCount === metrics.noteCount)
  addCheck('sample is a compact vocal hook length', metrics.noteCount >= 8 && metrics.noteCount <= 12)
  addCheck('tempo is usable for a vocal sketch', metrics.bpm >= 78 && metrics.bpm <= 168)
  addCheck('melody uses at least four unique pitches', metrics.uniqueToneCount >= 4)
  addCheck('melody has a vocal-synth hook range', metrics.toneRange >= 5 && metrics.toneRange <= 16)
  addCheck('melody avoids extreme single leaps', metrics.maxLeap <= 8)
  addCheck('melody has at least one contour turn', metrics.directionChangeCount >= 1)
  addCheck('hook has at least one sustained note', metrics.longNoteCount >= 1)
  addCheck('final note gives a clear cadence hold', metrics.finalNoteBeats >= 1.5)
  addCheck('sample has at least four chord markers', metrics.chordCount >= 4)
  addCheck('sample chord guide has four unique chord symbols', metrics.uniqueChordCount >= 4)
  addCheck('every note is covered by a chord marker', metrics.chordCoveredNoteCount === metrics.noteCount)
  addCheck('melody keeps enough chord-tone anchors', metrics.chordToneRatio >= 0.34)
  addCheck('project chord line matches chord markers', chordLineFromChords(chords) === sample.chordLine)

  return {
    id: sample.id,
    title: sample.title,
    mood: sample.mood,
    passed: problems.length === 0,
    metrics,
    checks,
    problems,
  }
}

function summarizePortfolio(samples: SampleSongwritingReport[]) {
  const bpms = samples.map((sample) => sample.metrics.bpm)
  const minBpm = Math.min(...bpms)
  const maxBpm = Math.max(...bpms)
  const summary = {
    moodCount: new Set(samples.map((sample) => sample.mood)).size,
    titleCount: new Set(samples.map((sample) => sample.title)).size,
    tempoSpan: maxBpm - minBpm,
    minBpm,
    maxBpm,
    bpmBandCount: new Set(samples.map((sample) => bpmBand(sample.metrics.bpm))).size,
    codaSampleCount: samples.filter((sample) => sample.metrics.codaSyllableCount > 0).length,
    contourSignatureCount: new Set(samples.map((sample) => sample.metrics.contourSignature)).size,
    chordProgressionCount: new Set(demoSamples.map((sample) => sample.chordLine)).size,
    globalToneRange: globalToneRange(),
    offGridSampleCount: samples.filter((sample) => sample.metrics.offGridStartCount > 0).length,
  }
  const problems = [
    ...(samples.length >= 10 ? [] : [`starter songwriting sample count ${samples.length}; expected at least 10`]),
    ...(summary.moodCount >= 10 ? [] : [`starter moods ${summary.moodCount}; expected at least 10`]),
    ...(summary.chordProgressionCount >= 10 ? [] : [`starter chord progressions ${summary.chordProgressionCount}; expected at least 10`]),
    ...(summary.bpmBandCount >= 3 ? [] : [`starter BPM bands ${summary.bpmBandCount}; expected slow, mid, and fast coverage`]),
    ...(summary.tempoSpan >= 70 ? [] : [`starter tempo span ${summary.tempoSpan}; expected at least 70 BPM`]),
    ...(summary.codaSampleCount >= 4 ? [] : [`starter coda sample count ${summary.codaSampleCount}; expected at least 4`]),
    ...(summary.contourSignatureCount >= 5
      ? []
      : [`starter contour signature count ${summary.contourSignatureCount}; expected at least 5`]),
    ...(summary.globalToneRange >= 20 ? [] : [`starter global tone range ${summary.globalToneRange}; expected at least 20 semitones`]),
    ...(summary.offGridSampleCount >= 2 ? [] : [`starter off-grid sample count ${summary.offGridSampleCount}; expected at least 2`]),
  ]
  return { summary, problems }
}

function activeChordForNote(chords: ChordMarker[], note: SongNote) {
  return chords.find((chord) => note.start >= chord.start && note.start < chord.start + chord.duration)
}

function isChordTone(tone: number, chord: ChordMarker) {
  const toneClass = mod(tone, 12)
  return (chord.tones ?? [chord.tone ?? 60]).some((chordTone) => mod(chordTone, 12) === toneClass)
}

function countDirectionChanges(leaps: number[]) {
  const directions = leaps.map((leap) => Math.sign(leap)).filter((direction) => direction !== 0)
  return directions.slice(1).filter((direction, index) => direction !== directions[index]).length
}

function contourSignature(leaps: number[]) {
  return leaps
    .map((leap) => {
      if (leap >= 3) {
        return 'U'
      }
      if (leap > 0) {
        return 'u'
      }
      if (leap <= -3) {
        return 'D'
      }
      if (leap < 0) {
        return 'd'
      }
      return 's'
    })
    .join('')
}

function chordLineFromChords(chords: ChordMarker[]) {
  return chords.map((chord) => chord.symbol).join(' -> ')
}

function globalToneRange() {
  const tones = demoSamples.flatMap((sample) => sample.project.notes.map((note) => note.tone))
  return Math.max(...tones) - Math.min(...tones)
}

function bpmBand(bpm: number) {
  if (bpm < 96) {
    return 'slow'
  }
  if (bpm > 144) {
    return 'fast'
  }
  return 'mid'
}

function hasHangulCoda(syllable: string) {
  const charCode = syllable.codePointAt(0)
  if (charCode === undefined || charCode < 0xac00 || charCode > 0xd7a3) {
    return false
  }
  return (charCode - 0xac00) % 28 !== 0
}

function mod(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

function roundNumber(value: number) {
  return Math.round(value * 10000) / 10000
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
