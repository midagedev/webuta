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

  <div class="starter-flow" aria-label="Starter actions">
    <button type="button" class="starter-step ghost" aria-label="데모 프로젝트로 복구" onclick={onResetDemoProject}>
      <RotateCcw size={17} aria-hidden="true" />
      <span>데모 복구</span>
      <strong>{lyricPreview}</strong>
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
    <button
      type="button"
      class={`starter-step ${isPlaying ? 'active' : ''}`}
      aria-label={isPlaying ? '스타터 재생 일시정지' : '스타터 재생'}
      onclick={() => void onPlayPause()}
      disabled={isRendering}
    >
      {#if isPlaying}
        <Music2 size={17} aria-hidden="true" />
      {:else}
        <Play size={17} aria-hidden="true" />
      {/if}
      <span>{isPlaying ? '일시정지' : '재생'}</span>
      <strong>{project.beatPerBar}/{project.beatUnit}</strong>
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
      <strong>44.1k mono</strong>
    </button>
  </div>
</section>
