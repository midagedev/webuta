import { describe, expect, it } from 'vitest'
import { demoProject } from '../demoProject'
import { browserDemoRenderer } from './browserDemoRenderer'

describe('browser demo renderer', () => {
  it('renders non-silent mono samples', async () => {
    const result = await browserDemoRenderer.render(demoProject)
    const peak = result.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)

    expect(result.sampleRate).toBe(44100)
    expect(result.samples.length).toBeGreaterThan(44100)
    expect(peak).toBeGreaterThan(0.05)
  })
})
