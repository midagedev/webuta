import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { encodeWav, inspectWavBlob } from './audio/wav'
import { createDawHandoffBundle, DAW_HANDOFF_BUNDLE_FORMAT, DAW_HANDOFF_BUNDLE_VERSION } from './dawBundle'
import { demoProject } from './demoProject'
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
      'manifest.json',
      'project/',
      'project/First-Vocal-Sketch.ust',
      'project/First-Vocal-Sketch.ustx',
      'project/First-Vocal-Sketch.webutau.json',
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
      wav: {
        file: 'audio/First-Vocal-Sketch.wav',
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
      },
    })

    await expect(zip.file('audio/First-Vocal-Sketch.wav')!.async('arraybuffer')).resolves.toBeInstanceOf(ArrayBuffer)
    await expect(zip.file('project/First-Vocal-Sketch.ustx')!.async('string')).resolves.toContain('notes:')
    await expect(zip.file('project/First-Vocal-Sketch.ust')!.async('string')).resolves.toContain('[#SETTING]')
    await expect(zip.file('project/First-Vocal-Sketch.webutau.json')!.async('string')).resolves.toContain('webuta-project')
    await expect(zip.file('project/lyrics.txt')!.async('string')).resolves.toContain('도 히 도 히 다 이 스 키')
    const notesCsv = await zip.file('project/notes.csv')!.async('string')
    expect(notesCsv).toContain('index,lyric,tone,noteName,startTick,durationTicks,startSeconds,durationSeconds,barBeat')
    expect(notesCsv).toContain('1,도,64,E4,0,420,0.000,0.469,1:1')
    const readme = await zip.file('README.txt')!.async('string')
    expect(readme).toContain('Import audio/First-Vocal-Sketch.wav into your DAW')
    expect(readme).toContain('project/lyrics.txt')
    expect(readme).toContain('project/notes.csv')
  })
})
