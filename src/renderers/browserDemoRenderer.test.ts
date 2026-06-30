import { describe, expect, it } from 'vitest'
import { demoProject } from '../demoProject'
import { TICKS_PER_BEAT } from '../types'
import { browserDemoRenderer, koreanDemoVoiceProfile } from './browserDemoRenderer'

describe('browser demo renderer', () => {
  it('uses a Korean guide voice identity', () => {
    expect(browserDemoRenderer.capability.name).toBe('Korean Demo Voice')
    expect(browserDemoRenderer.capability.notes).toContain('Hangul syllables')
  })

  it('decomposes Hangul lyrics into onset vowel and coda profiles', () => {
    const doProfile = koreanDemoVoiceProfile('도')
    const hiProfile = koreanDemoVoiceProfile('히')
    const hanProfile = koreanDemoVoiceProfile('한')

    expect(doProfile).toMatchObject({ onset: 'ㄷ', vowel: 'ㅗ', coda: '' })
    expect(hiProfile).toMatchObject({ onset: 'ㅎ', vowel: 'ㅣ', coda: '' })
    expect(hanProfile).toMatchObject({ onset: 'ㅎ', vowel: 'ㅏ', coda: 'ㄴ' })
    expect(hiProfile.brightness).toBeGreaterThan(doProfile.brightness)
    expect(hanProfile.codaTone).toBeGreaterThan(doProfile.codaTone)
    expect(hanProfile.codaDamp).toBeLessThan(doProfile.codaDamp)
  })

  it('renders non-silent mono samples', async () => {
    const result = await browserDemoRenderer.render(demoProject)
    const peak = result.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)

    expect(result.sampleRate).toBe(44100)
    expect(result.samples.length).toBeGreaterThan(44100)
    expect(peak).toBeGreaterThan(0.05)
  })

  it('renders Korean consonant attacks into the note onset', async () => {
    const result = await browserDemoRenderer.render({
      ...demoProject,
      notes: [
        { ...demoProject.notes[0], id: 'soft', start: 0, lyric: '아', tone: 60 },
        { ...demoProject.notes[1], id: 'sharp', start: 960, lyric: '카', tone: 60 },
      ],
    })
    const softOnset = energy(result.samples.slice(80, 1200))
    const sharpStart = Math.floor((960 / 480) * (60 / demoProject.bpm) * 44100)
    const sharpOnset = energy(result.samples.slice(sharpStart + 80, sharpStart + 1200))

    expect(sharpOnset).toBeGreaterThan(softOnset * 1.1)
  })

  it('renders per-note pitch bend curves into the oscillator voice', async () => {
    const baseNote = {
      ...demoProject.notes[0],
      id: 'bend',
      duration: TICKS_PER_BEAT * 3,
      tone: 60,
      lyric: '라',
      vibrato: { enabled: false, depthCents: 0, rateHz: 5.4, startPercent: 52 },
    }
    const straight = await browserDemoRenderer.render({
      ...demoProject,
      notes: [baseNote],
    })
    const bent = await browserDemoRenderer.render({
      ...demoProject,
      notes: [
        {
          ...baseNote,
          pitchBend: {
            points: [
              { timePercent: 0, cents: 0 },
              { timePercent: 50, cents: 500 },
              { timePercent: 100, cents: 0 },
            ],
          },
        },
      ],
    })
    const difference = bent.samples.reduce((sum, sample, index) => sum + Math.abs(sample - (straight.samples[index] ?? 0)), 0)

    expect(difference).toBeGreaterThan(20)
  })

  it('renders per-note intensity as relative dynamics', async () => {
    const result = await browserDemoRenderer.render({
      ...demoProject,
      bpm: 120,
      notes: [
        { ...demoProject.notes[0], id: 'quiet', start: 0, duration: TICKS_PER_BEAT, tone: 60, lyric: '라', intensity: 45 },
        { ...demoProject.notes[1], id: 'loud', start: TICKS_PER_BEAT * 2, duration: TICKS_PER_BEAT, tone: 60, lyric: '라', intensity: 160 },
      ],
    })
    const quiet = energy(result.samples.slice(Math.floor(0.12 * 44100), Math.floor(0.48 * 44100)))
    const loud = energy(result.samples.slice(Math.floor(1.12 * 44100), Math.floor(1.48 * 44100)))

    expect(loud).toBeGreaterThan(quiet * 2)
  })

  it('renders per-note envelope as a volume curve', async () => {
    const result = await browserDemoRenderer.render({
      ...demoProject,
      bpm: 120,
      notes: [
        {
          ...demoProject.notes[0],
          id: 'enveloped',
          start: 0,
          duration: TICKS_PER_BEAT * 2,
          tone: 60,
          lyric: '라',
          envelope: { p1Ms: 0, p2Ms: 20, p3Ms: 80, v1: 0, v2: 100, v3: 25, v4: 0 },
        },
        { ...demoProject.notes[1], id: 'plain', start: TICKS_PER_BEAT * 3, duration: TICKS_PER_BEAT * 2, tone: 60, lyric: '라' },
      ],
    })
    const envelopedBody = energy(result.samples.slice(Math.floor(0.52 * 44100), Math.floor(0.88 * 44100)))
    const plainBody = energy(result.samples.slice(Math.floor(2.02 * 44100), Math.floor(2.38 * 44100)))

    expect(plainBody).toBeGreaterThan(envelopedBody * 2)
  })
})

function energy(samples: Float32Array) {
  return samples.reduce((sum, sample) => sum + Math.abs(sample), 0) / samples.length
}
