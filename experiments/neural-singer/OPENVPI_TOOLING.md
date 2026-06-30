# OpenVPI / DiffSinger Tooling Runbook

This project keeps OpenVPI tooling outside the WebUtau app dependency graph.
Clone and install tooling under ignored local paths only.

## Local Paths

```txt
.local/neural-singer/openvpi/MakeDiffSinger/
.local/neural-singer/openvpi/DiffSinger/
.local/neural-singer/openvpi/dataset-tools/
.local/neural-singer/mamba/
.local/neural-singer/mfa-root/
```

## Clone Tooling

Preferred project command:

```sh
npm run neural:setup-openvpi
```

This clones/reuses the OpenVPI repositories under `.local/neural-singer/openvpi`
and writes an ignored `tooling-manifest.json` with commit hashes and local tool
availability.

Equivalent manual commands:

```sh
mkdir -p .local/neural-singer/openvpi
git clone --depth 1 https://github.com/openvpi/MakeDiffSinger.git .local/neural-singer/openvpi/MakeDiffSinger
git clone --depth 1 https://github.com/openvpi/DiffSinger.git .local/neural-singer/openvpi/DiffSinger
git clone --depth 1 https://github.com/openvpi/dataset-tools.git .local/neural-singer/openvpi/dataset-tools
```

## MakeDiffSinger Acoustic Alignment Notes

MakeDiffSinger's acoustic forced-alignment pipeline expects a sliced corpus
where every WAV segment has a matching `.lab` file. The WebUtau seed adapter
therefore writes:

```txt
raw/wavs/name.wav
raw/wavs/name.lab
raw/transcriptions.csv
```

The seed `transcriptions.csv` contains `name,text` rows for bookkeeping. It is
not the final training CSV. After MFA/TextGrid alignment, MakeDiffSinger builds
the final dataset with `name`, `ph_seq`, and `ph_dur` columns.

## MFA Environment

The upstream MakeDiffSinger forced-alignment guide uses Conda and Montreal
Forced Aligner. WebUtau uses a local micromamba environment under `.local/` so
the app dependency graph stays clean.

```sh
npm run neural:setup-mfa -- --create-env --install-makediffsinger-reqs
```

Korean alignment will require a Korean-compatible dictionary and MFA acoustic
model. Do not assume the Mandarin/Japanese examples are suitable for Korean.
Use `MFA_ROOT_DIR=.local/neural-singer/mfa-root` for MFA commands so downloaded
models, caches, and command history stay inside ignored project-local storage.

For near-term TextGrid alignment, prefer the official `korean_mfa` dictionary
and acoustic model. The official model uses an IPA-like phone inventory, which
is different from WebUtau's simpler internal romanized Korean phone inventory.

Generate the WebUtau Korean dictionary from an OpenVPI seed corpus:

```sh
npm run neural:prepare-mfa-dictionary -- \
  --seed-dir experiments/neural-singer/work/dataset-id-openvpi-seed
```

This writes `korean.dict`, `phones.txt`, `oov-report.json`, and a manifest under
the seed corpus by default. The dictionary maps Korean label tokens to the same
phone inventory used by WebUtau's neural render request. It does not replace the
need for a Korean-compatible MFA acoustic model trained for that phone set.
Use this generated dictionary for coverage analysis and for a future custom
acoustic model; do not mix it with the official `korean_mfa` acoustic model.

Current local status from the latest setup manifest:

- MakeDiffSinger and dataset-tools are cloned under `.local/neural-singer/openvpi/`.
- Local micromamba is installed under `.local/neural-singer/mamba/bin/micromamba`.
- `webuta-mfa` env exists under `.local/neural-singer/mamba/envs/webuta-mfa`.
- Env Python is `3.8.20`.
- Env MFA is `2.0.6`.
- MakeDiffSinger acoustic alignment Python requirements are installed.
- `webuta-mfa3` env exists under `.local/neural-singer/mamba/envs/webuta-mfa3`
  for official MFA 3 Korean model alignment.
- MFA 3 needed `kalpy=0.9.*`, `python-mecab-ko`, and `jamo` in this local run.
- `webuta-diffsinger` env exists under
  `.local/neural-singer/mamba/envs/webuta-diffsinger` for DiffSinger
  training/inference.
- `webuta-diffsinger` runtime imports are verified for `torch`, `lightning`,
  `librosa`, `parselmouth`, `pyworld`, `onnx`, `yaml`, `soundfile`, and
  `numpy`.
- The OpenVPI community PC-NSF-HiFiGAN 44.1 kHz Hop512 128-bin 2025.02 vocoder
  was downloaded under ignored DiffSinger `checkpoints/` for local smoke WAV
  export. Do not commit or publicly redistribute it from this repo without a
  separate license/release review.

Run a command in the env:

```sh
.local/neural-singer/mamba/bin/micromamba run \
  -p .local/neural-singer/mamba/envs/webuta-mfa \
  mfa version
```

Run MFA model commands with the project-local root:

```sh
MFA_ROOT_DIR=.local/neural-singer/mfa-root \
  .local/neural-singer/mamba/bin/micromamba run \
  -p .local/neural-singer/mamba/envs/webuta-mfa \
  mfa model download acoustic korean_mfa

MFA_ROOT_DIR=.local/neural-singer/mfa-root \
  .local/neural-singer/mamba/bin/micromamba run \
  -p .local/neural-singer/mamba/envs/webuta-mfa \
  mfa model download dictionary korean_mfa
```

