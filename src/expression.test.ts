import { describe, expect, it } from 'vitest'
import {
  normalizeNoteIntensity,
  normalizeNoteModulation,
  normalizeNoteVelocity,
  noteIntensityGain,
  noteVelocityRate,
  sanitizeOptionalNoteFlags,
  sanitizeOptionalNoteIntensity,
  sanitizeOptionalNoteModulation,
  sanitizeOptionalNoteVelocity,
} from './expression'

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

  it('normalizes classic UST Velocity and maps it to consonant source rate', () => {
    expect(normalizeNoteVelocity(undefined)).toBe(100)
    expect(normalizeNoteVelocity(42.6)).toBe(43)
    expect(normalizeNoteVelocity(250)).toBe(200)
    expect(sanitizeOptionalNoteVelocity(100)).toBeUndefined()
    expect(sanitizeOptionalNoteVelocity(150)).toBe(150)
    expect(noteVelocityRate({ velocity: 150 })).toBe(1.5)
  })

  it('normalizes classic UST Modulation while omitting the default value', () => {
    expect(normalizeNoteModulation(undefined)).toBe(0)
    expect(normalizeNoteModulation(-10)).toBe(0)
    expect(normalizeNoteModulation(150)).toBe(100)
    expect(sanitizeOptionalNoteModulation(0)).toBeUndefined()
    expect(sanitizeOptionalNoteModulation(24)).toBe(24)
  })

  it('sanitizes classic UST resampler flags as a compact single line', () => {
    expect(sanitizeOptionalNoteFlags(' g-3Y0\r\nBRE20 ')).toBe('g-3Y0  BRE20')
    expect(sanitizeOptionalNoteFlags('   ')).toBeUndefined()
  })
})
