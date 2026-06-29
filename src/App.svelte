<script lang="ts">
  import { onMount } from 'svelte'
  import './App.css'
  import AboutDialog from './components/AboutDialog.svelte'
  import EditorArea from './components/EditorArea.svelte'
  import LeftRail from './components/LeftRail.svelte'
  import ModeStrip from './components/ModeStrip.svelte'
  import TopBar from './components/TopBar.svelte'
  import { encodeWav, inspectWavBlob, isDawReadyWav } from './audio/wav'
  import { createDemoProject } from './demoProject'
  import { pitchRange, projectDurationTicks, sanitizeFileName } from './music'
  import {
    addNoteAfter,
    addNoteFromGrid,
    applyLyricLineToProject,
    GRID_SNAP_TICKS,
    updateNoteInProject,
  } from './projectEditing'
  import {
    commitPresentFromSnapshot,
    commitProjectChange,
    createProjectHistory,
    redoProjectChange,
    replacePresentProject,
    replaceProjectHistory,
    undoProjectChange,
  } from './projectHistory'
  import { loadSavedProject, saveProject } from './projectStorage'
  import { renderers } from './renderers/registry'
  import { createUtauSampleRenderer } from './renderers/utauSampleRenderer'
  import { parseUstx, serializeUstx } from './ustx'
  import { TICKS_PER_BEAT, type RenderedAudio, type SongNote, type SongProject } from './types'
  import {
    analyzeVoicebankCoverage,
    findEntryMatchForLyric,
    loadVoicebankZip,
    type LoadedVoicebank,
  } from './voicebank'
  import { loadSavedVoicebankFile, saveVoicebankFile } from './voicebankStorage'
  import {
    formatLyricLine,
    isButtonLikeTarget,
    isTextEditingTarget,
    NOTE_RESIZE_HANDLE_WIDTH,
    pitchRows,
    reconcileSelectedNoteId,
    ROW_HEIGHT,
    TICK_WIDTH,
    type VoicebankCacheStatus,
  } from './app/ui'

  type NotePointerState = {
    noteId: string
    pointerId: number
    mode: 'move' | 'resize'
    originProject: SongProject
    originClientX: number
    originClientY: number
    originStart: number
    originTone: number
    originDuration: number
    moved: boolean
  }

  const restoredProject = loadSavedProject()
  const initialProject = restoredProject ?? createDemoProject()

  let projectHistory = $state(createProjectHistory(initialProject))
  let projectSourceLabel = $state(restoredProject ? 'Saved browser draft' : 'Built-in Hangul demo')
  let selectedNoteId = $state(initialProject.notes[0]?.id ?? '')
  let rendered = $state<RenderedAudio | null>(null)
  let voicebankName = $state('Korean Demo Voice')
  let voicebank = $state<LoadedVoicebank | null>(null)
  let isRendering = $state(false)
  let isLoadingVoicebank = $state(false)
  let isPlaying = $state(false)
  let playbackTime = $state(0)
  let notice = $state('Ready')
  let paintLyric = $state('도')
  let lyricLine = $state(formatLyricLine(initialProject.notes))
  let isAboutOpen = $state(false)
  let voicebankCacheStatus = $state<VoicebankCacheStatus>('idle')
  let hasMounted = false
  let audioRef = $state<HTMLAudioElement | null>(null)
  let notePointer: NotePointerState | null = null

  const project = $derived(projectHistory.present)
  const canUndo = $derived(projectHistory.past.length > 0)
  const canRedo = $derived(projectHistory.future.length > 0)
  const selectedNote = $derived(project.notes.find((note) => note.id === selectedNoteId) ?? project.notes[0])
  const voicebankCoverage = $derived(voicebank ? analyzeVoicebankCoverage(voicebank, project.notes) : null)
  const selectedLyricMatch = $derived(voicebank && selectedNote ? findEntryMatchForLyric(voicebank, selectedNote.lyric) : null)
  const range = $derived(pitchRange(project.notes))
  const rows = $derived(pitchRows(range.min, range.max))
  const songTicks = $derived(Math.max(projectDurationTicks(project), TICKS_PER_BEAT * 8))
  const gridWidth = $derived(Math.max(820, songTicks * TICK_WIDTH))
  const gridHeight = $derived(rows.length * ROW_HEIGHT)
  const displayDuration = $derived(rendered?.durationSeconds ?? 0)
  const beatCount = $derived(Math.ceil(songTicks / TICKS_PER_BEAT))
  const barCount = $derived(Math.ceil(beatCount / project.beatPerBar))
  const playheadLeft = $derived(displayDuration > 0 ? Math.min(gridWidth, (playbackTime / displayDuration) * gridWidth) : 0)

  $effect(() => {
    lyricLine = formatLyricLine(project.notes)
    if (hasMounted) {
      saveProject(project)
    }
  })

  onMount(() => {
    hasMounted = true
    saveProject(project)
    void restoreVoicebank()

    function handleWindowKeyDown(event: KeyboardEvent) {
      if (isTextEditingTarget(event.target)) {
        return
      }
      if (event.key === 'Escape' && isAboutOpen) {
        event.preventDefault()
        isAboutOpen = false
        return
      }
      const key = event.key.toLowerCase()
      const commandPressed = event.metaKey || event.ctrlKey
      if (commandPressed && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redoProject()
        } else {
          undoProject()
        }
        return
      }
      if (commandPressed && key === 'y') {
        event.preventDefault()
        redoProject()
        return
      }
      if (event.code === 'Space' && !isButtonLikeTarget(event.target)) {
        event.preventDefault()
        void playOrPause()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  })

  async function restoreVoicebank() {
    const file = await loadSavedVoicebankFile()
    if (!file) {
      voicebankCacheStatus = 'idle'
      return
    }
    isLoadingVoicebank = true
    notice = 'Restoring voicebank zip'
    voicebankCacheStatus = 'restoring'
    try {
      const loaded = await loadVoicebankZip(file)
      voicebank = loaded
      voicebankName = loaded.name
      notice = `${loaded.name}: ${loaded.sampleCount} aliases`
      voicebankCacheStatus = 'restored'
    } catch {
      notice = 'Saved voicebank could not be restored'
      voicebankCacheStatus = 'session-only'
    } finally {
      isLoadingVoicebank = false
    }
  }

  async function handleProjectFile(file: File) {
    const text = await file.text()
    const nextProject = parseUstx(text, file.name)
    projectHistory = replaceProjectHistory(nextProject)
    selectedNoteId = nextProject.notes[0]?.id ?? ''
    projectSourceLabel = file.name
    clearRendered()
    notice = `${file.name} loaded`
  }

  async function handleVoicebankFile(file: File) {
    isLoadingVoicebank = true
    notice = 'Reading voicebank zip'
    try {
      const loaded = await loadVoicebankZip(file)
      voicebank = loaded
      voicebankName = loaded.name
      clearRendered()
      voicebankCacheStatus = 'saving'
      const saved = await saveVoicebankFile(file)
      voicebankCacheStatus = saved ? 'saved' : 'session-only'
      notice = `${loaded.name}: ${loaded.sampleCount} aliases`
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Voicebank import failed'
    } finally {
      isLoadingVoicebank = false
    }
  }

  function newProject() {
    const nextProject = createDemoProject()
    projectHistory = replaceProjectHistory(nextProject)
    selectedNoteId = nextProject.notes[0]?.id ?? ''
    paintLyric = '도'
    projectSourceLabel = 'Built-in Hangul demo'
    clearRendered()
    notice = 'New Hangul demo project'
  }

  function updateProject(patch: Partial<SongProject>) {
    commitProject((current) => ({ ...current, ...patch }))
    projectSourceLabel = projectSourceLabel === 'Built-in Hangul demo' ? projectSourceLabel : 'Saved browser draft'
    clearRendered()
  }

  function updateNote(noteId: string, patch: Partial<SongNote>, options: { history?: 'commit' | 'replace' } = {}) {
    const applyUpdate = (current: SongProject) => updateNoteInProject(current, noteId, patch).project
    if (options.history === 'replace') {
      replaceProject(applyUpdate)
    } else {
      commitProject(applyUpdate)
    }
    selectedNoteId = noteId
    if (typeof patch.lyric === 'string') {
      paintLyric = patch.lyric.trim() || '라'
    }
    clearRendered()
  }

  function updateSelectedNote(patch: Partial<SongNote>) {
    if (selectedNote) {
      updateNote(selectedNote.id, patch)
    }
  }

  function addNote() {
    const { project: nextProject, note } = addNoteAfter(project, selectedNote ?? project.notes.at(-1), paintLyric)
    commitProject(nextProject)
    selectedNoteId = note.id
    clearRendered()
  }

  function addNoteAtGridPoint(x: number, y: number) {
    const { project: nextProject, note } = addNoteFromGrid(project, {
      x,
      y,
      tickWidth: TICK_WIDTH,
      rowHeight: ROW_HEIGHT,
      maxTone: range.max,
      minTone: range.min,
      lyric: paintLyric,
    })
    commitProject(nextProject)
    selectedNoteId = note.id
    clearRendered()
    notice = `${note.lyric} note added`
  }

  function applyLyricLine() {
    const result = applyLyricLineToProject(project, lyricLine)
    if (result.appliedCount === 0) {
      notice = 'No lyrics applied'
      return
    }
    commitProject(result.project)
    paintLyric = result.tokens[0] ?? paintLyric
    notice = `${result.appliedCount} lyrics applied`
    clearRendered()
  }

  function selectNote(note: SongNote) {
    selectedNoteId = note.id
    paintLyric = note.lyric
  }

  function chooseLyric(lyric: string) {
    paintLyric = lyric
    if (selectedNote) {
      updateSelectedNote({ lyric })
    }
  }

  function deleteSelectedNote() {
    if (!selectedNote || project.notes.length <= 1) {
      return
    }
    const nextNotes = project.notes.filter((note) => note.id !== selectedNote.id)
    commitProject((current) => ({ ...current, notes: nextNotes }))
    selectedNoteId = nextNotes[0]?.id ?? ''
    clearRendered()
  }

  function handleGridClick(event: MouseEvent) {
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('button')) {
      return
    }
    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
    addNoteAtGridPoint(event.clientX - rect.left, event.clientY - rect.top)
  }

  function startNotePointer(event: PointerEvent, note: SongNote) {
    const target = event.currentTarget as HTMLButtonElement
    const bounds = target.getBoundingClientRect()
    notePointer = {
      noteId: note.id,
      pointerId: event.pointerId,
      mode: bounds.right - event.clientX <= NOTE_RESIZE_HANDLE_WIDTH ? 'resize' : 'move',
      originProject: project,
      originClientX: event.clientX,
      originClientY: event.clientY,
      originStart: note.start,
      originTone: note.tone,
      originDuration: note.duration,
      moved: false,
    }
    selectNote(note)
    target.setPointerCapture?.(event.pointerId)
  }

  function moveNotePointer(event: PointerEvent) {
    const drag = notePointer
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const deltaX = event.clientX - drag.originClientX
    const deltaY = event.clientY - drag.originClientY
    const tickDelta = snapDragTicks(deltaX)
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      drag.moved = true
    }
    if (drag.mode === 'resize') {
      updateNote(drag.noteId, { duration: drag.originDuration + tickDelta }, { history: 'replace' })
      event.preventDefault()
      return
    }
    updateNote(
      drag.noteId,
      {
        start: drag.originStart + tickDelta,
        tone: drag.originTone - Math.round(deltaY / ROW_HEIGHT),
      },
      { history: 'replace' },
    )
    event.preventDefault()
  }

  function endNotePointer(event: PointerEvent) {
    const drag = notePointer
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    notePointer = null
    ;(event.currentTarget as HTMLButtonElement).releasePointerCapture?.(event.pointerId)
    if (drag.moved) {
      projectHistory = commitPresentFromSnapshot(projectHistory, drag.originProject)
      notice = drag.mode === 'resize' ? 'Note length edited' : 'Note moved'
    }
  }

  function handleNoteKeyDown(event: KeyboardEvent, note: SongNote) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      updateNote(note.id, { start: note.start - GRID_SNAP_TICKS })
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      updateNote(note.id, { start: note.start + GRID_SNAP_TICKS })
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      updateNote(note.id, { tone: note.tone + 1 })
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      updateNote(note.id, { tone: note.tone - 1 })
    }
  }

  function commitProject(update: SongProject | ((current: SongProject) => SongProject)) {
    projectHistory = commitProjectChange(projectHistory, update)
  }

  function replaceProject(update: SongProject | ((current: SongProject) => SongProject)) {
    projectHistory = replacePresentProject(projectHistory, update)
  }

  function undoProject() {
    if (!canUndo) {
      return
    }
    const nextHistory = undoProjectChange(projectHistory)
    projectHistory = nextHistory
    selectedNoteId = reconcileSelectedNoteId(nextHistory.present, selectedNoteId)
    notice = 'Undo'
    clearRendered()
  }

  function redoProject() {
    if (!canRedo) {
      return
    }
    const nextHistory = redoProjectChange(projectHistory)
    projectHistory = nextHistory
    selectedNoteId = reconcileSelectedNoteId(nextHistory.present, selectedNoteId)
    notice = 'Redo'
    clearRendered()
  }

  async function renderProject() {
    isRendering = true
    notice = 'Rendering WAV'
    try {
      const renderer = voicebank ? createUtauSampleRenderer(voicebank, getAudioContext()) : renderers.browserDemo
      const result = await renderer.render(project)
      const blob = encodeWav(result.samples, result.sampleRate)
      const wavInfo = await inspectWavBlob(blob)
      const url = URL.createObjectURL(blob)
      if (rendered?.url) {
        URL.revokeObjectURL(rendered.url)
      }
      const audio: RenderedAudio = {
        blob,
        url,
        durationSeconds: result.durationSeconds,
        fileName: `${sanitizeFileName(project.name)}.wav`,
        wavInfo,
      }
      rendered = audio
      notice = isDawReadyWav(wavInfo) ? 'Vocal WAV ready' : 'WAV rendered'
      return audio
    } catch (error) {
      notice = `Render failed: ${formatErrorMessage(error)}`
      return null
    } finally {
      isRendering = false
    }
  }

  async function playOrPause() {
    if (isPlaying && audioRef) {
      audioRef.pause()
      isPlaying = false
      return
    }
    const current = rendered ?? (await renderProject())
    if (!audioRef || !current) {
      return
    }
    audioRef.src = current.url
    audioRef.currentTime = 0
    playbackTime = 0
    try {
      await audioRef.play()
      isPlaying = true
    } catch (error) {
      notice = `Playback failed: ${formatErrorMessage(error)}`
      isPlaying = false
    }
  }

  function stopPlayback() {
    if (audioRef) {
      audioRef.pause()
      audioRef.currentTime = 0
    }
    playbackTime = 0
    isPlaying = false
  }

  async function getRenderedWav() {
    return rendered ?? (await renderProject())
  }

  async function shareWav() {
    const current = await getRenderedWav()
    if (!current) {
      return
    }
    const file = new File([current.blob], current.fileName, { type: 'audio/wav' })
    const shareNavigator = getShareNavigator()
    let shareFailed = false
    if (canShareFile(file, shareNavigator)) {
      try {
        await shareNavigator.share({ files: [file], title: project.name })
        notice = 'WAV shared'
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          notice = 'Share cancelled'
          return
        }
        shareFailed = true
      }
    }
    downloadBlob(current.blob, current.fileName)
    notice = shareFailed ? 'Share failed; WAV downloaded' : 'Share unavailable; WAV downloaded'
  }

  async function downloadWav() {
    const current = await getRenderedWav()
    if (!current) {
      return
    }
    downloadBlob(current.blob, current.fileName)
    notice = 'WAV downloaded'
  }

  function downloadUstx() {
    const blob = new Blob([serializeUstx(project)], { type: 'text/yaml;charset=utf-8' })
    downloadBlob(blob, `${sanitizeFileName(project.name)}.ustx`)
    notice = 'USTX saved'
  }

  function clearRendered() {
    if (rendered?.url) {
      URL.revokeObjectURL(rendered.url)
    }
    rendered = null
  }

  function snapDragTicks(deltaX: number) {
    const rawTicks = deltaX / TICK_WIDTH
    return Math.round(rawTicks / GRID_SNAP_TICKS) * GRID_SNAP_TICKS
  }

  function getAudioContext() {
    const globalWindow = window as typeof window & {
      webkitAudioContext?: typeof AudioContext
    }
    const AudioContextConstructor = window.AudioContext ?? globalWindow.webkitAudioContext
    if (!AudioContextConstructor) {
      throw new Error('This browser does not support Web Audio decoding.')
    }
    if (!audioContextSingleton) {
      audioContextSingleton = new AudioContextConstructor()
    }
    return audioContextSingleton
  }

  let audioContextSingleton: AudioContext | null = null

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function getShareNavigator() {
    return navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean
      share?: (data: { files: File[]; title: string }) => Promise<void>
    }
  }

  function canShareFile(file: File, shareNavigator = getShareNavigator()) {
    return (
      typeof shareNavigator.share === 'function' &&
      (typeof shareNavigator.canShare !== 'function' || shareNavigator.canShare({ files: [file] }))
    )
  }

  function formatErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
      return error.message
    }
    return 'Unknown error'
  }
