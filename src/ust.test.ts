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
        'StartPoint=35',
        'PreUtterance=80',
        'VoiceOverlap=22',
        'Intensity=72',
        'Envelope=0,18,90,0,100,65,8',
        '[#0002]',
        'Length=960',
        'Lyric=히',
        'NoteNum=67',
        'Tempo=96',
        'VBR=60,180,32,10,10,0,0',
        'PBS=0,0',
        'PBW=240,240,480',
        'PBY=0,35,-20,0',
        'PBM=s,s,s',
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
    expect(project.notes[0]).toMatchObject({
      start: 240,
      duration: 480,
      tone: 64,
      lyric: '도',
      timing: { sampleStartMs: 35, preutteranceMs: 80, voiceOverlapMs: 22 },
      intensity: 72,
      envelope: { p1Ms: 0, p2Ms: 18, p3Ms: 90, v1: 0, v2: 100, v3: 65, v4: 8 },
    })
    expect(project.notes[1]).toMatchObject({
      start: 720,
      duration: 960,
      tone: 67,
      lyric: '히',
      vibrato: { enabled: true, depthCents: 32, startPercent: 40 },
      pitchBend: {
        points: [
          { timePercent: 0, cents: 0 },
          { timePercent: 25, cents: 35 },
          { timePercent: 50, cents: -20 },
          { timePercent: 100, cents: 0 },
        ],
        modes: ['s', 's', 's'],
      },
    })
    expect(project.source).toEqual({ fileName: 'classic-hook.ust', format: 'ust' })
  })

  it('serializes WebUtau notes to classic UST blocks with rests and vibrato', () => {
    const text = serializeUst({
      ...demoProject,
      notes: demoProject.notes.map((note, index) =>
        index === 0
          ? {
              ...note,
              intensity: 64,
              timing: { sampleStartMs: 28, preutteranceMs: 76, voiceOverlapMs: 18 },
              envelope: { p1Ms: 0, p2Ms: 22, p3Ms: 120, v1: 0, v2: 100, v3: 58, v4: 10 },
              pitchBend: {
                points: [
                  { timePercent: 0, cents: 0 },
                  { timePercent: 50, cents: 40 },
                  { timePercent: 100, cents: 0 },
                ],
                modes: ['s', 'r'],
              },
            }
          : note,
      ),
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
    expect(text).toContain('StartPoint=28')
    expect(text).toContain('PreUtterance=76')
    expect(text).toContain('VoiceOverlap=18')
    expect(text).toContain('Intensity=64')
    expect(text).toContain('Envelope=0,22,120,0,100,58,10')
    expect(text).toContain('Tempo=96')
    expect(text).toContain('VBR=56,179,20,10,10,0,0')
    expect(text).toContain('PBS=0,0')
    expect(text).toContain('PBW=210,210')
    expect(text).toContain('PBY=0,40,0')
    expect(text).toContain('PBM=s,r')

    const reparsed = parseUst(text, 'roundtrip.ust')
    expect(reparsed.notes.map((note) => note.lyric)).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
    expect(reparsed.notes[0].timing).toEqual({ sampleStartMs: 28, preutteranceMs: 76, voiceOverlapMs: 18 })
    expect(reparsed.notes[0].intensity).toBe(64)
    expect(reparsed.notes[0].envelope).toEqual({ p1Ms: 0, p2Ms: 22, p3Ms: 120, v1: 0, v2: 100, v3: 58, v4: 10 })
    expect(reparsed.tempoChanges).toEqual([
      { position: 0, bpm: 112 },
      { position: 2160, bpm: 96 },
    ])
    expect(reparsed.notes.at(-1)?.vibrato).toMatchObject({
      enabled: true,
      depthCents: 20,
      startPercent: 44,
    })
    expect(reparsed.notes[0].pitchBend?.points).toEqual([
      { timePercent: 0, cents: 0 },
      { timePercent: 50, cents: 40 },
      { timePercent: 100, cents: 0 },
    ])
    expect(reparsed.notes[0].pitchBend?.modes).toEqual(['s', 'r'])
  })
})
