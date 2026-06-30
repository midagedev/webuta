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
5. Confirm the first-run guide shows `01 보이스`, `02 재생`, and `03 WAV`.
6. Confirm the app shows `8/8 matched` for the default `도 히 도 히 다 이 스 키` project.
7. Tap `들어보기` or the main play control and confirm audio preview works.
8. Tap `공유` or `스타터 WAV 다운로드`.
9. Send or save the WAV through the platform share/download flow.
10. In the target music tool, confirm the imported audio region appears on a track.
11. Play the target project and confirm the imported vocal audio is audible.
12. Return to WebUtau, refresh or relaunch, and confirm the browser draft restores locally.
13. Optional compatibility pass: import a user-provided UTAU/OpenUTAU zip from Files and confirm it stays private to the browser storage.
14. Turn network off, relaunch from the home-screen icon, and confirm the app shell opens after one prior online load.

## Pass Criteria

- WebUtau opens from the home-screen icon.
- `WebUtau Korean V3 Synthetic` is selected by default.
- The first-run guide shows the voice, play, and WAV handoff path.
- Default lyrics show `8/8 matched`.
- Rendered WAV shows DAW-ready format metadata.
- The target music tool imports the WAV without conversion errors.
- The imported vocal region plays audibly.
- No horizontal layout overflow blocks the main workflow in portrait orientation.
- Any optional imported voicebank zip remains user-provided and private to the browser.

## Result

- Status: Not yet physically verified.
- Notes:
