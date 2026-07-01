# WebUtau Overnight Checklist

Goal: build toward a community-release-ready UTAU-first browser vocal synth/DAW whose first usable path lets a beginner make a synthesized vocal line directly in the browser.

## Product Promise

- [x] Beginner-friendly vocal editor works on touch and desktop browsers.
- [x] A project can be created without reading OpenUtau documentation.
- [x] Notes can be edited with lyric, pitch, duration, and tempo controls.
- [x] WAV render is 44.1 kHz PCM and suitable for common DAW import.
- [x] UST/USTX import/export keeps a bridge to UTAU/OpenUtau projects.
- [x] Rendering engine boundary can swap between bundled UTAU sample rendering,
  browser fallback synthesis, and planned external/neural renderers.
- [x] License boundaries are documented before bundling any singer, model, or external engine.
- [x] Kasane Teto UTAU works through a user-imported official OpenUTAU zip, not a bundled copy.
- [x] Completion requires a local smoke test with the official `TETO-OUset240323.zip` test asset.
- [ ] Community-ready release still requires accepted human listening scores for
  the V3 review pack.

## Tonight's Implemented Slice

- [x] Scaffold Svelte/Vite/TypeScript app.
- [x] Add USTX YAML/JSON parser for modern OpenUtau project shape.
- [x] Add USTX export for round-tripping simple vocal projects.
- [x] Add classic UST import/export for UTAU community project exchange.
- [x] Preserve UST/USTX tempo events and use them for browser render timing.
- [x] Show and edit tempo-map markers so imported UST/USTX tempo events remain
  visible in the browser DAW workflow.
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
- [x] Bundled V3 zip covers the built-in Korean starter line with `11/11 matched` alias coverage.
- [x] Voicebank unit tests verify common Japanese romaji yoon lyrics such as
  `kya`, `shu`, `ja`, `cho`, and `ryo`, plus extended CV aliases such as
  `fa`, `fi`, `she`, `je`, `che`, `ti`, `tu`, `tsa`, `wi`, `kwa`, and `gwa`,
  match hiragana/katakana UTAU aliases without falling back to the first sample.
- [x] Voicebank and renderer tests verify Japanese VCV aliases such as `- ど`,
  `o ひ`, and `i ど` are selected from phrase-start and previous-vowel note
  context.
- [x] Bundled `WebUtau Korean V3 Synthetic` contains 685 WAV samples and 1603 oto.ini alias lines.
- [x] Built-in `네오빛이 메로디로 데려가` demo aliases are present in the bundled Korean V3 voicebank.
- [x] Playwright browser smoke imported the official zip and downloaded `First-Vocal-Sketch.wav`.
- [x] Default V3 demo browser audit passes: V3 selected, aliases 11/11 matched,
  render warnings clear, piano-roll key/ruler labels visible on desktop/mobile,
  and WAV export DAW-ready.
- [x] Deployed GitHub Pages app passes the same first-run V3 browser audit and
  live WAV download check.
- [x] First-run onboarding smoke verifies the `처음 시작` / `듣기 · 가사 · WAV`
  header, `1분 미션` success board, `한글 한 줄을 보컬 WAV로 만들기`,
  visible `First-Vocal-Sketch.wav` output, `처음이면 여기부터` beginner start panel, `초보자 첫 버튼`,
  `첫 사용 순서`, `지금 할 일`, top `빠른 가사 입력` / `빠른 가사 적용`,
  `샘플 고르기`, `보컬로이드풍 훅 7개`, `Neon Lift`, `Blue Hour`, `Retro Run`,
  `Moon Signal`, `Pink Noise`, `Rain Verse`, `City Glide`,
  collapsed `현재 프로젝트` context drawer, `처음 1분 가이드`, `01 샘플 듣기` / `02 가사 바꾸기` /
  `03 WAV 받기` route, detailed starter lyric input with `한글 그대로 입력` behind `가사 자세히`,
  current lyric card, collapsed `추가 작업` utilities for `멜로디 추천`, `DAW 번들`,
  `새 프로젝트`, and `기본 샘플`, the collapsed `고급 도구` review area, and
  Korean mode navigation.
- [x] First-run browser smoke verifies the `템포 맵` panel is visible so
  tempo-map preservation is user-facing, not only a renderer detail.
- [x] First-run browser smoke downloads the DAW handoff ZIP and inspects the
  bundled WAV, WebUtau project, USTX, classic UST, `melody.mid`, `chords.mid`,
  manifest, README, and sidecar lyric/note/chord files.
