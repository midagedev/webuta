<script lang="ts">
  import { Check, Download, FilePlus, Music2, Play, RotateCcw, Sparkles, Wand2 } from '@lucide/svelte'
  import type { RenderedAudio, SongProject } from '../types'
  import type { VoicebankCoverage } from '../voicebank'
  import { formatVoicebankCoverage } from '../app/ui'

  type Props = {
    project: SongProject
    projectSourceLabel: string
    voicebankName: string
    voicebankCoverage: VoicebankCoverage | null
    rendered: RenderedAudio | null
    isRendering: boolean
    isPlaying: boolean
    onNewProject: () => void
    onResetDemoProject: () => void
    onApplyLyricLine: () => void
    onOpenCompose: () => void
    onPlayPause: () => Promise<void>
    onDownloadWav: () => Promise<void>
  }

  let {
    project,
    projectSourceLabel,
    voicebankName,
    voicebankCoverage,
    rendered,
    isRendering,
    isPlaying,
    onNewProject,
    onResetDemoProject,
    onApplyLyricLine,
    onOpenCompose,
    onPlayPause,
    onDownloadWav,
  }: Props = $props()

  const lyricPreview = $derived(project.notes.slice(0, 8).map((note) => note.lyric).join(' '))
  const voicebankLabel = $derived(voicebankName.replace(/^WebUtau\s*\/\/\s*/u, '') || voicebankName)
  const coverageLabel = $derived(voicebankCoverage ? formatVoicebankCoverage(voicebankCoverage, 'compact') : 'loading')
  const isVoicebankReady = $derived(Boolean(voicebankCoverage && voicebankCoverage.fallbackNotes === 0))
  const wavLabel = $derived(isRendering ? '렌더 중' : rendered ? 'WAV 준비' : 'WAV')
  const voiceStepLabel = $derived(isVoicebankReady ? '준비됨' : '로딩')
  const playStepLabel = $derived(isRendering ? '렌더 중' : rendered ? '재생 가능' : '눌러보기')
  const exportStepLabel = $derived(rendered ? '다운로드' : '자동 생성')
  const projectContextLabel = $derived(projectSourceLabel === 'Built-in Hangul demo' ? '기본 데모' : projectSourceLabel)
  const nextActionTitle = $derived(isRendering ? '렌더 중' : isPlaying ? '멈추기' : rendered ? 'WAV 받기' : '먼저 들어보기')
  const nextActionDetail = $derived(
    isRendering
      ? 'WAV를 만드는 중'
      : isPlaying
        ? '지금 재생 중'
        : rendered
          ? '파일 준비 완료'
          : isVoicebankReady
            ? '기본 보컬 준비 완료'
            : '기본 보컬 로딩 중',
  )
  const nextActionMeta = $derived(rendered ? rendered.fileName : `${project.notes.length} notes · ${project.bpm} BPM`)
  const nextActionAria = $derived(isPlaying ? '스타터 재생 일시정지' : rendered ? '스타터 WAV 다운로드' : '스타터 재생')
  const guideSummary = $derived(rendered ? '이제 WAV를 저장할 수 있어요' : '듣고, 가사를 바꾸고, WAV로 저장')

  async function handleNextAction() {
    if (rendered && !isPlaying) {
      await onDownloadWav()
      return
    }
    await onPlayPause()
  }
</script>

