import { describe, expect, it } from 'vitest'
import { demoProject } from './demoProject'
import {
  durationTicksToSeconds,
  normalizedTempoChanges,
  projectDurationSeconds,
  secondsToTicksInProject,
  tickPositionLabel,
  ticksToSecondsInProject,
} from './music'

describe('tempo map timing helpers', () => {
  it('keeps single-tempo projects compatible with the old BPM conversion', () => {
    const expectedSeconds = (960 / 480) * (60 / demoProject.bpm)

    expect(ticksToSecondsInProject(960, demoProject)).toBeCloseTo(expectedSeconds, 6)
    expect(secondsToTicksInProject(expectedSeconds, demoProject)).toBe(960)
  })

  it('integrates tempo changes across tick ranges', () => {
    const project = {
      ...demoProject,
      bpm: 120,
      tempoChanges: [
        { position: 0, bpm: 120 },
        { position: 480, bpm: 60 },
        { position: 960, bpm: 180 },
      ],
      parts: [{ ...demoProject.parts[0], duration: 1440 }],
      notes: [{ ...demoProject.notes[0], start: 0, duration: 1440 }],
    }

    expect(normalizedTempoChanges(project)).toEqual([
      { position: 0, bpm: 120 },
      { position: 480, bpm: 60 },
      { position: 960, bpm: 180 },
    ])
    expect(ticksToSecondsInProject(480, project)).toBeCloseTo(0.5, 6)
    expect(ticksToSecondsInProject(960, project)).toBeCloseTo(1.5, 6)
    expect(ticksToSecondsInProject(1440, project)).toBeCloseTo(1.833333, 5)
    expect(durationTicksToSeconds(project, 240, 720)).toBeCloseTo(1.25, 6)
    expect(secondsToTicksInProject(1.5, project)).toBe(960)
    expect(projectDurationSeconds(project)).toBeCloseTo(2.166667, 5)
  })

  it('formats DAW-style bar and beat labels for tempo markers', () => {
    expect(tickPositionLabel(0, demoProject)).toBe('1:1')
    expect(tickPositionLabel(960, demoProject)).toBe('1:3')
    expect(tickPositionLabel(2040, demoProject)).toBe('2:1+120')
    expect(tickPositionLabel(1440, { ...demoProject, beatPerBar: 3 })).toBe('2:1')
  })
})
