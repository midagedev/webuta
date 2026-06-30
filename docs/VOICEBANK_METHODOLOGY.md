# WebUtau Voicebank Methodology

Research snapshot: 2026-06-30

This document is the technical baseline for making WebUtau's bundled Korean
singing voicebank sound less like a beep or chopped TTS sample and more like a
usable vocal-synth singer.

The short version: a good vocal-synth voicebank is not just a folder of WAVs.
It is a controlled set of phonetic units, timing labels, pitch-normalized voiced
regions, stable sustain material, and a renderer/phonemizer that knows how to
join those units without destroying consonants.

## Current Position

WebUtau now ships a generated Korean V3 synthetic UTAU voicebank. The current
web profile contains 615 generated WAV samples, 1437 aliases, `oto.ini`, and a
browser sample renderer. This is useful because it exercises the same route as
an imported UTAU/OpenUtau singer, but it still has structural weaknesses:

- It is synthetic, so the timbre is stylized rather than naturally human.
- It still needs richer VC/CVVC phonemizer routing before full Korean coda
  coverage is musical.
- The renderer loops WAV regions, but the source WAV must already contain a
  stable voiced body. A bad vowel body cannot be saved by looping alone.

## Reference Systems

OpenUtau is the most relevant compatibility target. Its README describes
OpenUtau as a free, open-source editor for the UTAU community, with extensible
phonemizers for VCV, CVVC, Arpasing, Korean, and other systems. It also uses
WORLDLINE-R for curve tuning and keeps UTAU compatibility selective rather than
byte-for-byte identical.

Classic UTAU/OpenUtau voicebanks rely on:

- WAV samples.
- Alias metadata, usually through `oto.ini`.
- Timing parameters: offset, fixed consonant, cutoff/end blank, preutterance,
  and overlap.
- A phonemizer that maps lyrics into sample aliases.
- A resampler that changes pitch and duration while preserving the singer's
  identity as much as possible.

OpenUtau's `Oto` model is especially important for us because it treats
consonants as relatively fixed material and the later vowel body as stretchable
material. That same split is exactly what WebUtau needs for Korean clarity:
do not time-stretch consonant attacks aggressively; correct and loop the voiced
vowel body instead.

## Korean Voicebank Units

The current 399-sample bank is:

```txt
19 Hangul onsets * 21 Hangul vowels = 399 CV samples
```

This is the minimal practical coverage for a Hangul starter voice. It can say
lyrics such as `도히도히 다이스키`, but it is not enough for clear Korean singing.

For Korean, the next levels are:

- `CV`: onset+vowel. Small and easy, weak for final consonants.
- `VC`: vowel+final consonant. Needed for batchim clarity.
- `CVVC`: onset+vowel plus vowel+consonant transition units. Better Korean
  connection without exploding into full triphone coverage.
- `VCV`: vowel-to-consonant-to-vowel transitions. Smoother, larger, more work.
- Multipitch banks: the same units recorded/generated at several base notes,
  usually at least low/mid/high, to avoid extreme pitch shifting.
- Expression layers: soft, normal, strong, breathy, etc. These are optional
  until the base pronunciation is stable.

For WebUtau, the most useful next bank is not "more random syllables". It is a
Korean CVVC-lite bank:

- Keep all 399 CV samples.
- Add a controlled set of Korean final consonant tails.
- Add vowel-to-consonant transitions for common batchim.
- Add a Korean phonemizer path that emits the final consonant unit instead of
  dropping it to the CV base.

## Pitch Theory

For singing, every note has a target fundamental frequency:

```txt
target_hz(midi) = 440 * 2 ^ ((midi - 69) / 12)
C4 = MIDI 60 = about 261.625565 Hz
```

A TTS-generated syllable may begin around a target pitch, then fall or curve
because spoken Korean prosody is being modeled. That is natural for TTS, but it
is harmful for a sample-based singer. If a C4 voicebank sample bends down during
the vowel, then rendering that sample at D4 or G4 preserves the bend. The
result is still out of tune, just transposed.

The correction target should be:

- Preserve the consonant/transient region.
- Detect voiced frames in the vowel body.
- Estimate F0 per frame.
- Retune the voiced region to the intended base note.
- Rebuild sustain from a stable corrected region.
- Keep amplitude leveling separate from pitch correction.

## Practical F0 Correction Pipeline

The next generator should process each WAV roughly like this:

1. Crop leading/trailing silence without cutting the consonant.
2. Estimate an energy envelope to locate active speech.
3. Estimate F0 on overlapping frames of the voiced body.
4. Mark unvoiced or low-confidence frames as consonant/noise, not pitchable
   vowel.
5. Select a stable vowel body region after the consonant.
6. Pitch-correct that voiced body toward the base note.
7. Reconstruct a sample:
   - original onset/consonant
   - short crossfade into corrected vowel body
   - corrected sustain loop
   - release tail
8. Normalize peak and body loudness.
9. Write diagnostic metadata: detected median F0, cents drift, correction
   ratio, voiced-frame coverage, loop start/end, and any low-confidence flags.

