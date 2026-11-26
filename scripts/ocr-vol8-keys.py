#!/usr/bin/env python3
"""
High-precision batched Windows OCR extractor & cross-validator for Vol 8 Reading Key.pdf (47 pages).
- Uses min(R,G,B) at 360 DPI without destructive contrast stretch so colored (orange/red/blue) AND
  small bold characters stay sharp and readable.
- Splits stacked multi-column rows cleanly using (x, y) word coordinates.
- Partitions all 12 Tests accurately including intra-page splits (Page 18 holds end of Test 6 + start of Test 7).
- Cross-validates recovered answers against clean IELTS_Reading_VOL_08.docx passages & question types.
"""

import argparse
import difflib
import json
import re
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pymupdf
from PIL import Image, ImageChops

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = PROJECT_ROOT / ".reading-cache"
VOL8_KEY_PDF = Path(
    r"F:\IELTS\Vol\Full Original Exam VOL 1-10\VOL 8 - ORIGINAL EXAMS\READING\Key.pdf"
)
VOL8_DOCX = Path(
    r"F:\IELTS\Vol\Full Original Exam VOL 1-10\IELTS READING - CAMBRIDGE 13-20 FORMAT\Volume 08\IELTS_Reading_VOL_08.docx"
)

OCR_V2_CACHE = CACHE_DIR / "vol8-key-ocr-v2.json"
PARSED_KEYS_PATH = CACHE_DIR / "vol8-parsed-keys.json"

CHROME_NOISE_RE = re.compile(
    r"(?:docs\.google\.com|trang ch[ủüu]|google drive|google t[åàa]i|ch[ỉi]nh s[ửu]a|y[êe]u c[ầåa]u quy|"
    r"xem c[ôö]ng c[ụuv]|tr[ợog]\s*gi[úü]p|chia s[ẻe]|n[âa]ng c[ấa]p|duolingo|instagra|"
    r"speaking\s*[-–]|en1357@|m[ớo]i g[ủu]i|b[ộo] nh[ớo]|gi[åảa]m 73%|btvn|qu[ảa]n l[ýy] b[ộo]|"
    r"[đd][ăa]ng\s*(?:c[ốo]\s*g[ắa]ng|g[aåă]ng)|k[ếeé]t\s*n[ốo6]i|kh[ởo]i\s*[đd][ộo]ng|thay\s*[đd][ổo]i\s*c[ủu]a|"
    r"t[aåấ]t\s*c[aåả]\s*thay|d[au][gơ]c\s*l[uv]r?u|vol\s*5_advanced)",
    re.IGNORECASE,
)


def run_clean_ocr(pdf_path: Path, force: bool = False) -> list[dict]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if OCR_V2_CACHE.exists() and not force:
        cached = json.loads(OCR_V2_CACHE.read_text(encoding="utf-8"))
        if len(cached) == 47:
            return cached

    doc = pymupdf.open(str(pdf_path))
    n_pages = len(doc)
    t0 = time.time()

    with tempfile.TemporaryDirectory(prefix="v8_ocr2_") as td:
        td_path = Path(td)
        for i, pg in enumerate(doc):
            r = pg.rect
            clip = pymupdf.Rect(r.width * 0.285, r.height * 0.04, r.width * 0.905, r.height * 0.95)
            pix = pg.get_pixmap(dpi=360, clip=clip)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            ch_r, ch_g, ch_b = img.split()
            dark = ImageChops.darker(ImageChops.darker(ch_r, ch_g), ch_b)
            dark.save(str(td_path / f"page_{i:02d}.png"))
        doc.close()

        out_json = td_path / "ocr_words.json"
        ps_script = td_path / "run_ocr.ps1"
        ps_code = f"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{ $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }})[0]
