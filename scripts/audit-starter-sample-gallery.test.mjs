import { describe, expect, it } from 'vitest'
import { STARTER_SAMPLES, summarizeStarterSampleRenders } from './audit-starter-sample-gallery.mjs'

describe('starter sample gallery render audit', () => {
  it('passes when every varied starter sample renders a DAW-ready non-silent WAV', () => {
    const report = summarizeStarterSampleRenders({
      url: 'http://127.0.0.1:5173/',
      renderedSamples: STARTER_SAMPLES.map((sample, index) => ({
        ...sample,
        fileName: `${sample.projectName.replaceAll(' ', '-')}.wav`,
        wav: makeWav({ durationSeconds: 3.4 + index * 0.2 }),
        dawBundle: makeDawBundle(sample, index),
      })),
    })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('starter-sample-gallery-render-pass')
    expect(report.sampleCount).toBe(12)
    expect(report.diversity).toMatchObject({
      moodCount: 12,
      bestForCount: 12,
      listeningCueCount: 12,
      vocalFocusCount: 12,
      lyricLineCount: 12,
      chordLineCount: 12,
      tempoBandCount: 4,
      codaSampleCount: 11,
    })
    expect(report.samples.every((sample) => sample.passed)).toBe(true)
    expect(report.samples.every((sample) => sample.dawBundle?.passed)).toBe(true)
  })

  it('fails when a sample is missing or renders a silent/short WAV', () => {
    const report = summarizeStarterSampleRenders({
      renderedSamples: [
        {
          ...STARTER_SAMPLES[0],
          fileName: 'First-Vocal-Sketch.wav',
          wav: makeWav({ durationSeconds: 1.2, peak: 0.001, rms: 0.0001 }),
        },
      ],
    })

    expect(report.ok).toBe(false)
    expect(report.decision).toBe('starter-sample-gallery-render-fail')
    expect(report.problems.join('\n')).toContain('rendered sample count 1')
    expect(report.problems.join('\n')).toContain('missing rendered starter sample: Blue Hour')
    expect(report.problems.join('\n')).toContain('Neon Lift: WAV duration 1.200s')
    expect(report.problems.join('\n')).toContain('Neon Lift: WAV peak 0.0010')
    expect(report.problems.join('\n')).toContain('Neon Lift: DAW handoff bundle missing')
  })
})

function makeWav(overrides = {}) {
  return {
    sampleRate: 44100,
    channels: 1,
    bitsPerSample: 16,
    durationSeconds: 4,
    bytes: 352_844,
    peak: 0.42,
    rms: 0.08,
    ...overrides,
  }
}

function makeDawBundle(sample, index = 0) {
  return {
    fileName: `${sample.projectName.replaceAll(' ', '-')}-daw-handoff.zip`,
    bytes: 450_000 + index * 1000,
    format: 'webuta-daw-handoff-bundle',
    version: 4,
    projectName: sample.projectName,
    noteCount: sample.noteCount,
    lyricLine: sample.lyricLine,
    chordLine: sample.chordLine.replaceAll(' -> ', '  '),
    requiredFileCount: 12,
    wav: makeWav(),
    midi: {
      melodyFile: `guide/${sample.projectName.replaceAll(' ', '-')}-melody.mid`,
      chordFile: `guide/${sample.projectName.replaceAll(' ', '-')}-chords.mid`,
      ppq: 480,
      melodyBytes: 260,
      chordBytes: 210,
    },
    project: {
      projectName: sample.projectName,
      noteCount: sample.noteCount,
      lyricLine: sample.lyricLine,
    },
    sidecars: {
      lyricLinePresent: true,
      noteRows: sample.noteCount,
      chordSymbols: sample.chordLine.split(' -> '),
    },
    passed: true,
    problems: [],
  }
}
