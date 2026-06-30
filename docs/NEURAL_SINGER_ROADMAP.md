# WebUtau Neural Korean Singer Roadmap

Working goal: build a high-quality Korean neural singing voice path for WebUtau,
while preserving the existing UTAU/OpenUtau import path.

This is a long-running engineering document. Keep it updated as work lands.

## Goal Prompt

Use this prompt to continue the work in a future Codex run:

```txt
You are working in /Users/hckim/Documents/webuta.

Goal: build a production-track Korean neural singing renderer for WebUtau. The
target user should be able to type Korean lyrics, edit notes in WebUtau, render
a clear sung Korean vocal line, download the WAV, and keep the existing
UTAU/OpenUtau voicebank import path intact.

Start from docs/NEURAL_SINGER_ROADMAP.md and execute the checklist in order.
Prefer OpenVPI DiffSinger for the first serious prototype, keep NNSVS/ESPnet as
comparison baselines, and document every data/license decision. Do not commit
large datasets, checkpoints, generated training audio, or third-party voice
assets. Put local-heavy artifacts under ignored experiment paths. Verify each
milestone with concrete commands, objective audio diagnostics, and a browser
WAV render smoke test when the WebUtau UI is touched.
```

## Product Definition

The neural singer path is successful when WebUtau can:

- Convert a WebUtau project into a neural singer input representation.
- Render Korean lyrics with note durations and target pitches.
- Preserve intelligible Korean consonants and stable sung vowels.
- Export a 44.1 kHz WAV from the browser UI.
- Show that a renderer is neural/server-side, not the local UTAU sample renderer.
- Keep user-imported UTAU/OpenUtau singers working as before.
- Keep voice/model licensing visible and auditable.

This is not a replacement for UTAU compatibility. It is a second rendering mode.

Non-negotiable production rule: the real Korean singer must come from a
license-reviewed Korean singing dataset or consent-reviewed private recordings.
Browser TTS, hand-built beeps, fake neural smoke servers, and CSD smoke
checkpoints are useful for wiring and diagnostics only; they are not the voice
product.

Use `npm run neural:audit-roadmap` as the top-level completion gate. It is
intentionally stricter than the individual smoke tests: a passing acquisition
smoke, browser smoke, or CSD research checkpoint does not complete this roadmap
unless the real licensed Korean dataset, production-track checkpoint, render
profile, compatibility contract, and release evidence are all present.

## Architecture Target

```txt
WebUtau Svelte UI
  -> project JSON / USTx-like score
  -> Korean lyric-to-phoneme adapter
  -> neural singer render request
  -> server or local worker model runtime
  -> WAV result
  -> browser playback/download/share
```

Initial rendering should be server-side or local desktop-side. Browser-only
inference is a later optimization because iPad runtime, model size, WebGPU
availability, and ONNX compatibility are product risks.

## Technical Strategy

### Primary path: OpenVPI DiffSinger

Use OpenVPI/DiffSinger for the first production-track prototype because the
tooling is close to how modern community singing voice models are built.

Useful official starting points:

- MakeDiffSinger: https://github.com/openvpi/MakeDiffSinger
- OpenVPI dataset tools: https://github.com/openvpi/dataset-tools
- OpenVPI organization: https://github.com/openvpi

### Comparison path: NNSVS / ENUNU

Keep NNSVS as a comparison and compatibility-oriented path. Its docs describe it
as research-purpose software and point non-developers toward more user-friendly
ENUNU-style tooling, so it is useful but probably not the most direct product
route.

Starting points:

- NNSVS docs: https://nnsvs.github.io/
- NNSVS repo: https://github.com/nnsvs/nnsvs

### Benchmark path: ESPnet SVS

Use ESPnet SVS recipes for comparison experiments and score-format sanity
checks, not as the primary WebUtau product path.

Starting points:

- ESPnet SVS recipe docs: https://espnet.github.io/espnet/recipe/svs1.html
- ESPnet repo: https://github.com/espnet/espnet

## Data Strategy

High-quality singing voice synthesis is data-bound. GPU time helps, but it does
not replace clean singing recordings, alignment, and rights.

Current product constraint: the user will not provide singer recordings. Private
recording tooling can stay as a pipeline prototype, but it is not an active path
for the WebUtau default voice. The releasable default must come from a
license-clean public dataset path or a fully generated/synthetic voicebank path.

### Candidate datasets

- Primary licensed dataset-first path: AI Hub guide-vocal / singing datasets.
  - Use `aihub-guide-vocal` as the first intake target because the AI Hub
    `dataSetSn=473` page exposes singing-oriented WAV/MIDI/CSV note metadata
    that maps well to SVS alignment.
  - Use `aihub-multispeaker-singing` (`dataSetSn=465`) as the broader Korean
    singing corpus candidate after access and terms review.
  - These require account/access/license review before local training is
    enabled; generated-model and public-demo rights must be checked separately.
  - `npm run neural:prepare-dataset-intake -- --preset aihub-guide-vocal`
    creates an ignored local intake folder, license-review template, and local
    registry template.
  - After downloading provider archives, run
    `npm run neural:audit-provider-drop -- --registry <local-aihub-registry>
    --dataset aihub-guide-vocal --production` before extraction. This confirms
    the raw drop has supported archive types, the expected archive count, and a
    non-placeholder total size, and records SHA-256 hashes for the original
    archives. The current AI Hub guide-vocal template uses a conservative 1 GiB
    minimum until the exact provider package size is confirmed from the
    download page or license paperwork. The roadmap completion audit requires
    this hashed provider-drop evidence before the dataset counts as acquired.
  - After provider-drop audit or manual extraction, run
    `npm run neural:inspect-intake -- --registry <local-aihub-registry>
    --dataset aihub-guide-vocal` before audit/ingest. The inspector reports raw
    archives, extracted audio, ignored guide WAVs, same-stem annotation pairing,
    structured CSV/JSON note metadata, and whether a dataset-specific mapping
    adapter is still needed.
  - If provider metadata is global rather than same-stem, run
    `npm run neural:materialize-sidecars -- --registry <local-aihub-registry>
    --dataset aihub-guide-vocal --report <work-report>.json`. This groups
    CSV/JSON note rows by referenced audio filename and writes ingest-compatible
    sibling `metadata/<audio-stem>.csv` sidecars without modifying raw archives.
  - Do not treat a download as training-ready until the dataset audit passes
    both gates: license review fields are filled and at least 95% of non-guide
    WAV files have paired same-stem `.txt`, `.lab`, `.json`, or `.csv`
    annotations, including CSD/AIHub-style sibling `lyric/`, `csv/`, `json/`,
    or `metadata/` directories.
- Public research baseline: CSD / Children's Song Dataset from KAIST.
  - Korean and English children's songs.
  - Useful for Korean SVS baseline work and pipeline validation.
  - Zenodo record 4916302 lists CC BY-NC-SA 4.0 and describes it as primarily
    for research purposes.
  - Local acquisition command:
    `npm run neural:download-csd -- --summary`.
  - Current local manifest:
    `experiments/neural-singer/datasets/csd/csd.manifest.json`.
    `CSD.zip` is present at 1,851,131,390 bytes, MD5
    `74d121dd8706fded26a15526a379f7a2`, and the extracted Korean subset has
    100 WAV, 100 CSV, 100 lyric, 100 MIDI, and 100 TXT files.
  - Current dataset audit passes with 100 WAV files, 9,072.38 seconds / 2.52
    hours of known Korean audio, and 100/100 paired annotations.
  - Treat it as local research/smoke-test data only until derivative model
    publishing terms are separately reviewed.
