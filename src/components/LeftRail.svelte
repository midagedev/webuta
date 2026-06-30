<script lang="ts">
  import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Plus,
    Scissors,
    Sparkles,
    Trash2,
    Upload,
    Volume2,
  } from '@lucide/svelte'
  import cyberVocalHero from '../assets/cyber-vocal-hero.webp'
  import { GRID_SNAP_TICKS } from '../projectEditing'
  import type { SongNote, SongProject } from '../types'
  import type { LoadedVoicebank, LyricEntryMatch, VoicebankCoverage } from '../voicebank'
  import { rendererCapabilities } from '../renderers/registry'
  import {
    formatCoverageMessage,
    formatLyricMatch,
    formatVoicebankCacheStatus,
    formatVoicebankCoverage,
    inputValue,
    type VoicebankCacheStatus,
  } from '../app/ui'
  import { toneName } from '../music'

  type Props = {
    project: SongProject
    selectedNote: SongNote | undefined
    selectedLyricMatch: LyricEntryMatch | null
    voicebank: LoadedVoicebank | null
    voicebankName: string
    voicebankCoverage: VoicebankCoverage | null
    voicebankCacheStatus: VoicebankCacheStatus
    isLoadingVoicebank: boolean
    notice: string
    onVoicebankFile: (file: File) => Promise<void>
    onBpm: (bpm: number) => void
    onBeat: (beatPerBar: number, beatUnit: number) => void
    onSelectDemoVoice: () => void
    onLyric: (lyric: string) => void
    onTone: (tone: number) => void
    onNudge: (patch: Partial<SongNote>) => void
    onDuration: (duration: number) => void
    onAddNote: () => void
    onDeleteNote: () => void
  }

  let {
    project,
    selectedNote,
    selectedLyricMatch,
    voicebank,
    voicebankName,
    voicebankCoverage,
    voicebankCacheStatus,
    isLoadingVoicebank,
    notice,
    onVoicebankFile,
    onBpm,
    onBeat,
    onSelectDemoVoice,
    onLyric,
    onTone,
    onNudge,
    onDuration,
    onAddNote,
    onDeleteNote,
  }: Props = $props()

  let voicebankInput: HTMLInputElement

  async function handleVoicebankFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
      await onVoicebankFile(file)
    }
    input.value = ''
  }

  function handleBeat(event: Event) {
    const [beatPerBar, beatUnit] = inputValue(event).split('/').map(Number)
    onBeat(beatPerBar, beatUnit)
  }
</script>

