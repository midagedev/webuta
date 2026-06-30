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
  import { GRID_SNAP_TICKS } from '../projectEditing'
  import type { NeuralModelCard, NoteVibrato, RendererId, SongNote, SongProject } from '../types'
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
  import { toneName } from '../music'

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
    onRenderer: (renderer: RendererId) => void
    onNeuralModel: (modelId: string) => void
    onLyric: (lyric: string) => void
    onTone: (tone: number) => void
    onNudge: (patch: Partial<SongNote>) => void
    onDuration: (duration: number) => void
    onVibrato: (vibrato: NoteVibrato) => void
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
    onRenderer,
    onNeuralModel,
    onLyric,
    onTone,
    onNudge,
    onDuration,
    onVibrato,
    onAddNote,
    onSplitNote,
    onDeleteNote,
  }: Props = $props()

  let voicebankInput: HTMLInputElement

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

  let selectedRenderWarnings = $derived(
    selectedNote && voicebankWarnings ? voicebankWarnings.warnings.filter((warning) => warning.noteId === selectedNote.id) : [],
  )
  let selectedVibrato = $derived(normalizeNoteVibrato(selectedNote?.vibrato))
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
      ? '남은 단계: 생성된 WAV 청취 점수 저장'
      : '기본 번들, alias 매칭, 렌더 경고를 확인하세요.',
  )
  let voicebankLicenseState = $derived(!voicebank ? 'idle' : voicebank.metadata.license ? 'ready' : 'warning')
  const listeningReviewHref = `${import.meta.env.BASE_URL}review/v3/index.html`

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

  function updateVibrato(patch: Partial<NoteVibrato>) {
    onVibrato(normalizeNoteVibrato({ ...selectedVibrato, ...patch }))
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
      </div>
      <a class="release-review-link" href={listeningReviewHref} target="_blank" rel="noreferrer">
        <ExternalLink size={14} aria-hidden="true" />
        <span>청취 리뷰 열기</span>
      </a>
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
      <a class="text-link-button" href="https://kasaneteto.jp/utau/" target="_blank" rel="noreferrer">
        Teto UTAU
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
