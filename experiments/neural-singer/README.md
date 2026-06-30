# WebUtau Neural Singer Experiments

This folder is for small, versioned experiment metadata around the long-term
Korean neural singer work.

Heavy local artifacts must not be committed here. Keep datasets, checkpoints,
rendered WAVs, and training outputs under ignored subfolders:

- `datasets/`
- `checkpoints/`
- `runs/`
- `outputs/`
- `work/`

Use `.local/neural-singer/` for machine-specific clones, virtualenvs, and large
tooling checkouts.

## First Experiment Order

This project is dataset-first for neural experiments, but the active WebUtau V3
goal is no-recording and self-generated. A production neural Korean singer is
not considered "made" until we acquire a license-reviewed Korean singing
dataset that does not require the user or the user's family to record a voice,
prepare it for training, and train/audit a real checkpoint from that data.
The UTAU sample renderer, browser fake neural endpoint, CSD smoke data, and
promotion scripts are only scaffolding and quality gates.

1. Prepare the AI Hub licensed dataset intake.
2. Download usable Korean singing data after access and terms review; do not
   ask the current user or family to record.
3. Fill out the generated local registry only after the license review passes.
4. Inspect, audit, ingest, align, and enhance the dataset.
5. Train a real DiffSinger checkpoint from the approved dataset.
6. Promote that audited checkpoint into the local WebUtau render service.
7. Render one Korean phrase and save diagnostics.

Run the top-level gate whenever the work feels ambiguous:

```sh
npm run neural:audit-roadmap -- \
  --report experiments/neural-singer/work/neural-singer-roadmap-audit-latest.json
```

This report must stay incomplete while the project only has smoke data,
research-only CSD evidence, or a fake/local neural endpoint. The first real
completion blocker should be licensed Korean singing data acquisition.

## Dataset Audit

Run the registry audit before using a dataset:

```sh
npm run neural:audit-datasets -- --registry experiments/neural-singer/dataset-registry.example.json
```

The example registry is intentionally conservative and will fail until local
paths exist and license reviews mark training as allowed.

## Public Research Baselines

These datasets are useful for preprocessing, alignment, and research training
smoke work. They are not public product-release evidence because both are
CC BY-NC-SA 4.0 research/noncommercial sources.

```sh
npm run neural:download-csd -- --summary
npm run neural:audit-datasets -- \
  --registry experiments/neural-singer/datasets/csd/dataset-registry.local.json \
  --dataset csd-korean-research-baseline \
  --min-local-training-minutes 10 \
  --min-annotated-ratio 0.95 \
  --report experiments/neural-singer/work/csd-dataset-audit.json
```

```sh
npm run neural:download-gtsinger-korean -- \
  --concurrency 2 \
  --retries 12 \
  --retry-base-delay-ms 4000 \
  --summary
```

The GTSinger downloader follows Hugging Face pagination and retries 429/5xx
responses. Without pagination it only downloaded the first slice of the Korean
tree; the full Korean target is 12,281 files, including 3,327 WAV files and
about 5.86 GB of expected data.

If the full dataset already lives in the local git-lfs checkout, refresh only
the manifest and local registry without copying the dataset:

```sh
npm run neural:download-gtsinger-korean -- \
  --repository-dir .local/neural-singer/gtsinger-lfs \
  --skip-download \
  --summary
```

Current refreshed status: `12,281/12,281` target files present, including
3,327 WAV, 3,330 JSON, 3,327 TextGrid, 2,295 MusicXML, and repo docs.

To verify the whole public-discovery stack:

```sh
npm run neural:audit-public-datasets -- \
  --report experiments/neural-singer/work/public-dataset-discovery-audit.json
```

The current report covers 8 public Korean candidates and concludes that CSD and
GTSinger are ready research singing baselines, while no acquired public dataset
is production-release evidence for a WebUtau neural singer.

## Public Korean Speech Auxiliaries

These datasets are not singing datasets. Use them to harden Korean text
normalization, pronunciation dictionaries, ASR/listening checks, and auxiliary
speech experiments. They must not satisfy the production Korean singing voice
milestone.

```sh
npm run neural:download-kss -- --summary --concurrency 2
npm run neural:audit-datasets -- \
  --registry experiments/neural-singer/datasets/kss-korean-speech/dataset-registry.local.json \
  --dataset kss-korean-speech-pronunciation-aux \
  --report experiments/neural-singer/work/kss-dataset-audit.json
```

Current KSS status: the Hugging Face dataset is present locally as 9 files,
including 7 parquet shards, with 3,808,712,260 bytes verified by size and
SHA-256 manifest. It is CC BY-NC-SA 4.0 and remains speech-only auxiliary data.

```sh
npm run neural:download-openslr-korean -- --preset zeroth-korean --summary
```

Zeroth-Korean is the first OpenSLR auxiliary target because SLR40 lists it as
CC BY 4.0 and describes 51.6 hours of train speech plus 1.2 hours of test
speech. The original archive is present locally at 10,339,720,618 bytes with
SHA-256 `6e109897f4d866eb1a3d31cbb2220c0b5e3dc74704208189ecc3bec787740e5f`;
its registry audit passes as speech-only auxiliary evidence.

Other OpenSLR Korean presets are tracked but not first-line training inputs:

- `seoul-corpus`: CC BY-NC 2.0 spontaneous speech with TextGrid labels. The
  original `readme.tgz`, `label.tgz`, and `sound.tgz` archives are present
  locally with 2,675,209,286 total bytes verified by size and SHA-256 manifest;
  keep it noncommercial auxiliary evidence only.
- `pansori-tedxkr`: CC BY-NC-ND 4.0; reference-only because NoDerivatives makes
  training/derivative release risky.
- `deeply-korean-read`: CC BY-NC-ND 4.0; reference-only for the same reason.
- `deeply-parent-child-vocal`: CC BY-NC-ND 4.0 Korean parent/child interaction
  sample with singing labels. Download it only as reference evidence; it is not
  a model-training source unless separate rights are obtained.

```sh
npm run neural:download-openslr-korean -- --preset pansori-tedxkr --summary
npm run neural:download-openslr-korean -- --preset deeply-korean-read --summary
npm run neural:download-openslr-korean -- --preset deeply-parent-child-vocal --summary
```

Treat these reference-only downloads as active dataset discovery, not as
training approval. Their value is proving what public Korean audio exists and
why each source is blocked or allowed.

