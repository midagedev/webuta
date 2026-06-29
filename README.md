# WebUtau

WebUtau is a browser-first cyber vocal synth sketchpad aimed at an iPad-to-GarageBand workflow.

The app pairs a neon-glam, tracker-inspired vocal editor UI with a simple singing workflow: load a user-provided UTAU/OpenUTAU voicebank, sketch lyrics on a dense piano grid, render a WAV, and import it into GarageBand.

The current verified target is:

1. Open the app on a browser.
2. Import the official Kasane Teto OpenUTAU UTAU zip as a user-provided voicebank.
3. Edit a simple vocal line.
4. Keep the browser draft automatically restored after refresh.
5. Keep the last imported voicebank zip restored locally in the same browser.
6. Open from the iPad home screen with app-shell caching after the first online load.
7. Export or share a 44.1 kHz / 16-bit / mono WAV.
8. Confirm the rendered WAV shows `GarageBand ready`.
9. Import that WAV into GarageBand.

Kasane Teto assets are not bundled in this repository. Use the official download page and keep the zip as a local, ignored test asset. In the browser app, an imported voicebank zip is cached only in that browser's local IndexedDB storage.
The app shows whether the imported voicebank is saved on the current device, restored from local storage, or available only for the current session.

## Visual Direction

The current interface uses an original cyber vocal mascot illustration and a dense tracker-era editor theme:

- App eyebrow: `CYBER TRACKER CLUB`
- Tracker surface: compact `PAT / CH / BPM / ROWS / BANK / OUT` status cells with mobile horizontal scrolling.
- Mascot assets:
  - `src/assets/cyber-vocal-hero.webp` for the browser UI
  - `src/assets/cyber-vocal-hero.png` as the transparent PNG source
- Visual constraints:
  - Original character only, no third-party singer likeness.
  - No bundled Kasane Teto voicebank or character assets.
  - Product copy should say `vocal synth`, `singing voice editor`, or `cyber vocal`, not imply Vocaloid compatibility.
- The in-app `Licenses` panel lists project code, user-provided voicebank boundaries, original artwork, and the official Teto UTAU link.

## Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Official Teto Test Asset

```sh
npm run asset:teto
npm run test:teto
```

This downloads `TETO-OUset240323.zip` into ignored `test-assets/` and verifies that WebUtau can read its `character.yaml`, `oto.ini`, aliases, and WAV sample inventory.
It also renders the built-in Korean `도 히 도 히 다 이 스 키` demo line through the local Teto samples, using the browser UTAU sample renderer path.

## Checks

```sh
npm run notices
npm run lint
npm test
npm run build
npm run test:teto
```

Verified local smoke output:

- Official Teto zip imported in browser.
- `6216` UTAU aliases and `1822` WAV samples detected.
- Built-in `도히도히 다이스키` demo reports `8/8 matched` against the official Teto zip.
- WAV download created at `test-output/First-Vocal-Sketch.wav`.
- Output format: RIFF/WAVE, PCM, 16-bit, mono, 44100 Hz.
- The app re-inspects the rendered Blob header and shows `GarageBand ready` only for RIFF/WAVE PCM, 16-bit, mono, 44100 Hz output.
- The app surfaces local voicebank cache status, including `이 기기 저장됨`, `이 기기에서 복원됨`, and `현재 세션 전용`.
- Runtime npm dependency notices are generated in `docs/THIRD_PARTY_NOTICES.md`.
- Physical iPad and GarageBand import verification is tracked in `docs/IPAD_GARAGEBAND_QA.md`.

## Deploy To GitHub Pages

This repository includes a GitHub Actions workflow at `.github/workflows/pages.yml`.

1. Push the repository to GitHub.
2. In GitHub, open `Settings -> Pages`.
3. Set `Build and deployment -> Source` to `GitHub Actions`.
4. Push to `main`, or run the `Deploy GitHub Pages` workflow manually.

Only `dist/` is published. Kasane Teto voicebank zips in `test-assets/` are ignored local test inputs and must not be committed or uploaded.

## Docs

- [Overnight checklist](docs/OVERNIGHT_CHECKLIST.md)
- [License boundaries](docs/LICENSE_BOUNDARIES.md)
- [Third party notices](docs/THIRD_PARTY_NOTICES.md)
- [iPad GarageBand QA](docs/IPAD_GARAGEBAND_QA.md)
- [Porting roadmap](docs/PORTING_ROADMAP.md)
