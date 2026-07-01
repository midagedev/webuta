<script lang="ts">
  import {
    Copy,
    Download,
    FileArchive,
    FileDown,
    FilePlus,
    FileText,
    FolderOpen,
    Info,
    Pause,
    Play,
    Redo2,
    Repeat2,
    RotateCcw,
    Save,
    Share2,
    SkipBack,
    Square,
    Undo2,
    Upload,
    X,
  } from '@lucide/svelte'
  import type { RenderProgress, SongProject } from '../types'
  import { formatProjectSourceLabel, formatTime, inputValue } from '../app/ui'

  type Props = {
    project: SongProject
    projectSourceLabel: string
    playbackTime: number
    displayDuration: number
    renderProgress: RenderProgress
    isRendering: boolean
    isPlaying: boolean
    isLoadingVoicebank: boolean
    isLoopOn: boolean
    loopStartSeconds: number
    loopEndSeconds: number
    canUndo: boolean
    canRedo: boolean
    onNewProject: () => void
    onResetDemoProject: () => void
    onDuplicateProject: () => void
    onProjectFile: (file: File) => Promise<void>
    onVoicebankFile: (file: File) => Promise<void>
    onSaveProject: () => void
    onExportUstx: () => void
    onExportUst: () => void
    onUndo: () => void
    onRedo: () => void
    onOpenLicenses: () => void
    onStop: () => void
    onPlayPause: () => Promise<void>
    onToggleLoop: () => void
    onCancelRender: () => void
    onShare: () => Promise<void>
    onDownloadWav: () => Promise<void>
    onDownloadDawBundle: () => Promise<void>
    onProjectName: (name: string) => void
  }

  let {
    project,
    projectSourceLabel,
    playbackTime,
    displayDuration,
    renderProgress,
    isRendering,
    isPlaying,
    isLoadingVoicebank,
    isLoopOn,
    loopStartSeconds,
    loopEndSeconds,
    canUndo,
    canRedo,
    onNewProject,
    onResetDemoProject,
    onDuplicateProject,
    onProjectFile,
    onVoicebankFile,
    onSaveProject,
    onExportUstx,
    onExportUst,
    onUndo,
    onRedo,
    onOpenLicenses,
    onStop,
    onPlayPause,
    onToggleLoop,
    onCancelRender,
    onShare,
    onDownloadWav,
    onDownloadDawBundle,
    onProjectName,
  }: Props = $props()

  let projectInput: HTMLInputElement
  let voicebankInput: HTMLInputElement
  const projectSourceDisplay = $derived(formatProjectSourceLabel(projectSourceLabel))

  async function handleProjectFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
      await onProjectFile(file)
    }
    input.value = ''
  }

  async function handleVoicebankFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
      await onVoicebankFile(file)
    }
    input.value = ''
  }
</script>

