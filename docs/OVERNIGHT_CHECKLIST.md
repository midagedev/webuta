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
- [x] Add native `.webutau.json` project save/import for browser-native work.
- [x] Add touch-friendly first-screen editor with project actions, note editor, loop controls, and piano roll.
- [x] Add browser-safe demo vocal renderer as fallback.
- [x] Add bundled `WebUtau Korean V3 Synthetic` UTAU-style voicebank for the default path.
- [x] Add Hangul CV alias fallback so final-consonant syllables can use their base CV sample.
- [x] Add WAV encoder and download path.
- [x] Add renderer registry for future OpenUtau server and WORLDLINE WASM engines.
- [x] Add unit tests for parsing, rendering, and WAV output.
- [x] Add a Kasane Teto UTAU entry point that links to the official download page and accepts a user-selected zip.
- [x] Add selected-note UTAU sample preview so a loaded singer can be auditioned
  without rendering the whole song.
- [x] Add browser-side voicebank zip safety checks for oversized packages,
  unsafe paths, abnormal file counts, and oversized WAV/oto members.
- [x] Add UTAU `prefix.map` parsing so imported multipitch voicebanks can select
  pitch-specific alias prefixes/suffixes.
- [x] Add current voicebank license/readme metadata display for bundled V3 and
  user-imported UTAU zips.
- [x] Add a non-redistributed `test-assets/` workflow and `npm run asset:teto` downloader for the official test zip.
- [x] Add explicit `npm run test:teto` verification for the official zip.
- [x] Use the official Teto zip to render at least one WAV through the browser app.

## Verification Evidence

- [x] `npm test` passes.
- [x] `npm run build` passes.
- [x] `npm run test:teto` passes against local official `TETO-OUset240323.zip`.
- [x] Official Teto zip covers the built-in Korean demo line with `8/8 matched` alias coverage.
- [x] Bundled `WebUtau Korean V3 Synthetic` contains 615 WAV samples and 1437 oto.ini alias lines.
- [x] Built-in `도히도히 다이스키` demo aliases are present in the bundled Korean V3 voicebank.
- [x] Playwright browser smoke imported the official zip and downloaded `First-Vocal-Sketch.wav`.
- [x] Default V3 demo browser audit passes: V3 selected, aliases 8/8 matched,
  render warnings clear, piano-roll key/ruler labels visible on desktop/mobile,
  and WAV export DAW-ready.
- [x] Deployed GitHub Pages app passes the same first-run V3 browser audit and
  live WAV download check.
- [x] V3 listening review pack generated with first-run, batchim, CV, and vowel
  WAV phrases for human scoring.
- [x] GitHub Pages audit verifies all 8 deployed V3/V2 review WAVs load and
  match local byte sizes.
- [x] Generated WAV inspected as RIFF/WAVE PCM, 16-bit, mono, 44100 Hz.
- [x] App UI re-inspects rendered WAV headers and marks compatible output as DAW-ready.
- [x] App UI shows whether the imported voicebank is saved locally, restored locally, or session-only.
- [x] Unit tests verify unsafe or oversized UTAU zip imports are rejected before
  sample parsing/playback.
- [x] App/browser tests verify the active voicebank license metadata card is visible.
- [x] WebUtau project file tests verify native JSON export/import round-trips.
- [x] Runtime npm dependency notices generated in `docs/THIRD_PARTY_NOTICES.md`.
- [x] Manual WAV/DAW verification checklist added in `docs/WAV_DAW_QA.md`.
- [x] App tests cover selected-note split/delete controls and selected-note loop region display.
- [x] App tests cover selected-note vibrato controls; project/USTX tests verify
  vibrato round-trip, and renderer tests verify vibrato changes rendered audio.
- [x] App tests verify selected-note preview uses the loaded UTAU sample renderer.
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
