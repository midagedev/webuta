<script lang="ts">
  import { Check, Download, FilePlus, Headphones, ListChecks, Music2, PencilLine, Play, RotateCcw, Wand2 } from '@lucide/svelte'
  import type { RenderedAudio, SongProject } from '../types'
  import type { VoicebankCoverage } from '../voicebank'
  import { formatProjectSourceLabel, formatVoicebankCoverage, inputValue } from '../app/ui'

  type Props = {
    project: SongProject
    projectSourceLabel: string
    lyricLine: string
    voicebankName: string
    voicebankCoverage: VoicebankCoverage | null
    rendered: RenderedAudio | null
    isRendering: boolean
    isPlaying: boolean
    onNewProject: () => void
    onResetDemoProject: () => void
    onLyricLine: (line: string) => void
    onApplyLyricLine: () => void
    onOpenCompose: () => void
    onPlayPause: () => Promise<void>
    onDownloadWav: () => Promise<void>
  }

  let {
    project,
    projectSourceLabel,
    lyricLine,
    voicebankName,
    voicebankCoverage,
    rendered,
    isRendering,
    isPlaying,
    onNewProject,
    onResetDemoProject,
    onLyricLine,
    onApplyLyricLine,
    onOpenCompose,
    onPlayPause,
    onDownloadWav,
  }: Props = $props()

  const lyricPreview = $derived(project.notes.slice(0, 8).map((note) => note.lyric).join(' '))
  const voicebankLabel = $derived(voicebankName.replace(/^WebUtau\s*\/\/\s*/u, '') || voicebankName)
  const coverageLabel = $derived(voicebankCoverage ? formatVoicebankCoverage(voicebankCoverage, 'compact') : 'loading')
  const isVoicebankReady = $derived(Boolean(voicebankCoverage && voicebankCoverage.fallbackNotes === 0))
  const voicebankStatusLabel = $derived(isVoicebankReady ? '발음 준비' : coverageLabel)
  const playStepLabel = $derived(isRendering ? '렌더 중' : rendered ? '재생 가능' : '눌러보기')
  const projectContextLabel = $derived(formatProjectSourceLabel(projectSourceLabel))
  const isDraftProject = $derived(projectSourceLabel === 'Saved browser draft')
  const nextActionTitle = $derived(isRendering ? '렌더 중' : isPlaying ? '멈추기' : rendered ? 'WAV 받기' : '샘플 듣기')
  const nextActionDetail = $derived(
    isRendering
      ? 'WAV를 만드는 중'
      : isPlaying
        ? '지금 재생 중'
        : rendered
          ? '파일 준비 완료'
          : isVoicebankReady
            ? '보컬 준비 완료'
            : '보컬 로딩 중',
  )
  const nextActionMeta = $derived(rendered ? rendered.fileName : `${project.notes.length} notes · ${project.bpm} BPM`)
  const nextActionAria = $derived(isPlaying ? '스타터 재생 일시정지' : rendered ? '스타터 WAV 받기' : '스타터 재생')
  const guideSummary = $derived(rendered ? 'WAV 준비 완료' : '듣고 · 바꾸고 · 저장하기')
  const missionWavMeta = $derived(rendered ? 'download' : isRendering ? '렌더 중' : '렌더 후 저장')
  const focusStep = $derived(isRendering ? '02' : rendered ? '03' : isVoicebankReady ? '01' : '00')
  const focusTitle = $derived(
    isRendering ? '소리 만드는 중' : rendered ? 'WAV 저장하기' : isVoicebankReady ? '샘플 먼저 듣기' : '보컬 불러오는 중',
  )
  const focusMeta = $derived(
    isRendering
      ? '곧 재생·저장이 가능해져요'
      : rendered
        ? rendered.fileName
        : isDraftProject
          ? '지난 작업을 이어서 열었어요'
          : isVoicebankReady
            ? '도히도히 다이스키 기본 샘플'
            : coverageLabel,
  )
  const lyricRouteStatus = $derived(`${project.notes.length} notes`)
  const hasPendingLyricLine = $derived(compactLine(lyricLine) !== compactLine(lyricPreview) && compactLine(lyricLine).length > 0)
  const listenProgressClass = $derived(isPlaying || !rendered ? 'current' : 'done')
  const lyricProgressClass = $derived(hasPendingLyricLine ? 'current' : rendered ? 'done' : 'next')
  const exportProgressClass = $derived(rendered ? 'current' : 'next')
  const lyricProgressMeta = $derived(hasPendingLyricLine ? '적용 대기' : lyricRouteStatus)
  const exportRouteStatus = $derived(rendered ? '저장 가능' : missionWavMeta)
  const projectStateTitle = $derived(isDraftProject ? '저장된 작업' : '기본 샘플')
  const projectStateDetail = $derived(isDraftProject ? '이전 작업을 이어서 열었어요' : '도히도히 다이스키로 시작해요')
  const coachDetail = $derived(isDraftProject ? '기본 샘플이 필요하면 아래에서 바로 되돌릴 수 있어요' : '처음엔 샘플을 듣고 가사만 바꿔도 충분해요')

  async function handleNextAction() {
    if (rendered && !isPlaying) {
      await onDownloadWav()
      return
    }
    await onPlayPause()
  }

  function compactLine(line: string) {
    return line.replace(/\s+/gu, '')
  }
</script>

