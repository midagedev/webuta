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
  import { TICKS_PER_BEAT } from '../types'
  import type { VoicebankCoverage } from '../voicebank'
  import type { DemoSample, DemoSampleId } from '../demoProject'
  import { toneName } from '../music'
  import { formatProjectSourceLabel, formatVoicebankCoverage, inputValue } from '../app/ui'

  type Props = {
    project: SongProject
    projectSourceLabel: string
    demoSamples: DemoSample[]
    lyricLine: string
    voicebankName: string
    voicebankCoverage: VoicebankCoverage | null
    isLoadingVoicebank: boolean
    rendered: RenderedAudio | null
    isRendering: boolean
    isPlaying: boolean
    onNewProject: () => void
    onResetDemoProject: () => void
    onSelectDemoSample: (sampleId: DemoSampleId) => void
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
    demoSamples,
    lyricLine,
    voicebankName,
    voicebankCoverage,
    isLoadingVoicebank,
    rendered,
    isRendering,
    isPlaying,
    onNewProject,
    onResetDemoProject,
    onSelectDemoSample,
    onLyricLine,
    onApplyLyricLine,
    onOpenCompose,
    onPlayPause,
    onDownloadWav,
    onDownloadDawBundle,
  }: Props = $props()

  const fullLyricPreview = $derived(project.notes.map((note) => note.lyric).join(' '))
  const voicebankLabel = $derived(voicebankName.replace(/^WebUtau\s*\/\/\s*/u, '') || voicebankName)
  const coverageLabel = $derived(voicebankCoverage ? formatVoicebankCoverage(voicebankCoverage, 'compact') : 'loading')
  const isVoicebankReady = $derived(Boolean(voicebankCoverage && voicebankCoverage.fallbackNotes === 0))
  const isStarterActionLocked = $derived(isLoadingVoicebank && !rendered)
  const voicebankStatusLabel = $derived(isLoadingVoicebank ? '보컬 로딩' : isVoicebankReady ? '발음 준비' : coverageLabel)
  const projectContextLabel = $derived(formatProjectSourceLabel(projectSourceLabel))
  const activeSampleId = $derived(demoSamples.find((sample) => sample.project.source?.fileName === project.source?.fileName)?.id ?? demoSamples[0]?.id)
  const isDraftProject = $derived(projectSourceLabel === 'Saved browser draft')
  const nextActionMeta = $derived(rendered ? rendered.fileName : `${project.notes.length} notes · ${project.bpm} BPM`)
  const guideSummary = $derived(rendered ? 'WAV 준비 완료' : '듣기 · 가사 · WAV')
  const chordGuide = $derived(project.chords?.slice(0, 4).map((chord) => chord.symbol).join(' -> ') || '멜로디 중심')
  const hasPendingLyricLine = $derived(compactLine(lyricLine) !== compactLine(fullLyricPreview) && compactLine(lyricLine).length > 0)
  const listenProgressClass = $derived(isStarterActionLocked || isPlaying || !rendered ? 'current' : 'done')
  const lyricProgressClass = $derived(hasPendingLyricLine ? 'current' : rendered ? 'done' : 'next')
  const exportProgressClass = $derived(rendered ? 'current' : 'next')
  const listenStateLabel = $derived(isStarterActionLocked ? '준비' : isPlaying ? '재생 중' : rendered ? '완료' : '지금')
  const lyricStateLabel = $derived(hasPendingLyricLine ? '지금' : rendered ? '완료' : '다음')
  const exportStateLabel = $derived(rendered ? '지금' : '다음')
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
  const projectStateTitle = $derived(isDraftProject ? '저장된 작업' : '기본 샘플')
  const projectStateDetail = $derived(isDraftProject ? '이전 작업을 이어서 열었어요' : `${fullLyricPreview}로 시작해요`)
  const lyricInputStatus = $derived(hasPendingLyricLine ? '적용 전 새 가사' : '현재 멜로디와 같음')
  const koreanAliasLabel = $derived(voicebankCoverage ? `${voicebankCoverage.matchedNotes}/${voicebankCoverage.totalNotes} alias` : 'alias 대기')
  const koreanModeDetail = $derived(
    isVoicebankReady ? `${voicebankLabel}가 현재 가사를 모두 매칭합니다.` : '기본 보컬의 한글 발음 매칭을 확인하고 있어요.',
  )
  const koreanWavStepLabel = $derived(rendered ? 'WAV 준비됨' : '렌더하면 WAV')
  const activeSample = $derived(demoSamples.find((sample) => sample.id === activeSampleId) ?? demoSamples[0])
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
  const startSecondaryMeta = $derived(isDraftProject ? '샘플 선택' : '새 노래')
  const startSecondaryAria = $derived(isDraftProject ? '기본 샘플로 시작' : '새 프로젝트 만들기')
  const recommendedStepLabel = $derived(rendered && !isPlaying ? '03 WAV 저장' : hasPendingLyricLine ? '02 가사 적용' : '01 샘플 듣기')
  const starterOutputLabel = $derived(rendered ? rendered.fileName : 'First-Vocal-Sketch.wav')
  const missionDetail = $derived(
    rendered
      ? `${starterOutputLabel} 파일이 준비됐어요. 저장하거나 DAW 번들로 이어가면 됩니다.`
      : hasPendingLyricLine
        ? '새 가사를 멜로디에 적용하면 바로 다시 들을 수 있어요.'
        : `샘플을 듣고, 한 줄 가사를 바꾼 뒤 ${starterOutputLabel}로 받으면 첫 곡이 완성돼요.`,
  )
  const routeCoachTitle = $derived(rendered ? '이제 저장하면 돼요' : hasPendingLyricLine ? '가사를 적용해볼 차례' : '먼저 샘플을 들어봐요')
  const routeCoachDetail = $derived(
    rendered
      ? 'WAV 받기를 누르면 바로 내려받을 수 있어요.'
      : hasPendingLyricLine
        ? '입력한 가사를 멜로디에 넣고 다시 들어보세요.'
        : '노란색 단계만 따라가면 첫 WAV까지 갈 수 있어요.',
  )
  const listenStepDetail = $derived(isStarterActionLocked ? '보컬 준비 후 클릭' : isPlaying ? '한 번 더 누르면 멈춤' : rendered ? '다시 들어보기' : '기본 소리 확인')
  const lyricStepDetail = $derived(hasPendingLyricLine ? '새 가사 적용하기' : '위 입력칸에서 바꾸기')
  const exportStepDetail = $derived(rendered ? '음악 앱용 파일' : '듣고 나면 저장')
  const releaseReviewHubHref = `${import.meta.env.BASE_URL}review/index.html`
  const listeningReviewHref = `${import.meta.env.BASE_URL}review/v3/index.html`
  const wavDawHandoffHref = `${import.meta.env.BASE_URL}review/wav-daw/index.html`
  const evidencePreflightHref = `${import.meta.env.BASE_URL}review/index.html#evidence-preflight`
  let reviewerRunwaySteps = $derived([
    { index: '01', label: 'Listen', detail: '청취 JSON', href: listeningReviewHref },
    { index: '02', label: 'Handoff', detail: 'DAW JSON', href: wavDawHandoffHref },
    { index: '03', label: 'Preflight', detail: 'No upload', href: evidencePreflightHref },
    { index: '04', label: 'Status', detail: '터미널 확인' },
    { index: '05', label: 'Accept', detail: '최종 수락' },
  ])

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

  function focusQuickLyricInput() {
    const input = document.querySelector<HTMLInputElement>('[data-starter-quick-lyric="true"]')
    input?.focus()
    input?.select()
  }

  function starterSampleStats(sample: DemoSample) {
    const notes = sample.project.notes
    const tones = notes.map((note) => note.tone)
    const minTone = Math.min(...tones)
    const maxTone = Math.max(...tones)
    const finalNote = [...notes].sort((left, right) => left.start + left.duration - (right.start + right.duration)).at(-1)
    return {
      bpm: sample.project.bpm,
      noteCount: notes.length,
      rangeLabel: `${toneName(minTone)}-${toneName(maxTone)}`,
      rangeSemitones: maxTone - minTone,
      codaCount: notes.filter((note) => hasHangulCoda(note.lyric)).length,
      finalBeats: ((finalNote?.duration ?? 0) / TICKS_PER_BEAT).toFixed(1),
    }
  }

  function hasHangulCoda(lyric: string) {
    const syllable = [...lyric].find((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 0xac00 && code <= 0xd7a3
    })
    if (!syllable) {
      return false
    }
    return ((syllable.codePointAt(0) ?? 0) - 0xac00) % 28 !== 0
  }