- Public research baseline: GTSinger Korean subset.
  - Hugging Face hosts the full GTSinger corpus and processed per-language
    metadata.
  - Local acquisition command:
    `npm run neural:download-gtsinger-korean -- --concurrency 2 --retries 12
    --retry-base-delay-ms 4000 --summary`.
  - The downloader now follows Hugging Face `Link: rel="next"` pagination and
    retries 429/5xx responses. This matters because the earlier first-page
    slice only produced 227 files / 60 WAV / about 120.7 MB.
  - Full Korean target manifest: 12,281 files, including 3,327 WAV, 3,330 JSON,
    3,327 TextGrid, 2,295 MusicXML, and Korean processed metadata, about 5.86
    GB total.
  - Current full local acquisition uses `git-lfs` sparse checkout at
    `.local/neural-singer/gtsinger-lfs`. The refreshed local manifest now
    resolves 12,281/12,281 target files, including 3,327 WAV, 3,330 JSON,
    3,327 TextGrid, 2,295 MusicXML, and repo docs, with 5,859,168,986 present
    bytes. All 2,295 processed metadata `wav_fn` and `speech_fn` rows resolve
    locally.
  - Current processed-metadata DiffSinger path bypasses fragile MFA for
    GTSinger: 2,295 items, 29,779.96 seconds / 8.27 hours of valid WAV, 71
    phone symbols, AP and SP present, zero skipped metadata rows, and enhanced
    dataset audit passes with `--max-phone-duration 12` because long AP/SP
    pauses are legitimate.
  - Current full-binary training smoke: DiffSinger binarization succeeds on
    the full processed-metadata baseline. The generated binary dataset is
    2.4 GB, with 115 validation items, 2,180 training items, 1,364.76
    validation seconds, 28,401.81 train seconds before augmentation, and
    54,271.51 train seconds after augmentation.
  - CPU 1-step train smoke reaches `max_steps=1`, validates across all 115
    validation items, and writes
    `experiments/neural-singer/work/gtsinger-korean-diffsinger-training-full/train-smoke-full-binary/model_ckpt_steps_1.ckpt`.
    This is pipeline evidence only, not a production-quality voice.
  - Current local research candidate: MPS 6000-step ramp training writes
    `experiments/neural-singer/work/gtsinger-korean-diffsinger-training-full/train-mps-ramp-6000/model_ckpt_steps_6000.ckpt`.
    It resumes from the 3000-step checkpoint, reaches validation loss
    `0.41262`, passes checkpoint/render-profile audit, passes actual Svelte
    browser smoke against `http://127.0.0.1:8790/render`, and passes 5/5 fixed
    Korean objective quality gates. The ramp3000 vs ramp6000 comparison reports
    `decision=candidate-promote` with 1 improved phrase, 4 neutral phrases, and
    no blocking regressions.
  - License is CC BY-NC-SA 4.0. Use it for research/noncommercial local
    training only; do not use it as public model release evidence without a
    separate rights review.
- Auxiliary Korean speech corpus: KSS / Korean Single Speaker Speech Dataset.
  - Public Korean TTS corpus with 12,853 WAV files and 12+ hours of speech.
  - Useful for pronunciation, Korean normalization, or auxiliary speech
    experiments only.
  - Local acquisition command:
    `npm run neural:download-kss -- --summary --concurrency 2`.
  - Current local manifest:
    `experiments/neural-singer/datasets/kss-korean-speech/kss.manifest.json`.
    The Hugging Face parquet distribution is present as 9 files, including 7
    parquet shards, with 3,808,712,260 bytes verified by size and SHA-256
    manifest.
  - Current dataset audit passes as speech-only auxiliary evidence with
    `allowedActions.localTraining=false`; add a parquet-to-WAV/text adapter
    before using it for acoustic or pronunciation experiments.
  - It is not singing data, and it is also NC-SA/noncommercial, so it must not
    satisfy the production singing dataset milestone by itself.
- Auxiliary Korean speech corpus: Zeroth-Korean / OpenSLR SLR40.
  - Public Korean ASR corpus with transcribed speech, lexicon, and language
    model assets.
  - OpenSLR SLR40 lists the license as CC BY 4.0 and describes 51.6 train
    hours plus 1.2 test hours.
  - Local acquisition command:
    `npm run neural:download-openslr-korean -- --preset zeroth-korean --summary`.
  - Current local manifest:
    `experiments/neural-singer/datasets/zeroth-korean-speech/zeroth-korean.manifest.json`.
    The original archive is present at 10,339,720,618 bytes with SHA-256
    `6e109897f4d866eb1a3d31cbb2220c0b5e3dc74704208189ecc3bec787740e5f`,
    and the speech-only auxiliary registry audit passes.
  - It is not singing data, so it is useful for Korean pronunciation/front-end
    and ASR/listening checks, not for completing the singing dataset milestone.
- Auxiliary/reference Korean speech candidates from OpenSLR.
  - `seoul-corpus`: CC BY-NC 2.0 spontaneous speech with TextGrid labels;
    the original `readme.tgz`, `label.tgz`, and `sound.tgz` archives are
    present locally with 2,675,209,286 total bytes verified by size and
    SHA-256 manifest. Use only after noncommercial auxiliary-use review.
  - `pansori-tedxkr`: CC BY-NC-ND 4.0; reference-only because NoDerivatives
    makes model training/derivative release risky.
  - `deeply-korean-read`: CC BY-NC-ND 4.0; reference-only for the same reason.
  - `deeply-parent-child-vocal`: CC BY-NC-ND 4.0 Korean parent/child vocal
    interaction sample. It includes singing labels, so it is useful discovery
    evidence for Korean vocal data, but NoDerivatives keeps it out of the
    training set unless separate rights are obtained.
  - Keep downloading and hashing these small public reference corpora even when
    they are not trainable. The point is to make dataset discovery concrete:
    present locally, audited, and tagged with the exact blocker.
- Public dataset discovery audit:
  - `npm run neural:audit-public-datasets -- --report
    experiments/neural-singer/work/public-dataset-discovery-audit.json`
    currently reports `decision=public-dataset-discovery-ready`.
  - `npm run neural:audit-roadmap` now includes this report as the optional
    `public-dataset-discovery` check, so public discovery progress is visible
    without weakening the production completion gates.
  - The audit covers 8 locally present public candidates. CSD and GTSinger are
    the only ready Korean singing research baselines; KSS, Zeroth, and Seoul
    are speech auxiliaries; Pansori, Deeply Korean read, and Deeply
    parent-child vocal interaction are reference-only.
  - The current conclusion is intentional and important: no acquired public
    Korean dataset is production-release evidence for a WebUtau neural singer.
    Completion still requires AI Hub terms approval or another license-clean
    source that does not depend on user-provided recordings.
- Licensed Korean singing dataset: AI Hub multi-speaker singing data.
  - Useful if access and terms allow model training for this project.
  - Review license, account access, redistribution, and generated-model terms.
