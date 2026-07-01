<script lang="ts">
  import {
    Check,
    Download,
    ExternalLink,
    FileArchive,
    FilePlus,
    Headphones,
    ListChecks,
    Music2,
    PencilLine,
    Play,
    RotateCcw,
    Wand2,
  } from '@lucide/svelte'
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
    onDownloadDawBundle: () => Promise<void>
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
    onDownloadDawBundle,
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
  const guideSummary = $derived(rendered ? 'WAV 준비 완료' : '듣기 · 가사 · WAV')
  const missionWavMeta = $derived(rendered ? 'download' : isRendering ? '렌더 중' : '렌더 후 저장')
  const focusStep = $derived(isRendering ? '02' : rendered ? '03' : '01')
  const focusTitle = $derived(
    isRendering ? '소리 만드는 중' : rendered ? 'WAV 저장하기' : isVoicebankReady ? '샘플 먼저 듣기' : '샘플 준비 중',
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
            : '기본 보컬 로딩',
  )
  const lyricRouteStatus = $derived(`${project.notes.length} notes`)
  const hasPendingLyricLine = $derived(compactLine(lyricLine) !== compactLine(lyricPreview) && compactLine(lyricLine).length > 0)
  const listenProgressClass = $derived(isPlaying || !rendered ? 'current' : 'done')
  const lyricProgressClass = $derived(hasPendingLyricLine ? 'current' : rendered ? 'done' : 'next')
  const exportProgressClass = $derived(rendered ? 'current' : 'next')
  const lyricProgressMeta = $derived(hasPendingLyricLine ? '적용 대기' : lyricRouteStatus)
  const exportRouteStatus = $derived(rendered ? '저장 가능' : missionWavMeta)
  const compassTone = $derived(
    rendered ? 'WAV 저장 가능' : hasPendingLyricLine ? '가사 적용 대기' : isVoicebankReady ? '바로 시작 가능' : '보컬 로딩 중',
  )
  const compassDetail = $derived(
    rendered
      ? '재생 확인이 끝났어요. WAV나 DAW 번들로 저장하면 됩니다.'
      : hasPendingLyricLine
        ? '새 가사를 멜로디에 넣은 뒤 샘플을 다시 들어보세요.'
        : isVoicebankReady
          ? '샘플을 먼저 듣고, 마음에 들면 가사만 바꿔보세요.'
          : '기본 보컬을 불러오고 있어요. 준비되면 첫 버튼이 열립니다.',
  )
  const projectStateTitle = $derived(isDraftProject ? '저장된 작업' : '기본 샘플')
  const projectStateDetail = $derived(isDraftProject ? '이전 작업을 이어서 열었어요' : '도히도히 다이스키로 시작해요')
  const lyricInputStatus = $derived(hasPendingLyricLine ? '적용 전 새 가사' : '현재 멜로디와 같음')
  const completionCount = $derived(rendered ? 3 : hasPendingLyricLine ? 1 : isPlaying ? 1 : 0)
  const starterProgressLabel = $derived(`${completionCount}/3`)
  const releaseReviewHubHref = `${import.meta.env.BASE_URL}review/index.html`
  const listeningReviewHref = `${import.meta.env.BASE_URL}review/v3/index.html`
  const wavDawHandoffHref = `${import.meta.env.BASE_URL}review/wav-daw/index.html`

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

