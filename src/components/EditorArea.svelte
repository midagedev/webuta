<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    Circle,
    Copy,
    Download,
    FileDown,
    History,
    Mic,
    Music2,
    Redo2,
    Repeat2,
    RotateCcw,
    Scissors,
    Share2,
    Target,
    Trash2,
    Undo2,
    X,
  } from '@lucide/svelte'
  import cyberVocalHero from '../assets/cyber-vocal-hero.webp'
  import {
    TICKS_PER_BEAT,
    type RenderedAudio,
    type RenderHistoryEntry,
    type RenderProgress,
    type RendererId,
    type SongNote,
    type SongProject,
  } from '../types'
  import { projectDurationTicks, toneName } from '../music'
  import {
    compactLyricLine,
    formatVoicebankCacheStatus,
    formatVoicebankCoverage,
    formatWavSummary,
    inputValue,
    isBlackKey,
    LYRIC_PALETTE,
    MIN_NOTE_WIDTH,
    ROW_HEIGHT,
    TICK_WIDTH,
    type VoicebankCacheStatus,
  } from '../app/ui'
  import type { LoadedVoicebank, VoicebankCoverage } from '../voicebank'

  type Props = {
    project: SongProject
    performanceKeys: SongNote[]
    projectSourceLabel: string
    selectedNote: SongNote | undefined
    rows: number[]
    rangeMax: number
    songTicks: number
    gridWidth: number
    gridHeight: number
    beatCount: number
    barCount: number
    playheadLeft: number
    paintLyric: string
    lyricLine: string
    voicebank: LoadedVoicebank | null
    voicebankName: string
    voicebankCoverage: VoicebankCoverage | null
    voicebankCacheStatus: VoicebankCacheStatus
    rendered: RenderedAudio | null
    selectedRendererId: RendererId
    currentRendererName: string
    renderHistory: RenderHistoryEntry[]
    renderProgress: RenderProgress
    notice: string
    isRendering: boolean
    isRecording: boolean
    isMetronomeOn: boolean
    isQuantizeOn: boolean
    isLoopOn: boolean
    loopStartTick: number
    loopEndTick: number
    nextPerformanceLyric: string
    canUndo: boolean
    canRedo: boolean
    playbackTime: number
    displayDuration: number
    onSaveProject: () => void
    onSelectNote: (note: SongNote) => void
    onPerformNote: (note: SongNote) => void
    onChooseLyric: (lyric: string) => void
    onLyricLine: (line: string) => void
    onApplyLyricLine: () => void
    onToggleRecording: () => void
    onToggleMetronome: () => void
    onToggleQuantize: () => void
    onToggleLoop: () => void
    onSetLoopToSelection: () => void
    onQuantize: () => void
    onDuplicateNote: () => void
    onSplitNote: () => void
    onDeleteNote: () => void
    onUndo: () => void
    onRedo: () => void
    onGridClick: (event: MouseEvent) => void
    onNoteKeyDown: (event: KeyboardEvent, note: SongNote) => void
    onNotePointerDown: (event: PointerEvent, note: SongNote) => void
    onNotePointerMove: (event: PointerEvent) => void
    onNotePointerEnd: (event: PointerEvent) => void
    onShare: () => Promise<void>
    onDownloadWav: () => Promise<void>
    onRetryRender: () => Promise<RenderedAudio | null>
    onCancelRender: () => void
  }

  let {
    project,
    performanceKeys,
    projectSourceLabel,
    selectedNote,
    rows,
    rangeMax,
    songTicks,
    gridWidth,
    gridHeight,
    beatCount,
    barCount,
    playheadLeft,
    paintLyric,
    lyricLine,
    voicebank,
    voicebankName,
    voicebankCoverage,
    voicebankCacheStatus,
    rendered,
    selectedRendererId,
    currentRendererName,
    renderHistory,
    renderProgress,
    notice,
    isRendering,
    isRecording,
    isMetronomeOn,
    isQuantizeOn,
    isLoopOn,
    loopStartTick,
    loopEndTick,
    nextPerformanceLyric,
    canUndo,
    canRedo,
    playbackTime,
    displayDuration,
    onSaveProject,
    onSelectNote,
    onPerformNote,
    onChooseLyric,
    onLyricLine,
    onApplyLyricLine,
    onToggleRecording,
    onToggleMetronome,
    onToggleQuantize,
    onToggleLoop,
    onSetLoopToSelection,
    onQuantize,
    onDuplicateNote,
    onSplitNote,
    onDeleteNote,
    onUndo,
    onRedo,
    onGridClick,
    onNoteKeyDown,
    onNotePointerDown,
    onNotePointerMove,
    onNotePointerEnd,
    onShare,
    onDownloadWav,
    onRetryRender,
    onCancelRender,
  }: Props = $props()

  let selectedNoteLabel = $derived(selectedNote ? `${selectedNote.lyric} · ${toneName(selectedNote.tone)}` : 'No note')
  let previewHandledByPointer = false
  let pressedPerformanceNoteId = $state<string | null>(null)
  let performancePressTimer: ReturnType<typeof setTimeout> | undefined

  onDestroy(() => {
    if (performancePressTimer) {
      clearTimeout(performancePressTimer)
    }
  })

  function flashPerformanceKey(noteId: string) {
    pressedPerformanceNoteId = noteId
    if (performancePressTimer) {
      clearTimeout(performancePressTimer)
    }
    performancePressTimer = setTimeout(() => {
      if (pressedPerformanceNoteId === noteId) {
        pressedPerformanceNoteId = null
      }
    }, 300)
  }

  function handlePreviewPointerDown(event: PointerEvent, note: SongNote) {
    previewHandledByPointer = true
    flashPerformanceKey(note.id)
    onPerformNote(note)
    event.preventDefault()
  }

  function handlePreviewClick(note: SongNote) {
    if (previewHandledByPointer) {
      previewHandledByPointer = false
      flashPerformanceKey(note.id)
      return
    }
    flashPerformanceKey(note.id)
    onPerformNote(note)
  }
  let historyRows = $derived(renderHistory.slice(0, 3))
  let rendererModeLabel = $derived(selectedRendererId === 'local-neural' ? 'NEURAL' : voicebank ? 'UTAU ZIP' : 'DEMO')
  let renderProgressWidth = $derived(isRendering ? renderProgress.percent : displayDuration > 0 ? Math.min(100, (playbackTime / displayDuration) * 100) : 0)
