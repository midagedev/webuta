import { describe, expect, it } from 'vitest'
import { parseUstx, serializeUstx } from './ustx'
import { sampleUstx } from './test/sampleUstx'

describe('USTX compatibility layer', () => {
  it('parses OpenUtau-style YAML voice parts', () => {
    const project = parseUstx(sampleUstx, 'sample.ustx')

    expect(project.name).toBe('Sample USTX')
    expect(project.bpm).toBe(128)
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
    const project = parseUstx(sampleUstx, 'sample.ustx')
    const text = serializeUstx(project)

    expect(text).toContain('ustx_version')
    expect(text).toContain('voice_parts')
    expect(text).toContain('lyric: la')
  })
})
