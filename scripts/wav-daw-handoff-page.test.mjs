import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { validateHandoffReport } from './accept-wav-daw-handoff.mjs'

describe('WAV DAW handoff report builder page', () => {
  it('generates a report accepted by the release handoff validator', async () => {
    const html = readFileSync(resolve('public/review/wav-daw/index.html'), 'utf8')
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'https://midagedev.github.io/webuta/review/wav-daw/index.html',
    })
    const { document } = dom.window
    const route = document.querySelector('[aria-label="60-second physical handoff path"]')
    const starterReference = document.querySelector('[aria-label="Starter WAV reference"]')
    const afterDownload = document.querySelector('[aria-label="After handoff report download"]')

    expect(route?.textContent).toContain('manual evidence only after real DAW import')
    expect(route?.textContent).toContain('Open the public app')
    expect(route?.textContent).toContain('Export the starter WAV')
    expect(route?.textContent).toContain('Import into the DAW')
    expect(route?.textContent).toContain('Save the report')
    expect(starterReference?.textContent).toContain('First-Vocal-Sketch.wav')
    expect(starterReference?.textContent).toContain('44.1 kHz mono 16-bit')
    expect(starterReference?.textContent).toContain('네 오 빛 이 메 로 디 로 데 려 가')
    expect(afterDownload?.textContent).toContain('After downloading this report')
    expect(afterDownload?.textContent).toContain('listening-scores.local.json')
    expect(afterDownload?.textContent).toContain('Evidence Preflight')
    expect(afterDownload?.textContent).toContain('npm run release:evidence-status')
    expect(afterDownload?.textContent).toContain('npm run release:accept-evidence')

    fill(document, 'reviewer', 'release reviewer')
    fill(document, 'decision', 'community-ready')
    fill(document, 'verifiedAt', '2026-07-01T09:00')
    fill(document, 'device', 'iPad')
    fill(document, 'osVersion', 'iPadOS 26')
    fill(document, 'browser', 'Safari')
    fill(document, 'targetDaw', 'GarageBand iPad')
    fill(document, 'homeScreenStatus', 'pass')
    fill(document, 'durationSeconds', '6.55')
    fill(document, 'exportMethod', 'share')
    fill(document, 'importedRegionVisible', 'true')
    fill(document, 'noConversionError', 'true')
    for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
      checkbox.checked = true
    }
    document.querySelector('#handoffForm').dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    const report = JSON.parse(document.querySelector('#jsonPreview').textContent)
    const problems = validateHandoffReport(report, [])

    expect(problems).toEqual([])
    expect(report.reviewId).toBe('webuta-wav-daw-handoff-v1')
    expect(report.defaultVoicebank).toBe('WebUtau Korean V3 Synthetic')
    expect(report.renderedWav).toMatchObject({
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 16,
      durationSeconds: 6.55,
    })
    expect(document.querySelector('#problemSummary').textContent).toBe('Handoff report is ready to download.')
  })
})

function fill(document, name, value) {
  const field = document.querySelector(`[name="${name}"]`)
  field.value = value
}
