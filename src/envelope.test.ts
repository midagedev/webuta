import { describe, expect, it } from 'vitest'
import {
  normalizeNoteEnvelope,
  noteEnvelopeGainAt,
  parseUstEnvelope,
  sanitizeOptionalNoteEnvelope,
  serializeNoteEnvelope,
} from './envelope'

describe('UTAU note envelope helpers', () => {
  it('normalizes envelope times and levels into safe UTAU-style bounds', () => {
    expect(
      normalizeNoteEnvelope({
        p1Ms: -10,
        p2Ms: 12.4,
        p3Ms: 9000,
        v1: -1,
        v2: 80.2,
        v3: 250,
        v4: 15.6,
      }),
    ).toEqual({
      p1Ms: 0,
      p2Ms: 12,
      p3Ms: 5000,
      v1: 0,
      v2: 80,
      v3: 200,
      v4: 16,
    })
  })

  it('parses and serializes classic UST Envelope values', () => {
    const envelope = parseUstEnvelope('0,18,90,0,100,65,8')

    expect(envelope).toEqual({
      p1Ms: 0,
      p2Ms: 18,
      p3Ms: 90,
      v1: 0,
      v2: 100,
      v3: 65,
      v4: 8,
    })
    expect(serializeNoteEnvelope(envelope!)).toBe('0,18,90,0,100,65,8')
  })

  it('omits default envelope values from the note model', () => {
    expect(sanitizeOptionalNoteEnvelope(undefined)).toBeUndefined()
    expect(sanitizeOptionalNoteEnvelope({ p1Ms: 0, p2Ms: 5, p3Ms: 35, v1: 0, v2: 100, v3: 100, v4: 0 })).toBeUndefined()
  })

  it('maps the envelope to relative gain across the note body', () => {
    const note = {
      envelope: {
        p1Ms: 0,
        p2Ms: 100,
        p3Ms: 200,
        v1: 0,
        v2: 100,
        v3: 40,
        v4: 0,
      },
    }

    expect(noteEnvelopeGainAt({}, 0.5, 1)).toBe(1)
    expect(noteEnvelopeGainAt(note, 0, 1)).toBeCloseTo(0)
    expect(noteEnvelopeGainAt(note, 0.1, 1)).toBeCloseTo(1)
    expect(noteEnvelopeGainAt(note, 0.8, 1)).toBeCloseTo(0.4)
    expect(noteEnvelopeGainAt(note, 1, 1)).toBeCloseTo(0)
  })
})
