# WebUtau Korean V3 UTAU Workplan

Research snapshot: 2026-07-01

Goal: replace the low-quality `WebUtau Korean V2` default with a community-release-ready
`WebUtau Korean V3` UTAU-format voicebank and make the browser editor good enough
to use as a small vocal-synth DAW.

Hard constraint: the user will not provide singer recordings, and the project
must not ask the user's family to record a voice. V3 must therefore be generated
by WebUtau tooling itself. The primary V3 path is a fully synthetic, original
DSP-generated singer, not a recorded singer, not a public/private
dataset-derived voice, and not a cloned third-party voice.
Any private-recording scripts in the repo are inactive historical/prototype
tooling for other experiments, not the path for this V3 goal.

## Product Goal

WebUtau V3 is successful when a new visitor can:

1. Open the web app and hear a good default Korean vocal sketch immediately.
2. Edit notes and lyrics in a Vocaloid-style piano-roll workflow.
3. Render an imported or bundled UTAU-format voicebank without clipped attacks,
   repeated codas, broken sustain loops, or fallback-note surprises.
4. Download a DAW-ready WAV.
5. Inspect singer/license terms before sharing the app or generated assets.

## Research Conclusion

With no singer recordings available and no user-provided voice material allowed,
the best path is a fully generated, license-clean synthetic UTAU voicebank:

- Generate a controlled Korean CV/VC/multipitch voicebank from deterministic
  DSP synthesis.
- Package it as normal UTAU material: WAV samples, `oto.ini`, `character.yaml`,
  `readme.txt`, and `license.txt`.
- Use analysis tools for assistance: F0 diagnostics, loop diagnostics, oto
  validation, and optional neural alignment/re-synthesis experiments.
- Keep neural systems and public datasets as QA/research tooling, not as the
  default source of the voice, unless a future separate release explicitly
  changes the product goal and clears model, dataset, singer identity, and
  generated-audio rights.

This is better than the current V2 path because V2 is generated/procedural/TTS-like
and has weak singing sustain, unstable pronunciation, and unclear public-release
comfort for a community default. It is better than extracting public speech
datasets because speech corpora are not sung, often mix many speakers, do not
naturally contain stable musical vowels, and would make the default singer
dataset-derived rather than original. It is safer than public neural singing
datasets because many useful datasets are research-only or noncommercial.

An original recorded V3 is out of scope for the active goal. If a future
contributor explicitly provides consent-reviewed recordings, that can become a
separate optional track, but this plan must be completable without asking the
user or their family to record a voice.

## Source Notes

- OpenUtau describes itself as a free editor for the UTAU community and lists
  feature-rich MIDI editing, vibrato editing, pre-rendering, selective UTAU
  compatibility, phonemizers including CVVC/Korean, and WORLDLINE-R resampling:
  https://github.com/openutau/OpenUtau
- MakeDiffSinger is useful as dataset tooling and documents a dataset structure
  built from WAVs plus transcriptions, but this is a neural dataset path rather
  than a direct UTAU voicebank release path:
  https://github.com/openvpi/MakeDiffSinger
- NNSVS can create voicebanks from a dataset, but its docs frame it as a neural
  singing voice synthesis library and research-friendly toolkit:
  https://nnsvs.github.io/
- OpenSLR Zeroth-Korean is CC BY 4.0 and useful for pronunciation/prototype
  tooling, but it is a speech corpus, not a singing voicebank source:
  https://www.openslr.org/40/
- CC BY 4.0 allows sharing/adaptation, including commercial use, but requires
  attribution and does not remove possible publicity/privacy concerns:
  https://creativecommons.org/licenses/by/4.0/
- Mozilla Common Voice material is commonly released under CC0, useful for
  pronunciation experiments, but still speech-first and not a high-quality
  default singing voicebank by itself.

## Method Decision Matrix

