# WebUtau Neural Render Contract

This document defines the first stable boundary between the Svelte editor and a
future Korean neural singing renderer.

The contract is intentionally renderer-neutral. DiffSinger/OpenVPI, NNSVS,
ESPnet, or a custom model service can adapt this request into their own score
format.

## Request Shape

```json
{
  "version": 1,
  "project": {
    "id": "first-vocal-sketch",
    "title": "First Vocal Sketch",
    "bpm": 132,
    "timebase": 480,
    "tempos": [
      { "position": 0, "bpm": 132 }
    ]
  },
  "voice": {
    "id": "webuta-ko-neural-dev",
    "language": "ko",
    "renderer": "diffsinger"
  },
  "render": {
    "sampleRate": 44100,
    "format": "wav",
    "includeDiagnostics": true
  },
  "notes": [
    {
      "kind": "note",
      "id": "n1",
      "trackId": "vocal",
      "startTick": 0,
      "durationTick": 480,
      "startSeconds": 0,
      "durationSeconds": 0.454545,
      "midi": 60,
      "targetHz": 261.625565,
      "lyric": "도",
      "pitchCurve": [],
      "phonemes": [
        {
          "symbol": "d",
          "role": "onset",
          "source": "도",
          "startRatio": 0,
          "endRatio": 0.22
        },
        {
          "symbol": "o",
          "role": "vowel",
          "source": "도",
          "startRatio": 0.22,
          "endRatio": 1
        }
      ]
    },
    {
      "kind": "rest",
      "id": "rest-vocal-420-480",
      "trackId": "vocal",
      "partId": "verse",
      "startTick": 420,
      "durationTick": 60,
      "startSeconds": 0.397727,
      "durationSeconds": 0.056818,
      "midi": null,
      "targetHz": null,
      "lyric": "R",
      "pitchCurve": [],
      "phonemes": [
        {
          "symbol": "sil",
          "role": "silence",
          "source": "R",
          "startRatio": 0,
          "endRatio": 1
        }
      ]
    },
    {
      "kind": "tie",
      "id": "n2",
      "trackId": "vocal",
      "partId": "verse",
      "startTick": 480,
      "durationTick": 480,
      "startSeconds": 0.454545,
      "durationSeconds": 0.454545,
      "midi": 62,
      "targetHz": 293.664768,
      "lyric": "-",
      "pitchCurve": [
        {
          "timeRatio": 0.5,
          "cents": 12
        }
      ],
      "phonemes": [
        {
          "symbol": "tie",
          "role": "tie",
          "source": "-",
          "startRatio": 0,
          "endRatio": 1
        }
      ]
    },
    {
      "kind": "breath",
      "id": "br1",
      "trackId": "vocal",
      "partId": "verse",
      "startTick": 960,
      "durationTick": 240,
      "startSeconds": 0.909091,
      "durationSeconds": 0.227273,
      "midi": null,
      "targetHz": null,
      "lyric": "숨",
      "pitchCurve": [],
      "phonemes": [
        {
          "symbol": "br",
          "role": "breath",
          "source": "숨",
          "startRatio": 0,
          "endRatio": 1
        }
      ]
    }
  ]
}
```

## Required Fields

- `version`: contract version.
- `project.bpm`: primary tempo, also used as the fallback tempo at tick `0`.
- `project.timebase`: ticks per quarter note.
- `project.tempos`: sorted tempo events used to calculate note seconds.
- `voice.language`: BCP-47-ish language tag, initially `ko`.
- `voice.renderer`: renderer family hint, initially `diffsinger` or `custom`.
- `render.sampleRate`: output sample rate. WebUtau should request `44100`.
- `notes[].kind`: `note`, `tie`, `rest`, or `breath`.
- `notes[].startTick`: integer project tick.
- `notes[].durationTick`: integer duration in ticks.
- `notes[].startSeconds`: calculated absolute start time.
- `notes[].durationSeconds`: calculated note duration.
- `notes[].midi`: target note number, or `null` for rest events.
- `notes[].targetHz`: target fundamental frequency, or `null` for rest events.
- `notes[].lyric`: original visible lyric.
- `notes[].pitchCurve`: optional note-local pitch points in cents, expressed as
  `timeRatio` from `0` to `1`.