- Original recorded singer:
  - Inactive for the current goal because the user will not record a voice.
  - Keep this only as a future contributor path for a distinct WebUtau voice
    when a consent-reviewed singer explicitly wants to participate.
  - Requires written consent and release terms.
  - Needs a recording script, quiet room, pitch guide, and consistent mic setup.
  - `npm run neural:prepare-private-singer` now generates an ignored recording
    capture kit with cue sheet, lyric sidecars, consent template, and a private
    registry template. It also writes per-take USTX JSON score guides and
    neural render request fixtures so recorded audio has a reproducible
    pitch/timing reference.
  - `npm run neural:audit-prompt-coverage` checks the capture kit before
    recording. It verifies take count, estimated minutes, prompt/tag diversity,
    key balance, full Korean onset/vowel coverage, broad batchim coverage,
    score request coverage, and pitch range.
  - `npm run neural:prepare-guides` renders ignored headphone guide WAVs from
    those request fixtures so the singer has count-in clicks and target pitches
    while recording. These guide WAVs are never training data, and audit/ingest
    excludes `guides/`, `guide-tracks/`, and `*.guide.wav` artifacts. Full
    guide regeneration removes stale guide WAVs that are no longer in the
    current session manifest.
  - `npm run neural:serve-recorder` starts a local browser recording companion
    for the pack. It shows each take, plays the matching headphone guide,
    records dry microphone audio, and saves the WAV to the exact expected
    `wavs/*.wav` path.
  - `npm run neural:audit-recordings` compares recorded WAVs against each
    take's neural request guide. It gates duration, clipping, RMS, silence, F0
    coverage, pitch error, onset timing, missing onsets, and headphone-guide
    lyric tick leakage so guide audio does not contaminate training data.
  - `npm run smoke:recorder` creates a temporary capture pack, generates a
    guide, opens the recorder in Chromium, checks desktop/mobile layout, and
    saves a synthetic WAV through the browser upload path before a real session.
  - `npm run smoke:training-pipeline` creates a temporary consent-reviewed
    smoke pack, writes synthetic score-following dry vocals, then verifies the
    recording audit, dataset audit, ingest, readiness, and OpenVPI seed steps.
    This is a pipeline-shape proof, not a production voice-quality proof.

### Minimum data targets

- Pipeline smoke test: 5-10 minutes of aligned singing.
- First Korean prototype: 30-60 minutes of clean single-singer material.
- Usable single voice: 3-5 hours of clean, varied singing.
- Strong single voice: 10-30 hours with consistent recording and coverage.

### Compute target

Current local workstation snapshot from 2026-06-30:

- Apple M1 Pro, arm64
- 34 GB RAM
- Apple integrated 16-core GPU with Metal support

Use this Mac for dataset preparation, WebUtau integration, local render service
smoke tests, and small CPU/MPS experiments. Use a remote or cloud CUDA GPU as
the first serious DiffSinger training target.

## Repository Rules

- Do not commit raw datasets.
- Do not commit third-party model checkpoints unless the license explicitly
  allows it and the repo has a release plan.
- Do not commit generated heavy experiment outputs.
- Keep small metadata schemas, manifests, conversion scripts, and docs in git.
- Put local data/checkpoints under ignored paths such as:
  - `.local/neural-singer/`
  - `experiments/neural-singer/runs/`
  - `experiments/neural-singer/datasets/`
  - `experiments/neural-singer/checkpoints/`
- Every external dataset/model needs a license note before use.

## Milestone Checklist

### M0. Planning and guardrails

- [x] Create `docs/VOICEBANK_METHODOLOGY.md`.
- [x] Create this long-running neural singer roadmap.
- [x] Add ignored local experiment paths.
- [x] Add a dataset/model license registry template.
- [x] Add a small neural experiment README/runbook.
- [x] Decide whether first compute target is local Mac, remote GPU, or cloud GPU.
- [x] Record available GPU/RAM assumptions.

Exit criteria:

- A future agent can start without re-asking the whole strategy.
- Heavy assets have a safe local destination outside git.

### M1. Score and phoneme interface

- [x] Define WebUtau neural render input JSON.
- [x] Include notes, lyrics, MIDI pitch, duration seconds, and tempo.
- [x] Include explicit rests.
- [x] Include optional pitch curves.
- [x] Implement Korean Hangul decomposition helper if current code is not enough.
- [x] Implement Korean lyric-to-phoneme prototype.
- [x] Map rests/silence consistently.
- [x] Map breaths consistently.
- [x] Add tests for:
  - [x] `도히도히 다이스키`
  - [x] Korean batchim phrase
  - [x] mixed Korean/Japanese loanword phrase
  - [x] rests
  - [x] note ties
  - [x] breaths

Exit criteria:

- WebUtau project data can be exported into a deterministic neural input JSON.
- Unit tests prove Korean syllable handling does not silently drop coda data.

### M2. Dataset ingestion prototype

- [x] Create dataset manifest schema:
  - dataset id
  - source URL/path
  - license summary
  - redistribution status
  - singer identity status
  - audio count/duration
  - annotation type
  - allowed training/publishing actions
- [x] Build an audit script for local dataset manifests and audio inventory.
- [x] Build an ingestion script for a small local dataset.
- [x] Exclude generated headphone guide WAVs from audit duration gates and
  ingest segment generation.
- [x] Extract Korean lyric coverage from sidecar `.txt`, `.lab`, `.json`, and
  `.csv` annotations so AI Hub-style note labels can feed the first ingest
  diagnostics.
- [x] Add `--limit-files` for quick sorted-slice ingest before running a large
  dataset through full audio/F0 diagnostics.
- [x] Normalize audio to a consistent sample rate for analysis.
- [x] Slice long audio into segments.
- [x] Store segment metadata without committing audio.
- [x] Add objective data checks:
  - [x] duration distribution
  - [x] peak/RMS range
  - [x] silence ratio
  - [x] estimated pitch coverage
  - [x] lyric/phoneme coverage

Current limitation:

- The first ingestion script supports PCM/float WAV files. FLAC/MP3 decoding can
  be added after the first licensed dataset is chosen.

Exit criteria:

- At least one local dataset can be inspected and summarized reproducibly.
- No restricted audio is committed.

### M3. DiffSinger/OpenVPI baseline

- [x] Create a separate local Python environment for DiffSinger tooling.
- [x] Clone or install OpenVPI dataset tools outside app runtime dependencies.
- [x] Convert WebUtau ingestion output into an OpenVPI/MakeDiffSinger
  pre-alignment seed corpus.
- [x] Generate a Korean MFA pronunciation dictionary and phone inventory from
  seed `.lab` labels.
- [x] Download official MFA `korean_mfa` acoustic and dictionary models into an
  ignored project-local MFA root.
- [x] Add an audit script for seed `.lab` coverage against official MFA
  dictionaries.
- [x] Add a CSD Korean smoke-corpus converter that turns CSD CSV/lyrics/WAV
  into short MFA/OpenVPI seed segments.
- [x] Add a dictionary augmentation helper for MFA G2P-generated OOV entries.
- [x] Add a dictionary simplifier for MakeDiffSinger scripts that require
  `word<TAB>phones` rows.
- [x] Add a public GTSinger Korean downloader and local registry writer.
- [x] Download, audit, ingest, and readiness-check GTSinger Korean as a public
  research baseline.
- [x] Add a public dataset discovery audit that classifies acquired Korean
  audio candidates as research singing baseline, speech auxiliary, or
  reference-only, without weakening production completion gates.
- [x] Repair MakeDiffSinger enhanced `transcriptions.csv` files where blank
  phone intervals were serialized as double spaces.
- [x] Convert a small dataset into final DiffSinger-compatible training data
  after MFA/TextGrid alignment.
- [x] Add a reusable DiffSinger training-run preparation step for real
  AIHub/private enhanced datasets.