</script>

<section class="editor-area">
  <div class="timeline-header">
    <div>
      <p class="project-kicker">현재 프로젝트 · {projectSourceLabel}</p>
      <h1>{project.name}</h1>
      <p>pattern 00 · {project.notes.length} notes · {beatCount} beats · {barCount} bars</p>
    </div>
    <button type="button" class="icon-text-button" onclick={onSaveProject}>
      <FileDown size={18} aria-hidden="true" />
      <span>프로젝트</span>
    </button>
  </div>

  <div class="tracker-strip" aria-label="Tracker status">
    <div><span>PAT</span><strong>00</strong></div>
    <div><span>CH</span><strong>01 VOC</strong></div>
    <div><span>BPM</span><strong>{project.bpm}</strong></div>
    <div><span>ROWS</span><strong>{rows.length}</strong></div>
    <div><span>BANK</span><strong>{rendererModeLabel}</strong></div>
    <div><span>MATCH</span><strong>{voicebank ? formatVoicebankCoverage(voicebankCoverage, 'compact') : 'DEMO'}</strong></div>
    <div><span>OUT</span><strong>{rendered ? 'WAV READY' : 'ARMED'}</strong></div>
  </div>

  <div class="mobile-mascot-banner">
    <img src={cyberVocalHero} alt="" aria-hidden="true" />
    <div>
      <span>CYBER TRACKER CLUB</span>
      <strong>{compactLyricLine(project.notes)}</strong>
    </div>
  </div>

  <div class="mobile-note-strip performance-keyboard" aria-label="Touch performance keyboard">
    {#each performanceKeys as note, index (note.id)}
      <button
        type="button"
        class={`${note.id === selectedNote?.id ? 'active' : ''} ${note.id === pressedPerformanceNoteId ? 'pressed' : ''}`}
        title={`${note.lyric} ${toneName(note.tone)} 미리듣기`}
        onpointerdown={(event) => handlePreviewPointerDown(event, note)}
        onclick={() => handlePreviewClick(note)}
      >
        <small>{index + 1}</small>
        <strong>{note.lyric}</strong>
        <span>{toneName(note.tone)}</span>
      </button>
    {/each}
  </div>

  <div class="lyric-pads" aria-label="Quick lyric painter">
    {#each LYRIC_PALETTE as lyric (lyric)}
      <button type="button" class={lyric === paintLyric ? 'active' : ''} onclick={() => onChooseLyric(lyric)}>
        {lyric}
      </button>
    {/each}
  </div>

  <div class="lyric-line-editor" aria-label="Lyric line editor">
    <input aria-label="가사 라인" value={lyricLine} placeholder="도히도히 다이스키" oninput={(event) => onLyricLine(inputValue(event))} />
    <button type="button" onclick={onApplyLyricLine}>적용</button>
  </div>

  <div class={`performance-panel ${isRecording ? 'recording' : ''}`} aria-label="Performance controls">
    <div class="performance-readout">
      <span class={`status-dot ${isRecording ? 'recording' : isMetronomeOn ? 'ready' : 'idle'}`}></span>
      <div>
        <strong>{isRecording ? 'REC' : 'LIVE'}</strong>
        <span>NEXT {nextPerformanceLyric} · {isQuantizeOn ? 'Q 1/16' : 'FREE'}</span>
      </div>
    </div>
    <div class="performance-actions">
      <button
        type="button"
        class={`performance-action record ${isRecording ? 'active' : ''}`}
        aria-label={isRecording ? '녹음 정지' : '녹음 시작'}
        onclick={onToggleRecording}
      >
        <Circle size={16} aria-hidden="true" />
        <span>{isRecording ? 'STOP' : 'REC'}</span>
      </button>
      <button
        type="button"
        class={`performance-action ${isMetronomeOn ? 'active' : ''}`}
        aria-label={isMetronomeOn ? '메트로놈 끄기' : '메트로놈 켜기'}
        onclick={onToggleMetronome}
      >
        <Music2 size={16} aria-hidden="true" />
        <span>MET</span>
      </button>
      <button
        type="button"
        class={`performance-action ${isQuantizeOn ? 'active' : ''}`}
        aria-label={isQuantizeOn ? '퀀타이즈 입력 끄기' : '퀀타이즈 입력 켜기'}
        onclick={onToggleQuantize}
      >
        <Scissors size={16} aria-hidden="true" />
        <span>Q</span>
      </button>
      <button type="button" class="performance-action" aria-label="전체 퀀타이즈" onclick={onQuantize}>
        <Scissors size={16} aria-hidden="true" />
        <span>FIX</span>
      </button>
      <button
        type="button"
        class={`performance-action ${isLoopOn ? 'active' : ''}`}
        aria-label={isLoopOn ? '루프 끄기' : '루프 켜기'}
        onclick={onToggleLoop}
      >
        <Repeat2 size={16} aria-hidden="true" />
        <span>LOOP</span>
      </button>
      <button type="button" class="performance-action" aria-label="선택 노트 루프" onclick={onSetLoopToSelection}>
        <Target size={16} aria-hidden="true" />
        <span>SEL</span>
      </button>
      <button type="button" class="performance-action" aria-label="선택 노트 복제" onclick={onDuplicateNote}>
        <Copy size={16} aria-hidden="true" />
        <span>COPY</span>
      </button>
      <button type="button" class="performance-action" aria-label="선택 노트 분할" onclick={onSplitNote}>
        <Scissors size={16} aria-hidden="true" />
        <span>SPLIT</span>
      </button>
      <button type="button" class="performance-action danger" aria-label="선택 노트 삭제" onclick={onDeleteNote}>
        <Trash2 size={16} aria-hidden="true" />
      </button>
      <button type="button" class="performance-action" aria-label="되돌리기" onclick={onUndo} disabled={!canUndo}>
        <Undo2 size={16} aria-hidden="true" />
      </button>
      <button type="button" class="performance-action" aria-label="다시 실행" onclick={onRedo} disabled={!canRedo}>
        <Redo2 size={16} aria-hidden="true" />
      </button>
    </div>
  </div>

  <div class="arrangement-panel">
    <div class="ruler-head">Pat 00</div>
    <div class="ruler-scroll">
      <div class="ruler-grid" style={`width: ${gridWidth}px;`}>
        {#each Array.from({ length: barCount }, (_, bar) => bar) as bar (bar)}
          <span style={`left: ${bar * project.beatPerBar * TICKS_PER_BEAT * TICK_WIDTH}px;`}>{bar + 1}</span>
        {/each}
      </div>
    </div>
    <div class="track-lane-head">
      <Mic size={17} aria-hidden="true" />
      <div>
        <strong>CH 01 Vocal</strong>
        <span>{voicebankName}</span>
      </div>
    </div>
    <div class="track-lane-scroll">
      <div class="track-lane-grid" style={`width: ${gridWidth}px;`}>
        {#each Array.from({ length: beatCount + 1 }, (_, beat) => beat) as beat (beat)}
          <div class={`beat-line ${beat % project.beatPerBar === 0 ? 'bar' : ''}`} style={`left: ${beat * TICKS_PER_BEAT * TICK_WIDTH}px;`}></div>
        {/each}
        <div class="vocal-region" style={`width: ${Math.max(220, projectDurationTicks(project) * TICK_WIDTH)}px;`}>
          {#each project.notes as note (note.id)}
            <span>{note.lyric}</span>
          {/each}
        </div>
        <div class="playhead-line arrangement" style={`left: ${playheadLeft}px;`}></div>
      </div>
    </div>
  </div>

  <div class="editor-toolbar">
    <div>
      <strong>Tracker Piano Grid</strong>
      <span>{selectedNoteLabel}</span>
    </div>
    <div class="editor-chips">
      <span>{rows.length} rows</span>
      <span>CH 01</span>
      <span>{currentRendererName}</span>
    </div>
  </div>

  <div class="piano-roll-frame" style={`min-height: ${gridHeight}px;`}>
    <div class="keyboard" style={`height: ${gridHeight}px;`}>
      {#each rows as tone (tone)}
        <div class={`key-row ${isBlackKey(tone) ? 'black' : 'white'}`}>
          <span class="key-label">{toneName(tone)}</span>
        </div>
      {/each}
    </div>
    <div class="roll-scroll">
      <div
        class="roll-grid"
        role="grid"
        tabindex="0"
        aria-label="Piano roll note grid"
        aria-rowcount={rows.length}
        aria-colcount={Math.ceil(songTicks / TICKS_PER_BEAT)}
        style={`width: ${gridWidth}px; height: ${gridHeight}px;`}
        onclick={onGridClick}
        onkeydown={() => undefined}
      >
        {#each rows as tone, rowIndex (tone)}
          <div class={`grid-row ${isBlackKey(tone) ? 'black' : 'white'}`} style={`top: ${rowIndex * ROW_HEIGHT}px;`}></div>
        {/each}
        {#each Array.from({ length: Math.ceil(songTicks / TICKS_PER_BEAT) + 1 }, (_, beat) => beat) as beat (beat)}
          <div class={`beat-line ${beat % project.beatPerBar === 0 ? 'bar' : ''}`} style={`left: ${beat * TICKS_PER_BEAT * TICK_WIDTH}px;`}></div>
        {/each}
        {#each Array.from({ length: barCount }, (_, bar) => bar) as bar (bar)}
          <span class="roll-bar-label" style={`left: ${bar * project.beatPerBar * TICKS_PER_BEAT * TICK_WIDTH}px;`}>{bar + 1}</span>
        {/each}
        {#if isLoopOn}
          <div
            class="loop-region"
            aria-hidden="true"
            style={`left: ${loopStartTick * TICK_WIDTH}px; width: ${Math.max(10, (loopEndTick - loopStartTick) * TICK_WIDTH)}px;`}
          ></div>
        {/if}
        <div class="playhead-line" style={`left: ${playheadLeft}px;`}></div>
        {#each project.notes as note (note.id)}
          {@const row = rangeMax - note.tone}
          <button
            type="button"
            class={`note-block ${note.id === selectedNote?.id ? 'selected' : ''}`}
            aria-label={`${note.lyric} ${toneName(note.tone)} note`}
            title="드래그해서 이동, 오른쪽 끝 드래그로 길이 조절"
            style={`left: ${note.start * TICK_WIDTH}px; top: ${row * ROW_HEIGHT + 3}px; width: ${Math.max(MIN_NOTE_WIDTH, note.duration * TICK_WIDTH - 4)}px;`}
            onclick={() => onSelectNote(note)}
            onkeydown={(event) => onNoteKeyDown(event, note)}
            onpointerdown={(event) => onNotePointerDown(event, note)}
            onpointermove={onNotePointerMove}
            onpointerup={onNotePointerEnd}
            onpointercancel={onNotePointerEnd}
          >
            <span>{note.lyric}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="bottom-dock">
    <div class="dock-status">
      <span class={`status-dot ${isRendering ? 'planned' : rendered ? 'ready' : 'idle'}`}></span>
      <div>
        <strong>{isRendering ? renderProgress.label : notice}</strong>
        <span>
          {isRendering
            ? `${currentRendererName} · ${renderProgress.phase}`
            : voicebank
            ? `${voicebankName} · ${formatVoicebankCoverage(voicebankCoverage)} · ${formatVoicebankCacheStatus(voicebankCacheStatus)}`
            : voicebankName}
        </span>
      </div>
    </div>
    <div class={`playhead-meter ${isRendering ? 'busy' : ''}`} aria-label={isRendering ? 'Render progress' : 'Playback progress'}>
      <div class="playhead-fill" style={`width: ${renderProgressWidth}%;`}></div>
    </div>
    <div class="export-summary">
      <strong>{rendered ? rendered.fileName : 'WAV not rendered yet'}</strong>
      <span>{rendered ? formatWavSummary(rendered.wavInfo) : '44.1 kHz mono WAV'}</span>
    </div>
    <div class="dock-actions" aria-label="Export shortcuts">
      {#if isRendering}
        <button type="button" class="dock-action danger" aria-label="렌더 취소" onclick={onCancelRender} disabled={!renderProgress.cancellable}>
          <X size={18} aria-hidden="true" />
          <span>취소</span>
        </button>
      {:else}
        <button type="button" class="dock-action primary" aria-label="WAV 공유" onclick={() => void onShare()} disabled={isRendering}>
          <Share2 size={18} aria-hidden="true" />
          <span>공유</span>
        </button>
        <button type="button" class="dock-action" aria-label="하단 WAV 다운로드" onclick={() => void onDownloadWav()} disabled={isRendering}>
          <Download size={18} aria-hidden="true" />
          <span>WAV</span>
        </button>
      {/if}
    </div>
  </div>

  {#if renderHistory.length > 0}
    <section class="render-history-panel" aria-label="Render history">
      <div class="render-history-head">
        <div>
          <History size={17} aria-hidden="true" />
          <strong>Render History</strong>
        </div>
        <button type="button" class="small-button retry-button" onclick={() => void onRetryRender()} disabled={isRendering}>
          <RotateCcw size={15} aria-hidden="true" />
          <span>Retry</span>
        </button>
      </div>
      <div class="render-history-list">
        {#each historyRows as item (item.id)}
          <article class={`render-history-row ${item.status}`}>
            <span class={`status-dot ${item.status === 'success' ? 'ready' : item.status === 'cancelled' ? 'planned' : 'blocked'}`}></span>
            <div>
              <strong>{item.fileName}</strong>
              <span>{item.createdAt} · {item.rendererName} · {item.detail}</span>
            </div>
            <em>{item.durationSeconds === null ? 'failed' : `${item.durationSeconds.toFixed(2)}s`}</em>
          </article>
        {/each}
      </div>
    </section>
  {/if}
</section>
