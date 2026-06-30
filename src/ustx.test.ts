import { describe, expect, it } from 'vitest'
import { parseUstx, serializeUstx } from './ustx'
import { sampleUstx } from './test/sampleUstx'

describe('USTX compatibility layer', () => {
  it('parses OpenUtau-style YAML voice parts', () => {
    const project = parseUstx(sampleUstx, 'sample.ustx')

    expect(project.name).toBe('Sample USTX')
    expect(project.bpm).toBe(128)
    expect(project.tempoChanges).toEqual([{ position: 0, bpm: 128 }])
    expect(project.tracks[0].name).toBe('Lead')
    expect(project.parts[0].start).toBe(480)
    expect(project.notes).toHaveLength(2)
    expect(project.notes[1]).toMatchObject({
      start: 960,
      tone: 64,
      lyric: 'li',
    })
  })

  it('serializes back to a readable ustx YAML document', () => {
    const project = {
      ...parseUstx(sampleUstx, 'sample.ustx'),
      tempoChanges: [
        { position: 0, bpm: 128 },
        { position: 960, bpm: 96 },
      ],
    }
    const text = serializeUstx(project)

    expect(text).toContain('ustx_version')
    expect(text).toContain('voice_parts')
    expect(text).toContain('lyric: la')
    expect(text).toContain('position: 960')
    expect(text).toContain('bpm: 96')
  })

  it('round-trips note vibrato through USTX vibrato blocks', () => {
    const project = parseUstx(
      [
        'name: Vibrato USTX',
        'tracks:',
        '  - track_name: Lead',
        'voice_parts:',
        '  - name: Verse',
        '    track_no: 0',
        '    position: 0',
        '    duration: 960',
        '    notes:',
        '      - position: 0',
        '        duration: 960',
        '        tone: 64',
        '        lyric: 라',
        '        vibrato:',
        '          length: 58',
        '          period: 180',
        '          depth: 32',
      ].join('\n'),
      'vibrato.ustx',
    )

    expect(project.notes[0].vibrato).toMatchObject({
      enabled: true,
      depthCents: 32,
      startPercent: 42,
    })

    const text = serializeUstx(project)
    expect(text).toContain('vibrato:')
    expect(text).toContain('depth: 32')
    expect(text).toContain('period: 180')
  })

  it('round-trips OpenUtau phoneme expressions for UTAU resampler handoff', () => {
    const project = parseUstx(
      [
        'name: Expression USTX',
        'tracks:',
        '  - track_name: Lead',
        'voice_parts:',
        '  - name: Verse',
        '    track_no: 0',
        '    position: 0',
        '    duration: 960',
        '    notes:',
        '      - position: 0',
        '        duration: 960',
        '        tone: 64',
        '        lyric: 라',
        '        phonemeExpressions:',
        '          - index: 0',
        '            abbr: vel',
        '            value: 143',
        '          - index: 0',
        '            abbr: vol',
        '            value: 82',
        '          - index: 0',
        '            abbr: mod',
        '            value: 24',
      ].join('\n'),
      'expressions.ustx',
    )

    expect(project.notes[0]).toMatchObject({
      velocity: 143,
      intensity: 82,
      modulation: 24,
    })

    const text = serializeUstx(project)
    expect(text).toContain('phonemeExpressions:')
    expect(text).toContain('abbr: vel')
    expect(text).toContain('value: 143')
    expect(text).toContain('abbr: vol')
    expect(text).toContain('value: 82')
    expect(text).toContain('abbr: mod')
    expect(text).toContain('value: 24')
  })

  it('omits default OpenUtau phoneme expressions from USTX export', () => {
    const project = parseUstx(sampleUstx, 'sample.ustx')
    project.notes[0] = {
      ...project.notes[0],
      velocity: 100,
      intensity: 100,
      modulation: 0,
    }

    expect(serializeUstx(project)).not.toContain('phonemeExpressions:')
  })
})