Useful quality gates:

- Median voiced F0 should be within about 20 cents of the target base note.
- Mid-body F0 drift should ideally stay below about 35 cents for starter quality.
- Voiced-frame confidence should be high enough that fricatives and breath are
  not accidentally pitch-shifted as vowels.
- Loop boundary RMS and waveform discontinuity should be measured.
- Consonant attack must remain audible in rendered Korean phrases.

## Algorithms Worth Considering

### Autocorrelation / YIN-style F0 estimation

Good for an immediate in-repo implementation because it only needs NumPy. It can
estimate the dominant period in each frame, then convert period to Hz. The risk
is octave errors, especially on breathy or noisy syllables.

This is suitable for diagnostics and first-pass correction.

### PSOLA / TD-PSOLA

Pitch-Synchronous Overlap-Add splits voiced speech around pitch periods, moves
those periods closer or farther apart to change pitch, and overlap-adds them
back together. It is a classic match for vocal samples because it can preserve
vowel identity while changing pitch and duration.

This is a better conceptual fit than plain resampling when we need to change F0
without making the sample shorter or longer. It is more complex because it needs
reliable pitch marks.

### WORLD vocoder

WORLD decomposes speech into F0, spectral envelope, and aperiodicity. A WORLD
path can flatten or redraw F0 while preserving the spectral envelope, then
resynthesize the waveform. This is attractive for offline voicebank generation:
we do not need the browser to run WORLD immediately if the corrected WAVs are
prebuilt into the bundled zip.

This is likely the best medium-term route for the generated Korean bank.

### WSOLA / SoundTouch / Rubber Band-style stretching

General-purpose time-stretch and pitch-shift libraries are useful for tooling,
but they are not automatically ideal for Korean consonant clarity. They should
be treated as candidates, not magic. Licensing matters too: Rubber Band is GPL
unless commercially licensed, while SoundTouch is LGPL.

## Neural Singing Route

Commercial-grade modern vocal synths are closer to score-conditioned singing
voice synthesis than to classic WAV concatenation.

The concrete long-term execution plan now lives in
[`NEURAL_SINGER_ROADMAP.md`](NEURAL_SINGER_ROADMAP.md).

Two useful open references:

- NNSVS: an open-source neural singing voice synthesis toolkit. Its docs
  describe custom voicebank creation and a pipeline using models plus vocoders.
- DiffSinger: a diffusion-based singing voice synthesis system conditioned on a
  musical score/lyrics/F0 style pipeline.

For WebUtau, neural singing would mean:

- Build or license a Korean singing dataset, not only TTS speech.
- Align lyrics to phonemes and musical timing.
- Train or fine-tune duration, pitch/acoustic, and vocoder components.
- Export a browser-usable or server-renderable model.
- Add clear model and voice licensing.

This is the path toward "$150 product" quality, but it is a product-scale
project, not a small patch. The immediate WebUtau path should keep improving
the sample bank while keeping the architecture open to a later neural singer
mode.

Public Korean singing data and public Korean speech data serve different jobs:

- CSD and GTSinger can exercise the singing voice synthesis path because they
  contain sung audio and music-oriented labels.
- KSS and Zeroth-Korean are speech corpora. They are useful for Korean text
  normalization, phoneme dictionary coverage, pronunciation/listening tests,
  and ASR-style auxiliary checks.
- Speech corpora should not be treated as a substitute for a Korean singing
  dataset. They do not teach the model stable sung vowels, note-following
  behavior, vibrato, or phrase-level singing dynamics.

Current experiment status:

- A DiffSinger/OpenVPI smoke path now reaches local WAV export for the fixed
  phrase `도히도히 다이스키`.
- CSD Korean is now locally acquired and verified as a research-only baseline:
  100 WAV files, 9,072.38 seconds / 2.52 hours of known Korean audio, and
  100/100 paired annotations. It is CC BY-NC-SA 4.0, so it remains
  noncommercial research data rather than public release evidence.
- GTSinger Korean acquisition was expanded from a first-page partial download
  to a full Hugging Face Korean sparse checkout: 12,276 Korean files, 3,327 WAV
  files, complete processed Korean metadata, and zero missing `wav_fn` or
  `speech_fn` references across 2,295 metadata rows.
- The GTSinger processed-metadata path now prepares all 2,295 rows / 8.27 hours
  into DiffSinger format with hard-linked WAVs and passes a non-production
  enhanced-dataset audit. Full DiffSinger binarization now succeeds, producing
  a 2.4 GB binary dataset. A CPU 1-step train smoke reaches `max_steps=1`,
  validates all 115 validation items, and writes a step-1 checkpoint. This is
  still pipeline evidence, not a usable singer voice.
- KSS is present locally as the Hugging Face parquet distribution: 9 files,
  including 7 parquet shards, 3,808,712,260 bytes verified by size and SHA-256
  manifest. It is CC BY-NC-SA 4.0 and speech-only auxiliary data.
