<script lang="ts">
  import { Check, Download, FilePlus, Music2, Play, RotateCcw, Sparkles, Wand2 } from '@lucide/svelte'
  import type { RenderedAudio, SongProject } from '../types'
  import type { VoicebankCoverage } from '../voicebank'
  import { formatVoicebankCoverage } from '../app/ui'

  type Props = {
    project: SongProject
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
      <span>START</span>
      <strong>첫 보컬 스케치</strong>
      <em>기본 보이스와 멜로디 준비 완료</em>
    </div>
    <div class="starter-status" aria-label="Starter status">
      <span>{project.bpm} BPM</span>
      <span class={isVoicebankReady ? 'ready' : 'pending'}>{coverageLabel}</span>
      <span>{voicebankLabel}</span>
    </div>
  </div>

  <div class="starter-now" aria-label="Starter next action">
    <div class="starter-now-copy">
      <span>지금 할 일</span>
      <strong>{nextActionTitle}</strong>
      <em>{nextActionDetail}</em>
    </div>
    <div class="starter-map" aria-label="First run route">
      <span>처음 3분</span>
      <strong>보이스 확인 → 들어보기 → WAV 저장</strong>
      <em>기본 샘플은 이미 선택됨</em>
    </div>
    <div class="starter-lyric-line" aria-label="Default lyric preview">
      <span>가사</span>
      <strong>{lyricPreview}</strong>
    </div>
    <button
      type="button"
      class={`starter-next-button ${rendered && !isPlaying ? 'ready' : ''} ${isPlaying ? 'active' : ''}`}
      aria-label={nextActionAria}
      onclick={() => void handleNextAction()}
      disabled={isRendering}
    >
      {#if rendered && !isPlaying}
        <Download size={18} aria-hidden="true" />
      {:else if isPlaying}
        <Music2 size={18} aria-hidden="true" />
      {:else}
        <Play size={18} aria-hidden="true" />
      {/if}
      <span>{nextActionTitle}</span>
      <strong>{nextActionMeta}</strong>
    </button>
  </div>

  <ol class="starter-path" aria-label="Starter path">
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