- [x] Add a production preflight gate so training-run preparation cannot pass
  as a real candidate without readiness evidence, dataset lineage, provider
  archive provenance, enough minutes/items, and a meaningful update budget.
- [x] Add a portable DiffSinger GPU job bundle generator that rewrites the
  training config for a remote CUDA workdir, emits guarded upload/run/download
  scripts, and keeps dataset upload behind an explicit license-review
  acknowledgement.
- [x] Document seed-corpus commands in the experiment README.
- [x] Train or fine-tune the smallest viable baseline.
- [x] Run inference on a fixed WebUtau demo phrase.
- [x] Export WAV outputs to ignored experiment folders.
- [x] Save objective diagnostics:
  - [x] F0 tracking vs target note
  - [x] phoneme/duration alignment
  - [x] loudness and clipping
  - [x] render time

Exit criteria:

- A Korean phrase can be rendered by a neural model from note/lyric input.
- The result is archived locally with diagnostics and license notes.

Current local status:

- `npm run neural:setup-openvpi` cloned MakeDiffSinger and dataset-tools into
  `.local/neural-singer/openvpi/`.
- The ignored tooling manifest records exact upstream commits.
- `npm run neural:setup-mfa -- --create-env --install-makediffsinger-reqs`
  installed local micromamba, Python 3.8.20, MFA 2.0.6, and MakeDiffSinger
  acoustic alignment Python requirements under `.local/neural-singer/mamba/`.
- `npm run neural:prepare-mfa-dictionary -- --seed-dir path/to/openvpi-seed`
  generates `korean.dict`, `phones.txt`, and an OOV report from Korean `.lab`
  labels.
- Official MFA `korean_mfa` acoustic and dictionary models are downloaded under
  `.local/neural-singer/mfa-root/pretrained_models/`.
- `npm run neural:audit-mfa-labels -- --seed-dir path/to/openvpi-seed
  --dictionary .local/neural-singer/mfa-root/pretrained_models/dictionary/korean_mfa.dict`
  checks whether seed labels are covered by the official Korean MFA dictionary.
- `npm run neural:prepare-csd-smoke -- --csd-root
  experiments/neural-singer/datasets/csd/extracted/CSD/korean --ids kr007a`
  builds a research-only CSD smoke corpus under ignored experiment paths.
- The full CSD Korean subset is now extracted locally under ignored dataset
  paths: 100 WAV, 100 CSV, and 100 lyric files. `npm run
  neural:prepare-csd-smoke -- --ids all --limit 10 --out
  experiments/neural-singer/work/csd-mfa-baseline-10` produced a broader
  research baseline seed with 10 recordings, 72 segments, and about 703.86
  seconds of audio.
- Generic ingest on the same first 10 sorted CSD WAV files with `--limit-files
  10` produced `experiments/neural-singer/work/csd-korean-research-ingest-slice`:
  108 segments, about 828.92 seconds, 10/10 annotated files, 1450 Hangul
  syllables, 153 unique Hangul syllables, and 38 unique Korean phoneme symbols.
  `npm run neural:audit-readiness -- --min-minutes 10 --min-unique-phonemes 30`
  passed for this research slice.
- GTSinger Korean is now acquired through `git-lfs` sparse checkout at
  `.local/neural-singer/gtsinger-lfs`: 12,276 Korean files, 3,327 WAV files,
  20 MB of processed Korean metadata, and zero missing `wav_fn`/`speech_fn`
  rows across the 2,295 processed metadata records.
- `npm run neural:prepare-gtsinger-diffsinger -- --repository
  .local/neural-singer/gtsinger-lfs --out
  experiments/neural-singer/work/gtsinger-korean-diffsinger-full --link-audio
  --force` produced a full hard-linked DiffSinger dataset: 2,295 items,
  29,779.96 seconds / 8.27 hours of valid WAV, 71 phone symbols, AP/SP present,
  and max duration drift 0.0005 seconds.
- `npm run neural:audit-enhanced-dataset -- --dataset-dir
  experiments/neural-singer/work/gtsinger-korean-diffsinger-full --min-items
  2295 --min-total-seconds 29779 --max-phone-duration 12` passes with
  `decision=enhanced-dataset-ready`, 2,295/2,295 WAV items, no duplicate names,
  and no unreferenced WAVs. The older 60-WAV generic ingest and 7-item
  MFA/MakeDiffSinger subset are now historical pipeline evidence only.
- `npm run smoke:dataset-pipeline` now verifies the dataset-first preparation
  path on the CSD Korean research baseline: dataset rights/annotation audit,
  10-file ingest slice, readiness gates, OpenVPI seed generation, Korean MFA
  dictionary generation, and MFA label coverage. The current run passed with
  100/100 paired annotations, 108 seed labels, 153 dictionary entries, 38 phone
  symbols, and 0 MFA OOV tokens.
- `npm run neural:inspect-intake` now verifies the first acquisition step for
  licensed datasets. It makes AI Hub/raw zip presence, extraction status,
  structured note metadata, annotation pairing, and ingest readiness visible in
  a JSON report before local training is enabled.
- `npm run neural:audit-provider-drop` now verifies the raw provider archive
  drop before extraction. Production handoff runs it automatically and blocks
  tiny placeholder/sample archives before they can masquerade as acquired
  training data. It also records SHA-256 hashes for each raw archive so later
  training manifests can be traced to exact provider files.
- `npm run neural:materialize-sidecars` now bridges provider-level CSV/JSON
  note metadata into per-audio sidecars. It supports AIHub-style audio filename,
  Korean lyric, timing, and pitch fields, refuses ambiguous duplicate basenames,
  skips existing sidecars by default, and its tests verify that generated
  sidecars are immediately readable by `ingest-dataset`.
- CSD `kr007a` was converted into 5 MFA segments, aligned with MFA 3.3.8 and
  official `korean_mfa`, enhanced through MakeDiffSinger `enhance_tg.py`, and
  built into `experiments/neural-singer/work/csd-mfa-smoke/diffsinger-dataset-enhanced/`.
- The official `korean_mfa` model uses an IPA-like phone set. The generated
  WebUtau `korean.dict` uses WebUtau's simpler internal phone set, so it should
  only be used with a custom acoustic model trained for that inventory.
- `npm run neural:setup-diffsinger -- --create-env --install-torch
  --install-requirements` created a local `webuta-diffsinger` Python 3.10
  environment under `.local/neural-singer/mamba/envs/webuta-diffsinger/`.
  Verified runtime imports include `torch 2.12.1`, `lightning 2.3.3`,
  `librosa 0.9.2`, `parselmouth 0.4.3`, `pyworld 0.3.4`, and `numpy 1.26.4`.
- `npm run neural:prepare-diffsinger-smoke` generated a compact DiffSinger
  config and dictionary under
  `experiments/neural-singer/work/csd-diffsinger-smoke/`.
  The compact dictionary is required because DiffSinger fails binarization when
  a dictionary contains phonemes not observed in the tiny smoke corpus.
- `npm run neural:prepare-diffsinger-training` now prepares a reusable
  production-track training folder from any enhanced DiffSinger dataset with
  `transcriptions.csv`: compact dictionary, training `config.yaml`, runbook,
  `diffsinger-training.manifest.json`, and a
  `model-checkpoint.template.json` for the later checkpoint audit.
- The same command now validates any attached `training-readiness` report and
  supports `--production`, which blocks real candidate preparation unless the
  dataset lineage is declared, readiness passes, hashed provider-drop evidence
  is attached, analyzed minutes and enhanced training-item counts meet the
  configured thresholds, and the update budget is large enough for a non-smoke
  run.
