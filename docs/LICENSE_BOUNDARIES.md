# License Boundaries

This is an engineering checklist, not legal advice.

## OpenUtau Code

OpenUtau's repository license is MIT. That is favorable for a web port: copying, modifying, distributing, sublicensing, and commercial use are allowed when the copyright and license notice are preserved.

Action:

- [ ] Keep OpenUtau copyright and MIT text in this repo before copying substantial source.
- [x] Add an About / Licenses screen before a public release.
- [ ] Track copied OpenUtau files and upstream commit hashes.

## Dependencies

OpenUtau references packages and native components with their own licenses. The web port must audit each dependency that is bundled in the browser, server renderer, or downloadable package.

Action:

- [ ] Generate dependency notices for npm packages.
- [ ] Audit any copied C# packages if an OpenUtau server renderer is added.
- [ ] Audit WORLDLINE native/WASM distribution terms before shipping it.
- [ ] Audit ONNX Runtime Web or server-side ONNX Runtime terms before bundling.

## Singers, Voicebanks, and Models

The OpenUtau code license does not grant rights to redistribute voicebanks, AI singers, ENUNU models, DiffSinger models, or generated audio under those voice/model licenses.

Kasane Teto's official UTAU page provides an OpenUTAU Japanese library set and recommends installing the downloaded `TETO-OUset240323.zip` in OpenUTAU. The official voice guidelines allow broad non-commercial personal/doujin use, but prohibit selling or distributing the whole or part of the UTAU voice library without permission.

Action:

- [ ] Pick a default singer with explicit redistribution permission.
- [ ] Display singer license and usage terms in the singer picker.
- [ ] Keep user-uploaded singers private to the user's browser/account.
- [ ] Do not bundle third-party commercial or unclear-license voices.
- [x] Treat Kasane Teto UTAU as a user-imported official download, not a bundled asset.

## External Resamplers and Plugins

Desktop OpenUtau can run external binaries. A web app cannot safely or legally assume those binaries may be redistributed or run on a server.

Action:

- [ ] Do not upload and execute arbitrary EXE/BAT plugins.
- [ ] Build a sandboxed JS/WASM plugin API for web-native plugins.
- [ ] Treat server-side compatibility execution as opt-in and isolated per user.

## Naming

Vocaloid is a third-party mark. The product should describe itself as a vocal synth or singing voice editor unless separate trademark review says otherwise.

Action:

- [x] Use WebUtau and vocal synth wording in the app.
- [ ] Avoid implying Yamaha/Vocaloid compatibility beyond import/export facts that are true and documented.

## Project Artwork

The cyber vocal mascot illustration in `src/assets/cyber-vocal-hero.png` and `src/assets/cyber-vocal-hero.webp` is an original project visual generated for this app. It is not a Kasane Teto, Vocaloid, OpenUtau, or third-party singer asset.

Action:

- [x] Keep mascot artwork visually distinct from existing singer characters.
- [x] Do not use third-party singer artwork as bundled UI branding.
- [x] Add an About / Credits screen before a public release that lists project artwork and generated-asset notes.