## Licensed Dataset Intake

The production-track path should start from a licensed Korean singing dataset,
not from the private recorder. Prepare the first AI Hub intake folder with:

```sh
npm run neural:prepare-dataset-intake -- --preset aihub-guide-vocal
```

This creates an ignored local folder under
`experiments/neural-singer/datasets/aihub-guide-vocal/`, a
`metadata/license-review.local.template.md`, and a local registry template.
After manually downloading from AI Hub and reviewing terms, keep original
archives in `raw/`, extracted audio/labels in `extracted/`, and run the
handoff runner:

```sh
npm run neural:audit-provider-drop -- \
  --registry experiments/neural-singer/datasets/aihub-guide-vocal/dataset-registry.local-template.json \
  --dataset aihub-guide-vocal \
  --production \
  --report experiments/neural-singer/work/aihub-guide-vocal-provider-drop.json
```

This provider-drop audit is the first hard line between a real dataset download
and a placeholder/sample file. It checks supported archive types, archive count,
total raw archive bytes, optional archive entries, computes SHA-256 hashes for
the original archives, and writes a report before the handoff runner extracts
anything. The AI Hub template currently requires at least one raw provider
archive and at least 1 GiB total archive bytes; raise
`qualityGates.minProviderArchiveTotalBytes` after the exact provider package
size is confirmed from the download page or license paperwork. The top-level
roadmap audit requires provider-drop evidence with archive hashes before it can
count the real dataset as acquired.

```sh
npm run neural:run-dataset-handoff -- \
  --registry experiments/neural-singer/datasets/aihub-guide-vocal/dataset-registry.local-template.json \
  --dataset aihub-guide-vocal \
  --report experiments/neural-singer/work/aihub-guide-vocal-handoff/latest.json
```

The runner inspects the current acquisition stage and advances only safe local
steps: provider archive-drop audit, archive extraction, AI Hub-style metadata sidecar materialization,
dataset audit, ingest, training-readiness diagnostics, OpenVPI seed generation,
Korean MFA dictionary generation, and MFA label coverage. It never flips license
approval fields automatically. For the production pass, use:

```sh
npm run neural:run-dataset-handoff -- \
  --registry experiments/neural-singer/datasets/aihub-guide-vocal/dataset-registry.local-template.json \
  --dataset aihub-guide-vocal \
  --production \
  --report experiments/neural-singer/work/aihub-guide-vocal-handoff/production.json
```

After OpenVPI/MakeDiffSinger forced alignment and dataset enhancement, audit the
enhanced DiffSinger dataset before preparing a training run:

```sh
npm run neural:audit-enhanced-dataset -- \
  --dataset-dir <MakeDiffSinger-enhanced-dataset> \
  --production \
  --report experiments/neural-singer/work/aihub-guide-vocal-handoff/enhanced-dataset-audit.json
```

This checks `transcriptions.csv`, referenced WAV files, phoneme/duration length
matches, AP/SP inventory, and ph_dur-vs-WAV duration drift. The top-level
roadmap audit treats this production report as required evidence before a real
checkpoint can complete the goal.

The intake inspector is the first proof that this is really dataset-based. It
reports provider archives, extracted training audio, ignored guide WAVs,
same-stem/sibling annotation pairing, AI Hub-style CSV/JSON note metadata, and
whether the current layout can go directly into `ingest-dataset` or needs a
dataset-specific metadata mapping adapter. Its `acquisition.stage` field is the
operational source of truth while the real dataset is being acquired:

- `awaiting-provider-download`: intake scaffolding exists, but no provider
  archive or extracted audio is present yet.
- `archive-ready-for-extraction`: downloaded archives exist under `raw/`, but
  extracted training audio has not been found. Run `npm run
  neural:audit-provider-drop` first, then `npm run neural:extract-dataset` to unpack supported ZIP/TAR archives into
  `extracted/<archive-stem>/`.
- `metadata-ready-needs-sidecars`: extracted audio and global CSV/JSON note
  metadata exist, but ingest-compatible same-stem sidecars still need to be
  materialized.
- `ready-for-audit-and-ingest`: license review, audio, and paired annotations
  are ready for dataset audit and a limited ingest slice.

`npm run neural:run-dataset-handoff` includes a `handoff` block in its JSON
report with the provider URL, local `raw/`, `extracted/`, and `metadata/`
paths, license-review file paths, and copyable `handoff.commands.*` commands.
The default provider-drop report path is
`experiments/neural-singer/work/<dataset-id>-provider-drop.json`, which is also
what the roadmap audit reads.

To verify this whole acquisition handoff without using real provider data, run:

```sh
npm run smoke:aihub-acquisition -- \
  --out experiments/neural-singer/work/aihub-acquisition-smoke/latest.json
```

This creates a synthetic AI Hub-style ZIP under ignored `work/`, then proves the
stage transitions through extraction, global metadata sidecar materialization,
license review, dataset audit, limited ingest, training-readiness diagnostics,
OpenVPI seed generation, Korean MFA dictionary generation, and MFA label
coverage. It also generates a MakeDiffSinger/MFA alignment job bundle,
materializes a smoke-only DiffSinger enhanced dataset shape, and proves that
training manifest and guarded GPU job bundle generation still work. It is
pipeline contract evidence only, not voice-quality or release evidence, and it
does not replace real MakeDiffSinger-enhanced aligned data.

If the inspector reports structured CSV/JSON note metadata but poor same-stem
pairing, materialize per-audio sidecars before audit/ingest:

```sh
npm run neural:materialize-sidecars -- \
  --registry experiments/neural-singer/datasets/aihub-guide-vocal/dataset-registry.local-template.json \
  --dataset aihub-guide-vocal \
  --report experiments/neural-singer/work/aihub-guide-vocal-sidecars.json
```

This scans provider-level CSV/JSON note metadata for audio filenames, Korean
lyrics, timing, and pitch columns, then writes generated sibling
`metadata/<audio-stem>.csv` sidecars where the existing ingest/audit tools can
find them. Existing sidecars are skipped unless `--overwrite` is passed.

