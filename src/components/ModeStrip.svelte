<script lang="ts">
  import { Gauge, Mic, Scissors } from '@lucide/svelte'
  import cyberVocalHero from '../assets/cyber-vocal-hero.webp'
  import { formatVoicebankCoverage } from '../app/ui'
  import type { LoadedVoicebank, VoicebankCoverage } from '../voicebank'

  type Props = {
    voicebankName: string
    voicebank: LoadedVoicebank | null
    voicebankCoverage: VoicebankCoverage | null
    notice: string
  }

  let { voicebankName, voicebank, voicebankCoverage, notice }: Props = $props()
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
    <button type="button" class="mode-tab active">
      <Mic size={17} aria-hidden="true" />
      <span>Pattern</span>
    </button>
    <button type="button" class="mode-tab">
      <Scissors size={17} aria-hidden="true" />
      <span>Rows</span>
    </button>
    <button type="button" class="mode-tab">
      <Gauge size={17} aria-hidden="true" />
      <span>Mixer</span>
    </button>
  </div>
  <div class="session-chip">
    <span class={`status-dot ${voicebank ? 'ready' : 'idle'}`}></span>
    <span>{voicebank ? formatVoicebankCoverage(voicebankCoverage) : notice}</span>
  </div>
</nav>
