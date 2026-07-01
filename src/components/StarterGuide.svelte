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
    isLoadingVoicebank: boolean
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
    isLoadingVoicebank,
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
  const isStarterActionLocked = $derived(isLoadingVoicebank && !rendered)
  const voicebankStatusLabel = $derived(isLoadingVoicebank ? '보컬 로딩' : isVoicebankReady ? '발음 준비' : coverageLabel)
  const playStepLabel = $derived(isStarterActionLocked ? '준비 중' : isRendering ? '렌더 중' : rendered ? '재생 가능' : '눌러보기')
  const projectContextLabel = $derived(formatProjectSourceLabel(projectSourceLabel))
  const isDraftProject = $derived(projectSourceLabel === 'Saved browser draft')
  const nextActionMeta = $derived(rendered ? rendered.fileName : `${project.notes.length} notes · ${project.bpm} BPM`)
  const guideSummary = $derived(rendered ? 'WAV 준비 완료' : '듣기 · 가사 · WAV')
  const missionWavMeta = $derived(rendered ? 'download' : isRendering ? '렌더 중' : '렌더 후 저장')
  const chordGuide = $derived(project.chords?.slice(0, 4).map((chord) => chord.symbol).join(' -> ') || '멜로디 중심')
  const lyricRouteStatus = $derived(`${project.notes.length} notes`)
  const hasPendingLyricLine = $derived(compactLine(lyricLine) !== compactLine(lyricPreview) && compactLine(lyricLine).length > 0)
  const listenProgressClass = $derived(isStarterActionLocked || isPlaying || !rendered ? 'current' : 'done')
  const lyricProgressClass = $derived(hasPendingLyricLine ? 'current' : rendered ? 'done' : 'next')
  const exportProgressClass = $derived(rendered ? 'current' : 'next')
  const listenStateLabel = $derived(isStarterActionLocked ? '준비' : isPlaying ? '재생 중' : rendered ? '완료' : '지금')
  const lyricStateLabel = $derived(hasPendingLyricLine ? '지금' : rendered ? '완료' : '다음')
  const exportStateLabel = $derived(rendered ? '지금' : '다음')
  const lyricProgressMeta = $derived(hasPendingLyricLine ? '적용 대기' : lyricRouteStatus)
  const exportRouteStatus = $derived(rendered ? '저장 가능' : missionWavMeta)
  const coachPrimaryAction = $derived(rendered ? 'WAV 받기' : hasPendingLyricLine ? '가사 적용' : isStarterActionLocked ? '보컬 대기' : '샘플 듣기')
  const coachNextAction = $derived(rendered ? 'DAW 번들' : hasPendingLyricLine ? '다시 듣기' : '가사 바꾸기')
  const coachState = $derived(rendered ? '완성 파일 준비' : hasPendingLyricLine ? '가사 적용 대기' : isStarterActionLocked ? '보컬 준비 중' : '첫 재생 대기')
  const compassTone = $derived(
    isStarterActionLocked
      ? '보컬 불러오는 중'
      : rendered
        ? 'WAV 저장 가능'
        : hasPendingLyricLine
          ? '가사 적용 대기'
          : isVoicebankReady
            ? '바로 시작 가능'
            : '보컬 로딩 중',
  )
  const compassDetail = $derived(
    isStarterActionLocked
      ? '기본 UTAU 보이스를 불러오고 있어요. 준비되면 첫 버튼이 켜집니다.'
      : rendered
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
  const koreanAliasLabel = $derived(voicebankCoverage ? `${voicebankCoverage.matchedNotes}/${voicebankCoverage.totalNotes} alias` : 'alias 대기')
  const koreanModeDetail = $derived(
    isVoicebankReady ? `${voicebankLabel}가 현재 가사를 모두 매칭합니다.` : '기본 보컬의 한글 발음 매칭을 확인하고 있어요.',
  )
  const koreanWavStepLabel = $derived(rendered ? 'WAV 준비됨' : '렌더하면 WAV')
  const completionCount = $derived(rendered ? 3 : hasPendingLyricLine ? 1 : isPlaying ? 1 : 0)
  const starterProgressLabel = $derived(`${completionCount}/3`)
  const startPanelTitle = $derived(isDraftProject ? '지난 작업이 열렸어요' : '기본 샘플 준비 완료')
  const startPanelDetail = $derived(
    rendered
      ? 'WAV가 준비됐어요. 저장하거나 DAW 번들로 받을 수 있어요.'
      : hasPendingLyricLine
        ? '가사를 적용하고 바로 들어보면 돼요.'
        : isStarterActionLocked
          ? '기본 보컬을 불러오는 중이에요.'
          : isDraftProject
            ? '처음이면 기본 샘플, 이어 하려면 샘플 듣기.'
            : '샘플 듣기, 가사 바꾸기, WAV 저장 순서로 가면 돼요.',
  )
  const startPrimaryLabel = $derived(rendered && !isPlaying ? 'WAV 받기' : isPlaying ? '멈추기' : isStarterActionLocked ? '보컬 대기' : '샘플 듣기')
  const startSecondaryLabel = $derived(isDraftProject ? '기본 샘플' : '빈 프로젝트')
  const startSecondaryMeta = $derived(isDraftProject ? '도히도히' : '새 노래')
  const startSecondaryAria = $derived(isDraftProject ? '기본 샘플로 시작' : '새 프로젝트 만들기')
  const recommendedStepLabel = $derived(rendered && !isPlaying ? '03 WAV 저장' : hasPendingLyricLine ? '02 가사 적용' : '01 샘플 듣기')
  const releaseReviewHubHref = `${import.meta.env.BASE_URL}review/index.html`
  const listeningReviewHref = `${import.meta.env.BASE_URL}review/v3/index.html`
  const wavDawHandoffHref = `${import.meta.env.BASE_URL}review/wav-daw/index.html`

  async function handleNextAction() {
    if (rendered && !isPlaying) {
      await onDownloadWav()
      return
    }
    if (isStarterActionLocked) {
      return
    }
    await onPlayPause()
  }

  function compactLine(line: string) {
    return line.replace(/\s+/gu, '')
  }
</script>

<section class="starter-guide onboarding-v5 onboarding-v6 onboarding-v7 onboarding-v8" aria-label="First run guide">
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

  <div class="starter-start-panel" aria-label="Beginner start panel">
    <div class="starter-start-copy">
      <span>처음이면 여기부터</span>
      <strong>{startPanelTitle}</strong>
      <em>{startPanelDetail}</em>
      <div class="starter-start-steps" aria-label="첫 사용 순서">
        <span class={listenProgressClass}>1 듣기</span>
        <span class={lyricProgressClass}>2 가사</span>
        <span class={exportProgressClass}>3 저장</span>
      </div>
    </div>
    <div class="starter-start-lyric" aria-label="Top starter lyric editor">
      <div class="starter-start-lyric-head">
        <span>가사 입력</span>
        <strong>{lyricInputStatus}</strong>
      </div>
      <div class="starter-start-lyric-row">
        <input
          aria-label="빠른 가사 입력"
          value={lyricLine}
          placeholder="도히도히 다이스키"
          oninput={(event) => onLyricLine(inputValue(event))}
        />
        <button type="button" aria-label="빠른 가사 적용" onclick={onApplyLyricLine}>
          <Check size={16} aria-hidden="true" />
          <span>적용</span>
        </button>
      </div>
      <em>현재 {lyricPreview}</em>
    </div>
    <div class="starter-start-actions">
      <div class="starter-action-note" aria-label="Recommended starter action">
        <span>지금 할 일</span>
        <strong>{recommendedStepLabel}</strong>
      </div>
      <button
        type="button"
        class={`starter-start-primary ${rendered && !isPlaying ? 'ready' : ''} ${isPlaying ? 'active' : ''}`}
        aria-label="초보자 첫 버튼"
        onclick={() => void handleNextAction()}
        disabled={isRendering || isStarterActionLocked}
      >
        {#if rendered && !isPlaying}
          <Download size={20} aria-hidden="true" />
        {:else if isPlaying}
          <Music2 size={20} aria-hidden="true" />
        {:else}
          <Play size={20} aria-hidden="true" />
        {/if}
        <span>{startPrimaryLabel}</span>
        <strong>{nextActionMeta}</strong>
      </button>
      <button type="button" class="starter-start-secondary" aria-label={startSecondaryAria} onclick={isDraftProject ? onResetDemoProject : onNewProject}>
        {#if isDraftProject}
          <RotateCcw size={18} aria-hidden="true" />
        {:else}
          <FilePlus size={18} aria-hidden="true" />
        {/if}
        <span>{startSecondaryLabel}</span>
        <strong>{startSecondaryMeta}</strong>
      </button>
    </div>
  </div>

  <div class="starter-korean-path" aria-label="Starter Korean mode path">
    <div class="starter-korean-copy">
      <span>한국어 UTAU 모드</span>
      <strong>한글을 쓰면 발음 alias로 바로 연결</strong>
      <em>{koreanModeDetail}</em>
    </div>
    <div class="starter-korean-steps" aria-label="Korean mode quick route">
      <span class="ready">한글 입력</span>
      <span class={isVoicebankReady ? 'ready' : 'pending'}>{koreanAliasLabel}</span>
      <span class={rendered ? 'ready' : 'next'}>{koreanWavStepLabel}</span>
    </div>
  </div>

  <details class="starter-context-drawer" aria-label="Starter context drawer">
    <summary>
      <ListChecks size={15} aria-hidden="true" />
      <span>현재 프로젝트</span>
      <strong>{projectStateTitle} · {voicebankStatusLabel}</strong>
    </summary>
    <div class="starter-coach-strip" aria-label="Starter onboarding coach">
      <div>
        <span>현재 열린 프로젝트</span>
        <strong>{project.name}</strong>
        <em>{projectStateTitle} · {voicebankLabel}</em>
      </div>
      <div>
        <span>샘플 가사</span>
        <strong>{lyricPreview}</strong>
        <em>{coachState}</em>
      </div>
      <div class="hot">
        <span>다음 버튼</span>
        <strong>{coachPrimaryAction}</strong>
        <em>{coachNextAction}</em>
      </div>
    </div>
  </details>

  <div class="starter-compass" aria-label="First run one-minute path">
    <div class="starter-compass-copy">
      <span>첫 완성 루트</span>
      <strong>샘플 듣기 -&gt; 가사 바꾸기 -&gt; WAV 저장</strong>
      <div class="starter-hook-guide" aria-label="Starter hook chord guide">
        <Music2 size={14} aria-hidden="true" />
        <span>{chordGuide}</span>
      </div>
      <em>{compassDetail}</em>
    </div>
    <div class="starter-compass-tags" aria-label="Starter readiness snapshot">
      <span class={isVoicebankReady ? 'ready' : 'pending'}>{voicebankStatusLabel}</span>
      <span>{project.notes.length} notes</span>
      <span>{compassTone}</span>
    </div>
  </div>

  <div class="starter-guide-launch" aria-label="Starter launch panel">
    <ol class="starter-journey" aria-label="Starter route summary">
      <li class={listenProgressClass} aria-current={listenProgressClass === 'current' ? 'step' : undefined}>
        <button type="button" aria-label={isPlaying ? '첫 단계 일시정지' : '첫 단계 샘플 듣기'} onclick={() => void onPlayPause()} disabled={isRendering || isStarterActionLocked}>
          <span class="progress-index">01</span>
          <Headphones size={18} aria-hidden="true" />
          <strong>{isPlaying ? '일시정지' : '샘플 듣기'}</strong>
          <em>{playStepLabel}</em>
          <span class="step-state">{listenStateLabel}</span>
        </button>
      </li>
      <li class={lyricProgressClass} aria-current={lyricProgressClass === 'current' ? 'step' : undefined}>
        <button type="button" aria-label="둘째 단계 가사 적용" onclick={onApplyLyricLine}>
          <span class="progress-index">02</span>
          <PencilLine size={18} aria-hidden="true" />
          <strong>가사 적용</strong>
          <em>{lyricProgressMeta}</em>
          <span class="step-state">{lyricStateLabel}</span>
        </button>
      </li>
      <li class={exportProgressClass} aria-current={exportProgressClass === 'current' ? 'step' : undefined}>
        <button type="button" aria-label="셋째 단계 WAV 받기" onclick={() => void onDownloadWav()} disabled={isRendering || isStarterActionLocked}>
          <span class="progress-index">03</span>
          <Download size={18} aria-hidden="true" />
          <strong>WAV 받기</strong>
          <em>{exportRouteStatus}</em>
          <span class="step-state">{exportStateLabel}</span>
        </button>
      </li>
    </ol>
  </div>

  <details class="starter-onboarding-grid starter-beginner-details" aria-label="Beginner launch pad">
    <summary class="starter-beginner-details-head">
      <ListChecks size={16} aria-hidden="true" />
      <div>
        <span>가사 자세히</span>
        <strong>예시 · 추가 작업</strong>
      </div>
    </summary>
    <div class="starter-beginner-details-body">
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

      <details class="starter-quick-actions starter-next-steps-card" aria-label="Starter project utilities">
        <summary class="starter-quick-actions-head">
          <ListChecks size={16} aria-hidden="true" />
          <div>
            <span>추가 작업</span>
            <strong>멜로디 · DAW · 프로젝트</strong>
          </div>
        </summary>
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
          <button type="button" class="starter-utility-button ready" aria-label="스타터 DAW 번들 다운로드" onclick={() => void onDownloadDawBundle()} disabled={isRendering || isStarterActionLocked}>
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
      </details>
    </div>
  </details>

  <details class="starter-advanced-tools starter-review-tools" aria-label="Starter handoff checklist">
    <summary>
      <ListChecks size={15} aria-hidden="true" />
      <span>고급 도구</span>
      <strong>검수 · 공개 준비</strong>
    </summary>
    <div class="starter-handoff-package">
      <span>다운로드 패키지</span>
      <strong>WAV · melody.mid · chords.mid</strong>
      <em>arrangement.txt · lyrics.txt · notes.csv 포함</em>
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
