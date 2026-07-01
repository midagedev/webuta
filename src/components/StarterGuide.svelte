<script lang="ts">
  import { Check, Download, FilePlus, Headphones, ListChecks, Music2, PencilLine, Play, RotateCcw, Wand2 } from '@lucide/svelte'
  import type { RenderedAudio, SongProject } from '../types'
  import type { VoicebankCoverage } from '../voicebank'
  import { formatVoicebankCoverage, inputValue } from '../app/ui'

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
  const wavLabel = $derived(isRendering ? '렌더 중' : rendered ? 'WAV 준비' : 'WAV')
  const playStepLabel = $derived(isRendering ? '렌더 중' : rendered ? '재생 가능' : '눌러보기')
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
  const guideSummary = $derived(rendered ? 'WAV 저장 준비 완료' : '듣기 → 가사 → 멜로디 → WAV')
  const missionStatus = $derived(isRendering ? '렌더 중' : rendered ? 'WAV 준비됨' : isVoicebankReady ? '보컬 준비됨' : '보컬 로딩')
  const missionWavMeta = $derived(rendered ? 'download' : isRendering ? '렌더 중' : '렌더 후 저장')
  const focusStep = $derived(isRendering ? '02' : rendered ? '03' : isVoicebankReady ? '01' : '00')
  const focusTitle = $derived(
    isRendering ? '렌더가 끝날 때까지 기다리기' : rendered ? '완성 WAV 저장하기' : isVoicebankReady ? '첫 샘플 듣기' : '보컬 준비 기다리기',
  )
  const focusMeta = $derived(
    isRendering ? '곧 재생·저장이 가능해져요' : rendered ? rendered.fileName : isVoicebankReady ? '기본 가사와 멜로디가 이미 들어있어요' : coverageLabel,
  )
  const lyricRouteStatus = $derived(`${project.notes.length} notes`)
  const composeRouteStatus = $derived('추천 멜로디')
  const exportRouteStatus = $derived(rendered ? '저장 가능' : missionWavMeta)

  async function handleNextAction() {
    if (rendered && !isPlaying) {
      await onDownloadWav()
      return
    }
    await onPlayPause()
  }
</script>

<section class="starter-guide onboarding-v2" aria-label="First run guide">
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

  <div class="starter-onboarding-grid" aria-label="Beginner launch pad">
    <div class="starter-focus" aria-label="Starter next action">
      <div class="starter-focus-copy">
        <span>처음이면</span>
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
          <Download size={21} aria-hidden="true" />
        {:else if isPlaying}
          <Music2 size={21} aria-hidden="true" />
        {:else}
          <Play size={21} aria-hidden="true" />
        {/if}
        <span>{nextActionTitle}</span>
        <strong>{nextActionMeta}</strong>
      </button>
      <div class="starter-focus-badge" aria-label="Current starter step">
        <ListChecks size={16} aria-hidden="true" />
        <span>{focusStep}</span>
      </div>
    </div>

    <div class="starter-edit-card" aria-label="Starter lyric editor">
      <div class="starter-edit-head">
        <span>가사</span>
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
  </div>

  <div class="starter-path-card" aria-label="Starter path">
    <div class="starter-path-head">
      <div>
        <span>처음 1분</span>
        <strong>샘플 듣기 → 가사 적용 → 멜로디 만들기 → WAV 받기</strong>
      </div>
      <em>{missionStatus}</em>
    </div>
    <div class="starter-route-grid" aria-label="Starter action route">
      <button
        type="button"
        class={`starter-route-step primary ${isPlaying ? 'active' : ''}`}
        aria-label={isPlaying ? '초보자 샘플 일시정지' : '초보자 샘플 듣기'}
        onclick={() => void onPlayPause()}
        disabled={isRendering}
      >
        <span class="route-index">1</span>
        <Headphones size={18} aria-hidden="true" />
        <strong>{isPlaying ? '일시정지' : '샘플 듣기'}</strong>
        <em>{playStepLabel}</em>
      </button>
      <button type="button" class="starter-route-step" aria-label="초보자 가사 적용" onclick={onApplyLyricLine}>
        <span class="route-index">2</span>
        <PencilLine size={18} aria-hidden="true" />
        <strong>가사 적용</strong>
        <em>{lyricRouteStatus}</em>
      </button>
      <button type="button" class="starter-route-step" aria-label="초보자 멜로디 만들기" onclick={onOpenCompose}>
        <span class="route-index">3</span>
        <Wand2 size={18} aria-hidden="true" />
        <strong>멜로디 만들기</strong>
        <em>{composeRouteStatus}</em>
      </button>
      <button
        type="button"
        class={`starter-route-step export ${rendered ? 'ready' : ''}`}
        aria-label="초보자 WAV 받기"
        onclick={() => void onDownloadWav()}
        disabled={isRendering}
      >
        <span class="route-index">4</span>
        <Download size={18} aria-hidden="true" />
        <strong>WAV 받기</strong>
        <em>{exportRouteStatus}</em>
      </button>
    </div>
  </div>

  <div class="starter-utility-row" aria-label="Starter project utilities">
    <button
      type="button"
      class={`starter-utility-button listen ${isPlaying ? 'active' : ''}`}
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
      class={`starter-utility-button primary ${rendered ? 'ready' : ''}`}
      aria-label="스타터 WAV 다운로드"
      onclick={() => void onDownloadWav()}
      disabled={isRendering}
    >
      <Download size={17} aria-hidden="true" />
      <span>2 {wavLabel}</span>
      <strong>{rendered ? 'download' : '44.1k mono'}</strong>
    </button>
    <button type="button" class="starter-utility-button" aria-label="새 프로젝트" onclick={onNewProject}>
      <FilePlus size={17} aria-hidden="true" />
      <span>새로 시작</span>
      <strong>blank</strong>
    </button>
    <button type="button" class="starter-utility-button ghost" aria-label="데모 프로젝트로 복구" onclick={onResetDemoProject}>
      <RotateCcw size={17} aria-hidden="true" />
      <span>데모 복구</span>
      <strong>{lyricPreview}</strong>
    </button>
  </div>
</section>