| Method | Quality ceiling | License/public release | Fit for V3 default | Decision |
| --- | --- | --- | --- | --- |
| V2 procedural/formant generation | Very low | Clean | Poor | Keep only as fallback/test fixture |
| Current Supertonic/TTS V2 | Low to medium | Needs model-output review | Poor | Retire as legacy |
| Public speech corpus slicing | Low for singing | CC0/CC BY candidates exist | Poor and dataset-derived | Pronunciation QA/prototypes only |
| Public singing dataset to UTAU samples | Medium risk | Often NC/SA/research | Not for this default | Separate future voice only |
| Neural model renders to UTAU samples | Potentially high | Complex model/dataset/singer rights | Tool only, not default source | Use for alignment or private experiments |
| Original consent-recorded UTAU | High | Clean if release signed | Good if available | Secondary fallback |
| Fully synthetic DSP UTAU V3 | Medium but controllable | Clean | Best under no-recording constraint | Primary V3 path |

## V3 Voicebank Target

V3 should ship as a conventional UTAU zip selected by default on first launch.

Minimum community target:

- One clearly named synthetic singer: `WebUtau Korean V3 Synthetic`.
- One consistent generated voice identity, not mixed speakers and not a cloned
  singer.
- 44.1 kHz or 48 kHz mono WAV source, packaged for browser playback.
- At least three pitch layers for core coverage: low, mid, high.
- Korean CV coverage for Hangul onset+vowel units.
- Korean coda and VC tail coverage for common batchim.
- Stable vowel sustain regions long enough for musical notes.
- `oto.ini` fields audited: offset, consonant, cutoff, preutterance, overlap.
- License file with explicit redistribution and generated-audio permission.

Recommended coverage shape:

- `CV`: 19 onsets * 21 vowels = 399 aliases per pitch.
- `V`: 21 pure vowel sustain aliases per pitch.
- `VC/coda`: 21 vowels * common codas first, then full coda expansion.
- `demo-priority`: 도, 히, 다, 이, 스, 키, 연, 하, 나, 라, 마, 사.
- `multipitch`: C4, F4, A4 for first public V3; add lower pitch later if needed.

## Work Checklist

### M0. Product Baseline

- [x] Reset the project goal to UTAU-first community release.
- [x] Keep the first-run demo lyric as `도히도히 다이스키`.
- [x] Rename V2 in UI/docs as legacy once V3 artifacts exist.
- [x] Add an app-visible current project/title indicator and a real New Project
  flow if still missing from the browser UI.
- [x] Ensure the default renderer is the bundled UTAU sample renderer, not the
  procedural browser demo.

### M1. V3 Rights And Release Gate

- [x] Choose generated singer identity: `WebUtau Korean V3 Synthetic`.
- [x] Avoid human recordings, voice cloning, third-party singer likenesses, and
  TTS/model outputs in the default V3 artifact.
- [x] Avoid public/private recorded dataset source audio in the default V3
  artifact; datasets may only support QA/research for this goal.
- [x] Add a release audit gate that blocks V3 if the bundled zip does not prove
  no-recording synthetic origin through its manifest, readme, and license.
- [x] Decide that generated user audio may be used freely without third-party
  singer endorsement.
- [x] Add final `license.txt` inside the V3 zip.
- [x] Add singer/license display in the app before V3 becomes the default.
- [x] Keep source-generation scripts and V3 zip manifest in sync.

### M2. Synthetic V3 Generator

- [x] Add `voicebank:v3` script to generate a fully synthetic V3 UTAU zip.
- [x] Generate Korean CV coverage for three pitch layers.
- [x] Generate pure vowel and VC/coda support samples for renderer evolution.
- [x] Generate exact demo-priority coda samples such as `연`.
- [x] Include deterministic `oto.ini`, `character.yaml`, `readme.txt`,
  `license.txt`, and `webuta-ko-v3.manifest.json`.
- [ ] Run listening review and tune consonant/noise/formant profiles.
- [x] Add sample-quality audit for package files, aliases, silence, clipping,
  RMS, and WAV consistency.
- [x] Add F0/pitch-stability audit for generated sample bodies.
- [x] Generate the first web-profile `webuta-ko-v3.zip`: 615 samples, 1437 aliases,
  about 46 MB.