function Await($op, $resType) {{
  $t = $asTaskGeneric.MakeGenericMethod($resType).Invoke($null, @($op))
  $t.Wait()
  return $t.Result
}}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$files = Get-ChildItem -Path "{td}" -Filter "page_*.png" | Sort-Object Name
$results = @()
foreach ($f in $files) {{
  $sf = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($f.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {{
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $words = @()
    foreach ($ln in $res.Lines) {{
      foreach ($w in $ln.Words) {{
        $words += [PSCustomObject]@{{
          t = $w.Text
          x = [int]$w.BoundingRect.X
          y = [int]$w.BoundingRect.Y
          w = [int]$w.BoundingRect.Width
        }}
      }}
    }}
    $results += [PSCustomObject]@{{ file = $f.Name; words = $words }}
  }} finally {{
    $stream.Dispose()
  }}
}}
$results | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path "{out_json}" -Encoding UTF8
"""
        ps_script.write_text(ps_code, encoding="utf-8")
        res = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps_script)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if res.returncode != 0 or not out_json.exists():
            raise RuntimeError(f"OCR failed: {res.stderr}")
        pages = json.loads(out_json.read_text(encoding="utf-8-sig"))
        OCR_V2_CACHE.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
        print(f"Clean 360-DPI min-RGB OCR complete for {len(pages)}/{n_pages} pages in {time.time()-t0:.1f}s")
        return pages


def reconstruct_rows_from_words(words: list[dict]) -> list[str]:
    if not words:
        return []
    # Filter right-edge browser scrollbar artifacts (isolated tiny digits at extreme right)
    filtered = [
        w for w in words
        if not (w["x"] > 1520 and w["t"] in ("9", "31", "0", "x", "e", "g"))
    ]
    words_sorted = sorted(filtered, key=lambda w: (w["y"], w["x"]))
    rows: list[list[dict]] = []
    for wd in words_sorted:
        placed = False
        if rows:
            for cand in rows[-3:]:
                avg_y = sum(x["y"] for x in cand) / len(cand)
                if abs(wd["y"] - avg_y) <= 14:
                    cand.append(wd)
                    placed = True
                    break
        if not placed:
            rows.append([wd])

    out_lines: list[str] = []
    for row in rows:
        row.sort(key=lambda w: w["x"])
        full_row = " ".join(w["t"] for w in row).strip()
        if not full_row or CHROME_NOISE_RE.search(full_row):
            continue

        # Split two-column tables ("Câu số 6: mess   Câu số 7: light" or "cau Sö 24: government Cäu Sö 25: weakness")
        chunks: list[list[dict]] = [[]]
        for idx, wd in enumerate(row):
            if idx >= 2:
                prev = row[idx - 1]
                gap = wd["x"] - (prev["x"] + prev["w"])
                tl = wd["t"].lower()
                is_q_marker = (
                    re.match(r"^(?:câu|cau|cåu|cäu|cấu)$", tl)
                    or re.match(r"^s[6oôö]\d{1,2}", tl)
                    or re.match(r"^Q\d{1,2}$", wd["t"])
                )
                # Always split when a second Vietnamese question label appears mid-row
                if is_q_marker and (gap > 20 or len(chunks[-1]) >= 3):
                    chunks.append([wd])
                    continue
                if gap > 55 and (
                    tl.startswith(("câu", "cau", "cåu", "cäu", "cấu"))
                    or is_q_marker
                ):
                    chunks.append([wd])
                    continue
            chunks[-1].append(wd)

        for ch in chunks:
            txt = " ".join(w["t"] for w in ch).strip()
            # Clean trailing tiny scrollbar numbers
            txt = re.sub(r"\s+(?:9|31)\s*$", "", txt).strip()
            if txt and not re.fullmatch(r"[9x•\|]+", txt):
                out_lines.append(txt)
    return out_lines


def load_vol8_docx_info() -> dict[int, dict]:
    """Load clean passages + accurate expected question types per Q1..40 from IELTS_Reading_VOL_08.docx."""
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(VOL8_DOCX) as z:
        body = ET.fromstring(z.read("word/document.xml")).find("w:body", ns)

    tests: dict[int, dict] = {}
    cur_t = 0
    in_q = False
    for el in body:
        tag = el.tag.split("}")[-1]
        texts = [
            "".join(t.text or "" for t in p.findall(".//w:t", ns)).strip()
            for p in ([el] if tag == "p" else el.findall(".//w:p", ns))
        ]
        for txt in texts:
            if not txt:
                continue
            mt = re.match(r"^PRACTICE TEST (\d+)$", txt)
            if mt:
                cur_t = int(mt.group(1))
                tests[cur_t] = {"passages": [], "questions": []}
                in_q = False
                continue
            if cur_t == 0:
                continue
            if re.match(r"^READING PASSAGE [123]$", txt):
                in_q = False
                continue
            if re.match(r"^Questions?\s+\d+", txt):
                in_q = True
            if in_q:
                tests[cur_t]["questions"].append(txt)
            else:
                tests[cur_t]["passages"].append(txt)

    for tnum, info in tests.items():
        expected_types: dict[int, str] = {}
        cur_range = (1, 13)
        cur_kind = "unknown"
        for line in info["questions"]:
            mr = re.match(r"^Questions?\s+(\d+)\s*[–-]\s*(\d+)", line)
            if mr:
                cur_range = (int(mr.group(1)), int(mr.group(2)))
                cur_kind = "unknown"
                continue
            ll = line.lower()
            if "true" in ll and "not given" in ll:
                cur_kind = "tfng"
            elif "yes" in ll and "not given" in ll:
                cur_kind = "ynng"
            elif "list of headings" in ll or "correct heading" in ll:
                cur_kind = "roman"
            elif (
                "list of words" in ll
                or "word box" in ll
                or "following phrases" in ll
                or "correct letter" in ll
                or "choose two" in ll
                or "choose three" in ll
                or "choose the correct answer" in ll
                or "which paragraph contains" in ll
                or "correct ending" in ll
                or "following statements with the correct" in ll
                or "following researchers" in ll
                or "following people" in ll
                or "match each" in ll
            ):
                cur_kind = "letter"
            elif "one word" in ll or "no more than" in ll or "complete the" in ll:
                if cur_kind != "letter":
                    cur_kind = "word"
            for q in range(cur_range[0], cur_range[1] + 1):
                if cur_kind != "unknown":
                    expected_types[q] = cur_kind

        full_p = "\n".join(info["passages"])
        words = re.findall(r"[a-zA-Z0-9'-]+", full_p)
        word_map: dict[str, str] = {}
        for w in words:
            word_map.setdefault(w.lower(), w)
        info["expected_types"] = expected_types
        info["word_map"] = word_map
        info["full_passage"] = full_p
    return tests


ROMAN_OCR_MAP = {
    "i": "i", "1": "i", "l": "i",
    "ii": "ii", "11": "ii", "ll": "ii",
    "iii": "iii", "111": "iii", "lll": "iii",
    "iv": "iv", "v": "v", "vi": "vi", "vii": "vii",
    "viii": "viii", "ix": "ix", "x": "x", "xi": "xi", "xii": "xii",
}


def normalize_ocr_q_prefix(s: str) -> str:
    """Fix OCR confusions ONLY on leading question prefixes before regex matching."""
    # Glued Câu số prefixes: "Cåus6 7:", "Cåu Sö 2:", "cau sd 10:", "Cåu 56 37:", "s6 15•.B"
    s = re.sub(
        r"^(?:(?:C[aâåäấ][uv]?|Cau|Cåu|Cäu|Gau|Ciu)\s*)?(?:(?:[Ss][ốồoó6öéëbd]|56)\s*)?",
        lambda m: "Q" if m.group(0).strip() else "",
        s,
        count=1,
        flags=re.IGNORECASE,
    ) if re.match(r"^(?:C[aâåäấ][uv]?|Cau|Cåu|Cäu|Gau|Ciu|[Ss][ốồoó6öéëbd]\s*\d)", s, re.I) else s

    # Q-token OCR confusions at start of line
    s = re.sub(r"^0(\d{1,2})\b", r"Q\1", s)
    s = re.sub(r"^Q\s*I\s+(\d)\b", r"Q1\1", s)
    s = re.sub(r"^Q\s*([Il])(?=\s|$|[:.])", r"Q1", s)
    s = re.sub(r"^Q\s*IO\b", "Q10", s)
    s = re.sub(r"^Q\s*(?:ll|II|li|lI|Il|il|iI)\b", "Q11", s)
    s = re.sub(r"^Q\s*IS\b", "Q18", s)
    s = re.sub(r"^Q\s*l(\d)\b", r"Q1\1", s)
    s = re.sub(r"^Q\s*(\d{1,2})([A-Iivx])(?=\s|$|[:.])", r"Q\1 \2", s)

    # Leading Roman-confused Q1 / Q11 like "I. Inefficient:", "I False", "II . True:", "II. merchants"
    s = re.sub(r"^(?:II|ll)\s*\.\s*(?=[A-Za-z])", "11. ", s)
    s = re.sub(r"^[Il]\s*\.\s*(?=[A-Za-z])", "1. ", s)
    s = re.sub(r"^[Il]\s+(?=(?:True|False|NG|Not\s+Given|Yes|No)\b)", "1 ", s, flags=re.IGNORECASE)

    # Tight "15B" or "33A" or "24.0" / "34.8"
    s = re.sub(r"^(\d{1,2})([A-I])(?=\s|$|\.)", r"\1 \2", s)
    s = re.sub(r"^(\d{1,2})\s*[•·]\s*", r"\1: ", s)
    return s.strip()


def clean_vol8_answer(raw_ans: str, q_kind: str, word_map: dict[str, str]) -> str:
    s = re.sub(r"\s+", " ", raw_ans).strip(" .:;-•|\"'`")
    m_split = re.match(r"^([A-I]|[ivx]{1,4}|TRUE|FALSE|NOT GIVEN|YES|NO)\s*[:–\-]\s+.+$", s, re.I)
    if m_split:
        s = m_split.group(1).strip()

    s_alpha = re.sub(r"[^A-Za-z]", "", s).upper()
    if q_kind == "tfng" or s_alpha in ("TRUE", "TRVE", "THUE", "TIUE", "TRUC", "7RUE", "FALSE", "FALW", "FALS", "FASE", "FAL5E", "FILSE", "NOTGIVEN", "NG", "NC", "NOTGIVCN", "NOTGVEN", "NOTCIVEN", "N0TGIVEN", "HOTGIVEN"):
        if s_alpha in ("TRUE", "TRVE", "THUE", "TIUE", "TRUC", "7RUE", "T"):
            return "TRUE"
        if s_alpha in ("FALSE", "FALW", "FALS", "FASE", "FAL5E", "FILSE", "F"):
            return "FALSE"
        if "GIVEN" in s_alpha or s_alpha in ("NG", "NC"):
            return "NOT GIVEN"
    if q_kind == "ynng" or s_alpha in ("YES", "YE5", "Y€S"):
        if s_alpha in ("YES", "YE5", "Y€S", "Y"):
            return "YES"
        if s_alpha in ("NO", "N0", "N"):
            return "NO"
        if "GIVEN" in s_alpha or s_alpha in ("NG", "NC"):
            return "NOT GIVEN"

    if q_kind == "roman":
        first_tok = s.split()[0].lower().strip(".:") if s else ""
        if first_tok in ROMAN_OCR_MAP:
            return ROMAN_OCR_MAP[first_tok]

    if q_kind == "letter":
        # Shared choices like "A, C" or "C, D, E"
        first_part = s.split(".")[0] if re.match(r"^[A-J](?:\s*,\s*[A-J])+", s, re.I) else s
        multi = re.findall(r"\b([A-J])\b", first_part.upper())
        if len(multi) >= 2 and re.match(r"^[A-J](?:\s*[,.\s]+\s*[A-J])+(?:\s|$|\.)", s, re.I):
            return ", ".join(multi)
        tok0 = s.split()[0].strip(".,:—-") if s else ""
        if len(tok0) == 1:
            t_up = tok0.upper()
            ocr_let = {"0": "D", "O": "D", "8": "B", "1": "I", "6": "G"}.get(t_up, t_up)
            if "A" <= ocr_let <= "K":
                return ocr_let
        if re.fullmatch(r"[A-K081]{1}", s.upper()):
            return {"0": "D", "8": "B", "1": "I"}.get(s.upper(), s.upper())

    if s:
        # Handle inline sentence gap-fills like "Farmers was set up as a/an ... mail order ... business"
        m_dots = re.search(r"\.{2,}\s*([a-zA-Z0-9'-]+(?:\s+[a-zA-Z0-9'-]+){0,2})\s*\.{2,}", raw_ans)
        if m_dots:
            s = m_dots.group(1).strip()

        first_chunk = re.split(r"\s*[:\(]\s*", s)[0].strip()
        # Summary-with-word-bank / Matching label+word (e.g. "D storage", "D good condition", "F guidance")
        m_bank = re.match(r"^([A-K])\s+[a-z][a-z\s-]{2,}$", first_chunk)
        if m_bank:
            return m_bank.group(1)
        toks = re.findall(r"[A-Za-z0-9'-]+", first_chunk)
        # Keep comma alternatives if like "seven years,7 years"
        if "," in first_chunk and not re.search(r"\d,\d{3}", first_chunk):
            return first_chunk
        fixed_toks = []
        for tk in toks[:3]:
            tl = tk.lower()
            if tl in word_map:
                fixed_toks.append(word_map[tl])
            else:
                # Fix OCR '1'->'l' confusion like '1ung' -> 'lung' before fuzzy match
                tl_lfix = re.sub(r"(^|[^0-9])1([a-z])", r"\1l\2", tl)
                if tl_lfix in word_map:
                    fixed_toks.append(word_map[tl_lfix])
                else:
                    close = difflib.get_close_matches(tl_lfix, word_map.keys(), n=1, cutoff=0.76)
                    fixed_toks.append(word_map[close[0]] if close else tk)
        if fixed_toks:
            return " ".join(fixed_toks)
    return s


def partition_pages_into_tests(pages: list[dict]) -> dict[int, list[str]]:
    """
    Partition all 47 OCR pages into Tests 1..12, splitting intra-page at PASSAGE 1 resets (notably Page 18).
    """
    ranges = {
        1: (1, 3), 2: (4, 7), 3: (8, 9), 4: (10, 12), 5: (13, 15),
        6: (16, 18), 7: (18, 20), 8: (21, 23), 9: (24, 31),
        10: (32, 37), 11: (38, 44), 12: (45, 47),
    }
    test_rows: dict[int, list[str]] = {t: [] for t in range(1, 13)}
    for tnum, (a, b) in ranges.items():
        for pno in range(a, b + 1):
            rows = reconstruct_rows_from_words(pages[pno - 1].get("words", []))
            if pno == 18:
                split_at = next((i for i, r in enumerate(rows) if re.match(r"^PASSAGE\s+1\b", r, re.I)), len(rows) // 2)
                rows = rows[:split_at] if tnum == 6 else rows[split_at:]
            elif pno == 7 and tnum == 2:
                split_at = next((i for i, r in enumerate(rows) if re.match(r"^TEST\s+3\b", r, re.I)), len(rows))
                rows = rows[:split_at]
            elif pno == 31 and tnum == 9:
                split_at = next((i for i, r in enumerate(rows) if re.match(r"^TEST\s+10\b", r, re.I)), len(rows))
                rows = rows[:split_at]
            test_rows[tnum].extend(rows)
    return test_rows


def parse_vol8_test_keys(tnum: int, raw_rows: list[str], ctx: dict) -> dict[int, dict]:
    qmap: dict[int, dict] = {}
    exp_types = ctx["expected_types"]
    word_map = ctx["word_map"]

    rows = [normalize_ocr_q_prefix(r) for r in raw_rows]

    q_line_re = re.compile(
        r"^Q(\d{1,2}(?:\s*[-–,]\s*\d{1,2})*)\s*[:.\-•]?\s*(.*)$"
        r"|^(\d{1,2}(?:\s*[-–,]\s*\d{1,2})*)\s*([.:–\-])\s*(.*)$"
        r"|^(\d{1,2})\s+(TRUE|FALSE|NOT\s*GIVEN|NG|NC|YES|NO|[A-K08](?:[.\s]+.*)?|[ivx]{1,4}\b.*|.+\.{2,}.+)$",
        re.IGNORECASE,
    )

    cur_qs: list[int] = []
    cur_raw_ans = ""
    cur_evidence: list[str] = []

    def expand_spec(spec_str: str) -> list[int]:
        nums = [int(x) for x in re.findall(r"\d+", spec_str)]
        if "-" in spec_str or "–" in spec_str:
            if len(nums) == 2 and 1 <= nums[0] < nums[1] <= 40:
                return list(range(nums[0], nums[1] + 1))
        return [n for n in nums if 1 <= n <= 40]

    def flush():
        nonlocal cur_qs, cur_raw_ans, cur_evidence
        if not cur_qs:
            cur_raw_ans = ""
            cur_evidence = []
            return
        ev_txt = re.sub(r"\s+", " ", " ".join(cur_evidence)).strip()
        for qn in cur_qs:
            q_kind = exp_types.get(qn, "unknown")
            ans = clean_vol8_answer(cur_raw_ans, q_kind, word_map)
            # If previous screenshot duplicate already captured answer, keep better version
            prev = qmap.get(qn)
            if not prev:
                qmap[qn] = {"answer": ans, "evidence": ev_txt, "rawAns": cur_raw_ans}
            else:
                is_clean_std = bool(re.fullmatch(r"[A-K](?:,\s*[A-K])*|TRUE|FALSE|NOT GIVEN|YES|NO|[ivx]{1,4}", ans))
                if ans and (not prev["answer"] or len(prev["answer"]) > 25 or (is_clean_std and len(prev["answer"]) > 3)):
                    prev["answer"] = ans
                    prev["rawAns"] = cur_raw_ans
                if len(ev_txt) > len(prev["evidence"]):
                    prev["evidence"] = ev_txt
        cur_qs = []
        cur_raw_ans = ""
        cur_evidence = []

    for s in rows:
        if not s or s == "..." or CHROME_NOISE_RE.search(s):
            continue
        if re.match(r"^(?:PASSAGE\s+\d|READING\s+VOL\s+8|TEST\s*\d+|Location:|Paragraph\s+[A-G]:)$", s, re.I):
            continue

        m = q_line_re.match(s)
        if m:
            if m.group(1):
                spec_str, rest = m.group(1), m.group(2).strip()
            elif m.group(3):
                spec_str, rest = m.group(3), m.group(5).strip()
            else:
                spec_str, rest = m.group(6), m.group(7).strip()

            qs = expand_spec(spec_str)
            if qs and not re.match(r"^\d{4}\b", s):
                flush()
                cur_qs = qs
                if rest:
                    m_quote = re.match(r"^([A-I]|TRUE|FALSE|NOT GIVEN|NG|NC|YES|NO|[ivx]{1,4})\s*[:\-]\s*(.+)$", rest, re.I)
                    if m_quote:
                        cur_raw_ans = m_quote.group(1).strip()
                        cur_evidence.append(m_quote.group(2).strip())
                    else:
                        cur_raw_ans = rest
                continue

        if cur_qs:
            m_da = re.match(r"^(?:[ĐD][aáå]p\s*[aáå]n)\s*[:.]\s*(.+)$", s, re.I)
            if m_da:
                cur_raw_ans = m_da.group(1).strip()
            elif not cur_raw_ans and len(s) <= 45 and not re.match(r"^(?:Passage|Paragraph|Location|Câu|Cau|Cåu|Cäu|Cấu)\b", s, re.I):
                # Pattern 2: "16  <italic prompt>\nB: <evidence quote>"
                m_let_quote = re.match(r"^([A-K])\s*:\s*(.+)$", s)
                if m_let_quote:
                    cur_raw_ans = m_let_quote.group(1)
                    cur_evidence.append(m_let_quote.group(2).strip())
                elif not s.startswith("("):
                    cur_raw_ans = s
            else:
                # Also handle "16 <stem>" followed by "B: <quote>" when cur_raw_ans held the stem!
                m_let_quote = re.match(r"^([A-K]|TRUE|FALSE|NOT GIVEN|YES|NO|[ivx]{1,4})\s*:\s*(.+)$", s)
                if m_let_quote and len(cur_raw_ans.split()) >= 4 and len(cur_qs) == 1 and exp_types.get(cur_qs[0]) in ("letter", "tfng", "ynng", "roman"):
                    cur_raw_ans = m_let_quote.group(1)
                    cur_evidence.append(m_let_quote.group(2).strip())
                else:
                    clean_ev = re.sub(r"^(?:Location|Passage\s+[A-G]|Paragraph\s+[A-G])\s*[:\-]\s*", "", s, flags=re.I).strip()
                    if clean_ev:
                        cur_evidence.append(clean_ev)

    flush()

    # Visually verified corrections from Key.pdf pages (p04, p05, p13, p15, p16, p17, p27-28, p33-34, p45)
    # where colored/highlighted tokens were skipped or distorted by Windows OCR.
    verified_ocr_patches: dict[int, dict[int, str]] = {
        2: {1: "beetle", 16: "B", 19: "mail order", 20: "buying offices", 21: "large family", 22: "sale", 23: "E", 24: "D", 25: "F"},
        5: {14: "prescriptions", 15: "accidents", 16: "productivity", 31: "C"},
        6: {3: "lung function", 6: "D", 7: "A", 8: "F", 21: "D", 31: "B"},
        9: {23: "speech"},
        10: {12: "fuel", 19: "book"},
        12: {1: "FALSE", 5: "NOT GIVEN"},
    }
    for qn, fixed_ans in verified_ocr_patches.get(tnum, {}).items():
        if qn in qmap:
            qmap[qn]["answer"] = fixed_ans
        else:
            qmap[qn] = {"answer": fixed_ans, "evidence": "", "rawAns": fixed_ans}

    return qmap


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-ocr", action="store_true")
    args = parser.parse_args()

    pages = run_clean_ocr(VOL8_KEY_PDF, force=args.force_ocr)
    docx_info = load_vol8_docx_info()
    partitioned = partition_pages_into_tests(pages)

    all_parsed: dict[str, dict] = {}
    print("\n=== VOL 8 KEY OCR & CROSS-VALIDATION AUDIT (v2) ===")
    for tnum in range(1, 13):
        qmap = parse_vol8_test_keys(tnum, partitioned[tnum], docx_info[tnum])
        missing = [q for q in range(1, 41) if q not in qmap or not qmap[q]["answer"]]
        in_passage = sum(
            1 for q, info in qmap.items()
            if info["answer"] and (
                info["answer"].lower() in docx_info[tnum]["word_map"]
                or docx_info[tnum]["expected_types"].get(q) in ("tfng", "ynng", "roman", "letter")
            )
        )
        all_parsed[str(tnum)] = {str(k): v for k, v in sorted(qmap.items())}
        print(
            f"  Vol 8 Test {tnum:2d}: recovered={40-len(missing):2d}/40 | valid={in_passage:2d}/40 | missing={missing}"
        )

    PARSED_KEYS_PATH.write_text(json.dumps(all_parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved {PARSED_KEYS_PATH}")


if __name__ == "__main__":
    main()
