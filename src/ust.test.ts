import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import { parseUst, serializeUst } from './ust'

describe('classic UST compatibility layer', () => {
  it('parses UTAU-style setting and note blocks', () => {
    const project = parseUst(
      [
        '[#VERSION]',
        'UST Version1.2',
        '[#SETTING]',
        'Tempo=128.50',
        'ProjectName=Classic Hook',
        'VoiceDir=WebUtau Korean V3 Synthetic',
        '[#0000]',
        'Length=240',
        'Lyric=R',
        'NoteNum=60',
        '[#0001]',
        'Length=480',
        'Lyric=도',
        'NoteNum=64',
        '[#0002]',
        'Length=960',
        'Lyric=히',
        'NoteNum=67',
        'Tempo=96',
        'VBR=60,180,32,10,10,0,0',
        '[#TRACKEND]',
      ].join('\r\n'),
      'classic-hook.ust',
    )

    expect(project.name).toBe('Classic Hook')
    expect(project.bpm).toBe(128.5)
    expect(project.tempoChanges).toEqual([
      { position: 0, bpm: 128.5 },
      { position: 720, bpm: 96 },
    ])
    expect(project.tracks[0]).toMatchObject({
      singer: 'WebUtau Korean V3 Synthetic',
      phonemizer: 'classic UTAU',
    })
    expect(project.parts[0]).toMatchObject({ start: 0, duration: 1920 })
    expect(project.notes).toHaveLength(2)
    expect(project.notes[0]).toMatchObject({ start: 240, duration: 480, tone: 64, lyric: '도' })
    expect(project.notes[1]).toMatchObject({
      start: 720,
      duration: 960,
      tone: 67,
      lyric: '히',
      vibrato: { enabled: true, depthCents: 32, startPercent: 40 },
    })
    expect(project.source).toEqual({ fileName: 'classic-hook.ust', format: 'ust' })
  })

  it('serializes WebUtau notes to classic UST blocks with rests and vibrato', () => {
    const text = serializeUst({
      ...demoProject,
      tempoChanges: [
        { position: 0, bpm: 112 },
        { position: 2160, bpm: 96 },
      ],
    })

    expect(text).toContain('[#VERSION]\r\nUST Version1.2')
    expect(text).toContain('[#SETTING]')
    expect(text).toContain('ProjectName=First Vocal Sketch')
    expect(text).toContain('Lyric=도')
    expect(text).toContain('Lyric=R')
    expect(text).toContain('Tempo=96')
    expect(text).toContain('VBR=56,179,20,10,10,0,0')

    const reparsed = parseUst(text, 'roundtrip.ust')
    expect(reparsed.notes.map((note) => note.lyric)).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
    expect(reparsed.tempoChanges).toEqual([
      { position: 0, bpm: 112 },
      { position: 2160, bpm: 96 },
    ])
    expect(reparsed.notes.at(-1)?.vibrato).toMatchObject({
      enabled: true,
      depthCents: 20,
      startPercent: 44,
    })
  })
})