- [x] Make `webuta-ko-v3.zip` the bundled voicebank selected on first launch.
- [ ] Run browser smoke and listening review before calling V3 community-ready.

### M3. Sample Processing

- [x] Add F0 diagnostics for generated vowel body stability.
- [x] Add loop candidate detection for each sustained vowel.
- [x] Add generated oto validation from known attack/body/release regions.
- [x] Add batch normalization to consistent peak targets inside the generator.
- [x] Add per-sample diagnostic JSON.
- [x] Add a no-recording sample review report for hard flags, pitch/loop
  watchlists, and listening-review phrase priority.

### M4. UTAU Pack Builder

- [x] Build `webuta-ko-v3.zip` from generated WAVs and reviewed oto metadata.
- [x] Include `oto.ini`, `character.yaml`, `readme.txt`, `license.txt`, and
  `webuta-ko-v3.manifest.json`.
- [x] Add deterministic zip generation and cache-busting version updates.
- [x] Add a voicebank integrity test that loads the zip and verifies alias
  coverage.
- [ ] Keep V2 available only as fallback until V3 passes listening review.

### M5. Browser UTAU Renderer

- [x] Parse `oto.ini` and imported UTAU zips in the browser.
- [x] Preserve note attack when preutterance starts before time zero.
- [x] Use coda-aware loop/release handling so final consonants do not repeat.
- [x] Add VC/coda tail resolution when a Hangul batchim lyric falls back to its
  CV alias.
- [x] Add crossfade diagnostics for loop discontinuities.
- [x] Add pitch-layer selection by target MIDI note and alias.
- [x] Add per-note render warnings for fallback, missing alias, or extreme pitch shift.
- [x] Verify imported Teto and bundled V3 both render without regressions.

### M6. Vocal-Synth DAW Workflow

- [x] Make project name, selected voicebank, renderer, BPM, and render status
  visible at all times.
- [x] Add New Project / Duplicate / Reset Demo actions.
- [x] Add note draw, drag, resize, split, delete, undo, redo, and lyric apply
  flows that work on mobile and desktop.
- [x] Add piano keyboard and beat/bar ruler that remain readable on mobile.
- [x] Add transport controls: play, stop, loop, metronome toggle, BPM edit,
  render, download, share.
- [x] Add project save/load/export/import.
- [x] Keep WAV export DAW-ready: RIFF/WAVE, PCM, 16-bit, mono, 44.1 kHz.

### M7. First-Run Musical Quality

- [x] Improve the default melody beyond a test scale: the built-in
  `도히도히 다이스키` phrase now uses an E-G-E-A-G-A-F-E hook-shaped contour
  that stays within safe imported-voicebank pitch-shift bounds.
- [x] Ensure the default phrase uses aliases that exist in V3.
- [x] Render default demo to WAV and archive diagnostics.
- [x] Generate browser-rendered V2/V3 comparison WAVs and require V3 to score
  clearly better than legacy V2 in the release audit.
- [x] Add an offline listening scorecard that plays generated V3 WAVs and
  exports the `listening-scores.local.json` expected by the release audit,
  without asking anyone to record a voice.
- [ ] Collect human listening scores for the V3 phrases and V2/V3 comparison
  fields; do not synthesize or fake these reviewer scores.
- [ ] Add screenshots and README copy that match the final UI.

### M8. Community Release Gate

- [x] `npm run voicebank:v3` writes the default synthetic V3 zip.
- [x] `npm run voicebank:audit-v3` passes on the default synthetic V3 zip.
- [x] `npm run voicebank:oto-v3` passes on the default synthetic V3 zip.
- [x] `npm run voicebank:pitch-v3` passes on the default synthetic V3 zip.
- [x] V3 zip passes generated voicebank integrity test.
- [x] `npm test` passes.
- [x] `npm run lint` passes.
- [x] `npm run build` passes.
- [x] Browser smoke passes on desktop and mobile widths.
- [x] V3 processed samples pass package/WAV sample-quality audit.
- [x] V3 sustained CV/V samples pass loop/crossfade audit.
- [x] V3 sample review preflight report passes with zero hard sample flags.
- [x] README includes screenshots, license notes, and honest limitations.
- [x] Release audit checks the bundled V3 zip for no-recording synthetic-origin
  evidence.
