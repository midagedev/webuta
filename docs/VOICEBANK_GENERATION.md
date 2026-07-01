# WebUtau Korean Voicebank Generation

The bundled default `WebUtau Korean V3 Synthetic` voicebank is generated as a Korean UTAU-style pack.

For the technical reasoning behind CV/CVVC coverage, F0 correction, sustain
construction, WORLD/PSOLA options, and the longer-term neural singing path, see
[`VOICEBANK_METHODOLOGY.md`](VOICEBANK_METHODOLOGY.md).

## V3 Synthetic Default

```sh
npm run voicebank:v3
```

This writes `public/voicebanks/webuta-ko-v3.zip` with generated WAV samples,
`oto.ini`, `character.yaml`, `readme.txt`, `license.txt`, and
`webuta-ko-v3.manifest.json`.

The V3 default is a fully synthetic DSP-generated voice. It does not copy or
clone a human singer, use public/private recorded voice datasets as source
audio, use TTS/model checkpoint output, or include Kasane Teto, Vocaloid, or
any third-party singer asset.

The current V3 synthesis profile is `deterministic-dsp-bright-formant-v3`.
After regeneration, run the package, oto, pitch, loop, rendered long-sustain,
and clarity audits before publishing the zip:

```sh
npm run voicebank:audit-v3
npm run voicebank:oto-v3
npm run voicebank:pitch-v3
npm run voicebank:loop-v3
npm run voicebank:sustain-v3
npm run voicebank:clarity-v3
```

`voicebank:sustain-v3` uses the browser UTAU renderer, downloads the actual WAV
users would receive, and checks long notes for loop ticks, sustain stability,
onset/coda energy, intended target pitch error, and in-note pitch drift.

## Procedural Fallback

```sh
npm run legacy:voicebank:lite
```

This creates the older V1/V2 formant/procedural fallback pack with no external model dependency.
It is kept for regression comparison and fallback research, not as an active
community-release voicebank path.

## Supertonic V2 Legacy

```sh
python3 -m venv .tmp-supertonic
. .tmp-supertonic/bin/activate
pip install supertonic
WEBUTA_SUPERTONIC_VOICE=F3 npm run legacy:voicebank:supertonic
```

The script writes `public/voicebanks/webuta-ko-lite.zip` with:

- 399 Hangul CV WAV samples
- 814 Hangul and romanized aliases
- elongated-vowel sustain samples for longer singing notes
- `oto.ini`, `character.yaml`, `readme.txt`, `license.txt`
- `webuta-ko-lite.manifest.json`

The packaged WAV samples are generated from Supertonic 3 TTS output. This is
now legacy and should not be the community-release default unless the model
output license has been reviewed again.

## Neural Experiments Are Separate

The DiffSinger/OpenVPI neural singer work is tracked in
[`NEURAL_SINGER_ROADMAP.md`](NEURAL_SINGER_ROADMAP.md) and
`experiments/neural-singer/`. Do not bundle research datasets, vocoder
checkpoints, trained neural checkpoints, or generated smoke WAVs into the
static voicebank zip without a separate release decision.
