# WAV / DAW QA

Goal: verify the real end-to-end path from WebUtau vocal synthesis to WAV import in a target music tool.

This checklist must be run on a physical device. Browser tests can verify the WAV format and responsive layout, but they cannot prove every downstream DAW import behavior.

## Device Setup

- Device:
- OS version:
- Browser:
- Target DAW/version:
- WebUtau URL:
- Default voicebank: WebUtau Korean V3 Synthetic
- Optional imported voicebank zip:

## Steps

Short route shown on `review/wav-daw/index.html`: the `60-second physical handoff path` opens the public app, exports `First-Vocal-Sketch.wav`, imports it into the target DAW, then downloads `handoff-report.local.json` only after the imported region is visible and audible. The reference WAV is `44.1 kHz mono 16-bit` with the default lyric `도 히 도 히 다 이 스 키`.

1. Open WebUtau from the public GitHub Pages URL.
2. Optionally add it to the home screen when the platform supports it.
3. Relaunch WebUtau from the home-screen icon.
4. Confirm `WebUtau Korean V3 Synthetic` is selected without importing a voicebank zip.
5. Confirm the first-run guide shows `처음 시작`, `듣기 · 가사 · WAV`, `0/3`, `1분 완성 루트`, `C -> G -> Am -> F`, `01 샘플 듣기`, `02 가사 적용`, `03 WAV 받기`, `STEP 01`, `샘플 먼저 듣기`, `한글 그대로 입력`, `스타터 가사 라인`, `현재 가사`, `샘플 듣기`, `멜로디 추천`, `DAW 번들`, `렌더 후 ZIP`, `새 프로젝트`, `기본 샘플`, and the collapsed `고급 도구` review area.
6. Confirm the app shows `8/8 matched` for the default `도 히 도 히 다 이 스 키` project.
7. Tap `들어보기` or the main play control and confirm audio preview works.
8. Tap `공유`, `스타터 WAV 받기`, or the top-bar WAV download button.
9. Send or save the WAV through the platform share/download flow.
10. In the target music tool, confirm the imported audio region appears on a track.
11. Play the target project and confirm the imported vocal audio is audible.
12. Return to WebUtau, refresh or relaunch, and confirm the browser draft restores locally.
13. Optional compatibility pass: import a user-provided UTAU/OpenUTAU zip from Files and confirm it stays private to the browser storage.
14. Turn network off, relaunch from the home-screen icon, and confirm the app shell opens after one prior online load.
15. Open `review/wav-daw/index.html` from the public site, or copy `docs/wav-daw-handoff.local.template.json` to a local uncommitted report path. Fill every field from this physical-device pass, download or save `handoff-report.local.json`, and keep it in Downloads beside `listening-scores.local.json`.
16. Open the release hub `Evidence Preflight` checker and choose both downloaded JSON files. It validates them locally in the browser with no upload.
17. From the repo root, confirm both final release evidence files are present and valid. This read-only command auto-detects the newest matching files from Downloads:

```sh
npm run release:evidence-status
```

18. Accept both final release evidence files. The accept command installs both JSON files atomically and reruns the final audit:

```sh
npm run release:accept-evidence
```

If either file is outside Downloads, pass both paths explicitly with `npm run release:accept-evidence -- --scores path/to/listening-scores.local.json --handoff path/to/handoff-report.local.json`.

## Pass Criteria

- WebUtau opens from the home-screen icon.
- `WebUtau Korean V3 Synthetic` is selected by default.
- The first-run guide puts the `처음 시작` / `듣기 · 가사 · WAV` header, `1분 완성 루트`, `C -> G -> Am -> F` chord guide, and `01 샘플 듣기` / `02 가사 적용` / `03 WAV 받기` route before the focused `STEP 01` / `샘플 먼저 듣기` action and `한글 그대로 입력` / `스타터 가사 라인` input, then shows the current lyric preview, desktop/mobile utilities for `멜로디 추천`, `DAW 번들`, `새 프로젝트`, `기본 샘플`, and a collapsed `고급 도구` release-review area.
- The DAW bundle should include `melody.mid`, `chords.mid`, `arrangement.txt`, `chords.csv`, `lyrics.txt`, and `notes.csv` beside the rendered WAV and project exports.
- Default lyrics show `8/8 matched`.
- Rendered WAV shows DAW-ready format metadata.
- The target music tool imports the WAV without conversion errors.
- The imported vocal region plays audibly.
- No horizontal layout overflow blocks the main workflow in portrait orientation.
- Any optional imported voicebank zip remains user-provided and private to the browser.

## Result

- Status: Not yet physically verified.
- Release evidence path: `experiments/utau-v3/work/wav-daw-handoff/handoff-report.local.json`
- Template: `docs/wav-daw-handoff.local.template.json`
- Public report builder: `review/wav-daw/index.html`
- Notes:
