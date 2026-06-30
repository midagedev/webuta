import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import LeftRail from './LeftRail.svelte'
import { BUNDLED_UTAU_VOICEBANK_NAME } from '../bundledVoicebank'
import { demoProject } from '../demoProject'
import type { NeuralModelCard, SongProject } from '../types'
import type { LoadedVoicebank, VoicebankCoverage, VoicebankRenderWarningReport } from '../voicebank'

describe('LeftRail release readiness', () => {
  it('shows bundled V3 automated checks while keeping human listening review explicit', () => {
    render(LeftRail, makeProps())

    const releaseCard = screen.getByLabelText('Community release readiness')
    expect(releaseCard.textContent).toContain('V3 자동 점검 통과')
    expect(releaseCard.textContent).toContain('남은 단계: 생성된 WAV 청취 점수 저장')
    expect(releaseCard.textContent).toContain('V3 번들')
    expect(releaseCard.textContent).toContain('기본 합성 UTAU 선택됨')
    expect(releaseCard.textContent).toContain('8/8 notes')
    expect(releaseCard.textContent).toContain('0 warnings')
    expect(releaseCard.textContent).toContain('listening-scores.local.json 필요')
    expect(screen.getByRole('link', { name: '청취 리뷰 열기' }).getAttribute('href')).toBe('/review/v3/index.html')
    const licenseCard = screen.getByLabelText('Voicebank license metadata')
    expect(licenseCard.textContent).toContain('번들 V3 라이선스 포함')
    expect(licenseCard.textContent).toContain('Generated original sample data')
  })

  it('does not mark imported user zips as the bundled V3 release voicebank', () => {
    render(
      LeftRail,
      makeProps({
        voicebankName: 'WebUtau // Test Teto',
        voicebankCacheStatus: 'saved',
        voicebank: { ...makeVoicebank(), name: 'WebUtau // Test Teto' },
      }),
    )

    const releaseCard = screen.getByLabelText('Community release readiness')
    expect(releaseCard.textContent).toContain('V3 공개 점검 필요')
    expect(releaseCard.textContent).toContain('사용자 ZIP 모드')
    expect(screen.getByLabelText('Voicebank license metadata').textContent).toContain('사용자 ZIP 라이선스 포함')
  })

  it('edits selected-note vibrato as a DAW parameter', async () => {
    const onVibrato = vi.fn()
    render(LeftRail, makeProps({ onVibrato }))

    const vibratoCard = screen.getByLabelText('Selected note vibrato')
    expect(vibratoCard.textContent).toContain('비브라토')
    expect(vibratoCard.textContent).toContain('16c')

    const depthSlider = vibratoCard.querySelector('input[type="range"]') as HTMLInputElement
    await fireEvent.input(depthSlider, { target: { value: '34' } })

    expect(onVibrato).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        depthCents: 34,
        rateHz: 5.4,
        startPercent: 52,
      }),
    )
  })

  it('edits selected-note intensity as a dynamics parameter', async () => {
    const onIntensity = vi.fn()
    render(LeftRail, makeProps({ onIntensity }))

    const dynamicsCard = screen.getByLabelText('Selected note dynamics')
    expect(dynamicsCard.textContent).toContain('세기')
    expect(dynamicsCard.textContent).toContain('100%')

    await fireEvent.input(screen.getByLabelText('Note intensity'), { target: { value: '73' } })

    expect(onIntensity).toHaveBeenCalledWith(73)
  })

  it('edits selected-note envelope as UST dynamics', async () => {
    const onEnvelope = vi.fn()
    render(LeftRail, makeProps({ onEnvelope }))

    const envelopeCard = screen.getByLabelText('Selected note envelope')
    expect(envelopeCard.textContent).toContain('엔벨로프')
    expect(envelopeCard.textContent).toContain('어택')
    expect(envelopeCard.textContent).toContain('릴리즈')

    await fireEvent.input(screen.getByLabelText('Envelope attack'), { target: { value: '42' } })

    expect(onEnvelope).toHaveBeenCalledWith({
      p1Ms: 0,
      p2Ms: 42,
      p3Ms: 35,
      v1: 0,
      v2: 100,
      v3: 100,
      v4: 0,
    })
  })

  it('edits selected-note pitch bend as a simple curve', async () => {
    const onPitchBend = vi.fn()
    render(LeftRail, makeProps({ onPitchBend }))

    const pitchBendCard = screen.getByLabelText('Selected note pitch bend')
    expect(pitchBendCard.textContent).toContain('피치 벤드')
    expect(pitchBendCard.textContent).toContain('OFF')

    const enabledToggle = pitchBendCard.querySelector('input[type="checkbox"]') as HTMLInputElement
    await fireEvent.change(enabledToggle, { target: { checked: true } })

    expect(onPitchBend).toHaveBeenLastCalledWith({
      points: [
        { timePercent: 0, cents: 0 },
        { timePercent: 50, cents: 40 },
        { timePercent: 100, cents: 0 },
      ],
      modes: ['s', 's'],
    })
  })

  it('updates an imported pitch bend curve from the selected-note controls', async () => {
    const onPitchBend = vi.fn()
    const project = makeProject()
    project.notes[0] = {
      ...project.notes[0],
      pitchBend: {
        points: [
          { timePercent: 0, cents: 0 },
          { timePercent: 45, cents: -80 },
          { timePercent: 100, cents: 0 },
        ],
        modes: ['s', 'r'],
      },
    }
    render(LeftRail, makeProps({ project, selectedNote: project.notes[0], onPitchBend }))

    const pitchBendCard = screen.getByLabelText('Selected note pitch bend')
    expect(pitchBendCard.textContent).toContain('ON')
    expect(pitchBendCard.textContent).toContain('-80c')

    await fireEvent.input(screen.getByLabelText('Pitch bend amount'), { target: { value: '120' } })

    expect(onPitchBend).toHaveBeenLastCalledWith({
      points: [
        { timePercent: 0, cents: 0 },
        { timePercent: 45, cents: 120 },
        { timePercent: 100, cents: 0 },
      ],
      modes: ['s', 's'],
    })
  })
})