Audit seed labels against the official Korean MFA dictionary:

```sh
npm run neural:audit-mfa-labels -- \
  --seed-dir experiments/neural-singer/work/dataset-id-openvpi-seed \
  --dictionary .local/neural-singer/mfa-root/pretrained_models/dictionary/korean_mfa.dict
```

## Licenses

- MakeDiffSinger: check upstream repository license before vendoring scripts or
  publishing derived pipeline files.
- DiffSinger: Apache 2.0 according to the upstream repository.
- OpenVPI dataset-tools: Apache 2.0 according to the upstream README at the
  time this runbook was written.
- OpenVPI community vocoder assets: treat as local research/runtime artifacts
  until the specific release terms are reviewed for redistribution.
- Any dataset, singer recording, trained model, and generated audio still needs
  its own registry entry and release decision.

## Current WebUtau Commands

```sh
npm run neural:audit-datasets -- --registry path/to/local-registry.json
npm run neural:ingest-dataset -- --registry path/to/local-registry.json --dataset dataset-id --out experiments/neural-singer/work/dataset-id-ingest
npm run neural:prepare-openvpi -- --ingest-dir experiments/neural-singer/work/dataset-id-ingest --out experiments/neural-singer/work/dataset-id-openvpi-seed --copy-audio
npm run neural:audit-mfa-labels -- --seed-dir experiments/neural-singer/work/dataset-id-openvpi-seed --dictionary .local/neural-singer/mfa-root/pretrained_models/dictionary/korean_mfa.dict
npm run neural:prepare-mfa-dictionary -- --seed-dir experiments/neural-singer/work/dataset-id-openvpi-seed
npm run neural:setup-openvpi
npm run neural:setup-diffsinger -- --create-env --install-torch --install-requirements
npm run neural:setup-mfa -- --create-env --install-makediffsinger-reqs
```

CSD research smoke corpus path:

```sh
npm run neural:prepare-csd-smoke -- \
  --csd-root experiments/neural-singer/datasets/csd/extracted/CSD/korean \
  --ids kr007a \
  --out experiments/neural-singer/work/csd-mfa-smoke

npm run neural:audit-mfa-labels -- \
  --seed-dir experiments/neural-singer/work/csd-mfa-smoke \
  --dictionary .local/neural-singer/mfa-root/pretrained_models/dictionary/korean_mfa.dict
```

If the audit reports OOV syllables, generate G2P additions and write an
augmented dictionary under the ignored work folder:

```sh
MFA_ROOT_DIR=.local/neural-singer/mfa-root \
  .local/neural-singer/mamba/bin/micromamba run \
  -p .local/neural-singer/mamba/envs/webuta-mfa \
  mfa g2p korean_mfa path/to/oov-tokens.txt path/to/oov-generated.dict --clean --overwrite

npm run neural:augment-mfa-dictionary -- \
  --base .local/neural-singer/mfa-root/pretrained_models/dictionary/korean_mfa.dict \
  --additions path/to/oov-generated.dict \
  --out experiments/neural-singer/work/csd-mfa-smoke/korean_mfa.augmented.dict

npm run neural:simplify-mfa-dictionary -- \
  --dictionary experiments/neural-singer/work/csd-mfa-smoke/korean_mfa.augmented.dict \
  --out experiments/neural-singer/work/csd-mfa-smoke/korean_mfa.makediffsinger.dict
```

Run official Korean MFA alignment with the MFA 3 environment:

```sh
MFA_ROOT_DIR=.local/neural-singer/mfa-root \
  .local/neural-singer/mamba/bin/micromamba run \
  -p .local/neural-singer/mamba/envs/webuta-mfa3 \
  mfa align \
  experiments/neural-singer/work/csd-mfa-smoke/raw/wavs \
  experiments/neural-singer/work/csd-mfa-smoke/korean_mfa.csd-smoke.dict \
  korean_mfa \
  experiments/neural-singer/work/csd-mfa-smoke/textgrids/mfa3 \
  --clean --overwrite
```

Enhance TextGrids and build a small DiffSinger-compatible dataset with the
MakeDiffSinger helper scripts:

```sh
.local/neural-singer/mamba/bin/micromamba run \
  -p .local/neural-singer/mamba/envs/webuta-mfa \
  python .local/neural-singer/openvpi/MakeDiffSinger/acoustic_forced_alignment/enhance_tg.py \
  --wavs experiments/neural-singer/work/csd-mfa-smoke/raw/wavs \
  --dictionary experiments/neural-singer/work/csd-mfa-smoke/korean_mfa.makediffsinger.dict \
  --src experiments/neural-singer/work/csd-mfa-smoke/textgrids/mfa3 \
  --dst experiments/neural-singer/work/csd-mfa-smoke/textgrids/enhanced

.local/neural-singer/mamba/bin/micromamba run \
  -p .local/neural-singer/mamba/envs/webuta-mfa \
  python .local/neural-singer/openvpi/MakeDiffSinger/acoustic_forced_alignment/build_dataset.py \
  --wavs experiments/neural-singer/work/csd-mfa-smoke/raw/wavs \
  --tg experiments/neural-singer/work/csd-mfa-smoke/textgrids/enhanced \
  --dataset experiments/neural-singer/work/csd-mfa-smoke/diffsinger-dataset-enhanced \
  --skip_silence_insertion
```