- Zeroth-Korean is tracked through `npm run neural:download-openslr-korean --
  --preset zeroth-korean --summary`. OpenSLR SLR40 lists CC BY 4.0 and 51.6
  train hours plus 1.2 test hours. The local archive is present at
  10,339,720,618 bytes with SHA-256
  `6e109897f4d866eb1a3d31cbb2220c0b5e3dc74704208189ecc3bec787740e5f`.
- Seoul Corpus is also present locally as original OpenSLR archives:
  `readme.tgz`, `label.tgz`, and `sound.tgz`, 2,675,209,286 total bytes
  verified by size and SHA-256 manifest. It is CC BY-NC 2.0, so keep it
  noncommercial auxiliary evidence only.
- Pansori-TEDxKR and Deeply Korean read speech are tracked as lower-priority
  OpenSLR presets. NoDerivatives corpora stay reference-only.
- The next quality jump requires a longer licensed Korean singing dataset and a
  real GPU training run, not more browser-side beep synthesis.

## Recommended WebUtau Roadmap

### Phase 1: Fix the current generated CV bank

- Add full voiced-body F0 diagnostics for every generated sample.
- Preserve consonant onset, but pitch-correct the entire vowel body to C4.
- Generate stable corrected sustain loops from the pitch-corrected body.
- Store diagnostic JSON in the zip manifest or a sidecar during generation.
- Add regression checks for `도히도히 다이스키` and a Korean coda phrase.
- Keep batchim audio out of sustain loops. Long notes should loop the vowel
  body and play any final consonant tail once at release.

### Phase 2: Korean CVVC-lite

- Keep the CV bank for compatibility.
- Generate or record common `VC` final-consonant tails.
- Update the lyric matcher/phonemizer to preserve batchim instead of always
  reducing to CV.
- Add visible coverage reporting for coda support.

### Phase 3: Multipitch and expression

- Add at least low/mid/high base samples.
- Pick closest source pitch before transposition.
- Add one expressive layer only after the neutral layer is clear.

### Phase 4: Higher-quality offline resynthesis

- Try WORLD-based offline correction for all generated WAVs.
- Compare against PSOLA/WSOLA output with objective F0 drift and subjective
  listening tests.
- Keep browser runtime simple by shipping the corrected WAVs.

### Phase 5: Neural mode

- Prototype server-side or local ONNX neural singing render.
- Treat this as a separate renderer mode, not a replacement for UTAU import.
- Do not ship any model or generated voice without a license review.

## Production Rules

- Never clip consonants while cropping.
- Never use amplitude leveling as a substitute for pitch correction.
- Never loop an unstable falling vowel and expect it to become musical.
- Treat unvoiced consonants as timing/texture, not pitched material.
- Version every bundled zip URL whenever WAV content changes.
- Keep TTS/model attribution and license files inside the voicebank zip.
- Keep user-imported singer zips private to the user's browser/account.

## Source Notes

- OpenUtau official repository: describes OpenUtau as an open UTAU successor,
  with phonemizers for VCV/CVVC/Arpasing/Korean and WORLDLINE-R curve tuning:
  https://github.com/openutau/OpenUtau
- OpenUtau phonemizer wiki: phonemizers convert notes/lyrics into phonemes and
  can split notes into multiple independently editable phonemes:
  https://github-wiki-see.page/m/openutau/OpenUtau/wiki/Phonemizers
- OpenUtau `Oto` source: documents offset, fixed consonant, cutoff,
  preutterance, and overlap fields:
  https://github.com/openutau/OpenUtau/blob/master/OpenUtau.Core/Classic/VoiceBank.cs
- OpenUtau Korean CV phonemizer source:
  https://github.com/openutau/OpenUtau/blob/master/OpenUtau.Plugin.Builtin/KoreanCVPhonemizer.cs
- WORLD vocoder: F0, spectral envelope, aperiodicity analysis/synthesis:
  https://github.com/mmorise/World
- PyWORLD API example for `dio`, `stonemask`, `cheaptrick`, `d4c`, and
  `synthesize`:
  https://github.com/JeremyCCHsu/Python-Wrapper-for-World-Vocoder
- PSOLA reference: Moulines and Charpentier, "Pitch-synchronous waveform
  processing techniques for text-to-speech synthesis using diphones":
  https://researchportal.ip-paris.fr/en/publications/pitch-synchronous-waveform-processing-techniques-for-text-to-spee/
- NNSVS docs and paper:
  https://nnsvs.github.io/
  https://arxiv.org/abs/2210.15987
- DiffSinger official implementation and paper:
  https://github.com/MoonInTheRiver/DiffSinger
  https://arxiv.org/abs/2105.02446
- Supertonic 3 model card and license:
  https://huggingface.co/Supertone/supertonic-3
  https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE
- SoundTouch and Rubber Band licensing/usage references:
  https://www.surina.net/soundtouch/
  https://github.com/breakfastquay/rubberband
