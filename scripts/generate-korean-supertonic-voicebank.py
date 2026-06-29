#!/usr/bin/env python3
"""Generate the bundled Korean CV voicebank from Supertonic 3 TTS output.

This script intentionally keeps model generation outside the browser app.
Install the Python package in a local venv first:

    pip install supertonic

Then run:

    python scripts/generate-korean-supertonic-voicebank.py
"""

from __future__ import annotations

import json
import os
import struct
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

TTS_SAMPLE_RATE = 44100
SAMPLE_RATE = 32000
OUTPUT = Path("public/voicebanks/webuta-ko-lite.zip")
ZIP_DATE_TIME = (2026, 1, 1, 0, 0, 0)
TARGET_SAMPLE_SECONDS = 1.72
LOOP_SECONDS = 0.58
LOOP_CROSSFADE_SECONDS = 0.14
RELEASE_SECONDS = 0.18
MODEL_NAME = "supertonic-3"
MODEL_REPO = "Supertone/supertonic-3"
MODEL_REVISION = "724fb5abbf5502583fb520898d45929e62f02c0b"
VOICE_NAME = os.environ.get("WEBUTA_SUPERTONIC_VOICE", "F3")

ONSETS = [
    ("g", "ㄱ"),
    ("kk", "ㄲ"),
    ("n", "ㄴ"),
    ("d", "ㄷ"),
    ("tt", "ㄸ"),
    ("r", "ㄹ"),
    ("m", "ㅁ"),
    ("b", "ㅂ"),
    ("pp", "ㅃ"),
    ("s", "ㅅ"),
    ("ss", "ㅆ"),
    ("", "ㅇ"),
    ("j", "ㅈ"),
    ("jj", "ㅉ"),
    ("ch", "ㅊ"),
    ("k", "ㅋ"),
    ("t", "ㅌ"),
    ("p", "ㅍ"),
    ("h", "ㅎ"),
]

VOWELS = [
    ("a", "ㅏ"),
    ("ae", "ㅐ"),
    ("ya", "ㅑ"),
    ("yae", "ㅒ"),
    ("eo", "ㅓ"),
    ("e", "ㅔ"),
    ("yeo", "ㅕ"),
    ("ye", "ㅖ"),
    ("o", "ㅗ"),
    ("wa", "ㅘ"),
    ("wae", "ㅙ"),
    ("oe", "ㅚ"),
    ("yo", "ㅛ"),
    ("u", "ㅜ"),
    ("wo", "ㅝ"),
    ("we", "ㅞ"),
    ("wi", "ㅟ"),
    ("yu", "ㅠ"),
    ("eu", "ㅡ"),
    ("ui", "ㅢ"),
    ("i", "ㅣ"),
]

ALT_ROMAN_ALIASES = {
    "스": ["su"],
    "즈": ["zu"],
    "츠": ["tsu"],
    "쓰": ["ssu"],
    "크": ["ku"],
    "그": ["gu"],
    "드": ["du"],
    "트": ["tu"],
    "브": ["bu"],
    "프": ["pu"],
    "흐": ["hu", "fu"],
    "르": ["ru"],
    "느": ["nu"],
    "므": ["mu"],
    "으": ["u"],
}

FRICATIVE_ONSETS = {"ㅅ", "ㅆ", "ㅈ", "ㅉ", "ㅊ", "ㅎ"}
STOP_ONSETS = {"ㄱ", "ㄲ", "ㄷ", "ㄸ", "ㅂ", "ㅃ", "ㅋ", "ㅌ", "ㅍ"}
NASAL_LIQUID_ONSETS = {"ㄴ", "ㄹ", "ㅁ"}


@dataclass(frozen=True)
class OtoPreset:
    consonant_ms: int
    preutterance_ms: int
    overlap_ms: int