- [x] GitHub Pages deployment loads the V3 default zip with a cache-busted URL.
- [ ] `npm run release:audit-utau -- --pages-url https://midagedev.github.io/webuta/`
  passes.

## Working Commands

```sh
npm run voicebank:v3-kit
npm run voicebank:v3
npm run voicebank:audit-v3
npm run voicebank:demo-v3
npm run voicebank:oto-v3
npm run voicebank:loop-v3
npm run voicebank:pitch-v3
npm run voicebank:review-v3
npm run voicebank:sample-review-v3
npm run release:audit-utau
npm run release:audit-utau -- --pages-url https://midagedev.github.io/webuta/
npm test -- scripts/audit-default-demo-render.test.mjs
npm test -- scripts/audit-utau-community-release.test.mjs
npm test -- scripts/generate-korean-v3-synthetic-voicebank.test.mjs
npm test -- scripts/audit-korean-v3-voicebank.test.mjs
npm test -- scripts/audit-korean-v3-oto.test.mjs
npm test -- scripts/analyze-korean-v3-loops.test.mjs
npm test -- scripts/analyze-korean-v3-pitch.test.mjs
npm test -- scripts/prepare-utau-v3-listening-review.test.mjs
npm test -- scripts/prepare-utau-v3-recording-kit.test.mjs
npm test -- src/voicebank.test.ts src/renderers/utauSampleRenderer.test.ts
npm run lint
npm run build
```

## Current Status

V3 is now the app's bundled default, live on GitHub Pages, and protected by a
no-recording synthetic-origin release gate. It is still an early synthetic web
profile, and human listening review remains required before treating it as
community-ready.

Current verified V3 evidence:

- `npm run voicebank:v3` generated `public/voicebanks/webuta-ko-v3.zip`.
- Default web profile: 615 WAV samples, 1437 oto aliases, 47944410 bytes.
- `src/bundledVoicebank.ts` selects `webuta-ko-v3.zip` with cache-busting
  version `20260701-v3-synthetic-web-2`.
- `npm run voicebank:audit-v3` passes on the default zip: all 615 WAV files
  audited, zero WAV problems, required package files present, no missing sample
  references.
- `npm run voicebank:oto-v3` passes on the default zip: 615/615 manifest
  samples audited against `oto.ini`, 1437 oto entries checked, and zero timing
  or alias contract problems.
- `npm run voicebank:demo-v3` passes in Chromium: bundled V3 is loaded,
  first-run aliases match 8/8, render warnings are clear, the lyric line is
  visible, desktop/mobile overflow checks pass, and the exported WAV is 44.1 kHz
  mono 16-bit PCM, 6.56 seconds, 578384 bytes.
- The default `도히도히 다이스키` melody is now E-G-E-A-G-A-F-E rather than a
  straight ascending test scale; regression tests pin this contour in the app
  fixture and listening-review pack.
- `npm run voicebank:review-v3` prepares a browser-rendered listening review
  pack at `experiments/utau-v3/work/v3-listening-review/`: 4 V3 WAV phrases
  covering first-run demo, batchim release, common CV attacks, and vowel color,
  plus 4 legacy V2 baseline comparison WAVs when `webuta-ko-lite.zip` is
  present. All 8 WAVs pass 44.1 kHz mono 16-bit WAV gates. The generated
  `index.html` is now an offline scorecard that lets a reviewer enter 1-5 V3
  phrase scores, V2/V3 preference scores, and download the
  `listening-scores.local.json` required by `npm run release:audit-utau`.
  Human listening scores are still required before community-ready release.
- The offline scorecard has Playwright regression tests that fill all score
  controls, generate JSON, verify the no-recording review metadata, and ensure
  V2/V3 comparison scores are exported.
