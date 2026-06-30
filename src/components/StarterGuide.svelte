<script lang="ts">
  import { Check, Download, Music2, Play, RotateCcw, Sparkles, Wand2 } from '@lucide/svelte'
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
</script>

<section class="starter-guide" aria-label="First run guide">
  <div class="starter-guide-head">
    <div class="starter-title">
      <span>START</span>
      <strong>첫 보컬 스케치</strong>
    </div>
    <div class="starter-status" aria-label="Starter status">
      <span>{project.bpm} BPM</span>
      <span class={isVoicebankReady ? 'ready' : 'pending'}>{coverageLabel}</span>
      <span>{voicebankLabel}</span>
    </div>
  </div>

  <ol class="starter-path" aria-label="Starter path">
    <li class={`starter-path-step ${isVoicebankReady ? 'done' : 'active'}`}>
      <span>01</span>
      <strong>보이스</strong>
      <em>{voiceStepLabel}</em>
    </li>
    <li class={`starter-path-step ${rendered ? 'done' : 'active'}`}>
      <span>02</span>
      <strong>재생</strong>
      <em>{playStepLabel}</em>
    </li>
    <li class={`starter-path-step ${rendered ? 'active' : 'todo'}`}>
      <span>03</span>
      <strong>WAV</strong>
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
      <span>{isPlaying ? '일시정지' : '들어보기'}</span>
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
      <span>{wavLabel}</span>
      <strong>{rendered ? 'download' : '44.1k mono'}</strong>
    </button>
    <button type="button" class="starter-step" aria-label="가사 라인 적용" onclick={onApplyLyricLine}>
      <Check size={17} aria-hidden="true" />
      <span>가사 적용</span>
      <strong>{project.notes.length} notes</strong>
    </button>
    <button type="button" class="starter-step" aria-label="컴포즈 모드 열기" onclick={onOpenCompose}>
      <Wand2 size={17} aria-hidden="true" />
      <span>멜로디</span>
      <strong>compose</strong>
    </button>
    <button type="button" class="starter-step ghost" aria-label="데모 프로젝트로 복구" onclick={onResetDemoProject}>
      <RotateCcw size={17} aria-hidden="true" />
      <span>데모 복구</span>
      <strong>{lyricPreview}</strong>
    </button>
  </div>
</section>