Only set `allowedActions.localTraining=true` after the local license review
confirms that training is allowed. The dataset audit checks
`metadata/license-review.local.md` and blocks `localTraining=true` unless
`Reviewer:`, `Review date:`, `Account/download approval confirmed: yes`, and
`Local training allowed: yes` are filled. Keep `publicModelRelease=false` and
`publicAudioExamples=false` until generated-model and demo rights are reviewed.
The same audit also enforces `qualityGates.minAnnotatedRatio` for local
training datasets: each non-guide WAV should have a same-stem `.txt`, `.lab`,
`.json`, or `.csv` annotation beside it, or in a sibling `lyric/`, `lyrics/`,
`label/`, `labels/`, `csv/`, `json/`, or `metadata/` directory. This keeps the
track dataset-first: unusable audio-only drops are caught before alignment or
training.

Available intake presets:

- `aihub-guide-vocal`: first choice for SVS because the public AI Hub metadata
  describes WAV/MIDI/CSV note timing and pitch fields.
- `aihub-multispeaker-singing`: broader Korean singing corpus candidate after
  terms review.

Current local intake status:

- `aihub-guide-vocal` intake folder and local registry template have been
  created, but no AI Hub provider archives, extracted audio, or labels have
  been downloaded yet. Local training is still disabled until account/access
  approval and the local license review are filled. The latest inspection stage
  should therefore be `awaiting-provider-download`.
- CSD Korean has been extracted locally as a research-only baseline: 100 WAV,
  100 CSV, 100 lyric, 100 MIDI, and 100 TXT files. `CSD.zip` is present at
  1,851,131,390 bytes, and its MD5 matches the Zenodo record:
  `74d121dd8706fded26a15526a379f7a2`. The generated local manifest is
  `experiments/neural-singer/datasets/csd/csd.manifest.json`; the current
  dataset audit passes with 100 WAV files, 9,072.38 seconds / 2.52 hours of
  known Korean audio, and 100/100 paired annotations.
- GTSinger Korean is the second public research baseline. The downloader now
  follows Hugging Face pagination and backs off on rate limits. The full Korean
  target is acquired in `.local/neural-singer/gtsinger-lfs`: 12,276 Korean
  files, including 3,327 WAV files, plus `processed/Korean` metadata. Metadata
  coverage is complete: 2,295/2,295 `wav_fn` rows and 2,295/2,295 `speech_fn`
  rows resolve to local files. GTSinger is CC BY-NC-SA 4.0, so keep it as
  research/noncommercial local training data unless a separate rights review
  approves broader use.
- The current full GTSinger DiffSinger dataset is
  `experiments/neural-singer/work/gtsinger-korean-diffsinger-full`. It is built
  from upstream processed metadata with hard-linked WAVs, not copied audio:
  2,295 items, 29,779.96 seconds / 8.27 hours of valid WAV, 71 phone symbols,
  AP and SP present, zero skipped metadata rows, and max duration drift
  0.0005 seconds.
- `npm run neural:audit-enhanced-dataset` passes on that full GTSinger dataset
  with `decision=enhanced-dataset-ready`, 2,295/2,295 WAV items, no duplicate
  names, and no unreferenced WAV files. This supersedes the earlier partial
  60-WAV / 7-item MFA baseline, which is now only historical pipeline evidence.
- Full GTSinger DiffSinger binarization now succeeds with
  `experiments/neural-singer/work/gtsinger-korean-diffsinger-training-full/config.yaml`.
  The generated binary dataset is 2.4 GB, with 115 validation items,
  2,180 training items, 1,364.76 validation seconds, 28,401.81 train seconds
  before augmentation, and 54,271.51 train seconds after augmentation.
- A full-binary CPU 1-step train smoke reaches `max_steps=1`, runs validation
  across all 115 validation items, and writes
  `experiments/neural-singer/work/gtsinger-korean-diffsinger-training-full/train-smoke-full-binary/model_ckpt_steps_1.ckpt`.
  This remains historical pipeline evidence only; it proves the full binary
  path can train and render, but it is not a usable singer checkpoint.
- The current local research listening candidate is the MPS 6000-step ramp:
  `experiments/neural-singer/work/gtsinger-korean-diffsinger-training-full/train-mps-ramp-6000/model_ckpt_steps_6000.ckpt`.
  It trained from the full GTSinger Korean DiffSinger binary set, saved a
  244,897,909 byte checkpoint, and reached validation loss `0.41262`,
  improving over the 3000-step ramp validation loss `0.66656`. Objective
  quality diagnostics pass 5/5 fixed Korean phrase gates, and the ramp3000 vs
  ramp6000 comparison reports `decision=candidate-promote` with 1 improved
  phrase, 4 neutral phrases, and 0 blocking regressions.
- Current local neural ramp6000 evidence:
  - checkpoint audit:
    `experiments/neural-singer/work/gtsinger-korean-diffsinger-training-full/model-checkpoint-mps-ramp-6000-audit.json`
  - render profile audit:
    `experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/render-profile-audit.json`
  - direct render sample:
    `experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/direct-render.wav`
  - actual browser-to-local-DiffSinger smoke:
    `experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/browser-smoke-actual-local-neural.json`
  - quality summary:
    `experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000/quality-summary.json`
  - quality comparison:
    `experiments/neural-singer/work/neural-quality/gtsinger-ramp-3000-vs-6000.json`
  - human listening review pack:
    `experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000/listening-review/index.html`
  - release audit:
    `experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/release-audit.json`
    currently reports `decision=release-blocked` until
    `listening-review/listening-scores.local.json` is filled by a human
    listener. GTSinger remains CC BY-NC-SA 4.0 research/noncommercial evidence,
    so it is not public model release evidence by itself.

## Public Research Dataset Commands

Download the Korean subset of GTSinger from Hugging Face. For the full dataset,
prefer `git-lfs` sparse checkout; unauthenticated per-file resolver downloads
hit Hugging Face rate limits quickly.

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --depth=1 --filter=blob:none \
  https://huggingface.co/datasets/GTSinger/GTSinger \
  .local/neural-singer/gtsinger-lfs

git -C .local/neural-singer/gtsinger-lfs sparse-checkout init --no-cone
git -C .local/neural-singer/gtsinger-lfs sparse-checkout set --no-cone \
  'Korean/**' 'processed/Korean/**' 'README.md' 'dataset_license.md'
git -C .local/neural-singer/gtsinger-lfs lfs install --local
git -C .local/neural-singer/gtsinger-lfs lfs pull \
  --include='Korean/**,processed/Korean/**,README.md,dataset_license.md' \
  --exclude=''