- `npm run voicebank:pitch-v3` passes on the default zip: 615/615 samples
  audited, maximum median pitch error about 4.5 cents, maximum body drift about
  10.3 cents, and minimum median F0 confidence about 0.984.
- `npm run voicebank:loop-v3` passes on the default zip: 432/432 CV/V sustain
  samples audited, maximum loop residual ratio about 0.059, maximum seam jump
  about 0.093.
- `npm run voicebank:sample-review-v3` passes and writes
  `experiments/utau-v3/work/v3-sample-review-report.{md,json}`: package, oto,
  pitch, loop, and listening-review inputs all pass; hard sample flags are 0;
  the report lists 8 pitch watchlist samples, 8 loop watchlist samples, and 4
  V3/V2 listening-review phrases without asking anyone to record a voice.
- Browser renderer can resolve a Hangul coda lyric through CV plus VC tail
  overlay when an exact CVC sample is unavailable.
- Browser renderer now prefers CV sustain plus VC tail for Hangul coda lyrics
  even when an exact CVC alias exists, so CVC release consonants are not looped
  through long notes.
- The left rail surfaces per-note render warnings for missing aliases, missing
  Hangul coda tails, and extreme sample pitch shifts before WAV render.
- Browser renderer selects the closest explicit pitch layer for the requested
  note tone; generated V3 tests verify `도` resolves to C4/F4/A4 layers.
- Browser top bar now separates New Project, Duplicate Project, and Reset Demo
  so the built-in song and a fresh sketch are not the same action.
- Native `.webutau.json` project files now round-trip through the browser, while
  USTX import/export remains available for OpenUtau handoff.
- DAW editing controls now cover draw, drag, resize, split, delete, lyric line
  apply, undo, and redo. The transport includes play, stop, loop playback,
  metronome toggle, BPM edit, render, download, and share.
- App code now names the bundled default as `BUNDLED_UTAU_VOICEBANK_*` instead
  of the older `KOREAN_LITE` default path; the old exports remain only as
  compatibility aliases. V2/Supertonic docs are marked legacy.
- `npm run test:teto` passes against the ignored official
  `test-assets/TETO-OUset240323.zip`: 2 tests pass, the official zip loads,
  Japanese/Korean alias mappings resolve, and the built-in Korean demo renders
  through the UTAU sample renderer with bounded non-silent output.
- Browser demo audit verifies the piano keyboard and bar ruler are visible on
  both desktop and mobile widths, with no page-level horizontal overflow.
- Generated-zip integrity test verifies the first-run demo phrase has 8/8
  matched notes and no fallback aliases.
- App tests cover selected-note split/delete controls and selected-note loop
  region display.
- Release audit now inspects `public/voicebanks/webuta-ko-v3.zip` directly and
  requires manifest/readme/license evidence that the default V3 voicebank is
  fully synthetic, DSP-generated, and not recorded, not derived from recorded
  dataset source audio, cloned, or rendered from a third-party TTS/model output.
- Release audit now requires the listening review pack and human score file to
  include four V2/V3 comparison entries, with V3 preference scores of at least
  4/5 before community release.
- Release audit now requires the V3 sample review preflight report to be ready,
  no-recording, and free of hard sample flags before community release.
- `npm run release:audit-utau -- --report experiments/utau-v3/work/community-release-audit.json`:
  blocked only by missing human listening scores and missing Pages deployment
  evidence before deploy; the local synthetic-origin gate passes on the real
  bundled V3 zip.
- `npm run release:audit-utau -- --pages-url https://midagedev.github.io/webuta/ --report experiments/utau-v3/work/community-release-audit-pages.json`:
  must be rerun after the next Pages deployment so the live cache-busted zip
  reports `20260701-v3-synthetic-web-2`; human listening scores are still the
  final release blocker.
- `npm test`: 82 passed / 1 skipped files, 354 passed / 2 skipped tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run smoke:browser -- --out experiments/neural-singer/work/browser-smoke/project-files-v3.json`: passed.
