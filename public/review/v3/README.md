# WebUtau Korean V3 Listening Review

This folder contains browser-rendered WAVs from the bundled V3 UTAU sample renderer.

Open: index.html
Score template: listening-scores.local.template.json

Open the HTML scorecard, review each phrase on headphones or neutral speakers, and download `listening-scores.local.json` after the scorecard says it passes.
The HTML scorecard autosaves an in-progress draft in the current browser and includes a clear-draft control.
The scorecard shows metadata, phrase-score, V2/V3 comparison progress, and a problem list; JSON download stays disabled until every required score meets the release thresholds.
Accept the downloaded file with `npm run voicebank:accept-review-v3 -- --scores path/to/listening-scores.local.json` before running the final release audit.
No new voice recording is required or requested. Score only the generated synthetic V3 WAVs.
Score 1-5 for Korean clarity, vowel stability, consonant clarity, musicality, and artifacts.
This pack also includes legacy V2 baseline WAVs. Score whether V3 is clearly better than V2 before release.

## Phrases

- first-run-demo: First-run hook (도 히 도 히 다 이 스 키)
- coda-release-check: Batchim release check (연 한 랑 밤 말)
- clear-cv-line: Clear CV line (가 나 다 라 마 사)
- vowel-color-check: Vowel color check (아 이 우 에 오)

## Legacy V2 Comparisons
- first-run-demo: audio/legacy-v2/01-first-run-demo-legacy-v2.wav
- coda-release-check: audio/legacy-v2/02-coda-release-check-legacy-v2.wav
- clear-cv-line: audio/legacy-v2/03-clear-cv-line-legacy-v2.wav
- vowel-color-check: audio/legacy-v2/04-vowel-color-check-legacy-v2.wav
