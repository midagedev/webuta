import { describe, expect, it } from 'vitest'
import { normalizeNoteIntensity, noteIntensityGain, sanitizeOptionalNoteIntensity } from './expression'

describe('note expression helpers', () => {
  it('normalizes UTAU-style intensity into a bounded integer percent', () => {
    expect(normalizeNoteIntensity(undefined)).toBe(100)
    expect(normalizeNoteIntensity(73.4)).toBe(73)
    expect(normalizeNoteIntensity(-20)).toBe(0)
    expect(normalizeNoteIntensity(250)).toBe(200)
  })

  it('omits default intensity while preserving intentional dynamics', () => {
    expect(sanitizeOptionalNoteIntensity(undefined)).toBeUndefined()
    expect(sanitizeOptionalNoteIntensity(100)).toBeUndefined()
    expect(sanitizeOptionalNoteIntensity(65)).toBe(65)
  })

  it('maps intensity directly to renderer gain', () => {
    expect(noteIntensityGain({ intensity: 40 })).toBe(0.4)
    expect(noteIntensityGain({ intensity: 125 })).toBe(1.25)
    expect(noteIntensityGain({})).toBe(1)
  })
})