<section class="starter-guide onboarding-v4" aria-label="First run guide">
  <div class="starter-guide-head">
    <div class="starter-title">
      <span>START HERE</span>
      <strong>{project.name}</strong>
      <em>{guideSummary}</em>
    </div>
    <div class="starter-status" aria-label="Starter status">
      <span>{project.bpm} BPM</span>
      <span class={isVoicebankReady ? 'ready' : 'pending'}>{voicebankStatusLabel}</span>
      <span>{projectContextLabel}</span>
    </div>
  </div>

  <div class="starter-launch-panel starter-coach-panel" aria-label="Starter launch panel">
    <div class="starter-focus starter-coach-card" aria-label="Starter next action">
      <div class="starter-focus-copy starter-coach-copy">
        <span>지금 할 일 · STEP {focusStep}</span>
        <strong>{focusTitle}</strong>
        <em>{nextActionDetail} · {focusMeta}</em>
      </div>
      <button
        type="button"
        class={`starter-next-button ${rendered && !isPlaying ? 'ready' : ''} ${isPlaying ? 'active' : ''}`}
        aria-label={nextActionAria}
        onclick={() => void handleNextAction()}
        disabled={isRendering}
      >
        {#if rendered && !isPlaying}
          <Download size={22} aria-hidden="true" />
        {:else if isPlaying}
          <Music2 size={22} aria-hidden="true" />
        {:else}
          <Play size={22} aria-hidden="true" />
        {/if}
        <span>{nextActionTitle}</span>
        <strong>{nextActionMeta}</strong>
      </button>
    </div>

    <div class="starter-mini-preview starter-project-state" aria-label="Starter lyric preview">
      <span>{projectStateTitle}</span>
      <strong>{lyricPreview}</strong>
      <em>{projectStateDetail}</em>
      {#if isDraftProject}
        <button type="button" class="starter-inline-reset" aria-label="저장된 작업 대신 기본 샘플 열기" onclick={onResetDemoProject}>
          <RotateCcw size={14} aria-hidden="true" />
          <span>기본 샘플로</span>
        </button>
      {:else}
        <em>{voicebankLabel}</em>
      {/if}
    </div>
  </div>

  <div class="starter-progress-rail starter-recipe-rail" aria-label="Starter quick checklist">
    <button
      type="button"
      class={`starter-progress-step ${listenProgressClass}`}
      aria-label={isPlaying ? '첫 단계 일시정지' : '첫 단계 샘플 듣기'}
      onclick={() => void onPlayPause()}
      disabled={isRendering}
    >
      <span class="progress-index">01</span>
      <Headphones size={17} aria-hidden="true" />
      <strong>{isPlaying ? '일시정지' : '샘플 듣기'}</strong>
      <em>{playStepLabel}</em>
    </button>
    <button type="button" class={`starter-progress-step ${lyricProgressClass}`} aria-label="둘째 단계 가사 적용" onclick={onApplyLyricLine}>
      <span class="progress-index">02</span>
      <PencilLine size={17} aria-hidden="true" />
      <strong>가사 적용</strong>
      <em>{lyricProgressMeta}</em>
    </button>
    <button
      type="button"
      class={`starter-progress-step ${exportProgressClass}`}
      aria-label="셋째 단계 WAV 받기"
      onclick={() => void onDownloadWav()}
      disabled={isRendering}
    >
      <span class="progress-index">03</span>
      <Download size={17} aria-hidden="true" />
      <strong>WAV 받기</strong>
      <em>{exportRouteStatus}</em>
    </button>
  </div>

  <div class="starter-onboarding-grid" aria-label="Beginner launch pad">
    <div class="starter-edit-card" aria-label="Starter lyric editor">
      <div class="starter-edit-head">
        <span>가사 바꾸기</span>
        <strong>{project.notes.length} notes</strong>
      </div>
      <div class="starter-lyric-input-row">
        <input
          aria-label="스타터 가사 라인"
          value={lyricLine}
          placeholder="도히도히 다이스키"
          oninput={(event) => onLyricLine(inputValue(event))}
        />
        <button type="button" aria-label="가사 라인 적용" onclick={onApplyLyricLine}>
          <Check size={17} aria-hidden="true" />
          <span>적용</span>
        </button>
      </div>
      <div class="starter-sample-card" aria-label="Default lyric preview">
        <span>현재 가사</span>
        <strong>{lyricPreview}</strong>
        <em>{voicebankLabel} · {projectContextLabel}</em>
      </div>
    </div>

    <div class="starter-quick-actions starter-next-steps-card" aria-label="Starter project utilities">
      <div class="starter-quick-actions-head">
        <ListChecks size={16} aria-hidden="true" />
        <div>
          <span>다음 선택</span>
          <strong>{coachDetail}</strong>
        </div>
      </div>
      <div class="starter-utility-row">
        <button type="button" class="starter-utility-button listen" aria-label="스타터 멜로디 추천" onclick={onOpenCompose}>
          <Wand2 size={17} aria-hidden="true" />
          <span>멜로디 추천</span>
          <strong>선택 사항</strong>
        </button>
        <button type="button" class="starter-utility-button" aria-label="새 프로젝트" onclick={onNewProject}>
          <FilePlus size={17} aria-hidden="true" />
          <span>새 프로젝트</span>
          <strong>blank</strong>
        </button>
        <button type="button" class="starter-utility-button ghost" aria-label="데모 프로젝트로 복구" onclick={onResetDemoProject}>
          <RotateCcw size={17} aria-hidden="true" />
          <span>기본 샘플</span>
          <strong>{lyricPreview}</strong>
        </button>
      </div>
    </div>
  </div>
</section>
