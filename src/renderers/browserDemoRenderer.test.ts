import { describe, expect, it } from 'vitest'
import { demoProject } from '../demoProject'
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
})

function energy(samples: Float32Array) {
  return samples.reduce((sum, sample) => sum + Math.abs(sample), 0) / samples.length
}
