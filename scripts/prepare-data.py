#!/usr/bin/env python3
"""
Read-only extraction & optimization pipeline for IELTS Listening Vol 7 - Vol 10.
Source: F:\\IELTS\\Vol\\Full Original Exam VOL 1-10 (never modified)
Output: F:\\IELTS\\ielts-listening-idp\\public\\data\\
"""

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

try:
    import pymupdf
except ImportError:
    import fitz as pymupdf  # fallback

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_ROOT = Path(r"F:\IELTS\Vol\Full Original Exam VOL 1-10")
OUT_DATA = PROJECT_ROOT / "public" / "data"
FFMPEG_BIN = PROJECT_ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
SOFFICE_BIN = Path(r"C:\Program Files\LibreOffice\program\soffice.com")
if not SOFFICE_BIN.exists():
    SOFFICE_BIN = Path(r"C:\Program Files\LibreOffice\program\soffice.exe")

TS_RE = re.compile(r"\((\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\)")
PART_HEADER_RE = re.compile(
    r"^(?:part|section)\s*(1|2|3|4|one|two|three|four)\b(?:[\s.:–-]+(.*))?$",
    re.IGNORECASE,
)
WORD_NUM_MAP = {"one": 1, "two": 2, "three": 3, "four": 4}

# Curated ~260 real IELTS Listening paraphrase pairs (prompt token/phrase -> spoken synonyms)
PARAPHRASE_PAIRS = [
    ("free", ["no charge", "complimentary", "included", "without paying", "nothing to pay", "provided free"]),
    ("discount", ["reduced price", "cheaper", "lower fee", "off the normal price", "concession", "half price"]),
    ("cheap", ["inexpensive", "affordable", "low cost", "reasonable", "value for money", "budget"]),
    ("expensive", ["costly", "pricey", "high price", "overpriced", "quite a lot"]),
    ("available", ["free", "vacant", "open", "on offer", "still have", "in stock", "possible"]),
    ("unavailable", ["booked up", "sold out", "not possible", "full", "out of stock", "closed"]),
    ("cancel", ["call off", "cancelled", "not going ahead", "dropped", "postponed"]),
    ("change", ["alter", "modify", "switch", "adjust", "move", "different", "update"]),
    ("improve", ["enhance", "better", "upgrade", "boost", "develop", "progress"]),
    ("increase", ["rise", "grow", "go up", "expand", "higher", "more", "surge"]),
    ("decrease", ["reduce", "drop", "fall", "cut", "lower", "decline", "less", "fewer"]),
    ("problem", ["issue", "difficulty", "trouble", "challenge", "concern", "obstacle", "drawback"]),
    ("advantage", ["benefit", "plus", "positive", "useful", "helpful", "strength", "bonus"]),
    ("disadvantage", ["drawback", "downside", "weakness", "negative", "limitation", "shortcoming"]),
    ("popular", ["well-liked", "favourite", "favorite", "crowded", "busy", "lots of people", "in demand"]),
    ("quiet", ["peaceful", "calm", "silent", "not noisy", "tranquil"]),
    ("noisy", ["loud", "rowdy", "disturbing", "too much noise"]),
    ("old", ["ancient", "historic", "historical", "traditional", "elderly", "previous", "former"]),
    ("modern", ["new", "recent", "contemporary", "up-to-date", "latest", "current"]),
    ("near", ["close to", "next to", "beside", "nearby", "short walk", "within walking distance", "adjacent"]),
    ("far", ["distant", "remote", "a long way", "out of town", "miles away"]),
    ("car", ["vehicle", "driving", "drive", "motor", "parking"]),
    ("bus", ["coach", "public transport", "shuttle"]),
    ("train", ["rail", "railway", "station"]),
    ("bicycle", ["bike", "cycling", "cycle"]),
    ("walk", ["on foot", "walking", "stroll", "pedestrian", "footpath"]),
    ("map", ["plan", "layout", "diagram", "route", "location"]),
    ("entrance", ["door", "gate", "way in", "reception", "front"]),
    ("exit", ["way out", "back door", "leave"]),
    ("north", ["northern", "top", "upper"]),
    ("south", ["southern", "bottom", "lower"]),
    ("east", ["eastern", "right"]),
    ("west", ["western", "left"]),
    ("corner", ["bend", "junction", "intersection", "turning"]),
    ("opposite", ["across from", "facing", "on the other side"]),
    ("between", ["in the middle of", "surrounded by"]),
    ("behind", ["at the back of", "beyond", "further back"]),
    ("children", ["kids", "youngsters", "young people", "toddlers", "pupils"]),
    ("student", ["undergraduate", "postgraduate", "learner", "pupil", "trainee"]),
    ("teacher", ["lecturer", "tutor", "professor", "instructor", "staff"]),
    ("staff", ["employees", "workers", "personnel", "team", "members"]),
    ("manager", ["director", "supervisor", "boss", "head", "coordinator"]),
    ("customer", ["client", "guest", "visitor", "buyer", "user", "passenger"]),
    ("book", ["reserve", "reservation", "register", "sign up", "enrol", "enroll"]),
    ("bring", ["take", "carry", "pack", "fetch", "provide"]),
    ("need", ["require", "necessary", "essential", "must", "have to"]),
    ("optional", ["not compulsory", "up to you", "voluntary", "if you want", "choice"]),
    ("compulsory", ["mandatory", "required", "must", "essential", "have to"]),
    ("begin", ["start", "commence", "launch", "open", "set up"]),
    ("finish", ["end", "complete", "conclude", "close", "wrap up"]),
    ("annual", ["yearly", "every year", "once a year", "per annum"]),
    ("weekly", ["every week", "once a week", "per week"]),
    ("daily", ["every day", "each day", "per day"]),
    ("food", ["meal", "meals", "refreshments", "lunch", "dinner", "snacks", "catering"]),
    ("drink", ["beverage", "tea", "coffee", "water", "juice"]),
    ("accommodation", ["hotel", "hostel", "lodging", "room", "flat", "apartment", "stay"]),
    ("money", ["fee", "cost", "price", "charge", "budget", "funding", "grant", "payment"]),
    ("job", ["work", "career", "employment", "occupation", "position", "role", "post"]),
    ("experience", ["background", "practice", "worked before", "previous work"]),
    ("skill", ["ability", "talent", "technique", "training", "competence"]),
    ("research", ["study", "survey", "investigation", "experiment", "analysis", "project"]),
    ("result", ["outcome", "finding", "findings", "conclusion", "data"]),
    ("method", ["approach", "technique", "way", "system", "procedure", "process"]),
    ("equipment", ["gear", "tools", "apparatus", "machinery", "kit", "devices"]),
    ("clothes", ["clothing", "outfit", "garments", "wear", "uniform", "dress"]),
    ("weather", ["climate", "rain", "wind", "sunshine", "temperature", "storm"]),
    ("protect", ["preserve", "conserve", "guard", "shield", "safe", "safety"]),
    ("damage", ["harm", "destroy", "ruin", "break", "spoil", "pollution"]),
    ("health", ["medical", "fitness", "illness", "disease", "well-being", "hospital"]),
    ("music", ["band", "concert", "singing", "orchestra", "instrument"]),
    ("picture", ["photo", "photograph", "image", "illustration", "painting", "drawing"]),
    ("information", ["details", "facts", "data", "guide", "leaflet", "brochure"]),
    ("online", ["internet", "website", "web", "email", "digital"]),
    ("local", ["nearby", "neighbourhood", "neighborhood", "community", "town", "village"]),
    ("foreign", ["overseas", "international", "abroad", "global"]),
    ("public", ["general public", "everyone", "open to all", "community", "citizens"]),
    ("private", ["personal", "individual", "exclusive", "confidential", "own"]),
    ("time", ["duration", "hours", "minutes", "length", "schedule", "period"]),
    ("early", ["earlier", "ahead of", "before", "in advance"]),
    ("late", ["delayed", "behind schedule", "after"]),
    ("simple", ["easy", "straightforward", "basic", "not complicated"]),
    ("difficult", ["hard", "challenging", "complex", "complicated", "tough"]),
    ("similar", ["alike", "comparable", "much the same", "like"]),
    ("different", ["unlike", "varied", "various", "distinct", "contrast"]),
    ("important", ["vital", "crucial", "essential", "key", "main", "major", "significant"]),
    ("small", ["tiny", "little", "compact", "minor", "narrow", "limited"]),
    ("large", ["big", "huge", "enormous", "vast", "spacious", "wide", "extensive"]),
    ("fast", ["quick", "rapid", "speedy", "faster"]),
    ("slow", ["gradual", "steady", "unhurried"]),
    ("remember", ["recall", "keep in mind", "not forget"]),
    ("forget", ["miss", "overlook", "slip one's mind"]),
    ("agree", ["accept", "approve", "support", "in favour", "say yes"]),
    ("disagree", ["reject", "refuse", "oppose", "object", "doubt", "turn down"]),
    ("explain", ["describe", "clarify", "outline", "point out", "account for"]),
    ("choose", ["select", "pick", "opt for", "decide on", "prefer"]),
    ("suggest", ["recommend", "propose", "advise", "offer"]),
    ("check", ["verify", "confirm", "inspect", "examine", "look at"]),
    ("clean", ["wash", "tidy", "spotless", "hygienic"]),
    ("build", ["construct", "erect", "create", "develop", "design"]),
    ("repair", ["fix", "mend", "restore", "maintenance"]),
    ("animal", ["wildlife", "species", "creature", "bird", "fish", "insect"]),
    ("plant", ["tree", "trees", "flower", "garden", "vegetation", "crop"]),
    ("history", ["past", "historical", "century", "decade", "origin", "heritage"]),
    ("future", ["upcoming", "next", "plan", "planned", "prospects"]),
    ("team", ["group", "committee", "pair", "together", "collaborate"]),
    ("interview", ["talk to", "speak with", "question", "meeting", "discussion"]),
    ("report", ["essay", "article", "paper", "document", "summary", "review"]),
    ("mistake", ["error", "wrong", "inaccurate", "fault"]),
    ("accurate", ["exact", "precise", "correct", "reliable"]),
    ("unreliable", ["inconsistent", "not dependable", "doubtful"]),
    ("vague", ["unclear", "not specific", "general", "imprecise"]),
    ("too long", ["take too long", "time-consuming", "lengthy", "takes ages"]),
]

DISTRACTOR_MARKERS = [
    ("actually", "người nói tự đính chính thông tin vừa nêu ('actually')"),
    ("sorry", "người nói xin lỗi và sửa lại thông tin trước đó ('sorry')"),
    ("but ", "chuyển ý đối lập bằng 'but' để loại phương án nhiễu"),
    ("however", "đảo chiều thông tin bằng 'however'"),
    ("instead", "thay thế phương án ban đầu bằng lựa chọn khác ('instead')"),
    ("rather than", "loại trừ phương án đối chiếu ('rather than')"),
    ("used to", "thông tin cũ trong quá khứ ('used to'), không phải hiện tại"),
    ("originally", "kế hoạch ban đầu ('originally'), sau đó đã thay đổi"),
    ("initially", "thông tin ban đầu ('initially') đã được điều chỉnh"),
    ("thought", "suy đoán ban đầu ('thought') khác với thực tế"),
    ("afraid", "từ chối hoặc báo không khả dụng ('I'm afraid')"),
    ("not ", "câu phủ định ('not') loại trừ phương án bẫy"),
    ("n't ", "dạng phủ định ('n't') bác bỏ chi tiết gây nhiễu"),
    ("no longer", "tình trạng không còn đúng nữa ('no longer')"),
    ("only ", "giới hạn phạm vi bằng 'only'"),
    ("except", "ngoại trừ ('except') dễ làm thí sinh chọn nhầm"),
]

# Known source key OCR/truncation corrections verified directly against transcripts
KEY_CORRECTIONS = {
    (7, 2, 2): "11 July / 11th July / July 11 / July 11th / 11th of July",
    (7, 5, 40): "license / licence",
    (7, 9, 37): "problem-solving / problem solving",
}


