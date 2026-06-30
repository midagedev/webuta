import { describe, expect, it } from 'vitest'
import { summarizeDefaultDemoSmoke } from './audit-default-demo-render.mjs'

describe('default demo render audit report', () => {
  it('passes a browser smoke report with V3 demo evidence and DAW-ready WAV', () => {
    const report = summarizeDefaultDemoSmoke({
      ok: true,
      mode: 'static',
      url: 'http://127.0.0.1:5173/',
      checks: [
        'default V3 voicebank loaded',
        'first-run demo aliases fully matched',
        'first-run demo render warnings clear',
        'first-run lyric visible',
        'community release readiness card visible',
        'voicebank license metadata visible',
        'selected-note vibrato controls visible',
        'community listening review scorecard linked',
        'selected-note UTAU sample preview available',
        'desktop WAV download',
        'render history visible',
        'desktop no page horizontal overflow',
        'desktop piano keyboard and bar ruler visible',
        'mobile export controls visible',
        'mobile touch keyboard visible',
        'mobile piano keyboard and bar ruler visible',
        'mobile no page horizontal overflow',
      ],
      download: {
        fileName: 'First-Vocal-Sketch.wav',
        wav: {
          sampleRate: 44100,
          channels: 1,
          bitsPerSample: 16,
          durationSeconds: 6.55,
          bytes: 578384,
        },
      },
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('default-demo-render-pass')
    expect(report.problems).toEqual([])
  })

  it('fails when the first-run demo lacks coverage evidence or WAV quality', () => {
    const report = summarizeDefaultDemoSmoke({
      ok: true,
      mode: 'static',
      checks: ['desktop WAV download'],
      download: {
        fileName: 'demo.wav',
        wav: {
          sampleRate: 48000,
          channels: 2,
          bitsPerSample: 24,
          durationSeconds: 2,
          bytes: 1000,
        },
      },
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('default-demo-render-fail')
    expect(report.problems.join('\n')).toContain('missing smoke check: default V3 voicebank loaded')
    expect(report.problems.join('\n')).toContain('WAV sampleRate 48000')
  })
})
