# WebUtau Overnight Checklist

Goal: build toward a full OpenUtau web port whose first usable path lets a beginner make a synthesized vocal line directly in the browser.

## Product Promise

- [ ] Beginner-friendly vocal editor works on touch and desktop browsers.
- [ ] A project can be created without reading OpenUtau documentation.
- [ ] Notes can be edited with lyric, pitch, duration, and tempo controls.
- [ ] WAV render is 44.1 kHz PCM and suitable for common DAW import.
- [ ] USTX import/export keeps a bridge to OpenUtau projects.
- [ ] Rendering engine boundary can later swap the demo renderer for OpenUtau-compatible synthesis.
- [ ] License boundaries are documented before bundling any singer, model, or external engine.
- [ ] Kasane Teto UTAU works through a user-imported official OpenUTAU zip, not a bundled copy.
- [x] Completion requires a local smoke test with the official `TETO-OUset240323.zip` test asset.

## Tonight's Implemented Slice

- [x] Scaffold Svelte/Vite/TypeScript app.
- [x] Add USTX YAML/JSON parser for modern OpenUtau project shape.
- [x] Add USTX export for round-tripping simple vocal projects.
- [x] Add touch-friendly first-screen editor with project actions, note editor, and piano roll.
- [x] Add browser-safe demo vocal renderer.
- [x] Make the built-in demo voice Hangul-aware for Korean guide vocal sketches without a ZIP.
- [x] Add WAV encoder and download path.
- [x] Add renderer registry for future OpenUtau server and WORLDLINE WASM engines.
- [x] Add unit tests for parsing, rendering, and WAV output.
- [x] Add a Kasane Teto UTAU entry point that links to the official download page and accepts a user-selected zip.
- [x] Add a non-redistributed `test-assets/` workflow and `npm run asset:teto` downloader for the official test zip.
- [x] Add explicit `npm run test:teto` verification for the official zip.
- [x] Use the official Teto zip to render at least one WAV through the browser app.

## Verification Evidence

- [x] `npm test` passes.
- [x] `npm run build` passes.
- [x] `npm run test:teto` passes against local official `TETO-OUset240323.zip`.
- [x] Official Teto zip covers the built-in Korean demo line with `8/8 matched` alias coverage.
- [x] Built-in `Korean Demo Voice` decomposes Hangul syllables into onset/vowel/coda profiles.
- [x] Playwright browser smoke imported the official zip and downloaded `First-Vocal-Sketch.wav`.
- [x] Generated WAV inspected as RIFF/WAVE PCM, 16-bit, mono, 44100 Hz.
- [x] App UI re-inspects rendered WAV headers and marks compatible output as DAW-ready.
- [x] App UI shows whether the imported voicebank is saved locally, restored locally, or session-only.
- [x] Runtime npm dependency notices generated in `docs/THIRD_PARTY_NOTICES.md`.
- [x] Manual WAV/DAW verification checklist added in `docs/WAV_DAW_QA.md`.
- [ ] Physical device share/download and target DAW import confirmed by a human.

## Full Port Workstreams

- [ ] OpenUtau Core parity: commands, tempo map, pitch curves, vibrato, expressions, and phonemizer behavior.
- [ ] Voicebank management: zip import, browser storage, singer metadata, sample preview, and license display.
- [ ] Kasane Teto UTAU support: parse the official OpenUTAU library zip, read `character.yaml` / `oto.ini`, and route Japanese lyrics through the compatible phonemizer.
- [ ] Classic synthesis: WORLDLINE native bridge via server first, then WASM if practical.
- [ ] AI synthesis: DiffSinger/ENUNU through a server renderer first because browser model size and ONNX compatibility are product risks.
- [ ] Plugin compatibility: replace arbitrary EXE execution with a sandboxed web plugin API.
- [ ] WAV handoff workflow: test browser download/share and DAW import on physical hardware.
- [ ] Accessibility and youth UX: large touch targets, simple labels, clear recoverable states, and no destructive default actions.
- [ ] Security: scan uploaded voicebanks, isolate server render jobs, and never execute user-provided binaries in a shared worker.
