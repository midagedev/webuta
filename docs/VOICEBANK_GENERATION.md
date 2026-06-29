# WebUtau Korean Voicebank Generation

The bundled `WebUtau Korean V2` voicebank is generated as a Korean CV UTAU-style pack.

## Procedural Fallback

```sh
npm run voicebank:lite
```

This creates the older formant/procedural fallback pack with no external model dependency.

## Supertonic V2

```sh
python3 -m venv .tmp-supertonic
. .tmp-supertonic/bin/activate
pip install supertonic
WEBUTA_SUPERTONIC_VOICE=F3 python scripts/generate-korean-supertonic-voicebank.py
```

The script writes `public/voicebanks/webuta-ko-lite.zip` with:

- 399 Hangul CV WAV samples
- 814 Hangul and romanized aliases
- sustain-extended samples for longer singing notes
- `oto.ini`, `character.yaml`, `readme.txt`, `license.txt`
- `webuta-ko-lite.manifest.json`

The packaged WAV samples are generated from Supertonic 3 TTS output. Review the Supertonic 3 OpenRAIL-M model license before broad redistribution.
