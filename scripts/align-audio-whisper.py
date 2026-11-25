#!/usr/bin/env python3
"""
Acoustic forced-alignment pipeline for IELTS Listening Vol 7-9 (all 28 ready tests).
Uses native whisper.cpp (DTW centisecond token timestamps) + Unique N-gram LIS Anchors
+ Banded Needleman-Wunsch DP to lock official IELTS transcripts onto exact audio timings.

Never modifies F:\\IELTS\\Vol. Keeps .whisper-tools/ and .whisper-cache/ out of git.
"""

import argparse
import bisect
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

import pymupdf

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = PROJECT_ROOT / "public" / "data"
CACHE_DIR = PROJECT_ROOT / ".whisper-cache"
TOOLS_BIN = PROJECT_ROOT / ".whisper-tools" / "bin" / "whisper-cli.exe"
MODELS_DIR = PROJECT_ROOT / ".whisper-tools" / "models"
FFMPEG_BIN = PROJECT_ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"

# Load shared helpers & test specs from prepare-data.py (filename uses hyphen)
_prep_spec = importlib.util.spec_from_file_location(
    "prepare_data", PROJECT_ROOT / "scripts" / "prepare-data.py"
)
assert _prep_spec and _prep_spec.loader
prep = importlib.util.module_from_spec(_prep_spec)
_prep_spec.loader.exec_module(prep)

MODEL_CONFIGS: dict[str, dict[str, Any]] = {
    "base_f16": {
        "model": "ggml-base.en.bin",
        "dtw": "base.en",
        "vad": False,
    },
    "base_q5_novad": {
        "model": "ggml-base.en-q5_1.bin",
        "dtw": "base.en",
        "vad": False,
    },
    "base_q5_vad": {
        "model": "ggml-base.en-q5_1.bin",
        "dtw": "base.en",
        "vad": True,
    },
    "tiny_novad": {
        "model": "ggml-tiny.en.bin",
        "dtw": "tiny.en",
        "vad": False,
    },
    "tiny_vad": {
        "model": "ggml-tiny.en.bin",
        "dtw": "tiny.en",
        "vad": True,
    },
}

VAD_MODEL = "ggml-silero-v5.1.2.bin"

UK_US_MAP = {
    "colour": "color",
    "colours": "colors",
    "coloured": "colored",
    "colourful": "colorful",
    "centre": "center",
    "centres": "centers",
    "centred": "centered",
    "programme": "program",
    "programmes": "programs",
    "theatre": "theater",
    "theatres": "theaters",
    "organise": "organize",
    "organises": "organizes",
    "organised": "organized",
    "organising": "organizing",
    "organisation": "organization",
    "organisations": "organizations",
    "favourite": "favorite",
    "favourites": "favorites",
    "favour": "favor",
    "catalogue": "catalog",
    "catalogues": "catalogs",
    "kilometre": "kilometer",
    "kilometres": "kilometers",
    "metre": "meter",
    "metres": "meters",
    "litre": "liter",
    "litres": "liters",
    "licence": "license",
    "licences": "licenses",
    "practise": "practice",
    "practised": "practiced",
    "realise": "realize",
    "realises": "realizes",
    "realised": "realized",
    "recognise": "recognize",
    "recognises": "recognizes",
    "recognised": "recognized",
    "analyse": "analyze",
    "analysed": "analyzed",
    "specialise": "specialize",
    "specialises": "specializes",
    "specialised": "specialized",
    "summarise": "summarize",
    "minimise": "minimize",
    "maximise": "maximize",
    "emphasise": "emphasize",
    "apologise": "apologize",
    "apologised": "apologized",
    "neighbour": "neighbor",
    "neighbours": "neighbors",
    "neighbourhood": "neighborhood",
    "harbour": "harbor",
    "harbours": "harbors",
    "behaviour": "behavior",
    "behaviours": "behaviors",
    "labour": "labor",
    "honour": "honor",
    "flavour": "flavor",
    "flavours": "flavors",
    "humour": "humor",
    "rumour": "rumor",
    "grey": "gray",
    "tyre": "tire",
    "tyres": "tires",
    "cheque": "check",
    "cheques": "checks",
    "aeroplane": "airplane",
    "aeroplanes": "airplanes",
    "enquire": "inquire",
    "enquiry": "inquiry",
    "enquiries": "inquiries",
    "jewellery": "jewelry",
    "travelled": "traveled",
    "travelling": "traveling",
    "traveller": "traveler",
    "cancelled": "canceled",
    "cancelling": "canceling",
    "labelled": "labeled",
    "modelling": "modeling",
    "fulfil": "fulfill",
    "enrol": "enroll",
    "enrolled": "enrolled",
    "defence": "defense",
    "offence": "offense",
    "archaeology": "archeology",
    "archaeologist": "archeologist",
    "aluminium": "aluminum",
    "towards": "toward",
    "amongst": "among",
    "whilst": "while",
    "okay": "ok",
    "fertiliser": "fertilizer",
    "fertilisers": "fertilizers",
    "prioritise": "prioritize",
    "prioritised": "prioritized",
    "criticise": "criticize",
    "criticised": "criticized",
    "publicise": "publicize",
    "publicised": "publicized",
    "characterise": "characterize",
    "synthesise": "synthesize",
    "utilised": "utilized",
    "normalise": "normalize",
    "customise": "customize",
    "visualise": "visualize",
    "memorise": "memorize",
    "marvellous": "marvelous",
    "pyjamas": "pajamas",
    "storey": "story",
    "storeys": "stories",
    "per cent": "percent",
}

CONTRACTIONS = {
    "i'm": ["i", "am"],
    "you're": ["you", "are"],
    "we're": ["we", "are"],
    "they're": ["they", "are"],
    "he's": ["he", "is"],
    "she's": ["she", "is"],
    "it's": ["it", "is"],
    "that's": ["that", "is"],
    "there's": ["there", "is"],
    "here's": ["here", "is"],
    "what's": ["what", "is"],
    "who's": ["who", "is"],
    "where's": ["where", "is"],
    "when's": ["when", "is"],
    "how's": ["how", "is"],
    "let's": ["let", "us"],
    "i've": ["i", "have"],
    "you've": ["you", "have"],
    "we've": ["we", "have"],
    "they've": ["they", "have"],
    "would've": ["would", "have"],
    "could've": ["could", "have"],
    "should've": ["should", "have"],
    "i'll": ["i", "will"],
    "you'll": ["you", "will"],
    "he'll": ["he", "will"],
    "she'll": ["she", "will"],
    "we'll": ["we", "will"],
    "they'll": ["they", "will"],
    "it'll": ["it", "will"],
    "that'll": ["that", "will"],
    "i'd": ["i", "would"],
    "you'd": ["you", "would"],
    "he'd": ["he", "would"],
    "she'd": ["she", "would"],
    "we'd": ["we", "would"],
    "they'd": ["they", "would"],
    "don't": ["do", "not"],
    "doesn't": ["does", "not"],
    "didn't": ["did", "not"],
    "can't": ["can", "not"],
    "cannot": ["can", "not"],
    "couldn't": ["could", "not"],
    "won't": ["will", "not"],
    "wouldn't": ["would", "not"],
    "shouldn't": ["should", "not"],
    "isn't": ["is", "not"],
    "aren't": ["are", "not"],
    "wasn't": ["was", "not"],
    "weren't": ["were", "not"],
    "haven't": ["have", "not"],
    "hasn't": ["has", "not"],
    "hadn't": ["had", "not"],
    "mustn't": ["must", "not"],
    "needn't": ["need", "not"],
}

ONES_WORDS = {
    0: "zero", 1: "one", 2: "two", 3: "three", 4: "four",
    5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
    10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen",
    15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen",
}
TENS_WORDS = {
    20: "twenty", 30: "thirty", 40: "forty", 50: "fifty",
    60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety",
}
ORDINAL_WORDS = {
    "1st": ["first"], "2nd": ["second"], "3rd": ["third"], "4th": ["fourth"],
    "5th": ["fifth"], "6th": ["sixth"], "7th": ["seventh"], "8th": ["eighth"],
    "9th": ["ninth"], "10th": ["tenth"], "11th": ["eleventh"], "12th": ["twelfth"],
    "13th": ["thirteenth"], "14th": ["fourteenth"], "15th": ["fifteenth"],
    "16th": ["sixteenth"], "17th": ["seventeenth"], "18th": ["eighteenth"],
    "19th": ["nineteenth"], "20th": ["twentieth"],
    "21st": ["twenty", "first"], "22nd": ["twenty", "second"], "23rd": ["twenty", "third"],
    "24th": ["twenty", "fourth"], "25th": ["twenty", "fifth"], "26th": ["twenty", "sixth"],
    "27th": ["twenty", "seventh"], "28th": ["twenty", "eighth"], "29th": ["twenty", "ninth"],
    "30th": ["thirtieth"], "31st": ["thirty", "first"],
}


def strip_accents(s: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch)
    )