git -C .local/neural-singer/gtsinger-lfs lfs checkout \
  Korean processed/Korean README.md dataset_license.md
```

Prepare and audit the full processed-metadata DiffSinger dataset:

```sh
npm run neural:prepare-gtsinger-diffsinger -- \
  --repository .local/neural-singer/gtsinger-lfs \
  --out experiments/neural-singer/work/gtsinger-korean-diffsinger-full \
  --link-audio \
  --force

npm run neural:audit-enhanced-dataset -- \
  --dataset-dir experiments/neural-singer/work/gtsinger-korean-diffsinger-full \
  --min-items 2295 \
  --min-total-seconds 29779 \
  --max-phone-duration 12 \
  --report experiments/neural-singer/work/gtsinger-korean-diffsinger-full/enhanced-dataset-audit.json
```

The older generic ingest/OpenVPI/MFA route remains useful for pipeline
experiments, but the processed-metadata route is the better GTSinger path
because upstream already provides phone, note, and duration metadata.

Generate the older OpenVPI seed and Korean MFA helpers when debugging alignment:

```sh
npm run neural:prepare-openvpi -- \
  --ingest-dir experiments/neural-singer/work/gtsinger-korean-ingest-full \
  --out experiments/neural-singer/work/gtsinger-korean-openvpi-seed \
  --copy-audio

npm run neural:prepare-mfa-dictionary -- \
  --seed-dir experiments/neural-singer/work/gtsinger-korean-openvpi-seed \
  --out experiments/neural-singer/work/gtsinger-korean-openvpi-seed/mfa-korean
```

If MakeDiffSinger `build_dataset.py` emits blank phone marks as double spaces in
`transcriptions.csv`, repair the enhanced dataset before auditing:

```sh
npm run neural:repair-enhanced-dataset -- \
  --dataset-dir experiments/neural-singer/work/gtsinger-korean-makediffsinger-alignment-job/aligned-subset/build-filter/diffsinger-dataset-enhanced \
  --out experiments/neural-singer/work/gtsinger-korean-makediffsinger-alignment-job/aligned-subset/build-filter/diffsinger-dataset-enhanced-repaired \
  --force

npm run neural:audit-enhanced-dataset -- \
  --dataset-dir experiments/neural-singer/work/gtsinger-korean-makediffsinger-alignment-job/aligned-subset/build-filter/diffsinger-dataset-enhanced-repaired \
  --min-items 7 \
  --min-total-seconds 40 \
  --no-require-ap-sp \
  --report experiments/neural-singer/work/gtsinger-korean-makediffsinger-alignment-job/aligned-subset/build-filter/enhanced-dataset-repaired-audit.json
```

KSS is tracked only as an auxiliary Korean speech corpus candidate. It is useful
for pronunciation or text normalization experiments, but it is not singing data
and must not be used alone as evidence for a Korean singing voice.

## Dataset Ingestion

After a local registry marks a dataset as `allowedActions.localTraining=true`,
generate segment metadata and objective audio diagnostics:

```sh
npm run neural:ingest-dataset -- \
  --registry path/to/local-registry.json \
  --dataset dataset-id \
  --out experiments/neural-singer/work/dataset-id-ingest
```

The first ingestion pass supports PCM/float WAV files. It writes ignored
`segments.jsonl` and `summary.json` files with duration, peak/RMS,
silence-ratio, estimated F0 coverage, and lyric/phoneme coverage from sidecar
`.txt`, `.lab`, `.json`, or `.csv` annotations. CSV/JSON note labels are
scanned for Korean lyric/text/syllable fields so AI Hub-style guide-vocal labels
do not lose Hangul coverage during the first ingest pass. Headphone guides under `guides/`,
`guide-tracks/`, or matching `*.guide.wav` are excluded from training audio
counts and segment generation.

For a newly downloaded large dataset, run a quick sorted slice first:

```sh
npm run neural:ingest-dataset -- \
  --registry path/to/local-registry.json \
  --dataset dataset-id \
  --out experiments/neural-singer/work/dataset-id-ingest-slice \
  --limit-files 10
```

To verify the complete dataset-first preparation path on one dataset, run:

```sh
npm run smoke:dataset-pipeline -- \
  --registry path/to/local-registry.json \
  --dataset dataset-id \
  --limit-files 10
```

This smoke runs dataset rights/annotation audit, ingest diagnostics, training
readiness, OpenVPI seed generation, Korean MFA dictionary generation, and MFA
label coverage. The default target is the local CSD Korean research baseline;
for AI Hub, run it only after the local registry has passed rights review and
`allowedActions.localTraining=true`.

## Inactive Future Contributor Capture

This section is not part of the active WebUtau V3 goal. The user will not record
a voice, and the project must not ask the user or the user's family for voice
material. Keep these tools only as a historical pipeline prototype or as a
future contributor path for a separate singer who explicitly wants to
participate.

For that separate future path, an original singer recorded with written consent
can be prepared with an ignored local capture kit containing cue sheets, lyric
sidecars, and a private registry template:

```sh
npm run neural:prepare-private-singer -- \
  --out experiments/neural-singer/datasets/original-private-singer \
  --registry-out experiments/neural-singer/work/original-private-singer-registry.local.json \
  --target-minutes 35 \
  --session-id ops-001
