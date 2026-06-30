<script lang="ts">
  import { onMount } from 'svelte'
  import './App.css'
  import AboutDialog from './components/AboutDialog.svelte'
  import ComposerPanel from './components/ComposerPanel.svelte'
  import EditorArea from './components/EditorArea.svelte'
  import LeftRail from './components/LeftRail.svelte'
  import ModeStrip from './components/ModeStrip.svelte'
  import StarterGuide from './components/StarterGuide.svelte'
  import TopBar from './components/TopBar.svelte'
  import { encodeWav, inspectWavBlob, isDawReadyWav } from './audio/wav'
  import { BUNDLED_UTAU_VOICEBANK_NAME, loadBundledUtauVoicebankFile } from './bundledVoicebank'
  import { applyMelodySuggestion, composeFromLyrics, formatChordLine, type ComposerMood } from './composer'
  import { createDemoProject, createStarterProject, duplicateProject as createProjectDuplicate } from './demoProject'
  import { midiToHz, pitchRange, projectDurationTicks, sanitizeFileName, secondsToTicksInProject, ticksToSecondsInProject, toneName } from './music'
  import {
    addNoteAfter,
    addNoteAtTick,
    addNoteFromGrid,
    applyLyricLineToProject,
    deleteNoteFromProject,
    duplicateNoteInProject,
    GRID_SNAP_TICKS,
    quantizeProjectNotes,
    snapTickToGrid,
    splitNoteInProject,
    tokenizeLyricLine,
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
  import { isWebutaProjectFileName, parseWebutaProject, serializeWebutaProject } from './projectFile'
  import { loadSavedProject, saveProject } from './projectStorage'
  import { mergeLocalNeuralModelCard } from './neuralModels'
  import { fetchLocalNeuralModelCard } from './renderers/localNeuralRenderer'
  import { localNeuralEndpoint, neuralModelCards as initialNeuralModelCards, renderers, rendererCapabilities } from './renderers/registry'
  import { createUtauSampleRenderer } from './renderers/utauSampleRenderer'
  import { parseUst, serializeUst } from './ust'
  import { parseUstx, serializeUstx } from './ustx'
  import {
    TICKS_PER_BEAT,
    type RenderedAudio,
    type RenderHistoryEntry,
    type RenderProgress,
    type RendererId,
    type NeuralModelCard,
    type SongNote,
    type SongProject,
    type WorkspaceMode,
  } from './types'
  import {
    analyzeVoicebankCoverage,
    analyzeVoicebankRenderWarnings,
    findEntryMatchForLyric,
    loadVoicebankZip,
    type LoadedVoicebank,
  } from './voicebank'
  import { loadSavedVoicebankFile, saveVoicebankFile } from './voicebankStorage'
  import {
    formatLyricLine,
    formatWavSummary,
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
  let voicebankName = $state(BUNDLED_UTAU_VOICEBANK_NAME)
  let voicebank = $state<LoadedVoicebank | null>(null)
  let isRendering = $state(false)
  let isLoadingVoicebank = $state(false)
  let isPlaying = $state(false)
  let playbackTime = $state(0)
  let notice = $state('Ready')
  let paintLyric = $state('도')
  let lyricLine = $state(formatLyricLine(initialProject.notes))
  let isLyricLinePinned = $state(false)
  let activeMode = $state<WorkspaceMode>('pattern')
  let composerLyrics = $state(formatLyricLine(initialProject.notes).replaceAll(' ', ''))
  let composerMood = $state<ComposerMood>('bright')
  let isAboutOpen = $state(false)
  let voicebankCacheStatus = $state<VoicebankCacheStatus>('idle')
  let performanceKeys = $state<SongNote[]>(initialProject.notes.slice(0, 8))
  let selectedRendererId = $state<RendererId>('utau-sample')
  let neuralModels = $state<NeuralModelCard[]>(initialNeuralModelCards)
  let selectedNeuralModelId = $state(initialNeuralModelCards.find((model) => model.status === 'ready')?.id ?? '')
  let renderHistory = $state<RenderHistoryEntry[]>([])
  let renderProgress = $state<RenderProgress>({
    phase: 'idle',
    label: 'Ready to render',
    percent: 0,
    cancellable: false,
  })
  let hasMounted = false
  let audioRef = $state<HTMLAudioElement | null>(null)
  let notePointer: NotePointerState | null = null
  let voicebankLoadToken = 0
  let previewOscillator: OscillatorNode | null = null
  let previewGain: GainNode | null = null
  let voicebankPreviewSource: AudioBufferSourceNode | null = null
  let voicebankPreviewGain: GainNode | null = null
  let isPreviewingVoicebankSample = $state(false)
  let isRecording = $state(false)
  let isMetronomeOn = $state(false)
  let isQuantizeOn = $state(true)
  let isLoopOn = $state(false)
  let loopStartTick = $state(0)
  let loopEndTick = $state(TICKS_PER_BEAT * 4)
  let lyricCursor = $state(0)
  let recordingStartedAtMs = 0
  let recordingOriginProject: SongProject | null = null
  let recordingLyricTokens = $state<string[]>([])
  let metronomeTimer: ReturnType<typeof window.setInterval> | null = null
  let metronomeBeat = 0
  let renderAbortController: AbortController | null = null

  const project = $derived(projectHistory.present)
  const canUndo = $derived(projectHistory.past.length > 0)
  const canRedo = $derived(projectHistory.future.length > 0)
  const selectedNote = $derived(project.notes.find((note) => note.id === selectedNoteId) ?? project.notes[0])
  const voicebankCoverage = $derived(voicebank ? analyzeVoicebankCoverage(voicebank, project.notes) : null)
  const voicebankWarnings = $derived(voicebank ? analyzeVoicebankRenderWarnings(voicebank, project.notes) : null)
  const selectedLyricMatch = $derived(voicebank && selectedNote ? findEntryMatchForLyric(voicebank, selectedNote.lyric) : null)
  const range = $derived(pitchRange(project.notes))
  const rows = $derived(pitchRows(range.min, range.max))
  const songTicks = $derived(Math.max(projectDurationTicks(project), TICKS_PER_BEAT * 8))
  const loopRange = $derived(normalizeLoopRange(loopStartTick, loopEndTick, songTicks))
  const loopStartSeconds = $derived(ticksToSecondsInProject(loopRange.start, project))
  const loopEndSeconds = $derived(ticksToSecondsInProject(loopRange.end, project))
  const gridWidth = $derived(Math.max(820, songTicks * TICK_WIDTH))
  const gridHeight = $derived(rows.length * ROW_HEIGHT)
  const displayDuration = $derived(rendered?.durationSeconds ?? 0)
  const beatCount = $derived(Math.ceil(songTicks / TICKS_PER_BEAT))
  const barCount = $derived(Math.ceil(beatCount / project.beatPerBar))
  const playheadLeft = $derived(displayDuration > 0 ? Math.min(gridWidth, (playbackTime / displayDuration) * gridWidth) : 0)
  const composerSuggestion = $derived(composeFromLyrics(composerLyrics, composerMood))
  const liveLyricTokens = $derived(tokenizeLyricLine(lyricLine))
  const activeLyricTokens = $derived(recordingLyricTokens.length > 0 ? recordingLyricTokens : liveLyricTokens)
  const nextPerformanceLyric = $derived(activeLyricTokens[lyricCursor % activeLyricTokens.length] ?? paintLyric)

  $effect(() => {
    if (!isLyricLinePinned) {
      lyricLine = formatLyricLine(project.notes)
    }
    if (hasMounted) {
      saveProject(project)
    }
  })

  onMount(() => {
    hasMounted = true
    saveProject(project)
    void restoreVoicebank()
    void refreshLocalNeuralModel()

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
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelectedNote()
        return
      }
      if (event.code === 'Space' && !isButtonLikeTarget(event.target)) {
        event.preventDefault()
        void playOrPause()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
      stopMetronomeTimer()
      stopPreviewTone()
      stopVoicebankSamplePreview()
    }
  })

  async function restoreVoicebank() {
    const file = await loadSavedVoicebankFile()
    if (!file) {
      await restoreBundledVoicebank()
      return
    }
    const loadToken = ++voicebankLoadToken
    isLoadingVoicebank = true
    notice = 'Restoring voicebank zip'
    voicebankCacheStatus = 'restoring'
    try {
      const loaded = await loadVoicebankZip(file)
      if (loadToken !== voicebankLoadToken) {
        return
      }
      voicebank = loaded
      voicebankName = loaded.name
      notice = `${loaded.name}: ${loaded.sampleCount} aliases`
      voicebankCacheStatus = 'restored'
    } catch {
      if (loadToken !== voicebankLoadToken) {
        return
      }
      notice = 'Saved voicebank could not be restored'
      voicebankCacheStatus = 'session-only'
    } finally {
      if (loadToken === voicebankLoadToken) {
        isLoadingVoicebank = false
      }
    }
  }

  async function refreshLocalNeuralModel() {
    if (!localNeuralEndpoint) {
      return
    }
    try {
      const serviceModel = await fetchLocalNeuralModelCard(localNeuralEndpoint)
      if (!serviceModel) {
        return
      }
      neuralModels = mergeLocalNeuralModelCard(initialNeuralModelCards, serviceModel)
      if (serviceModel.status === 'ready' && !selectedNeuralModelId) {
        selectedNeuralModelId = serviceModel.id
      }
    } catch {
      // The local companion is optional; keep the static model cards when health is unavailable.
    }
  }

  async function restoreBundledVoicebank() {
    const loadToken = ++voicebankLoadToken
    isLoadingVoicebank = true
    notice = 'Loading bundled V3 UTAU voicebank'
    voicebankCacheStatus = 'restoring'
    try {
      const file = await loadBundledUtauVoicebankFile()
      const loaded = await loadVoicebankZip(file)
      if (loadToken !== voicebankLoadToken) {
        return
      }
      voicebank = loaded
      voicebankName = loaded.name
      notice = `${loaded.name}: ${loaded.sampleCount} aliases`
      voicebankCacheStatus = 'bundled'
    } catch {
      if (loadToken !== voicebankLoadToken) {
        return
      }
      voicebank = null
      voicebankName = 'Korean Demo Voice'
      voicebankCacheStatus = 'idle'
      notice = 'Bundled voicebank unavailable; using synth fallback'
    } finally {
      if (loadToken === voicebankLoadToken) {
        isLoadingVoicebank = false
      }
    }
  }

  async function handleProjectFile(file: File) {
    const text = await file.text()
    try {
      const nextProject = parseProjectFile(text, file.name)
      projectHistory = replaceProjectHistory(nextProject)
      selectedNoteId = nextProject.notes[0]?.id ?? ''
      performanceKeys = nextProject.notes.slice(0, 8)
      isLyricLinePinned = false
      projectSourceLabel = file.name
      resetLoopRange(nextProject)
      clearRendered()
      notice = `${file.name} loaded`
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Project import failed'
    }
  }

  async function handleVoicebankFile(file: File) {
    const loadToken = ++voicebankLoadToken
    isLoadingVoicebank = true
    notice = 'Reading voicebank zip'
    try {
      const loaded = await loadVoicebankZip(file)
      if (loadToken !== voicebankLoadToken) {
        return
      }
      voicebank = loaded
      voicebankName = loaded.name
      clearRendered()
      voicebankCacheStatus = 'saving'
      const saved = await saveVoicebankFile(file)
      if (loadToken !== voicebankLoadToken) {
        return
      }
      voicebankCacheStatus = saved ? 'saved' : 'session-only'
      notice = `${loaded.name}: ${loaded.sampleCount} aliases`
    } catch (error) {
      if (loadToken !== voicebankLoadToken) {
        return
      }
      notice = error instanceof Error ? error.message : 'Voicebank import failed'
    } finally {
      if (loadToken === voicebankLoadToken) {
        isLoadingVoicebank = false
      }
    }
  }

  function newProject() {
    const nextProject = createStarterProject()
    projectHistory = replaceProjectHistory(nextProject)
    selectedNoteId = nextProject.notes[0]?.id ?? ''
    performanceKeys = nextProject.notes.slice(0, 8)
    isLyricLinePinned = false
    paintLyric = '라'
    projectSourceLabel = 'New vocal sketch'
    resetLoopRange(nextProject)
    clearRendered()
    notice = 'New vocal sketch'
  }

  function resetDemoProject() {
    const nextProject = createDemoProject()
    projectHistory = replaceProjectHistory(nextProject)
    selectedNoteId = nextProject.notes[0]?.id ?? ''
    performanceKeys = nextProject.notes.slice(0, 8)
    isLyricLinePinned = false
    paintLyric = '도'
    projectSourceLabel = 'Built-in Hangul demo'
    resetLoopRange(nextProject)
    clearRendered()
    notice = 'Demo project restored'
  }

  function duplicateCurrentProject() {
    const nextProject = createProjectDuplicate(project)
    projectHistory = replaceProjectHistory(nextProject)
    selectedNoteId = nextProject.notes[0]?.id ?? ''
    performanceKeys = nextProject.notes.slice(0, 8)
    isLyricLinePinned = false
    paintLyric = nextProject.notes[0]?.lyric ?? '라'
    projectSourceLabel = 'Duplicated from current project'
    resetLoopRange(nextProject)
    clearRendered()
    notice = 'Project duplicated'
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
    isLyricLinePinned = false
    commitProject(result.project)
    paintLyric = result.tokens[0] ?? paintLyric
    lyricCursor = 0
    recordingLyricTokens = []
    notice = `${result.appliedCount} lyrics applied`
    clearRendered()
  }

  function announceComposition() {
    notice = `${composerSuggestion.notes.length} note melody · ${formatChordLine(composerSuggestion.chords.slice(0, 4))}`
  }

  function applyComposition() {
    const nextProject = applyMelodySuggestion(project, composerSuggestion)
    commitProject(nextProject)
    selectedNoteId = nextProject.notes[0]?.id ?? ''
    performanceKeys = nextProject.notes.slice(0, 12)
    paintLyric = nextProject.notes[0]?.lyric ?? paintLyric
    isLyricLinePinned = false
    lyricLine = formatLyricLine(nextProject.notes)
    projectSourceLabel = `Composer · ${formatChordLine(composerSuggestion.chords.slice(0, 4))}`
    activeMode = 'pattern'
    resetLoopRange(nextProject)
    clearRendered()
    notice = `${composerSuggestion.notes.length} generated notes applied`
  }

  function selectNote(note: SongNote) {
    selectedNoteId = note.id
    paintLyric = note.lyric
  }

  function previewNote(note: SongNote) {
    const lyric = nextLyricForPerformance(note.lyric)
    selectNote(note)
    paintLyric = lyric
    playPreviewTone({ ...note, lyric })
    lyricCursor += 1
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(8)
    }
  }

  function performNote(note: SongNote) {
    if (isRecording) {
      recordPerformanceNote(note)
      return
    }
    previewNote(note)
  }

  function chooseLyric(lyric: string) {
    paintLyric = lyric
    if (selectedNote) {
      updateSelectedNote({ lyric })
    }
  }

  function deleteSelectedNote() {
    if (!selectedNote) {
      return
    }
    deleteNoteById(selectedNote.id)
  }

  function deleteNoteById(noteId: string) {
    const result = deleteNoteFromProject(project, noteId)
    if (!result.deletedNote) {
      notice = 'Keep at least one note'
      return
    }
    commitProject(result.project)
    selectedNoteId = result.nextSelectedNoteId
    clearRendered()
    notice = `${result.deletedNote.lyric} note deleted`
  }

  function splitSelectedNote() {
    if (!selectedNote) {
      return
    }
    splitNoteById(selectedNote.id)
  }

  function splitNoteById(noteId: string) {
    const result = splitNoteInProject(project, noteId)
    if (!result.rightNote) {
      notice = 'Note is too short to split'
      return
    }
    commitProject(result.project)
    selectedNoteId = result.rightNote.id
    clearRendered()
    notice = `${result.leftNote?.lyric ?? 'Selected'} note split`
  }

  function duplicateSelectedNote() {
    if (!selectedNote) {
      return
    }
    duplicateNoteById(selectedNote.id)
  }

  function duplicateNoteById(noteId: string) {
    const result = duplicateNoteInProject(project, noteId)
    if (!result.duplicatedNote) {
      notice = 'No note selected to duplicate'
      return
    }
    commitProject(result.project)
    selectedNoteId = result.duplicatedNote.id
    clearRendered()
    notice = `${result.duplicatedNote.lyric} note duplicated`
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
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteNoteById(note.id)
    }
    if (event.key.toLowerCase() === 's') {
      event.preventDefault()
      splitNoteById(note.id)
    }
    if (event.key.toLowerCase() === 'd') {
      event.preventDefault()
      duplicateNoteById(note.id)
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

  function toggleRecording() {
    if (isRecording) {
      stopRecording()
      return
    }
    startRecording()
  }

  function startRecording() {
    recordingOriginProject = project
    recordingStartedAtMs = performance.now()
    recordingLyricTokens = liveLyricTokens.length > 0 ? liveLyricTokens : [paintLyric]
    lyricCursor = 0
    isRecording = true
    clearRendered()
    if (isMetronomeOn) {
      startMetronomeTimer()
    }
    notice = `REC armed · next ${nextPerformanceLyric}`
  }

  function stopRecording() {
    isRecording = false
    if (recordingOriginProject) {
      projectHistory = commitPresentFromSnapshot(projectHistory, recordingOriginProject)
    }
    recordingOriginProject = null
    recordingLyricTokens = []
    notice = 'Recording committed'
  }

  function recordPerformanceNote(templateNote: SongNote) {
    const lyric = nextLyricForPerformance(templateNote.lyric)
    const rawTick = secondsToTicksInProject((performance.now() - recordingStartedAtMs) / 1000, project)
    const start = isQuantizeOn ? snapTickToGrid(rawTick, GRID_SNAP_TICKS) : Math.max(0, Math.round(rawTick))
    const duration = isQuantizeOn ? GRID_SNAP_TICKS * 2 : Math.round(TICKS_PER_BEAT / 2)
    const result = addNoteAtTick(project, {
      start,
      duration,
      tone: templateNote.tone,
      lyric,
      gridTicks: isQuantizeOn ? GRID_SNAP_TICKS : undefined,
    })
    replaceProject(result.project)
    selectedNoteId = result.note.id
    paintLyric = lyric
    lyricCursor += 1
    clearRendered()
    playPreviewTone(result.note)
    notice = `REC ${result.note.lyric} · ${toneName(result.note.tone)}`
  }

  function nextLyricForPerformance(fallback: string) {
    const tokens = activeLyricTokens.length > 0 ? activeLyricTokens : [fallback]
    return tokens[lyricCursor % tokens.length] ?? fallback
  }

  function toggleMetronome() {
    isMetronomeOn = !isMetronomeOn
    if (isMetronomeOn) {
      startMetronomeTimer()
      notice = 'Metronome on'
    } else {
      stopMetronomeTimer()
      notice = 'Metronome off'
    }
  }

  function startMetronomeTimer() {
    stopMetronomeTimer()
    metronomeBeat = 0
    playMetronomeClick(true)
    const intervalMs = Math.max(120, 60000 / project.bpm)
    metronomeTimer = window.setInterval(() => {
      metronomeBeat = (metronomeBeat + 1) % project.beatPerBar
      playMetronomeClick(metronomeBeat === 0)
    }, intervalMs)
  }

  function stopMetronomeTimer() {
    if (!metronomeTimer) {
      return
    }
    window.clearInterval(metronomeTimer)
    metronomeTimer = null
  }

  function playMetronomeClick(accent: boolean) {
    try {
      const audioContext = getAudioContext()
      if (audioContext.state === 'suspended') {
        void audioContext.resume().catch(() => undefined)
      }
      const now = audioContext.currentTime
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.type = 'square'
      oscillator.frequency.setValueAtTime(accent ? 1320 : 880, now)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.1, now + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start(now)
      oscillator.stop(now + 0.07)
      oscillator.onended = () => {
        oscillator.disconnect()
        gain.disconnect()
      }
    } catch {
      notice = 'Metronome unavailable'
    }
  }

  function quantizeCurrentProject() {
    const result = quantizeProjectNotes(project, GRID_SNAP_TICKS)
    if (result.changedCount === 0) {
      notice = 'Already quantized'
      return
    }
    commitProject(result.project)
    selectedNoteId = reconcileSelectedNoteId(result.project, selectedNoteId)
    clearRendered()
    notice = `${result.changedCount} notes quantized`
  }

  function toggleLoop() {
    isLoopOn = !isLoopOn
    notice = isLoopOn ? 'Loop playback on' : 'Loop playback off'
    if (isLoopOn && audioRef && audioRef.currentTime < loopStartSeconds) {
      audioRef.currentTime = loopStartSeconds
      playbackTime = loopStartSeconds
    }
  }

  function setLoopToSelectedNote() {
    if (!selectedNote) {
      notice = 'Select a note to set loop'
      return
    }
    loopStartTick = selectedNote.start
    loopEndTick = selectedNote.start + selectedNote.duration
    isLoopOn = true
    if (audioRef) {
      audioRef.currentTime = ticksToSecondsInProject(selectedNote.start, project)
      playbackTime = audioRef.currentTime
    }
    notice = `Loop set to ${selectedNote.lyric} · ${toneName(selectedNote.tone)}`
  }

  async function renderProject() {
    if (isRendering) {
      return null
    }
    const controller = new AbortController()
    renderAbortController = controller
    isRendering = true
    const rendererName = currentRendererName()
    notice = `Rendering ${rendererName}`
    renderProgress = {
      phase: 'preparing',
      label: 'Preparing score',
      percent: 12,
      cancellable: true,
    }
    try {
      const renderer = resolveSelectedRenderer()
      renderProgress = {
        phase: 'rendering',
        label: `Rendering ${rendererName}`,
        percent: selectedRendererId === 'local-neural' ? 42 : 58,
        cancellable: true,
      }
      const result = await renderer.render(project, { signal: controller.signal })
      throwIfRenderAborted(controller.signal)
      renderProgress = {
        phase: 'encoding',
        label: 'Encoding WAV',
        percent: 84,
        cancellable: true,
      }
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
      const dawReady = isDawReadyWav(wavInfo)
      notice = dawReady ? 'Vocal WAV ready' : 'WAV rendered'
      renderProgress = {
        phase: 'ready',
        label: dawReady ? 'DAW-ready WAV complete' : 'WAV complete',
        percent: 100,
        cancellable: false,
      }
      recordRenderHistory({
        status: 'success',
        rendererName,
        fileName: audio.fileName,
        durationSeconds: audio.durationSeconds,
        detail: dawReady ? 'Ready WAV · 44.1 kHz PCM mono' : formatWavSummary(wavInfo),
      })
      return audio
    } catch (error) {
      if (isAbortError(error)) {
        notice = 'Render cancelled'
        renderProgress = {
          phase: 'cancelled',
          label: 'Render cancelled',
          percent: 0,
          cancellable: false,
        }
        recordRenderHistory({
          status: 'cancelled',
          rendererName,
          fileName: `${sanitizeFileName(project.name)}.wav`,
          durationSeconds: null,
          detail: 'Cancelled before WAV export',
        })
        return null
      }
      const message = formatErrorMessage(error)
      notice = `Render failed: ${message}`
      renderProgress = {
        phase: 'failed',
        label: 'Render failed',
        percent: 0,
        cancellable: false,
      }
      recordRenderHistory({
        status: 'failed',
        rendererName,
        fileName: `${sanitizeFileName(project.name)}.wav`,
        durationSeconds: null,
        detail: message,
      })
      return null
    } finally {
      isRendering = false
      if (renderAbortController === controller) {
        renderAbortController = null
      }
    }
  }

  function cancelRender() {
    if (!renderAbortController || renderAbortController.signal.aborted) {
      return
    }
    renderProgress = {
      phase: 'cancelling',
      label: 'Cancelling render',
      percent: renderProgress.percent,
      cancellable: false,
    }
    notice = 'Cancelling render'
    renderAbortController.abort()
  }

  function resolveSelectedRenderer() {
    if (selectedRendererId === 'local-neural') {
      if (!renderers.localNeural) {
        throw new Error('Local neural renderer is not configured. Set VITE_WEBUTA_NEURAL_ENDPOINT.')
      }
      return renderers.localNeural
    }
    if (selectedRendererId === 'browser-demo') {
      return renderers.browserDemo
    }
    if (voicebank) {
      return createUtauSampleRenderer(voicebank, getAudioContext())
    }
    return renderers.browserDemo
  }

  function selectRenderer(rendererId: RendererId) {
    selectedRendererId = rendererId
    clearRendered()
    if (rendererId === 'local-neural') {
      notice = renderers.localNeural ? 'Local Neural DiffSinger selected' : 'Local neural endpoint not configured'
    } else if (rendererId === 'browser-demo') {
      notice = 'Browser demo voice selected'
    } else {
      notice = voicebank ? `${voicebankName} selected` : 'UTAU voicebank not loaded; using browser demo fallback'
    }
  }

  function selectNeuralModel(modelId: string) {
    const model = neuralModels.find((item) => item.id === modelId)
    if (!model || model.status !== 'ready') {
      notice = 'Neural model is not ready'
      return
    }
    selectedNeuralModelId = model.id
    selectedRendererId = model.rendererId
    clearRendered()
    notice = `${model.name} selected`
  }

  function currentRendererName() {
    if (selectedRendererId === 'utau-sample') {
      return voicebank ? `${voicebankName} UTAU` : 'Browser demo fallback'
    }
    return rendererCapabilities.find((renderer) => renderer.id === selectedRendererId)?.name ?? selectedRendererId
  }

  function recordRenderHistory(entry: Omit<RenderHistoryEntry, 'id' | 'createdAt' | 'projectName' | 'rendererId'>) {
    renderHistory = [
      {
        ...entry,
        id: `${Date.now()}-${renderHistory.length}`,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        projectName: project.name,
        rendererId: selectedRendererId,
      },
      ...renderHistory,
    ].slice(0, 5)
  }

  async function previewSelectedVoicebankSample() {
    if (!voicebank || !selectedNote) {
      notice = 'Select a UTAU note to preview'
      return
    }
    if (isPreviewingVoicebankSample) {
      return
    }
    isPreviewingVoicebankSample = true
    const note = selectedNote
    try {
      stopPreviewTone()
      stopVoicebankSamplePreview({ keepBusy: true })
      const audioContext = getAudioContext()
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      const renderer = createUtauSampleRenderer(voicebank, audioContext)
      const result = await renderer.render(makeVoicebankPreviewProject(note))
      const buffer = audioContext.createBuffer(1, result.samples.length, result.sampleRate)
      buffer.copyToChannel(result.samples, 0)
      const source = audioContext.createBufferSource()
      const gain = audioContext.createGain()
      source.buffer = buffer
      gain.gain.setValueAtTime(0.82, audioContext.currentTime)
      source.connect(gain)
      gain.connect(audioContext.destination)
      voicebankPreviewSource = source
      voicebankPreviewGain = gain
      source.onended = () => {
        if (voicebankPreviewSource === source) {
          voicebankPreviewSource = null
          voicebankPreviewGain = null
          isPreviewingVoicebankSample = false
        }
        source.disconnect()
        gain.disconnect()
      }
      source.start()
      notice = `UTAU sample ${note.lyric} · ${toneName(note.tone)}`
    } catch (error) {
      stopVoicebankSamplePreview()
      notice = `Sample preview failed: ${formatErrorMessage(error)}`
    }
  }

  function makeVoicebankPreviewProject(note: SongNote): SongProject {
    const previewDuration = Math.max(note.duration, TICKS_PER_BEAT)
    return {
      ...project,
      id: `${project.id}-sample-preview`,
      name: `${project.name} Sample Preview`,
      parts: project.parts.map((part, index) =>
        index === 0
          ? {
              ...part,
              start: 0,
              duration: previewDuration + TICKS_PER_BEAT,
            }
          : part,
      ),
      notes: [
        {
          ...note,
          id: `${note.id}-sample-preview`,
          start: 0,
          duration: previewDuration,
        },
      ],
    }
  }

  function throwIfRenderAborted(signal: AbortSignal) {
    if (signal.aborted) {
      throw new DOMException('Render cancelled.', 'AbortError')
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
    audioRef.currentTime = isLoopOn ? loopStartSeconds : 0
    playbackTime = audioRef.currentTime
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
      audioRef.currentTime = isLoopOn ? loopStartSeconds : 0
    }
    playbackTime = isLoopOn ? loopStartSeconds : 0
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

  function downloadUst() {
    const blob = new Blob([serializeUst(project)], { type: 'text/plain;charset=utf-8' })
    downloadBlob(blob, `${sanitizeFileName(project.name)}.ust`)
    notice = 'UST saved'
  }

  function downloadWebutaProject() {
    const blob = new Blob([serializeWebutaProject(project)], { type: 'application/json;charset=utf-8' })
    downloadBlob(blob, `${sanitizeFileName(project.name)}.webutau.json`)
    notice = 'WebUtau project saved'
  }

  function clearRendered() {
    if (rendered?.url) {
      URL.revokeObjectURL(rendered.url)
    }
    rendered = null
  }

  function handleAudioTimeUpdate(event: Event) {
    const audio = event.currentTarget as HTMLAudioElement
    const effectiveLoopEnd = Math.min(loopEndSeconds, audio.duration || loopEndSeconds)
    if (isLoopOn && effectiveLoopEnd > loopStartSeconds && audio.currentTime >= effectiveLoopEnd - 0.015) {
      audio.currentTime = loopStartSeconds
      playbackTime = loopStartSeconds
      return
    }
    playbackTime = audio.currentTime
  }

  async function handleAudioEnded() {
    if (isLoopOn && audioRef) {
      audioRef.currentTime = loopStartSeconds
      playbackTime = loopStartSeconds
      try {
        await audioRef.play()
        isPlaying = true
      } catch {
        isPlaying = false
      }
      return
    }
    isPlaying = false
    playbackTime = 0
  }

  function resetLoopRange(targetProject: SongProject) {
    loopStartTick = 0
    loopEndTick = Math.min(projectDurationTicks(targetProject), TICKS_PER_BEAT * 4)
    isLoopOn = false
  }

  function normalizeLoopRange(startTick: number, endTick: number, maxTicks: number) {
    const endLimit = Math.max(GRID_SNAP_TICKS, maxTicks)
    const start = Math.min(Math.max(0, snapTickToGrid(startTick, GRID_SNAP_TICKS)), Math.max(0, endLimit - GRID_SNAP_TICKS))
    const end = Math.min(endLimit, Math.max(start + GRID_SNAP_TICKS, snapTickToGrid(endTick, GRID_SNAP_TICKS)))
    return { start, end }
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

  function playPreviewTone(note: SongNote) {
    try {
      const audioContext = getAudioContext()
      if (audioContext.state === 'suspended') {
        void audioContext.resume().catch(() => undefined)
      }
      stopPreviewTone()
      const now = audioContext.currentTime
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(midiToHz(note.tone), now)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.014)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24)
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start(now)
      oscillator.stop(now + 0.28)
      previewOscillator = oscillator
      previewGain = gain
      oscillator.onended = () => {
        if (previewOscillator === oscillator) {
          previewOscillator = null
          previewGain = null
        }
        oscillator.disconnect()
        gain.disconnect()
      }
      notice = `Preview ${note.lyric} · ${toneName(note.tone)}`
    } catch {
      notice = 'Touch preview unavailable'
    }
  }

  function stopPreviewTone() {
    if (!previewOscillator) {
      return
    }
    try {
      previewOscillator.stop()
    } catch {
      // Oscillator may already be stopped by the scheduled release.
    }
    previewOscillator.disconnect()
    previewGain?.disconnect()
    previewOscillator = null
    previewGain = null
  }

  function stopVoicebankSamplePreview(options: { keepBusy?: boolean } = {}) {
    const source = voicebankPreviewSource
    const gain = voicebankPreviewGain
    voicebankPreviewSource = null
    voicebankPreviewGain = null
    if (!options.keepBusy) {
      isPreviewingVoicebankSample = false
    }
    if (!source) {
      return
    }
    try {
      source.stop()
    } catch {
      // Buffer source may already have ended.
    }
    source.disconnect()
    gain?.disconnect()
  }

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

  function parseProjectFile(text: string, fileName: string) {
    if (/\.ust$/iu.test(fileName)) {
      return parseUst(text, fileName)
    }

    if (isWebutaProjectFileName(fileName)) {
      return parseWebutaProject(text, fileName)
    }

    try {
      return parseWebutaProject(text, fileName)
    } catch {
      if (/\[#SETTING\]|\[#\d+\]|\[#TRACKEND\]/iu.test(text)) {
        return parseUst(text, fileName)
      }
      return parseUstx(text, fileName)
    }
  }

  function isAbortError(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return true
    }
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'render-cancelled')
  }
