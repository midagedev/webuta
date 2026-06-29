# WebUtau

<div align="center">
  <img src="src/assets/cyber-vocal-hero.webp" alt="WebUtau cyber vocal mascot" width="160" />

  <h3>Cyber vocal synth for Hangul lyrics, UTAU voicebanks, and browser-based WAV rendering.</h3>

  <p>
    <a href="https://midagedev.github.io/webuta/">Live App</a>
    ·
    <a href="docs/LICENSE_BOUNDARIES.md">License Boundaries</a>
    ·
    <a href="docs/PORTING_ROADMAP.md">Porting Roadmap</a>
  </p>

  <p>
    <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-faf38f?style=for-the-badge&amp;labelColor=21142f" />
    <img alt="Svelte" src="https://img.shields.io/badge/Svelte-5-83f7ff?style=for-the-badge&amp;labelColor=21142f" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-8-ff69c8?style=for-the-badge&amp;labelColor=21142f" />
    <img alt="WAV Export" src="https://img.shields.io/badge/WAV-44.1kHz_PCM_mono-c8ff62?style=for-the-badge&amp;labelColor=21142f" />
  </p>
</div>

WebUtau is a browser-first vocal synth editor inspired by OpenUtau-style workflows. It is built for a simple vocal sketching loop:

1. Open the app in a browser.
2. Type a short lyric line such as `도히도히 다이스키`.
3. Sketch notes on a piano-roll/tracker grid.
4. Audition the synthesized vocal line.
5. Render a 44.1 kHz / 16-bit / mono WAV for later use in music tools.

The app can run without a voicebank using the built-in `Korean Demo Voice`. That default voice is not TTS and does not use generated audio files; it is a deterministic browser synthesizer that shapes Hangul onset, vowel, and coda profiles so Korean lyrics can be tested immediately.

Kasane Teto assets are not bundled in this repository. For the real UTAU path, import the official Teto OpenUTAU/UTAU zip yourself in the browser. The zip stays local to the current device and is cached only in that browser's IndexedDB storage.

## Screenshots

| Desktop pattern desk | Mobile editor |
| --- | --- |
| ![WebUtau desktop editor](docs/screenshots/webuta-desktop.jpg) | ![WebUtau mobile editor](docs/screenshots/webuta-mobile.jpg) |

## What Works Today

- Neon cyber vocal editor UI with compact tracker-style status cells.
- Piano-roll note editing with drag, resize, keyboard movement, undo, and redo.
- Hangul lyric line assignment for the built-in `도 히 도 히 다 이 스 키` demo phrase.
- Built-in `Korean Demo Voice` for no-zip browser playback and render tests.
- User-provided UTAU/OpenUTAU zip loading, including official Kasane Teto test coverage.
- Voicebank alias coverage display, so missing syllables are visible before rendering.
- WAV render inspection for RIFF/WAVE PCM, 16-bit, mono, 44100 Hz output.
- Local project and voicebank restore after refresh on the same browser.
- PWA app-shell caching after the first online load.
- In-app license panel that separates project code, original artwork, and user-provided voicebanks.

## Beginner Workflow

Use this path for a first vocal sketch:

1. Open [the live app](https://midagedev.github.io/webuta/).
2. Keep `Korean Demo Voice` selected, or import a local UTAU zip with `ZIP`.
3. Edit the lyric line. The default is `도히도히 다이스키`.
4. Press `적용` to assign lyrics to the notes.
5. Press play to audition.
6. Press `WAV` or `공유`.
7. Use the rendered WAV in your music project.

## Official Teto Test Asset

The repository includes a local-only test helper for the official Kasane Teto OpenUTAU UTAU zip:

```sh
npm run asset:teto
npm run test:teto
```

This downloads `TETO-OUset240323.zip` into ignored `test-assets/` and verifies that WebUtau can read its `character.yaml`, `oto.ini`, aliases, and WAV sample inventory. The test also renders the built-in Korean demo line through the local Teto samples using the browser UTAU sample renderer path.

Do not commit the downloaded Teto zip. The repository is MIT-licensed, but Teto voicebank files remain governed by their own official license and distribution terms.

## Run Locally

```sh
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:5173/
```

## Checks

```sh
npm run notices
npm run lint
npm test
npm run build
npm run test:teto
```

Current verified local smoke coverage:

- Official Teto zip imported in browser.
- `6216` UTAU aliases and `1822` WAV samples detected.
- Built-in `도히도히 다이스키` demo reports `8/8 matched` against the official Teto zip.
- Built-in `Korean Demo Voice` decomposes Hangul syllables for the no-ZIP guide vocal path.
- WAV download created at `test-output/First-Vocal-Sketch.wav`.
- Output format: RIFF/WAVE, PCM, 16-bit, mono, 44100 Hz.
- The app surfaces local voicebank cache status, including `이 기기 저장됨`, `이 기기에서 복원됨`, and `현재 세션 전용`.
- Runtime npm dependency notices are generated in `docs/THIRD_PARTY_NOTICES.md`.
- Manual WAV handoff verification is tracked in `docs/WAV_DAW_QA.md`.

## Visual Direction

The current interface uses an original cyber vocal mascot illustration and a dense tracker-era editor theme:

- App eyebrow: `CYBER TRACKER CLUB`
- Tracker surface: compact `PAT / CH / BPM / ROWS / BANK / MATCH` status cells with mobile horizontal scrolling.
- Mascot assets:
  - `src/assets/cyber-vocal-hero.webp` for the browser UI and README header
  - `src/assets/cyber-vocal-hero.png` as the transparent PNG source
- Product copy should say `vocal synth`, `singing voice editor`, or `cyber vocal`. It should not imply Vocaloid compatibility.
- No third-party singer likeness, Teto character art, or Teto voicebank files are bundled.

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
- [WAV DAW QA](docs/WAV_DAW_QA.md)
- [Porting roadmap](docs/PORTING_ROADMAP.md)