<section class="starter-guide onboarding-v5 onboarding-v6" aria-label="First run guide">
  <div class="starter-guide-head">
    <div class="starter-title">
      <span>처음 시작</span>
      <strong>{project.name}</strong>
      <em>{guideSummary}</em>
    </div>
    <div class="starter-status" aria-label="Starter status">
      <span>{project.bpm} BPM</span>
      <span class={isVoicebankReady ? 'ready' : 'pending'}>{voicebankStatusLabel}</span>
      <span>{projectContextLabel}</span>
      <span class="starter-progress-pill">{starterProgressLabel}</span>
    </div>
  </div>

  <div class="starter-compass" aria-label="First run one-minute path">
    <div class="starter-compass-copy">
      <span>1분 완성 루트</span>
      <strong>샘플 듣기 -&gt; 가사 바꾸기 -&gt; WAV 저장</strong>
      <em>{compassDetail}</em>
    </div>
    <div class="starter-compass-tags" aria-label="Starter readiness snapshot">
      <span class={isVoicebankReady ? 'ready' : 'pending'}>{voicebankStatusLabel}</span>
      <span>{project.notes.length} notes</span>
      <span>{compassTone}</span>
    </div>
  </div>

  <div class="starter-guide-launch" aria-label="Starter launch panel">
    <div class="starter-hero-action" aria-label="Starter next action">
      <div class="starter-focus-copy starter-coach-copy">
        <span>STEP {focusStep} · 지금 누를 버튼</span>
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

    <ol class="starter-journey" aria-label="Starter route summary">
      <li class={listenProgressClass}>
        <button type="button" aria-label={isPlaying ? '첫 단계 일시정지' : '첫 단계 샘플 듣기'} onclick={() => void onPlayPause()} disabled={isRendering}>
          <span class="progress-index">01</span>
          <Headphones size={18} aria-hidden="true" />
          <strong>{isPlaying ? '일시정지' : '샘플 듣기'}</strong>
          <em>{playStepLabel}</em>
        </button>
      </li>
      <li class={lyricProgressClass}>
        <button type="button" aria-label="둘째 단계 가사 적용" onclick={onApplyLyricLine}>
          <span class="progress-index">02</span>
          <PencilLine size={18} aria-hidden="true" />
          <strong>가사 적용</strong>
          <em>{lyricProgressMeta}</em>
        </button>
      </li>
      <li class={exportProgressClass}>
        <button type="button" aria-label="셋째 단계 WAV 받기" onclick={() => void onDownloadWav()} disabled={isRendering}>
          <span class="progress-index">03</span>
          <Download size={18} aria-hidden="true" />
          <strong>WAV 받기</strong>
          <em>{exportRouteStatus}</em>
        </button>
      </li>
    </ol>
  </div>

  <div class="starter-onboarding-grid" aria-label="Beginner launch pad">
    <div class="starter-edit-card" aria-label="Starter lyric editor">
      <div class="starter-edit-head">
        <span>가사 바꾸기</span>
        <strong>{project.notes.length} notes</strong>
      </div>
      <div class="starter-lyric-helper" aria-label="Lyric input helper">
        <span>한글 그대로 입력</span>
        <strong>예: 도히도히 다이스키 · 사랑해 · 별빛</strong>
        <em>{lyricInputStatus}</em>
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
          <span>{projectStateTitle}</span>
          <strong>{projectStateDetail}</strong>
        </div>
      </div>
      <div class="starter-mini-preview starter-project-state" aria-label="Starter lyric preview">
        <span>{projectStateTitle}</span>
        <strong>{lyricPreview}</strong>
        <em>{isDraftProject ? projectStateDetail : voicebankLabel}</em>
        {#if isDraftProject}
          <button type="button" class="starter-inline-reset" aria-label="저장된 작업 대신 기본 샘플 열기" onclick={onResetDemoProject}>
            <RotateCcw size={14} aria-hidden="true" />
            <span>기본 샘플로</span>
          </button>
        {/if}
      </div>
      <div class="starter-utility-row">
        <button type="button" class="starter-utility-button listen" aria-label="스타터 멜로디 추천" onclick={onOpenCompose}>
          <Wand2 size={17} aria-hidden="true" />
          <span>멜로디 추천</span>
          <strong>선택 사항</strong>
        </button>
        <button type="button" class="starter-utility-button ready" aria-label="스타터 DAW 번들 다운로드" onclick={() => void onDownloadDawBundle()} disabled={isRendering}>
          <FileArchive size={17} aria-hidden="true" />
          <span>DAW 번들</span>
          <strong>{rendered ? 'WAV 포함' : '렌더 후 ZIP'}</strong>
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

  <details class="starter-advanced-tools starter-review-tools" aria-label="Starter handoff checklist">
    <summary>
      <ListChecks size={15} aria-hidden="true" />
      <span>고급 도구</span>
      <strong>검수 · 공개 준비</strong>
    </summary>
    <div class="starter-handoff-package">
      <span>다운로드 패키지</span>
      <strong>WAV · lyrics.txt · notes.csv</strong>
      <em>{rendered ? '렌더 완료' : 'DAW 번들에 포함'}</em>
    </div>
    <div class="starter-handoff-links starter-review-grid">
      <a href={releaseReviewHubHref} target="_blank" rel="noreferrer" aria-label="스타터 릴리스 허브 열기">
        <ExternalLink size={15} aria-hidden="true" />
        <span>릴리스 허브</span>
      </a>
      <a href={listeningReviewHref} target="_blank" rel="noreferrer" aria-label="스타터 청취 리뷰 열기">
        <Headphones size={15} aria-hidden="true" />
        <span>청취 리뷰</span>
      </a>
      <a href={wavDawHandoffHref} target="_blank" rel="noreferrer" aria-label="스타터 DAW 리포트 만들기">
        <FileArchive size={15} aria-hidden="true" />
        <span>DAW 리포트</span>
      </a>
    </div>
  </details>
</section>