- `npm run neural:prepare-diffsinger-gpu-job` now turns a prepared
  `diffsinger-training.manifest.json` into a portable GPU training bundle with
  `training/config.remote.yaml`, `upload-to-gpu.sh`, `training/run-on-gpu.sh`,
  `download-checkpoint.sh`, and `gpu-job.manifest.json`. The upload script
  refuses to transfer a dataset until `WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD=1`
  is set after license review, and production-preflight bundles require the
  provider archive-drop audit path so the remote training job keeps original
  archive provenance.
- DiffSinger `scripts/binarize.py` succeeded on the CSD smoke dataset:
  4 training segments, 1 validation segment, 38 observed phones, 19.88 seconds
  train duration, and 6.65 seconds validation duration.
- A 1-step acoustic DiffSinger smoke model trained successfully and wrote
  `model_ckpt_steps_1.ckpt` under the ignored local smoke folder.
- A 6000-step MPS DiffSinger ramp trained successfully from the full GTSinger
  Korean binary dataset and wrote `model_ckpt_steps_6000.ckpt`. It is the
  current private listening candidate, not a public/release-safe model.
- `npm run neural:prepare-diffsinger-demo` generated a fixed Korean demo `.ds`
  for `도히도히 다이스키`. DiffSinger acoustic inference produced both:
  - `outputs/demo-do-hi-do-hi.mel.pt`
  - `outputs/demo-do-hi-do-hi-vocoder.wav`
- The WAV smoke used the OpenVPI community PC-NSF-HiFiGAN 44.1 kHz Hop512
  128-bin 2025.02 vocoder downloaded into the ignored local DiffSinger
  `checkpoints/` folder. Treat that vocoder and generated smoke WAVs as local
  research artifacts unless release terms are separately reviewed.
- WAV diagnostics for the smoke output:
  - sample rate: 44.1 kHz
  - channels: mono
  - duration: about 2.786 seconds
  - peak: about 0.516
  - RMS: about 0.050
  - clipping: no

Important limitation:

- The 1-step smoke model validates the technical path. The 6000-step GTSinger
  ramp validates a private local neural listening path. Product-quality Korean
  singing still needs release-safe dataset/model rights, human listening scores,
  and longer production-track training.

### M3b. Production Korean candidate training

- [ ] Acquire or record a license-reviewed Korean singing dataset with at least
  the first-prototype target of 30-60 clean aligned minutes.
- [x] Use the full GTSinger processed-metadata route instead of the older
  partial MFA route: 2,295 items / 8.27 hours now build into a DiffSinger
  enhanced dataset and binary training set.
- [ ] Run dataset audit, ingest, readiness, OpenVPI seed generation, MFA
  alignment, and MakeDiffSinger enhancement on that dataset.
- [ ] Generate the MakeDiffSinger/MFA alignment job bundle with
  `npm run neural:prepare-makediffsinger-alignment` or via
  `npm run neural:run-dataset-handoff` once it reaches
  `alignment-ready-needs-makediffsinger`.
- [ ] Run `npm run neural:prepare-diffsinger-training -- --production` and keep
  the generated manifest/runbook under ignored experiment paths.
- [ ] Generate a GPU job bundle with `npm run neural:prepare-diffsinger-gpu-job`
  and confirm the dataset license permits private remote/GPU compute before
  upload.
- [ ] Run a real multi-thousand-step DiffSinger training job on GPU-class
  compute.
- [x] Audit the current GTSinger 6000-step research checkpoint with
  `npm run neural:audit-checkpoint`.
- [x] Promote the current GTSinger 6000-step research checkpoint with
  `npm run neural:promote-checkpoint` so the local render service, Vite
  endpoint, and release template all point at the same audited runtime.
- [x] Audit the promoted current GTSinger local render profile with
  `npm run neural:audit-render-profile -- --browser-smoke ...`; service
  command, Vite env, release template, checkpoint evidence, and actual browser
  smoke agree.
- [x] Repeat checkpoint audit, promotion, render-profile audit, and actual
  browser smoke for the first 1000-step local research quality candidate.
- [x] Render the fixed Korean quality phrase set and compare ramp100 against
  ramp1000 with objective diagnostics.
- [x] Repeat checkpoint audit, promotion, render-profile audit, quality
  comparison, and actual browser smoke for the first multi-thousand-step
  local research quality candidate.
- [x] Render the fixed Korean quality phrase set and compare ramp1000 against
  ramp3000 with objective diagnostics.
- [x] Render the fixed Korean quality phrase set and compare ramp3000 against
  ramp6000 with objective diagnostics.
- [x] Prepare the ramp6000 human listening review pack with copied WAVs,
  browser playback, and a release-audit-compatible score template.
- [ ] Complete the human listening score sheet for ramp6000.
- [ ] Repeat the same evidence chain on a license-reviewed production-track
  dataset/model candidate.
- [ ] Promote the model to the WebUtau local neural render service only after
  checkpoint, quality, browser smoke, and license gates pass.

Exit criteria:

- A real Korean model checkpoint, not a 1-step research smoke checkpoint,
  renders intelligible Korean singing from WebUtau note/lyric input.

### M4. NNSVS or ESPnet comparison

- [ ] Pick one comparison framework after M3.
- [ ] Convert the same small dataset.
- [ ] Render the same demo phrase.
- [ ] Compare:
  - setup complexity
  - Korean phoneme support
  - F0 accuracy
  - consonant clarity
  - inference speed
  - deployment feasibility

Exit criteria:

- The primary framework choice is evidence-backed, not vibes-backed.

### M5. WebUtau neural renderer contract

- [x] Add a renderer capability type for neural/server render.
- [x] Add request/response TypeScript types.
- [x] Add a disabled UI entry if no neural server is configured.
- [x] Add environment/config path for a local neural render endpoint.
- [x] Make the local render service expose checkpoint manifest model metadata
  through `/health`, and make the Svelte model panel replace the smoke
  placeholder with that live model card when the endpoint is configured.
- [x] Add server error states:
  - [x] server unavailable
  - [x] model missing
  - [x] license not accepted
  - [x] render timed out
  - [x] invalid lyric/phoneme
- [x] Add tests for renderer selection and fallback behavior.

Exit criteria:

- WebUtau can represent neural rendering as a first-class mode without breaking
  the bundled UTAU voicebank path.

Current local status:

- `VITE_WEBUTA_NEURAL_ENDPOINT=http://127.0.0.1:8787/render` enables the
  `Local Neural DiffSinger` renderer in the Svelte UI.
- When the local render service is started with `--model-manifest
  <checkpoint-manifest>`, its `/health` endpoint exposes the model id, name,
  release status, license summary, and readiness. The Svelte app fetches this
  at startup and shows the actual local checkpoint in the model panel.
- Without that endpoint, the UI shows the renderer as blocked and keeps
  browser demo / UTAU ZIP rendering available.
- `src/renderers/localNeuralRenderer.test.ts` verifies request posting, WAV
  decoding, blocked capability state, and service error propagation.
- `npm run smoke:contract` verifies that an OpenUtau-style USTX fixture with
  Hangul coda lyrics, explicit rest, tie, and breath notes survives USTX
  round-trip, neural request export, and DiffSinger `.ds` adaptation.

### M6. Local neural render service