- `notes[].phonemes`: Korean phoneme decomposition used for neural input.

## Phoneme Rules

- Keep original Hangul lyric text.
- Decompose Hangul syllables into onset, vowel, and optional coda.
- Do not silently drop coda. If the renderer cannot handle coda yet, mark it as
  unsupported in diagnostics.
- Treat coda as a short final tail, not as sustain material. For long Hangul
  notes such as `연`, the vowel should carry the held pitch and the coda should
  stay near the end of the note so batchim does not repeat through the body.
- Treat unvoiced consonants as timing/texture. The model may not force them to a
  target F0.
- Use explicit silence/rest notes rather than relying on gaps when exporting to
  frameworks that need them.
- Treat `-`, `ー`, and `―` lyrics as `tie` events. They keep pitch and duration
  but do not start a new consonant/vowel.
- Treat empty lyrics, `R`, `rest`, and `쉼` as silence/rest events.
- Treat `br`, `breath`, `숨`, and `息` as breath events. They are unpitched but
  should remain distinct from silence.

## Response Shape

```json
{
  "version": 1,
  "ok": true,
  "audio": {
    "contentType": "audio/wav",
    "sampleRate": 44100,
    "durationSeconds": 4.2,
    "fileName": "first-vocal-sketch.wav",
    "wavBase64": "UklGR..."
  },
  "diagnostics": {
    "renderer": "diffsinger",
    "modelId": "webuta-ko-neural-dev",
    "renderSeconds": 12.8,
    "warnings": []
  }
}
```

The first local service returns JSON from `POST /render` with the WAV embedded
as `audio.wavBase64`. A later hosted renderer may return the WAV as a binary
response with diagnostics in headers or as multipart data, but the logical
response fields above should remain stable.

## Local Service Endpoints

- `GET /health`: returns license acceptance status and missing runtime paths.
- `POST /render`: accepts the request shape above and returns the response
  shape above.
- Default bind address: `127.0.0.1:8787`.
- The service must require explicit `--accept-local-research-license` for local
  research models, datasets, and vocoders.
- The static GitHub Pages build should not bundle datasets, checkpoints,
  vocoders, or the local service runtime.

## Error Codes

- `server-unavailable`
- `model-missing`
- `license-not-accepted`
- `invalid-score`
- `invalid-phoneme`
- `unsupported-language`
- `render-timeout`
- `render-cancelled`
- `internal-render-error`

## WebUtau Environment

Set `VITE_WEBUTA_NEURAL_ENDPOINT=http://127.0.0.1:8787/render` before running
the Vite app to enable the `Local Neural DiffSinger` renderer in the UI. Without
that value, WebUtau should show the neural renderer as blocked and keep the
browser demo / UTAU voicebank paths working.

## Contract Smoke

Run this after changing USTX import/export, Korean phoneme handling, or the
DiffSinger adapter:

```sh
npm run smoke:contract
```

The smoke imports an OpenUtau-style USTX fixture with Hangul coda lyrics,
explicit rest, tie, and breath notes, serializes it back through WebUtau's USTX
writer, exports the neural render request, and converts it to a DiffSinger `.ds`
segment. It checks that Korean coda phones, rest timing, tie slur flags, breath
events, model id, and renderer id survive the full boundary.

## First Test Phrases

- `도히도히 다이스키`
- `강남 밤하늘`
- `사랑해 안녕`
- `빛나는 꿈`

These phrases are not a dataset. They are deterministic render fixtures for
score export, phoneme handling, and listening tests.