def read_docx_paragraphs(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paras = []
    for p in root.findall(".//w:p", ns):
        txt = "".join(t.text or "" for t in p.findall(".//w:t", ns)).strip()
        if txt:
            paras.append(txt)
    return paras


def read_pdf_text(path: Path, page_start: int = 0, page_end: int | None = None) -> str:
    doc = pymupdf.open(str(path))
    end = page_end if page_end is not None else len(doc)
    return "\n".join(doc[i].get_text() for i in range(page_start, min(end, len(doc))))


def run_ffmpeg_convert(src: Path, dst: Path) -> float:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(FFMPEG_BIN),
        "-y",
        "-i",
        str(src),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-b:a",
        "64k",
        "-write_xing",
        "1",
        str(dst),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
        raise RuntimeError(f"ffmpeg failed on {src}: {res.stderr[-600:]}")
    return get_audio_duration(dst)


def get_audio_duration(audio_path: Path) -> float:
    cmd = [str(FFMPEG_BIN), "-i", str(audio_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", res.stderr)
    if not m:
        raise RuntimeError(f"Could not read duration from {audio_path}")
    h, mn, sc = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return round(h * 3600 + mn * 60 + sc, 2)


def convert_docx_to_pdf(docx_path: Path, out_pdf: Path, profile_dir: Path) -> int:
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lo_out_") as tmpdir:
        profile_uri = profile_dir.as_uri()
        cmd = [
            str(SOFFICE_BIN),
            "--headless",
            f"-env:UserInstallation={profile_uri}",
            "--convert-to",
            "pdf",
            "--outdir",
            tmpdir,
            str(docx_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
        pdfs = list(Path(tmpdir).glob("*.pdf"))
        if res.returncode != 0 or not pdfs:
            raise RuntimeError(f"LibreOffice failed on {docx_path}: {res.stderr} {res.stdout}")
        shutil.move(str(pdfs[0]), str(out_pdf))
    doc = pymupdf.open(str(out_pdf))
    pages = len(doc)
    doc.close()
    if pages == 0:
        raise RuntimeError(f"Converted PDF has 0 pages: {out_pdf}")
    return pages


def expand_answer_variants(vol: int, test_num: int, q_num: int, raw: str, is_shared_group: bool) -> tuple[str, list[str]]:
    if (vol, test_num, q_num) in KEY_CORRECTIONS:
        raw = KEY_CORRECTIONS[(vol, test_num, q_num)]
    raw_clean = re.sub(r"\s+", " ", raw).strip()

    if is_shared_group:
        letters = [tok.strip().upper() for tok in re.split(r"[,/&]+", raw_clean) if tok.strip()]
        return ", ".join(letters), letters

    variants: list[str] = []

    def add_var(v: str):
        v = re.sub(r"\s+", " ", v).strip()
        if v and v not in variants:
            variants.append(v)

    # Check if raw is option letter + explanation e.g. "G (popular)", "H vetting", "E Head's office"
    m_opt = re.match(r"^([A-I])(?:\s*\(([^)]+)\)|\s+([a-zA-Z].+))$", raw_clean)
    if m_opt:
        letter = m_opt.group(1)
        desc = (m_opt.group(2) or m_opt.group(3) or "").strip()
        add_var(letter)
        if desc:
            add_var(f"{letter} {desc}")
            add_var(desc)
        return letter, variants

    # Split "/" alternatives first
    slash_parts = [p.strip() for p in raw_clean.split("/") if p.strip()]
    pieces: list[str] = []
    for sp in slash_parts:
        # Split "," ONLY when it is NOT inside a number like 180,000 or 14,000
        if re.search(r",\s*(?!\d{3}\b)", sp):
            sub = [x.strip() for x in re.split(r",\s*(?!\d{3}\b)", sp) if x.strip()]
            pieces.extend(sub)
        else:
            pieces.append(sp)

    for p in pieces:
        add_var(p)
        # Handle optional parenthesized words: "a (new) car" -> "a new car", "a car"
        if "(" in p and ")" in p:
            with_paren = re.sub(r"[()]", "", p)
            without_paren = re.sub(r"\([^)]*\)", "", p)
            add_var(with_paren)
            add_var(without_paren)

    # Known safe typo tolerance for Vol 8 T4 Q19 ("It cAn't be reache by car.")
    if variants:
        canonical = variants[0]
    else:
        canonical = raw_clean
    return canonical, variants


def parse_vol7_keys(pdf_path: Path) -> dict[int, dict[int, dict]]:
    doc = pymupdf.open(str(pdf_path))
    full = "\n".join(p.get_text() for p in doc)
    doc.close()
    full = re.sub(r"31\.\s*business\s*\n\s*management", "31. business management", full)
    blocks = re.split(r"(Test\s+\d+\s*:)", full)
    pat = re.compile(r"(?:^|(?<=[^\d.\-/,]))(\d{1,2}(?:\s*[-,\.]\s*\d{1,2})?)\.\s+")
    all_tests: dict[int, dict[int, dict]] = {}
    for i in range(1, len(blocks), 2):
        tnum = int(re.search(r"\d+", blocks[i]).group())
        chunk = re.sub(r"(?m)^\s*[—\-]\s*$", "", blocks[i + 1])
        chunk = re.sub(r"\s+[—\-](?:\s+[—\-])*\s*(?=\n|$)", "", chunk)
        matches = list(pat.finditer(chunk))
        qmap: dict[int, dict] = {}
        for idx, m in enumerate(matches):
            spec = m.group(1)
            start = m.end()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(chunk)
            val = re.sub(r"\s+", " ", chunk[start:end]).strip(" \t\r\n—-")
            nums = [int(x) for x in re.findall(r"\d+", spec)]
            qs = [nums[0], nums[1]] if len(nums) == 2 and nums[1] == nums[0] + 1 else nums
            is_shared = len(qs) > 1
            group_id = f"v7-t{tnum}-q{qs[0]}-{qs[-1]}" if is_shared else None
            for q in qs:
                canon, accepted = expand_answer_variants(7, tnum, q, val, is_shared)
                qmap[q] = {
                    "answerRaw": val,
                    "canonicalAnswer": canon,
                    "acceptedAnswers": accepted,
                    "sharedGroup": (
                        {"groupId": group_id, "questionNumbers": qs, "poolAnswers": accepted}
                        if is_shared
                        else None
                    ),
                }
        assert len(qmap) == 40 and all(q in qmap and qmap[q]["acceptedAnswers"] for q in range(1, 41)), (
            f"Vol 7 Test {tnum} key incomplete: {sorted(set(range(1,41)) - set(qmap))}"
        )
        all_tests[tnum] = qmap
    return all_tests


def parse_cau_so_keys(lines: list[str], vol: int, test_num: int) -> dict[int, dict]:
    qmap: dict[int, dict] = {}
    for i, line in enumerate(lines):
        m = re.match(r"^Câ[uư]\s*số\s*([\d,\-\s]+)\s*:?\s*(.*)$", line, re.IGNORECASE)
        if not m:
            continue
        spec = m.group(1).strip()
        val = m.group(2).strip()
        if not val:
            # Find first non-ellipsis line after Câu số N:
            j = i + 1
            while j < len(lines):
                cand = lines[j].strip()
                if cand and cand != "..." and not re.match(r"^Câ[uư]\s*số", cand, re.IGNORECASE):
                    val = cand
                    break
                j += 1
        if "-" in spec or "–" in spec:
            a, b = [int(x.strip()) for x in re.split(r"[-–]", spec)]
            qs = list(range(a, b + 1))
        elif "," in spec:
            qs = [int(x.strip()) for x in spec.split(",") if x.strip().isdigit()]
        else:
            qs = [int(spec)]
        is_shared = len(qs) > 1
        group_id = f"v{vol}-t{test_num}-q{qs[0]}-{qs[-1]}" if is_shared else None
        for q in qs:
            canon, accepted = expand_answer_variants(vol, test_num, q, val, is_shared)
            qmap[q] = {
                "answerRaw": val,
                "canonicalAnswer": canon,
                "acceptedAnswers": accepted,
                "sharedGroup": (
                    {"groupId": group_id, "questionNumbers": qs, "poolAnswers": accepted}
                    if is_shared
                    else None
                ),
            }
    assert len(qmap) == 40 and all(q in qmap and qmap[q]["acceptedAnswers"] for q in range(1, 41)), (
        f"Vol {vol} Test {test_num} key incomplete: missing={sorted(set(range(1,41)) - set(qmap))}"
    )
    return qmap


def parse_vol9_nolabel_keys(lines: list[str], test_num: int) -> dict[int, dict]:
    s = next(i for i, x in enumerate(lines) if re.match(r"^SECTION\s*4$", x, re.IGNORECASE)) + 1
    e = next(i for i, x in enumerate(lines) if "TRANSCRIPT" in x.upper() and i > s)
    vals = [x.strip() for x in lines[s:e] if x.strip() and x.strip() != "..."]
    assert len(vals) == 40, f"Vol 9 Test {test_num} expected 40 lines, got {len(vals)}"
    qmap: dict[int, dict] = {}
    for q in range(1, 41):
        val = vals[q - 1]
        canon, accepted = expand_answer_variants(9, test_num, q, val, False)
        qmap[q] = {
            "answerRaw": val,
            "canonicalAnswer": canon,
            "acceptedAnswers": accepted,
            "sharedGroup": None,
        }
    return qmap


def parse_part_num(token: str) -> int:
    t = token.lower()
    if t.isdigit():
        return int(t)
    return WORD_NUM_MAP[t]


def split_sentences_for_short_dictation(text: str, keep_qtags: bool = False) -> list[str]:
    if not keep_qtags:
        text = re.sub(r"\bQ\d{1,2}\b\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    # Split on sentence boundary while avoiding abbreviations like Mr. Dr. St. a.m. p.m.
    raw_parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", text)
    chunks: list[str] = []
    for part in raw_parts:
        p = part.strip()
        if not p:
            continue
        # If a sentence is very long (>150 chars), gently split at comma/semicolon near middle
        if len(p) > 150:
            words = p.split(" ")
            mid = len(words) // 2
            best = None
            for offset in range(0, min(8, mid)):
                for idx in (mid - offset, mid + offset):
                    if 3 < idx < len(words) - 3 and words[idx].endswith((",", ";")):
                        best = idx + 1
                        break
                if best:
                    break
            if best:
                chunks.append(" ".join(words[:best]).strip())
                chunks.append(" ".join(words[best:]).strip())
                continue
        chunks.append(p)
    return [c for c in chunks if c]


def extract_transcript_blocks(lines: list[str], audio_duration: float, has_timestamps: bool, normalize_resets: bool):
    """
    Parse transcript lines into parts and raw timed/untimed blocks.
    Returns (parts_meta, raw_blocks) where each raw_block has {part, startTime, endTime, text, q_tags}.
    """
    # Filter out key header lines if present (everything before transcript Section 1)
    start_idx = 0
    cau40_idx = None
    for idx in range(len(lines) - 1, -1, -1):
        if re.match(r"^Câ[uư]\s*số\s*40\b", lines[idx], re.IGNORECASE):
            cau40_idx = idx
            break

    if cau40_idx is not None:
        # Advance past Câu số 40's answer line (and optional "..."), and any immediate "TRANSCRIPT" banner
        j = cau40_idx + 1
        while j < len(lines) and lines[j].strip() in ("", "..."):
            j += 1
        if j < len(lines):
            j += 1  # skip the answer line of Q40
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
            if TS_RE.search(l):
                start_idx = max(0, idx - 1)
                break

    tr_lines = lines[start_idx:]

    # Build raw blocks grouped by Part 1..4 and (mm:ss - mm:ss) markers
    cur_part = 1
    part_topics: dict[int, str] = {}
    blocks: list[dict] = []
    cur_start: float | None = None
    cur_end: float | None = None
    cur_buf: list[str] = []
    seen_parts = set()

    def flush_buf():
        nonlocal cur_buf, cur_start, cur_end
        txt = re.sub(r"\s+", " ", " ".join(cur_buf)).strip()
        if txt:
            q_tags = [int(x) for x in re.findall(r"\bQ(\d{1,2})\b", txt)]
            clean_txt = re.sub(r"\bQ\d{1,2}\b\s*", "", txt).strip()
            blocks.append(
                {
                    "part": cur_part,
                    "startTime": cur_start,
                    "endTime": cur_end,
                    "rawText": txt,
                    "text": clean_txt,
                    "qTags": q_tags,
                }
            )
        cur_buf = []
        cur_start = None
        cur_end = None

    for line in tr_lines:
        s = line.strip()
        if not s or s == "...":
            continue
        # Skip standalone title / copy-pasted noise lines
        if re.match(r"^(?:transcrip|transcript|test\s+\d+:?|read the text and answer questions.*|\d{1,2}:\d{2})$", s, re.IGNORECASE):
            continue

        # Check standalone Part/Section header
        pm = PART_HEADER_RE.match(s)
        if pm:
            pnum = parse_part_num(pm.group(1))
            rest = (pm.group(2) or "").strip()
            if pnum != cur_part or pnum not in seen_parts:
                flush_buf()
                cur_part = pnum
                seen_parts.add(pnum)
            if rest:
                if pnum not in part_topics and len(rest) > 15:
                    part_topics[pnum] = rest[:180]
                cur_buf.append(rest)
            continue

        # Inline "You will hear..." topic hint
        if cur_part not in part_topics and "you will hear" in s.lower():
            m_topic = re.search(r"(You will hear[^.!?]+[.!?])", s, re.IGNORECASE)
            if m_topic:
                part_topics[cur_part] = m_topic.group(1)[:180]

        # Check timestamp marker inside line
        tm = TS_RE.search(s)
        if tm:
            before = s[: tm.start()].strip()
            after = s[tm.end() :].strip()
            if before:
                # Could be continuation of previous block or part label
                cur_buf.append(before)
            flush_buf()
            st = int(tm.group(1)) * 60 + int(tm.group(2))
            en = int(tm.group(3)) * 60 + int(tm.group(4))
            cur_start = float(st)
            cur_end = float(max(en, st + 1))
            if after:
                cur_buf.append(after)
        else:
            cur_buf.append(s)

    flush_buf()

    # Handle timestamp resets (e.g. Vol 7 Test 11 where each Part starts at 0:00)
    if has_timestamps and normalize_resets:
        offset = 0.0
        prev_raw_start = 0.0
        prev_adj_end = 0.0
        for b in blocks:
            if b["startTime"] is None:
                continue
            if b["startTime"] + 5.0 < prev_raw_start:
                offset = prev_adj_end
            prev_raw_start = b["startTime"]
            b["startTime"] = round(b["startTime"] + offset, 2)
            b["endTime"] = round(b["endTime"] + offset, 2)
            prev_adj_end = b["endTime"]
        # Scale gently to audioDurationSec if max exceeds or differs notably
        max_end = max((b["endTime"] or 0.0) for b in blocks) if blocks else audio_duration
        if max_end > 0 and abs(max_end - audio_duration) > 15:
            ratio = audio_duration / max_end
            for b in blocks:
                if b["startTime"] is not None:
                    b["startTime"] = round(b["startTime"] * ratio, 2)
                    b["endTime"] = round(b["endTime"] * ratio, 2)

    # For tests without timestamps (Vol 8) or any untimed block, assign proportional times
    if not has_timestamps:
        # Leave intro ~15s, distribute linearly by char count across audio_duration
        total_chars = sum(max(len(b["text"]), 12) for b in blocks) or 1
        cursor = 0.0
        usable = max(audio_duration - 2.0, 60.0)
        for b in blocks:
            w = max(len(b["text"]), 12) / total_chars
            dur = max(w * usable, 1.5)
            b["startTime"] = round(cursor, 2)
            b["endTime"] = round(min(audio_duration, cursor + dur), 2)
            cursor = b["endTime"]
    else:
        # Fill any missing startTime/endTime at start/middle
        for idx, b in enumerate(blocks):
            if b["startTime"] is None:
                prev_end = blocks[idx - 1]["endTime"] if idx > 0 and blocks[idx - 1]["endTime"] is not None else 0.0
                next_start = None
                for k in range(idx + 1, len(blocks)):
                    if blocks[k]["startTime"] is not None:
                        next_start = blocks[k]["startTime"]
                        break
                if next_start is None:
                    next_start = min(audio_duration, prev_end + 8.0)
                b["startTime"] = round(prev_end, 2)
                b["endTime"] = round(max(prev_end + 1.0, next_start), 2)

    # Build Short dictation segments (3-10s target) and Long segments (20-45s target)
    short_segments: list[dict] = []
    seg_idx = 0
    for b in blocks:
        st = float(b["startTime"] or 0.0)
        en = float(b["endTime"] or (st + 3.0))
        if en <= st:
            en = st + 1.5
        dur = en - st
        pieces = split_sentences_for_short_dictation(b["rawText"], keep_qtags=True)
        if not pieces:
            continue
        # If block <= 11s and <= 2 sentences, keep as 1 crisp short segment; otherwise subdivide proportionally
        if dur <= 10.5 and len(pieces) <= 2:
            sub_list = [b["rawText"]]
        else:
            # Group very tiny pieces (< 22 chars) with neighbor so segments stay natural (3-10s)
            sub_list = []
            buf = ""
            for p in pieces:
                cand = f"{buf} {p}".strip() if buf else p
                est_sec = dur * (len(cand) / max(len(b["rawText"]), 1))
                if buf and (len(cand) > 95 or est_sec > 8.5):
                    sub_list.append(buf)
                    buf = p
                else:
                    buf = cand
            if buf:
                sub_list.append(buf)

        cleaned_subs = []
        for raw_sub in sub_list:
            q_tags_sub = [int(x) for x in re.findall(r"\bQ(\d{1,2})\b", raw_sub)]
            clean_sub = re.sub(r"\bQ\d{1,2}\b\s*", "", raw_sub).strip()
            if clean_sub:
                cleaned_subs.append((clean_sub, q_tags_sub))

        tot_c = sum(max(len(s), 1) for s, _ in cleaned_subs) or 1
        cur_t = st
        for j, (sub_txt, sub_qtags) in enumerate(cleaned_subs):
            frac = max(len(sub_txt), 1) / tot_c
            sub_end = en if j == len(cleaned_subs) - 1 else round(cur_t + dur * frac, 2)
            if sub_end <= cur_t:
                sub_end = round(cur_t + 0.8, 2)
            seg_idx += 1
            short_segments.append(
                {
                    "id": f"seg-{seg_idx:03d}",
                    "part": b["part"],
                    "startTime": round(cur_t, 2),
                    "endTime": round(min(audio_duration, sub_end), 2),
                    "text": sub_txt,
                    "timestampSource": "exact" if has_timestamps else "estimated",
                    "qTags": sub_qtags,
                    "blockText": b["rawText"],
                }
            )
            cur_t = sub_end

    # Build Long segments (3-5 short segments, ~20-45s per segment, staying within same Part)
    long_segments: list[dict] = []
    i = 0
    long_idx = 0
    while i < len(short_segments):
        part = short_segments[i]["part"]
        start_t = short_segments[i]["startTime"]
        group = [short_segments[i]]
        j = i + 1
        while j < len(short_segments) and short_segments[j]["part"] == part:
            next_end = short_segments[j]["endTime"]
            span = next_end - start_t
            if len(group) >= 5 or (len(group) >= 3 and span >= 24.0) or span > 42.0:
                break
            group.append(short_segments[j])
            j += 1
        long_idx += 1
        long_segments.append(
            {
                "id": f"long-{long_idx:03d}",
                "part": part,
                "startTime": group[0]["startTime"],
                "endTime": group[-1]["endTime"],
                "text": " ".join(g["text"] for g in group),
                "segmentIds": [g["id"] for g in group],
                "timestampSource": "exact" if has_timestamps else "estimated",
            }
        )
        i = j

    # Build Part 1-4 metadata
    parts_meta = []
    for p in range(1, 5):
        p_segs = [s for s in short_segments if s["part"] == p]
        p_st = p_segs[0]["startTime"] if p_segs else round((p - 1) * audio_duration / 4, 2)
        p_en = p_segs[-1]["endTime"] if p_segs else round(p * audio_duration / 4, 2)
        q_start = (p - 1) * 10 + 1
        q_end = p * 10
        parts_meta.append(
            {
                "partNumber": p,
                "title": f"Part {p}",
                "questionRange": [q_start, q_end],
                "startTime": p_st,
                "endTime": p_en,
                "topicHint": part_topics.get(p, f"Section {p} (Questions {q_start}-{q_end})"),
            }
        )

    return parts_meta, short_segments, long_segments


def extract_exam_prompts(exam_text: str) -> dict[int, dict]:
    """Extract per-question prompt snippets and MCQ options (A/B/C/...) from original exam text."""
    lines = [l.strip() for l in exam_text.splitlines() if l.strip()]
    # Split by SECTION / PART 1-4
    part_texts: dict[int, list[str]] = {1: [], 2: [], 3: [], 4: []}
    cur_p = 1
    for l in lines:
        m = re.match(r"^(?:SECTION|PART)\s+([1-4])\b", l, re.IGNORECASE)
        if m:
            cur_p = int(m.group(1))
            continue
        part_texts[cur_p].append(l)

    prompts: dict[int, dict] = {}
    for p in range(1, 5):
        ptxt = "\n".join(part_texts[p])
        q_start, q_end = (p - 1) * 10 + 1, p * 10
        for q in range(q_start, q_end + 1):
            # Look for question number marker or blank marker like "1........" or "21 What..."
            pat = re.compile(rf"(?:^|\n|\s)(?:{q}(?:\s*[-–,]\s*\d+)?)(?=[\s.…_A-Za-z])")
            matches = list(pat.finditer(ptxt))
            # Filter out ranges like "Questions 1-10" or "Questions 11-16"
            chosen = None
            for m in matches:
                ctx_before = ptxt[max(0, m.start() - 18) : m.start()].lower()
                if "question" in ctx_before or "part" in ctx_before or "section" in ctx_before:
                    continue
                chosen = m
                break
            if chosen:
                s_pos = max(0, chosen.start() - 60)
                e_pos = min(len(ptxt), chosen.end() + 260)
                snippet = re.sub(r"\s+", " ", ptxt[s_pos:e_pos]).strip()
            else:
                snippet = ""
            # Extract option lines A. / B. / C. inside snippet if MCQ
            opts: dict[str, str] = {}
            for om in re.finditer(r"\b([A-I])[\.\)]\s*([^\nA-I]{3,90}?)(?=\s+[A-I][\.\)]|\s+\d{1,2}\s|$)", snippet):
                opts[om.group(1)] = om.group(2).strip()
            prompts[q] = {"snippet": snippet, "options": opts}
    return prompts


def tokenize(txt: str) -> set[str]:
    stop = {
        "the", "and", "for", "that", "with", "this", "from", "you", "are", "was", "were",
        "have", "has", "had", "will", "would", "can", "could", "not", "but", "they", "their",
        "there", "about", "what", "which", "when", "where", "how", "who", "into", "more",
        "some", "any", "all", "your", "our", "one", "two", "three", "write", "words", "word",
        "number", "answer", "each", "questions", "question", "complete", "choose", "correct",
    }
    words = re.findall(r"[a-z]{3,}", txt.lower())
    return {w for w in words if w not in stop}


def align_questions_to_transcript(
    vol: int,
    test_num: int,
    qkeys: dict[int, dict],
    short_segments: list[dict],
    prompts: dict[int, dict],
) -> list[dict]:
    """
    Monotonic alignment per Part (10 questions -> transcript segments of that Part).
    Uses exact Q-tags (Vol 7 T11), exact answer matches, option-text matches, and prompt keyword overlap.
    """
    questions_out: list[dict] = []

    for part_num in range(1, 5):
        q_start, q_end = (part_num - 1) * 10 + 1, part_num * 10
        segs = [s for s in short_segments if s["part"] == part_num]
        if not segs:
            segs = short_segments

        # Build score matrix [10][len(segs)]
        n_q = 10
        n_s = len(segs)
        scores = [[0.0] * n_s for _ in range(n_q)]

        for qi in range(n_q):
            q_num = q_start + qi
            kinfo = qkeys[q_num]
            pinfo = prompts.get(q_num, {"snippet": "", "options": {}})
            ptokens = tokenize(pinfo["snippet"])
            canon = kinfo["canonicalAnswer"]
            accepted = kinfo["acceptedAnswers"]

            # Determine target lexical clues for scoring (including spoken date/number forms)
            num_words = {
                "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
                "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
                "15": "fifteen", "20": "twenty", "25": "twenty-five", "30": "thirty",
                "40": "forty", "50": "fifty", "60": "sixty", "65": "sixty-five", "80": "eighty",
            }
            answer_clues: list[str] = []
            for a in accepted:
                al = a.lower().strip()
                if len(al) >= 2 and not re.fullmatch(r"[a-i]", al):
                    answer_clues.append(al)
                    if al in num_words:
                        answer_clues.append(num_words[al])
                    m_date = re.match(r"^(\d{1,2}(?:st|nd|rd|th)?)\s+([a-z]+)$", al)
                    if m_date:
                        d_part, m_part = m_date.group(1), m_date.group(2)
                        answer_clues.append(f"{d_part} of {m_part}")
                        answer_clues.append(f"{m_part} {d_part}")
                elif re.fullmatch(r"[A-I]", a) and a in pinfo["options"]:
                    answer_clues.append(pinfo["options"][a].lower())

            for si, seg in enumerate(segs):
                seg_l = seg["text"].lower()
                blk_l = seg.get("blockText", seg["text"]).lower()
                sc = 0.0

                # 1. Explicit Q-tag in transcript (Vol 7 T11)
                if q_num in seg.get("qTags", []):
                    sc += 80.0
                elif q_num in [int(x) for x in re.findall(r"\bQ(\d{1,2})\b", seg.get("blockText", ""))]:
                    sc += 45.0

                # 2. Direct match of accepted answer words/numbers
                for clue in answer_clues:
                    if re.search(rf"(?<!\w){re.escape(clue)}(?!\w)", seg_l):
                        sc += 28.0
                    elif clue in seg_l:
                        sc += 18.0
                    else:
                        # Stem / word overlap for multi-word option phrases
                        ctoks = tokenize(clue)
                        if ctoks:
                            hits = sum(1 for w in ctoks if w in seg_l)
                            sc += (hits / len(ctoks)) * 16.0

                # 3. Prompt context keyword overlap
                if ptokens:
                    stoks = tokenize(seg_l)
                    overlap = len(ptokens & stoks)
                    sc += min(overlap * 2.5, 10.0)

                # 4. Gentle monotonic prior (expected relative position in Part)
                expected_pos = (qi + 0.5) / n_q
                actual_pos = (si + 0.5) / max(n_s, 1)
                sc -= abs(expected_pos - actual_pos) * 4.5
                # Slight penalty for intro instructions ("you have some time to look at questions")
                if "some time to look at" in blk_l or "end of part" in blk_l or "end of section" in blk_l:
                    sc -= 12.0

                scores[qi][si] = sc

        # Monotonic DP: pick non-decreasing segment indices s[0] <= s[1] <= ... <= s[9]
        dp = [[-1e9] * n_s for _ in range(n_q)]
        parent = [[0] * n_s for _ in range(n_q)]
        for si in range(n_s):
            dp[0][si] = scores[0][si]
        for qi in range(1, n_q):
            best_prev = -1e9
            best_idx = 0
            for si in range(n_s):
                if dp[qi - 1][si] > best_prev:
                    best_prev = dp[qi - 1][si]
                    best_idx = si
                dp[qi][si] = best_prev + scores[qi][si]
                parent[qi][si] = best_idx

        chosen_idx = [0] * n_q
        last_best = max(range(n_s), key=lambda si: dp[n_q - 1][si])
        chosen_idx[n_q - 1] = last_best
        for qi in range(n_q - 1, 0, -1):
            chosen_idx[qi - 1] = parent[qi][chosen_idx[qi]]

        # Build detailed question objects
        for qi in range(n_q):
            q_num = q_start + qi
            si = chosen_idx[qi]
            seg = segs[si]
            # Expand evidence window cleanly (include adjacent short seg if very short <25 chars)
            window_segs = [seg]
            if len(seg["text"]) < 55 and si + 1 < n_s:
                window_segs.append(segs[si + 1])
            elif si > 0 and any(m in segs[si - 1]["text"].lower() for m in ("actually", "sorry", "but", "however")):
                window_segs.insert(0, segs[si - 1])

            ev_quote = " ".join(w["text"] for w in window_segs).strip()
            ev_start = window_segs[0]["startTime"]
            ev_end = window_segs[-1]["endTime"]

            kinfo = qkeys[q_num]
            pinfo = prompts.get(q_num, {"snippet": "", "options": {}})

            # Detect verified paraphrases between prompt snippet and evidence quote
            p_lower = pinfo["snippet"].lower()
            e_lower = ev_quote.lower()
            found_paraphrases = []
            for p_word, syns in PARAPHRASE_PAIRS:
                in_p = re.search(rf"\b{re.escape(p_word)}\b", p_lower)
                matched_syn = next((sy for sy in syns if re.search(rf"\b{re.escape(sy)}\b", e_lower)), None)
                if in_p and matched_syn:
                    found_paraphrases.append({"questionTerm": p_word, "audioTerm": matched_syn})
                else:
                    # Also check reverse direction (synonym in prompt, base word in audio)
                    syn_in_p = next((sy for sy in syns if re.search(rf"\b{re.escape(sy)}\b", p_lower)), None)
                    if syn_in_p and re.search(rf"\b{re.escape(p_word)}\b", e_lower):
                        found_paraphrases.append({"questionTerm": syn_in_p, "audioTerm": p_word})
                if len(found_paraphrases) >= 3:
                    break

            # Detect verified distractors inside evidence quote
            found_distractors = []
            for marker, note in DISTRACTOR_MARKERS:
                if marker in e_lower:
                    found_distractors.append(note)
                if len(found_distractors) >= 2:
                    break

            # Detect competing numbers/dates in evidence if answer is numeric/date
            if re.search(r"\d", kinfo["canonicalAnswer"]):
                nums_in_ev = re.findall(r"\b\d+(?:[.:]\d+)?\b", ev_quote)
                other_nums = [n for n in nums_in_ev if n not in kinfo["canonicalAnswer"]]
                if other_nums and not found_distractors:
                    found_distractors.append(
                        f"Có số gây nhiễu ({', '.join(other_nums[:2])}) xuất hiện sát đáp án chuẩn '{kinfo['canonicalAnswer']}'."
                    )

            # Build factual, natural Vietnamese explanation
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


def build_vocab_core() -> list[dict]:
    """Curated core IELTS Listening vocabulary cards across 4 categories (160 entries)."""
    entries = [
        # 1. Dates, Times & Numbers (dates_numbers)
        ("January", "/ˈdʒænjuəri/", "noun", "Tháng 1", "The course starts on 12th January.", "Viết hoa chữ cái đầu; 12 January / 12th January đều hợp lệ.", "Hay sai thiếu chữ u: Januray", "dates_numbers"),
        ("February", "/ˈfebruəri/", "noun", "Tháng 2", "Applications close on 25th February.", "Dễ mất chữ 'r' đầu tiên khi nghe nhanh.", "Hay viết nhầm Febuary (thiếu r)", "dates_numbers"),
        ("Wednesday", "/ˈwenzdeɪ/", "noun", "Thứ Tư", "The museum stays open late on Wednesday.", "Âm 'd' đầu câm khi đọc nhanh.", "Hay sai Wensday / Wendsday", "dates_numbers"),
        ("Thursday", "/ˈθɜːzdeɪ/", "noun", "Thứ Năm", "Lectures are scheduled every Thursday.", "Chú ý phân biệt với Tuesday (/ˈtjuːzdeɪ/).", "Nghe nhầm Tuesday / Thursday", "dates_numbers"),
        ("Tuesday", "/ˈtjuːzdeɪ/", "noun", "Thứ Ba", "Please confirm your booking by Tuesday.", "Phát âm nhấn /tjuː/ ở giọng Anh.", "Nghe nhầm Thursday", "dates_numbers"),
        ("September", "/sepˈtembə(r)/", "noun", "Tháng 9", "The festival takes place in September.", "Không viết tắt Sept khi đề yêu cầu viết đầy đủ.", "Hay ghi nhầm Septemper", "dates_numbers"),
        ("October", "/ɒkˈtəʊbə(r)/", "noun", "Tháng 10", "The deadline is 15th October.", "Đọc dạng ngày + tháng hoặc tháng + ngày đều chuẩn.", "Hay sai Octorber", "dates_numbers"),
        ("November", "/nəʊˈvembə(r)/", "noun", "Tháng 11", "The lease begins on 1 November.", "Lưu ý viết đủ ký tự nếu giới hạn ONE WORD.", "Viết tắt Nov có thể bị trừ ở một số hệ thống", "dates_numbers"),
        ("fortnight", "/ˈfɔːtnaɪt/", "noun", "Hai tuần (14 ngày)", "The rental runs for a fortnight.", "Paraphrase của 'two weeks' hoặc '14 days'.", "Hay viết sai fort-night / fourtnight", "dates_numbers"),
        ("decade", "/ˈdekeɪd/", "noun", "Thập kỷ (10 năm)", "Traffic doubled over the last decade.", "Paraphrase thường gặp của 'ten years'.", "Hay nhầm với decayed", "dates_numbers"),
        ("century", "/ˈsentʃəri/", "noun", "Thế kỷ (100 năm)", "The bridge dates back to the 19th century.", "Thường gặp trong Part 4 lịch sử.", "Hay sai chính tả centery", "dates_numbers"),
        ("quarter", "/ˈkwɔːtə(r)/", "noun", "Một phần tư / 15 phút", "The bus arrives at a quarter past nine.", "A quarter = 25% hoặc 15 phút giờ.", "Hay quên chữ 'r' đầu: quater", "dates_numbers"),
        ("double", "/ˈdʌbl/", "adj/verb", "Gấp đôi / phòng đôi", "We reserved a double room overlooking the park.", "Trong Part 1 hay đi với 'double room' hoặc đọc số điện thoại 'double five'.", "Nghe 'double 7' phải ghi 77", "dates_numbers"),
        ("triple", "/ˈtrɪpl/", "adj", "Gấp ba", "Check the triple digit code at the entrance.", "Khi đọc số điện thoại có thể nói 'triple zero' (000).", "Hay ghi nhầm thành 2 số", "dates_numbers"),
        ("dozen", "/ˈdʌzn/", "noun", "Một tá (12 cái)", "They ordered two dozen chairs for the hall.", "Paraphrase cho số lượng 12.", "Hay thêm 's' sai sau số đếm (two dozen, không phải dozens)", "dates_numbers"),
        ("minimum", "/ˈmɪnɪməm/", "noun/adj", "Tối thiểu", "The minimum stay is three nights.", "Paraphrase của 'at least'.", "Hay sai số lượng chữ 'm' và 'n': minium", "dates_numbers"),
        ("maximum", "/ˈmæksɪməm/", "noun/adj", "Tối đa", "The maximum capacity is 40 visitors.", "Paraphrase của 'up to' hoặc 'no more than'.", "Hay viết nhầm maxium", "dates_numbers"),
        ("approximately", "/əˈprɒksɪmətli/", "adv", "Khoảng chừng, xấp xỉ", "The journey takes approximately 40 minutes.", "Paraphrase của 'about', 'around', 'roughly'.", "Hay thiếu chữ 'p' thứ hai: aproximately", "dates_numbers"),
        ("discount", "/ˈdɪskaʊnt/", "noun", "Giảm giá, chiết khấu", "Students receive a 15% discount online.", "Paraphrase của 'reduced price', 'cheaper', 'concession'.", "Hay ghi nhầm discout", "dates_numbers"),
        ("deposit", "/dɪˈpɒzɪt/", "noun", "Tiền đặt cọc", "You need to pay a £50 deposit in advance.", "Thường đi kèm các bẫy 'refundable' hay 'non-refundable'.", "Hay viết nhầm deposite", "dates_numbers"),
        ("receipt", "/rɪˈsiːt/", "noun", "Biên lai, hóa đơn", "Keep your receipt in case you need a refund.", "Chữ 'p' là âm câm hoàn toàn.", "Hay thiếu p: reciept / receit", "dates_numbers"),
        ("refund", "/ˈriːfʌnd/", "noun", "Tiền hoàn lại", "Full refunds are offered until Friday.", "Paraphrase của 'money back'.", "Hay nhầm trọng âm danh từ/động từ", "dates_numbers"),
        ("budget", "/ˈbʌdʒɪt/", "noun", "Ngân sách", "We are working on a tight budget this year.", "Paraphrase của 'funds', 'available money'.", "Hay thiếu chữ 'd': buget", "dates_numbers"),
        ("annual", "/ˈænjuəl/", "adj", "Hàng năm", "The annual membership fee is £65.", "Paraphrase của 'yearly', 'every year'.", "Hay thiếu một chữ 'n': anual", "dates_numbers"),
        ("schedule", "/ˈʃedjuːl/", "noun", "Lịch trình", "Check the timetable for any schedule changes.", "Paraphrase của 'timetable', 'itinerary'.", "Hay viết nhầm shedule", "dates_numbers"),
        ("calendar", "/ˈkælɪndə(r)/", "noun", "Lịch", "Mark the exhibition dates on your calendar.", "Đuôi là '-ar', không phải '-er'.", "Hay viết sai calender", "dates_numbers"),
        ("deadline", "/ˈdedlaɪn/", "noun", "Hạn chót", "The submission deadline is 29 May.", "Paraphrase của 'closing date', 'last day'.", "Hay viết tách thành dead line khi đề cần ONE WORD", "dates_numbers"),
        ("duration", "/djʊˈreɪʃn/", "noun", "Khoảng thời gian", "The duration of the tour is three hours.", "Paraphrase của 'length of time', 'how long'.", "Hay viết nhầm durasion", "dates_numbers"),
        ("eighteen", "/ˌeɪˈtiːn/", "num", "Số 18", "Applicants must be over eighteen.", "Nhấn âm hai (-teen), kéo dài /iːn/.", "Dễ nghe nhầm với eighty (80)", "dates_numbers"),
        ("eighty", "/ˈeɪti/", "num", "Số 80", "Weekly rent is £80 including bills.", "Nhấn âm đầu (eigh-ty).", "Dễ nghe nhầm với eighteen (18)", "dates_numbers"),
        ("fourteen", "/ˌfɔːˈtiːn/", "num", "Số 14", "There are fourteen cabins on site.", "Nhấn âm hai (-teen).", "Dễ nhầm với forty (40)", "dates_numbers"),
        ("forty", "/ˈfɔːti/", "num", "Số 40", "The lecture lasts forty minutes.", "KHÔNG có chữ 'u' trong cách viết chuẩn hiện đại.", "Hay viết thừa 'u': fourty", "dates_numbers"),
        ("accommodation", "/əˌkɒməˈdeɪʃn/", "noun", "Chỗ ở", "The price covers meals and accommodation.", "Từ kinh điển xuất hiện cực nhiều ở Part 1.", "Hay thiếu một 'c' hoặc một 'm': accomodation", "dates_numbers"),
        ("insurance", "/ɪnˈʃʊərəns/", "noun", "Bảo hiểm", "Inform your insurance company before departure.", "Thường gặp ở phần đặt tour/thuê xe Part 1.", "Hay viết sai insurence", "dates_numbers"),
        ("postcode", "/ˈpəʊstkəʊd/", "noun", "Mã bưu điện", "The postcode for the venue is SH12 1LQ.", "Khi đọc mã bưu điện thường đánh vần từng chữ cái và số.", "Nghe nhầm chữ cái tương tự như G/J, B/P, M/N", "dates_numbers"),
        ("extension", "/ɪkˈstenʃn/", "noun", "Số máy nhánh / gia hạn", "Ask for extension 304 when you call.", "Paraphrase của 'more time' (Part 3) hoặc số máy nội bộ (Part 1).", "Hay viết nhầm extention", "dates_numbers"),
        ("percentage", "/pəˈsentɪdʒ/", "noun", "Tỷ lệ phần trăm", "Only a small percentage chose the online option.", "Đi với số liệu thống kê Part 3–4.", "Hay viết sai persentage", "dates_numbers"),
        ("average", "/ˈævərɪdʒ/", "noun/adj", "Trung bình", "Average attendance rose by 20 percent.", "Paraphrase của 'typical', 'mean'.", "Hay mất âm giữa: avrage", "dates_numbers"),
        ("half", "/hɑːf/", "noun/det", "Một nửa (50%)", "Half of the water is recycled.", "Paraphrase của '50 percent', 'one in two'.", "Âm 'l' câm dễ bỏ sót khi nghe nhanh", "dates_numbers"),
        ("thousand", "/ˈθaʊznd/", "num", "Nghìn (1,000)", "Around 14,000 people attended the concert.", "Lưu ý viết 14,000 hoặc 14000 đều hợp lệ.", "Hay viết sai thousend", "dates_numbers"),

        # 2. Places, Directions & Maps Part 1-2 (places_maps)
        ("corridor", "/ˈkɒrɪdɔː(r)/", "noun", "Hành lang", "Walk straight down the main corridor.", "Thường dùng mô tả đường đi trên Map Part 2.", "Hay viết nhầm coridor (thiếu r)", "places_maps"),
        ("intersection", "/ˌɪntəˈsekʃn/", "noun", "Ngã tư, giao lộ", "Turn right at the second intersection.", "Paraphrase của 'crossroads', 'junction'.", "Hay viết nhầm intercection", "places_maps"),
        ("junction", "/ˈdʒʌŋkʃn/", "noun", "Ngã ba / điểm giao", "The café sits just past the junction.", "Paraphrase của 'corner', 'where two roads meet'.", "Hay sai juncion", "places_maps"),
        ("roundabout", "/ˈraʊndəbaʊt/", "noun", "Bùng binh, vòng xoay", "Take the second exit at the roundabout.", "Chi tiết quan trọng xác định vị trí trên bản đồ.", "Hay tách thành round about", "places_maps"),
        ("adjacent", "/əˈdʒeɪsnt/", "adj", "Liền kề, kế bên", "The archive room is adjacent to the lobby.", "Paraphrase của 'next to', 'beside'.", "Hay viết nhầm adjecent", "places_maps"),
        ("opposite", "/ˈɒpəzɪt/", "prep", "Đối diện", "The ticket booth is opposite the main gate.", "Paraphrase của 'facing', 'across from'.", "Hay viết sai oposite", "places_maps"),
        ("entrance", "/ˈentrəns/", "noun", "Lối vào", "Meet your guide at the north entrance.", "Thường có bẫy giữa 'main entrance' và 'side entrance'.", "Hay viết sai enterance", "places_maps"),
        ("exit", "/ˈeksɪt/", "noun", "Lối ra", "The emergency exit is behind the stage.", "Thường dùng làm điểm mốc cuối bản đồ.", "Nghe nhầm với 'access'", "places_maps"),
        ("reception", "/rɪˈsepʃn/", "noun", "Quầy lễ tân", "Leave your bags at reception before touring.", "Điểm xuất phát phổ biến trong câu hỏi Map.", "Hay viết nhầm reseption", "places_maps"),
        ("car park", "/ˈkɑː pɑːk/", "noun", "Bãi đỗ xe", "The bicycle shed is beside the car park.", "Paraphrase của 'parking lot', 'parking area'.", "Chú ý giới hạn 1 từ hay 2 từ (parking / car park)", "places_maps"),
        ("pavilion", "/pəˈvɪliən/", "noun", "Nhà rạp, gian trưng bày", "Refreshments are served inside the pavilion.", "Xuất hiện thường xuyên ở bản đồ công viên, triển lãm.", "Hay viết thừa 'l': pavillion", "places_maps"),
        ("courtyard", "/ˈkɔːtjɑːd/", "noun", "Sân trong", "Tables are set out in the central courtyard.", "Paraphrase của 'open square inside a building'.", "Hay viết sai courtyad", "places_maps"),
        ("balcony", "/ˈbælkəni/", "noun", "Ban công", "The flat has a small balcony overlooking the river.", "Từ vựng nhà ở hay gặp trong Part 1.", "Hay viết sai balcany", "places_maps"),
        ("garage", "/ˈɡærɑːʒ/", "noun", "Nhà để xe", "You can park your car in the garage.", "Giọng Anh nhấn âm đầu, giọng Mỹ nhấn âm hai.", "Hay viết nhầm gararge", "places_maps"),
        ("basement", "/ˈbeɪsmənt/", "noun", "Tầng hầm", "Storage lockers are located in the basement.", "Paraphrase của 'downstairs below ground'.", "Hay viết sai basment", "places_maps"),
        ("fountain", "/ˈfaʊntɪn/", "noun", "Đài phun nước", "Turn left just past the stone fountain.", "Vật mốc trung tâm quen thuộc trong bản đồ công viên.", "Hay viết sai fountian", "places_maps"),
        ("bridge", "/brɪdʒ/", "noun", "Cây cầu", "Cross the wooden bridge to reach the orchard.", "Chú ý xem người nói có đi qua cầu hay dừng trước cầu.", "Hay thiếu 'd': brige", "places_maps"),
        ("footpath", "/ˈfʊtpɑːθ/", "noun", "Lối đi bộ", "Follow the narrow footpath along the lake.", "Paraphrase của 'walking track', 'trail', 'pedestrian path'.", "Hay nhầm với 'cycle path'", "places_maps"),
        ("stadium", "/ˈsteɪdiəm/", "noun", "Sân vận động", "The new sports stadium is north of the canal.", "Thường dùng trong bài giới thiệu cơ sở vật chất thị trấn.", "Hay viết nhầm stadeum", "places_maps"),
        ("auditorium", "/ˌɔːdɪˈtɔːriəm/", "noun", "Khán phòng", "The auditorium seats over 500 guests.", "Paraphrase của 'concert hall', 'lecture theatre'.", "Hay viết sai auditoriam", "places_maps"),
        ("gallery", "/ˈɡæləri/", "noun", "Phòng trưng bày", "Local paintings hang in the upper gallery.", "Hay gặp trong Part 2 bảo tàng.", "Hay thiếu một chữ 'l': galery", "places_maps"),
        ("exhibition", "/ˌeksɪˈbɪʃn/", "noun", "Cuộc triển lãm", "A temporary exhibition opens next week.", "Paraphrase của 'display', 'show'.", "Hay quên chữ 'h': exibition", "places_maps"),
        ("museum", "/mjuˈziːəm/", "noun", "Bảo tàng", "Entry to the maritime museum is free.", "Từ xuất hiện lặp lại ở cả Part 1 và Part 2.", "Hay viết nhầm musuem", "places_maps"),
        ("library", "/ˈlaɪbrəri/", "noun", "Thư viện", "Quiet study desks are behind the library.", "Đọc nhanh dễ nuốt âm 'r' đầu.", "Hay thiếu 'r' đầu: libary", "places_maps"),
        ("canteen", "/kænˈtiːn/", "noun", "Nhà ăn, căng tin", "Staff eat lunch in the ground-floor canteen.", "Paraphrase của 'cafeteria', 'dining hall'.", "Hay viết sai cantene", "places_maps"),
        ("workshop", "/ˈwɜːkʃɒp/", "noun", "Xưởng thực hành / hội thảo", "Pottery classes run in the craft workshop.", "Vừa có nghĩa phòng xưởng vừa có nghĩa buổi học chuyên đề.", "Hay viết sai workship", "places_maps"),
        ("warehouse", "/ˈweəhaʊs/", "noun", "Nhà kho", "Old machinery is stored in the brick warehouse.", "Thường dùng ở bản đồ khu công nghiệp cải tạo.", "Hay viết nhầm warehourse", "places_maps"),
        ("harbour", "/ˈhɑːbə(r)/", "noun", "Bến cảng", "Boats depart hourly from the harbour.", "Chấp nhận cả biến thể Anh (harbour) và Mỹ (harbor).", "Hay viết sai habour", "places_maps"),
        ("suburb", "/ˈsʌbɜːb/", "noun", "Vùng ngoại ô", "New shopping malls opened in the suburbs.", "Paraphrase của 'outskirts', 'outside the city centre'.", "Hay viết sai suburd", "places_maps"),
        ("pedestrian", "/pəˈdestriən/", "noun/adj", "Người đi bộ", "The town square is now a pedestrian zone.", "Paraphrase của 'people on foot', 'walkers'.", "Hay viết sai pedestrain", "places_maps"),
        ("cliff", "/klɪf/", "noun", "Vách đá", "Keep away from the edge of the cliff.", "Từ địa hình trong bài hướng dẫn đi bộ / cắm trại.", "Hay thiếu một 'f': clif", "places_maps"),
        ("waterfall", "/ˈwɔːtəfɔːl/", "noun", "Thác nước", "We will stop for lunch near the waterfall.", "Hay gặp ở Part 1–2 về du lịch sinh thái.", "Hay viết sai waterfal", "places_maps"),
        ("campsite", "/ˈkæmpsaɪt/", "noun", "Khu cắm trại", "Showers are at the far end of the campsite.", "Paraphrase của 'camping area', 'tent field'.", "Chú ý viết liền hay tách tùy đề", "places_maps"),
        ("fence", "/fens/", "noun", "Hàng rào", "Plant shrubs along the wooden fence.", "Mốc phân ranh giới trên sơ đồ vườn/nông trại.", "Hay viết sai fense", "places_maps"),
        ("hedge", "/hedʒ/", "noun", "Hàng rào cây xanh", "The pond lies behind a tall hedge.", "Rất hay xuất hiện trong Map khu vườn/công viên.", "Hay viết thiếu 'd': hege", "places_maps"),
        ("pond", "/pɒnd/", "noun", "Ao nước", "Ducks nest around the small pond.", "Phân biệt với 'lake' (hồ lớn).", "Hay nghe nhầm với 'pound'", "places_maps"),
        ("orchard", "/ˈɔːtʃəd/", "noun", "Vườn cây ăn quả", "Apple juice is pressed beside the orchard.", "Thường xuất hiện ở bản đồ nông trại.", "Hay viết sai ochard", "places_maps"),
        ("souvenir", "/ˌsuːvəˈnɪə(r)/", "noun", "Quà lưu niệm", "Pick up postcards at the souvenir shop.", "Hay đọc /suːvəˈnɪə/, viết khó.", "Hay viết sai souvenier / suvenir", "places_maps"),
        ("facility", "/fəˈsɪləti/", "noun", "Tiện nghi, cơ sở vật chất", "Sports facilities are open until 10 p.m.", "Số nhiều 'facilities' dùng cực phổ biến.", "Hay viết sai facillity", "places_maps"),
        ("noticeboard", "/ˈnəʊtɪsbɔːd/", "noun", "Bảng thông báo", "Event updates are pinned on the noticeboard.", "Paraphrase của 'information board'.", "Hay thiếu 'e' ở giữa: noticboard", "places_maps"),

        # 3. Academic Part 3-4 & Spelling Traps (academic_p3_p4)
        ("curriculum", "/kəˈrɪkjələm/", "noun", "Chương trình giảng dạy", "Outdoor learning is part of the school curriculum.", "Từ học thuật kinh điển Part 3–4.", "Hay sai kép 'r': curiculum", "academic_p3_p4"),
        ("methodology", "/ˌmeθəˈdɒlədʒi/", "noun", "Phương pháp luận", "Dr. Lee advised revising the methodology section.", "Paraphrase của 'research methods', 'approach'.", "Hay viết nhầm methology", "academic_p3_p4"),
        ("questionnaire", "/ˌkwestʃəˈneə(r)/", "noun", "Bảng câu hỏi khảo sát", "They distributed a questionnaire to 200 shoppers.", "Cực hay sai chính tả trong Part 3.", "Hay thiếu một 'n' hoặc sai đuôi: questionaire", "academic_p3_p4"),
        ("bibliography", "/ˌbɪbliˈɒɡrəfi/", "noun", "Danh mục tài liệu tham khảo", "Check formatting in your bibliography.", "Thường xuất hiện trong phần thảo luận luận văn Part 3.", "Hay viết sai biblography", "academic_p3_p4"),
        ("assessment", "/əˈsesmənt/", "noun", "Sự đánh giá", "Continuous assessment replaced the final exam.", "Paraphrase của 'evaluation', 'grading'.", "Hay thiếu chữ 's': assesment", "academic_p3_p4"),
        ("hypothesis", "/haɪˈpɒθəsɪs/", "noun", "Giả thuyết", "The data failed to support their initial hypothesis.", "Từ nền tảng trong bài giảng khoa học Part 4.", "Hay nhầm với 'hypotheses' (số nhiều)", "academic_p3_p4"),
        ("experiment", "/ɪkˈsperɪmənt/", "noun", "Thí nghiệm", "They repeated the experiment under colder conditions.", "Paraphrase của 'trial', 'test'.", "Hay viết sai expiriment", "academic_p3_p4"),
        ("evidence", "/ˈevɪdəns/", "noun", "Bằng chứng", "Archaeologists found evidence of ancient trade.", "Paraphrase của 'proof', 'findings'.", "Danh từ không đếm được (không thêm 's')", "academic_p3_p4"),
        ("statistics", "/stəˈtɪstɪks/", "noun", "Số liệu thống kê", "Government statistics show a steady decline.", "Paraphrase của 'figures', 'data', 'numbers'.", "Hay viết thiếu 's' hoặc sai statics", "academic_p3_p4"),
        ("analysis", "/əˈnæləsɪs/", "noun", "Sự phân tích", "Further analysis of the soil is needed.", "Chú ý số ít '-sis' vs số nhiều '-ses'.", "Hay viết sai analasis", "academic_p3_p4"),
        ("phenomenon", "/fəˈnɒmɪnən/", "noun", "Hiện tượng", "This weather phenomenon occurs every seven years.", "Số nhiều là 'phenomena'.", "Hay viết sai phenominon", "academic_p3_p4"),
        ("environment", "/ɪnˈvaɪrənmənt/", "noun", "Môi trường", "The project aims to protect the marine environment.", "Từ xuất hiện dày đặc trong Part 4.", "Hay thiếu chữ 'n' trước 'm': enviroment", "academic_p3_p4"),
        ("pollution", "/pəˈluːʃn/", "noun", "Sự ô nhiễm", "Industrial waste caused severe river pollution.", "Phân biệt với 'polluted' (adj) và 'pollutant' (chất gây ô nhiễm).", "Hay viết sai polution (thiếu l)", "academic_p3_p4"),
        ("conservation", "/ˌkɒnsəˈveɪʃn/", "noun", "Sự bảo tồn", "Funding supports wetland conservation.", "Đừng nhầm với 'conversation' (cuộc trò chuyện)!", "Dễ nhầm lẫn chính tả với conversation", "academic_p3_p4"),
        ("ecosystem", "/ˈiːkəʊsɪstəm/", "noun", "Hệ sinh thái", "Coral reefs form a fragile ecosystem.", "Thường xuất hiện cùng 'biodiversity', 'habitat'.", "Hay viết tách eco system", "academic_p3_p4"),
        ("habitat", "/ˈhæbɪtæt/", "noun", "Môi trường sống tự nhiên", "Deforestation destroys wildlife habitat.", "Paraphrase của 'natural home', 'environment'.", "Hay viết sai habittat", "academic_p3_p4"),
        ("species", "/ˈspiːʃiːz/", "noun", "Loài (sinh vật)", "Several bird species migrate here in autumn.", "Số ít và số nhiều đều giữ nguyên 'species'.", "Hay bỏ nhầm chữ 's' cuối", "academic_p3_p4"),
        ("migration", "/maɪˈɡreɪʃn/", "noun", "Sự di cư", "Climate shifts affect seasonal bird migration.", "Chú ý hậu tố danh từ vs 'migrate' / 'migratory'.", "Hay viết nhầm migrashun", "academic_p3_p4"),
        ("extinction", "/ɪkˈstɪŋkʃn/", "noun", "Sự tuyệt chủng", "Overfishing pushed the fish toward extinction.", "Paraphrase của 'die out', 'disappear completely'.", "Hay thiếu 'c': extintion", "academic_p3_p4"),
        ("bacteria", "/bækˈtɪəriə/", "noun", "Vi khuẩn", "Certain bacteria break down oil spills naturally.", "Từ khóa sinh học hay gặp ở Part 4.", "Hay viết sai bacterea", "academic_p3_p4"),
        ("antibiotic", "/ˌæntibaɪˈɒtɪk/", "noun", "Thuốc kháng sinh", "Overuse of antibiotics reduces effectiveness.", "Xuất hiện trong bài giảng y sinh Part 4.", "Hay sai chính tả anti-biotic", "academic_p3_p4"),
        ("fertiliser", "/ˈfɜːtəlaɪzə(r)/", "noun", "Phân bón", "Excess fertiliser washes into nearby streams.", "Chấp nhận cả 'fertiliser' và 'fertilizer'.", "Hay thiếu chữ 'i': fertliser", "academic_p3_p4"),
        ("agriculture", "/ˈæɡrɪkʌltʃə(r)/", "noun", "Nông nghiệp", "Modern agriculture relies heavily on irrigation.", "Paraphrase của 'farming'.", "Hay viết sai agricalture", "academic_p3_p4"),
        ("irrigation", "/ˌɪrɪˈɡeɪʃn/", "noun", "Hệ thống tưới tiêu", "Drip irrigation cuts water waste by half.", "Từ vựng trọng tâm Part 4 chủ đề nước/nông nghiệp.", "Hay thiếu một 'r': irigation", "academic_p3_p4"),
        ("archaeology", "/ˌɑːkiˈɒlədʒi/", "noun", "Khảo cổ học", "Students joined an archaeology dig in July.", "Chấp nhận biến thể Mỹ 'archeology'.", "Hay thiếu chữ 'a' thứ hai: archeaology", "academic_p3_p4"),
        ("architecture", "/ˈɑːkɪtektʃə(r)/", "noun", "Kiến trúc", "The lecture compares Roman and modern architecture.", "Hay gặp trong Part 2 và Part 4.", "Hay viết sai architeture", "academic_p3_p4"),
        ("inscription", "/ɪnˈskrɪpʃn/", "noun", "Chữ khắc (trên đá/kim loại)", "Faint inscriptions revealed the date of manufacture.", "Xuất hiện trong bài nói về cổ vật.", "Hay viết sai incription", "academic_p3_p4"),
        ("excavation", "/ˌekskəˈveɪʃn/", "noun", "Cuộc khai quật", "Heavy rain delayed the excavation work.", "Paraphrase của 'digging up'.", "Hay quên chữ 'c': exavation", "academic_p3_p4"),
        ("mechanism", "/ˈmekənɪzəm/", "noun", "Cơ chế, bộ máy", "Scientists scanned the bronze gear mechanism.", "Paraphrase của 'device', 'system'.", "Hay viết nhầm mechenism", "academic_p3_p4"),
        ("temperature", "/ˈtemprətʃə(r)/", "noun", "Nhiệt độ", "Store the samples at a constant temperature.", "Đọc nhanh mất âm 'a' ở giữa.", "Hay thiếu 'a': temperture", "academic_p3_p4"),
        ("evaporation", "/ɪˌvæpəˈreɪʃn/", "noun", "Sự bay hơi", "Covering the tank slows water evaporation.", "Từ khoa học vật lý/sinh học hay gặp.", "Hay viết nhầm evapouration", "academic_p3_p4"),
        ("oxygen", "/ˈɒksɪdʒən/", "noun", "Khí oxy", "Plants release oxygen during photosynthesis.", "Hay dùng làm từ điền chỗ trống Part 4.", "Hay viết sai oxigen", "academic_p3_p4"),
        ("carbon", "/ˈkɑːbən/", "noun", "Các-bon", "Peat bogs store vast amounts of carbon.", "Thường đi cùng 'carbon footprint', 'carbon dioxide'.", "Hay viết sai cabon", "academic_p3_p4"),
        ("electricity", "/ɪˌlekˈtrɪsəti/", "noun", "Điện năng", "Solar panels generate clean electricity.", "Chú ý đừng nhầm với 'electric' / 'electrical'.", "Hay viết sai eletricity", "academic_p3_p4"),
        ("psychology", "/saɪˈkɒlədʒi/", "noun", "Tâm lý học", "She is majoring in child psychology.", "Âm 'p' đầu câm hoàn toàn.", "Hay quên chữ 'p': sychology", "academic_p3_p4"),
        ("behaviour", "/bɪˈheɪvjə(r)/", "noun", "Hành vi", "The study observed consumer behaviour online.", "Chấp nhận cả 'behaviour' (UK) và 'behavior' (US).", "Hay sai thứ tự 'ou'", "academic_p3_p4"),
        ("motivation", "/ˌməʊtɪˈveɪʃn/", "noun", "Động lực", "Clear feedback improves student motivation.", "Chủ đề giáo dục/quản trị Part 3–4.", "Hay viết sai motivasion", "academic_p3_p4"),
        ("concentration", "/ˌkɒnsnˈtreɪʃn/", "noun", "Sự tập trung", "Background noise breaks concentration.", "Paraphrase của 'focus', 'attention'.", "Hay viết sai consentration", "academic_p3_p4"),
        ("presentation", "/ˌpreznˈteɪʃn/", "noun", "Bài thuyết trình", "Prepare slides for your seminar presentation.", "Từ khóa kinh điển của Part 3.", "Hay viết sai presentasion", "academic_p3_p4"),
        ("dissertation", "/ˌdɪsəˈteɪʃn/", "noun", "Luận văn", "He chose urban transport for his dissertation.", "Paraphrase của 'thesis', 'long research paper'.", "Hay thiếu một chữ 's': disertation", "academic_p3_p4"),
        ("qualification", "/ˌkwɒlɪfɪˈkeɪʃn/", "noun", "Bằng cấp, trình độ chuyên môn", "Teaching requires an additional qualification.", "Paraphrase của 'degree', 'certificate', 'diploma'.", "Hay viết nhầm qualifacation", "academic_p3_p4"),
        ("maintenance", "/ˈmeɪntənəns/", "noun", "Sự bảo trì", "Routine maintenance keeps machines safe.", "Từ bẫy chính tả hàng đầu vì gốc là 'maintain' nhưng danh từ là 'maintEnance'.", "Hay viết nhầm maintainance", "academic_p3_p4"),
        ("guarantee", "/ˌɡærənˈtiː/", "noun/verb", "Bảo hành / đảm bảo", "All bikes come with a two-year guarantee.", "Paraphrase của 'warranty'.", "Hay sai vị trí 'ua': gaurantee", "academic_p3_p4"),
        ("colleague", "/ˈkɒliːɡ/", "noun", "Đồng nghiệp", "Discuss the proposal with a colleague first.", "Paraphrase của 'co-worker', 'workmate'.", "Hay sai đuôi '-eague': colleage", "academic_p3_p4"),
        ("privilege", "/ˈprɪvəlɪdʒ/", "noun", "Đặc quyền", "Library borrowing is a privilege for members.", "Chú ý chính tả không có chữ 'd'.", "Hay viết nhầm priviledge", "academic_p3_p4"),
        ("committee", "/kəˈmɪti/", "noun", "Ủy ban", "The committee approved the new funding.", "Gấp đôi 3 cặp chữ cái: mm, tt, ee.", "Hay thiếu 1 chữ trong mm/tt/ee", "academic_p3_p4"),
        ("independent", "/ˌɪndɪˈpendənt/", "adj", "Độc lập, tự chủ", "Students conduct independent fieldwork.", "Đuôi là '-ent', KHÔNG phải '-ant'.", "Hay viết sai independant", "academic_p3_p4"),
        ("relevant", "/ˈreləvənt/", "adj", "Liên quan, phù hợp", "Include only relevant examples in your talk.", "Ngược lại: 'irrelevant'.", "Hay viết sai relevent", "academic_p3_p4"),
        ("permanent", "/ˈpɜːmənənt/", "adj", "Vĩnh viễn, lâu dài", "Digital files ensure permanent preservation.", "Đối lập với 'temporary' (tạm thời).", "Hay viết sai permenant", "academic_p3_p4"),
        ("temporary", "/ˈtemprəri/", "adj", "Tạm thời", "The gallery is hosting a temporary display.", "Paraphrase của 'short-term', 'for a limited time'.", "Hay thiếu 'a': tempory", "academic_p3_p4"),
        ("sufficient", "/səˈfɪʃnt/", "adj", "Đủ", "Allow sufficient time for questionnaire testing.", "Paraphrase của 'enough', 'adequate'.", "Hay sai 'ff' hoặc 'ci': suficient", "academic_p3_p4"),
        ("efficiency", "/ɪˈfɪʃnsi/", "noun", "Hiệu suất, tính hiệu quả", "Better insulation boosts energy efficiency.", "Thường đi với 'cost-effective', 'save time'.", "Hay viết sai effeciency", "academic_p3_p4"),
        ("innovation", "/ˌɪnəˈveɪʃn/", "noun", "Sự đổi mới, sáng kiến", "Technical innovation drove down prices.", "Paraphrase của 'new invention', 'breakthrough'.", "Hay thiếu một 'n': inovation", "academic_p3_p4"),
        ("commercial", "/kəˈmɜːʃl/", "adj", "Thuộc thương mại", "Commercial flights began in the 1930s.", "Paraphrase của 'business', 'for profit'.", "Hay thiếu một 'm': comercial", "academic_p3_p4"),
        ("volunteer", "/ˌvɒlənˈtɪə(r)/", "noun/verb", "Tình nguyện viên", "Volunteers help guide visitors at weekends.", "Hay gặp trong cả Part 1, Part 2 và Part 3.", "Hay viết sai voluntier", "academic_p3_p4"),
        ("nutrition", "/njuˈtrɪʃn/", "noun", "Dinh dưỡng", "Labels provide clear nutrition facts.", "Lưu ý tính từ 'nutritional', 'nutritious'.", "Hay viết sai nutrtion", "academic_p3_p4"),
        ("desiccation", "/ˌdesɪˈkeɪʃn/", "noun", "Sự khô hạn, mất nước", "Lungfish bury in mud to avoid desiccation.", "Từ chuyên ngành sinh học (xuất hiện trực tiếp ở Vol 9).", "Hay viết sai dessication", "academic_p3_p4"),
        ("hibernation", "/ˌhaɪbəˈneɪʃn/", "noun", "Sự ngủ đông", "Body temperature drops sharply during hibernation.", "Từ chủ đề động vật học Part 4.", "Hay viết sai hybernation", "academic_p3_p4"),
        ("metabolism", "/məˈtæbəlɪzəm/", "noun", "Sự trao đổi chất", "Their metabolism slows down in extreme cold.", "Từ sinh học thường gặp ở Part 4.", "Hay viết nhầm metabolizm", "academic_p3_p4"),

        # 4. High-frequency Paraphrase Pairs (paraphrase_pairs)
        ("complimentary", "/ˌkɒmplɪˈmentri/", "adj", "Miễn phí (tặng kèm)", "Guests receive complimentary hot drinks.", "Paraphrase của 'free', 'provided at no cost'.", "Hay nhầm với 'complementary' (bổ sung)", "paraphrase_pairs"),
        ("mandatory", "/ˈmændətəri/", "adj", "Bắt buộc", "Safety training is mandatory for all staff.", "Paraphrase của 'compulsory', 'required', 'must'.", "Hay viết sai manditory", "paraphrase_pairs"),
        ("optional", "/ˈɒpʃənl/", "adj", "Tùy chọn, không bắt buộc", "The afternoon boat trip is optional.", "Paraphrase của 'not compulsory', 'up to you'.", "Hay viết sai optinal", "paraphrase_pairs"),
        ("prioritise", "/praɪˈɒrətaɪz/", "verb", "Ưu tiên", "You should prioritise the main experiment first.", "Paraphrase của 'focus on first', 'most urgent'.", "Chấp nhận 'prioritise' và 'prioritize'", "paraphrase_pairs"),
        ("postpone", "/pəˈspəʊn/", "verb", "Hoãn lại", "They had to postpone the outdoor concert.", "Paraphrase của 'put off', 'delay', 'reschedule'.", "Ngược với 'cancel' (hủy hẳn) — bẫy MCQ cực phổ biến!", "paraphrase_pairs"),
        ("omit", "/əˈmɪt/", "verb", "Bỏ qua, lược bỏ", "You can omit the background chapter.", "Paraphrase của 'leave out', 'skip', 'remove'.", "Quá khứ gấp đôi 't': omitted", "paraphrase_pairs"),
        ("clarify", "/ˈklærəfaɪ/", "verb", "Làm rõ", "The tutor helped clarify the diagram.", "Paraphrase của 'explain more clearly', 'make sense of'.", "Hay viết sai clearify", "paraphrase_pairs"),
        ("modify", "/ˈmɒdɪfaɪ/", "verb", "Chỉnh sửa, điều chỉnh", "They modified the engine to cut fuel use.", "Paraphrase của 'alter', 'change slightly', 'adapt'.", "Hay viết sai modefy", "paraphrase_pairs"),
        ("unanimous", "/juːˈnænɪməs/", "adj", "Nhất trí hoàn toàn", "Both students reached a unanimous decision.", "Paraphrase của 'completely agree'.", "Hay viết sai unanymous", "paraphrase_pairs"),
        ("reluctant", "/rɪˈlʌktənt/", "adj", "Miễn cưỡng, do dự", "Residents were reluctant to pay extra taxes.", "Paraphrase của 'unwilling', 'hesitant'.", "Hay viết nhầm reluctent", "paraphrase_pairs"),
        ("enthusiastic", "/ɪnˌθjuːziˈæstɪk/", "adj", "Hào hứng, nhiệt tình", "The audience gave an enthusiastic response.", "Ngược nghĩa: 'unenthusiastic' (thiếu hào hứng — hay gặp ở Part 3).", "Hay viết sai enthuastic", "paraphrase_pairs"),
        ("vague", "/veɪɡ/", "adj", "Mơ hồ, chung chung", "The instructions in the booklet were too vague.", "Paraphrase của 'unclear', 'not specific enough'.", "Hay thiếu 'u' cuối: vage", "paraphrase_pairs"),
        ("time-consuming", "/ˈtaɪm kənsjuːmɪŋ/", "adj", "Tốn nhiều thời gian", "Transcribing interviews proved too time-consuming.", "Paraphrase của 'take too long', 'takes ages'.", "Chú ý dấu gạch nối khi cần", "paraphrase_pairs"),
        ("up-to-date", "/ˌʌp tə ˈdeɪt/", "adj", "Cập nhật mới nhất", "This database offers up-to-date statistics.", "Đối lập với 'out of date' (lỗi thời).", "Hay nhầm với 'outdated'", "paraphrase_pairs"),
        ("outdated", "/ˌaʊtˈdeɪtɪd/", "adj", "Lỗi thời, cũ kỹ", "The textbook contained outdated population figures.", "Paraphrase của 'out of date', 'old-fashioned', 'no longer accurate'.", "Thường là lý do loại sách/nguồn ở Part 3", "paraphrase_pairs"),
        ("reliable", "/rɪˈlaɪəbl/", "adj", "Đáng tin cậy", "Always verify whether online sources are reliable.", "Đối lập: 'unreliable' (không đáng tin).", "Hay viết sai relieble", "paraphrase_pairs"),
        ("affordable", "/əˈfɔːdəbl/", "adj", "Giá cả phải chăng", "The hostel offers affordable student rooms.", "Paraphrase của 'cheap', 'reasonable', 'good value'.", "Hay thiếu một 'f': afordable", "paraphrase_pairs"),
        ("accessible", "/əkˈsesəbl/", "adj", "Dễ tiếp cận", "All galleries are wheelchair accessible.", "Paraphrase của 'easy to reach', 'open to everyone'.", "Hay sai 'cc' hoặc 'ss': accesible", "paraphrase_pairs"),
        ("alternative", "/ɔːlˈtɜːnətɪv/", "noun/adj", "Phương án thay thế", "Solar power offers a clean alternative to coal.", "Paraphrase của 'another option', 'replacement'.", "Hay viết sai alternitive", "paraphrase_pairs"),
        ("essential", "/ɪˈsenʃl/", "adj", "Thiết yếu", "Waterproof boots are essential on rocky paths.", "Paraphrase của 'vital', 'necessary', 'crucial'.", "Hay viết sai essencial", "paraphrase_pairs"),
        ("excessive", "/ɪkˈsesɪv/", "adj", "Quá mức", "Excessive packaging increases plastic waste.", "Paraphrase của 'too much', 'more than needed'.", "Hay viết sai exessive", "paraphrase_pairs"),
        ("predictable", "/prɪˈdɪktəbl/", "adj", "Có thể đoán trước", "The film had a predictable ending.", "Đối lập với 'unexpected', 'surprise ending'.", "Hay viết sai predictible", "paraphrase_pairs"),
        ("unexpected", "/ˌʌnɪkˈspektɪd/", "adj", "Bất ngờ", "Reviewers praised the book's unexpected twist.", "Paraphrase của 'surprise', 'surprising'.", "Chú ý phân biệt tiền tố un-", "paraphrase_pairs"),
        ("beneficial", "/ˌbenɪˈfɪʃl/", "adj", "Có lợi", "Exposure to nature is beneficial to recovery.", "Paraphrase của 'helpful', 'good for', 'useful'.", "Hay viết sai benefitial", "paraphrase_pairs"),
        ("consequence", "/ˈkɒnsɪkwəns/", "noun", "Hậu quả, kết quả", "Higher fuel taxes had an immediate consequence.", "Paraphrase của 'result', 'outcome', 'effect'.", "Hay viết sai consequense", "paraphrase_pairs"),
        ("obstacle", "/ˈɒbstəkl/", "noun", "Trở ngại", "Lack of funding was the biggest obstacle.", "Paraphrase của 'barrier', 'difficulty', 'problem'.", "Hay viết sai obsticle", "paraphrase_pairs"),
        ("collaborate", "/kəˈlæbəreɪt/", "verb", "Hợp tác", "Two universities agreed to collaborate on research.", "Paraphrase của 'work together', 'team up'.", "Hay thiếu một 'l': colaborate", "paraphrase_pairs"),
        ("demonstrate", "/ˈdemənstreɪt/", "verb", "Chứng minh / minh họa", "The experiment clearly demonstrates heat loss.", "Paraphrase của 'show', 'prove', 'illustrate'.", "Hay viết sai demonstate", "paraphrase_pairs"),
        ("restrict", "/rɪˈstrɪkt/", "verb", "Hạn chế, giới hạn", "Parking permits restrict access to residents.", "Paraphrase của 'limit', 'control'.", "Hay nhầm với 'strict'", "paraphrase_pairs"),
        ("expand", "/ɪkˈspænd/", "verb", "Mở rộng", "The town plans to expand its tram network.", "Paraphrase của 'grow', 'enlarge', 'extend'.", "Danh từ là 'expansion' (không phải expandation)", "paraphrase_pairs"),
        ("decline", "/dɪˈklaɪn/", "noun/verb", "Suy giảm / từ chối", "Bee populations saw a sharp decline.", "Paraphrase của 'drop', 'fall', 'decrease' hoặc 'refuse'.", "Mang cả 2 nghĩa quan trọng trong IELTS", "paraphrase_pairs"),
        ("accumulate", "/əˈkjuːmjəleɪt/", "verb", "Tích tụ", "Salt can accumulate in irrigated soil.", "Paraphrase của 'build up', 'collect over time'.", "Hay thiếu một 'c': acumulate", "paraphrase_pairs"),
        ("distinguish", "/dɪˈstɪŋɡwɪʃ/", "verb", "Phân biệt", "It is hard to distinguish the two species.", "Paraphrase của 'tell the difference between'.", "Hay viết sai distingush", "paraphrase_pairs"),
        ("compensate", "/ˈkɒmpənseɪt/", "verb", "Bù đắp", "Online materials cannot compensate for live discussion.", "Paraphrase của 'make up for'.", "Hay viết sai compansate", "paraphrase_pairs"),
        ("fluctuate", "/ˈflʌktʃueɪt/", "verb", "Dao động", "Ticket prices fluctuate throughout the season.", "Paraphrase của 'vary', 'rise and fall'.", "Hay thiếu 'u' đầu: flactuate", "paraphrase_pairs"),
        ("genuine", "/ˈdʒenjuɪn/", "adj", "Thật, nguyên bản", "Experts doubted whether the painting was genuine.", "Paraphrase của 'authentic', 'real', 'original'.", "Hay viết sai geniune", "paraphrase_pairs"),
        ("inaccurate", "/ɪnˈækjərət/", "adj", "Không chính xác", "The title on the frame proved inaccurate.", "Paraphrase của 'wrong', 'mistaken', 'incorrect'.", "Hay thiếu một 'c': inacurate", "paraphrase_pairs"),
        ("feasible", "/ˈfiːzəbl/", "adj", "Khả thi", "Extending the survey is not financially feasible.", "Paraphrase của 'practical', 'workable', 'possible'.", "Hay viết sai feasable", "paraphrase_pairs"),
        ("controversial", "/ˌkɒntrəˈvɜːʃl/", "adj", "Gây tranh cãi", "The new tax policy remains controversial.", "Paraphrase của 'causing disagreement', 'widely debated'.", "Hay viết sai controversal", "paraphrase_pairs"),
        ("incentive", "/ɪnˈsentɪv/", "noun", "Khuyến khích, ưu đãi", "Tax breaks provide an incentive to recycle.", "Paraphrase của 'encouragement', 'motivation', 'reward'.", "Hay viết nhầm insentive", "paraphrase_pairs"),
    ]
    cards = []
    for idx, (word, ipa, pos, meaning, ex, para, trap, cat) in enumerate(entries, start=1):
        cards.append(
            {
                "id": f"core-{idx:03d}",
                "word": word,
                "ipa": ipa,
                "partOfSpeech": pos,
                "meaningVi": meaning,
                "exampleEn": ex,
                "paraphraseNote": para,
                "spellingTrap": trap,
                "category": cat,
                "source": "core",
            }
        )
    return cards


def build_test_specs() -> list[dict]:
    specs = []
    # Vol 7 Tests 1-11
    v7_key_pdf = SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 1-10" / "Key Lis VOL 7 (T1-T10).pdf"
    for t in range(1, 11):
        pdf_src = SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 1-10" / f"Test {t}.pdf"
        tr_list = glob.glob(str(SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 1-10" / "Transcript VOL 7 (T1-T10)" / f"*test {t}.docx"))
        au_list = glob.glob(str(SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 1-10" / "VOL 7 Audio (T1-T10)" / f"VOL 7 TEST {t}.*"))
        specs.append({
            "vol": 7, "test": t, "title": f"Vol 7 — Test {t}",
            "pdf_kind": "pdf", "pdf_src": pdf_src,
            "audio_src": Path(au_list[0]),
            "transcript_kind": "docx", "transcript_src": Path(tr_list[0]),
            "key_kind": "v7_shared_pdf", "key_src": v7_key_pdf,
            "has_timestamps": True, "normalize_resets": False, "question_page_limit": None,
        })
    specs.append({
        "vol": 7, "test": 11, "title": "Vol 7 — Test 11",
        "pdf_kind": "pdf",
        "pdf_src": SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 11" / "Test 11.pdf",
        "audio_src": SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 11" / "Audio Test 11.mp3",
        "transcript_kind": "pdf",
        "transcript_src": SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 11" / "Transcript Test 11.pdf",
        "key_kind": "v7_t11_pdf",
        "key_src": SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 11" / "Test 11.pdf",
        "has_timestamps": True, "normalize_resets": True, "question_page_limit": 6,
    })

    # Vol 8 Tests 1-8
    for t in range(1, 9):
        tk = SRC_ROOT / "VOL 8 - ORIGINAL EXAMS" / "LISTENING" / "TRANSCRIPT-KEY" / f"TRANSCRIPT-KEY VOL 8 TEST {t} LIS.docx"
        specs.append({
            "vol": 8, "test": t, "title": f"Vol 8 — Test {t}",
            "pdf_kind": "docx",
            "pdf_src": SRC_ROOT / "VOL 8 - ORIGINAL EXAMS" / "LISTENING" / f"VOL 8 TEST {t} LIS.docx",
            "audio_src": SRC_ROOT / "VOL 8 - ORIGINAL EXAMS" / "LISTENING" / "AUDIO" / f"TEST {t} VOL 8.mp4",
            "transcript_kind": "docx", "transcript_src": tk,
            "key_kind": "cau_so_docx", "key_src": tk,
            "has_timestamps": False, "normalize_resets": False, "question_page_limit": None,
        })

    # Vol 9 Tests 1-9
    for t in range(1, 10):
        tk = SRC_ROOT / "VOL 9 - ORIGINAL EXAMS" / "LISTENING" / "KEY - TRANSCRIPT" / f"KEY TEST {t}-L.docx"
        specs.append({
            "vol": 9, "test": t, "title": f"Vol 9 — Test {t}",
            "pdf_kind": "docx",
            "pdf_src": SRC_ROOT / "VOL 9 - ORIGINAL EXAMS" / "LISTENING" / f"TEST {t}-L.docx",
            "audio_src": SRC_ROOT / "VOL 9 - ORIGINAL EXAMS" / "LISTENING" / "AUDIO" / f"TEST {t}.mp4",
            "transcript_kind": "docx", "transcript_src": tk,
            "key_kind": "v9_nolabel_docx" if t in (3, 4) else "cau_so_docx", "key_src": tk,
            "has_timestamps": True, "normalize_resets": False, "question_page_limit": None,
        })
    return specs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Re-convert all PDFs and MP3s even if already present")
    parser.add_argument("--skip-media", action="store_true", help="Keep existing exam.pdf / audio.mp3, regenerate JSON only")
    args = parser.parse_args()

    if not FFMPEG_BIN.exists():
        print(f"ERROR: ffmpeg-static not found at {FFMPEG_BIN}. Run npm.cmd install first.", file=sys.stderr)
        sys.exit(1)
    if not SOFFICE_BIN.exists():
        print(f"ERROR: LibreOffice not found at {SOFFICE_BIN}.", file=sys.stderr)
        sys.exit(1)

    OUT_DATA.mkdir(parents=True, exist_ok=True)
    lo_profile = PROJECT_ROOT / ".lo-profile"
    lo_profile.mkdir(parents=True, exist_ok=True)

    v7_shared_keys = parse_vol7_keys(
        SRC_ROOT / "VOL 7- ORIGINAL EXAMS" / "Listening" / "Test 1-10" / "Key Lis VOL 7 (T1-T10).pdf"
    )

    specs = build_test_specs()
    manifest_tests: list[dict] = []
    total_raw_bytes = 0
    total_opt_bytes = 0
    max_file_bytes = 0
    max_file_path = ""

    for spec in specs:
        vol, tnum = spec["vol"], spec["test"]
        test_dir = OUT_DATA / f"vol-{vol}" / f"test-{tnum}"
        test_dir.mkdir(parents=True, exist_ok=True)
        pdf_out = test_dir / "exam.pdf"
        audio_out = test_dir / "audio.mp3"
        json_out = test_dir / "data.json"

        print(f"[{vol}-{tnum:02d}] Processing {spec['title']}...")

        # 1. PDF
        if args.force or (not args.skip_media and not pdf_out.exists()):
            if spec["pdf_kind"] == "pdf":
                shutil.copy2(spec["pdf_src"], pdf_out)
            else:
                convert_docx_to_pdf(spec["pdf_src"], pdf_out, lo_profile)
        doc = pymupdf.open(str(pdf_out))
        pdf_pages = len(doc)
        q_page_end = spec["question_page_limit"] or pdf_pages
        exam_text = "\n".join(doc[i].get_text() for i in range(0, min(q_page_end, pdf_pages)))
        doc.close()

        # 2. Audio
        raw_audio_bytes = spec["audio_src"].stat().st_size
        total_raw_bytes += raw_audio_bytes
        if args.force or (not args.skip_media and not audio_out.exists()):
            audio_dur = run_ffmpeg_convert(spec["audio_src"], audio_out)
        else:
            audio_dur = get_audio_duration(audio_out)

        opt_audio_bytes = audio_out.stat().st_size
        pdf_bytes = pdf_out.stat().st_size
        total_opt_bytes += opt_audio_bytes + pdf_bytes
        for p_check in (audio_out, pdf_out):
            sz = p_check.stat().st_size
            if sz > max_file_bytes:
                max_file_bytes = sz
                max_file_path = f"./data/vol-{vol}/test-{tnum}/{p_check.name}"

        # 3. Answer Keys (assert 40/40)
        if spec["key_kind"] == "v7_shared_pdf":
            qkeys = v7_shared_keys[tnum]
        elif spec["key_kind"] == "v7_t11_pdf":
            t11_key_text = read_pdf_text(spec["key_src"], page_start=6)
            qkeys = parse_cau_so_keys([l.strip() for l in t11_key_text.splitlines() if l.strip()], 7, 11)
        elif spec["key_kind"] == "cau_so_docx":
            qkeys = parse_cau_so_keys(read_docx_paragraphs(spec["key_src"]), vol, tnum)
        elif spec["key_kind"] == "v9_nolabel_docx":
            qkeys = parse_vol9_nolabel_keys(read_docx_paragraphs(spec["key_src"]), tnum)
        else:
            raise ValueError(f"Unknown key_kind: {spec['key_kind']}")

        # 4. Transcript & Dictation Segments
        if spec["transcript_kind"] == "docx":
            tr_lines = read_docx_paragraphs(spec["transcript_src"])
        else:
            tr_lines = [l.strip() for l in read_pdf_text(spec["transcript_src"]).splitlines() if l.strip()]

        parts_meta, short_segments, long_segments = extract_transcript_blocks(
            tr_lines,
            audio_dur,
            has_timestamps=spec["has_timestamps"],
            normalize_resets=spec["normalize_resets"],
        )

        # 5. Align Questions 1-40 with Evidence, Paraphrases, Distractors & Vietnamese Explanations
        prompts = extract_exam_prompts(exam_text)
        questions = align_questions_to_transcript(vol, tnum, qkeys, short_segments, prompts)
        assert len(questions) == 40, f"Expected 40 questions for V{vol}T{tnum}, got {len(questions)}"

        # Strip temporary blockText before saving JSON
        clean_short = [
            {k: v for k, v in seg.items() if k != "blockText"}
            for seg in short_segments
        ]

        rel_pdf = f"./data/vol-{vol}/test-{tnum}/exam.pdf"
        rel_audio = f"./data/vol-{vol}/test-{tnum}/audio.mp3"
        rel_data = f"./data/vol-{vol}/test-{tnum}/data.json"

        test_payload = {
            "id": f"vol-{vol}-test-{tnum}",
            "vol": vol,
            "testNumber": tnum,
            "title": spec["title"],
            "pdfUrl": rel_pdf,
            "pdfPages": pdf_pages,
            "questionPageRange": [1, q_page_end],
            "audioUrl": rel_audio,
            "audioDurationSec": audio_dur,
            "hasExactTimestamps": spec["has_timestamps"],
            "timestampNote": (
                "Mốc thời gian trích xuất trực tiếp từ transcript gốc."
                if spec["has_timestamps"]
                else "Tài liệu gốc Vol 8 không đính kèm mốc giờ từng câu; hệ thống ước lượng tỷ lệ theo độ dài audio gốc. Bạn có thể tinh chỉnh bằng trình biên tập Timestamp / SRT."
            ),
            "parts": parts_meta,
            "questions": questions,
            "transcriptSegments": clean_short,
            "longSegments": long_segments,
        }
        json_out.write_text(json.dumps(test_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        total_opt_bytes += json_out.stat().st_size

        manifest_tests.append(
            {
                "id": f"vol-{vol}-test-{tnum}",
                "vol": vol,
                "testNumber": tnum,
                "title": spec["title"],
                "status": "ready",
                "dataUrl": rel_data,
                "pdfUrl": rel_pdf,
                "audioUrl": rel_audio,
                "pdfPages": pdf_pages,
                "questionPageRange": [1, q_page_end],
                "audioDurationSec": audio_dur,
                "audioOriginalSizeMB": round(raw_audio_bytes / 1048576, 2),
                "audioOptimizedSizeMB": round(opt_audio_bytes / 1048576, 2),
                "pdfSizeMB": round(pdf_bytes / 1048576, 2),
                "hasPdf": True,
                "hasAudio": True,
                "hasTranscript": True,
                "hasKey": True,
                "hasExactTimestamps": spec["has_timestamps"],
                "questionCount": 40,
                "shortSegmentCount": len(clean_short),
                "longSegmentCount": len(long_segments),
                "sourceNotes": (
                    "Trang 7-9 của PDF gốc là Answer Key; chế độ thi mặc định hiển thị trang 1-6."
                    if (vol == 7 and tnum == 11)
                    else ("Đề DOCX đã được giữ nguyên định dạng sang PDF; transcript chưa có mốc giờ chi tiết." if vol == 8 else "Đủ 4 thành phần chuẩn từ tài liệu gốc.")
                ),
            }
        )

    # Record Vol 10 honest missing status (no fabricated questions/keys/transcripts)
    vol10_dir = OUT_DATA / "vol-10"
    vol10_dir.mkdir(parents=True, exist_ok=True)
    (vol10_dir / "README.md").write_text(
        "# Vol 10 — Trạng thái Tài liệu Listening\n\n"
        "Trong bộ tài liệu nguồn hiện tại (`F:\\IELTS\\Vol`), **Vol 10 chưa có file đề PDF, audio gốc, transcript và answer key Listening** "
        "(`VOL 10 KEY.pdf` chỉ chứa đề & đáp án Reading Tests 1–6; thư mục `VOL 10 - ORIGINAL EXAMS` chỉ chứa 1 ảnh PNG `13.Oct.2026`).\n\n"
        "## Cách bổ sung Vol 10\n"
        "1. Mở trang **Quản lý dữ liệu** trên ứng dụng web để nạp trực tiếp file PDF, Audio MP3/M4A/WAV, Transcript (.txt/.srt/.vtt) và Key cho từng Test (lưu vào IndexedDB trên trình duyệt).\n"
        "2. Hoặc xuất file `data.json` từ trình quản lý dữ liệu kèm `exam.pdf` và `audio.mp3` đặt vào `public/data/vol-10/test-{1..4}/` rồi push lên GitHub.\n",
        encoding="utf-8",
    )
    for t in range(1, 5):
        manifest_tests.append(
            {
                "id": f"vol-10-test-{t}",
                "vol": 10,
                "testNumber": t,
                "title": f"Vol 10 — Test {t}",
                "status": "missing",
                "dataUrl": None,
                "pdfUrl": None,
                "audioUrl": None,
                "pdfPages": 0,
                "questionPageRange": [1, 1],
                "audioDurationSec": 0,
                "audioOriginalSizeMB": 0,
                "audioOptimizedSizeMB": 0,
                "pdfSizeMB": 0,
                "hasPdf": False,
                "hasAudio": False,
                "hasTranscript": False,
                "hasKey": False,
                "hasExactTimestamps": False,
                "questionCount": 0,
                "shortSegmentCount": 0,
                "longSegmentCount": 0,
                "sourceNotes": "Tài liệu nguồn chưa có file Listening cho Vol 10 (VOL 10 KEY.pdf chỉ chứa Reading). Có thể nạp file cục bộ trên giao diện.",
            }
        )

    # Vocab core
    vocab_core = build_vocab_core()
    vocab_path = OUT_DATA / "vocab-core.json"
    vocab_path.write_text(json.dumps(vocab_core, ensure_ascii=False, indent=2), encoding="utf-8")
    total_opt_bytes += vocab_path.stat().st_size

    # Manifest
    manifest = {
        "schemaVersion": 1,
        "generatedAt": "2026-11-25",
        "sourceSummary": {
            "totalTests": len(manifest_tests),
            "readyTests": sum(1 for x in manifest_tests if x["status"] == "ready"),
            "missingTests": sum(1 for x in manifest_tests if x["status"] == "missing"),
            "totalRawAudioMB": round(total_raw_bytes / 1048576, 2),
            "totalPackagedDataMB": round(total_opt_bytes / 1048576, 2),
            "largestFilePath": max_file_path,
            "largestFileMB": round(max_file_bytes / 1048576, 2),
            "volumes": [
                {"vol": 7, "label": "Vol 7", "ready": 11, "total": 11, "notes": "Đủ PDF gốc, Audio gốc, Transcript có timestamp, Answer Key (T1–T11)."},
                {"vol": 8, "label": "Vol 8", "ready": 8, "total": 8, "notes": "Đủ 8 đề gốc (DOCX chuyển PDF giữ nguyên hình), Audio gốc, Transcript & Key (chưa có mốc giờ chi tiết)."},
                {"vol": 9, "label": "Vol 9", "ready": 9, "total": 9, "notes": "Đủ 9 đề gốc (DOCX chuyển PDF giữ nguyên hình), Audio gốc, Transcript có timestamp & Key."},
                {"vol": 10, "label": "Vol 10", "ready": 0, "total": 4, "notes": "Chưa có tài liệu Listening trong kho nguồn (VOL 10 KEY.pdf chỉ gồm Reading Tests 1–6). Hỗ trợ nạp file cục bộ."},
            ],
        },
        "tests": manifest_tests,
    }
    manifest_path = OUT_DATA / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # Cleanup temp LibreOffice profile
    shutil.rmtree(lo_profile, ignore_errors=True)
    test_lo = PROJECT_ROOT / ".lo-test"
    if test_lo.exists():
        shutil.rmtree(test_lo, ignore_errors=True)

    print(
        f"\n[DONE] Ready: {manifest['sourceSummary']['readyTests']}/{manifest['sourceSummary']['totalTests']} tests | "
        f"Raw audio: {manifest['sourceSummary']['totalRawAudioMB']} MB -> Packaged total: {manifest['sourceSummary']['totalPackagedDataMB']} MB | "
        f"Largest file: {manifest['sourceSummary']['largestFileMB']} MB ({manifest['sourceSummary']['largestFilePath']})"
    )


if __name__ == "__main__":
    main()