- [x] Create a local service prototype outside the static Pages build.
- [x] Accept WebUtau neural render JSON.
- [x] Run phoneme/score conversion.
- [x] Run model inference.
- [x] Return WAV and diagnostic JSON.
- [x] Add request size/time limits.
- [x] Add local-only default binding.
- [x] Add smoke tests for a one-phrase render.

Exit criteria:

- The Svelte app can request a neural render from a local service and download
  the returned WAV.

Current local status:

- `npm run neural:serve-render -- --accept-local-research-license` starts the
  local service on `127.0.0.1:8787`.
- `GET /health` reports missing runtime paths and license acceptance.
- `POST /render` converts WebUtau neural JSON to DiffSinger `.ds`, runs
  DiffSinger acoustic inference, returns WAV base64, and writes diagnostics
  under ignored experiment work folders.
- Service smoke for `도히도히 다이스키` succeeded on 2026-06-30:
  - output WAV: `experiments/neural-singer/work/local-neural-render-smoke/2026-06-30T00-00-10.610Z-service-smoke-do-hi-do-hi/outputs/webuta-neural-render.wav`
  - sample rate: 44.1 kHz
  - channels: mono
  - bit depth: 16-bit PCM
  - duration: about 2.508 seconds
  - render time: about 4.406 seconds

### M7. Quality loop

- [x] Build a fixed phrase test set:
  - [x] `도히도히 다이스키`
  - [x] open-vowel sustain phrase
  - [x] batchim-heavy Korean phrase
  - [x] long coda sustain phrase for repeated batchim artifacts
  - [x] fast short-note phrase
  - [x] low/mid/high pitch phrase
- [x] Add F0 tracking diagnostics.
- [x] Add consonant timing diagnostics.
- [x] Add clipping/noise/loudness checks.
- [x] Keep a listening log with versioned outputs.
- [x] Define "good enough for first public beta" thresholds.
- [x] Run the full fixed phrase set after the first 1000-step local research
  model training run.
- [x] Compare at least two model checkpoints with the same phrase set.
- [x] Run the full fixed phrase set after the first multi-thousand-step local
  research model training run.
- [ ] Run the full fixed phrase set after a license-reviewed production-track
  model training run.

Exit criteria:

- Improvements can be compared by evidence instead of memory.

Current local status:

- `experiments/neural-singer/quality-phrases.json` defines the fixed phrase set
  and beta gate thresholds.
- `npm run neural:evaluate-quality -- --no-render` writes deterministic request
  fixtures without calling DiffSinger.
- `npm run neural:evaluate-quality -- --accept-local-research-license` renders
  the phrase set with the local DiffSinger service path and writes per-phrase
  diagnostics plus a versioned listening log under ignored work folders.
- The diagnostics currently include WAV peak/RMS/clipping/silence/noise-floor,
  rendered duration alignment, autocorrelation F0 tracking against target
  notes, note onset energy-lag proxy metrics, and a coda sustain burst metric
  for repeated batchim artifacts on long Korean syllables. Nasal/liquid onsets
  such as `n/m/r` are excluded from the energy-attack missing-onset gate because
  they can naturally blend into adjacent voiced material.
- Korean coda timing is now treated as a short final tail: the neural request
  ratio pushes coda phones to the end of the note, the DiffSinger adapter caps
  coda duration to 55 ms for continuants and 42 ms for stops, and the UTAU
  sample renderer keeps coda-tail audio out of the repeated sustain loop.
- Each quality run now writes `listening-scores.template.json`; copy it to an
  ignored local scores file after listening and fill reviewer/date, pass/hold
  decision, and Korean clarity, vowel stability, and artifact scores for every
  phrase.
- `npm run neural:prepare-listening-review` creates a small browser review pack
  from a rendered `quality-summary.json`, copies each phrase WAV into the pack,
  and writes `listening-scores.local.template.json` for human scoring. The
  current ramp6000 pack lives at
  `experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000/listening-review/index.html`.
- `npm run neural:compare-quality` compares two rendered `quality-summary.json`
  files and writes a promotable/hold decision with phrase-level objective
  regressions. The current ramp3000 vs ramp6000 comparison is written to
  `experiments/neural-singer/work/neural-quality/gtsinger-ramp-3000-vs-6000.json`
  and reports `decision=candidate-promote`, 1 improved phrase, 4 neutral
  phrases, and 0 blocking regressions. A new `long-coda-sustain` phrase now
  covers `연/은/꿈` style long Korean syllables so repeated batchim/coda artifacts
  stay in the fixed quality loop.
- Current coda-regression run:
  `experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000-coda-v2/quality-summary.json`
  renders all 6 phrases with the ramp6000 checkpoint and passes 6/6 objective
  gates, including `maxCodaSustainBurstCount <= 1`. Its review pack is
  `experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000-coda-v2/listening-review/index.html`.
- Human listening is still open. `ramp6000` has objective signal/timing/F0
  evidence and a prepared listening review pack, but it is not listening-passed
  until
  `experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000-coda-v2/listening-review/listening-scores.local.json`
  is filled by a human listener.
- Smoke run `smoke-1step-20260630T091620-m7` rendered the original 5 phrases and passed
  the current objective signal-health gates. This proves the evaluation loop,
  not production voice quality.
- Any non-research model handoff, including `private-family`, requires a human
  listening pass using the `minListening*Score` thresholds in
  `quality-phrases.json`, plus a license-reviewed production-track checkpoint.

### M8. Productization

- [x] Add model picker UI.
- [x] Add license/terms panel for each neural singer.
- [x] Add render progress UI.
- [x] Add cancellation.
- [x] Add retry.
- [x] Add render history for the current project.
- [x] Decide public deployment shape:
  - static-only UTAU mode
  - local neural companion app
  - hosted neural service
  - private family-only GPU server
- [x] Run accessibility and mobile layout checks.

Exit criteria:

- A non-technical user can choose the neural singer, render, listen, and export.

Current local status:

- `src/neuralModels.ts` defines neural model cards for the local DiffSinger
  smoke model and the planned production Korean voice.
- The left rail shows model/license cards and only allows selecting a neural
  model when its local endpoint is configured.
- Render success/failure is recorded in an in-app render history panel with
  renderer name, WAV summary, timestamp, and a current-project retry button.
- The top transport and bottom dock now show render progress and expose a
  cancellable render action. Browser, UTAU-sample, and local neural renderers
  accept `AbortSignal`, while the local DiffSinger service maps cancelled work
  to the stable `render-cancelled` response code.
- Deployment shape for the next public build is static GitHub Pages with
  browser demo / UTAU ZIP rendering enabled. Neural rendering stays behind a
  local companion endpoint or private family GPU service until the Korean
  singer dataset/model license is ready for public release.
- Browser smoke on `http://127.0.0.1:5173/` verified:
  - blocked local neural model is visible but not selected when no endpoint is
    configured
  - bundled UTAU rendering still creates a 7.84-second WAV
  - render history appears after rendering
  - no horizontal overflow at the default desktop viewport
- After rebasing onto `origin/main` commit `395eb3a`, `npm run lint`,
  `npm test`, and `npm run build` passed. Browser smoke verified desktop WAV
  export/history, no horizontal overflow at 1280px and 390px widths, visible
  topbar/performance keyboard/bottom dock on mobile, and zero unlabeled visible
  buttons in both checked viewports.
- `npm run smoke:browser` now starts a temporary Vite server and reruns the
  browser verification automatically. It checks the static no-endpoint neural
  model state, desktop WAV download, generated RIFF/WAVE metadata, render
  history, mobile export controls, touch keyboard visibility, labeled buttons,
  and page-level horizontal overflow.
