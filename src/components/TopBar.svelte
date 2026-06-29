<script lang="ts">
  import {
    Download,
    FilePlus,
    FolderOpen,
    Info,
    Pause,
    Play,
    Redo2,
    Save,
    Share2,
    SkipBack,
    Square,
    Undo2,
    Upload,
  } from '@lucide/svelte'
  import type { SongProject } from '../types'
  import { formatTime, inputValue } from '../app/ui'

  type Props = {
    project: SongProject
    projectSourceLabel: string
    playbackTime: number
    displayDuration: number
    isRendering: boolean
    isPlaying: boolean
    isLoadingVoicebank: boolean
    canUndo: boolean
    canRedo: boolean
    onNewProject: () => void
    onProjectFile: (file: File) => Promise<void>
    onVoicebankFile: (file: File) => Promise<void>
    onSaveProject: () => void
    onUndo: () => void
    onRedo: () => void
    onOpenLicenses: () => void
    onStop: () => void
    onPlayPause: () => Promise<void>
    onShare: () => Promise<void>
    onDownloadWav: () => Promise<void>
    onProjectName: (name: string) => void
  }

  let {
    project,
    projectSourceLabel,
    playbackTime,
    displayDuration,
    isRendering,
    isPlaying,
    isLoadingVoicebank,
    canUndo,
    canRedo,
    onNewProject,
    onProjectFile,
    onVoicebankFile,
    onSaveProject,
    onUndo,
    onRedo,
    onOpenLicenses,
    onStop,
    onPlayPause,
    onShare,
    onDownloadWav,
    onProjectName,
  }: Props = $props()

  let projectInput: HTMLInputElement
  let voicebankInput: HTMLInputElement

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
    <button type="button" class="toolbar-button" title="새 프로젝트" onclick={onNewProject}>
      <FilePlus size={20} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button" title="USTX 열기" onclick={() => projectInput?.click()}>
      <FolderOpen size={20} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button" title="USTX 저장" onclick={onSaveProject}>
      <Save size={20} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button" title="되돌리기" onclick={onUndo} disabled={!canUndo}>
      <Undo2 size={19} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button" title="다시 실행" onclick={onRedo} disabled={!canRedo}>
      <Redo2 size={19} aria-hidden="true" />
    </button>
    <button type="button" class="toolbar-button" title="라이선스" onclick={onOpenLicenses}>
      <Info size={19} aria-hidden="true" />
    </button>
    <div class="project-context" aria-label="Current project">
      <span>현재 프로젝트</span>
      <strong>{project.name}</strong>
      <em>{projectSourceLabel}</em>
    </div>
  </div>

  <div class="transport-center" aria-label="Playback controls">
    <button type="button" class="transport-button" title="처음으로" onclick={onStop}>
      <SkipBack size={20} aria-hidden="true" />
    </button>
    <button type="button" class="play-button" onclick={() => void onPlayPause()} disabled={isRendering}>
      {#if isPlaying}
        <Pause size={24} aria-hidden="true" />
      {:else}
        <Play size={24} aria-hidden="true" />
      {/if}
    </button>
    <button type="button" class="transport-button" title="정지" onclick={onStop}>
      <Square size={17} aria-hidden="true" />
    </button>
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
      class="toolbar-button"
      title="보컬 ZIP 가져오기"
      onclick={() => voicebankInput?.click()}
      disabled={isLoadingVoicebank}
    >
      <Upload size={20} aria-hidden="true" />
    </button>
    <button type="button" class="export-button" onclick={() => void onShare()} disabled={isRendering}>
      <Share2 size={19} aria-hidden="true" />
      <span>공유</span>
    </button>
    <button type="button" class="toolbar-button" title="WAV 다운로드" onclick={() => void onDownloadWav()} disabled={isRendering}>
      <Download size={19} aria-hidden="true" />
    </button>
  </div>

  <div class="hidden-top-inputs">
    <input
      bind:this={projectInput}
      type="file"
      accept=".ustx,.yaml,.yml,.json"
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
