<script lang="ts">
  import { Check, Music2, Sparkles, Wand2 } from '@lucide/svelte'
  import type { ComposerMood, MelodySuggestion } from '../composer'
  import { formatChordLine } from '../composer'
  import { toneName } from '../music'
  import { inputValue } from '../app/ui'

  type Props = {
    lyrics: string
    mood: ComposerMood
    suggestion: MelodySuggestion | null
    onLyrics: (lyrics: string) => void
    onMood: (mood: ComposerMood) => void
    onGenerate: () => void
    onApply: () => void
  }

  let { lyrics, mood, suggestion, onLyrics, onMood, onGenerate, onApply }: Props = $props()

  const previewNotes = $derived(suggestion?.notes.slice(0, 16) ?? [])
  const chordPreview = $derived(suggestion ? formatChordLine(suggestion.chords.slice(0, 8)) : '')
</script>

<section class="composer-panel" aria-label="Compose mode">
  <div class="composer-head">
    <div>
      <p class="project-kicker">Compose Mode</p>
      <h2>가사로 멜로디 만들기</h2>
    </div>
    <Sparkles size={22} aria-hidden="true" />
  </div>

  <div class="composer-form">
    <label class="composer-lyrics">
      <span>입력 가사</span>
      <textarea
        rows="3"
        value={lyrics}
        placeholder="도히도히 다이스키"
        oninput={(event) => onLyrics(inputValue(event))}
      ></textarea>
    </label>
    <div class="composer-controls">
      <label>
        <span>무드</span>
        <select value={mood} onchange={(event) => onMood(inputValue(event) as ComposerMood)}>
          <option value="bright">Bright Pop</option>
          <option value="citypop">City Pop</option>
          <option value="minor">Minor Night</option>
        </select>
      </label>
      <button type="button" class="composer-action" onclick={onGenerate}>
        <Wand2 size={18} aria-hidden="true" />
        <span>멜로디 생성</span>
      </button>
      <button type="button" class="composer-action primary" onclick={onApply} disabled={!suggestion}>
        <Check size={18} aria-hidden="true" />
        <span>멜로디 적용</span>
      </button>
    </div>
  </div>

  {#if suggestion}
    <div class="composer-results">
      <div class="composer-summary">
        <div>
          <span>BPM</span>
          <strong>{suggestion.bpm}</strong>
        </div>
        <div>
          <span>코드</span>
          <strong>{chordPreview}</strong>
        </div>
        <div>
          <span>노트</span>
          <strong>{suggestion.notes.length}</strong>
        </div>
      </div>

      <div class="chord-lane" aria-label="Chord progression">
        {#each suggestion.chords.slice(0, 8) as chord (chord.start)}
          <span>{chord.symbol}</span>
        {/each}
      </div>

      <div class="melody-lane" aria-label="Generated melody preview">
        <Music2 size={18} aria-hidden="true" />
        <div>
          {#each previewNotes as note (note.id)}
            <span>
              <strong>{note.lyric}</strong>
              <em>{toneName(note.tone)}</em>
            </span>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</section>
