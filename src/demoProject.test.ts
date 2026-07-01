import { describe, expect, it } from 'vitest'
import { demoProject, demoSamples } from './demoProject'

describe('default demo project', () => {
  it('keeps the first-run lyric on a cyber-pop hook-shaped melody', () => {
    const lyrics = demoProject.notes.map((note) => note.lyric).join('')
    const tones = demoProject.notes.map((note) => note.tone)
    const intervals = tones.slice(1).map((tone, index) => tone - tones[index])

    expect(lyrics).toBe('네오빛이메로디로데려가')
    expect(tones).toEqual([69, 71, 72, 71, 74, 72, 71, 69, 72, 74, 76])
    expect(new Set(tones).size).toBeGreaterThanOrEqual(4)
    expect(intervals.some((interval) => Math.abs(interval) >= 3)).toBe(true)
    expect(intervals.every((interval) => interval === 2 || interval === 1)).toBe(false)
    expect(demoProject.chords?.map((chord) => chord.symbol)).toEqual(['Am', 'F', 'C', 'G'])
    expect(demoProject.chords?.map((chord) => chord.start)).toEqual([0, 960, 1920, 2880])
  })

  it('ships varied starter samples for different first sketches', () => {
    expect(demoSamples.map((sample) => sample.title)).toEqual([
      'Neon Lift',
      'Blue Hour',
      'Retro Run',
      'Moon Signal',
      'Pink Noise',
      'Rain Verse',
      'City Glide',
    ])
    expect(demoSamples.map((sample) => sample.mood)).toEqual([
      'Cyber Pop',
      'Dream Pop',
      'Retro Game',
      'Dark Synth',
      'Hyperpop',
      'Emo Ballad',
      'City Pop',
    ])
    expect(new Set(demoSamples.map((sample) => sample.lyricLine)).size).toBe(7)
    expect(new Set(demoSamples.map((sample) => sample.chordLine)).size).toBe(7)
    expect(new Set(demoSamples.map((sample) => sample.project.bpm)).size).toBeGreaterThanOrEqual(6)
    expect(new Set(demoSamples.map((sample) => sample.project.source?.fileName)).size).toBe(7)
    expect(demoSamples.every((sample) => sample.project.notes.length >= 9)).toBe(true)
    expect(demoSamples.some((sample) => sample.lyricLine.includes('심 장'))).toBe(true)
    expect(demoSamples.some((sample) => sample.lyricLine.includes('비 가 내 린 밤'))).toBe(true)
  })
})
