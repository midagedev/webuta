<script lang="ts">
  import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ExternalLink,
    Plus,
    Scissors,
    ShieldCheck,
    Sparkles,
    Trash2,
    Upload,
    Volume2,
  } from '@lucide/svelte'
  import cyberVocalHero from '../assets/cyber-vocal-hero.webp'
  import { BUNDLED_UTAU_VOICEBANK_NAME } from '../bundledVoicebank'
  import { normalizeNoteEnvelope, sanitizeOptionalNoteEnvelope } from '../envelope'
  import { normalizeNoteIntensity, normalizeNoteModulation, normalizeNoteVelocity, sanitizeOptionalNoteFlags } from '../expression'
  import { normalizeNotePitchBend, sanitizeOptionalNotePitchBend } from '../pitchBend'
  import { GRID_SNAP_TICKS } from '../projectEditing'
  import { normalizeNoteTiming, sanitizeOptionalNoteTiming } from '../timing'
  import type { NeuralModelCard, NoteEnvelope, NotePitchBend, NoteTiming, NoteVibrato, RendererId, SongNote, SongProject } from '../types'
  import type { LoadedVoicebank, LyricEntryMatch, VoicebankCoverage, VoicebankRenderWarningReport } from '../voicebank'
  import { normalizeNoteVibrato } from '../vibrato'
  import { rendererCapabilities } from '../renderers/registry'
  import {
    formatCoverageMessage,
    formatLyricMatch,
    formatVoicebankCacheStatus,
    formatVoicebankCoverage,
    inputValue,
    type VoicebankCacheStatus,
  } from '../app/ui'
  import { normalizedTempoChanges, tickPositionLabel, toneName } from '../music'

  type Props = {
    project: SongProject
    selectedNote: SongNote | undefined
    selectedLyricMatch: LyricEntryMatch | null
    voicebank: LoadedVoicebank | null
    voicebankName: string
    voicebankCoverage: VoicebankCoverage | null
    voicebankWarnings: VoicebankRenderWarningReport | null
    voicebankCacheStatus: VoicebankCacheStatus
    isLoadingVoicebank: boolean
    isPreviewingVoicebankSample: boolean
    selectedRendererId: RendererId
    selectedNeuralModelId: string
    neuralModels: NeuralModelCard[]
    notice: string
    onVoicebankFile: (file: File) => Promise<void>
    onPreviewVoicebankSample: () => void
    onBpm: (bpm: number) => void
    onBeat: (beatPerBar: number, beatUnit: number) => void
    onTempoChange: (position: number, bpm: number) => void
    onRemoveTempoChange: (position: number) => void
    onTransposeProject: (semitones: number) => void
    onRenderer: (renderer: RendererId) => void
    onNeuralModel: (modelId: string) => void
    onLyric: (lyric: string) => void
    onTone: (tone: number) => void
    onNudge: (patch: Partial<SongNote>) => void
    onDuration: (duration: number) => void
    onIntensity: (intensity: number) => void
    onTiming: (timing: NoteTiming | undefined) => void
    onEnvelope: (envelope: NoteEnvelope | undefined) => void
    onVibrato: (vibrato: NoteVibrato) => void
    onPitchBend: (pitchBend: NotePitchBend | undefined) => void
    onAddNote: () => void
    onSplitNote: () => void
    onDeleteNote: () => void
  }

  let {
    project,
    selectedNote,
    selectedLyricMatch,
    voicebank,
    voicebankName,
    voicebankCoverage,
    voicebankWarnings,
    voicebankCacheStatus,
    isLoadingVoicebank,
    isPreviewingVoicebankSample,
    selectedRendererId,
    selectedNeuralModelId,
    neuralModels,
    notice,
    onVoicebankFile,
    onPreviewVoicebankSample,
    onBpm,
    onBeat,
    onTempoChange,
    onRemoveTempoChange,
    onTransposeProject,
    onRenderer,
    onNeuralModel,
    onLyric,
    onTone,
    onNudge,
    onDuration,
    onIntensity,
    onTiming,
    onEnvelope,
    onVibrato,
    onPitchBend,
    onAddNote,
    onSplitNote,
    onDeleteNote,
  }: Props = $props()

  let voicebankInput: HTMLInputElement
  let newTempoMarkerBpm = $state<number | null>(null)

  async function handleVoicebankFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
      await onVoicebankFile(file)
    }
    input.value = ''
  }

  function handleBeat(event: Event) {
    const [beatPerBar, beatUnit] = inputValue(event).split('/').map(Number)
    onBeat(beatPerBar, beatUnit)
  }

  function rendererStatusLabel(status: 'ready' | 'planned' | 'blocked') {
    if (status === 'ready') {
      return 'Ready'
    }
    if (status === 'blocked') {
      return 'Setup required'
    }
    return 'Planned'
  }

  function releaseStatusLabel(status: NeuralModelCard['releaseStatus']) {
    if (status === 'local-research') {
      return 'Research'
    }
    if (status === 'private-lab') {
      return 'Private'
    }
    if (status === 'public-beta') {
      return 'Beta'
    }
    if (status === 'user-provided') {
      return 'User'
    }
    if (status === 'bundled') {
      return 'Bundled'
    }
    return 'Planned'
  }

  function formatProjectRange(notes: SongNote[]) {
    if (notes.length === 0) {
      return 'no notes'
    }
    const tones = notes.map((note) => note.tone)
    return `${toneName(Math.min(...tones))}-${toneName(Math.max(...tones))}`
  }

  let selectedRenderWarnings = $derived(
    selectedNote && voicebankWarnings ? voicebankWarnings.warnings.filter((warning) => warning.noteId === selectedNote.id) : [],
  )
  let selectedIntensity = $derived(normalizeNoteIntensity(selectedNote?.intensity))
  let selectedVelocity = $derived(normalizeNoteVelocity(selectedNote?.velocity))
  let selectedModulation = $derived(normalizeNoteModulation(selectedNote?.modulation))
  let selectedTiming = $derived(normalizeNoteTiming(selectedNote?.timing))
  let selectedEnvelope = $derived(normalizeNoteEnvelope(selectedNote?.envelope))
  let selectedVibrato = $derived(normalizeNoteVibrato(selectedNote?.vibrato))
  let selectedPitchBend = $derived(normalizeNotePitchBend(selectedNote?.pitchBend))
  let selectedPitchBendEnabled = $derived(Boolean(selectedNote?.pitchBend && selectedPitchBend.points.length > 0))
  let selectedPitchBendPeak = $derived(pitchBendPeak(selectedPitchBend, selectedPitchBendEnabled))
  let selectedPitchBendPath = $derived(pitchPreviewPath(selectedPitchBend, selectedPitchBendEnabled))
  let selectedPitchBendPointCount = $derived(selectedPitchBendEnabled ? selectedPitchBend.points.length : 0)
  let selectedPitchBendMode = $derived(editablePitchMode(selectedPitchBend.modes?.[Math.max(0, selectedPitchBendPeak.index - 1)]))
  let selectedPitchBendSnapFirst = $derived(selectedPitchBendEnabled && selectedPitchBend.snapFirst === true)
  let tempoMap = $derived(normalizedTempoChanges(project))
  let tempoMarkerCountLabel = $derived(`${tempoMap.length} marker${tempoMap.length === 1 ? '' : 's'}`)
  let selectedTempoMarkerLabel = $derived(selectedNote ? tickPositionLabel(selectedNote.start, project) : '노트 선택')
  let projectRangeLabel = $derived(formatProjectRange(project.notes))
  let renderWarningPreview = $derived(voicebankWarnings?.warnings.slice(0, 3) ?? [])
  let isBundledDefaultVoicebank = $derived(
    Boolean(voicebank) && voicebankName === BUNDLED_UTAU_VOICEBANK_NAME && voicebankCacheStatus === 'bundled',
  )
  let releaseChecks = $derived([
    {
      label: 'V3 번들',
      passed: isBundledDefaultVoicebank,
      detail: isBundledDefaultVoicebank ? '기본 합성 UTAU 선택됨' : voicebank ? '사용자 ZIP 모드' : '보이스뱅크 로딩 대기',
    },
    {
      label: '가사 매칭',
      passed: Boolean(voicebankCoverage && voicebankCoverage.totalNotes > 0 && voicebankCoverage.fallbackNotes === 0),
      detail: voicebankCoverage ? `${voicebankCoverage.matchedNotes}/${voicebankCoverage.totalNotes} notes` : 'coverage 대기',
    },
    {
      label: '렌더 경고',
      passed: Boolean(voicebankWarnings && voicebankWarnings.warningCount === 0),
      detail: voicebankWarnings ? `${voicebankWarnings.warningCount} warnings` : 'diagnostics 대기',
    },
  ])
  let automatedReleaseChecksPass = $derived(releaseChecks.every((check) => check.passed))
  let releaseCardState = $derived(!voicebank ? 'idle' : automatedReleaseChecksPass ? 'review' : 'warning')
  let releaseCardTitle = $derived(
    !voicebank ? '공개 점검 대기' : automatedReleaseChecksPass ? 'V3 자동 점검 통과' : 'V3 공개 점검 필요',
  )
  let releaseCardSummary = $derived(
    automatedReleaseChecksPass
      ? '공개 전 마지막 2개 증거 파일만 남음'
      : '기본 번들, alias 매칭, 렌더 경고를 확인하세요.',
  )
  let releaseEvidenceProgress = $derived(automatedReleaseChecksPass ? '자동 3/3 통과 · 수동 0/2 남음' : '자동 점검 먼저 확인 · 수동 0/2 남음')
  let voicebankLicenseState = $derived(!voicebank ? 'idle' : voicebank.metadata.license ? 'ready' : 'warning')
  let voicebankOriginState = $derived(!voicebank ? 'idle' : isSelfGeneratedVoicebank(voicebank) ? 'ready' : 'warning')
  const releaseReviewHubHref = `${import.meta.env.BASE_URL}review/index.html`
  const evidencePreflightHref = `${import.meta.env.BASE_URL}review/index.html#evidence-preflight`
  const listeningReviewHref = `${import.meta.env.BASE_URL}review/v3/index.html`
  const wavDawHandoffHref = `${import.meta.env.BASE_URL}review/wav-daw/index.html`
  let reviewerRunwaySteps = $derived([
    { index: '01', label: 'Listen', detail: 'listening-scores.local.json', href: listeningReviewHref },
    { index: '02', label: 'Handoff', detail: 'handoff-report.local.json', href: wavDawHandoffHref },
    { index: '03', label: 'Preflight', detail: 'No upload check', href: evidencePreflightHref },
    { index: '04', label: 'Status', detail: 'release:evidence-status' },
    { index: '05', label: 'Accept', detail: 'release:accept-evidence' },
  ])

  function isSelfGeneratedVoicebank(current: LoadedVoicebank | null) {
    const origin = current?.metadata.origin
    return Boolean(
      origin?.generatedSynthetic &&
        origin.noHumanRecordingSource &&
        origin.noPublicOrPrivateRecordedDatasetSource &&
        origin.noThirdPartySingerOrCharacterSource &&
        origin.noTtsOrModelCheckpointOutput,
    )
  }

  function voicebankLicenseTitle() {
    if (!voicebank) {
      return '라이선스 대기'
    }
    if (isBundledDefaultVoicebank && voicebank.metadata.license) {
      return '번들 V3 라이선스 포함'
    }
    if (voicebank.metadata.license) {
      return '사용자 ZIP 라이선스 포함'
    }
    return '라이선스 파일 없음'
  }

  function voicebankLicenseSummary() {
    if (!voicebank) {
      return 'UTAU ZIP을 불러오면 license.txt/readme.txt를 확인합니다.'
    }
    if (voicebank.metadata.license) {
      return voicebank.metadata.license.excerpt
    }
    if (voicebank.metadata.readme) {
      return voicebank.metadata.readme.excerpt
    }
    return '이 보이스뱅크 ZIP 안에서 license.txt 또는 readme.txt를 찾지 못했습니다.'
  }

  function voicebankLicensePath() {
    if (!voicebank) {
      return '메타데이터 대기'
    }
    return voicebank.metadata.license?.path ?? voicebank.metadata.readme?.path ?? voicebank.metadata.characterPath ?? voicebank.sourceFileName
  }

  function voicebankOriginTitle() {
    if (!voicebank) {
      return '보이스 출처 대기'
    }
    if (isSelfGeneratedVoicebank(voicebank)) {
      return isBundledDefaultVoicebank ? '자체 생성 보이스' : '생성 출처 확인됨'
    }
    if (voicebank.metadata.origin?.parseError) {
      return 'manifest 읽기 실패'
    }
    if (voicebank.metadata.origin) {
      return '출처 확인 필요'
    }
    return '출처 manifest 없음'
  }

  function voicebankOriginSummary() {
    if (!voicebank) {
      return '기본 V3 또는 UTAU ZIP이 로드되면 생성 출처를 확인합니다.'
    }
    if (isSelfGeneratedVoicebank(voicebank)) {
      return '녹음 없음 · 데이터셋 없음 · TTS/모델 출력 아님'
    }
    if (voicebank.metadata.origin?.parseError) {
      return voicebank.metadata.origin.parseError
    }
    if (voicebank.metadata.origin) {
      return 'manifest에 자체 생성/무녹음 플래그가 충분하지 않습니다.'
    }
    return '사용자 ZIP은 license.txt/readme.txt에서 출처를 별도로 확인하세요.'
  }

  function voicebankOriginPath() {
    if (!voicebank) {
      return 'manifest 대기'
    }
    const origin = voicebank.metadata.origin
    return origin?.method ?? origin?.synthesisProfile ?? origin?.type ?? voicebank.metadata.manifestPath ?? voicebank.sourceFileName
  }

  function updateVibrato(patch: Partial<NoteVibrato>) {
    onVibrato(normalizeNoteVibrato({ ...selectedVibrato, ...patch }))
  }

  function updateEnvelope(patch: Partial<NoteEnvelope>) {
    onEnvelope(sanitizeOptionalNoteEnvelope({ ...selectedEnvelope, ...patch }))
  }

  function updateTiming(patch: Partial<NoteTiming>) {
    onTiming(sanitizeOptionalNoteTiming({ ...selectedTiming, ...patch }))
  }

  function updatePitchBend(patch: { enabled?: boolean; cents?: number; timePercent?: number; mode?: string; snapFirst?: boolean }) {
    const enabled = patch.enabled ?? selectedPitchBendEnabled
    if (!enabled) {
      onPitchBend(undefined)
      return
    }
    const current = selectedPitchBendEnabled && selectedPitchBend.points.some((point) => point.timePercent > 0 && point.timePercent < 100)
      ? selectedPitchBend
      : defaultPitchBend()
    const points = current.points.map((point) => ({ ...point }))
    const peak = pitchBendPeak(current, true)
    const peakIndex = Math.max(0, Math.min(points.length - 1, peak.index))
    if (patch.cents !== undefined) {
      points[peakIndex] = {
        ...points[peakIndex],
        cents: clampPitchBend(patch.cents),
      }
    }
    if (patch.timePercent !== undefined) {
      points[peakIndex] = {
        ...points[peakIndex],
        timePercent: clampPitchBendPointPercent(points, peakIndex, patch.timePercent),
      }
    }
    const modes = pitchBendModesForEditing(current, points.length)
    if (patch.mode !== undefined) {
      const mode = editablePitchMode(patch.mode)
      for (const index of adjacentPitchModeIndexes(peakIndex, modes.length)) {
        modes[index] = mode
      }
    }
    onPitchBend(
      sanitizeOptionalNotePitchBend({
        points,
        ...(modes.length > 0 ? { modes } : {}),
        snapFirst: patch.snapFirst ?? current.snapFirst ?? false,
      }),
    )
  }

  function updateTempoMarker(position: number, bpm: number) {
    const nextBpm = clampTempoBpm(bpm)
    if (position <= 0) {
      onBpm(nextBpm)
      return
    }
    onTempoChange(Math.max(0, Math.round(position)), nextBpm)
  }

  function addTempoMarkerAtSelection() {
    if (!selectedNote) {
      return
    }
    updateTempoMarker(selectedNote.start, newTempoMarkerBpm ?? project.bpm)
  }

  function clampTempoBpm(value: number) {
    return Math.max(40, Math.min(260, Number.isFinite(value) ? Math.round(value) : project.bpm))
  }

  function pitchBendPeak(pitchBend: NotePitchBend, enabled: boolean) {
    if (!enabled || pitchBend.points.length === 0) {
      return { timePercent: 50, cents: 40, index: 1 }
    }
    const allPoints = pitchBend.points.map((point, index) => ({ ...point, index }))
    const candidates = allPoints.filter((point) => point.timePercent > 0 && point.timePercent < 100)
    const points = candidates.length > 0 ? candidates : allPoints
    return points.reduce((peak, point) => (Math.abs(point.cents) > Math.abs(peak.cents) ? point : peak), points[0])
  }

  function pitchPreviewPath(pitchBend: NotePitchBend, enabled: boolean) {
    const points = enabled && pitchBend.points.length > 0 ? pitchBend.points : defaultPitchBend().points
    return points
      .map((point, index) => {
        const x = Math.max(2, Math.min(98, clampPitchBendPercentForPreview(point.timePercent)))
        const y = 20 - (clampPitchBend(point.cents) / 1200) * 16
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')
  }

  function defaultPitchBend(): NotePitchBend {
    return {
      points: [
        { timePercent: 0, cents: 0 },
        { timePercent: 50, cents: 40 },
        { timePercent: 100, cents: 0 },
      ],
      modes: ['l', 'l'],
      snapFirst: false,
    }
  }

  function pitchBendModesForEditing(pitchBend: NotePitchBend, pointCount: number) {
    return Array.from({ length: Math.max(0, pointCount - 1) }, (_, index) => pitchBend.modes?.[index] ?? 'l')
  }

  function adjacentPitchModeIndexes(pointIndex: number, modeCount: number) {
    const indexes = new Set<number>()
    if (modeCount <= 0) {
      return []
    }
    indexes.add(Math.max(0, Math.min(modeCount - 1, pointIndex - 1)))
    indexes.add(Math.max(0, Math.min(modeCount - 1, pointIndex)))
    return [...indexes]
  }

  function editablePitchMode(mode: unknown) {
    const value = String(mode ?? '').trim().toLowerCase()
    return value === 'i' || value === 'o' || value === 'io' || value === 'sp' ? value : 'l'
  }

  function clampPitchBend(value: number) {
    return Math.max(-1200, Math.min(1200, Number.isFinite(value) ? value : 0))
  }

  function clampPitchBendPercent(value: number) {
    return Math.max(10, Math.min(90, Number.isFinite(value) ? value : 50))
  }

  function clampPitchBendPointPercent(points: Array<{ timePercent: number }>, index: number, value: number) {
    const previous = points[index - 1]
    const next = points[index + 1]
    const min = previous ? previous.timePercent + 1 : 0
    const max = next ? next.timePercent - 1 : 100
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : points[index]?.timePercent ?? 50))
  }

  function clampPitchBendPercentForPreview(value: number) {
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50))
  }
