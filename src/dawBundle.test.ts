import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { encodeWav, inspectWavBlob } from './audio/wav'
import { createDawHandoffBundle, DAW_HANDOFF_BUNDLE_FORMAT, DAW_HANDOFF_BUNDLE_VERSION } from './dawBundle'
import { demoProject } from './demoProject'
import { parseWebutaProject } from './projectFile'
import { parseUst } from './ust'
import { parseUstx } from './ustx'
import type { RenderedAudio } from './types'

describe('DAW handoff bundle', () => {
  it('packages WAV, project files, readable sidecars, README, and manifest files', async () => {
    const wavBlob = encodeWav(new Float32Array(44100), 44100)
    const rendered: RenderedAudio = {
      blob: wavBlob,
      url: 'blob:test',
      durationSeconds: 1,
      fileName: 'First-Vocal-Sketch.wav',
      wavInfo: await inspectWavBlob(wavBlob),
    }

    const bundle = await createDawHandoffBundle({
      project: demoProject,
      rendered,
      voicebankName: 'WebUtau Korean V3 Synthetic',
      rendererName: 'UTAU sample renderer',
      exportedAt: '2026-07-01T00:00:00.000Z',
    })

    expect(bundle.fileName).toBe('First-Vocal-Sketch-daw-handoff.zip')
    expect(bundle.blob.type).toBe('application/zip')

    const zip = await JSZip.loadAsync(await bundle.blob.arrayBuffer())
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual([
      'README.txt',
      'audio/',
      'audio/First-Vocal-Sketch.wav',
      'guide/',
      'guide/First-Vocal-Sketch-chords.mid',
      'guide/First-Vocal-Sketch-melody.mid',
      'manifest.json',
      'project/',
      'project/First-Vocal-Sketch.ust',
      'project/First-Vocal-Sketch.ustx',
      'project/First-Vocal-Sketch.webutau.json',
      'project/arrangement.txt',
      'project/chords.csv',
      'project/lyrics.txt',
      'project/notes.csv',
    ])

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest).toMatchObject({
      format: DAW_HANDOFF_BUNDLE_FORMAT,
      version: DAW_HANDOFF_BUNDLE_VERSION,
      exportedAt: '2026-07-01T00:00:00.000Z',
      project: {
        name: 'First Vocal Sketch',
        bpm: 112,
        noteCount: 8,
      },
      voicebank: 'WebUtau Korean V3 Synthetic',
      renderer: 'UTAU sample renderer',
      lyrics: {
        file: 'project/lyrics.txt',
        line: '도 히 도 히 다 이 스 키',
      },
      notes: {
        file: 'project/notes.csv',
        count: 8,
      },
      midi: {
        melodyFile: 'guide/First-Vocal-Sketch-melody.mid',
        chordFile: 'guide/First-Vocal-Sketch-chords.mid',
        ppq: 480,
      },
      arrangement: {
        file: 'project/arrangement.txt',
        chordFile: 'project/chords.csv',
        chordCount: 4,
        chordLine: 'C  G  Am  F',
      },
      wav: {
        file: 'audio/First-Vocal-Sketch.wav',
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
      },
    })

    const expectedLyrics = ['도', '히', '도', '히', '다', '이', '스', '키']
    const expectedTones = [64, 67, 64, 69, 67, 69, 65, 64]
    const expectedStarts = [0, 480, 960, 1440, 2160, 2640, 3120, 3600]
    const expectedDurations = [420, 360, 420, 600, 420, 360, 420, 1080]

    await expect(zip.file('audio/First-Vocal-Sketch.wav')!.async('arraybuffer')).resolves.toBeInstanceOf(ArrayBuffer)

    const webutaText = await zip.file('project/First-Vocal-Sketch.webutau.json')!.async('string')
    const webutaProject = parseWebutaProject(webutaText, 'First-Vocal-Sketch.webutau.json')
    expect(webutaProject.name).toBe('First Vocal Sketch')
    expect(webutaProject.bpm).toBe(112)
    expect(webutaProject.notes.map((note) => note.lyric)).toEqual(expectedLyrics)
    expect(webutaProject.notes.map((note) => note.tone)).toEqual(expectedTones)
    expect(webutaProject.notes.map((note) => note.start)).toEqual(expectedStarts)
    expect(webutaProject.notes.map((note) => note.duration)).toEqual(expectedDurations)
    expect(webutaProject.chords?.map((chord) => chord.symbol)).toEqual(['C', 'G', 'Am', 'F'])
    expect(webutaProject.source).toEqual({
      fileName: 'First-Vocal-Sketch.webutau.json',
      format: 'webuta',
    })

    const ustxText = await zip.file('project/First-Vocal-Sketch.ustx')!.async('string')
    expect(ustxText).toContain('notes:')
    const ustxProject = parseUstx(ustxText, 'First-Vocal-Sketch.ustx')
    expect(ustxProject.name).toBe('First Vocal Sketch')
    expect(ustxProject.bpm).toBe(112)
    expect(ustxProject.tempoChanges).toEqual([{ position: 0, bpm: 112 }])
    expect(ustxProject.notes.map((note) => note.lyric)).toEqual(expectedLyrics)
    expect(ustxProject.notes.map((note) => note.tone)).toEqual(expectedTones)
    expect(ustxProject.notes.map((note) => note.start)).toEqual(expectedStarts)
    expect(ustxProject.notes.map((note) => note.duration)).toEqual(expectedDurations)

    const ustText = await zip.file('project/First-Vocal-Sketch.ust')!.async('string')
    expect(ustText).toContain('[#SETTING]')
    const ustProject = parseUst(ustText, 'First-Vocal-Sketch.ust')
    expect(ustProject.name).toBe('First Vocal Sketch')
    expect(ustProject.bpm).toBe(112)
    expect(ustProject.tempoChanges).toEqual([{ position: 0, bpm: 112 }])
    expect(ustProject.notes.map((note) => note.lyric)).toEqual(expectedLyrics)
    expect(ustProject.notes.map((note) => note.tone)).toEqual(expectedTones)
    expect(ustProject.notes.map((note) => note.start)).toEqual(expectedStarts)
    expect(ustProject.notes.map((note) => note.duration)).toEqual(expectedDurations)

    expect(String.fromCharCode(...new Uint8Array(await zip.file('guide/First-Vocal-Sketch-melody.mid')!.async('arraybuffer')).slice(0, 4))).toBe('MThd')
    expect(String.fromCharCode(...new Uint8Array(await zip.file('guide/First-Vocal-Sketch-chords.mid')!.async('arraybuffer')).slice(0, 4))).toBe('MThd')
    await expect(zip.file('project/lyrics.txt')!.async('string')).resolves.toContain('도 히 도 히 다 이 스 키')
    const notesCsv = await zip.file('project/notes.csv')!.async('string')
    expect(notesCsv.trim().split('\n')).toHaveLength(9)
    expect(notesCsv).toContain('index,lyric,tone,noteName,startTick,durationTicks,startSeconds,durationSeconds,barBeat')
    expect(notesCsv).toContain('1,도,64,E4,0,420,0.000,0.469,1:1')
    const chordsCsv = await zip.file('project/chords.csv')!.async('string')
    expect(chordsCsv.trim().split('\n')).toHaveLength(5)
    expect(chordsCsv).toContain('index,symbol,startTick,durationTicks,startSeconds,durationSeconds,barBeat')
    expect(chordsCsv).toContain('1,C,0,960,0.000,1.071,1:1')
    expect(chordsCsv).toContain('2,G,960,960,1.071,1.071,1:3')
    expect(chordsCsv).toContain('3,Am,1920,960,2.143,1.071,2:1')
    expect(chordsCsv).toContain('4,F,2880,1920,3.214,2.143,2:3')
    const arrangement = await zip.file('project/arrangement.txt')!.async('string')
    expect(arrangement).toContain('Chord guide:')
    expect(arrangement).toContain('C  G  Am  F')
    const readme = await zip.file('README.txt')!.async('string')
    expect(readme).toContain('Import audio/First-Vocal-Sketch.wav into your DAW')
    expect(readme).toContain('guide/First-Vocal-Sketch-melody.mid')
    expect(readme).toContain('guide/First-Vocal-Sketch-chords.mid')
    expect(readme).toContain('project/arrangement.txt')
    expect(readme).toContain('project/chords.csv')
    expect(readme).toContain('project/lyrics.txt')
    expect(readme).toContain('project/notes.csv')
  })
})