</script>

<main class="app-shell">
  <TopBar
    {project}
    {projectSourceLabel}
    {playbackTime}
    {displayDuration}
    {renderProgress}
    {isRendering}
    {isPlaying}
    {isLoadingVoicebank}
    {isLoopOn}
    {loopStartSeconds}
    {loopEndSeconds}
    {canUndo}
    {canRedo}
    onNewProject={newProject}
    onResetDemoProject={resetDemoProject}
    onDuplicateProject={duplicateCurrentProject}
    onProjectFile={handleProjectFile}
    onVoicebankFile={handleVoicebankFile}
    onSaveProject={downloadWebutaProject}
    onExportUstx={downloadUstx}
    onExportUst={downloadUst}
    onUndo={undoProject}
    onRedo={redoProject}
    onOpenLicenses={() => (isAboutOpen = true)}
    onStop={stopPlayback}
    onPlayPause={playOrPause}
    onToggleLoop={toggleLoop}
    onCancelRender={cancelRender}
    onShare={shareWav}
    onDownloadWav={downloadWav}
    onProjectName={(name) => updateProject({ name })}
  />

  <ModeStrip {activeMode} {voicebankName} {voicebank} {voicebankCoverage} {notice} onMode={(mode) => (activeMode = mode)} />

  <section class={`workspace mode-${activeMode}`}>
    {#key activeMode}
      <LeftRail
        {project}
        {selectedNote}
        {selectedLyricMatch}
        {voicebank}
        {voicebankName}
        {voicebankCoverage}
        {voicebankWarnings}
        {voicebankCacheStatus}
        {isLoadingVoicebank}
        {isPreviewingVoicebankSample}
        {selectedRendererId}
        {selectedNeuralModelId}
        {neuralModels}
        {notice}
        onVoicebankFile={handleVoicebankFile}
        onPreviewVoicebankSample={previewSelectedVoicebankSample}
        onBpm={(bpm) => updateProject({ bpm })}
        onBeat={(beatPerBar, beatUnit) => updateProject({ beatPerBar, beatUnit })}
        onRenderer={selectRenderer}
        onNeuralModel={selectNeuralModel}
        onLyric={(lyric) => {
          paintLyric = lyric
          updateSelectedNote({ lyric })
        }}
        onTone={(tone) => updateSelectedNote({ tone })}
        onNudge={updateSelectedNote}
        onDuration={(duration) => updateSelectedNote({ duration })}
        onIntensity={(intensity) => updateSelectedNote({ intensity })}
        onTiming={(timing) => updateSelectedNote({ timing })}
        onEnvelope={(envelope) => updateSelectedNote({ envelope })}
        onVibrato={(vibrato) => updateSelectedNote({ vibrato })}
        onPitchBend={(pitchBend) => updateSelectedNote({ pitchBend })}
        onAddNote={addNote}
        onSplitNote={splitSelectedNote}
        onDeleteNote={deleteSelectedNote}
      />
    {/key}

    <div class="main-stack">
      <StarterGuide
        {project}
        {voicebankName}
        {voicebankCoverage}
        {rendered}
        {isRendering}
        {isPlaying}
        onNewProject={newProject}
        onResetDemoProject={resetDemoProject}
        onApplyLyricLine={applyLyricLine}
        onOpenCompose={() => (activeMode = 'compose')}
        onPlayPause={playOrPause}
        onDownloadWav={downloadWav}
      />

      {#if activeMode === 'compose'}
        <ComposerPanel
          lyrics={composerLyrics}
          mood={composerMood}
          suggestion={composerSuggestion}
          onLyrics={(lyrics) => (composerLyrics = lyrics)}
          onMood={(mood) => (composerMood = mood)}
          onGenerate={announceComposition}
          onApply={applyComposition}
        />
      {/if}

      <EditorArea
        {project}
        {performanceKeys}
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
        {selectedRendererId}
        currentRendererName={currentRendererName()}
        {renderHistory}
        {renderProgress}
        {notice}
        {isRendering}
        {isRecording}
        {isMetronomeOn}
        {isQuantizeOn}
        {isLoopOn}
        loopStartTick={loopRange.start}
        loopEndTick={loopRange.end}
        {nextPerformanceLyric}
        canUndo={canUndo && !isRecording}
        {canRedo}
        {playbackTime}
        {displayDuration}
        onSaveProject={downloadWebutaProject}
        onSelectNote={selectNote}
        onPerformNote={performNote}
        onChooseLyric={chooseLyric}
        onLyricLine={(line) => {
          lyricLine = line
          isLyricLinePinned = true
          lyricCursor = 0
          recordingLyricTokens = []
        }}
        onApplyLyricLine={applyLyricLine}
        onToggleRecording={toggleRecording}
        onToggleMetronome={toggleMetronome}
        onToggleQuantize={() => (isQuantizeOn = !isQuantizeOn)}
        onToggleLoop={toggleLoop}
        onSetLoopToSelection={setLoopToSelectedNote}
        onQuantize={quantizeCurrentProject}
        onDuplicateNote={duplicateSelectedNote}
        onSplitNote={splitSelectedNote}
        onDeleteNote={deleteSelectedNote}
        onUndo={undoProject}
        onRedo={redoProject}
        onGridClick={handleGridClick}
        onNoteKeyDown={handleNoteKeyDown}
        onNotePointerDown={startNotePointer}
        onNotePointerMove={moveNotePointer}
        onNotePointerEnd={endNotePointer}
        onShare={shareWav}
        onDownloadWav={downloadWav}
        onRetryRender={renderProject}
        onCancelRender={cancelRender}
      />
    </div>
  </section>

  <audio
    class="hidden-audio"
    bind:this={audioRef}
    src={rendered?.url}
    ontimeupdate={handleAudioTimeUpdate}
    onended={() => void handleAudioEnded()}
    onpause={() => (isPlaying = false)}
    onplay={() => (isPlaying = true)}
  ></audio>

  {#if isAboutOpen}
    <AboutDialog onClose={() => (isAboutOpen = false)} />
  {/if}
</main>