<header class="topbar">
  <div class="nav-cluster" aria-label="Project navigation">
    <button type="button" class="toolbar-button project-action new-project-action" title="새 프로젝트" onclick={onNewProject}>
      <FilePlus size={20} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button project-action duplicate-project-action" title="프로젝트 복제" onclick={onDuplicateProject}>
      <Copy size={19} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button project-action reset-demo-action" title="데모로 리셋" onclick={onResetDemoProject}>
      <RotateCcw size={19} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button project-action open-project-action" title="프로젝트 열기" onclick={() => projectInput?.click()}>
      <FolderOpen size={20} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button project-action save-project-action" title="WebUtau 프로젝트 저장" onclick={onSaveProject}>
      <Save size={20} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button project-action export-ustx-action" title="USTX 내보내기" onclick={onExportUstx}>
      <FileDown size={20} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button project-action export-ust-action" title="UST 내보내기" onclick={onExportUst}>
      <FileText size={19} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button edit-action" title="되돌리기" onclick={onUndo} disabled={!canUndo}>
      <Undo2 size={19} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button edit-action" title="다시 실행" onclick={onRedo} disabled={!canRedo}>
      <Redo2 size={19} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button utility-action" title="라이선스" onclick={onOpenLicenses}>
      <Info size={19} aria-hidden="true" />
    </button>
    <div class="project-context" aria-label="Current project">
      <span>현재 프로젝트</span>
      <strong>{project.name}</strong>
      <em>{projectSourceDisplay}</em>
    </div>
  </div>

  <div class="transport-center" aria-label="Playback controls">
    <button type="button" class="transport-button" title="처음으로" onclick={onStop}>
      <SkipBack size={20} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="play-button"
      aria-label={isPlaying ? '일시정지' : '재생'}
      title={isPlaying ? '일시정지' : '재생'}
      onclick={() => void onPlayPause()}
      disabled={isRendering}
    >
      {#if isPlaying}
        <Pause size={24} aria-hidden="true" />
      {:else}
        <Play size={24} aria-hidden="true" />
      {/if}
    </button>
    <button type="button" class="transport-button" title="정지" onclick={onStop}>
      <Square size={17} aria-hidden="true" />
    </button>
    <button
      type="button"
      class={`transport-button loop-toggle ${isLoopOn ? 'active' : ''}`}
      aria-label={isLoopOn ? '루프 끄기' : '루프 켜기'}
      title={isLoopOn ? `루프 ${formatTime(loopStartSeconds)} - ${formatTime(loopEndSeconds)}` : '루프 켜기'}
      onclick={onToggleLoop}
    >
      <Repeat2 size={18} aria-hidden="true" />
    </button>
    {#if isRendering}
      <button type="button" class="transport-button cancel-render-button" title="렌더 취소" onclick={onCancelRender} disabled={!renderProgress.cancellable}>
        <X size={18} aria-hidden="true" />
      </button>
    {/if}
    <div class="lcd-panel" aria-label="Transport display">
      <div class="lcd-side">
        <span class="lcd-label">TIME</span>
        <span class="lcd-counter">{formatTime(playbackTime)} / {formatTime(displayDuration)}</span>
      </div>
      <input
        class="project-title"
        aria-label="Project name"
        value={project.name}
        oninput={(event) => onProjectName(inputValue(event))}
      />
      <div class="lcd-side right">
        <span class="lcd-label">SONG</span>
        <span class="lcd-meta">{project.bpm} BPM · {project.beatPerBar}/{project.beatUnit}</span>
      </div>
    </div>
  </div>

  <div class="export-cluster" aria-label="Project actions">
    <button
      type="button"
      class="toolbar-button bank-action"
      aria-label="보컬 ZIP 가져오기"
      title="보컬 ZIP 가져오기"
      onclick={() => voicebankInput?.click()}
      disabled={isLoadingVoicebank}
    >
      <Upload size={20} aria-hidden="true" />
    </button>
    <button type="button" class="export-button share-action" onclick={() => void onShare()} disabled={isRendering}>
      <Share2 size={19} aria-hidden="true" />
      <span>공유</span>
    </button>
    <button
      type="button"
      class="toolbar-button bundle-action"
      aria-label="DAW 번들 다운로드"
      title="DAW 번들 다운로드"
      onclick={() => void onDownloadDawBundle()}
      disabled={isRendering}
    >
      <FileArchive size={19} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="toolbar-button download-action"
      aria-label="WAV 다운로드"
      title="WAV 다운로드"
      onclick={() => void onDownloadWav()}
      disabled={isRendering}
    >
      <Download size={19} aria-hidden="true" />
    </button>
  </div>

  <div class="hidden-top-inputs">
    <input
      bind:this={projectInput}
      type="file"
      accept=".webutau.json,.ust,.ustx,.yaml,.yml,.json"
      class="hidden-input"
      onchange={(event) => void handleProjectFileChange(event)}
    />
    <input
      bind:this={voicebankInput}
      type="file"
      accept=".zip"
      class="hidden-input"
      onchange={(event) => void handleVoicebankFileChange(event)}
    />
  </div>
</header>
