import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'

describe('default demo project', () => {
  it('keeps the first-run lyric on a hook-shaped melody', () => {
    const lyrics = demoProject.notes.map((note) => note.lyric).join('')
    const tones = demoProject.notes.map((note) => note.tone)
    const intervals = tones.slice(1).map((tone, index) => tone - tones[index])

    expect(lyrics).toBe('도히도히다이스키')
    expect(tones).toEqual([64, 67, 64, 69, 67, 69, 65, 64])
    expect(new Set(tones).size).toBeGreaterThanOrEqual(4)
    expect(intervals.some((interval) => Math.abs(interval) >= 3)).toBe(true)
    expect(intervals.every((interval) => interval === 2 || interval === 1)).toBe(false)
    expect(demoProject.chords?.map((chord) => chord.symbol)).toEqual(['C', 'G', 'Am', 'F'])
    expect(demoProject.chords?.map((chord) => chord.start)).toEqual([0, 960, 1920, 2880])
  })
})