- `npm run smoke:browser:neural` starts a fake local neural endpoint, enables
  the local neural renderer in Vite, selects the DiffSinger model in the UI,
  downloads a WAV, and verifies render history plus mobile layout. This proves
  the browser neural contract path without requiring a real checkpoint.
- `npm run smoke:browser:neural:actual -- --neural-endpoint <endpoint>` runs
  the same Svelte UI smoke against an already-running local render service.
  Use this for promoted checkpoint evidence; the fake smoke is only contract
  scaffolding.
- `npm run smoke:contract` passed for OpenUtau-style USTX import through neural
  render contract export and DiffSinger DS adaptation, including coda, rest,
  tie, and breath preservation.
- `npm run neural:audit-checkpoint` audits a DiffSinger model checkpoint
  manifest against dataset lineage, training-readiness evidence, provider
  archive-drop evidence for production preflight runs, run directory, config,
  checkpoint step, DiffSinger `infer.py`, Python env, runtime `--exp/--ckpt`,
  and vocoder checkpoint. The default minimum checkpoint step is 1000, while
  the checked-in CSD smoke example lowers it to 1 only to prove the runtime
  wiring gate.
- `npm run neural:promote-checkpoint` consumes a `checkpoint-ready`
  `neural:audit-checkpoint` report and writes a local render profile,
  `serve-render.sh`, Vite endpoint env file, and release manifest template. It
  refuses blocked checkpoint reports so WebUtau is not pointed at unaudited
  model runtimes.
- `npm run neural:run-checkpoint-handoff` performs the post-GPU handoff in one
  pass: checkpoint audit, local render-profile promotion, render-profile audit,
  and optional browser-smoke enforcement for release candidates.
- `npm run neural:audit-release` audits a neural model release manifest against
  dataset registry rights, checkpoint-ready evidence, rendered quality-summary
  gates, quality comparison, human listening scores, browser smoke evidence,
  and model terms. Non-research releases also require the checkpoint audit to
  carry provider archive-drop provenance. This keeps model publishing blocked
  until the checkpoint lineage/runtime, original archive evidence,
  dataset/model license, listening pass, and release plan are explicit.

## Immediate Next Tasks

Current status as of 2026-06-30:

- [x] Dataset-first path selected for production-quality training:
  `aihub-guide-vocal` first, `aihub-multispeaker-singing` second, both gated by
  access/license review.
- [x] Original/private Korean singer capture is prepared as a pipeline prototype
  only; it is not an active path for the current default voice.
- [x] `ops-001` capture kit generated with 220 takes and 35.07 estimated
  singing minutes.
- [x] Prompt coverage audit passed: all 18 Korean onset symbols, all 21 vowel
  symbols, all 27 non-empty coda symbols, 5 balanced keys, and 18 semitones of
  pitch range.
- [x] Headphone guide WAVs generated; the current manifest has 220 takes and
  the guide folder has 220 matching `*.guide.wav` files.
- [x] `npm run smoke:recorder` passed for desktop/mobile recorder layout,
  guide playback path, and WAV upload route.
- [x] `npm run smoke:dataset-pipeline` passed for the dataset-first CSD
  research baseline path through audit, ingest, readiness, OpenVPI seed, Korean
  MFA dictionary, and MFA label coverage.
- [x] Public GTSinger Korean research data acquired: full sparse LFS checkout
  has a refreshed manifest with 12,281/12,281 target files present, 3,327 WAV
  files, complete processed Korean metadata, and 0 missing `wav_fn`/`speech_fn`
  rows. The full processed-metadata
  DiffSinger dataset has 2,295 items / 8.27 hours and passes enhanced-dataset
  audit.
- [x] Full GTSinger public research baseline reaches DiffSinger binary training
  smoke: full binarization passes, binary output is 2.4 GB, and CPU 1-step
  train smoke reaches `max_steps=1` with a step-1 checkpoint. This remains
  research/pipeline evidence only because GTSinger is CC BY-NC-SA 4.0.
- [x] Current GTSinger 6000-step research checkpoint is promoted into the
  WebUtau local neural render service and verified end-to-end: direct render
  writes a 44.1 kHz mono 16-bit WAV, objective quality gates pass 5/5 fixed
  Korean phrases, ramp3000 vs ramp6000 comparison reports
  `decision=candidate-promote`, and actual Svelte browser smoke passes against
  `http://127.0.0.1:8790/render`.
- [x] Release audit is wired for the ramp6000 local research candidate and
  correctly reports `decision=release-blocked` until human listening scores are
  filled. GTSinger remains research/noncommercial evidence, not public model
  release evidence.
- [x] `npm run smoke:training-pipeline` passed for the synthetic post-recording
  audit, ingest, readiness, and OpenVPI seed path.
- [x] `npm run neural:inspect-intake` now reports an explicit
  `acquisition.stage` so the AI Hub path cannot be mistaken for acquired data
  while only an intake folder exists.
- [x] `npm run smoke:aihub-acquisition` now proves the provider-archive
  handoff with synthetic AI Hub-style data: prepared intake, archive detection,
  extraction, global metadata sidecar materialization, license-review gate,
  dataset audit, limited ingest, training-readiness diagnostics, OpenVPI seed,
  Korean MFA dictionary, MFA label coverage, smoke-only enhanced DiffSinger
  dataset shape, training manifest, and guarded GPU job bundle generation.
- [x] `npm run neural:audit-roadmap` now aggregates the evidence and keeps the
  overall goal incomplete until real licensed Korean dataset acquisition,
  production-track checkpoint promotion, compatibility evidence, and release
  readiness are all present.
- [x] `npm run neural:run-dataset-handoff` now acts as the real-data handoff
  runner. It inspects the licensed intake, audits the raw provider archive
  drop, safely advances archive extraction and sidecar materialization, then
  runs dataset audit, ingest,
  training-readiness, OpenVPI seed, Korean MFA dictionary, and MFA label
  coverage once the local license review is complete.
- [x] `npm run neural:audit-enhanced-dataset` now verifies MakeDiffSinger
  enhanced datasets before training: `transcriptions.csv`, referenced WAVs,
  phoneme/duration length matches, AP/SP inventory, and ph_dur-vs-WAV duration
  drift. The top-level roadmap audit requires a production enhanced-dataset
  report before considering the real checkpoint path complete.
- [x] `npm run neural:audit-release` now requires human listening score
  evidence for every non-research handoff, including `private-family`; objective
  diagnostics alone are not enough to claim a clear Korean singing voice.

Do these next, in order:

The first incomplete blocker is real data acquisition. Current local state has
an `aihub-guide-vocal` intake folder, but no AI Hub provider archive or
extracted AI Hub audio/labels yet.

Before starting the next checklist pass, run `npm run neural:audit-roadmap --
--report experiments/neural-singer/work/neural-singer-roadmap-audit-latest.json`
to see the current top-level blockers. A non-zero exit here is expected until
the real dataset and checkpoint exist.

1. If the intake folder is missing, prepare the licensed dataset intake for the
   first serious training source:
   `npm run neural:prepare-dataset-intake -- --preset aihub-guide-vocal`.
2. Download the AI Hub dataset manually after account/access and terms review.
   Keep original archives under the ignored `raw/` folder and extracted
   audio/labels under `extracted/` when extracting manually.
