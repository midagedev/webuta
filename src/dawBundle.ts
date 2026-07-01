import JSZip from 'jszip'
import { durationTicksToSeconds, sanitizeFileName, sortedNotes, tickPositionLabel, ticksToSecondsInProject, toneName } from './music'
import { createChordMidi, createMelodyMidi } from './midi'
import { serializeWebutaProject } from './projectFile'
import { serializeUst } from './ust'
import { serializeUstx } from './ustx'
import { TICKS_PER_BEAT, type ChordMarker, type RenderedAudio, type SongProject } from './types'

export const DAW_HANDOFF_BUNDLE_FORMAT = 'webuta-daw-handoff-bundle'
export const DAW_HANDOFF_BUNDLE_VERSION = 4

export type DawHandoffBundleOptions = {
  project: SongProject
  rendered: RenderedAudio
  voicebankName: string
  rendererName: string
  exportedAt?: string
}

export type DawHandoffBundle = {
  blob: Blob
  fileName: string
}

export async function createDawHandoffBundle(options: DawHandoffBundleOptions): Promise<DawHandoffBundle> {
  const exportedAt = options.exportedAt ?? new Date().toISOString()
  const baseName = sanitizeFileName(options.project.name)
  const files = {
    wav: `audio/${baseName}.wav`,
    webuta: `project/${baseName}.webutau.json`,
    ustx: `project/${baseName}.ustx`,
    ust: `project/${baseName}.ust`,
    melodyMidi: `guide/${baseName}-melody.mid`,
    chordMidi: `guide/${baseName}-chords.mid`,
    lyrics: 'project/lyrics.txt',
    notesCsv: 'project/notes.csv',
    chordsCsv: 'project/chords.csv',
    arrangement: 'project/arrangement.txt',
    manifest: 'manifest.json',
    readme: 'README.txt',
  }
  const lyricLine = createLyricLine(options.project)
  const chords = sortedChords(options.project)
  const chordLine = createChordLine(chords)
  const manifest = {
    format: DAW_HANDOFF_BUNDLE_FORMAT,
    version: DAW_HANDOFF_BUNDLE_VERSION,
    exportedAt,
    project: {
      id: options.project.id,
      name: options.project.name,
      bpm: options.project.bpm,
      beatPerBar: options.project.beatPerBar,
      beatUnit: options.project.beatUnit,
      noteCount: options.project.notes.length,
    },
    voicebank: options.voicebankName,
    renderer: options.rendererName,
    lyrics: {
      file: files.lyrics,
      line: lyricLine,
    },
    notes: {
      file: files.notesCsv,
      count: options.project.notes.length,
    },
    midi: {
      melodyFile: files.melodyMidi,
      chordFile: files.chordMidi,
      ppq: TICKS_PER_BEAT,
    },
    arrangement: {
      file: files.arrangement,
      chordFile: files.chordsCsv,
      chordCount: chords.length,
      chordLine,
    },
    wav: {
      file: files.wav,
      sampleRate: options.rendered.wavInfo.sampleRate,
      channels: options.rendered.wavInfo.channelCount,
      bitsPerSample: options.rendered.wavInfo.bitsPerSample,
      durationSeconds: options.rendered.wavInfo.durationSeconds,
      bytes: options.rendered.wavInfo.dataBytes + 44,
    },
    files,
  }

  const zip = new JSZip()
  zip.file(files.wav, await options.rendered.blob.arrayBuffer())
  zip.file(files.webuta, serializeWebutaProject(options.project, exportedAt))
  zip.file(files.ustx, serializeUstx(options.project))
  zip.file(files.ust, serializeUst(options.project))
  zip.file(files.melodyMidi, createMelodyMidi(options.project))
  zip.file(files.chordMidi, createChordMidi(options.project))
  zip.file(files.lyrics, createLyricsText(options.project))
  zip.file(files.notesCsv, createNotesCsv(options.project))
  zip.file(files.chordsCsv, createChordsCsv(options.project))
  zip.file(files.arrangement, createArrangementText(options.project, options.voicebankName, options.rendererName))
  zip.file(files.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
  zip.file(files.readme, createBundleReadme(options, files))

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

  return {
    blob: new Blob([arrayBuffer], { type: 'application/zip' }),
    fileName: `${baseName}-daw-handoff.zip`,
  }
}

function createBundleReadme(options: DawHandoffBundleOptions, files: Record<string, string>) {
  return [
    `${options.project.name} - WebUtau DAW handoff`,
    '',
    'Quick start:',
    `1. Import ${files.wav} into your DAW as the vocal audio track.`,
    `2. Import ${files.melodyMidi} as a pitch/lyric/timing/dynamics guide, and optionally import ${files.chordMidi} for the starter chords.`,
    `3. Open ${files.arrangement} for the starter chord guide, then use ${files.lyrics} and ${files.notesCsv} to align lyrics and notes.`,
    `4. Keep ${files.webuta}, ${files.ustx}, and ${files.ust} beside the WAV if you want to revise the song later.`,
    '',
    'Files:',
    `- ${files.wav}: rendered vocal audio, 44.1 kHz mono 16-bit PCM when the DAW-ready check passes.`,
    `- ${files.webuta}: native WebUtau project backup.`,
    `- ${files.ustx}: OpenUtau/USTX project export.`,
    `- ${files.ust}: classic UTAU project export.`,
    `- ${files.melodyMidi}: Standard MIDI vocal melody guide with lyric meta events, note velocity dynamics, and pitch wheel bends.`,
    `- ${files.chordMidi}: Standard MIDI chord guide matching ${files.chordsCsv}.`,
    `- ${files.lyrics}: plain-text lyric line for quick checking.`,
    `- ${files.notesCsv}: note timing, pitch, and lyric table for DAW alignment.`,
    `- ${files.chordsCsv}: chord timing table for quickly sketching accompaniment.`,
    `- ${files.arrangement}: human-readable BPM, lyric, and chord guide.`,
    `- ${files.manifest}: machine-readable bundle metadata.`,
    '',
    `Voicebank: ${options.voicebankName}`,
    `Renderer: ${options.rendererName}`,
    '',
    'Import the WAV into a DAW for arrangement. Keep the project files with the audio if you want to revise lyrics, timing, or notes later.',
    '',
  ].join('\n')
}

function createLyricLine(project: SongProject) {
  return sortedNotes(project.notes)
    .map((note) => note.lyric)
    .join(' ')
}

function createChordLine(chords: ChordMarker[]) {
  return chords.map((chord) => chord.symbol).join('  ')
}

function createLyricsText(project: SongProject) {
  return [
    `${project.name}`,
    '',
    createLyricLine(project),
    '',
  ].join('\n')
}

function createArrangementText(project: SongProject, voicebankName: string, rendererName: string) {
  const chords = sortedChords(project)
  const chordLine = createChordLine(chords)
  return [
    `${project.name}`,
    '',
    `BPM: ${project.bpm}`,
    `Meter: ${project.beatPerBar}/${project.beatUnit}`,
    `Voicebank: ${voicebankName}`,
    `Renderer: ${rendererName}`,
    '',
    'Lyric line:',
    createLyricLine(project),
    '',
    'Chord guide:',
    chordLine || 'No chord guide stored in this project.',
    '',
    ...chords.map((chord) => `${tickPositionLabel(chord.start, project)}  ${chord.symbol}  ${formatCsvSeconds(durationTicksToSeconds(project, chord.start, chord.duration))}s`),
    '',
  ].join('\n')
}

function createNotesCsv(project: SongProject) {
  const header = [
    'index',
    'lyric',
    'tone',
    'noteName',
    'startTick',
    'durationTicks',
    'startSeconds',
    'durationSeconds',
    'barBeat',
  ]
  const rows = sortedNotes(project.notes).map((note, index) => [
    String(index + 1),
    note.lyric,
    String(note.tone),
    toneName(note.tone),
    String(note.start),
    String(note.duration),
    formatCsvSeconds(ticksToSecondsInProject(note.start, project)),
    formatCsvSeconds(durationTicksToSeconds(project, note.start, note.duration)),
    tickPositionLabel(note.start, project),
  ])
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function createChordsCsv(project: SongProject) {
  const header = ['index', 'symbol', 'startTick', 'durationTicks', 'startSeconds', 'durationSeconds', 'barBeat']
  const rows = sortedChords(project).map((chord, index) => [
    String(index + 1),
    chord.symbol,
    String(chord.start),
    String(chord.duration),
    formatCsvSeconds(ticksToSecondsInProject(chord.start, project)),
    formatCsvSeconds(durationTicksToSeconds(project, chord.start, chord.duration)),
    tickPositionLabel(chord.start, project),
  ])
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function sortedChords(project: SongProject) {
  return [...(project.chords ?? [])].sort((a, b) => a.start - b.start || a.symbol.localeCompare(b.symbol))
}

function formatCsvSeconds(seconds: number) {
  return seconds.toFixed(3)
}

function csvCell(value: string) {
  return /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}