def int_to_words_under_100(n: int) -> list[str]:
    if n < 20:
        return [ONES_WORDS[n]]
    tens = (n // 10) * 10
    rem = n % 10
    return [TENS_WORDS[tens]] if rem == 0 else [TENS_WORDS[tens], ONES_WORDS[rem]]


def expand_surface_to_norm_tokens(surface: str) -> list[str]:
    """Normalize a single surface word into 1+ lowercase matching tokens (symmetric on T and W)."""
    s = strip_accents(surface.strip())
    if not s:
        return []
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.lower().strip(".,?!;:()[]{}\"'`—–/\\*#@~")
    if not s:
        return []

    out: list[str] = []

    def emit_piece(p: str):
        p = p.strip(".,?!;:()[]{}\"'`")
        if not p:
            return
        if p == "&":
            out.append("and")
            return
        # Currency / percent wrappers
        prefix_toks: list[str] = []
        suffix_toks: list[str] = []
        if p.startswith("£") and len(p) > 1:
            p = p[1:]
            suffix_toks.append("pounds")
        elif p.startswith("$") and len(p) > 1:
            p = p[1:]
            suffix_toks.append("dollars")
        if p.endswith("%") and len(p) > 1:
            p = p[:-1]
            suffix_toks.append("percent")

        # Contractions
        if p in CONTRACTIONS:
            out.extend(CONTRACTIONS[p])
            out.extend(suffix_toks)
            return

        # Ordinals 1st..31st
        if p in ORDINAL_WORDS:
            out.extend(ORDINAL_WORDS[p])
            out.extend(suffix_toks)
            return

        # Hyphens or slashes inside piece (e.g. twenty-five, Q-U-I-G-L-E-Y, 9:30)
        if re.search(r"[-/]", p):
            for sub in re.split(r"[-/]+", p):
                emit_piece(sub)
            out.extend(suffix_toks)
            return

        # Dotted time or decimals (e.g. 9.30, 4.50, a.m., p.m.)
        clean_dots = p.replace(".", "")
        if clean_dots in ("am", "pm"):
            out.append(clean_dots)
            out.extend(suffix_toks)
            return
        if re.fullmatch(r"\d+(?:[.,:]\d+)+", p):
            for part in re.split(r"[.,:]", p):
                if part.isdigit():
                    val = int(part)
                    if 0 <= val < 100 and len(part) <= 2:
                        out.extend(int_to_words_under_100(val))
                    else:
                        out.append(part)
            out.extend(suffix_toks)
            return

        # Possessive 's -> drop apostrophe s
        if p.endswith("'s") and len(p) > 2:
            p = p[:-2]
            suffix_toks.append("s")

        p = p.replace("'", "")
        if not p:
            return

        # Pure integer
        p_nocomma = p.replace(",", "")
        if p_nocomma.isdigit():
            val = int(p_nocomma)
            if 0 <= val < 100:
                out.extend(int_to_words_under_100(val))
            else:
                out.append(p_nocomma)
            out.extend(suffix_toks)
            return

        # UK -> US equivalence
        if p in UK_US_MAP:
            mapped = UK_US_MAP[p]
            out.extend(mapped.split())
        else:
            out.append(p)
        out.extend(suffix_toks)

    emit_piece(s)
    return out


# ---------------------------------------------------------------------------
# Stage 1: Whisper Runner & DTW Acoustic Word Extractor
# ---------------------------------------------------------------------------

def run_whisper_for_test(
    test_id: str,
    mp3_path: Path,
    mode_name: str,
    out_json_path: Path,
    force: bool = False,
) -> tuple[Path, float]:
    """Convert MP3 to temp 16 kHz mono WAV and run whisper-cli.exe if not already cached."""
    if out_json_path.exists() and not force:
        try:
            cached = json.loads(out_json_path.read_text(encoding="utf-8"))
            if cached.get("transcription"):
                return out_json_path, 0.0
        except Exception:
            pass

    cfg = MODEL_CONFIGS[mode_name]
    model_path = MODELS_DIR / cfg["model"]
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp_wav = CACHE_DIR / f"{test_id}.tmp.wav"
    out_prefix = out_json_path.with_suffix("")

    ff = subprocess.run(
        [
            str(FFMPEG_BIN), "-y", "-i", str(mp3_path),
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(tmp_wav),
        ],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if ff.returncode != 0 or not tmp_wav.exists():
        raise RuntimeError(f"ffmpeg WAV conversion failed for {test_id}: {ff.stderr[-400:]}")

    cmd = [
        str(TOOLS_BIN),
        "-m", str(model_path),
        "-f", str(tmp_wav),
        "-l", "en",
        "-t", "6",
        "-bo", "1",
        "-bs", "1",
        "-nfa",
        "-dtw", cfg["dtw"],
        "-ojf",
        "-of", str(out_prefix),
        "-np",
    ]
    if cfg["vad"]:
        cmd.extend(["--vad", "-vm", str(MODELS_DIR / VAD_MODEL)])

    t0 = time.time()
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    finally:
        tmp_wav.unlink(missing_ok=True)

    elapsed = round(time.time() - t0, 2)
    if res.returncode != 0 or not out_json_path.exists():
        raise RuntimeError(
            f"whisper-cli failed for {test_id} ({mode_name}): rc={res.returncode} {res.stderr[-500:]}"
        )
    return out_json_path, elapsed


def extract_whisper_words(json_path: Path) -> tuple[list[dict], float]:
    """
    Parse whisper-cli -ojf -dtw JSON into normalized monotonic acoustic word tokens.
    Returns (words_list, dtw_valid_ratio).
    """
    raw_data = json.loads(json_path.read_text(encoding="utf-8"))
    segs = raw_data.get("transcription", [])

    surface_words: list[dict[str, Any]] = []
    cur_raw = ""
    cur_start: float | None = None
    cur_seg_to: float = 0.0
    non_spec_count = 0
    dtw_valid_count = 0

    def flush_word(end_hint: float | None = None):
        nonlocal cur_raw, cur_start
        txt = cur_raw.strip()
        if txt and cur_start is not None:
            # Skip inline stage directions like [silence] / (music)
            if not re.fullmatch(r"[\[\(].*[\]\)]", txt):
                surface_words.append(
                    {
                        "raw": txt,
                        "start": cur_start,
                        "end_hint": end_hint,
                        "seg_to": cur_seg_to,
                    }
                )
        cur_raw = ""
        cur_start = None

    for seg in segs:
        seg_text = (seg.get("text") or "").strip()
        if re.fullmatch(r"(?:\[[^\]]+\]|\([^)]+\))", seg_text):
            # Pure non-speech stage direction segment (e.g. "[silence]", "[BLANK_AUDIO]")
            flush_word()
            continue

        seg_to = seg.get("offsets", {}).get("to", 0) / 1000.0
        cur_seg_to = max(cur_seg_to, seg_to)
        in_stage_dir = False

        for tk in seg.get("tokens", []):
            tk_id = tk.get("id", -1)
            tk_txt = tk.get("text", "")
            if tk_id >= 50257 or not tk_txt or tk_txt.startswith("[_"):
                continue

            non_spec_count += 1
            t_dtw = tk.get("t_dtw", -1)
            if t_dtw is not None and t_dtw >= 0:
                dtw_valid_count += 1
                t_sec = t_dtw * 0.01
            else:
                t_sec = tk.get("offsets", {}).get("from", 0) / 1000.0

            stripped = tk_txt.strip()
            if not stripped:
                continue

            if stripped.startswith("[") or stripped.startswith("("):
                flush_word()
                in_stage_dir = not (stripped.endswith("]") or stripped.endswith(")"))
                continue
            if in_stage_dir:
                if stripped.endswith("]") or stripped.endswith(")"):
                    in_stage_dir = False
                continue

            # Pure punctuation token
            if re.fullmatch(r"[^\w£$€%]+", stripped):
                if cur_raw and 0.02 <= t_sec - (cur_start or 0) <= 1.5:
                    flush_word(end_hint=t_sec)
                else:
                    flush_word()
                continue

            starts_new = tk_txt[0].isspace() or not cur_raw
            if starts_new:
                flush_word()
                cur_raw = stripped
                cur_start = t_sec
            else:
                cur_raw += stripped

        flush_word()

    # Smooth monotonic timestamps & set crisp word ends
    last_t = 0.0
    for i, w in enumerate(surface_words):
        st = max(last_t, float(w["start"]))
        next_st = None
        if i + 1 < len(surface_words):
            next_cand = float(surface_words[i + 1]["start"])
            if next_cand >= st:
                next_st = next_cand

        hint = w["end_hint"]
        if hint is not None and 0.05 <= hint - st <= 1.5:
            en = hint
        elif next_st is not None and next_st - st <= 1.2:
            en = max(st + 0.06, next_st)
        else:
            est_dur = min(0.85, max(0.22, 0.065 * len(w["raw"])))
            en = min(max(w["seg_to"], st + 0.22), st + est_dur)

        if next_st is not None and next_st > st + 0.04 and en > next_st:
            en = next_st
        en = max(st + 0.04, en)
        w["start"] = round(st, 3)
        w["end"] = round(en, 3)
        last_t = st

    # Expand surface words to normalized tokens
    norm_words: list[dict[str, Any]] = []
    for w in surface_words:
        norms = expand_surface_to_norm_tokens(w["raw"])
        if not norms:
            continue
        dur = w["end"] - w["start"]
        n = len(norms)
        for idx, nt in enumerate(norms):
            s_t = w["start"] + (idx / n) * dur
            e_t = w["start"] + ((idx + 1) / n) * dur
            norm_words.append(
                {
                    "surface": w["raw"],
                    "norm": nt,
                    "start": round(s_t, 3),
                    "end": round(max(s_t + 0.02, e_t), 3),
                }
            )

    dtw_ratio = (dtw_valid_count / non_spec_count) if non_spec_count else 0.0
    return norm_words, round(dtw_ratio, 4)


# ---------------------------------------------------------------------------
# Stage 2: Official Transcript Cleaner & Abbreviation-Safe Sentence Splitter
# ---------------------------------------------------------------------------

ABBREV_PAT = re.compile(
    r"\b(Mr|Mrs|Ms|Dr|Prof|St|No|Rev|Gen|Col|Capt|Lt|Sgt|vs|etc|eg|ie|e\.g|i\.e|p\.m|a\.m|Ltd|Inc|Co|Vol|Fig|Approx|Jan|Feb|Mar|Apr|Aug|Sept|Sep|Oct|Nov|Dec)\.",
    re.IGNORECASE,
)

ADMIN_BOILERPLATE_PATTERNS = [
    r"^(?:narrator\b[:\s-]*)?ielts listening,?\s*version\b",
    r"^version\s+\d+\b",
    r"^you will hear a number of different recordings\b",
    r"^there will be time for you to read the instructions\b",
    r"^for you to read the instructions and questions\b",
    r"^all the recordings will be played once only\b",
    r"^the test is in (four|4) (sections|parts)\b",
    r"^write all your answers in the (listening )?question booklet\b",
    r"^at the end of the test,?\s*you will be given\b",
    r"^in the ielts test,?\s*you (would|will) now have\b",
    r"^you now have (ten|10) minutes to transfer\b",
    r"^that is the end of the listening test\b",
    r"^please stop writing and wait for your question booklet\b",
    r"^you will see that there is an example\b",
    r"^on this occasion only,?\s*the conversation relating\b",
    r"^in (?:part|section)\s*(?:1|2|3|4|one|two|three|four),?\s*you will hear\b",
    r"^(?:narrator\b[:\s-]*)?now turn to (section|part)\s*(1|2|3|4|one|two|three|four)\b",
    r"^(?:narrator\b[:\s-]*)?(section|part)\s*(1|2|3|4|one|two|three|four)\b[.:\s–-]*(?:first|now|you will hear|$)",
    r"^(?:narrator\b[:\s-]*)?first,?\s*you have some time to look at questions\b",
    r"^(?:narrator\b[:\s-]*)?you have (some time|thirty seconds|half a minute) to look at questions\b",
    r"^(?:narrator\b[:\s-]*)?now,?\s*listen\b.*?\bquestions?\b",
    r"^(?:narrator\b[:\s-]*)?listen carefully and answer questions\b",
    r"^(?:narrator\b[:\s-]*)?before you hear the rest of\b",
    r"^(?:narrator\b[:\s-]*)?that is the end of (section|part)\s*(1|2|3|4|one|two|three|four)\b",
    r"^(?:narrator\b[:\s-]*)?you (?:will )?now have (half a minute|thirty seconds|30 seconds|one minute|a minute|1 minute) to check\b",
]
ADMIN_BOILERPLATE_RE = re.compile("|".join(ADMIN_BOILERPLATE_PATTERNS), re.IGNORECASE)
PART_FRAMING_RE = re.compile(
    r"^(?:narrator\b[:\s-]*)?(?:(?:part|section)\s*(?:1|2|3|4|one|two|three|four)[.:\s–-]*)?you will hear\s+(?:a|an|two|three|some|the|part of)\b",
    re.IGNORECASE,
)


def split_sentences_safe(text: str) -> list[str]:
    """Split text into sentences without breaking on abbreviations, decimals, or ellipses."""
    s = re.sub(r"\s+", " ", text).strip()
    if not s:
        return []

    DOT = "\uE000"
    # Protect ellipses, decimals, times like 9.30, and abbreviations
    s = s.replace("...", f"{DOT}{DOT}{DOT}")
    s = re.sub(r"(\d)\.(\d)", rf"\1{DOT}\2", s)
    s = re.sub(r"\b([aApP])\.(m)\.", rf"\1{DOT}\2{DOT}", s)
    s = re.sub(r"\b([eEiI])\.([gG]|[eE])\.", rf"\1{DOT}\2{DOT}", s)
    s = ABBREV_PAT.sub(lambda m: m.group(1) + DOT, s)
    # Protect U.S. / U.K.
    s = re.sub(r"\b([A-Z])\.([A-Z])\.", rf"\1{DOT}\2{DOT}", s)
    # Split cleanly after ellipsis before IELTS admin endings (e.g. "boats... That is the end of Part 4.")
    s = re.sub(
        r"(?:\uE000{3}|…)\s+(?=(?:That is the end|Now turn to|You now have|You will now have|Part\s+\d|Section\s+\d)\b)",
        ". ",
        s,
        flags=re.IGNORECASE,
    )

    raw_parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'\[Q])", s)
    out: list[str] = []
    for p in raw_parts:
        restored = p.replace(DOT, ".").strip()
        # Strip stray leading list numbering like "1. You will hear..." or standalone "1."
        restored = re.sub(r"^\d{1,2}\.(?:\s+|$)", "", restored).strip()
        # Separate inline "Part N You will hear..." or "Section N You will hear..."
        m_part_lead = re.match(
            r"^(?:part|section)\s*(?:1|2|3|4|one|two|three|four)\b[.:\s–-]*(You will hear\b.*)$",
            restored,
            re.IGNORECASE,
        )
        if m_part_lead:
            restored = m_part_lead.group(1).strip()
        if restored:
            out.append(restored)
    return out


def extract_official_sentences(spec: dict) -> tuple[list[dict[str, Any]], dict[int, str]]:
    """
    Parse official transcript from F:\\IELTS\\Vol into clean sentences with Part 1-4 & Q-tags.
    Returns (sentences_list, part_topics).
    """
    if spec["transcript_kind"] == "docx":
        lines = prep.read_docx_paragraphs(spec["transcript_src"])
    else:
        lines = [
            l.strip()
            for l in prep.read_pdf_text(spec["transcript_src"]).splitlines()
            if l.strip()
        ]

    start_idx = 0
    cau40_idx = None
    for idx in range(len(lines) - 1, -1, -1):
        if re.match(r"^Câ[uư]\s*số\s*40\b", lines[idx], re.IGNORECASE):
            cau40_idx = idx
            break

    if cau40_idx is not None:
        j = cau40_idx + 1
        while j < len(lines) and lines[j].strip() in ("", "..."):
            j += 1
        if j < len(lines):
            j += 1
        while j < len(lines) and (
            lines[j].strip() in ("", "...")
            or re.search(r"\bTRANSCRIPT\b", lines[j], re.IGNORECASE)
        ):
            j += 1
        start_idx = min(len(lines), j)
    else:
        for idx, l in enumerate(lines):
            if re.search(r"\bTRANSCRIPT\b", l, re.IGNORECASE) and idx > 5:
                start_idx = idx + 1
                break
            if prep.TS_RE.search(l):
                start_idx = max(0, idx - 1)
                break

    tr_lines = lines[start_idx:]

    part_header_re = re.compile(
        r"^(?:part|section)\s*(1|2|3|4|one|two|three|four)\b(?:\s*([.:–-]+)\s*(.*)|\s+(You will hear.*)|\s*$)",
        re.IGNORECASE,
    )

    cur_part = 1
    seen_parts = {1}
    part_topics: dict[int, str] = {}
    chunks: list[tuple[int, str]] = []  # (part, raw_paragraph_with_qtags)

    for raw_line in tr_lines:
        s = raw_line.strip()
        if not s or s == "...":
            continue
        if re.match(
            r"^(?:transcrip|transcript|test\s+\d+:?|read the text and answer questions.*|\d{1,2}:\d{2})$",
            s,
            re.IGNORECASE,
        ):
            continue

        # Fix fused typo discovered in Vol 8 Test 3
        s = re.sub(
            r"\.\s+to transfer your answers to the listening answer sheet\.?",
            ". You now have 10 minutes to transfer your answers to the listening answer sheet.",
            s,
            flags=re.IGNORECASE,
        )

        # Remove (mm:ss - mm:ss) markers everywhere in line BEFORE Part header check
        cleaned = prep.TS_RE.sub(" ", s)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if not cleaned:
            continue

        pm = part_header_re.match(cleaned)
        if pm:
            pnum = prep.parse_part_num(pm.group(1))
            sep = pm.group(2)
            rest = (pm.group(3) or pm.group(4) or "").strip()
            if pnum in (cur_part, cur_part + 1) and (sep is not None or not rest or pm.group(4)):
                cur_part = pnum
                seen_parts.add(pnum)
                if not rest:
                    continue
                cleaned = rest

        # Topic hint
        if cur_part not in part_topics and "you will hear" in cleaned.lower():
            m_topic = re.search(r"(You will hear[^.!?]+[.!?])", cleaned, re.IGNORECASE)
            if m_topic:
                part_topics[cur_part] = m_topic.group(1)[:180]

        # Join wrapped mid-sentence lines (e.g. Vol 7 Test 11 PDF line wraps) cleanly
        if (
            chunks
            and chunks[-1][0] == cur_part
            and not re.search(r'[.!?…"”\'\)]$', chunks[-1][1])
            and not ADMIN_BOILERPLATE_RE.match(cleaned)
        ):
            chunks[-1] = (cur_part, f"{chunks[-1][1]} {cleaned}".strip())
        else:
            chunks.append((cur_part, cleaned))

    sentences: list[dict[str, Any]] = []
    content_pos_in_part: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}

    for part_num, chunk_txt in chunks:
        for raw_sent in split_sentences_safe(chunk_txt):
            q_tags = [int(x) for x in re.findall(r"\bQ(\d{1,2})\b", raw_sent)]
            clean_sent = re.sub(r"\bQ\d{1,2}\b\s*", "", raw_sent).strip()
            clean_sent = re.sub(r"^\d{1,2}\.\s+", "", clean_sent).strip()
            # Collapse weird standalone section-number prefix left inside sentence
            clean_sent = re.sub(r"\s+", " ", clean_sent).strip()
            if not clean_sent:
                continue

            is_admin = bool(ADMIN_BOILERPLATE_RE.match(clean_sent))
            if not is_admin:
                content_pos_in_part[part_num] += 1
                if content_pos_in_part[part_num] <= 2 and PART_FRAMING_RE.match(clean_sent):
                    is_admin = True
            if q_tags:
                is_admin = False

            sentences.append(
                {
                    "part": part_num,
                    "text": clean_sent,
                    "qTags": q_tags,
                    "isAdmin": is_admin,
                }
            )

    return sentences, part_topics


# ---------------------------------------------------------------------------
# Stage 3: Hybrid Trigram LIS Anchors + Banded Needleman-Wunsch Alignment
# ---------------------------------------------------------------------------

def sim_score(a: str, b: str) -> float:
    if a == b:
        return 3.0
    if len(a) >= 4 and len(b) >= 4:
        if a[:4] == b[:4]:
            return 1.6
        if abs(len(a) - len(b)) <= 1:
            # Quick edit distance <= 1 check
            if len(a) == len(b):
                diffs = sum(1 for x, y in zip(a, b) if x != y)
                if diffs == 1:
                    return 1.6
            else:
                longer, shorter = (a, b) if len(a) > len(b) else (b, a)
                i = j = diffs = 0
                while i < len(longer) and j < len(shorter):
                    if longer[i] == shorter[j]:
                        i += 1
                        j += 1
                    else:
                        diffs += 1
                        i += 1
                        if diffs > 1:
                            break
                if diffs <= 1:
                    return 1.6
    return -1.5


def lis_pairs(pairs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Standard O(K log K) Longest Increasing Subsequence on w_idx for sorted t_idx pairs."""
    if not pairs:
        return []
    pairs_sorted = sorted(pairs, key=lambda x: (x[0], x[1]))
    tails: list[int] = []
    tail_indices: list[int] = []
    prev = [-1] * len(pairs_sorted)

    for idx, (_, wi) in enumerate(pairs_sorted):
        pos = bisect.bisect_left(tails, wi)
        if pos == len(tails):
            tails.append(wi)
            tail_indices.append(idx)
        else:
            tails[pos] = wi
            tail_indices[pos] = idx
        if pos > 0:
            prev[idx] = tail_indices[pos - 1]

    res: list[tuple[int, int]] = []
    k = tail_indices[-1]
    while k != -1:
        res.append(pairs_sorted[k])
        k = prev[k]
    res.reverse()
    return res


def find_unique_ngram_anchors(
    t_norms: list[str],
    w_norms: list[str],
    t_off: int,
    t_end: int,
    w_off: int,
    w_end: int,
    n: int,
) -> list[tuple[int, int]]:
    if t_end - t_off < n or w_end - w_off < n:
        return []
    t_map: dict[tuple[str, ...], int] = {}
    for i in range(t_off, t_end - n + 1):
        gram = tuple(t_norms[i : i + n])
        t_map[gram] = -2 if gram in t_map else i

    w_map: dict[tuple[str, ...], int] = {}
    for j in range(w_off, w_end - n + 1):
        gram = tuple(w_norms[j : j + n])
        w_map[gram] = -2 if gram in w_map else j

    raw_pairs: list[tuple[int, int]] = []
    for gram, ti in t_map.items():
        if ti < 0:
            continue
        wi = w_map.get(gram, -2)
        if wi >= 0:
            raw_pairs.append((ti, wi))

    chained = lis_pairs(raw_pairs)
    anchors: list[tuple[int, int]] = []
    last_t, last_w = -1, -1
    for ti, wi in chained:
        for k in range(n):
            if ti + k > last_t and wi + k > last_w:
                anchors.append((ti + k, wi + k))
                last_t = ti + k
                last_w = wi + k
    return anchors


def banded_nw_align(
    t_norms: list[str],
    w_norms: list[str],
    t0: int,
    t1: int,
    w0: int,
    w1: int,
) -> list[tuple[int, int]]:
    """Banded Needleman-Wunsch DP alignment on T[t0:t1] vs W[w0:w1]. Returns matched (ti, wi)."""
    m = t1 - t0
    n = w1 - w0
    if m <= 0 or n <= 0:
        return []

    GAP = -1.0
    if max(m, n) <= 180:
        band = max(m, n) + 5
    else:
        band = max(90, abs(m - n) + 60)

    NEG_INF = -1e12
    # Store traceback cleanly with dicts per row if banded, or compact lists when bounded
    ratio = n / m
    dp_rows: list[dict[int, float]] = [{} for _ in range(m + 1)]
    bt_rows: list[dict[int, int]] = [{} for _ in range(m + 1)]  # 0=diag, 1=up(skip T), 2=left(skip W)

    dp_rows[0][0] = 0.0
    max_j0 = min(n, band)
    for j in range(1, max_j0 + 1):
        dp_rows[0][j] = j * GAP
        bt_rows[0][j] = 2

    for i in range(1, m + 1):
        center = int(round(i * ratio))
        j_lo = max(0, center - band)
        j_hi = min(n, center + band)
        prev_dp = dp_rows[i - 1]
        cur_dp = dp_rows[i]
        cur_bt = bt_rows[i]
        ti_val = t_norms[t0 + i - 1]

        for j in range(j_lo, j_hi + 1):
            best = NEG_INF
            best_op = 1

            # Up (gap in W)
            up_score = prev_dp.get(j, NEG_INF) + GAP
            if up_score > best:
                best = up_score
                best_op = 1

            # Left (gap in T)
            if j > j_lo:
                left_score = cur_dp.get(j - 1, NEG_INF) + GAP
                if left_score > best:
                    best = left_score
                    best_op = 2

            # Diag
            if j > 0 and (j - 1) in prev_dp:
                sc = sim_score(ti_val, w_norms[w0 + j - 1])
                diag_score = prev_dp[j - 1] + sc
                if diag_score >= best:
                    best = diag_score
                    best_op = 0

            cur_dp[j] = best
            cur_bt[j] = best_op

    # Fallback if endpoint out of band
    if n not in dp_rows[m]:
        return []

    matched: list[tuple[int, int]] = []
    i, j = m, n
    while i > 0 or j > 0:
        op = bt_rows[i].get(j, 1 if i > 0 else 2)
        if op == 0:
            ti = t0 + i - 1
            wi = w0 + j - 1
            if sim_score(t_norms[ti], w_norms[wi]) > 0:
                matched.append((ti, wi))
            i -= 1
            j -= 1
        elif op == 1:
            i -= 1
        else:
            j -= 1
    matched.reverse()
    return matched


def align_transcript_to_whisper(
    sentences: list[dict[str, Any]],
    whisper_words: list[dict[str, Any]],
    audio_duration: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Build normalized word stream across ALL sentences, align to whisper_words using
    Unique Trigram/Bigram LIS Anchors + Banded NW DP, and assign exact [startTime, endTime].
    """
    t_tokens: list[dict[str, Any]] = []
    sent_token_ranges: list[tuple[int, int]] = []

    for s_idx, sent in enumerate(sentences):
        toks_start = len(t_tokens)
        surf_words = sent["text"].split()
        raw_offsets: list[tuple[int, int, str]] = []
        pos = 0
        for w in surf_words:
            idx = sent["text"].find(w, pos)
            raw_offsets.append((idx, idx + len(w), w))
            pos = idx + len(w)

        for char_s, char_e, w in raw_offsets:
            norms = expand_surface_to_norm_tokens(w)
            for nt in norms:
                t_tokens.append(
                    {
                        "norm": nt,
                        "sentIdx": s_idx,
                        "charStart": char_s,
                        "charEnd": char_e,
                    }
                )
        sent_token_ranges.append((toks_start, len(t_tokens)))

    t_norms = [t["norm"] for t in t_tokens]
    w_norms = [w["norm"] for w in whisper_words]
    T_len = len(t_norms)
    W_len = len(w_norms)

    if T_len == 0 or W_len == 0:
        raise RuntimeError("Empty transcript or Whisper token stream")

    # 1. Global Unique Trigram LIS Anchors
    anchors = find_unique_ngram_anchors(t_norms, w_norms, 0, T_len, 0, W_len, 3)

    # 2. Subdivide gaps > 40 words with local Unique Bigram Anchors
    refined_anchors: list[tuple[int, int]] = []
    prev_t, prev_w = -1, -1
    for at, aw in anchors + [(T_len, W_len)]:
        if at - prev_t > 40 and aw - prev_w > 40:
            sub = find_unique_ngram_anchors(t_norms, w_norms, prev_t + 1, at, prev_w + 1, aw, 2)
            for st_idx, sw_idx in sub:
                if st_idx > prev_t and sw_idx > prev_w and st_idx < at and sw_idx < aw:
                    refined_anchors.append((st_idx, sw_idx))
                    prev_t, prev_w = st_idx, sw_idx
        if at < T_len:
            refined_anchors.append((at, aw))
        prev_t, prev_w = at, aw

    # 3. Banded NW inside every gap
    t_to_w: list[int | None] = [None] * T_len
    prev_t, prev_w = 0, 0
    for at, aw in refined_anchors + [(T_len, W_len)]:
        if at > prev_t and aw > prev_w:
            gap_matches = banded_nw_align(t_norms, w_norms, prev_t, at, prev_w, aw)
            for mt, mw in gap_matches:
                t_to_w[mt] = mw
        if at < T_len:
            t_to_w[at] = aw
        prev_t = at + 1
        prev_w = aw + 1

    # Enforce strict monotonic timestamps across matched tokens
    t_start: list[float | None] = [None] * T_len
    t_end: list[float | None] = [None] * T_len
    is_direct: list[bool] = [False] * T_len
    last_t = 0.0
    for i, wi in enumerate(t_to_w):
        if wi is not None:
            st = max(last_t, whisper_words[wi]["start"])
            en = max(st + 0.04, whisper_words[wi]["end"])
            t_start[i] = st
            t_end[i] = en
            is_direct[i] = True
            last_t = st

    # Identify per-sentence match rate first (to detect written-only unaligned rubrics)
    sent_matched = []
    for s_idx, (a, b) in enumerate(sent_token_ranges):
        cnt = b - a
        hits = sum(1 for k in range(a, b) if is_direct[k])
        ratio = hits / cnt if cnt else 0.0
        spoken = (hits >= 1 and ratio >= 0.25) if cnt >= 3 else (hits >= 1)
        sent_matched.append((hits, cnt, ratio, spoken))

    # Interpolate unaligned spans cleanly WITHOUT stretching across >4.5s silences
    idx = 0
    while idx < T_len:
        if t_start[idx] is not None:
            idx += 1
            continue
        run_start = idx
        while idx < T_len and t_start[idx] is None:
            idx += 1
        run_end = idx  # exclusive
        k = run_end - run_start

        left_end = t_end[run_start - 1] if run_start > 0 else None
        right_start = t_start[run_end] if run_end < T_len else None

        if left_end is not None and right_start is not None:
            gap = max(0.05, right_start - left_end)
            if gap <= max(4.5, k * 0.75):
                # Short contiguous phrase (e.g. proper noun or spelled name) -> interpolate smoothly
                step = gap / k
                for u in range(k):
                    t_start[run_start + u] = round(left_end + u * step, 3)
                    t_end[run_start + u] = round(left_end + (u + 1) * step, 3)
            else:
                # Silence gap! Attach tokens sharing left sentence forward, right sentence backward
                left_sent = t_tokens[run_start - 1]["sentIdx"]
                right_sent = t_tokens[run_end]["sentIdx"]
                left_u = 0
                right_tokens: list[int] = []
                for pos in range(run_start, run_end):
                    s_id = t_tokens[pos]["sentIdx"]
                    if s_id == left_sent:
                        st = min(right_start - 0.1, left_end + left_u * 0.30)
                        t_start[pos] = round(st, 3)
                        t_end[pos] = round(min(right_start - 0.05, st + 0.28), 3)
                        left_u += 1
                    elif s_id == right_sent:
                        right_tokens.append(pos)
                if right_tokens:
                    n_r = len(right_tokens)
                    for r_idx, pos in enumerate(right_tokens):
                        offset = (n_r - r_idx) * 0.30
                        st = max(left_end + 0.2, right_start - offset)
                        t_start[pos] = round(st, 3)
                        t_end[pos] = round(min(right_start, st + 0.28), 3)
        elif right_start is not None:
            for r_idx in range(k):
                pos = run_start + r_idx
                offset = (k - r_idx) * 0.32
                st = max(0.0, right_start - offset)
                t_start[pos] = round(st, 3)
                t_end[pos] = round(min(right_start, st + 0.30), 3)
        elif left_end is not None:
            for u in range(k):
                pos = run_start + u
                st = min(audio_duration - 0.1, left_end + u * 0.32)
                t_start[pos] = round(st, 3)
                t_end[pos] = round(min(audio_duration, st + 0.30), 3)

    # Assemble per-sentence objects with exact bounds + per-token timings
    aligned_sentences: list[dict[str, Any]] = []
    part_stats: dict[int, list[int]] = {1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 0]}

    for s_idx, sent in enumerate(sentences):
        a, b = sent_token_ranges[s_idx]
        hits, cnt, ratio, is_spoken = sent_matched[s_idx]
        part = sent["part"]
        part_stats[part][0] += hits
        part_stats[part][1] += cnt

        toks = [
            {
                "charStart": t_tokens[k]["charStart"],
                "charEnd": t_tokens[k]["charEnd"],
                "start": t_start[k],
                "end": t_end[k],
                "direct": is_direct[k],
            }
            for k in range(a, b)
            if t_start[k] is not None and t_end[k] is not None
        ]
        if not toks:
            continue
        aligned_sentences.append(
            {
                "part": part,
                "text": sent["text"],
                "qTags": sent["qTags"],
                "isAdmin": sent["isAdmin"],
                "isSpoken": is_spoken,
                "matchRatio": round(ratio, 3),
                "startTime": round(toks[0]["start"], 2),
                "endTime": round(max(toks[-1]["end"], toks[0]["start"] + 0.4), 2),
                "tokens": toks,
            }
        )

    total_hits = sum(v[0] for v in part_stats.values())
    total_cnt = sum(v[1] for v in part_stats.values())
    metrics = {
        "wordMatchRate": round(total_hits / total_cnt, 4) if total_cnt else 0.0,
        "matchedWords": total_hits,
        "totalWords": total_cnt,
        "perPartMatch": {
            str(p): round(v[0] / v[1], 4) if v[1] else 0.0 for p, v in part_stats.items()
        },
        "droppedNonSpoken": sum(1 for s in aligned_sentences if not s["isSpoken"]),
        "alignedSentences": len(aligned_sentences),
    }
    return aligned_sentences, metrics


# ---------------------------------------------------------------------------
# Stage 4: Clean Dictation Short/Long Builder & 40-Question Review Alignment
# ---------------------------------------------------------------------------

def split_on_silence_and_clauses(sent: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Split a spoken sentence at any >2.0s internal acoustic gap, and split long utterances
    (>12s or >160 chars & >9s) at natural clause boundaries near acoustic midpoint.
    """
    toks = sent["tokens"]
    txt = sent["text"]
    if len(toks) < 2:
        return [sent]

    # 1. Hard split on internal acoustic gap > 2.0s
    gap_splits = []
    start_k = 0
    for k in range(1, len(toks)):
        if toks[k]["start"] - toks[k - 1]["end"] > 2.0:
            gap_splits.append((start_k, k))
            start_k = k
    gap_splits.append((start_k, len(toks)))

    pieces: list[dict[str, Any]] = []
    for g_idx, (a, b) in enumerate(gap_splits):
        sub_toks = toks[a:b]
        c_start = sub_toks[0]["charStart"] if g_idx > 0 else 0
        c_end = sub_toks[-1]["charEnd"] if g_idx < len(gap_splits) - 1 else len(txt)
        sub_txt = txt[c_start:c_end].strip()
        if not sub_txt:
            continue
        remapped = [
            {
                "charStart": max(0, tk["charStart"] - c_start),
                "charEnd": max(0, tk["charEnd"] - c_start),
                "start": tk["start"],
                "end": tk["end"],
            }
            for tk in sub_toks
        ]
        pieces.append(
            {
                "part": sent["part"],
                "text": sub_txt,
                "qTags": sent["qTags"] if g_idx == 0 else [],
                "startTime": round(sub_toks[0]["start"], 2),
                "endTime": round(max(sub_toks[-1]["end"], sub_toks[0]["start"] + 0.4), 2),
                "tokens": remapped,
            }
        )

    # 2. Recursively split any piece that is still > 12s or (>160 chars & >9s)
    final: list[dict[str, Any]] = []

    def split_long_piece(piece: dict[str, Any]):
        dur = piece["endTime"] - piece["startTime"]
        ptxt = piece["text"]
        ptoks = piece["tokens"]
        if (dur <= 12.0 and not (len(ptxt) > 160 and dur > 9.0)) or len(ptoks) < 8:
            final.append(piece)
            return

        mid_t = (piece["startTime"] + piece["endTime"]) / 2.0
        n_t = len(ptoks)
        lo = max(3, int(n_t * 0.25))
        hi = min(n_t - 3, int(n_t * 0.75))
        best_k = None
        best_score = -1e9
        for k in range(lo, hi + 1):
            prev_end_c = ptoks[k - 1]["charEnd"]
            prev_word = ptxt[ptoks[k - 1]["charStart"] : min(len(ptxt), prev_end_c + 1)]
            next_start_c = ptoks[k]["charStart"]
            next_word = ptxt[next_start_c : ptoks[k]["charEnd"]].lower()
            pause = max(0.0, ptoks[k]["start"] - ptoks[k - 1]["end"])
            bonus = 0.0
            if prev_word.endswith((",", ";", ":", "—", "–")):
                bonus += 2.5
            elif next_word in ("and", "but", "so", "because", "which", "where", "when", "although", "while"):
                bonus += 1.4
            bonus += min(pause * 3.0, 4.0)
            dist_pen = abs(ptoks[k]["start"] - mid_t) / max(dur, 1.0)
            sc = bonus - dist_pen * 1.5
            if sc > best_score:
                best_score = sc
                best_k = k

        if best_k is None:
            final.append(piece)
            return

        split_char = ptoks[best_k]["charStart"]
        left_txt = ptxt[:split_char].strip()
        right_txt = ptxt[split_char:].strip()
        if len(left_txt) < 12 or len(right_txt) < 12:
            final.append(piece)
            return

        left_toks = ptoks[:best_k]
        right_toks = [
            {
                "charStart": max(0, tk["charStart"] - split_char),
                "charEnd": max(0, tk["charEnd"] - split_char),
                "start": tk["start"],
                "end": tk["end"],
            }
            for tk in ptoks[best_k:]
        ]
        split_long_piece(
            {
                "part": piece["part"],
                "text": left_txt,
                "qTags": piece["qTags"],
                "startTime": round(left_toks[0]["start"], 2),
                "endTime": round(max(left_toks[-1]["end"], left_toks[0]["start"] + 0.4), 2),
                "tokens": left_toks,
            }
        )
        split_long_piece(
            {
                "part": piece["part"],
                "text": right_txt,
                "qTags": [],
                "startTime": round(right_toks[0]["start"], 2),
                "endTime": round(max(right_toks[-1]["end"], right_toks[0]["start"] + 0.4), 2),
                "tokens": right_toks,
            }
        )

    for pc in pieces:
        split_long_piece(pc)
    return final


def extract_focused_question_prompts(exam_text: str) -> dict[int, dict]:
    """
    Extract isolated per-question stem snippets and option descriptions (local MCQ + Part box A-I)
    from exam PDF text without bleeding adjacent matching/table items into one another.
    """
    lines = [l.strip() for l in exam_text.splitlines() if l.strip()]
    part_lines: dict[int, list[str]] = {1: [], 2: [], 3: [], 4: []}
    cur_p = 1
    for l in lines:
        m = re.match(r"^(?:SECTION|PART)\s+([1-4])\b", l, re.IGNORECASE)
        if m:
            cur_p = int(m.group(1))
            continue
        part_lines[cur_p].append(l)

    prompts: dict[int, dict] = {}
    for p in range(1, 5):
        ptxt = "\n".join(part_lines[p])
        q_start, q_end = (p - 1) * 10 + 1, p * 10

        # 1. Shared option pool across Part (e.g. "A pure\nB expensive" or "Information A pure B expensive")
        part_options: dict[str, str] = {}
        for pline in part_lines[p]:
            m_line_opt = re.match(r"^([A-I])(?:[\.\):]\s+|\s+)([a-zA-Z].{1,80})$", pline)
            if m_line_opt:
                part_options[m_line_opt.group(1).upper()] = m_line_opt.group(2).strip()

        # 2. Locate exact anchor spans (start, end) of each question number in [q_start..q_end]
        q_anchors: dict[int, tuple[int, int]] = {}
        for q in range(q_start, q_end + 1):
            # Prefer standalone or Q-range match (e.g. "21-22", "11____", "21 What")
            pat = re.compile(
                rf"(?:^|(?<=[\s•\-]))({q}(?:\s*[-–]\s*{q+1})?)(?=[\s.…_A-Za-z]|$)"
            )
            chosen = None
            for m in pat.finditer(ptxt):
                before_win = ptxt[max(0, m.start() - 22) : m.start()].lower()
                if any(w in before_win for w in ("questions", "question", "section", "part", "page")):
                    continue
                after_win = ptxt[m.end() : min(len(ptxt), m.end() + 8)]
                # Skip "11-16", years/percentages like "11.30" or "20%"
                if re.match(r"^\s*[-–]\s*\d+", after_win):
                    # Accept only adjacent pair like 21-22
                    m_pair = re.match(rf"^{q}\s*[-–]\s*{q+1}$", m.group(1))
                    if not m_pair:
                        continue
                if re.match(r"^%|^\.\d", after_win):
                    continue
                chosen = (m.start(1), m.end(1))
                break
            if chosen:
                q_anchors[q] = chosen

        # Sort detected anchors monotonically to bound each question slice cleanly
        ordered_qs = sorted(q_anchors.items(), key=lambda kv: kv[1][0])
        pos_lookup = {q: span for q, span in ordered_qs}
        anchor_starts = [span[0] for _, span in ordered_qs]

        for q in range(q_start, q_end + 1):
            if q not in pos_lookup:
                prompts[q] = {"snippet": "", "stem": "", "options": dict(part_options)}
                continue

            q_s, q_e = pos_lookup[q]
            # Find adjacent detected anchors around q_s
            prev_e = 0
            next_s = len(ptxt)
            for oq, (os_pos, oe_pos) in ordered_qs:
                if oe_pos <= q_s and (oq != q - 1 or (os_pos, oe_pos) != (q_s, q_e)):
                    prev_e = oe_pos
                if os_pos > q_e and next_s == len(ptxt):
                    next_s = os_pos

            # Check if [q_s .. next_s] is an MCQ with local options A / B / C
            after_slice = ptxt[q_e:next_s]
            local_opts: dict[str, str] = {}
            for om in re.finditer(
                r"(?:^|\n|\s)([A-I])(?:[\.\):]|\s)\s*([^\n]{2,95}?)(?=\s*\n[A-I](?:[\.\):]|\s)|\s+[A-I][\.\):]\s|\s*$)",
                after_slice,
            ):
                lbl = om.group(1).upper()
                val = om.group(2).strip()
                if not re.fullmatch(r"[A-I]+", val):
                    local_opts[lbl] = val

            before_raw = ptxt[prev_e:q_s]
            # Trim past any blank markers (____ / ....) belonging to prev question!
            m_last_blank = None
            for mb in re.finditer(r"(?:_{2,}|…{2,}|\.{3,}|Information\b)", before_raw):
                m_last_blank = mb
            if m_last_blank:
                before_trimmed = before_raw[m_last_blank.end() :].strip()
            else:
                # If no blank marker (e.g. map list "11 seating area\n12 cushions"), keep at most 1 line if before q
                before_lines = [bl.strip() for bl in before_raw.splitlines() if bl.strip()]
                before_trimmed = before_lines[-1] if before_lines else ""

            if len(local_opts) >= 2:
                # MCQ question: stem+options live cleanly inside [q_e : next_s]
                stem_txt = re.sub(r"\s+", " ", after_slice).strip()
                snippet = stem_txt
            else:
                # Completion / Map / Matching item: combine pre-blank item label + post-number line before blank/next
                after_lines = after_slice.splitlines()
                after_head = after_lines[0] if after_lines else ""
                m_blank_after = re.search(r"_{2,}|…{2,}|\.{3,}", after_head)
                if m_blank_after and m_blank_after.start() <= 6:
                    # Inline blank right after Q number ("hand cream 11_____") -> stem is before_trimmed!
                    after_clean = ""
                else:
                    # Blank comes later in sentence ("11 seating area" or "transport was used...")
                    after_clean = re.sub(r"_{2,}|…{2,}|\.{3,}", " ", after_slice)
                    # Cut off if after_clean runs past newline into another standalone bullet label
                    if len(after_lines) > 1 and not re.search(r"^\s*[a-z]", after_lines[1]):
                        after_clean = after_lines[0]
                stem_txt = re.sub(r"\s+", " ", f"{before_trimmed} {after_clean}").strip()
                snippet = stem_txt[:260]

            merged_opts = {**part_options, **local_opts}
            prompts[q] = {
                "snippet": snippet,
                "stem": stem_txt[:260],
                "options": merged_opts,
            }
    return prompts


def build_paraphrase_lookup() -> dict[str, set[str]]:
    lut: dict[str, set[str]] = {}
    for base, syns in prep.PARAPHRASE_PAIRS:
        b = base.lower()
        all_forms = [b] + [s.lower() for s in syns]
        for term in all_forms:
            for w in re.findall(r"[a-z]{3,}", term):
                lut.setdefault(w, set()).update(all_forms)
    return lut


PARA_LUT = build_paraphrase_lookup()


def align_questions_dp_smart(
    vol: int,
    test_num: int,
    qkeys: dict[int, dict],
    short_segments: list[dict],
    prompts: dict[int, dict],
) -> list[dict]:
    """
    Monotonic DP question alignment per Part using isolated per-question stems,
    resolved A-I option texts + paraphrase expansions, and strict collision penalty
    between sequential non-shared questions.
    """
    questions_out: list[dict] = []
    num_words = {
        "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
        "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
        "12": "twelve", "15": "fifteen", "20": "twenty", "25": "twenty-five",
        "30": "thirty", "40": "forty", "50": "fifty", "60": "sixty",
        "65": "sixty-five", "80": "eighty",
    }

    for part_num in range(1, 5):
        q_start, q_end = (part_num - 1) * 10 + 1, part_num * 10
        segs = [s for s in short_segments if s["part"] == part_num] or short_segments
        n_q = 10
        n_s = len(segs)
        scores = [[0.0] * n_s for _ in range(n_q)]

        for qi in range(n_q):
            q_num = q_start + qi
            kinfo = qkeys[q_num]
            pinfo = prompts.get(q_num, {"snippet": "", "stem": "", "options": {}})
            stem_tokens = prep.tokenize(pinfo.get("stem", pinfo.get("snippet", "")))
            canon = kinfo["canonicalAnswer"]
            accepted = kinfo["acceptedAnswers"]

            # Gather answer literal clues + resolved A-I option text + paraphrases
            literal_clues: list[str] = []
            option_texts: list[str] = []
            for a in accepted:
                al = a.lower().strip()
                if len(al) >= 2 and not re.fullmatch(r"[a-i]", al):
                    literal_clues.append(al)
                    if al in num_words:
                        literal_clues.append(num_words[al])
                    m_date = re.match(r"^(\d{1,2}(?:st|nd|rd|th)?)\s+([a-z]+)$", al)
                    if m_date:
                        literal_clues.append(f"{m_date.group(1)} of {m_date.group(2)}")
                        literal_clues.append(f"{m_date.group(2)} {m_date.group(1)}")
                else:
                    up = a.upper().strip()
                    if up in pinfo.get("options", {}):
                        option_texts.append(pinfo["options"][up].lower())

            # Collect paraphrase phrases relevant to stem & chosen options
            para_phrases: set[str] = set()
            for tok in stem_tokens | prep.tokenize(" ".join(option_texts)):
                para_phrases.update(PARA_LUT.get(tok, set()))

            for si, seg in enumerate(segs):
                seg_l = seg["text"].lower()
                sc = 0.0

                # 1. Explicit Vol 7 T11 Q-tag
                if q_num in seg.get("qTags", []):
                    sc += 95.0

                # 2. Direct accepted answer match (completion/number/name)
                for clue in literal_clues:
                    if re.search(rf"(?<!\w){re.escape(clue)}(?!\w)", seg_l):
                        sc += 34.0
                    elif clue in seg_l:
                        sc += 20.0
                    else:
                        ctoks = prep.tokenize(clue)
                        if ctoks:
                            hits = sum(1 for w in ctoks if w in seg_l)
                            sc += (hits / len(ctoks)) * 18.0

                # 3. Resolved A-I option phrase match (for MCQ / matching / map)
                for opt_txt in option_texts:
                    otoks = prep.tokenize(opt_txt)
                    if otoks:
                        hits = sum(1 for w in otoks if re.search(rf"\b{re.escape(w[:4])}", seg_l))
                        sc += (hits / len(otoks)) * 24.0

                # 4. Isolated stem keyword match (hand cream, jam, soaps, Irene, Kim...)
                if stem_tokens:
                    stoks = prep.tokenize(seg_l)
                    hits = len(stem_tokens & stoks)
                    sc += min(hits * 9.0, 27.0)

                # 5. Verified paraphrase boost
                if para_phrases:
                    p_hits = sum(1 for ph in para_phrases if len(ph) >= 4 and ph in seg_l)
                    sc += min(p_hits * 4.0, 12.0)

                # 6. Gentle monotonic position prior
                expected_pos = (qi + 0.5) / n_q
                actual_pos = (si + 0.5) / max(n_s, 1)
                sc -= abs(expected_pos - actual_pos) * 4.5
                scores[qi][si] = sc

        # Monotonic DP with -16.0 collision penalty when not in same sharedGroup
        dp = [[-1e9] * n_s for _ in range(n_q)]
        parent = [[0] * n_s for _ in range(n_q)]
        for si in range(n_s):
            dp[0][si] = scores[0][si]

        for qi in range(1, n_q):
            q_cur = qkeys[q_start + qi]
            q_prev = qkeys[q_start + qi - 1]
            same_grp = (
                q_cur["sharedGroup"] is not None
                and q_prev["sharedGroup"] is not None
                and q_cur["sharedGroup"]["groupId"] == q_prev["sharedGroup"]["groupId"]
            )
            col_pen = 0.0 if (same_grp or n_s < 12) else 16.0

            for si in range(n_s):
                best_val = -1e9
                best_prev = 0
                for psi in range(si + 1):
                    cand = dp[qi - 1][psi] + scores[qi][si] - (col_pen if psi == si else 0.0)
                    if cand > best_val:
                        best_val = cand
                        best_prev = psi
                dp[qi][si] = best_val
                parent[qi][si] = best_prev

        chosen_idx = [0] * n_q
        chosen_idx[n_q - 1] = max(range(n_s), key=lambda si: dp[n_q - 1][si])
        for qi in range(n_q - 1, 0, -1):
            chosen_idx[qi - 1] = parent[qi][chosen_idx[qi]]

        for qi in range(n_q):
            q_num = q_start + qi
            si = chosen_idx[qi]
            seg = segs[si]
            window_segs = [seg]
            # Expand safely within <= 1.8s silence gap (never cross a long pause!)
            if len(seg["text"]) < 55 and si + 1 < n_s and (segs[si + 1]["startTime"] - seg["endTime"] <= 1.8):
                window_segs.append(segs[si + 1])
            elif (
                si > 0
                and (seg["startTime"] - segs[si - 1]["endTime"] <= 1.8)
                and any(m in segs[si - 1]["text"].lower() for m in ("actually", "sorry", "but", "however"))
            ):
                window_segs.insert(0, segs[si - 1])

            ev_quote = " ".join(w["text"] for w in window_segs).strip()
            ev_start = window_segs[0]["startTime"]
            ev_end = window_segs[-1]["endTime"]

            kinfo = qkeys[q_num]
            pinfo = prompts.get(q_num, {"snippet": "", "options": {}})
            p_lower = pinfo["snippet"].lower()
            e_lower = ev_quote.lower()

            found_paraphrases = []
            for p_word, syns in prep.PARAPHRASE_PAIRS:
                in_p = re.search(rf"\b{re.escape(p_word)}\b", p_lower)
                matched_syn = next((sy for sy in syns if re.search(rf"\b{re.escape(sy)}\b", e_lower)), None)
                if in_p and matched_syn:
                    found_paraphrases.append({"questionTerm": p_word, "audioTerm": matched_syn})
                else:
                    syn_in_p = next((sy for sy in syns if re.search(rf"\b{re.escape(sy)}\b", p_lower)), None)
                    if syn_in_p and re.search(rf"\b{re.escape(p_word)}\b", e_lower):
                        found_paraphrases.append({"questionTerm": syn_in_p, "audioTerm": p_word})
                if len(found_paraphrases) >= 3:
                    break

            found_distractors = []
            for marker, note in prep.DISTRACTOR_MARKERS:
                if marker in e_lower:
                    found_distractors.append(note)
                if len(found_distractors) >= 2:
                    break

            if re.search(r"\d", kinfo["canonicalAnswer"]):
                nums_in_ev = re.findall(r"\b\d+(?:[.:]\d+)?\b", ev_quote)
                other_nums = [n for n in nums_in_ev if n not in kinfo["canonicalAnswer"]]
                if other_nums and not found_distractors:
                    found_distractors.append(
                        f"Có số gây nhiễu ({', '.join(other_nums[:2])}) xuất hiện sát đáp án chuẩn '{kinfo['canonicalAnswer']}'."
                    )

            canon = kinfo["canonicalAnswer"]
            parts_exp = []
            if kinfo["sharedGroup"]:
                qs_str = "–".join(str(x) for x in kinfo["sharedGroup"]["questionNumbers"])
                parts_exp.append(
                    f"Câu {qs_str} là dạng chọn nhiều đáp án không phân biệt thứ tự (tập đáp án đúng: {canon})."
                )
            elif re.fullmatch(r"[A-I]", canon) and kinfo["answerRaw"] != canon:
                parts_exp.append(f"Đáp án đúng là phương án {kinfo['answerRaw']}.")
            else:
                parts_exp.append(f"Đáp án chuẩn cần điền là \"{canon}\".")

            if found_paraphrases:
                pairs_txt = "; ".join(f"'{p['questionTerm']}' ↔ '{p['audioTerm']}'" for p in found_paraphrases)
                parts_exp.append(f"Diễn đạt tương đương (paraphrase) giữa đề và audio: {pairs_txt}.")
            if found_distractors:
                parts_exp.append(f"Lưu ý bẫy gây nhiễu (distractor): {found_distractors[0]}.")
            else:
                parts_exp.append("Nghe đoạn trích dẫn tương ứng để xác nhận từ khóa và chính tả chuẩn.")

            questions_out.append(
                {
                    "number": q_num,
                    "part": part_num,
                    "promptContext": pinfo["snippet"],
                    "answerRaw": kinfo["answerRaw"],
                    "canonicalAnswer": canon,
                    "acceptedAnswers": kinfo["acceptedAnswers"],
                    "sharedGroup": kinfo["sharedGroup"],
                    "evidenceQuote": ev_quote,
                    "evidenceStartTime": ev_start,
                    "evidenceEndTime": ev_end,
                    "paraphrases": found_paraphrases,
                    "distractors": found_distractors,
                    "explanationVi": " ".join(parts_exp),
                }
            )
    return questions_out


def build_parts_segments_and_questions(
    spec: dict,
    existing_data: dict,
    aligned_sentences: list[dict[str, Any]],
    part_topics: dict[int, str],
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    audio_dur = float(existing_data["audioDurationSec"])

    # 1. Monotonic Part 1-4 boundaries from ALL aligned spoken sentences (incl. section headers)
    spoken_all = [s for s in aligned_sentences if s["isSpoken"]]
    parts_meta: list[dict] = []
    prev_part_end = 0.0
    for p in range(1, 5):
        p_all = [s for s in spoken_all if s["part"] == p]
        p_dialogue = [s for s in p_all if not s["isAdmin"]]
        src = p_dialogue if p_dialogue else p_all
        if src:
            st = max(prev_part_end, p_all[0]["startTime"] if p_all else src[0]["startTime"])
            en = max(st + 1.0, p_all[-1]["endTime"] if p_all else src[-1]["endTime"])
        else:
            st = round((p - 1) * audio_dur / 4, 2)
            en = round(p * audio_dur / 4, 2)
        st = round(min(audio_dur - 1.0, st), 2)
        en = round(min(audio_dur, en), 2)
        prev_part_end = en
        q_start, q_end = (p - 1) * 10 + 1, p * 10
        parts_meta.append(
            {
                "partNumber": p,
                "title": f"Part {p}",
                "questionRange": [q_start, q_end],
                "startTime": st,
                "endTime": en,
                "topicHint": part_topics.get(p, f"Section {p} (Questions {q_start}-{q_end})"),
            }
        )

    # 2. Exclude admin boilerplate & written-only sentences, then split silences/long sentences
    kept = [s for s in spoken_all if not s["isAdmin"]]
    split_list: list[dict[str, Any]] = []
    for s in kept:
        for pc in split_on_silence_and_clauses(s):
            txt_pc = pc["text"].strip()
            if not pc["qTags"] and (
                ADMIN_BOILERPLATE_RE.match(txt_pc)
                or re.match(r"^(?:that is the end|you now have|now turn to|first,?\s+you have some time)", txt_pc, re.I)
            ):
                continue
            split_list.append(pc)

    # 3. Merge tiny conversational backchannels (<4 words or <1.6s) when acoustic gap <= 0.8s
    merged: list[dict[str, Any]] = []
    for cur in split_list:
        txt = cur["text"].strip()
        if len(txt) < 2:
            continue
        dur = cur["endTime"] - cur["startTime"]
        word_cnt = len(txt.split())
        is_tiny = word_cnt < 4 or dur < 1.6
        if is_tiny and merged and merged[-1]["part"] == cur["part"]:
            prev = merged[-1]
            gap = cur["startTime"] - prev["endTime"]
            comb_dur = cur["endTime"] - prev["startTime"]
            comb_len = len(prev["text"]) + 1 + len(txt)
            if gap <= 0.8 and comb_dur <= 10.5 and comb_len <= 150:
                prev["text"] = f"{prev['text']} {txt}".strip()
                prev["endTime"] = round(max(prev["endTime"], cur["endTime"]), 2)
                if cur["qTags"]:
                    prev["qTags"] = sorted(set(prev["qTags"] + cur["qTags"]))
                continue
        merged.append(
            {
                "part": cur["part"],
                "text": txt,
                "startTime": cur["startTime"],
                "endTime": cur["endTime"],
                "qTags": list(cur["qTags"]),
            }
        )

    # 4. Drop unmergeable tiny junk (<4 chars or <0.35s) & enforce clean monotonicity
    short_segments: list[dict] = []
    for idx, seg in enumerate(merged):
        txt = seg["text"].strip()
        dur = seg["endTime"] - seg["startTime"]
        if len(txt) < 4 or (dur < 0.35 and not seg["qTags"]):
            continue
        st = max(0.0, min(audio_dur - 0.4, seg["startTime"]))
        en = max(st + 0.4, min(audio_dur, seg["endTime"]))
        if short_segments and st < short_segments[-1]["endTime"]:
            prev_en = short_segments[-1]["endTime"]
            if prev_en - st < 0.4 and prev_en - short_segments[-1]["startTime"] > 0.5:
                mid = round((prev_en + st) / 2.0, 2)
                short_segments[-1]["endTime"] = mid
                st = mid
            else:
                st = prev_en
            en = max(st + 0.4, min(audio_dur, en))
        short_segments.append(
            {
                "id": f"seg-{len(short_segments) + 1:03d}",
                "part": seg["part"],
                "startTime": round(st, 2),
                "endTime": round(en, 2),
                "text": txt,
                "timestampSource": "exact",
                "qTags": seg["qTags"],
            }
        )

    # 5. Build silence-aware longSegments (3-5 short segments, break on >2.5s gap)
    long_groups: list[list[dict]] = []
    i = 0
    while i < len(short_segments):
        part = short_segments[i]["part"]
        start_t = short_segments[i]["startTime"]
        group = [short_segments[i]]
        j = i + 1
        while j < len(short_segments) and short_segments[j]["part"] == part:
            gap = short_segments[j]["startTime"] - short_segments[j - 1]["endTime"]
            span = short_segments[j]["endTime"] - start_t
            if gap > 2.5 or len(group) >= 5 or (len(group) >= 3 and span >= 24.0) or span > 42.0:
                break
            group.append(short_segments[j])
            j += 1

        # Fold 1-segment pre-silence / end-of-part orphan if clean & non-silence-crossing
        if len(group) == 1 and long_groups and long_groups[-1][0]["part"] == part:
            prev_grp = long_groups[-1]
            gap_from_prev = group[0]["startTime"] - prev_grp[-1]["endTime"]
            comb_span = group[0]["endTime"] - prev_grp[0]["startTime"]
            if gap_from_prev <= 2.5 and len(prev_grp) <= 5 and comb_span <= 46.0:
                prev_grp.append(group[0])
                i = j
                continue

        long_groups.append(group)
        i = j

    long_segments = [
        {
            "id": f"long-{idx + 1:03d}",
            "part": grp[0]["part"],
            "startTime": grp[0]["startTime"],
            "endTime": grp[-1]["endTime"],
            "text": " ".join(g["text"] for g in grp),
            "segmentIds": [g["id"] for g in grp],
            "timestampSource": "exact",
        }
        for idx, grp in enumerate(long_groups)
    ]

    # 6. Re-align all 40 questions using isolated per-question prompts + monotonic DP
    pdf_path = DATA_ROOT / f"vol-{spec['vol']}" / f"test-{spec['test']}" / "exam.pdf"
    doc = pymupdf.open(str(pdf_path))
    q_end_pg = min(spec["question_page_limit"] or len(doc), len(doc))
    exam_text = "\n".join(doc[p].get_text() for p in range(0, q_end_pg))
    doc.close()
    prompts = extract_focused_question_prompts(exam_text)

    qkeys: dict[int, dict] = {}
    for q in existing_data["questions"]:
        qkeys[int(q["number"])] = {
            "answerRaw": q["answerRaw"],
            "canonicalAnswer": q["canonicalAnswer"],
            "acceptedAnswers": q["acceptedAnswers"],
            "sharedGroup": q["sharedGroup"],
        }

    questions = align_questions_dp_smart(
        spec["vol"], spec["test"], qkeys, short_segments, prompts
    )

    # Clean qTags output format cleanly
    clean_short = [{k: v for k, v in s.items()} for s in short_segments]
    return parts_meta, clean_short, long_segments, questions


# ---------------------------------------------------------------------------
# Benchmark Comparison & Pipeline Execution
# ---------------------------------------------------------------------------

def score_bench_candidates(specs_map: dict[str, dict]) -> dict[str, Any]:
    spec = specs_map["vol-7-test-1"]
    ref_json = CACHE_DIR / "vol-7-test-1.json"
    assert ref_json.exists(), "Reference vol-7-test-1.json missing"
    sentences, _ = extract_official_sentences(spec)
    existing = json.loads((DATA_ROOT / "vol-7/test-1/data.json").read_text(encoding="utf-8"))
    dur = float(existing["audioDurationSec"])

    ref_words, ref_dtw = extract_whisper_words(ref_json)
    ref_aligned, ref_metrics = align_transcript_to_whisper(sentences, ref_words, dur)
    ref_by_idx = [s["startTime"] for s in ref_aligned]

    bench_summary = json.loads((CACHE_DIR / "bench_results.json").read_text(encoding="utf-8"))
    scores: dict[str, Any] = {}
    selected = None

    # Evaluation order: prefer base_q5_vad -> base_q5_novad (if <=240s) -> fastest qualifying
    for name in ("tiny_novad", "base_q5_novad", "base_q5_vad", "tiny_vad"):
        jp = CACHE_DIR / f"bench_{name}.json"
        if not jp.exists() or bench_summary.get(name, {}).get("rc") != 0:
            continue
        words, dtw_ratio = extract_whisper_words(jp)
        aligned, metrics = align_transcript_to_whisper(sentences, words, dur)
        diffs = [
            abs(aligned[i]["startTime"] - ref_by_idx[i])
            for i in range(min(len(aligned), len(ref_by_idx)))
            if not aligned[i]["isAdmin"] and aligned[i]["isSpoken"]
        ]
        diffs.sort()
        med = diffs[len(diffs) // 2] if diffs else 999.0
        p95 = diffs[int(len(diffs) * 0.95)] if diffs else 999.0
        tail_diffs = [
            abs(aligned[i]["startTime"] - ref_by_idx[i])
            for i in range(min(len(aligned), len(ref_by_idx)))
            if 1450.0 <= ref_by_idx[i] <= 1495.0 and not aligned[i]["isAdmin"]
        ]
        tail_med = sorted(tail_diffs)[len(tail_diffs) // 2] if tail_diffs else 999.0
        elapsed = bench_summary[name]["elapsed"]

        qualifies = (
            dtw_ratio >= 0.98
            and metrics["wordMatchRate"] >= 0.90
            and med <= 0.15
            and p95 <= 0.50
            and tail_med <= 0.30
        )
        scores[name] = {
            "elapsed": elapsed,
            "dtw_valid_ratio": dtw_ratio,
            "word_match_rate": metrics["wordMatchRate"],
            "median_abs_diff": round(med, 3),
            "p95_abs_diff": round(p95, 3),
            "part4_tail_diff": round(tail_med, 3),
            "qualifies": qualifies,
        }

    # Automatic Selection Rule
    for pref in ("base_q5_vad", "base_q5_novad"):
        if pref in scores and scores[pref]["qualifies"] and scores[pref]["elapsed"] <= 240.0:
            selected = pref
            break
    if not selected:
        quals = [(k, v["elapsed"]) for k, v in scores.items() if v["qualifies"]]
        if quals:
            quals.sort(key=lambda x: x[1])
            selected = quals[0][0]
    if not selected:
        selected = "base_f16"

    report = {
        "ref_base_f16": {"dtw_valid_ratio": ref_dtw, **ref_metrics},
        "candidates": scores,
        "selected": selected,
    }
    (CACHE_DIR / "selected_mode.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


def update_manifest(report_rows: list[dict[str, Any]]):
    manifest_path = DATA_ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_id = {r["id"]: r for r in report_rows}

    total_bytes = 0
    max_bytes = 0
    max_path = ""
    for item in manifest["tests"]:
        if item["status"] != "ready":
            continue
        tid = item["id"]
        data_rel = item["dataUrl"].replace("./data/", "")
        pdf_rel = item["pdfUrl"].replace("./data/", "")
        aud_rel = item["audioUrl"].replace("./data/", "")
        for rel in (data_rel, pdf_rel, aud_rel):
            p = DATA_ROOT / rel
            sz = p.stat().st_size
            total_bytes += sz
            if sz > max_bytes:
                max_bytes = sz
                max_path = f"./data/{rel}"

        if tid in by_id:
            djson = json.loads((DATA_ROOT / data_rel).read_text(encoding="utf-8"))
            item["hasExactTimestamps"] = bool(djson["hasExactTimestamps"])
            item["shortSegmentCount"] = len(djson["transcriptSegments"])
            item["longSegmentCount"] = len(djson["longSegments"])
            if item["vol"] == 7 and item["testNumber"] == 11:
                item["sourceNotes"] = "Trang 7-9 của PDF gốc là Answer Key; chế độ thi mặc định hiển thị trang 1-6. Mốc giờ đã căn âm học từng từ."
            elif item["vol"] == 8:
                item["sourceNotes"] = "Đề DOCX chuyển PDF giữ nguyên hình; mốc giờ đã căn chỉnh âm học trực tiếp từ audio gốc."
            else:
                item["sourceNotes"] = "Đủ 4 thành phần chuẩn; mốc giờ đã căn chỉnh âm học trực tiếp từ audio gốc."

    vocab_path = DATA_ROOT / "vocab-core.json"
    if vocab_path.exists():
        total_bytes += vocab_path.stat().st_size

    manifest["sourceSummary"]["totalPackagedDataMB"] = round(total_bytes / 1048576, 2)
    manifest["sourceSummary"]["largestFilePath"] = max_path
    manifest["sourceSummary"]["largestFileMB"] = round(max_bytes / 1048576, 2)
    manifest["sourceSummary"]["volumes"] = [
        {"vol": 7, "label": "Vol 7", "ready": 11, "total": 11, "notes": "Đủ PDF gốc, Audio gốc, Key & Transcript đã căn mốc âm học từng từ (T1–T11)."},
        {"vol": 8, "label": "Vol 8", "ready": 8, "total": 8, "notes": "Đủ 8 đề gốc (DOCX->PDF), Audio gốc, Key & Transcript đã căn mốc âm học từng từ (T1–T8)."},
        {"vol": 9, "label": "Vol 9", "ready": 9, "total": 9, "notes": "Đủ 9 đề gốc (DOCX->PDF), Audio gốc, Key & Transcript đã căn mốc âm học từng từ (T1–T9)."},
        {"vol": 10, "label": "Vol 10", "ready": 0, "total": 4, "notes": "Chưa có tài liệu Listening trong kho nguồn (VOL 10 KEY.pdf chỉ gồm Reading Tests 1–6). Hỗ trợ nạp file cục bộ."},
    ]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tests", nargs="*", help="Subset of test ids e.g. vol-7-test-1")
    parser.add_argument(
        "--model-mode",
        default="auto",
        choices=["auto", "base_f16", "base_q5_novad", "base_q5_vad", "tiny_novad", "tiny_vad"],
    )
    parser.add_argument("--fallback-threshold", type=float, default=0.88)
    parser.add_argument("--force-whisper", action="store_true")
    parser.add_argument("--skip-whisper", action="store_true")
    parser.add_argument("--compare-bench", action="store_true")
    args = parser.parse_args()

    all_specs = prep.build_test_specs()
    specs_map = {f"vol-{s['vol']}-test-{s['test']}": s for s in all_specs}

    if args.compare_bench:
        score_bench_candidates(specs_map)
        return

    mode = args.model_mode
    if mode == "auto":
        sel_file = CACHE_DIR / "selected_mode.json"
        if sel_file.exists():
            mode = json.loads(sel_file.read_text(encoding="utf-8")).get("selected", "base_f16")
        else:
            mode = "base_f16"

    target_ids = args.tests if args.tests else list(specs_map.keys())
    report_rows: list[dict[str, Any]] = []

    print(f"=== Acoustic Alignment | mode={mode} | tests={len(target_ids)} ===", flush=True)
    for idx, tid in enumerate(target_ids, start=1):
        spec = specs_map[tid]
        tdir = DATA_ROOT / f"vol-{spec['vol']}" / f"test-{spec['test']}"
        audio_path = tdir / "audio.mp3"
        json_path = tdir / "data.json"
        existing = json.loads(json_path.read_text(encoding="utf-8"))
        audio_dur = float(existing["audioDurationSec"])

        whisper_cache = CACHE_DIR / f"{tid}.json"
        sentences, part_topics = extract_official_sentences(spec)

        if args.skip_whisper and not whisper_cache.exists():
            print(f"[{idx}/{len(target_ids)}] {tid}: skipped (no cache)", flush=True)
            continue

        elapsed = 0.0
        used_mode = mode
        if not args.skip_whisper:
            _, elapsed = run_whisper_for_test(tid, audio_path, mode, whisper_cache, force=args.force_whisper)

        words, dtw_ratio = extract_whisper_words(whisper_cache)
        aligned, metrics = align_transcript_to_whisper(sentences, words, audio_dur)

        # High-accuracy fallback if match rate < threshold and not already base_f16
        if not args.skip_whisper and metrics["wordMatchRate"] < args.fallback_threshold and used_mode != "base_f16":
            print(
                f"  [{tid}] match={metrics['wordMatchRate']:.3f} < {args.fallback_threshold}; running base_f16 fallback...",
                flush=True,
            )
            fb_cache = CACHE_DIR / f"{tid}.base_f16.json"
            _, fb_elapsed = run_whisper_for_test(tid, audio_path, "base_f16", fb_cache, force=args.force_whisper)
            elapsed += fb_elapsed
            fb_words, fb_dtw = extract_whisper_words(fb_cache)
            fb_aligned, fb_metrics = align_transcript_to_whisper(sentences, fb_words, audio_dur)
            if fb_metrics["wordMatchRate"] >= metrics["wordMatchRate"]:
                fb_cache.replace(whisper_cache)
                words, dtw_ratio, aligned, metrics = fb_words, fb_dtw, fb_aligned, fb_metrics
                used_mode = "base_f16(fallback)"
            else:
                fb_cache.unlink(missing_ok=True)

        parts_meta, short_segs, long_segs, questions = build_parts_segments_and_questions(
            spec, existing, aligned, part_topics
        )

        ok_exact = metrics["wordMatchRate"] >= 0.80
        updated_payload = {
            **existing,
            "hasExactTimestamps": ok_exact,
            "timestampNote": (
                "Mốc thời gian đã được căn chỉnh trực tiếp từ audio gốc ở mức từng từ (acoustic forced alignment)."
                if ok_exact
                else f"Tỉ lệ khớp âm học đạt {metrics['wordMatchRate']*100:.1f}%; cần kiểm tra thêm file nguồn."
            ),
            "parts": parts_meta,
            "questions": questions,
            "transcriptSegments": short_segs,
            "longSegments": long_segs,
        }
        json_path.write_text(json.dumps(updated_payload, ensure_ascii=False, indent=2), encoding="utf-8")

        max_short_dur = max((s["endTime"] - s["startTime"] for s in short_segs), default=0.0)
        min_text_len = min((len(s["text"]) for s in short_segs), default=0)
        max_long_gap = 0.0
        by_id = {s["id"]: s for s in short_segs}
        for ls in long_segs:
            ids = ls["segmentIds"]
            for k in range(1, len(ids)):
                g = by_id[ids[k]]["startTime"] - by_id[ids[k - 1]]["endTime"]
                if g > max_long_gap:
                    max_long_gap = g

        row = {
            "id": tid,
            "mode": used_mode,
            "whisperSec": elapsed,
            "dtwRatio": dtw_ratio,
            **metrics,
            "shortCount": len(short_segs),
            "longCount": len(long_segs),
            "minLen": min_text_len,
            "maxShortDur": round(max_short_dur, 2),
            "maxLongGap": round(max_long_gap, 2),
        }
        report_rows.append(row)
        print(
            f"[{idx:02d}/{len(target_ids):02d}] {tid:12s} | mode={used_mode:14s} | t={elapsed:5.1f}s | "
            f"match={metrics['wordMatchRate']*100:5.1f}% | short={len(short_segs):3d} (max {max_short_dur:4.1f}s, minCh={min_text_len}) | "
            f"long={len(long_segs):2d} (maxGap={max_long_gap:4.2f}s)",
            flush=True,
        )

    update_manifest(report_rows)
    (CACHE_DIR / "alignment-report.json").write_text(
        json.dumps(report_rows, indent=2), encoding="utf-8"
    )
    print("\nSaved alignment-report.json and updated manifest.json.", flush=True)


if __name__ == "__main__":
    main()
