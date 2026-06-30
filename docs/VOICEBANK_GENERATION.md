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
clone a human singer, a TTS model output, Kasane Teto, Vocaloid, or any
third-party singer asset.

## Procedural Fallback

```sh
npm run voicebank:lite
```

This creates the older V1/V2 formant/procedural fallback pack with no external model dependency.

## Supertonic V2 Legacy

```sh
python3 -m venv .tmp-supertonic
. .tmp-supertonic/bin/activate
pip install supertonic
WEBUTA_SUPERTONIC_VOICE=F3 python scripts/generate-korean-supertonic-voicebank.py
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