function makeProps(overrides: Partial<Record<string, unknown>> = {}) {
  const project = makeProject()
  const voicebank = makeVoicebank()
  const coverage: VoicebankCoverage = {
    totalNotes: 8,
    matchedNotes: 8,
    fallbackNotes: 0,
    uniqueLyrics: 6,
    matchedLyrics: ['도', '히', '다', '이', '스', '키'],
    fallbackLyrics: [],
  }
  const warnings: VoicebankRenderWarningReport = {
    totalNotes: 8,
    warningCount: 0,
    errorCount: 0,
    warnings: [],
  }
  const base = {
    project,
    selectedNote: project.notes[0],
    selectedLyricMatch: {
      lyric: '도',
      targetAlias: '도',
      candidates: [],
      quality: 'exact',
    },
    voicebank,
    voicebankName: BUNDLED_UTAU_VOICEBANK_NAME,
    voicebankCoverage: coverage,
    voicebankWarnings: warnings,
    voicebankCacheStatus: 'bundled',
    isLoadingVoicebank: false,
    isPreviewingVoicebankSample: false,
    selectedRendererId: 'utau-sample',
    selectedNeuralModelId: '',
    neuralModels: [] as NeuralModelCard[],
    notice: `${BUNDLED_UTAU_VOICEBANK_NAME}: 1437 aliases`,
    onVoicebankFile: vi.fn(),
    onPreviewVoicebankSample: vi.fn(),
    onBpm: vi.fn(),
    onBeat: vi.fn(),
    onRenderer: vi.fn(),
    onNeuralModel: vi.fn(),
    onLyric: vi.fn(),
    onTone: vi.fn(),
    onNudge: vi.fn(),
    onDuration: vi.fn(),
    onIntensity: vi.fn(),
    onEnvelope: vi.fn(),
    onVibrato: vi.fn(),
    onPitchBend: vi.fn(),
    onAddNote: vi.fn(),
    onSplitNote: vi.fn(),
    onDeleteNote: vi.fn(),
  }
  return { ...base, ...overrides }
}

function makeProject(): SongProject {
  return {
    ...demoProject,
    tracks: demoProject.tracks.map((track) => ({ ...track })),
    parts: demoProject.parts.map((part) => ({ ...part })),
    notes: demoProject.notes.map((note) => ({ ...note })),
  }
}

function makeVoicebank(): LoadedVoicebank {
  return {
    id: 'webuta-ko-v3-synthetic',
    name: BUNDLED_UTAU_VOICEBANK_NAME,
    sourceFileName: 'webuta-ko-v3.zip',
    metadata: {
      characterPath: 'character.yaml',
      readme: {
        path: 'readme.txt',
        excerpt: 'WebUtau Korean V3 Synthetic generated voicebank.',
      },
      license: {
        path: 'license.txt',
        excerpt: 'Generated original sample data and metadata may be redistributed under the MIT license.',
      },
      manifestPath: 'webuta-ko-v3.manifest.json',
      licenseStatus: 'license-file-present',
    },
    entries: [],
    aliases: [],
    sampleCount: 1437,
    wavCount: 615,
    readSample: vi.fn(),
  }
}