</script>

<main class="app-shell">
  <TopBar
    {project}
    {projectSourceLabel}
    {playbackTime}
    {displayDuration}
    {isRendering}
    {isPlaying}
    {isLoadingVoicebank}
    {canUndo}
    {canRedo}
    onNewProject={newProject}
    onProjectFile={handleProjectFile}
    onVoicebankFile={handleVoicebankFile}
    onSaveProject={downloadUstx}
    onUndo={undoProject}
    onRedo={redoProject}
    onOpenLicenses={() => (isAboutOpen = true)}
    onStop={stopPlayback}
    onPlayPause={playOrPause}
    onShare={shareWav}
    onDownloadWav={downloadWav}
    onProjectName={(name) => updateProject({ name })}
  />

  <ModeStrip {voicebankName} {voicebank} {voicebankCoverage} {notice} />

  <section class="workspace">
    <LeftRail
      {project}
      {selectedNote}
      {selectedLyricMatch}
      {voicebank}
      {voicebankName}
      {voicebankCoverage}
      {voicebankCacheStatus}
      {isLoadingVoicebank}
      {notice}
      onVoicebankFile={handleVoicebankFile}
      onBpm={(bpm) => updateProject({ bpm })}
      onBeat={(beatPerBar, beatUnit) => updateProject({ beatPerBar, beatUnit })}
      onSelectDemoVoice={() => (notice = 'Korean Demo Voice selected')}
      onLyric={(lyric) => {
        paintLyric = lyric
        updateSelectedNote({ lyric })
      }}
      onTone={(tone) => updateSelectedNote({ tone })}
      onNudge={updateSelectedNote}
      onDuration={(duration) => updateSelectedNote({ duration })}
      onAddNote={addNote}
      onDeleteNote={deleteSelectedNote}
    />

    <EditorArea
      {project}
      {projectSourceLabel}
      {selectedNote}
      {rows}
      rangeMax={range.max}
      {songTicks}
      {gridWidth}
      {gridHeight}
      {beatCount}
      {barCount}
      {playheadLeft}
      {paintLyric}
      {lyricLine}
      {voicebank}
      {voicebankName}
      {voicebankCoverage}
      {voicebankCacheStatus}
      {rendered}
      {notice}
      {isRendering}
      {playbackTime}
      {displayDuration}
      onSaveProject={downloadUstx}
      onSelectNote={selectNote}
      onChooseLyric={chooseLyric}
      onLyricLine={(line) => (lyricLine = line)}
      onApplyLyricLine={applyLyricLine}
      onGridClick={handleGridClick}
      onNoteKeyDown={handleNoteKeyDown}
      onNotePointerDown={startNotePointer}
      onNotePointerMove={moveNotePointer}
      onNotePointerEnd={endNotePointer}
      onShare={shareWav}
      onDownloadWav={downloadWav}
    />
  </section>

  <audio
    class="hidden-audio"
    bind:this={audioRef}
    src={rendered?.url}
    ontimeupdate={(event) => (playbackTime = (event.currentTarget as HTMLAudioElement).currentTime)}
    onended={() => {
      isPlaying = false
      playbackTime = 0
    }}
    onpause={() => (isPlaying = false)}
    onplay={() => (isPlaying = true)}
  ></audio>

  {#if isAboutOpen}
    <AboutDialog onClose={() => (isAboutOpen = false)} />
  {/if}
</main>
