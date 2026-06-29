# iPad GarageBand QA

Goal: verify the real end-to-end path from WebUtau on iPad to GarageBand import.

This checklist must be run on a physical iPad. Browser tests can verify the WAV format and responsive layout, but they cannot prove GarageBand import behavior.

## Device Setup

- Device:
- iPadOS version:
- Browser:
- GarageBand version:
- WebUtau URL:
- Voicebank zip:

## Steps

1. Open WebUtau from the public GitHub Pages URL.
2. Add it to the iPad home screen.
3. Relaunch WebUtau from the home-screen icon.
4. Import the official Kasane Teto UTAU/OpenUTAU zip from Files.
5. Confirm the app shows `8/8 matched` for the default `도 히 도 히 다 이 스 키` project.
6. Tap play and confirm audio preview works.
7. Tap `공유`.
8. Send the WAV to GarageBand through the iPad share sheet.
9. In GarageBand, confirm the imported audio region appears on a track.
10. Play the GarageBand project and confirm the imported vocal audio is audible.
11. Return to WebUtau, refresh or relaunch, and confirm the draft and imported voicebank restore locally.
12. Turn network off, relaunch from the home-screen icon, and confirm the app shell opens after one prior online load.

## Pass Criteria

- WebUtau opens from the home-screen icon.
- The official Teto zip remains user-provided and private to the browser.
- Default lyrics show `8/8 matched`.
- Exported WAV shows `GarageBand ready`.
- GarageBand imports the WAV without conversion errors.
- The imported GarageBand region plays audibly.
- No horizontal layout overflow blocks the main workflow in portrait orientation.

## Result

- Status: Not yet physically verified.
- Notes:
