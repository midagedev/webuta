import {
  Download,
  FileDown,
  FolderOpen,
  Gauge,
  Mic2,
  Pause,
  Play,
  Plus,
  Save,
  Scissors,
  SkipBack,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import './App.css'
import { encodeWav } from './audio/wav'
import cyberVocalHero from './assets/cyber-vocal-hero.webp'
import { demoProject } from './demoProject'
import {
  pitchRange,
  projectDurationTicks,
  sanitizeFileName,
  toneName,
} from './music'
import { addNoteAfter, addNoteFromGrid } from './projectEditing'
import { rendererCapabilities, renderers } from './renderers/registry'
import { createUtauSampleRenderer } from './renderers/utauSampleRenderer'
import { parseUstx, serializeUstx } from './ustx'
import { TICKS_PER_BEAT, type RenderedAudio, type SongNote, type SongProject } from './types'
import { loadVoicebankZip, type LoadedVoicebank } from './voicebank'

const ROW_HEIGHT = 26
const TICK_WIDTH = 0.15
const MIN_NOTE_WIDTH = 44
const LYRIC_PALETTE = ['도', '히', '다', '이', '스', '키', '라', '나']

function App() {
  const [project, setProject] = useState<SongProject>(demoProject)
  const [selectedNoteId, setSelectedNoteId] = useState(demoProject.notes[0]?.id ?? '')
  const [rendered, setRendered] = useState<RenderedAudio | null>(null)
  const [voicebankName, setVoicebankName] = useState('Browser demo voice')
  const [voicebank, setVoicebank] = useState<LoadedVoicebank | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [isLoadingVoicebank, setIsLoadingVoicebank] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackTime, setPlaybackTime] = useState(0)
  const [notice, setNotice] = useState('Ready')
  const [paintLyric, setPaintLyric] = useState('도')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const voicebankInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const selectedNote = project.notes.find((note) => note.id === selectedNoteId) ?? project.notes[0]
  const range = useMemo(() => pitchRange(project.notes), [project.notes])
  const rows = useMemo(() => {
    const values: number[] = []
    for (let tone = range.max; tone >= range.min; tone--) {
      values.push(tone)
    }
    return values
  }, [range.max, range.min])
  const songTicks = Math.max(projectDurationTicks(project), TICKS_PER_BEAT * 8)
  const gridWidth = Math.max(820, songTicks * TICK_WIDTH)
  const gridHeight = rows.length * ROW_HEIGHT
  const displayDuration = rendered?.durationSeconds ?? 0
  const beatCount = Math.ceil(songTicks / TICKS_PER_BEAT)
  const barCount = Math.ceil(beatCount / project.beatPerBar)
  const playheadLeft = displayDuration > 0 ? Math.min(gridWidth, (playbackTime / displayDuration) * gridWidth) : 0
  const selectedNoteLabel = selectedNote ? `${selectedNote.lyric} · ${toneName(selectedNote.tone)}` : 'No note'

  async function handleFile(file: File) {
    const text = await file.text()
    const nextProject = parseUstx(text, file.name)
    setProject(nextProject)
    setSelectedNoteId(nextProject.notes[0]?.id ?? '')
    clearRendered()
    setNotice(`${file.name} loaded`)
  }

  async function handleVoicebankFile(file: File) {
    setIsLoadingVoicebank(true)
    setNotice('Reading voicebank zip')
    try {
      const loaded = await loadVoicebankZip(file)
      setVoicebank(loaded)
      setVoicebankName(loaded.name)
      clearRendered()
      setNotice(`${loaded.name}: ${loaded.sampleCount} aliases`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Voicebank import failed')
    } finally {
      setIsLoadingVoicebank(false)
    }
  }

  function clearRendered() {
    if (rendered?.url) {
      URL.revokeObjectURL(rendered.url)
    }
    setRendered(null)
  }

  function updateProject(patch: Partial<SongProject>) {
    setProject((current) => ({ ...current, ...patch }))
    clearRendered()
  }

  function updateSelectedNote(patch: Partial<SongNote>) {
    if (!selectedNote) {
      return
    }
    setProject((current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === selectedNote.id
          ? {
              ...note,
              ...patch,
            }
          : note,
      ),
    }))
    clearRendered()
  }

  function addNote() {
    const { project: nextProject, note } = addNoteAfter(project, selectedNote ?? project.notes.at(-1), paintLyric)
    setProject(nextProject)
    setSelectedNoteId(note.id)
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
    setProject(nextProject)
    setSelectedNoteId(note.id)
    clearRendered()
    setNotice(`${note.lyric} ${toneName(note.tone)} added`)
  }

  function handleGridClick(event: ReactMouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    addNoteAtGridPoint(event.clientX - rect.left, event.clientY - rect.top)
  }

  function chooseLyric(lyric: string) {
    setPaintLyric(lyric)
    if (selectedNote) {
      updateSelectedNote({ lyric })
    }
  }

  function selectNote(note: SongNote) {
    setSelectedNoteId(note.id)
    setPaintLyric(note.lyric)
  }

  function deleteSelectedNote() {
    if (!selectedNote || project.notes.length <= 1) {
      return
    }
    const nextNotes = project.notes.filter((note) => note.id !== selectedNote.id)
    setProject((current) => ({
      ...current,
      notes: nextNotes,
    }))
    setSelectedNoteId(nextNotes[0]?.id ?? '')
    clearRendered()
  }

  async function renderProject() {
    setIsRendering(true)
    setNotice('Rendering WAV')
    try {
      const renderer = voicebank
        ? createUtauSampleRenderer(voicebank, getAudioContext())
        : renderers.browserDemo
      const result = await renderer.render(project)
      const blob = encodeWav(result.samples, result.sampleRate)
      const url = URL.createObjectURL(blob)
      if (rendered?.url) {
        URL.revokeObjectURL(rendered.url)
      }
      const audio: RenderedAudio = {
        blob,
        url,
        durationSeconds: result.durationSeconds,
        fileName: `${sanitizeFileName(project.name)}.wav`,
      }
      setRendered(audio)
      setNotice('WAV ready')
      return audio
    } finally {
      setIsRendering(false)
    }
  }

  async function playOrPause() {
    const audio = audioRef.current
    if (isPlaying && audio) {
      audio.pause()
      setIsPlaying(false)
      return
    }
    const current = rendered ?? (await renderProject())
    if (!audio || !current) {
      return
    }
    audio.src = current.url
    audio.currentTime = 0
    setPlaybackTime(0)
    await audio.play()
    setIsPlaying(true)
  }

  function stopPlayback() {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    setPlaybackTime(0)
    setIsPlaying(false)
  }

  async function downloadWav() {
    const current = rendered ?? (await renderProject())
    if (!current) {
      return
    }
    downloadBlob(current.blob, current.fileName)
  }

  function downloadUstx() {
    const blob = new Blob([serializeUstx(project)], { type: 'text/yaml;charset=utf-8' })
    downloadBlob(blob, `${sanitizeFileName(project.name)}.ustx`)
    setNotice('USTX saved')
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="nav-cluster" aria-label="Project navigation">
          <button type="button" className="toolbar-button" title="USTX 열기" onClick={() => fileInputRef.current?.click()}>
            <FolderOpen size={20} aria-hidden="true" />
          </button>
          <button type="button" className="toolbar-button" title="USTX 저장" onClick={downloadUstx}>
            <Save size={20} aria-hidden="true" />
          </button>
          <span className="topbar-label">Pattern Desk</span>
        </div>

        <div className="transport-center" aria-label="Playback controls">
          <button type="button" className="transport-button" title="처음으로" onClick={stopPlayback}>
            <SkipBack size={20} aria-hidden="true" />
          </button>
          <button type="button" className="play-button" onClick={() => void playOrPause()} disabled={isRendering}>
            {isPlaying ? <Pause size={24} aria-hidden="true" /> : <Play size={24} aria-hidden="true" />}
          </button>
          <button type="button" className="transport-button" title="정지" onClick={stopPlayback}>
            <Square size={17} aria-hidden="true" />
          </button>
          <div className="lcd-panel" aria-label="Transport display">
            <div className="lcd-side">
              <span className="lcd-label">TIME</span>
              <span className="lcd-counter">{formatTime(playbackTime)} / {formatTime(displayDuration)}</span>
            </div>
            <input
              className="project-title"
              aria-label="Project name"
              value={project.name}
              onChange={(event) => updateProject({ name: event.target.value })}
            />
            <div className="lcd-side right">
              <span className="lcd-label">SONG</span>
              <span className="lcd-meta">{project.bpm} BPM · {project.beatPerBar}/{project.beatUnit}</span>
            </div>
          </div>
        </div>

        <div className="export-cluster" aria-label="Project actions">
          <button
            type="button"
            className="toolbar-button"
            title="보컬 ZIP 가져오기"
            onClick={() => voicebankInputRef.current?.click()}
            disabled={isLoadingVoicebank}
          >
            <Upload size={20} aria-hidden="true" />
          </button>
          <button type="button" className="export-button" onClick={() => void downloadWav()} disabled={isRendering}>
            <Download size={19} aria-hidden="true" />
            <span>WAV</span>
          </button>
        </div>

        <div className="hidden-top-inputs">
          <input
            ref={fileInputRef}
            type="file"
            accept=".ustx,.yaml,.yml,.json"
            className="hidden-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void handleFile(file)
              }
              event.currentTarget.value = ''
            }}
          />
          <input
            ref={voicebankInputRef}
            type="file"
            accept=".zip"
            className="hidden-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void handleVoicebankFile(file)
              }
              event.currentTarget.value = ''
            }}
          />
        </div>
      </header>

      <nav className="mode-strip" aria-label="Workspace sections">
        <div className="brand-block">
          <div className="brand-mark">
            <img src={cyberVocalHero} alt="" aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">CYBER TRACKER CLUB</p>
            <strong>WebUtau // {voicebankName}</strong>
          </div>
        </div>
        <div className="mode-tabs">
          <button type="button" className="mode-tab active">
            <Mic2 size={17} aria-hidden="true" />
            <span>Pattern</span>
          </button>
          <button type="button" className="mode-tab">
            <Scissors size={17} aria-hidden="true" />
            <span>Rows</span>
          </button>
          <button type="button" className="mode-tab">
            <Gauge size={17} aria-hidden="true" />
            <span>Mixer</span>
          </button>
        </div>
        <div className="session-chip">
          <span className={`status-dot ${voicebank ? 'ready' : 'idle'}`}></span>
          <span>{voicebank ? `${voicebank.wavCount} wav` : notice}</span>
        </div>
      </nav>

      <section className="workspace">
        <aside className="left-rail">
          <section className="tool-panel">
            <div className="panel-heading">
              <Sparkles size={18} aria-hidden="true" />
              <h2>패턴</h2>
            </div>
            <div className="mascot-card">
              <img src={cyberVocalHero} alt="Cyber vocal synth mascot illustration" />
              <div>
                <strong>Vocal Operator</strong>
                <span>tracker vocal mode</span>
              </div>
            </div>
            <div className="channel-strip">
              <div className="track-avatar">
                <img src={cyberVocalHero} alt="" aria-hidden="true" />
              </div>
              <div className="track-copy">
                <strong>{project.tracks[0]?.name ?? 'Main Vocal'}</strong>
                <span>{voicebankName}</span>
              </div>
              <Volume2 size={18} aria-hidden="true" />
            </div>
            <div className="channel-meter" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <label className="field-label">
              BPM
              <input
                type="number"
                min={60}
                max={220}
                value={project.bpm}
                onChange={(event) => updateProject({ bpm: Number(event.target.value) || 120 })}
              />
            </label>
            <label className="field-label">
              박자
              <select
                value={`${project.beatPerBar}/${project.beatUnit}`}
                onChange={(event) => {
                  const [beatPerBar, beatUnit] = event.target.value.split('/').map(Number)
                  updateProject({ beatPerBar, beatUnit })
                }}
              >
                <option value="4/4">4/4</option>
                <option value="3/4">3/4</option>
                <option value="6/8">6/8</option>
              </select>
            </label>
            <label className="field-label">
              보컬
              <select value="browser-demo" onChange={() => setNotice('Browser demo voice selected')}>
                <option value="browser-demo">{voicebankName}</option>
              </select>
            </label>
            <div className="voicebank-actions">
              <button
                type="button"
                className="icon-text-button"
                onClick={() => voicebankInputRef.current?.click()}
                disabled={isLoadingVoicebank}
              >
                <Upload size={18} aria-hidden="true" />
                <span>ZIP</span>
              </button>
              <a className="text-link-button" href="https://kasaneteto.jp/utau/" target="_blank" rel="noreferrer">
                Teto UTAU
              </a>
            </div>
            <div className="status-strip">
              <Volume2 size={17} aria-hidden="true" />
              <span>{voicebank ? `${notice} · ${voicebank.wavCount} wav` : notice}</span>
            </div>
          </section>

          <section className="tool-panel">
            <div className="panel-heading">
              <Scissors size={18} aria-hidden="true" />
              <h2>노트</h2>
            </div>
            {selectedNote ? (
              <div className="note-editor">
                <div className="selected-note-card">
                  <span>{selectedNote.lyric}</span>
                  <strong>{toneName(selectedNote.tone)}</strong>
                </div>
                <label className="field-label">
                  가사
                  <input
                    value={selectedNote.lyric}
                    maxLength={12}
                    onChange={(event) => {
                      const lyric = event.target.value || '라'
                      setPaintLyric(lyric)
                      updateSelectedNote({ lyric })
                    }}
                  />
                </label>
                <label className="field-label">
                  음
                  <select
                    value={selectedNote.tone}
                    onChange={(event) => updateSelectedNote({ tone: Number(event.target.value) })}
                  >
                    {Array.from({ length: 37 }, (_, index) => 48 + index).map((tone) => (
                      <option key={tone} value={tone}>
                        {toneName(tone)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="step-row">
                  <button
                    type="button"
                    className="small-button"
                    onClick={() => updateSelectedNote({ duration: Math.max(120, selectedNote.duration - 120) })}
                  >
                    짧게
                  </button>
                  <button
                    type="button"
                    className="small-button"
                    onClick={() => updateSelectedNote({ duration: selectedNote.duration + 120 })}
                  >
                    길게
                  </button>
                </div>
              </div>
            ) : null}
            <div className="tool-row">
              <button type="button" className="icon-text-button" onClick={addNote}>
                <Plus size={18} aria-hidden="true" />
                <span>추가</span>
              </button>
              <button type="button" className="icon-text-button danger" onClick={deleteSelectedNote}>
                <Trash2 size={18} aria-hidden="true" />
                <span>삭제</span>
              </button>
            </div>
          </section>

          <section className="tool-panel engine-panel">
            <div className="panel-heading">
              <Upload size={18} aria-hidden="true" />
              <h2>엔진</h2>
            </div>
            <div className="engine-list">
              {rendererCapabilities.map((renderer) => (
                <div className="engine-row" key={renderer.id}>
                  <span className={`status-dot ${renderer.status}`}></span>
                  <div>
                    <strong>{renderer.name}</strong>
                    <span>{renderer.status === 'ready' ? 'Ready' : 'Planned'}</span>
                  </div>
                </div>
              ))}
              {voicebank ? (
                <div className="engine-row">
                  <span className="status-dot ready"></span>
                  <div>
                    <strong>{voicebank.name}</strong>
                    <span>Imported UTAU samples</span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </aside>

        <section className="editor-area">
          <div className="timeline-header">
            <div>
              <h1>{project.name}</h1>
              <p>pattern 00 · {project.notes.length} notes · {beatCount} beats · {barCount} bars</p>
            </div>
            <button type="button" className="icon-text-button" onClick={downloadUstx}>
              <FileDown size={18} aria-hidden="true" />
              <span>프로젝트</span>
            </button>
          </div>

          <div className="tracker-strip" aria-label="Tracker status">
            <div>
              <span>PAT</span>
              <strong>00</strong>
            </div>
            <div>
              <span>CH</span>
              <strong>01 VOC</strong>
            </div>
            <div>
              <span>BPM</span>
              <strong>{project.bpm}</strong>
            </div>
            <div>
              <span>ROWS</span>
              <strong>{rows.length}</strong>
            </div>
            <div>
              <span>BANK</span>
              <strong>{voicebank ? 'UTAU ZIP' : 'DEMO'}</strong>
            </div>
            <div>
              <span>OUT</span>
              <strong>{rendered ? 'WAV READY' : 'ARMED'}</strong>
            </div>
          </div>

          <div className="mobile-mascot-banner">
            <img src={cyberVocalHero} alt="" aria-hidden="true" />
            <div>
              <span>CYBER TRACKER CLUB</span>
              <strong>도히도히 다이스키</strong>
            </div>
          </div>

          <div className="mobile-note-strip" aria-label="Mobile note selector">
            {project.notes.map((note) => (
              <button
                type="button"
                key={note.id}
                className={note.id === selectedNote?.id ? 'active' : ''}
                onClick={() => selectNote(note)}
              >
                <strong>{note.lyric}</strong>
                <span>{toneName(note.tone)}</span>
              </button>
            ))}
          </div>

          <div className="lyric-pads" aria-label="Quick lyric painter">
            {LYRIC_PALETTE.map((lyric) => (
              <button
                type="button"
                key={lyric}
                className={lyric === paintLyric ? 'active' : ''}
                onClick={() => chooseLyric(lyric)}
              >
                {lyric}
              </button>
            ))}
          </div>

          <div className="arrangement-panel">
            <div className="ruler-head">Pat 00</div>
            <div className="ruler-scroll">
              <div className="ruler-grid" style={{ width: gridWidth }}>
                {Array.from({ length: barCount }, (_, bar) => (
                  <span key={bar} style={{ left: bar * project.beatPerBar * TICKS_PER_BEAT * TICK_WIDTH }}>
                    {bar + 1}
                  </span>
                ))}
              </div>
            </div>
            <div className="track-lane-head">
              <Mic2 size={17} aria-hidden="true" />
              <div>
                <strong>CH 01 Vocal</strong>
                <span>{voicebankName}</span>
              </div>
            </div>
            <div className="track-lane-scroll">
              <div className="track-lane-grid" style={{ width: gridWidth }}>
                {Array.from({ length: beatCount + 1 }, (_, beat) => (
                  <div
                    className={`beat-line ${beat % project.beatPerBar === 0 ? 'bar' : ''}`}
                    key={beat}
                    style={{ left: beat * TICKS_PER_BEAT * TICK_WIDTH }}
                  />
                ))}
                <div className="vocal-region" style={{ width: Math.max(220, projectDurationTicks(project) * TICK_WIDTH) }}>
                  {project.notes.map((note) => (
                    <span key={note.id}>{note.lyric}</span>
                  ))}
                </div>
                <div className="playhead-line arrangement" style={{ left: playheadLeft }} />
              </div>
            </div>
          </div>

          <div className="editor-toolbar">
            <div>
              <strong>Tracker Piano Grid</strong>
              <span>{selectedNoteLabel}</span>
            </div>
            <div className="editor-chips">
              <span>{rows.length} rows</span>
              <span>CH 01</span>
              <span>{voicebank ? 'UTAU vocal bank' : 'Demo cyber synth'}</span>
            </div>
          </div>

          <div className="piano-roll-frame">
            <div className="keyboard" style={{ height: gridHeight }}>
              {rows.map((tone) => (
                <div className={`key-row ${isBlackKey(tone) ? 'black' : 'white'}`} key={tone}>
                  <span className="key-label">{toneName(tone)}</span>
                </div>
              ))}
            </div>
            <div className="roll-scroll">
              <div
                className="roll-grid"
                style={{ width: gridWidth, height: gridHeight }}
                onClick={handleGridClick}
              >
                {rows.map((tone, rowIndex) => (
                  <div
                    className={`grid-row ${isBlackKey(tone) ? 'black' : 'white'}`}
                    key={tone}
                    style={{ top: rowIndex * ROW_HEIGHT }}
                  />
                ))}
                {Array.from({ length: Math.ceil(songTicks / TICKS_PER_BEAT) + 1 }, (_, beat) => (
                  <div
                    className={`beat-line ${beat % project.beatPerBar === 0 ? 'bar' : ''}`}
                    key={beat}
                    style={{ left: beat * TICKS_PER_BEAT * TICK_WIDTH }}
                  />
                ))}
                <div className="playhead-line" style={{ left: playheadLeft }} />
                {project.notes.map((note) => {
                  const row = range.max - note.tone
                  const selected = note.id === selectedNote?.id
                  return (
                    <button
                      type="button"
                      key={note.id}
                      className={`note-block ${selected ? 'selected' : ''}`}
                      style={{
                        left: note.start * TICK_WIDTH,
                        top: row * ROW_HEIGHT + 3,
                        width: Math.max(MIN_NOTE_WIDTH, note.duration * TICK_WIDTH - 4),
                      }}
                      onClick={() => selectNote(note)}
                    >
                      <span>{note.lyric}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="bottom-dock">
            <audio
              className="hidden-audio"
              ref={audioRef}
              src={rendered?.url}
              onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)}
              onEnded={() => {
                setIsPlaying(false)
                setPlaybackTime(0)
              }}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
            />
            <div className="dock-status">
              <span className={`status-dot ${rendered ? 'ready' : 'idle'}`}></span>
              <div>
                <strong>{notice}</strong>
                <span>{voicebankName}</span>
              </div>
            </div>
            <div className="playhead-meter">
              <div
                className="playhead-fill"
                style={{
                  width: `${displayDuration > 0 ? Math.min(100, (playbackTime / displayDuration) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="export-summary">
              <strong>{rendered ? rendered.fileName : 'WAV not rendered yet'}</strong>
              <span>{rendered ? `${rendered.durationSeconds.toFixed(1)} sec` : '44.1 kHz mono export'}</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  )
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

function isBlackKey(tone: number) {
  return [1, 3, 6, 8, 10].includes(((tone % 12) + 12) % 12)
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00'
  }
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
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

export default App