```

This creates:

- `cue-sheet.csv` with take ids, Korean lyrics, key hints, tempo, and expected
  WAV filenames
- `wavs/*.txt` lyric sidecars that match the expected WAV basenames
- `lyrics/*.txt` reading copies
- `scores/*.ustx.json` WebUtau/OpenUtau-compatible score guides for pitch and
  note timing
- `requests/*.neural-request.json` renderer-contract fixtures for diagnostics
  and future local neural renders
- `recording-session.json` with non-sensitive session metadata
- `consent-form.template.md` for review before any local training
- a private registry template that keeps `allowedActions.localTraining=false`
  until consent is reviewed, and points to the expected ignored
  `consent-form.signed.local.md` file

Audit the prompt coverage before any future consenting contributor records:

```sh
npm run neural:audit-prompt-coverage -- \
  --pack-dir experiments/neural-singer/datasets/original-private-singer \
  --report experiments/neural-singer/work/original-private-singer-prompt-coverage.json
```

This checks take count, estimated minutes, prompt/tag diversity, key balance,
all Hangul onset/vowel coverage, broad batchim coverage, request coverage, and
pitch range. The first `ops-001` pack currently passes with 220 takes, 35.07
estimated minutes, 32 prompt ids, all 18 onset symbols, all 21 vowel symbols,
and all 27 non-empty coda symbols.

Generate headphone pitch/click guide WAVs before recording:

```sh
npm run neural:prepare-guides -- \
  --pack-dir experiments/neural-singer/datasets/original-private-singer
```

This writes ignored `guides/*.guide.wav` files and `guides/guide-manifest.json`
from the per-take neural requests. Use them only for monitoring while singing;
do not train on guide tracks, and trim any count-in before running the recorded
vocal WAV through the audit. The dataset audit and ingest scripts ignore guide
WAVs by path/name so guide tracks cannot satisfy duration gates or become
training segments. A full guide generation also removes stale `*.guide.wav`
files that no longer belong to the current recording session.

When the guide WAVs are ready, start the local recording companion:

```sh
npm run neural:serve-recorder -- \
  --pack-dir experiments/neural-singer/datasets/original-private-singer
```

Open the printed localhost URL. The page shows each take, plays the matching
headphone guide, records dry microphone audio, and saves the WAV back to the
exact `wavs/*.wav` path expected by the audit/ingest tools.

Before a real session, smoke-test the full recorder workflow without touching
private audio:

```sh
npm run smoke:recorder
```

This creates a temporary capture pack, generates one guide, opens the recorder
in Chromium, checks desktop/mobile layout, and saves a synthetic WAV through
the same browser upload path.

You can also dry-run the post-recording pipeline without private audio:

```sh
npm run smoke:training-pipeline
```

This creates a temporary consent-reviewed smoke pack, writes synthetic dry
vocals that follow the score, then verifies `audit-recordings`,
`audit-datasets`, `ingest-dataset`, `audit-readiness`, and OpenVPI seed
preparation. It proves the processing path still works; it does not prove
production voice quality.

After the WAV files are recorded, copy `consent-form.template.md` to
`consent-form.signed.local.md`, fill `Singer signature:`, `Date:`, and
`Reviewer:`, and keep that signed file outside public git history. Only then
copy or edit the private registry so `allowedActions.localTraining=true`; the
dataset audit blocks local training when signed consent is missing or
incomplete. Then audit the recorded takes against their score guides:

```sh
npm run neural:audit-recordings -- \
  --pack-dir experiments/neural-singer/datasets/original-private-singer \
  --report experiments/neural-singer/work/original-private-singer-recording-audit.json \
  --review-csv experiments/neural-singer/work/original-private-singer-recording-review.csv
```

This compares each `wavs/*.wav` recording against the matching
`requests/*.neural-request.json` guide and checks duration, clipping, RMS,
silence ratio, voiced F0 coverage, pitch error, onset timing, and
`guide-tick-leakage`. The leakage gate looks for the guide track's 1800 Hz
lyric ticks inside the recorded vocal WAV; failing it usually means headphone
audio bled into the microphone. Fix or re-record failed takes before dataset
ingest. The JSON report keeps the full diagnostics, while
`*-recording-review.csv` is a compact failed-take queue with the lyric, guide
paths, failed gates, Korean coverage-critical flags, and concrete next actions.
The report also compares planned, accepted, and needs-review take coverage so a
session does not accidentally lose rare Korean onsets, vowels, or batchim after
rejecting bad takes.

Then run:

```sh
npm run neural:audit-datasets -- \
  --registry experiments/neural-singer/work/original-private-singer-registry.local.json \
  --min-local-training-minutes 30

npm run neural:ingest-dataset -- \
  --registry experiments/neural-singer/work/original-private-singer-registry.local.json \
  --dataset original-private-singer \
  --recording-audit experiments/neural-singer/work/original-private-singer-recording-audit.json \
  --out experiments/neural-singer/work/original-private-singer-ingest
```

The `--recording-audit` argument is important for private-singer work: ingest
will only segment WAVs whose take result is `ok: true`, leaving clipped, mistimed,
silent, pitch-bad, or guide-leaked recordings out of the training corpus.

Before preparing OpenVPI/MFA alignment, run the training-readiness gate:

```sh
npm run neural:audit-readiness -- \
  --ingest-dir experiments/neural-singer/work/original-private-singer-ingest \
  --registry experiments/neural-singer/work/original-private-singer-registry.local.json \
  --min-minutes 30 \
  --report experiments/neural-singer/work/original-private-singer-readiness.json
```

This checks reviewed local-training permission, known singing duration, lyric
sidecar coverage, Korean phoneme breadth, RMS range, silence ratio, and voiced
F0 coverage. It must pass before a real DiffSinger training run should begin.

## OpenVPI Seed Corpus

See [`OPENVPI_TOOLING.md`](OPENVPI_TOOLING.md) for the local clone, MFA, and
tooling setup notes.

For a local research-only CSD smoke test, first download/extract CSD under the
ignored dataset folder, then generate a tiny MFA seed corpus:

```sh
npm run neural:prepare-csd-smoke -- \
  --csd-root experiments/neural-singer/datasets/csd/extracted/CSD/korean \
  --ids kr007a \
  --out experiments/neural-singer/work/csd-mfa-smoke
```

To process a broader local CSD Korean baseline after extracting the full Korean
subset, use sorted id discovery:

```sh
npm run neural:prepare-csd-smoke -- \
  --csd-root experiments/neural-singer/datasets/csd/extracted/CSD/korean \
  --ids all \
  --limit 10 \
  --out experiments/neural-singer/work/csd-mfa-baseline
```

Remove `--limit` only when you intentionally want to prepare all 100 Korean CSD
recordings. This remains research-only baseline data, not production release
evidence.

Convert ingestion output into a MakeDiffSinger/OpenVPI pre-alignment corpus:

```sh
npm run neural:prepare-openvpi -- \
  --ingest-dir experiments/neural-singer/work/dataset-id-ingest \
  --out experiments/neural-singer/work/dataset-id-openvpi-seed \
  --copy-audio
```

This creates:

- `raw/wavs/*.wav` segment audio when `--copy-audio` is set
- `raw/wavs/*.lab` syllable labels placed next to the WAVs for MFA-style flows
- `raw/transcriptions.csv` seed `name,text` rows
- `webuta-openvpi-seed.manifest.json` with WebUtau diagnostics and source
  mapping

This is not yet a final DiffSinger training dataset. MakeDiffSinger's forced
alignment pipeline still needs MFA/TextGrid processing before final
`name,ph_seq,ph_dur` transcriptions are available.

Generate a Korean MFA dictionary from the seed labels before alignment:

```sh
npm run neural:prepare-mfa-dictionary -- \
  --seed-dir experiments/neural-singer/work/dataset-id-openvpi-seed
```

This produces `korean.dict`, `phones.txt`, and `oov-report.json`. Any OOV token
must be removed, split, or explicitly mapped before running MFA.

Prepare a reproducible MakeDiffSinger/MFA alignment job bundle:

```sh
npm run neural:prepare-makediffsinger-alignment -- \
  --seed-dir experiments/neural-singer/work/dataset-id-openvpi-seed \
  --dictionary experiments/neural-singer/work/dataset-id-mfa-dictionary/korean.dict \
  --out experiments/neural-singer/work/dataset-id-makediffsinger-alignment \
  --make-diffsinger-root .local/neural-singer/openvpi/MakeDiffSinger \
  --mfa-model /path/to/korean-acoustic-model.zip \
  --production
```

The bundle writes ordered scripts for `validate_labels.py`,
`reformat_wavs.py`, `mfa align`, `check_tg.py`, `enhance_tg.py`,
`build_dataset.py`, and the WebUtau enhanced-dataset audit. The dataset handoff
runner also creates this bundle automatically once it reaches
`alignment-ready-needs-makediffsinger`.

For the official `korean_mfa` acoustic model path, audit labels against the
official dictionary as well:

```sh
npm run neural:audit-mfa-labels -- \
  --seed-dir experiments/neural-singer/work/dataset-id-openvpi-seed \
  --dictionary .local/neural-singer/mfa-root/pretrained_models/dictionary/korean_mfa.dict
```

## DiffSinger Smoke Training

After CSD has been aligned with MFA 3, enhanced with MakeDiffSinger, and built
into `diffsinger-dataset-enhanced/`, prepare the DiffSinger runtime:

```sh
npm run neural:setup-diffsinger -- \
  --create-env \
  --install-torch \
  --install-requirements
```

Prepare the compact smoke config. The compact dictionary is intentional:
DiffSinger validates that every phoneme in its dictionary appears in the
training corpus, so the full official Korean MFA dictionary is too broad for a
5-segment smoke test.

```sh
npm run neural:prepare-diffsinger-smoke -- \
  --dataset-dir experiments/neural-singer/work/csd-mfa-smoke/diffsinger-dataset-enhanced \
  --diffsinger-root .local/neural-singer/openvpi/DiffSinger \
  --out experiments/neural-singer/work/csd-diffsinger-smoke \
  --test-prefix kr007a-05
```

Binarize and run a one-step local CPU training smoke:

```sh
cd .local/neural-singer/openvpi/DiffSinger

/Users/hckim/Documents/webuta/.local/neural-singer/mamba/envs/webuta-diffsinger/bin/python \
  scripts/binarize.py \
  --config /Users/hckim/Documents/webuta/experiments/neural-singer/work/csd-diffsinger-smoke/config.yaml

/Users/hckim/Documents/webuta/.local/neural-singer/mamba/envs/webuta-diffsinger/bin/python \
  scripts/train.py \
  --config /Users/hckim/Documents/webuta/experiments/neural-singer/work/csd-diffsinger-smoke/config.yaml \
  --exp_name /Users/hckim/Documents/webuta/experiments/neural-singer/work/csd-diffsinger-smoke/train-smoke \
  --reset
```

Generate the fixed Korean demo input and run inference:

```sh
cd /Users/hckim/Documents/webuta

npm run neural:prepare-diffsinger-demo -- \
  --out experiments/neural-singer/work/csd-diffsinger-smoke/demo-do-hi-do-hi.ds \
  --dictionary experiments/neural-singer/work/csd-diffsinger-smoke/dictionary-ko.txt

cd .local/neural-singer/openvpi/DiffSinger

/Users/hckim/Documents/webuta/.local/neural-singer/mamba/envs/webuta-diffsinger/bin/python \
  scripts/infer.py acoustic \
  /Users/hckim/Documents/webuta/experiments/neural-singer/work/csd-diffsinger-smoke/demo-do-hi-do-hi.ds \
  --exp /Users/hckim/Documents/webuta/experiments/neural-singer/work/csd-diffsinger-smoke/train-smoke \
  --ckpt 1 \
  --out /Users/hckim/Documents/webuta/experiments/neural-singer/work/csd-diffsinger-smoke/outputs \
  --title demo-do-hi-do-hi \
  --num 1 \
  --mel \
  --steps 5
```

For WAV export, download the OpenVPI community PC-NSF-HiFiGAN 44.1 kHz Hop512
128-bin 2025.02 vocoder into the ignored DiffSinger `checkpoints/` folder and
run the same command without `--mel`. Treat the vocoder and any generated WAVs
as local research artifacts unless the release/license decision is reviewed.

Current smoke output:

- `experiments/neural-singer/work/csd-diffsinger-smoke/outputs/demo-do-hi-do-hi.mel.pt`
- `experiments/neural-singer/work/csd-diffsinger-smoke/outputs/demo-do-hi-do-hi-vocoder.wav`
- `experiments/neural-singer/work/csd-diffsinger-smoke/outputs/demo-do-hi-do-hi-vocoder.diagnostics.json`

The one-step model proves the pipeline, not voice quality.

## DiffSinger Training Run Preparation

For a licensed AI Hub or consent-reviewed private dataset, use the enhanced
DiffSinger dataset produced after MFA/MakeDiffSinger alignment, then generate a
real training run folder:

```sh
npm run neural:prepare-diffsinger-training -- \
  --dataset-dir experiments/neural-singer/work/dataset-id/diffsinger-dataset-enhanced \
  --dataset dataset-id \
  --training-readiness experiments/neural-singer/work/dataset-id-readiness.json \
  --provider-drop-audit experiments/neural-singer/work/dataset-id-provider-drop.json \
  --diffsinger-root .local/neural-singer/openvpi/DiffSinger \
  --out experiments/neural-singer/work/dataset-id-diffsinger-training \
  --model-id webuta-ko-v1 \
  --model-name "WebUtau KO V1" \
  --production \
  --min-production-minutes 30 \
  --min-production-train-items 20 \
  --min-production-updates 50000 \
  --max-updates 200000 \
  --accelerator gpu
```

This writes a compact observed-phone dictionary, production-track
`config.yaml`, `diffsinger-training.manifest.json`, runbook commands for
`binarize.py` and `train.py`, and a `model-checkpoint.template.json` that can be
audited with `npm run neural:audit-checkpoint` after training produces the
target checkpoint. The template is not release evidence until the checkpoint
file exists and the audit passes.

The `--production` flag is the guardrail for real candidate runs. It requires a
passing training-readiness report, declared dataset lineage, a passing
provider-drop report with SHA-256 archive hashes, enough analyzed minutes,
enough enhanced training items, and a non-trivial update budget. Omit
`--production` only for local smoke work such as the tiny CSD research baseline.

## DiffSinger GPU Job Bundle

After the training run folder is prepared, generate a portable GPU job bundle
for the private CUDA machine or cloud instance:

```sh
npm run neural:prepare-diffsinger-gpu-job -- \
  --manifest experiments/neural-singer/work/dataset-id-diffsinger-training/diffsinger-training.manifest.json \
  --out experiments/neural-singer/work/dataset-id-diffsinger-training/gpu-job \
  --remote-work-dir /srv/webuta-diffsinger-runs/dataset-id-v1 \
  --remote-diffsinger-root /srv/openvpi/DiffSinger \
  --remote-python /srv/webuta-diffsinger/bin/python \
  --checkpoint-step 200000 \
  --accelerator gpu
```

The bundle writes a remote-safe `training/config.remote.yaml`, copies the small
dictionary, and generates:

- `upload-to-gpu.sh`
- `training/run-on-gpu.sh`
- `download-checkpoint.sh`
- `gpu-job.manifest.json`

The upload script refuses to transfer the dataset until
`WEBUTA_ACCEPT_REMOTE_DATASET_UPLOAD=1` is set. Only set that variable after the
dataset terms allow private remote/GPU compute. For production-preflight runs,
the GPU job manifest also carries the provider archive-drop audit path and
refuses to build if that provenance is missing. After the checkpoint is
downloaded, run `npm run neural:audit-checkpoint` against the generated
checkpoint manifest before using the model in WebUtau.

## Neural Quality Loop

The fixed phrase set lives in `quality-phrases.json`. It covers:

- `도히도히 다이스키`
- open-vowel sustain
- batchim-heavy Korean
- long coda sustain for repeated batchim artifacts
- fast short notes
- low/mid/high pitch range

Run the evaluator without rendering to inspect generated WebUtau neural request
fixtures:

```sh
npm run neural:evaluate-quality -- --no-render
```

Run the evaluator against the local DiffSinger smoke renderer:

```sh
npm run neural:evaluate-quality -- \
  --accept-local-research-license \
  --steps 5
```

Each run writes ignored artifacts under
`experiments/neural-singer/work/neural-quality/<run-id>/`:

- `request.json` per phrase
- local render request/DS/WAV artifacts
- `quality-diagnostics.json` per phrase
- `quality-summary.json`
- `listening-log.md`
- `listening-scores.template.json`

The objective diagnostics are intentionally modest and repeatable:

- WAV peak/RMS/clipping/silence/noise-floor
- rendered duration vs target score duration
- autocorrelation F0 tracking vs target note pitch
- note onset energy-lag proxy for consonant/timing regressions
- coda sustain burst count for repeated batchim artifacts in long Korean notes

The objective gates in `quality-phrases.json` are necessary but not sufficient
for a usable singer. They catch signal-health regressions, while the listening
score thresholds in the same file must still be filled in by a human listener
for any non-research model handoff.
The current one-step smoke model proves the loop; it does not prove production
voice quality even if objective gates pass.
Copy `listening-scores.template.json` to an ignored `listening-scores.local.json`
after the listening pass, fill reviewer/review date, set `decision` to `pass`
only when the phrase set is acceptable, and score every phrase for Korean
clarity, vowel stability, and artifacts. `private-lab`, `public-demo`, and
`public-model` release audits require those scores to meet the
`minListening*Score` thresholds.

For the current ramp6000 candidate, generate a browser review pack that copies
the fixed phrase WAVs and produces a release-audit-compatible local score
template:

```sh
npm run neural:prepare-listening-review -- \
  --quality-summary experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000-coda-v2/quality-summary.json \
  --release-manifest experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/model-release.local-template.json \
  --out experiments/neural-singer/work/neural-quality/gtsinger-ramp-6000-coda-v2/listening-review
```

Open `listening-review/index.html`, listen through the six samples including
`long-coda-sustain`, and write the completed scores to
`listening-review/listening-scores.local.json`. The release audit intentionally
stays blocked until that human-filled file exists and passes the configured
thresholds.

Compare two rendered quality runs before promoting a newer checkpoint:

```sh
npm run neural:compare-quality -- \
  --baseline experiments/neural-singer/work/neural-quality/previous-run/quality-summary.json \
  --candidate experiments/neural-singer/work/neural-quality/candidate-run/quality-summary.json \
  --out experiments/neural-singer/work/neural-quality/checkpoint-comparison.json \
  --markdown experiments/neural-singer/work/neural-quality/checkpoint-comparison.md
```

The comparison rejects candidates with newly failed gates or blocking
regressions in F0 cents, duration alignment, onset timing, missing onset ratio,
or voiced-frame coverage. Render speed regressions are reported as advisories.

## Neural Checkpoint Runtime Gate

Before treating a trained checkpoint as a usable WebUtau local neural model,
copy `model-checkpoint.example.json` to an ignored run-specific manifest and
audit the checkpoint/runtime wiring:

```sh
npm run neural:audit-checkpoint -- \
  --manifest experiments/neural-singer/work/model-checkpoint.local.json \
  --registry path/to/local-registry.json \
  --report experiments/neural-singer/work/model-checkpoint-audit.json
```

This gate checks dataset lineage, local-training approval, the training run
directory, config, checkpoint step, conversion manifest, training-readiness
report, provider archive-drop evidence for production preflight runs,
DiffSinger `infer.py`, Python env, runtime `--exp/--ckpt`, and vocoder
checkpoint. The default minimum checkpoint step is 1000; a smoke manifest may
lower `training.minCheckpointStep` to 1, but production candidates should use a
real multi-thousand-step checkpoint before quality evaluation.

The checkpoint handoff runner performs checkpoint audit, local render-profile
promotion, and render-profile audit in one reproducible pass:

```sh
npm run neural:run-checkpoint-handoff -- \
  --manifest experiments/neural-singer/work/model-checkpoint.local.json \
  --registry path/to/local-registry.json \
  --work-dir experiments/neural-singer/work/checkpoint-handoff \
  --report experiments/neural-singer/work/checkpoint-handoff/latest.json \
  --endpoint http://127.0.0.1:8787/render
```

Add `--require-browser-smoke --browser-smoke <local-neural-smoke.json>` for a
release-candidate gate after running the promoted service and browser smoke.

After the audit passes, promote the checkpoint into a local render profile:

```sh
npm run neural:promote-checkpoint -- \
  --checkpoint-audit experiments/neural-singer/work/model-checkpoint-audit.json \
  --out experiments/neural-singer/work/promoted-local-neural-model \
  --endpoint http://127.0.0.1:8787/render
```

This writes `local-render-profile.json`, `serve-render.sh`,
`vite-local-neural.env`, and `model-release.local-template.json`. The promotion
step refuses blocked checkpoint audits, so the WebUtau local neural renderer is
only pointed at a checkpoint that already passed runtime and license-lineage
checks.

Audit the promoted profile before using it as the app's local neural runtime:

```sh
npm run neural:audit-render-profile -- \
  --profile experiments/neural-singer/work/promoted-local-neural-model/local-render-profile.json \
  --release-manifest experiments/neural-singer/work/promoted-local-neural-model/model-release.local-template.json \
  --report experiments/neural-singer/work/promoted-local-neural-model/render-profile-audit.json
```

Pass `--browser-smoke path/to/local-neural-browser-smoke.json` only after the
browser smoke was run against the same promoted endpoint. This audit is a
post-training gate; it does not replace the dataset acquisition, license
review, alignment, or training steps.

## Neural Model Release Gate

Before sharing a neural model, copy `model-release.example.json` to an ignored
local path and audit the intended release:

```sh
npm run neural:audit-release -- \
  --manifest experiments/neural-singer/work/model-release.local.json \
  --registry experiments/neural-singer/work/original-private-singer-registry.local.json \
  --report experiments/neural-singer/work/model-release-audit.json
```

The gate checks dataset rights, model release intent, checkpoint audit evidence,
quality-summary gates, quality comparison, browser smoke evidence, listening
scores, and the model terms block. A `local-research` model can pass without a
listening score sheet or provider archive-drop evidence for diagnostics only. A
`private-lab`, `public-demo`, or `public-model` handoff still needs a
`checkpoint-ready` `neural:audit-checkpoint` report that includes provider
archive-drop provenance, plus human listening scores tied to the rendered
quality run. A public model release additionally requires public model
publishing rights and public browser smoke proof.

## Local Neural Render Service

After the DiffSinger smoke checkpoint and local vocoder are present, run the
local render bridge from the WebUtau repo:

```sh
experiments/neural-singer/work/promoted-local-neural-model/serve-render.sh
```

Then start Vite with the endpoint enabled:

```sh
VITE_WEBUTA_NEURAL_ENDPOINT=http://127.0.0.1:8787/render npm run dev
```

The service exposes:

- `GET http://127.0.0.1:8787/health`
- `POST http://127.0.0.1:8787/render`

It writes request JSON, generated DiffSinger `.ds`, diagnostics, and WAV output
under ignored `experiments/neural-singer/work/local-neural-render/`.

When `--model-manifest` points at the audited checkpoint manifest, `GET
/health` includes the current model id, name, release status, and license
summary. The Svelte app reads that health payload when
`VITE_WEBUTA_NEURAL_ENDPOINT` is configured, so the model panel can show the
actual local checkpoint instead of the built-in smoke placeholder.

This bridge is local-only by default and is not part of the static GitHub Pages
deployment. Treat the smoke model, CSD-derived artifacts, and community vocoder
as research-only until model/data release terms are reviewed.

## Browser Render Smoke

Run the browser smoke after UI or renderer-contract changes:

```sh
npm run smoke:browser
```

The script starts a temporary Vite server, opens Chromium with Playwright, and
checks the static no-endpoint state, desktop WAV download, generated WAV
metadata, render history, mobile export controls, touch keyboard visibility,
button labels, and page-level horizontal overflow. Use `-- --url
http://127.0.0.1:5173/` to test an already-running app. Use `-- --out
experiments/neural-singer/work/browser-smoke/static-latest.json` when the
static result should be kept.

For neural-model release evidence, run the local-neural UI path smoke:

```sh
npm run smoke:browser:neural -- \
  --out experiments/neural-singer/work/browser-smoke/neural-latest.json
```

This starts a tiny fake neural endpoint, enables `VITE_WEBUTA_NEURAL_ENDPOINT`,
selects the local DiffSinger model in the UI, downloads a WAV, and checks the
render history/mobile layout path. It proves browser integration with the
local-neural contract; it is not an audio-quality proof.

After promoting a real local checkpoint and starting its `serve-render.sh`, run
the actual local endpoint smoke instead:

```sh
npm run smoke:browser:neural:actual -- \
  --neural-endpoint http://127.0.0.1:8790/render \
  --out experiments/neural-singer/work/gtsinger-korean-promoted-ramp-6000/browser-smoke-actual-local-neural.json
```

The current GTSinger ramp6000 local research candidate passes this actual
endpoint path and writes a 44.1 kHz mono 16-bit WAV from the Svelte UI. Treat
that as private local research evidence only until human listening scores and
release-safe dataset/model terms are available.

## Local Artifact Layout

```txt
.local/neural-singer/
  openvpi/
  venvs/
  notes/

experiments/neural-singer/
  dataset-registry.example.json
  dataset-registry.schema.json
  raw/            # generated only under ignored work outputs
  datasets/       # ignored
  checkpoints/    # ignored
  runs/           # ignored
  outputs/        # ignored
  work/           # ignored
```

## Rules

- Do not commit raw audio from CSD, AI Hub, private singers, or generated model
  outputs unless the license and release plan explicitly allow it.
- Do not commit private singer names, consent forms, or identity metadata.
- Do commit small schemas, conversion scripts, diagnostics templates, and
  non-sensitive summary reports.
- Every experiment must name its data source and license status before training.
