<script lang="ts">
  import { X } from '@lucide/svelte'

  type Props = {
    onClose: () => void
  }

  let { onClose }: Props = $props()
</script>

<div class="modal-backdrop" role="presentation" onclick={onClose}>
  <div
    class="about-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="about-title"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={(event) => event.key === 'Escape' && onClose()}
  >
    <div class="about-dialog-header">
      <div>
        <p class="eyebrow">LICENSES</p>
        <h2 id="about-title">WebUtau Credits</h2>
      </div>
      <button type="button" class="toolbar-button" title="닫기" onclick={onClose}>
        <X size={19} aria-hidden="true" />
      </button>
    </div>
    <div class="about-dialog-body">
      <section>
        <strong>WebUtau</strong>
        <span>Project code is MIT licensed.</span>
      </section>
      <section>
        <strong>Kasane Teto UTAU</strong>
        <span>Voicebanks are user-provided downloads. No Teto voicebank or singer artwork is bundled.</span>
      </section>
      <section>
        <strong>WebUtau Korean Lite</strong>
        <span>The bundled starter voicebank contains original generated UTAU-style CV samples and metadata.</span>
      </section>
      <section>
        <strong>Artwork</strong>
        <span>The cyber vocal mascot is original project artwork, separate from singer characters.</span>
      </section>
      <section>
        <strong>OpenUtau</strong>
        <span>This browser build does not bundle desktop OpenUtau source or external resampler binaries.</span>
      </section>
      <section>
        <strong>Dependencies</strong>
        <span>Runtime npm notices are generated in docs/THIRD_PARTY_NOTICES.md.</span>
      </section>
      <a href="https://kasaneteto.jp/utau/" target="_blank" rel="noreferrer">Official Teto UTAU</a>
    </div>
  </div>
</div>
