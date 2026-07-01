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

1. Open WebUtau from the public GitHub Pages URL.
2. Optionally add it to the home screen when the platform supports it.
3. Relaunch WebUtau from the home-screen icon.
4. Confirm `WebUtau Korean V3 Synthetic` is selected without importing a voicebank zip.
5. Confirm the first-run guide shows `START HERE`, `01 샘플 듣기`, `02 가사 적용`, `03 WAV 받기`, `STEP 01`, `샘플 먼저 듣기`, `스타터 가사 라인`, `현재 가사`, `작업 시작`, `필요한 것만 바로 꺼내기`, `샘플 듣기`, `멜로디 추천`, `새 프로젝트`, and `기본 샘플`.
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
16. From the repo root, accept both final release evidence files. The command auto-detects the newest matching files from Downloads:

```sh
npm run release:accept-evidence
```

If either file is outside Downloads, pass both paths explicitly with `npm run release:accept-evidence -- --scores path/to/listening-scores.local.json --handoff path/to/handoff-report.local.json`.

## Pass Criteria

- WebUtau opens from the home-screen icon.
- `WebUtau Korean V3 Synthetic` is selected by default.
- The first-run guide puts the `01 샘플 듣기` / `02 가사 적용` / `03 WAV 받기` quick checklist before the focused `STEP 01` / `샘플 먼저 듣기` action and `스타터 가사 라인` input, then shows the current lyric preview and visible `작업 시작` utilities for `멜로디 추천`, `새 프로젝트`, and `기본 샘플`.
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