def main() -> int:
    try:
        from supertonic import TTS
    except ImportError:
        print("Install the optional generator dependency first: pip install supertonic", file=sys.stderr)
        return 1

    tts = TTS(model=MODEL_NAME, auto_download=True)
    voice_style = tts.get_voice_style(VOICE_NAME)
    files: dict[str, bytes | str] = {}
    oto_lines: list[str] = []

    print(f"Generating {OUTPUT} with {MODEL_NAME}/{VOICE_NAME} ...")
    index = 0
    for onset_index, (onset_roman, onset) in enumerate(ONSETS):
        for vowel_index, (vowel_roman, vowel) in enumerate(VOWELS):
            syllable = hangul_syllable(onset_index, vowel_index)
            file_name = f"ko_{index:03d}_C4.wav"
            samples = synthesize_syllable(tts, voice_style, syllable)
            preset = oto_preset(onset)
            files[f"samples/{file_name}"] = encode_wav(samples)
            aliases = aliases_for(syllable, onset_roman, vowel_roman)
            for alias in aliases:
                oto_lines.append(
                    f"{file_name}={alias},0,{preset.consonant_ms},-1540,"
                    f"{preset.preutterance_ms},{preset.overlap_ms}"
                )
            index += 1
        print(f"  {onset or 'ㅇ'} row done")

    manifest = {
        "id": "webuta-ko-supertonic-v2",
        "name": "WebUtau Korean V2",
        "type": "tts-generated-utau-cv",
        "sampleRate": SAMPLE_RATE,
        "baseTone": "C4",
        "sampleSeconds": TARGET_SAMPLE_SECONDS,
        "sustainLoop": True,
        "model": {
            "name": MODEL_NAME,
            "repo": MODEL_REPO,
            "revision": MODEL_REVISION,
            "voice": VOICE_NAME,
            "license": "OpenRAIL-M",
        },
        "coverage": {
            "hangulCvAliases": len(ONSETS) * len(VOWELS),
            "exactCodaSupport": False,
        },
    }

    files["oto.ini"] = "\r\n".join(oto_lines) + "\r\n"
    files["character.yaml"] = "\n".join(
        [
            "name: WebUtau Korean V2",
            "text_file_encoding: utf-8",
            "author: WebUtau Project",
            "web: https://midagedev.github.io/webuta/",
            "",
        ]
    )
    files["readme.txt"] = "\r\n".join(
        [
            "WebUtau Korean V2",
            "",
            "A Korean CV starter UTAU-style voicebank generated from Supertonic 3 TTS output.",
            "It contains Hangul onset+vowel samples and romanized aliases for browser vocal synthesis.",
            "Each sample is generated from an elongated vowel prompt and extended with a long sustain loop.",
            "Final consonants are currently approximated to matching CV aliases by the WebUtau lyric matcher.",
            "",
            "This is not Kasane Teto, Vocaloid, OpenUtau, or a human singer sample pack.",
            "Do not imply that the voice belongs to a real singer or third-party character.",
            "",
        ]
    )
    files["license.txt"] = "\r\n".join(
        [
            "WebUtau Korean V2 voicebank",
            "",
            "The voicebank metadata and packaging are part of the WebUtau project.",
            "The WAV samples were generated from Supertonic 3 TTS output.",
            "",
            f"Model: {MODEL_REPO}",
            f"Revision: {MODEL_REVISION}",
            f"Voice style: {VOICE_NAME}",
            "Model license: OpenRAIL-M. Review the model license before redistribution.",
            "",
            "No Kasane Teto, Vocaloid, OpenUtau, commercial singer, or human-recorded third-party sample is included.",
            "",
        ]
    )
    files["webuta-ko-lite.manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    write_zip(OUTPUT, files)
    print(f"Wrote {OUTPUT} ({index} samples, {len(oto_lines)} aliases)")
    return 0


def synthesize_syllable(tts, voice_style, syllable: str) -> np.ndarray:
    vowel_tail = elongated_tail_for_syllable(syllable)
    wav, _duration = tts.synthesize(
        f"{syllable}{vowel_tail}",
        voice_style=voice_style,
        lang="ko",
        speed=0.92,
        total_steps=10,
        max_chunk_length=48,
        silence_duration=0.04,
    )
    mono = np.asarray(wav, dtype=np.float32).reshape(-1)
    mono = resample_linear(mono, int(getattr(tts, "sample_rate", TTS_SAMPLE_RATE)), SAMPLE_RATE)
    cropped = crop_active(mono)
    sustained = extend_sustain(cropped, TARGET_SAMPLE_SECONDS)
    leveled = level_sustain_body(sustained)
    return normalize_peak(leveled, 0.86)


def crop_active(samples: np.ndarray) -> np.ndarray:
    envelope = moving_rms(samples, window=1024)
    peak = float(envelope.max()) if envelope.size else 0.0
    if peak <= 1e-5:
        return samples[: int(SAMPLE_RATE * TARGET_SAMPLE_SECONDS)]
    threshold = max(peak * 0.045, 0.003)
    active = np.flatnonzero(envelope >= threshold)
    if active.size == 0:
        return samples[: int(SAMPLE_RATE * TARGET_SAMPLE_SECONDS)]
    start = max(0, int(active[0]) - int(SAMPLE_RATE * 0.065))
    end = min(samples.size, int(active[-1]) + int(SAMPLE_RATE * 0.22))
    return fade_edges(samples[start:end].copy(), 0.006, 0.04)


def moving_rms(samples: np.ndarray, window: int) -> np.ndarray:
    if samples.size == 0:
        return np.array([], dtype=np.float32)
    square = samples * samples
    kernel = np.ones(window, dtype=np.float32) / window
    return np.sqrt(np.convolve(square, kernel, mode="same"))


def extend_sustain(samples: np.ndarray, target_seconds: float) -> np.ndarray:
    target_length = int(SAMPLE_RATE * target_seconds)
    if samples.size <= 0:
        return np.zeros(target_length, dtype=np.float32)

    loop_start, loop_end = find_loop_region(samples)
    loop = samples[loop_start:loop_end].copy()
    if loop.size < int(SAMPLE_RATE * 0.035):
        padded = np.zeros(target_length, dtype=np.float32)
        padded[: min(samples.size, target_length)] = samples[:target_length]
        return fade_edges(padded, 0.006, RELEASE_SECONDS)

    output = np.zeros(target_length, dtype=np.float32)
    release_length = int(SAMPLE_RATE * RELEASE_SECONDS)
    sustain_end = max(1, target_length - release_length)
    head_length = min(loop_end, sustain_end)
    output[:head_length] = samples[:head_length]

    position = head_length
    crossfade = min(int(SAMPLE_RATE * LOOP_CROSSFADE_SECONDS), max(4, loop.size // 3))
    while position < sustain_end:
        write_count = min(loop.size, sustain_end - position)
        write_loop(output, position, loop[:write_count], crossfade)
        position += write_count

    if position < target_length:
        release = make_release_tail(output, position, target_length)
        output[position:target_length] = release

    return fade_edges(output, 0.006, RELEASE_SECONDS)


def find_loop_region(samples: np.ndarray) -> tuple[int, int]:
    loop_length = int(SAMPLE_RATE * LOOP_SECONDS)
    if samples.size <= loop_length + 2:
        return 0, samples.size

    envelope = moving_rms(samples, window=1024)
    peak = float(envelope.max()) if envelope.size else 0.0
    if peak <= 1e-5:
        start = max(0, samples.size // 2 - loop_length // 2)
        return start, min(samples.size, start + loop_length)

    active = np.flatnonzero(envelope >= max(peak * 0.22, 0.0025))
    if active.size == 0:
        start = max(0, samples.size // 2 - loop_length // 2)
        return start, min(samples.size, start + loop_length)

    active_start = int(active[0])
    active_end = int(active[-1])
    active_span = max(loop_length + 1, active_end - active_start)
    search_start = min(samples.size - loop_length - 1, active_start + int(active_span * 0.22))
    search_end = min(samples.size - loop_length - 1, max(search_start, active_start + int(active_span * 0.72)))
    if search_end <= search_start:
        search_start = max(0, min(samples.size - loop_length - 1, active_start + int(active_span * 0.45)))
        search_end = search_start

    best_start = search_start
    best_score = float("inf")
    step = 128
    for start in range(search_start, search_end + 1, step):
        end = start + loop_length
        head = samples[start : start + min(512, loop_length)]
        tail = samples[end - min(512, loop_length) : end]
        env_score = abs(float(envelope[start]) - float(envelope[min(envelope.size - 1, end - 1)]))
        edge_score = abs(float(np.mean(head)) - float(np.mean(tail)))
        segment = samples[start:end]
        energy = float(np.mean(np.abs(segment)))
        envelope_variance = float(np.std(envelope[start:end:max(1, step)]))
        center = start + loop_length / 2
        center_bias = abs(center - (active_start + active_span * 0.52)) / max(1, active_span)
        score = env_score + edge_score * 0.8 + envelope_variance * 0.34 + center_bias * 0.015 - energy * 0.2
        if score < best_score:
            best_score = score
            best_start = start
    return best_start, min(samples.size, best_start + loop_length)


def write_loop(output: np.ndarray, position: int, loop: np.ndarray, crossfade: int) -> None:
    write_count = loop.size
    if write_count == 0:
        return
    blend_count = min(crossfade, position, write_count)
    if blend_count > 0:
        for i in range(blend_count):
            blend = (i + 1) / blend_count
            output[position + i] = output[position + i] * (1.0 - blend) + loop[i] * blend
    if write_count > blend_count:
        output[position + blend_count : position + write_count] = loop[blend_count:write_count]


def make_release_tail(output: np.ndarray, position: int, target_length: int) -> np.ndarray:
    tail_length = target_length - position
    if tail_length <= 0:
        return np.array([], dtype=np.float32)
    source_start = max(0, position - min(tail_length, int(SAMPLE_RATE * LOOP_SECONDS)))
    source = output[source_start:position]
    if source.size == 0:
        return np.zeros(tail_length, dtype=np.float32)
    repeated = np.resize(source, tail_length).astype(np.float32)
    repeated *= np.linspace(1.0, 0.0, tail_length, dtype=np.float32)
    return repeated


def level_sustain_body(samples: np.ndarray) -> np.ndarray:
    output = samples.copy()
    body_start = int(SAMPLE_RATE * 0.28)
    body_end = min(samples.size, int(SAMPLE_RATE * (TARGET_SAMPLE_SECONDS - RELEASE_SECONDS - 0.04)))
    if body_end <= body_start:
        return output
    envelope = moving_rms(samples, window=max(512, int(SAMPLE_RATE * 0.045)))
    body = envelope[body_start:body_end]
    voiced = body[body > max(0.004, float(body.max()) * 0.18)]
    if voiced.size == 0:
        return output
    target = float(np.percentile(voiced, 68))
    for i in range(body_start, body_end):
        current = float(envelope[i])
        if current <= 1e-5:
            continue
        gain = np.clip(target / current, 0.62, 2.15)
        edge = min((i - body_start) / max(1, int(SAMPLE_RATE * 0.08)), (body_end - i) / max(1, int(SAMPLE_RATE * 0.08)), 1.0)
        output[i] *= 1.0 + (gain - 1.0) * max(0.0, edge)
    return output


def resample_linear(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate:
        return samples.astype(np.float32)
    if samples.size == 0:
        return samples.astype(np.float32)
    target_length = max(1, round(samples.size * target_rate / source_rate))
    source_positions = np.arange(target_length, dtype=np.float32) * (source_rate / target_rate)
    left = np.floor(source_positions).astype(np.int64)
    right = np.minimum(left + 1, samples.size - 1)
    frac = source_positions - left
    return (samples[left] * (1.0 - frac) + samples[right] * frac).astype(np.float32)


def normalize_peak(samples: np.ndarray, target: float) -> np.ndarray:
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1e-6:
        return samples.astype(np.float32)
    return (samples * min(12.0, target / peak)).astype(np.float32)


def fade_edges(samples: np.ndarray, fade_in_seconds: float, fade_out_seconds: float) -> np.ndarray:
    fade_in = min(samples.size, int(SAMPLE_RATE * fade_in_seconds))
    fade_out = min(samples.size, int(SAMPLE_RATE * fade_out_seconds))
    if fade_in > 1:
        samples[:fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
    if fade_out > 1:
        samples[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)
    return samples


def oto_preset(onset: str) -> OtoPreset:
    if not onset or onset == "ㅇ":
        return OtoPreset(consonant_ms=70, preutterance_ms=34, overlap_ms=18)
    if onset in FRICATIVE_ONSETS:
        return OtoPreset(consonant_ms=150, preutterance_ms=78, overlap_ms=24)
    if onset in STOP_ONSETS:
        return OtoPreset(consonant_ms=128, preutterance_ms=64, overlap_ms=22)
    if onset in NASAL_LIQUID_ONSETS:
        return OtoPreset(consonant_ms=118, preutterance_ms=58, overlap_ms=24)
    return OtoPreset(consonant_ms=110, preutterance_ms=56, overlap_ms=22)


def aliases_for(syllable: str, onset_roman: str, vowel_roman: str) -> list[str]:
    aliases = {syllable}
    roman = f"{onset_roman}{vowel_roman}"
    if roman:
        aliases.add(roman)
    aliases.update(ALT_ROMAN_ALIASES.get(syllable, []))
    return sorted(aliases)


def hangul_syllable(onset_index: int, vowel_index: int) -> str:
    return chr(0xAC00 + onset_index * 21 * 28 + vowel_index * 28)


def elongated_tail_for_syllable(syllable: str) -> str:
    code = ord(syllable)
    if code < 0xAC00 or code > 0xD7A3:
        return syllable * 5
    offset = code - 0xAC00
    vowel_index = (offset % (21 * 28)) // 28
    vowel_only = chr(0xAC00 + 11 * 21 * 28 + vowel_index * 28)
    return vowel_only * 5


def encode_wav(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = np.where(clipped < 0, clipped * 32768.0, clipped * 32767.0).astype("<i2")
    data = pcm.tobytes()
    byte_rate = SAMPLE_RATE * 2
    header = b"".join(
        [
            b"RIFF",
            struct.pack("<I", 36 + len(data)),
            b"WAVEfmt ",
            struct.pack("<IHHIIHH", 16, 1, 1, SAMPLE_RATE, byte_rate, 2, 16),
            b"data",
            struct.pack("<I", len(data)),
        ]
    )
    return header + data


def write_zip(path: Path, files: dict[str, bytes | str]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in sorted(files):
            payload = files[name]
            info = zipfile.ZipInfo(name, ZIP_DATE_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            if isinstance(payload, str):
                archive.writestr(info, payload.encode("utf-8"))
            else:
                archive.writestr(info, payload)


if __name__ == "__main__":
    raise SystemExit(main())
