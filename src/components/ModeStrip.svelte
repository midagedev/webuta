<script lang="ts">
  import { Gauge, Mic, Scissors, Wand2 } from '@lucide/svelte'
  import cyberVocalHero from '../assets/cyber-vocal-hero.webp'
  import { formatVoicebankCoverage } from '../app/ui'
  import type { WorkspaceMode } from '../types'
  import type { LoadedVoicebank, VoicebankCoverage } from '../voicebank'

  type Props = {
    activeMode: WorkspaceMode
    voicebankName: string
    voicebank: LoadedVoicebank | null
    voicebankCoverage: VoicebankCoverage | null
    notice: string
    onMode: (mode: WorkspaceMode) => void
  }

  let { activeMode, voicebankName, voicebank, voicebankCoverage, notice, onMode }: Props = $props()
</script>

<nav class="mode-strip" aria-label="Workspace sections">
  <div class="brand-block">
    <div class="brand-mark">
      <img src={cyberVocalHero} alt="" aria-hidden="true" />
    </div>
    <div>
      <p class="eyebrow">CYBER TRACKER CLUB</p>
      <strong>WebUtau // {voicebankName}</strong>
    </div>
  </div>
  <div class="mode-tabs">
    <button type="button" class={`mode-tab ${activeMode === 'compose' ? 'active' : ''}`} onclick={() => onMode('compose')}>
      <Wand2 size={17} aria-hidden="true" />
      <span>Compose</span>
    </button>
    <button type="button" class={`mode-tab ${activeMode === 'pattern' ? 'active' : ''}`} onclick={() => onMode('pattern')}>
      <Mic size={17} aria-hidden="true" />
      <span>Pattern</span>
    </button>
    <button type="button" class={`mode-tab ${activeMode === 'rows' ? 'active' : ''}`} onclick={() => onMode('rows')}>
      <Scissors size={17} aria-hidden="true" />
      <span>Rows</span>
    </button>
    <button type="button" class={`mode-tab ${activeMode === 'mixer' ? 'active' : ''}`} onclick={() => onMode('mixer')}>
      <Gauge size={17} aria-hidden="true" />
      <span>Mixer</span>
    </button>
  </div>
  <div class="session-chip">
    <span class={`status-dot ${voicebank ? 'ready' : 'idle'}`}></span>
    <span>{voicebank ? formatVoicebankCoverage(voicebankCoverage) : notice}</span>
  </div>
</nav>