- [x] Unit tests re-import the DAW ZIP's WebUtau, USTX, and classic UST project
  exports and verify starter lyric, pitch, timing, BPM, and chord guide data.
- [x] V3 listening review pack generated with first-run, batchim, CV, and vowel
  WAV phrases for human scoring.
- [x] V3 listening review scorecard includes a `Real listening guard` and the
  accepted JSON must include playback-device, blind lyric pass, and V2
  comparison confirmations.
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
- [x] App tests cover selected-note duplicate/split/delete controls and selected-note loop region display.
- [x] App tests cover selected-note vibrato controls; project/UST/USTX tests
  verify vibrato round-trip, and renderer tests verify vibrato changes rendered audio.
- [x] App tests cover selected-note UTAU `Intensity`/dynamics controls; project
  and UST tests verify dynamics round-trip, and renderer tests verify dynamics
  changes rendered audio.
- [x] App tests cover selected-note classic UST resampler fields; project and
  UST tests verify `Velocity`, `Modulation`, and `Flags` round-trip, and
  renderer tests verify `Velocity` changes consonant/source movement.
- [x] App tests cover selected-note UST timing override controls; project and
  UST tests verify `StartPoint`, `PreUtterance`, and `VoiceOverlap`
  round-trip, and renderer tests verify `StartPoint` changes source-sample
  alignment.
- [x] App tests cover selected-note UST `Envelope` controls; project and UST
  tests verify envelope round-trip, and renderer tests verify envelope changes
  rendered volume over the note body.
- [x] Classic UST `PBS`/`PBW`/`PBY` pitch-bend curves survive import/export and
  affect both browser fallback and UTAU sample renderer output.
- [x] OpenUtau USTX `pitch.data` curves survive import/export, preserving
  millisecond point timing and basic curve shapes as WebUtau pitch bends.
- [x] App tests cover selected-note pitch-bend controls for a simple editable
  3-point curve and verify imported pitch modes plus `snap_first` are preserved
  when the selected-note editor adjusts an existing curve.
- [x] App tests verify selected-note preview uses the loaded UTAU sample renderer.
- [x] Selected-note alias display and isolated sample preview use the same
  phrase-start/previous-vowel VCV context as full-song UTAU rendering.
- [x] Browser audit renders all seven first-run starter samples through the
  bundled V3 voicebank and checks DAW-ready non-silent WAV output for each.
- [x] README desktop/mobile screenshots are captured from the running app and
  checked by release audit for readable dimensions and minimum byte size.
- [x] `npm run release:audit-utau` passes every automated community-release gate
  except intentionally required human evidence files.
- [x] Physical-device WAV/DAW handoff now has a local report template and
  acceptance command, so release audit can block until the target DAW import is
  human-verified.
- [x] Public review hub Evidence Preflight shows live `0/2` -> `2/2`
  readiness and the next action for the two required JSON evidence files.
- [x] `npm run release:evidence-status` reports the same structured readiness
  state before accepting the two final evidence files.
- [ ] Physical device share/download and target DAW import confirmed by a human.

## Full Port Workstreams

- [ ] OpenUtau Core parity: commands, full pitch-editor UI, full expression
  automation, and phonemizer behavior beyond the current browser-focused editor.
- [x] Voicebank management: zip import, browser storage, singer metadata, sample
  preview, license display, origin display, and render-risk warnings.
- [x] Kasane Teto UTAU support: parse the official OpenUTAU library zip, read
  `character.yaml` / `oto.ini`, and render through the user-imported samples.
- [ ] Japanese phonemizer parity beyond direct aliases and current compatibility
  mapping.
- [ ] Classic synthesis: WORLDLINE native bridge via server first, then WASM if practical.
- [ ] AI synthesis: DiffSinger/ENUNU through a server renderer first because browser model size and ONNX compatibility are product risks.
- [ ] Plugin compatibility: replace arbitrary EXE execution with a sandboxed web plugin API.
- [ ] WAV handoff workflow: test browser download/share and DAW import on physical hardware.
- [x] First-run accessibility and youth UX baseline: large touch targets, simple
  labels, clear next action, recoverable demo reset, and no destructive default
  action in the first-run path.
- [x] Browser voicebank security baseline: reject unsafe or oversized uploaded
  UTAU zips and never execute user-provided binaries in the browser release.
- [ ] Server render job isolation before any OpenUtau/WORLDLINE compatibility
  server is exposed to users.