</script>

<section class="starter-guide onboarding-v5 onboarding-v6 onboarding-v7 onboarding-v8 onboarding-v9 onboarding-v10" aria-label="First run guide">
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

  <div class="starter-mission starter-success-mission" aria-label="Beginner success mission">
    <div class="starter-mission-copy">
      <span>1분 미션</span>
      <strong>한글 한 줄을 보컬 WAV로 만들기</strong>
      <em>{missionDetail}</em>
    </div>
    <div class="starter-mission-actions" aria-label="Beginner success checkpoints">
      <button
        type="button"
        class={`starter-mission-action ${listenProgressClass === 'current' ? 'primary' : listenProgressClass}`}
        aria-label={isPlaying ? '미션 샘플 멈추기' : '미션 샘플 듣기'}
        onclick={() => void onPlayPause()}
        disabled={isRendering || isStarterActionLocked}
      >
        <Headphones size={17} aria-hidden="true" />
        <span>{isPlaying ? '멈추기' : '샘플 듣기'}</span>
        <strong>{listenStateLabel}</strong>
      </button>
      <button
        type="button"
        class={`starter-mission-action ${lyricProgressClass === 'current' ? 'primary' : lyricProgressClass}`}
        aria-label={hasPendingLyricLine ? '미션 가사 적용' : '미션 가사 바꾸기'}
        onclick={hasPendingLyricLine ? onApplyLyricLine : focusQuickLyricInput}
      >
        <PencilLine size={17} aria-hidden="true" />
        <span>{hasPendingLyricLine ? '가사 적용' : '가사 바꾸기'}</span>
        <strong>{lyricStateLabel}</strong>
      </button>
      <button
        type="button"
        class={`starter-mission-action export ${rendered ? 'ready' : exportProgressClass}`}
        aria-label="미션 WAV 받기"
        onclick={() => void onDownloadWav()}
        disabled={isRendering || isStarterActionLocked}
      >
        <Download size={17} aria-hidden="true" />
        <span>WAV 받기</span>
        <strong>{exportStateLabel}</strong>
      </button>
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
          data-starter-quick-lyric="true"
          aria-label="빠른 가사 입력"
          value={lyricLine}
          placeholder="네오빛이 메로디로 데려가"
          oninput={(event) => onLyricLine(inputValue(event))}
        />
        <button type="button" aria-label="빠른 가사 적용" onclick={onApplyLyricLine}>
          <Check size={16} aria-hidden="true" />
          <span>적용</span>
        </button>
      </div>
      <em>현재 {fullLyricPreview}</em>
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

  <div class="starter-sample-gallery" aria-label="Starter sample gallery">
    <div class="starter-sample-gallery-head">
      <span>샘플 고르기</span>
      <strong>보컬로이드풍 훅 {demoSamples.length}개</strong>
      <em>장르, 템포, 가사 발음이 다른 샘플을 먼저 고르고 바로 들어보세요.</em>
    </div>
    {#if activeSample}
      <div class="starter-sample-spotlight" aria-label="Starter sample selection guide">
        <div class="starter-sample-spotlight-copy">
          <span>선택 중</span>
          <strong>{activeSample.title}</strong>
          <em>{activeSample.bestFor}</em>
        </div>
        <div class="starter-sample-spotlight-tags">
          <span>{activeSample.mood}</span>
          <span>{activeSample.listeningCue}</span>
          <span>{activeSample.vocalFocus}</span>
        </div>
      </div>
    {/if}
    <div class="starter-sample-grid">
      {#each demoSamples as sample}
        {@const stats = starterSampleStats(sample)}
        <button
          type="button"
          class:active={sample.id === activeSampleId}
          aria-label={`${sample.title} 샘플 열기`}
          aria-pressed={sample.id === activeSampleId}
          onclick={() => onSelectDemoSample(sample.id)}
        >
          <span>{sample.mood}</span>
          <strong>{sample.title}</strong>
          <span class="starter-sample-best">{sample.bestFor}</span>
          <em>{sample.lyricLine}</em>
          <span class="starter-sample-cues" aria-label={`${sample.title} selection guide`}>
            <b>{sample.listeningCue}</b>
            <b>{sample.vocalFocus}</b>
          </span>
          <span class="starter-sample-metrics" aria-label={`${sample.title} sample metrics`}>
            <b>{stats.bpm} BPM</b>
            <b>{stats.rangeLabel}</b>
            <b>{stats.noteCount} notes</b>
            <b>받침 {stats.codaCount}</b>
            <b>끝 {stats.finalBeats}박</b>
          </span>
          <small>{sample.chordLine} · {sample.detail}</small>
        </button>
      {/each}
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

  <div class="starter-guide-launch" aria-label="Starter launch panel">
    <div class="starter-route-head starter-compass" aria-label="First run one-minute path">
      <div class="starter-compass-copy">
        <span>처음 1분 가이드</span>
        <strong>{routeCoachTitle}</strong>
        <div class="starter-hook-guide" aria-label="Starter hook chord guide">
          <Music2 size={14} aria-hidden="true" />
          <span>{chordGuide}</span>
        </div>
        <em>{routeCoachDetail}</em>
      </div>
      <div class="starter-compass-tags" aria-label="Starter readiness snapshot">
        <span class={isVoicebankReady ? 'ready' : 'pending'}>{voicebankStatusLabel}</span>
        <span>{project.notes.length} notes</span>
        <span>{compassTone}</span>
      </div>
    </div>
    <ol class="starter-journey" aria-label="Starter route summary">
      <li class={listenProgressClass} aria-current={listenProgressClass === 'current' ? 'step' : undefined}>
        <button type="button" aria-label={isPlaying ? '첫 단계 일시정지' : '첫 단계 샘플 듣기'} onclick={() => void onPlayPause()} disabled={isRendering || isStarterActionLocked}>
          <span class="progress-index">01</span>
          <Headphones size={18} aria-hidden="true" />
          <strong>{isPlaying ? '일시정지' : '샘플 듣기'}</strong>
          <em>{listenStepDetail}</em>
          <span class="step-state">{listenStateLabel}</span>
        </button>
      </li>
      <li class={lyricProgressClass} aria-current={lyricProgressClass === 'current' ? 'step' : undefined}>
        <button type="button" aria-label="둘째 단계 가사 바꾸기" onclick={hasPendingLyricLine ? onApplyLyricLine : focusQuickLyricInput}>
          <span class="progress-index">02</span>
          <PencilLine size={18} aria-hidden="true" />
          <strong>{hasPendingLyricLine ? '가사 적용' : '가사 바꾸기'}</strong>
          <em>{lyricStepDetail}</em>
          <span class="step-state">{lyricStateLabel}</span>
        </button>
      </li>
      <li class={exportProgressClass} aria-current={exportProgressClass === 'current' ? 'step' : undefined}>
        <button type="button" aria-label="셋째 단계 WAV 받기" onclick={() => void onDownloadWav()} disabled={isRendering || isStarterActionLocked}>
          <span class="progress-index">03</span>
          <Download size={18} aria-hidden="true" />
          <strong>WAV 받기</strong>
          <em>{exportStepDetail}</em>
          <span class="step-state">{exportStateLabel}</span>
        </button>
      </li>
    </ol>
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
        <strong>{fullLyricPreview}</strong>
        <em>{coachState}</em>
      </div>
      <div class="hot">
        <span>다음 버튼</span>
        <strong>{coachPrimaryAction}</strong>
        <em>{coachNextAction}</em>
      </div>
    </div>
  </details>

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
          <strong>예: 네오빛이 메로디로 데려가 · 밤이 와 너와 나 노래해</strong>
          <em>{lyricInputStatus}</em>
        </div>
        <div class="starter-lyric-input-row">
          <input
            aria-label="스타터 가사 라인"
            value={lyricLine}
            placeholder="네오빛이 메로디로 데려가"
            oninput={(event) => onLyricLine(inputValue(event))}
          />
          <button type="button" aria-label="가사 라인 적용" onclick={onApplyLyricLine}>
            <Check size={17} aria-hidden="true" />
            <span>적용</span>
          </button>
        </div>
        <div class="starter-sample-card" aria-label="Default lyric preview">
          <span>현재 가사</span>
          <strong>{fullLyricPreview}</strong>
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
          <strong>{fullLyricPreview}</strong>
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
            <strong>{fullLyricPreview}</strong>
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
    <div class="starter-review-runway" aria-label="Starter reviewer runway">
      <div class="starter-review-runway-head">
        <span>Reviewer Runway</span>
        <strong>2 JSON 파일로 공개 전 체크 완료</strong>
      </div>
      <div class="starter-review-runway-steps">
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
