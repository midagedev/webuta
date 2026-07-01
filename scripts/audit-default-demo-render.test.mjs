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
        'first-run starter guide visible',
        'first-run beginner start panel visible',
        'first-run context drawer visible',
        'first-run onboarding coach visible',
        'first-run one-minute path visible',
        'first-run starter chord guide visible',
        'first-run route map visible',
        'first-run route state badges visible',
        'first-run three-step checklist visible',
        'first-run quick-start CTA visible',
        'first-run starter launch panel visible',
        'first-run inline lyric input visible',
        'first-run lyric helper visible',
        'first-run current lyric card visible',
        'first-run utility actions visible',
        'first-run DAW handoff checklist visible',
        'first-run release evidence links visible',
        'first-run sketch cues visible',
        'tempo map controls visible',
        'Korean mode navigation visible',
        'first-run demo aliases fully matched',
        'first-run demo render warnings clear',
        'first-run lyric visible',
        'community release readiness card visible',
        'manual release evidence checklist visible',
        'voicebank license metadata visible',
        'voicebank self-generated origin visible',
        'selected-note dynamics controls visible',
        'selected-note resampler controls visible',
        'selected-note timing controls visible',
        'selected-note envelope controls visible',
        'selected-note vibrato controls visible',
        'selected-note pitch bend controls visible',
        'selected-note duplicate controls visible',
        'classic UST import/export controls visible',
        'DAW handoff bundle export visible',
        'community release review hub linked',
        'community evidence preflight linked',
        'community listening review scorecard linked',
        'selected-note UTAU sample preview available',
        'desktop WAV download',
        'desktop DAW handoff bundle download',
        'desktop DAW handoff bundle MIDI guides',
        'render history visible',
        'desktop no page horizontal overflow',
        'desktop piano keyboard and bar ruler visible',
        'desktop arrangement chord guide visible',
        'mobile export controls visible',
        'mobile touch keyboard visible',
        'mobile piano keyboard and bar ruler visible',
        'mobile arrangement chord guide visible',
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
      dawBundle: {
        fileName: 'First-Vocal-Sketch-daw-handoff.zip',
        bytes: 612000,
        format: 'webuta-daw-handoff-bundle',
        version: 4,
        projectName: 'First Vocal Sketch',
        files: [
          'audio/First-Vocal-Sketch.wav',
          'project/First-Vocal-Sketch.webutau.json',
          'project/First-Vocal-Sketch.ustx',
          'project/First-Vocal-Sketch.ust',
          'guide/First-Vocal-Sketch-melody.mid',
          'guide/First-Vocal-Sketch-chords.mid',
          'project/arrangement.txt',
          'project/chords.csv',
          'project/lyrics.txt',
          'project/notes.csv',
          'manifest.json',
          'README.txt',
        ],
        midi: {
          melodyFile: 'guide/First-Vocal-Sketch-melody.mid',
          chordFile: 'guide/First-Vocal-Sketch-chords.mid',
          ppq: 480,
          melodyBytes: 240,
          chordBytes: 220,
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
