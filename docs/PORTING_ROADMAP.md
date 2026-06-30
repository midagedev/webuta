# Porting Roadmap

## Architecture

WebUtau should be split into four layers:

1. Editor UI: Svelte touch-first interface for mobile, tablet, and desktop browsers.
2. Project model: USTX-compatible document model with browser persistence.
3. Render API: a stable interface that returns PCM samples or WAV blobs.
4. Render engines: browser demo, OpenUtau server renderer, WORLDLINE WASM, and future AI model renderers.

This keeps the child-friendly editor usable while the heavyweight synthesis work advances independently.

## Renderer Strategy

`WebUtau Korean V3 Synthetic` is the bundled first-run singer. It is an original DSP-generated UTAU-style Korean voicebank, not a third-party singer. The browser demo renderer remains as a fallback and test utility, but the product default should exercise the sample voicebank path.

Recommended sequence:

1. Keep `WebUtau Korean V3 Synthetic` as the default bundled sample voicebank.
2. Improve Korean phonemization beyond CV approximation, starting with coda and liaison handling.
3. Add an OpenUtau server renderer that runs trusted built-in engines only.
4. Add voicebank upload and per-singer license display.
5. Port WORLDLINE to WebAssembly for offline classic preview.
6. Add ONNX Runtime Web experiments after model-size and Safari performance tests.

For the first real singer target, use Kasane Teto UTAU as a user-provided voicebank. The app should link to the official download page, let the user import the zip, store it privately, and show the official terms before first use. Do not bundle or mirror the voicebank without permission.

Local development can use `npm run asset:teto` to download the official zip into ignored `test-assets/`. That file is a test input only and must not be committed or redistributed with WebUtau.

## WAV / DAW Workflow

Target export:

- WAV PCM.
- 44.1 kHz.
- Mono first, stereo later.
- File name based on project name.
- Download and share paths tested on mobile, tablet, and desktop browsers.

Manual test:

1. Open WebUtau in a browser.
2. Edit lyrics and notes.
3. Tap WAV.
4. Save or share the rendered WAV.
5. Import the WAV into a target DAW or sampler.

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
