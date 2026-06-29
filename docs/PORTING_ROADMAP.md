# Porting Roadmap

## Architecture

WebUtau should be split into four layers:

1. Editor UI: React touch-first interface for iPad and desktop browsers.
2. Project model: USTX-compatible document model with browser persistence.
3. Render API: a stable interface that returns PCM samples or WAV blobs.
4. Render engines: browser demo, OpenUtau server renderer, WORLDLINE WASM, and future AI model renderers.

This keeps the child-friendly editor usable while the heavyweight synthesis work advances independently.

## Renderer Strategy

The browser demo renderer is not a real OpenUtau singer. It exists to prove the complete iPad-to-WAV workflow.

Recommended sequence:

1. Keep browser demo renderer for instant preview and tests.
2. Add an OpenUtau server renderer that runs trusted built-in engines only.
3. Add voicebank upload and per-singer license display.
4. Port WORLDLINE to WebAssembly for offline classic preview.
5. Add ONNX Runtime Web experiments after model-size and Safari performance tests.

For the first real singer target, use Kasane Teto UTAU as a user-provided voicebank. The app should link to the official download page, let the user import the zip, store it privately, and show the official terms before first use. Do not bundle or mirror the voicebank without permission.

Local development can use `npm run asset:teto` to download the official zip into ignored `test-assets/`. That file is a test input only and must not be committed or redistributed with WebUtau.

## GarageBand Workflow

Target export:

- WAV PCM.
- 44.1 kHz.
- Mono first, stereo later.
- File name based on project name.
- Download path tested on iPad Safari and macOS Safari/Chrome.

Manual test:

1. Open WebUtau on iPad.
2. Edit lyrics and notes.
3. Tap WAV.
4. Save to Files.
5. Open GarageBand and import the WAV into an audio track.

## OpenUtau Feature Parity

High-risk desktop features:

- Arbitrary external resampler and wavtool binaries.
- Legacy UTAU plugins.
- Native WORLDLINE DLL/SO calls.
- Microsoft.ML.OnnxRuntime desktop sessions.
- Local filesystem watching and desktop install paths.
- NAudio/WASAPI output devices.

Web replacements:

- Browser File System Access or upload/download.
- IndexedDB for local project/singer cache.
- Web Audio playback.
- Server render jobs for trusted heavy engines.
- WASM-only plugin API for untrusted extensions.
