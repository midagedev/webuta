import { describe, expect, it } from 'vitest'
import { formatTimingNumber, normalizeNoteTiming, parseUstNoteTiming, sanitizeOptionalNoteTiming } from './timing'

describe('UTAU note timing helpers', () => {
  it('normalizes optional UST timing overrides into safe millisecond values', () => {
    expect(
      normalizeNoteTiming({
        sampleStartMs: 24.8,
        preutteranceMs: -5,
        voiceOverlapMs: 18.2,
      }),
    ).toEqual({
      sampleStartMs: 25,
      preutteranceMs: 0,
      voiceOverlapMs: 18,
    })
  })

  it('omits empty timing while preserving explicit zero overrides', () => {
    expect(sanitizeOptionalNoteTiming(undefined)).toBeUndefined()
    expect(sanitizeOptionalNoteTiming({})).toBeUndefined()
    expect(sanitizeOptionalNoteTiming({ preutteranceMs: 0 })).toEqual({ preutteranceMs: 0 })
  })

  it('maps classic UST timing field names to the note model', () => {
    expect(
      parseUstNoteTiming({
        startPoint: 35,
        preutterance: 80,
        voiceOverlap: 22,
      }),
    ).toEqual({
      sampleStartMs: 35,
      preutteranceMs: 80,
      voiceOverlapMs: 22,
    })
  })

  it('formats compact UST timing numbers', () => {
    expect(formatTimingNumber(12)).toBe('12')
    expect(formatTimingNumber(12.5)).toBe('12.5')
  })
})