<aside class="left-rail">
  <section class="tool-panel pattern-panel">
    <div class="panel-heading">
      <Sparkles size={18} aria-hidden="true" />
      <h2>패턴</h2>
    </div>
    <div class="mascot-card">
      <img src={cyberVocalHero} alt="Cyber vocal synth mascot illustration" />
      <div>
        <strong>Vocal Operator</strong>
        <span>tracker vocal mode</span>
      </div>
    </div>
    <div class="channel-strip">
      <div class="track-avatar">
        <img src={cyberVocalHero} alt="" aria-hidden="true" />
      </div>
      <div class="track-copy">
        <strong>{project.tracks[0]?.name ?? 'Main Vocal'}</strong>
        <span>{voicebankName}</span>
      </div>
      <Volume2 size={18} aria-hidden="true" />
    </div>
    <div class="channel-meter" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span><span></span>
    </div>
    <label class="field-label">
      BPM
      <input type="number" min="60" max="220" value={project.bpm} oninput={(event) => onBpm(Number(inputValue(event)) || 120)} />
    </label>
    <label class="field-label">
      박자
      <select value={`${project.beatPerBar}/${project.beatUnit}`} onchange={handleBeat}>
        <option value="4/4">4/4</option>
        <option value="3/4">3/4</option>
        <option value="6/8">6/8</option>
      </select>
    </label>
    <label class="field-label">
      보컬
      <select value="browser-demo" onchange={onSelectDemoVoice}>
        <option value="browser-demo">{voicebankName}</option>
      </select>
    </label>
    <div class="voicebank-actions">
      <button type="button" class="icon-text-button" onclick={() => voicebankInput?.click()} disabled={isLoadingVoicebank}>
        <Upload size={18} aria-hidden="true" />
        <span>ZIP</span>
      </button>
      <a class="text-link-button" href="https://kasaneteto.jp/utau/" target="_blank" rel="noreferrer">
        Teto UTAU
      </a>
      <input
        bind:this={voicebankInput}
        type="file"
        accept=".zip"
        class="hidden-input"
        onchange={(event) => void handleVoicebankFileChange(event)}
      />
    </div>
    <div class="status-strip">
      <Volume2 size={17} aria-hidden="true" />
      <span>
        {voicebank
          ? `${notice} · ${formatVoicebankCoverage(voicebankCoverage)} · ${voicebank.wavCount} wav · ${formatVoicebankCacheStatus(voicebankCacheStatus)}`
          : notice}
      </span>
    </div>
    <div class={`coverage-card ${voicebankCoverage?.fallbackNotes === 0 ? 'ready' : voicebank ? 'warning' : 'idle'}`} aria-label="Voicebank lyric coverage">
      {#if !voicebank}
        <strong>보이스뱅크 대기</strong>
        <span>도/히/다/이/스/키 alias 검사 준비됨.</span>
        <em>{formatVoicebankCacheStatus(voicebankCacheStatus)}</em>
      {:else if !voicebankCoverage}
        <strong>매칭 검사 중</strong>
        <span>가사와 oto.ini alias를 비교하고 있습니다.</span>
        <em>{formatVoicebankCacheStatus(voicebankCacheStatus)}</em>
      {:else}
        <strong>{formatVoicebankCoverage(voicebankCoverage)}</strong>
        <span>{formatCoverageMessage(voicebankCoverage)}</span>
        <em>{formatVoicebankCacheStatus(voicebankCacheStatus)}</em>
      {/if}
    </div>
  </section>

  <section class="tool-panel note-panel">
    <div class="panel-heading">
      <Scissors size={18} aria-hidden="true" />
      <h2>노트</h2>
    </div>
    {#if selectedNote}
      <div class="note-editor">
        <div class="selected-note-card">
          <span>{selectedNote.lyric}</span>
          <strong>{toneName(selectedNote.tone)}</strong>
        </div>
        <div class={`lyric-match-chip ${selectedLyricMatch?.quality === 'fallback' ? 'warning' : 'ready'}`}>
          {formatLyricMatch(selectedLyricMatch)}
        </div>
        <label class="field-label">
          가사
          <input value={selectedNote.lyric} maxlength="12" oninput={(event) => onLyric(inputValue(event) || '라')} />
        </label>
        <label class="field-label">
          음
          <select value={selectedNote.tone} onchange={(event) => onTone(Number(inputValue(event)))}>
            {#each Array.from({ length: 37 }, (_, index) => 48 + index) as tone (tone)}
              <option value={tone}>{toneName(tone)}</option>
            {/each}
          </select>
        </label>
        <div class="step-row">
          <button type="button" class="small-button" title="앞으로 이동" onclick={() => onNudge({ start: selectedNote!.start - GRID_SNAP_TICKS })}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>앞</span>
          </button>
          <button type="button" class="small-button" title="뒤로 이동" onclick={() => onNudge({ start: selectedNote!.start + GRID_SNAP_TICKS })}>
            <ArrowRight size={16} aria-hidden="true" />
            <span>뒤</span>
          </button>
        </div>
        <div class="step-row">
          <button type="button" class="small-button" title="음 낮게" onclick={() => onNudge({ tone: selectedNote!.tone - 1 })}>
            <ArrowDown size={16} aria-hidden="true" />
            <span>낮게</span>
          </button>
          <button type="button" class="small-button" title="음 높게" onclick={() => onNudge({ tone: selectedNote!.tone + 1 })}>
            <ArrowUp size={16} aria-hidden="true" />
            <span>높게</span>
          </button>
        </div>
        <div class="step-row">
          <button type="button" class="small-button" onclick={() => onDuration(Math.max(120, selectedNote!.duration - 120))}>
            짧게
          </button>
          <button type="button" class="small-button" onclick={() => onDuration(selectedNote!.duration + 120)}>
            길게
          </button>
        </div>
      </div>
    {/if}
    <div class="tool-row">
      <button type="button" class="icon-text-button" onclick={onAddNote}>
        <Plus size={18} aria-hidden="true" />
        <span>추가</span>
      </button>
      <button type="button" class="icon-text-button danger" onclick={onDeleteNote}>
        <Trash2 size={18} aria-hidden="true" />
        <span>삭제</span>
      </button>
    </div>
  </section>

  <section class="tool-panel engine-panel">
    <div class="panel-heading">
      <Upload size={18} aria-hidden="true" />
      <h2>엔진</h2>
    </div>
    <div class="engine-list">
      {#each rendererCapabilities as renderer (renderer.id)}
        <div class="engine-row">
          <span class={`status-dot ${renderer.status}`}></span>
          <div>
            <strong>{renderer.name}</strong>
            <span>{renderer.status === 'ready' ? 'Ready' : 'Planned'}</span>
          </div>
        </div>
      {/each}
      {#if voicebank}
        <div class="engine-row">
          <span class="status-dot ready"></span>
          <div>
            <strong>{voicebank.name}</strong>
            <span>{formatVoicebankCacheStatus(voicebankCacheStatus)}</span>
          </div>
        </div>
      {/if}
    </div>
  </section>
</aside>