</script>

<aside class="left-rail">
  <section class="tool-panel pattern-panel">
    <div class="panel-heading">
      <Sparkles size={18} aria-hidden="true" />
      <h2>패턴</h2>
    </div>
    <div class="mascot-card">
      <img src={cyberVocalHero} alt="Cyber vocal synth mascot illustration" />
      <div>
        <strong>Vocal Operator</strong>
        <span>tracker vocal mode</span>
      </div>
    </div>
    <div class="channel-strip">
      <div class="track-avatar">
        <img src={cyberVocalHero} alt="" aria-hidden="true" />
      </div>
      <div class="track-copy">
        <strong>{project.tracks[0]?.name ?? 'Main Vocal'}</strong>
        <span>{voicebankName}</span>
      </div>
      <Volume2 size={18} aria-hidden="true" />
    </div>
    <div class="channel-meter" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span><span></span>
    </div>
    <label class="field-label">
      BPM
      <input type="number" min="60" max="220" value={project.bpm} oninput={(event) => onBpm(Number(inputValue(event)) || 120)} />
    </label>
    <label class="field-label">
      박자
      <select value={`${project.beatPerBar}/${project.beatUnit}`} onchange={handleBeat}>
        <option value="4/4">4/4</option>
        <option value="3/4">3/4</option>
        <option value="6/8">6/8</option>
      </select>
    </label>
    <div class="transpose-card" aria-label="Project transpose">
      <div class="tempo-map-head">
        <strong>키 이동</strong>
        <span>{projectRangeLabel}</span>
      </div>
      <div class="transpose-actions">
        <button type="button" aria-label="전체 곡 한 옥타브 낮추기" onclick={() => onTransposeProject(-12)}>
          <ArrowDown size={14} aria-hidden="true" />
          <span>12</span>
        </button>
        <button type="button" aria-label="전체 곡 반음 낮추기" onclick={() => onTransposeProject(-1)}>
          <ArrowDown size={14} aria-hidden="true" />
          <span>1</span>
        </button>
        <button type="button" aria-label="전체 곡 반음 높이기" onclick={() => onTransposeProject(1)}>
          <ArrowUp size={14} aria-hidden="true" />
          <span>1</span>
        </button>
        <button type="button" aria-label="전체 곡 한 옥타브 높이기" onclick={() => onTransposeProject(12)}>
          <ArrowUp size={14} aria-hidden="true" />
          <span>12</span>
        </button>
      </div>
    </div>
    <div class="tempo-map-card" aria-label="Tempo map">
      <div class="tempo-map-head">
        <strong>템포 맵</strong>
        <span>{tempoMarkerCountLabel}</span>
      </div>
      <div class="tempo-marker-list">
        {#each tempoMap as tempo (tempo.position)}
          {@const markerLabel = tickPositionLabel(tempo.position, project)}
          <div class="tempo-marker-row">
            <span>{markerLabel}</span>
            <label>
              BPM
              <input
                aria-label={`Tempo marker ${markerLabel} BPM`}
                type="number"
                min="40"
                max="260"
                value={tempo.bpm}
                oninput={(event) => updateTempoMarker(tempo.position, Number(inputValue(event)))}
              />
            </label>
            {#if tempo.position > 0}
              <button type="button" aria-label={`Remove tempo marker ${markerLabel}`} onclick={() => onRemoveTempoChange(tempo.position)}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            {/if}
          </div>
        {/each}
      </div>
      <div class="tempo-add-row">
        <label>
          선택 {selectedTempoMarkerLabel}
          <input
            aria-label="New tempo marker BPM"
            type="number"
            min="40"
            max="260"
            value={newTempoMarkerBpm ?? project.bpm}
            oninput={(event) => (newTempoMarkerBpm = clampTempoBpm(Number(inputValue(event))))}
          />
        </label>
        <button type="button" aria-label="선택 노트에 템포 마커 추가" onclick={addTempoMarkerAtSelection} disabled={!selectedNote}>
          <Plus size={15} aria-hidden="true" />
          <span>마커</span>
        </button>
      </div>
    </div>
    <label class="field-label">
      보컬
      <select value={selectedRendererId} onchange={(event) => onRenderer(inputValue(event) as RendererId)}>
        <option value="utau-sample" disabled={!voicebank}>{voicebank ? `${voicebankName} UTAU` : 'UTAU ZIP 대기'}</option>
        <option value="browser-demo">Korean Demo Voice</option>
        {#each rendererCapabilities.filter((renderer) => renderer.id !== 'browser-demo') as renderer (renderer.id)}
          <option value={renderer.id} disabled={renderer.status !== 'ready'}>
            {renderer.status === 'ready' ? renderer.name : `${renderer.name} 준비 필요`}
          </option>
        {/each}
      </select>
    </label>
    <div class="voicebank-actions">
      <button type="button" class="icon-text-button" onclick={() => voicebankInput?.click()} disabled={isLoadingVoicebank}>
        <Upload size={18} aria-hidden="true" />
        <span>ZIP</span>
      </button>
      <button
        type="button"
        class="icon-text-button"
        aria-label="선택 노트 UTAU 샘플 미리듣기"
        title="선택 노트 UTAU 샘플 미리듣기"
        onclick={() => onPreviewVoicebankSample()}
        disabled={!voicebank || !selectedNote || isLoadingVoicebank || isPreviewingVoicebankSample}
      >
        <Volume2 size={18} aria-hidden="true" />
        <span>{isPreviewingVoicebankSample ? 'PLAY' : '샘플'}</span>
      </button>
      <a
        class="text-link-button official-teto-link"
        href="https://kasaneteto.jp/utau/"
        target="_blank"
        rel="noreferrer"
        aria-label="Kasane Teto 공식 UTAU 다운로드 열기"
        title="사용자가 직접 받는 공식 Teto UTAU"
      >
        Teto 공식
      </a>
      <input
        bind:this={voicebankInput}
        type="file"
        accept=".zip"
        class="hidden-input"
        onchange={(event) => void handleVoicebankFileChange(event)}
      />
    </div>
    <div class="status-strip">
      <Volume2 size={17} aria-hidden="true" />
      <span>
        {voicebank
          ? `${notice} · ${formatVoicebankCoverage(voicebankCoverage)} · ${voicebank.wavCount} wav · ${formatVoicebankCacheStatus(voicebankCacheStatus)}`
          : notice}
      </span>
    </div>
    <div class={`voicebank-license-card ${voicebankLicenseState}`} aria-label="Voicebank license metadata">
      <strong>{voicebankLicenseTitle()}</strong>
      <span>{voicebankLicenseSummary()}</span>
      <em>{voicebankLicensePath()}</em>
    </div>
    <div class={`voicebank-origin-card ${voicebankOriginState}`} aria-label="Voicebank origin metadata">
      <strong>{voicebankOriginTitle()}</strong>
      <span>{voicebankOriginSummary()}</span>
      <em>{voicebankOriginPath()}</em>
    </div>
    <div class={`coverage-card ${voicebankCoverage?.fallbackNotes === 0 ? 'ready' : voicebank ? 'warning' : 'idle'}`} aria-label="Voicebank lyric coverage">
      {#if !voicebank}
        <strong>보이스뱅크 대기</strong>
        <span>도/히/다/이/스/키 alias 검사 준비됨.</span>
        <em>{formatVoicebankCacheStatus(voicebankCacheStatus)}</em>
      {:else if !voicebankCoverage}
        <strong>매칭 검사 중</strong>
        <span>가사와 oto.ini alias를 비교하고 있습니다.</span>
        <em>{formatVoicebankCacheStatus(voicebankCacheStatus)}</em>
      {:else}
        <strong>{formatVoicebankCoverage(voicebankCoverage)}</strong>
        <span>{formatCoverageMessage(voicebankCoverage)}</span>
        <em>{formatVoicebankCacheStatus(voicebankCacheStatus)}</em>
      {/if}
    </div>
    <div class={`render-warning-card ${voicebankWarnings?.warningCount ? 'warning' : voicebank ? 'ready' : 'idle'}`} aria-label="UTAU render warnings">
      {#if !voicebank}
        <strong>렌더 진단 대기</strong>
        <span>UTAU ZIP이 로드되면 노트별 렌더 위험을 검사합니다.</span>
      {:else if !voicebankWarnings}
        <strong>렌더 진단 중</strong>
        <span>alias fallback과 pitch shift를 확인하고 있습니다.</span>
      {:else if voicebankWarnings.warningCount === 0}
        <strong>렌더 경고 없음</strong>
        <span>{voicebankWarnings.totalNotes}개 노트가 현재 보이스뱅크로 안정적으로 연결됩니다.</span>
      {:else}
        <strong>렌더 경고 {voicebankWarnings.warningCount}개</strong>
        <span>{voicebankWarnings.errorCount}개 alias 오류 · {voicebankWarnings.warningCount - voicebankWarnings.errorCount}개 주의</span>
        <ul>
          {#each renderWarningPreview as warning (warning.noteId + warning.kind)}
            <li>{warning.message}</li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class={`release-readiness-card ${releaseCardState}`} aria-label="Community release readiness">
      <div class="release-readiness-head">
        <span class={`status-dot ${automatedReleaseChecksPass ? 'planned' : voicebank ? 'blocked' : 'idle'}`}></span>
        <div>
          <strong>{releaseCardTitle}</strong>
          <span>{releaseCardSummary}</span>
        </div>
      </div>
      <div class="release-checks">
        {#each releaseChecks as check (check.label)}
          <div class:passed={check.passed}>
            <span>{check.label}</span>
            <strong>{check.passed ? 'OK' : 'CHECK'}</strong>
            <em>{check.detail}</em>
          </div>
        {/each}
        <div class="review-needed">
          <span>청취 리뷰</span>
          <strong>NEED</strong>
          <em>listening-scores.local.json 필요</em>
        </div>
        <div class="review-needed">
          <span>DAW 확인</span>
          <strong>NEED</strong>
          <em>handoff-report.local.json 필요</em>
        </div>
      </div>
      <div class="release-evidence-next" aria-label="Manual release evidence checklist">
        <div class="release-evidence-head">
          <span>공개 전 마지막 2개 파일</span>
          <strong>{releaseEvidenceProgress}</strong>
        </div>
        <div class="release-evidence-step">
          <span>01</span>
          <div>
            <strong>청취 점수 저장</strong>
            <em>V3/V2 비교 후 listening-scores.local.json</em>
          </div>
        </div>
        <div class="release-evidence-step">
          <span>02</span>
          <div>
            <strong>DAW 가져오기 확인</strong>
            <em>실제 음악 앱에서 handoff-report.local.json</em>
          </div>
        </div>
        <div class="release-evidence-command preflight">
          <span>사전 검사</span>
          <code>Evidence Preflight · no upload</code>
        </div>
        <div class="release-evidence-command">
          <span>확인</span>
          <code>npm run release:evidence-status</code>
        </div>
        <div class="release-evidence-command">
          <span>수락</span>
          <code>npm run release:accept-evidence</code>
        </div>
        <div class="release-review-runway" aria-label="Reviewer Runway">
          <div class="release-runway-head">
            <span>Reviewer Runway</span>
            <strong>01 Listen -> 02 Handoff -> 03 Preflight -> 04 Status -> 05 Accept</strong>
          </div>
          <div class="release-runway-steps">
            {#each reviewerRunwaySteps as step (step.index)}
              {#if step.href}
                <a href={step.href} target="_blank" rel="noreferrer">
                  <span>{step.index}</span>
                  <strong>{step.label}</strong>
                  <em>{step.detail}</em>
                </a>
              {:else}
                <div>
                  <span>{step.index}</span>
                  <strong>{step.label}</strong>
                  <em>{step.detail}</em>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      </div>
      <div class="release-review-links">
        <a class="release-review-link" href={releaseReviewHubHref} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" />
          <span>릴리스 허브 열기</span>
        </a>
        <a class="release-review-link" href={evidencePreflightHref} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" />
          <span>Preflight 검사</span>
        </a>
        <a class="release-review-link" href={listeningReviewHref} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" />
          <span>청취 리뷰 열기</span>
        </a>
        <a class="release-review-link" href={wavDawHandoffHref} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" />
          <span>DAW 리포트 만들기</span>
        </a>
      </div>
    </div>
  </section>

  <section class="tool-panel note-panel">
    <div class="panel-heading">
      <Scissors size={18} aria-hidden="true" />
      <h2>노트</h2>
    </div>
    {#if selectedNote}
      <div class="note-editor">
        <div class="selected-note-card">
          <span>{selectedNote.lyric}</span>
          <strong>{toneName(selectedNote.tone)}</strong>
        </div>
        <div class={`lyric-match-chip ${selectedLyricMatch?.quality === 'fallback' ? 'warning' : 'ready'}`}>
          {formatLyricMatch(selectedLyricMatch)}
        </div>
        <div class={`render-note-chip ${selectedRenderWarnings.length ? 'warning' : 'ready'}`}>
          {selectedRenderWarnings[0]?.message ?? '렌더 안전'}
        </div>
        <label class="field-label">
          가사
          <input value={selectedNote.lyric} maxlength="12" oninput={(event) => onLyric(inputValue(event) || '라')} />
        </label>
        <label class="field-label">
          음
          <select value={selectedNote.tone} onchange={(event) => onTone(Number(inputValue(event)))}>
            {#each Array.from({ length: 37 }, (_, index) => 48 + index) as tone (tone)}
              <option value={tone}>{toneName(tone)}</option>
            {/each}
          </select>
        </label>
        <div class="step-row">
          <button type="button" class="small-button" title="앞으로 이동" onclick={() => onNudge({ start: selectedNote!.start - GRID_SNAP_TICKS })}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>앞</span>
          </button>
          <button type="button" class="small-button" title="뒤로 이동" onclick={() => onNudge({ start: selectedNote!.start + GRID_SNAP_TICKS })}>
            <ArrowRight size={16} aria-hidden="true" />
            <span>뒤</span>
          </button>
        </div>
        <div class="step-row">
          <button type="button" class="small-button" title="음 낮게" onclick={() => onNudge({ tone: selectedNote!.tone - 1 })}>
            <ArrowDown size={16} aria-hidden="true" />
            <span>낮게</span>
          </button>
          <button type="button" class="small-button" title="음 높게" onclick={() => onNudge({ tone: selectedNote!.tone + 1 })}>
            <ArrowUp size={16} aria-hidden="true" />
            <span>높게</span>
          </button>
        </div>
        <div class="step-row">
          <button type="button" class="small-button" onclick={() => onDuration(Math.max(120, selectedNote!.duration - 120))}>
            짧게
          </button>
          <button type="button" class="small-button" onclick={() => onDuration(selectedNote!.duration + 120)}>
            길게
          </button>
        </div>
        <div class="dynamics-card" aria-label="Selected note dynamics">
          <label class="slider-field">
            <span>세기 <output>{selectedIntensity}%</output></span>
            <input
              aria-label="Note intensity"
              type="range"
              min="0"
              max="200"
              step="1"
              value={selectedIntensity}
              oninput={(event) => onIntensity(Number(inputValue(event)))}
            />
          </label>
        </div>
        <div class="resampler-card" aria-label="Selected note resampler">
          <strong>리샘플러</strong>
          <label class="slider-field">
            <span>속도 <output>{selectedVelocity}%</output></span>
            <input
              aria-label="Note velocity"
              type="range"
              min="0"
              max="200"
              step="1"
              value={selectedVelocity}
              oninput={(event) => onNudge({ velocity: Number(inputValue(event)) })}
            />
          </label>
          <label class="slider-field">
            <span>모듈 <output>{selectedModulation}%</output></span>
            <input
              aria-label="Note modulation"
              type="range"
              min="0"
              max="100"
              step="1"
              value={selectedModulation}
              oninput={(event) => onNudge({ modulation: Number(inputValue(event)) })}
            />
          </label>
          <label class="field-label compact-field">
            Flags
            <input
              aria-label="Note flags"
              value={selectedNote.flags ?? ''}
              maxlength="128"
              oninput={(event) => onNudge({ flags: sanitizeOptionalNoteFlags(inputValue(event)) })}
            />
          </label>
        </div>
        <div class="timing-card" aria-label="Selected note timing">
          <strong>타이밍</strong>
          <label class="slider-field">
            <span>시작점 <output>{selectedTiming.sampleStartMs ?? 0}ms</output></span>
            <input
              aria-label="Sample start point"
              type="range"
              min="0"
              max="600"
              step="1"
              value={selectedTiming.sampleStartMs ?? 0}
              oninput={(event) => updateTiming({ sampleStartMs: Number(inputValue(event)) })}
            />
          </label>
          <label class="slider-field">
            <span>프리 <output>{selectedTiming.preutteranceMs ?? 0}ms</output></span>
            <input
              aria-label="Preutterance override"
              type="range"
              min="0"
              max="400"
              step="1"
              value={selectedTiming.preutteranceMs ?? 0}
              oninput={(event) => updateTiming({ preutteranceMs: Number(inputValue(event)) })}
            />
          </label>
          <label class="slider-field">
            <span>겹침 <output>{selectedTiming.voiceOverlapMs ?? 0}ms</output></span>
            <input
              aria-label="Voice overlap override"
              type="range"
              min="0"
              max="240"
              step="1"
              value={selectedTiming.voiceOverlapMs ?? 0}
              oninput={(event) => updateTiming({ voiceOverlapMs: Number(inputValue(event)) })}
            />
          </label>
        </div>
        <div class="envelope-card" aria-label="Selected note envelope">
          <strong>엔벨로프</strong>
          <label class="slider-field">
            <span>어택 <output>{selectedEnvelope.p2Ms}ms</output></span>
            <input
              aria-label="Envelope attack"
              type="range"
              min="0"
              max="400"
              step="1"
              value={selectedEnvelope.p2Ms}
              oninput={(event) => updateEnvelope({ p2Ms: Number(inputValue(event)) })}
            />
          </label>
          <label class="slider-field">
            <span>릴리즈 <output>{selectedEnvelope.p3Ms}ms</output></span>
            <input
              aria-label="Envelope release"
              type="range"
              min="0"
              max="800"
              step="1"
              value={selectedEnvelope.p3Ms}
              oninput={(event) => updateEnvelope({ p3Ms: Number(inputValue(event)) })}
            />
          </label>
          <label class="slider-field">
            <span>서스테인 <output>{selectedEnvelope.v3}%</output></span>
            <input
              aria-label="Envelope sustain"
              type="range"
              min="0"
              max="200"
              step="1"
              value={selectedEnvelope.v3}
              oninput={(event) => updateEnvelope({ v3: Number(inputValue(event)) })}
            />
          </label>
        </div>
        <div class="vibrato-card" aria-label="Selected note vibrato">
          <label class="toggle-line">
            <input
              type="checkbox"
              checked={selectedVibrato.enabled}
              onchange={(event) => updateVibrato({ enabled: (event.currentTarget as HTMLInputElement).checked })}
            />
            <span>비브라토</span>
            <strong>{selectedVibrato.enabled ? 'ON' : 'OFF'}</strong>
          </label>
          <label class="slider-field">
            <span>깊이 <output>{Math.round(selectedVibrato.depthCents)}c</output></span>
            <input
              type="range"
              min="0"
              max="80"
              step="1"
              value={selectedVibrato.depthCents}
              oninput={(event) => updateVibrato({ depthCents: Number(inputValue(event)) })}
            />
          </label>
          <label class="slider-field">
            <span>속도 <output>{selectedVibrato.rateHz.toFixed(1)}Hz</output></span>
            <input
              type="range"
              min="3"
              max="9"
              step="0.1"
              value={selectedVibrato.rateHz}
              oninput={(event) => updateVibrato({ rateHz: Number(inputValue(event)) })}
            />
          </label>
          <label class="slider-field">
            <span>시작 <output>{Math.round(selectedVibrato.startPercent)}%</output></span>
            <input
              type="range"
              min="0"
              max="90"
              step="1"
              value={selectedVibrato.startPercent}
              oninput={(event) => updateVibrato({ startPercent: Number(inputValue(event)) })}
            />
          </label>
        </div>
        <div class="pitch-bend-card" aria-label="Selected note pitch bend">
          <label class="toggle-line">
            <input
              type="checkbox"
              checked={selectedPitchBendEnabled}
              onchange={(event) => updatePitchBend({ enabled: (event.currentTarget as HTMLInputElement).checked })}
            />
            <span>피치 벤드</span>
            <strong>{selectedPitchBendEnabled ? 'ON' : 'OFF'}</strong>
          </label>
          <div class="pitch-curve-preview" aria-hidden="true">
            <svg viewBox="0 0 100 40" preserveAspectRatio="none">
              <path class="curve-base" d="M 2 20 L 98 20"></path>
              <path class="curve-line" d={selectedPitchBendPath}></path>
            </svg>
          </div>
          <div class="pitch-bend-meta" aria-label="Pitch bend point count">
            <span>{selectedPitchBendPointCount} pts</span>
            <span>{selectedPitchBendSnapFirst ? 'snap start' : 'free start'}</span>
          </div>
          <label class="slider-field">
            <span>폭 <output>{Math.round(selectedPitchBendPeak.cents)}c</output></span>
            <input
              aria-label="Pitch bend amount"
              type="range"
              min="-1200"
              max="1200"
              step="5"
              value={selectedPitchBendPeak.cents}
              disabled={!selectedPitchBendEnabled}
              oninput={(event) => updatePitchBend({ cents: Number(inputValue(event)) })}
            />
          </label>
          <label class="slider-field">
            <span>위치 <output>{Math.round(selectedPitchBendPeak.timePercent)}%</output></span>
            <input
              aria-label="Pitch bend position"
              type="range"
              min="10"
              max="90"
              step="1"
              value={selectedPitchBendPeak.timePercent}
              disabled={!selectedPitchBendEnabled}
              oninput={(event) => updatePitchBend({ timePercent: Number(inputValue(event)) })}
            />
          </label>
          <label class="field-label compact-field pitch-mode-field">
            곡선
            <select
              aria-label="Pitch bend curve mode"
              value={selectedPitchBendMode}
              disabled={!selectedPitchBendEnabled}
              onchange={(event) => updatePitchBend({ mode: inputValue(event) })}
            >
              <option value="l">Linear</option>
              <option value="io">Smooth</option>
              <option value="i">Ease in</option>
              <option value="o">Ease out</option>
              <option value="sp">Spline</option>
            </select>
          </label>
          <label class="toggle-line pitch-snap-line">
            <input
              aria-label="Pitch bend snap first"
              type="checkbox"
              checked={selectedPitchBendSnapFirst}
              disabled={!selectedPitchBendEnabled}
              onchange={(event) => updatePitchBend({ snapFirst: (event.currentTarget as HTMLInputElement).checked })}
            />
            <span>첫 점 스냅</span>
            <strong>{selectedPitchBendSnapFirst ? 'ON' : 'OFF'}</strong>
          </label>
        </div>
      </div>
    {/if}
    <div class="tool-row">
      <button type="button" class="icon-text-button" onclick={onAddNote}>
        <Plus size={18} aria-hidden="true" />
        <span>추가</span>
      </button>
      <button type="button" class="icon-text-button" onclick={onSplitNote}>
        <Scissors size={18} aria-hidden="true" />
        <span>분할</span>
      </button>
      <button type="button" class="icon-text-button danger" onclick={onDeleteNote}>
        <Trash2 size={18} aria-hidden="true" />
        <span>삭제</span>
      </button>
    </div>
  </section>

  <section class="tool-panel model-panel">
    <div class="panel-heading">
      <ShieldCheck size={18} aria-hidden="true" />
      <h2>모델</h2>
    </div>
    <div class="model-list">
      {#each neuralModels as model (model.id)}
        <button
          type="button"
          class={`model-card ${model.status} ${selectedNeuralModelId === model.id ? 'selected' : ''}`}
          disabled={model.status !== 'ready'}
          onclick={() => onNeuralModel(model.id)}
        >
          <div class="model-row">
            <span class={`status-dot ${model.status}`}></span>
            <div>
              <strong>{model.name}</strong>
              <span>{model.language.toUpperCase()} · {releaseStatusLabel(model.releaseStatus)}</span>
            </div>
          </div>
          <p>{model.licenseSummary}</p>
          <em>{model.usageNote}</em>
        </button>
      {/each}
    </div>
  </section>

  <section class="tool-panel engine-panel">
    <div class="panel-heading">
      <Upload size={18} aria-hidden="true" />
      <h2>엔진</h2>
    </div>
    <div class="engine-list">
      {#each rendererCapabilities as renderer (renderer.id)}
        <div class="engine-row">
          <span class={`status-dot ${renderer.status}`}></span>
          <div>
            <strong>{renderer.name}</strong>
            <span>{rendererStatusLabel(renderer.status)}</span>
          </div>
        </div>
      {/each}
      {#if voicebank}
        <div class="engine-row">
          <span class="status-dot ready"></span>
          <div>
            <strong>{voicebank.name}</strong>
            <span>{formatVoicebankCacheStatus(voicebankCacheStatus)}</span>
          </div>
        </div>
      {/if}
    </div>
  </section>
</aside>