3. Run `npm run neural:audit-provider-drop -- --registry
   <local-aihub-registry> --dataset aihub-guide-vocal --production --report
   experiments/neural-singer/work/aihub-guide-vocal-provider-drop.json` after
   the original provider archives are under `raw/`. If it fails, fix the
   download before extraction; do not train from tiny sample zips, guide WAVs,
   screenshots, or manually trimmed audio. Keep this report because it contains
   the SHA-256 archive hashes used as acquisition provenance.
4. Fill the generated local license review file. Only set
   `allowedActions.localTraining=true` in the local registry after the terms
   explicitly allow this project to train locally. The dataset audit blocks
   `localTraining=true` until `metadata/license-review.local.md` has
   `Reviewer:`, `Review date:`, `Account/download approval confirmed: yes`,
   and `Local training allowed: yes`.
5. Run `npm run neural:run-dataset-handoff -- --registry
   <local-aihub-registry> --dataset aihub-guide-vocal --report
   experiments/neural-singer/work/aihub-guide-vocal-handoff/latest.json` after
   download/extraction. It uses the report's `acquisition.stage` as the handoff
   state and advances only safe local steps:
   `awaiting-provider-download`, `archive-ready-for-extraction`,
   `metadata-ready-needs-sidecars`, or `ready-for-audit-and-ingest`.
   The report's `handoff` block lists the provider URL, exact local drop
   folders, license-review paths, and copyable `handoff.commands.*` commands.
   By default, its provider-drop report path matches the roadmap audit path:
   `experiments/neural-singer/work/aihub-guide-vocal-provider-drop.json`.
   It never edits the license approval fields automatically. Use
   `--production` for the full ingest/training-readiness pass after the
   provider archive, sidecars, and local license review are complete.
   When changing this handoff logic, run `npm run smoke:aihub-acquisition`
   before touching real provider data. It should pass through readiness,
   OpenVPI seed, Korean MFA dictionary, and MFA label coverage on synthetic
   AI Hub-style data, then prove the DiffSinger training manifest and GPU job
   bundle contracts. This smoke-only enhanced dataset is not a substitute for
   MakeDiffSinger-aligned production data.
6. Inspect the handoff report. If it reaches
   `alignment-ready-needs-makediffsinger`, run OpenVPI/MakeDiffSinger forced
   alignment and dataset enhancement from the generated OpenVPI seed corpus.
   The handoff runner now writes
   `experiments/neural-singer/work/aihub-guide-vocal-handoff/makediffsinger-alignment-job/`
   with ordered scripts for label validation, WAV reformatting, MFA alignment,
   TextGrid checks/enhancement, dataset building, and enhanced-dataset audit.
7. Run `npm run smoke:dataset-pipeline -- --registry <local-aihub-registry>
   --dataset aihub-guide-vocal --limit-files 10` to verify the same
   dataset-first path on AI Hub before full ingest.
8. Run `npm run neural:audit-enhanced-dataset -- --production
   --dataset-dir <MakeDiffSinger-enhanced-dataset> --report
   experiments/neural-singer/work/aihub-guide-vocal-handoff/enhanced-dataset-audit.json`
   and fix any alignment/duration drift before training.
9. Rerun `npm run neural:run-dataset-handoff -- --production
   --enhanced-dataset-dir <MakeDiffSinger-enhanced-dataset> --registry
   <local-aihub-registry> --dataset aihub-guide-vocal` to prepare the
   DiffSinger training manifest and guarded GPU job bundle.
10. Train the first real DiffSinger baseline for several thousand steps on a
   GPU.
11. Use CSD as research-only comparison/baseline data, not as release proof.
12. If the licensed dataset path is blocked or a distinct voice is needed, run
   `npm run neural:serve-recorder` and record dry vocal WAVs into
   `experiments/neural-singer/datasets/original-private-singer/wavs/`.
13. Review and fill the generated consent template before enabling local
   training on the private registry. The private registry now points to
   `consent-form.signed.local.md`; `npm run neural:audit-datasets` blocks
   `allowedActions.localTraining=true` when `Singer signature:`, `Date:`, or
   `Reviewer:` is missing.
14. Run `npm run neural:audit-recordings` to compare recorded WAV takes against
   their per-take neural request guides. Write both the JSON diagnostics report
   and the failed-take review CSV; failed takes should be re-recorded or
   trimmed before ingest. Use the report's planned/ready/needs-review coverage
   buckets and `coverageCritical` CSV column to avoid losing rare Korean
   onsets, vowels, or batchim when rejecting takes. Re-record any take that
   fails `guide-tick-leakage`; that usually means headphone guide audio bled
   into the microphone.
15. Run `npm run neural:ingest-dataset -- --recording-audit
   <recording-audit.json>` for private-singer data so only takes with `ok:
   true` become training segments.
16. Run `npm run neural:audit-readiness` on the ingest summary. It must pass
   local-training, duration, lyric annotation, phoneme coverage, RMS, silence,
   and voiced-F0 gates before training.
17. Run `npm run neural:prepare-diffsinger-training -- --production
    --provider-drop-audit <provider-drop-audit-report>` on the enhanced AI
   Hub/private DiffSinger dataset to generate the real training config,
   runbook, and checkpoint manifest template.
18. Run `npm run neural:prepare-diffsinger-gpu-job` for that training manifest,
   review the dataset license for private remote/GPU compute, then upload with
   `WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD=1`.
16. Train the first real DiffSinger baseline for several thousand steps on a
    GPU, then run `npm run neural:run-checkpoint-handoff -- --manifest
    <local-checkpoint-manifest> --registry <local-registry> --work-dir
    experiments/neural-singer/work/checkpoint-handoff`. This wraps
    `neural:audit-checkpoint`, `neural:promote-checkpoint`, and
    `neural:audit-render-profile`; it must pass before treating the checkpoint
    as usable by the local render service.
17. Run the generated `serve-render.sh`, perform browser verification against
    the same endpoint, then rerun `neural:run-checkpoint-handoff` with
    `--require-browser-smoke --browser-smoke <local-neural-smoke.json>` before
    treating the promoted profile as release-candidate evidence.
19. Render the fixed phrase set with
   `npm run neural:evaluate-quality -- --accept-local-research-license` and
   compare objective diagnostics. Copy the generated
   `listening-scores.template.json` to an ignored local scores file and fill the
   human listening scores before any `private-family`, `public-demo`, or
   `public-model` release audit.
20. Feed the best checkpoint back through the local neural render service and
    verify the Svelte app can choose, render, cancel, retry, and export it.
20. Run `npm run smoke:browser:neural:actual -- --neural-endpoint <endpoint>
    --out experiments/neural-singer/work/browser-smoke/neural-latest.json` and
    attach the report to the model release manifest.
21. Run `npm run neural:audit-release` for the intended model release with the
    `neural:audit-checkpoint` report attached as `evidence.modelCheckpoint`. If
    it blocks public publishing, keep GitHub Pages static-only and document the
    private local companion flow.

## Quality Gates

Each milestone should leave behind:

- A command that another agent can rerun.
- A small text or JSON report.
- A license note for every external asset.
- A clear decision about what changed and why.
- No accidental heavyweight artifacts in git.

## Open Questions

- Is the first neural singer a public/research dataset voice, a private family
  prototype voice, or a new original recorded voice?
- Which compute target is available first?
- Should the first product shape be local companion service or hosted private
  renderer?
- Are we willing to publish trained model weights, or only use them privately?
- What exact Korean phoneme inventory should be used for DiffSinger training?
