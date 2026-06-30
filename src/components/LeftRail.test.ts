import { render, screen } from '@testing-library/svelte'
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
    selectedRendererId: 'utau-sample',
    selectedNeuralModelId: '',
    neuralModels: [] as NeuralModelCard[],
    notice: `${BUNDLED_UTAU_VOICEBANK_NAME}: 1437 aliases`,
    onVoicebankFile: vi.fn(),
    onBpm: vi.fn(),
    onBeat: vi.fn(),
    onRenderer: vi.fn(),
    onNeuralModel: vi.fn(),
    onLyric: vi.fn(),
    onTone: vi.fn(),
    onNudge: vi.fn(),
    onDuration: vi.fn(),
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
    entries: [],
    aliases: [],
    sampleCount: 1437,
    wavCount: 615,
    readSample: vi.fn(),
  }
}