<section class="starter-guide" aria-label="First run guide">
  <div class="starter-guide-head">
    <div class="starter-title">
      <span>QUICK START</span>
      <strong>{project.name}</strong>
      <em>{guideSummary}</em>
    </div>
    <div class="starter-status" aria-label="Starter status">
      <span>{project.bpm} BPM</span>
      <span class={isVoicebankReady ? 'ready' : 'pending'}>{coverageLabel}</span>
      <span>{projectContextLabel}</span>
    </div>
  </div>

  <div class="starter-hero" aria-label="Starter next action">
    <div class="starter-primary-card">
      <span>처음이면</span>
      <strong>{nextActionTitle}</strong>
      <em>{nextActionDetail}</em>
      <button
        type="button"
        class={`starter-next-button ${rendered && !isPlaying ? 'ready' : ''} ${isPlaying ? 'active' : ''}`}
        aria-label={nextActionAria}
        onclick={() => void handleNextAction()}
        disabled={isRendering}
      >
        {#if rendered && !isPlaying}
          <Download size={20} aria-hidden="true" />
        {:else if isPlaying}
          <Music2 size={20} aria-hidden="true" />
        {:else}
          <Play size={20} aria-hidden="true" />
        {/if}
        <span>{nextActionTitle}</span>
        <strong>{nextActionMeta}</strong>
      </button>
    </div>

    <ol class="starter-checklist starter-path" aria-label="Starter path">
      <li class={`starter-path-step ${isVoicebankReady ? 'done' : 'active'}`}>
        <span>01</span>
        <strong>보이스 확인</strong>
        <em>{isVoicebankReady ? voicebankLabel : voiceStepLabel}</em>
      </li>
      <li class={`starter-path-step ${rendered ? 'done' : 'active'}`}>
        <span>02</span>
        <strong>먼저 들어보기</strong>
        <em>{playStepLabel}</em>
      </li>
      <li class={`starter-path-step ${rendered ? 'active' : 'todo'}`}>
        <span>03</span>
        <strong>WAV 저장</strong>
        <em>{exportStepLabel}</em>
      </li>
    </ol>

    <div class="starter-sample-card" aria-label="Default lyric preview">
      <span>현재 가사</span>
      <strong>{lyricPreview}</strong>
      <em>{project.notes.length} notes · {voicebankLabel}</em>
    </div>
  </div>

  <div class="starter-flow" aria-label="Starter actions">
    <button
      type="button"
      class={`starter-step listen ${isPlaying ? 'active' : ''}`}
      aria-label={isPlaying ? '스타터 재생 일시정지' : '스타터 재생'}
      onclick={() => void onPlayPause()}
      disabled={isRendering}
    >
      {#if isPlaying}
        <Music2 size={17} aria-hidden="true" />
      {:else}
        <Play size={17} aria-hidden="true" />
      {/if}
      <span>{isPlaying ? '일시정지' : '1 들어보기'}</span>
      <strong>{isRendering ? '렌더 중' : `${project.beatPerBar}/${project.beatUnit}`}</strong>
    </button>
    <button
      type="button"
      class={`starter-step primary ${rendered ? 'ready' : ''}`}
      aria-label="스타터 WAV 다운로드"
      onclick={() => void onDownloadWav()}
      disabled={isRendering}
    >
      {#if rendered}
        <Sparkles size={17} aria-hidden="true" />
      {:else}
        <Download size={17} aria-hidden="true" />
      {/if}
      <span>2 {wavLabel}</span>
      <strong>{rendered ? 'download' : '44.1k mono'}</strong>
    </button>
    <button type="button" class="starter-step" aria-label="가사 라인 적용" onclick={onApplyLyricLine}>
      <Check size={17} aria-hidden="true" />
      <span>가사 넣기</span>
      <strong>{project.notes.length} notes</strong>
    </button>
    <button type="button" class="starter-step" aria-label="컴포즈 모드 열기" onclick={onOpenCompose}>
      <Wand2 size={17} aria-hidden="true" />
      <span>멜로디 만들기</span>
      <strong>compose</strong>
    </button>
    <button type="button" class="starter-step" aria-label="새 프로젝트" onclick={onNewProject}>
      <FilePlus size={17} aria-hidden="true" />
      <span>새로 시작</span>
      <strong>blank</strong>
    </button>
    <button type="button" class="starter-step ghost" aria-label="데모 프로젝트로 복구" onclick={onResetDemoProject}>
      <RotateCcw size={17} aria-hidden="true" />
      <span>데모 복구</span>
      <strong>{lyricPreview}</strong>
    </button>
  </div>
</section>
