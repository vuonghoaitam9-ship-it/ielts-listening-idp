#!/usr/bin/env python3
"""
Builds standardized IELTS Reading JSON exams (Vol 7–10, 43 tests) for the IDP Web App.

Sources (Original Exams only — no Cambridge DOCX distortion mixing):
- Vol 7 (16 tests): VOL 7- ORIGINAL EXAMS/Reading/Test 1-10 & 11-16 + Key Read + giải vol 7.1-12 + Key T11 + Key T13-14 + T15/16 keys
- Vol 8 (12 tests): VOL 8 - ORIGINAL EXAMS/READING/Test 1..12 (Tets 11.pdf) + .reading-cache/vol8-parsed-keys.json + .reading-cache/vol8-image-boxes.json
- Vol 9 (9 tests):  VOL 9 - ORIGINAL EXAMS/READING/TEST {1 -R, 2-R..9-R}.docx + KEY TEST {1..9}-R.docx
- Vol 10 (6 tests): VOL 10 KEY.pdf (T1, T2, T4, T6 full keys; T3 & T5 marked honestly partial due to mismatched keys in source PDF)

Usage:
  python -u scripts/prepare-reading-data.py --skip-translate   # fast structural & key check
  python -u scripts/prepare-reading-data.py                    # full build with cached Vietnamese translations
"""

import argparse
import difflib
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pymupdf

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = PROJECT_ROOT / "public" / "data"
CACHE_DIR = PROJECT_ROOT / ".reading-cache"

VOL7_DIR = Path(r"F:\IELTS\Vol\Full Original Exam VOL 1-10\VOL 7- ORIGINAL EXAMS\Reading")
VOL8_DIR = Path(r"F:\IELTS\Vol\Full Original Exam VOL 1-10\VOL 8 - ORIGINAL EXAMS\READING")
VOL9_DIR = Path(r"F:\IELTS\Vol\Full Original Exam VOL 1-10\VOL 9 - ORIGINAL EXAMS\READING")
VOL10_PDF = Path(r"F:\IELTS\Vol\VOL 10 KEY.pdf")

VOL8_KEYS_CACHE = CACHE_DIR / "vol8-parsed-keys.json"
VOL8_BOXES_CACHE = CACHE_DIR / "vol8-image-boxes.json"
VI_TRANSLATE_CACHE = CACHE_DIR / "vi-translations.json"

VOL10_PAGE_RANGES = {
    1: (1, 15, 13),   # (start_p, end_p, key_start_p) - 1-indexed
    2: (16, 30, 27),  # p27 "KEY 10 test 2", p28 "Câu số 1..."
    3: (31, 45, 44),  # mismatched key -> marked partial
    4: (46, 61, 59),
    5: (62, 78, 74),  # mismatched key -> marked partial
    6: (79, 92, 90),
}

ROMAN_RE = re.compile(r"^(?:x|ix|iv|v?i{1,3}|xi|xii|xiii|xiv|xv)$", re.I)

STOPWORDS = {
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "but",
    "is", "are", "was", "were", "be", "been", "being", "that", "this", "these",
    "those", "by", "with", "from", "as", "into", "about", "than", "it", "its",
    "they", "their", "them", "he", "she", "his", "her", "which", "who", "whom",
    "when", "where", "why", "how", "more", "most", "some", "many", "such", "not",
    "no", "can", "could", "will", "would", "may", "might", "have", "has", "had",
    "do", "does", "did", "there", "if", "only", "also", "other", "all", "both",
}

BLANKS_ANY_RE = re.compile(
    r"(?:\(\s*(\d{1,2})\s*\)|(?<!\d)(\d{1,2}))\s*(?:[_.\u200b]{3,}|…+[_.]*|_[_\u200b]*_)"
    r"|(?:[_.\u200b]{3,}|…+[_.]*|_[_\u200b]*_)\s*(?:\(\s*(\d{1,2})\s*\)|(\d{1,2})\b)"
)


def normalize_blanks(text: str) -> str:
    """Normalize PDF/DOCX gap blanks into {{blank:N}} placeholders."""
    def repl(m: re.Match) -> str:
        n = m.group(1) or m.group(2) or m.group(3) or m.group(4)
        if not n or not (1 <= int(n) <= 40):
            return m.group(0)
        return f" {{{{blank:{int(n)}}}}} "

    # Replace spaced forms "(14) ______" or "14……" or "6 ........"
    s = BLANKS_ANY_RE.sub(repl, text)
    # Also handle glued leading blanks like "6….. was..." or "(14)_____" without space
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s+([,.;:?!])", r"\1", s)
    return s


def clean_text_line(raw: str) -> tuple[str, bool]:
    had_zwsp = "\u200b" in raw
    s = raw.replace("\u200b", "").replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s, had_zwsp


def extract_vol10_page_lines(pg: pymupdf.Page) -> list[dict]:
    """Reconstruct words cleanly from Vol 10 PDF rawdict X-offsets."""
    items = []
    for b in pg.get_text("rawdict").get("blocks", []):
        if b.get("type") != 0:
            continue
        prev_y = None
        for ln in b.get("lines", []):
            buf = []
            prev_x1 = None
            has_zwsp = False
            bold = False
            fsize_max = 0.0
            for sp in ln.get("spans", []):
                fsize = sp.get("size", 11.0) or 11.0
                fsize_max = max(fsize_max, fsize)
                if (sp.get("flags", 0) & 16) or "bold" in sp.get("font", "").lower():
                    bold = True
                for ch in sp.get("chars", []):
                    c = ch.get("c", "")
                    if c == "\u200b":
                        has_zwsp = True
                        continue
                    x0, _, x1, _ = ch["bbox"]
                    if prev_x1 is not None and x0 - prev_x1 > fsize * 0.14 and buf and not buf[-1].isspace() and not c.isspace():
                        buf.append(" ")
                    buf.append(c)
                    prev_x1 = x1
            txt = re.sub(r"\s+", " ", "".join(buf)).strip()
            if not txt:
                continue
            y0, y1 = ln["bbox"][1], ln["bbox"][3]
            dy = (y0 - prev_y) if prev_y is not None else 0.0
            prev_y = y1
            items.append({
                "kind": "line",
                "text": txt,
                "bold": bold,
                "fsize": fsize_max,
                "bullet": txt.startswith(("•", "●", "◦")) or ln["bbox"][0] >= 95,
                "dy": dy,
                "x0": ln["bbox"][0],
                "y0": y0,
                "page": pg.number + 1,
            })
    return items


def extract_pdf_stream(pdf_path: Path, max_page: int | None = None, rawdict_spacing: bool = False) -> list[dict]:
    """Extract ordered line + table + large-image items from a PDF."""
    doc = pymupdf.open(str(pdf_path))
    limit = min(len(doc), max_page) if max_page else len(doc)
    stream: list[dict] = []

    for p_idx in range(limit):
        pg = doc[p_idx]
        pno = p_idx + 1

        # Record diagram/box images on page with their vertical positions (include >=65px height for narrow Vol 8 word boxes)
        imgs = [
            im for im in pg.get_image_info(xrefs=True)
            if im["width"] >= 120 and im["height"] >= 65
        ]
        # Detect real gap-fill/note tables ONLY (never checkbox matrices A B C D or Questions wrapper frames)
        tables_found = []
        raw_pg_txt = pg.get_text("text")
        if "_" in raw_pg_txt or "…" in raw_pg_txt or ".." in raw_pg_txt:
            try:
                tf = pg.find_tables()
                for tab in tf.tables:
                    data = tab.extract()
                    if not data or len(data) < 2 or len(data[0]) < 2 or len(data[0]) > 6:
                        continue
                    non_empty_cols = sum(1 for col in zip(*data) if any((c or "").strip() for c in col))
                    flat_cells = [re.sub(r"\s+", " ", (c or "")).strip() for r in data for c in r if (c or "").strip()]
                    if non_empty_cols < 2 or not flat_cells:
                        continue
                    has_wrapper_noise = any(
                        re.search(r"\bQuestions?\s+\d+|\bChoose\s+(?:TRUE|YES|the)|\bReading\s+Passage", c, re.I)
                        for c in flat_cells
                    )
                    head_tokens = [c for c in [re.sub(r"\s+", " ", (x or "")).strip() for x in data[0]] if c]
                    is_option_matrix = head_tokens[:3] in (["A", "B", "C"], ["i", "ii", "iii"])
                    has_gap_blank = any(re.search(r"(?:\d\s*[_.…]{2,}|[_.…]{3,}|…|\(\d{1,2}\)\s*_)", c) for c in flat_cells)
                    if not has_wrapper_noise and not is_option_matrix and has_gap_blank:
                        tables_found.append({"bbox": tab.bbox, "rows": data})
            except Exception:
                pass

        def in_table(bbox) -> bool:
            x0, y0, x1, y1 = bbox
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            return any(tb["bbox"][0] - 2 <= cx <= tb["bbox"][2] + 2 and tb["bbox"][1] - 2 <= cy <= tb["bbox"][3] + 2 for tb in tables_found)

        page_items: list[dict] = []
        if rawdict_spacing:
            raw_lines = extract_vol10_page_lines(pg)
            for ln in raw_lines:
                if not in_table((ln["x0"], ln["y0"], ln["x0"] + 10, ln["y0"] + 10)):
                    page_items.append(ln)
        else:
            d = pg.get_text("dict")
            prev_y1 = None
            for b in d.get("blocks", []):
                if b.get("type") != 0:
                    continue
                for ln in b.get("lines", []):
                    bbox = ln["bbox"]
                    if in_table(bbox):
                        continue
                    raw = "".join(sp["text"] for sp in ln.get("spans", []))
                    txt, had_zwsp = clean_text_line(raw)
                    if not txt:
                        continue
                    # Filter stray standalone PDF page numbers like "1", "2" near bottom margin
                    if bbox[1] > pg.rect.height - 48 and re.fullmatch(r"\d{1,2}|Page\s*\d+", txt, re.I):
                        continue
                    bold = any((sp["flags"] & 16) or "bold" in sp.get("font", "").lower() for sp in ln.get("spans", []) if sp["text"].strip())
                    fsize = max((sp.get("size", 11.0) for sp in ln.get("spans", [])), default=11.0)
                    dy = (bbox[1] - prev_y1) if prev_y1 is not None else 0.0
                    prev_y1 = bbox[3]
                    page_items.append({
                        "kind": "line",
                        "text": txt,
                        "bold": bold,
                        "fsize": fsize,
                        "bullet": raw.lstrip().startswith("\u200b") or txt.startswith(("•", "●", "◦")) or (bbox[0] >= 95 and not bold),
                        "dy": dy,
                        "x0": bbox[0],
                        "y0": bbox[1],
                        "page": pno,
                    })

        for tb in tables_found:
            cleaned_rows = []
            for r in tb["rows"]:
                cleaned_rows.append([normalize_blanks(re.sub(r"\s+", " ", (c or "").replace("\u200b", " ")).strip()) for c in r])
            page_items.append({
                "kind": "table",
                "rows": cleaned_rows,
                "y0": tb["bbox"][1],
                "page": pno,
            })

        for idx, im in enumerate(imgs):
            page_items.append({
                "kind": "image",
                "w": im["width"],
                "h": im["height"],
                "xref": im["xref"],
                "y0": im["bbox"][1],
                "page": pno,
                "img_idx": idx,
            })

        page_items.sort(key=lambda it: it.get("y0", 0.0))
        stream.extend(page_items)

    doc.close()
    return stream


def is_heading_slot_line(s: str) -> bool:
    """Standalone Paragraph Heading placeholders like '(14) ________', '17. ________', '14…', '27....' inside passage text."""
    return bool(re.match(r"^(?:\(\s*\d{1,2}\s*\)|\d{1,2})\.?\s*(?:[_.\u200b]{2,}|…+[_.]*)$", s.strip()))


def docx_para_lines(p_el: ET.Element, ns: dict) -> tuple[list[str], bool]:
    """Extract lines from a DOCX <w:p> splitting cleanly on <w:br/> soft line breaks."""
    parts: list[str] = [""]
    had_zwsp = False
    w_t = f"{{{ns['w']}}}t"
    w_br = f"{{{ns['w']}}}br"
    w_cr = f"{{{ns['w']}}}cr"
    w_tab = f"{{{ns['w']}}}tab"
    for node in p_el.iter():
        if node.tag == w_t and node.text:
            if "\u200b" in node.text:
                had_zwsp = True
            parts[-1] += node.text
        elif node.tag in (w_br, w_cr):
            parts.append("")
        elif node.tag == w_tab:
            parts[-1] += " "
    out = []
    for raw in parts:
        cleaned, zw = clean_text_line(raw)
        had_zwsp = had_zwsp or zw
        if cleaned and not re.fullmatch(r"-{8,}", cleaned):
            out.append(cleaned)
    return out, had_zwsp


def extract_docx_stream(docx_path: Path) -> list[dict]:
    """Extract ordered line + table items from a DOCX file (Vol 9 original tests)."""
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(docx_path) as z:
        body = ET.fromstring(z.read("word/document.xml")).find("w:body", ns)

    stream: list[dict] = []
    for el in body:
        tag = el.tag.split("}")[-1]
        if tag == "p":
            sublines, had_zwsp = docx_para_lines(el, ns)
            if not sublines:
                continue
            bold = el.find(".//w:rPr/w:b", ns) is not None
            sz_el = el.find(".//w:rPr/w:sz", ns)
            fsize = int(sz_el.attrib.get(f"{{{ns['w']}}}val", "22")) / 2.0 if sz_el is not None else 11.0
            is_list = el.find(".//w:numPr", ns) is not None
            for txt in sublines:
                stream.append({
                    "kind": "line",
                    "text": txt,
                    "bold": bold,
                    "fsize": fsize,
                    "bullet": had_zwsp or is_list or txt.startswith(("•", "●", "–")),
                    "dy": 10.0,
                    "x0": 72.0,
                    "y0": 0.0,
                    "page": 1,
                })
        elif tag == "tbl":
            rows = []
            flat_paras = []
            for tr in el.findall("w:tr", ns):
                row_cells = []
                for tc in tr.findall("w:tc", ns):
                    ps = []
                    for p_el in tc.findall(".//w:p", ns):
                        sublines, _ = docx_para_lines(p_el, ns)
                        for pt in sublines:
                            ps.append(pt)
                            flat_paras.append(pt)
                    row_cells.append(normalize_blanks(" ".join(ps)))
                if any(row_cells):
                    rows.append(row_cells)
            if not rows:
                continue
            has_blank = any("{{blank:" in c for r in rows for c in r)
            # Only emit actual gap-fill / note tables as "table"; unpack List of Headings / Word Boxes / Option boxes cleanly into lines!
            if has_blank and len(rows) >= 2 and max(len(r) for r in rows) >= 2:
                stream.append({"kind": "table", "rows": rows, "y0": 0.0, "page": 1})
            else:
                for pt in flat_paras:
                    stream.append({
                        "kind": "line", "text": pt, "bold": False, "fsize": 11.0,
                        "bullet": False, "dy": 6.0, "x0": 72.0, "y0": 0.0, "page": 1, "from_box": True,
                    })
    return stream


# ---------------------------------------------------------------------------
# Split a test stream cleanly into 3 Passages (works even when PDFs omit "PASSAGE 2")
# ---------------------------------------------------------------------------

def looks_like_instruction(s: str) -> bool:
    return bool(re.match(
        r"^(?:Questions?\s+\d+|Question\s+\d+|Choose\s+(?:TRUE|YES|NO|the|appropriate|TWO|THREE|ONE|four|your)|"
        r"Do\s+the\s+following\s+statements|Complete\s+(?:the|each)|Match\s+each|Look\s+at\s+the\s+following|"
        r"Use\s+the\s+information\s+in\s+the\s+passage|"
        r"Write\s+(?:ONE|NO\s+MORE|THE\s+CORRECT|your\s+answers?)|Label\s+the\s+diagram|"
        r"(?:The\s+)?Reading\s+Passage(?:\s+[123])?\s+has\b|(?:The\s+)?text\s+has\b|"
        r"Which\s+(?:section|paragraph)|In\s+boxes?\s+\d+|NB\s+You\s+may)",
        s, re.I,
    ))


def starts_question_num(s: str) -> int | None:
    m = re.match(r"^(?:Q?(\d{1,2}))(?:\s*[-–,]\s*(\d{1,2}))?(?:\s+|\.\s*)(.+)$", s)
    if not m:
        return None
    q = int(m.group(1))
    rest = m.group(3).strip()
    if not (1 <= q <= 40):
        return None
    # Reject years like "1920 was..." or quantities "10 million..." or numbered dates "19th century"
    if q > 40 or re.match(r"^(?:million|thousand|percent|%|km|cm|mm|years?|months?|days?|hours?|minutes?|seconds?|decades?|centur|times?)\b", rest, re.I):
        return None
    return q


def segment_into_three_passages(
    stream: list[dict], vol: int, test: int, vol8_boxes: list[dict]
) -> list[dict]:
    """Split an exam's item stream into Passage 1, Passage 2, Passage 3 buckets."""
    # Map vol 8 image boxes by (page, w, h)
    box_lookup: dict[tuple[int, int, int], list[str]] = {}
    if vol == 8:
        for b in vol8_boxes:
            if b["test"] == test:
                box_lookup[(b["page"], b["w"], b["h"])] = b.get("lines", [])

    passages = [{"items": [], "pno": 1}, {"items": [], "pno": 2}, {"items": [], "pno": 3}]
    cur_p = 0
    max_q_in_passage = 0
    max_item_q_in_passage = 0
    seen_q_nums: set[int] = set()

    # Count ONLY actual section headers ("PASSAGE 2", "READING PASSAGE 3"), NEVER "Reading Passage 2 has..."!
    explicit_p2_p3 = sum(
        1 for it in stream
        if it["kind"] == "line"
        and re.match(r"^(?:READING\s+)?PASSAGE\s+[23](?:\s*[:|]?\s*(?:Read\s+the\s+text.*)?)?$", it["text"], re.I)
    )

    n = len(stream)
    for i, item in enumerate(stream):
        if item["kind"] == "image":
            if vol == 8 and not (test == 8 and item["page"] == 2):
                lines = box_lookup.get((item["page"], item["w"], item["h"]), [])
                for ln in lines:
                    passages[cur_p]["items"].append({
                        "kind": "line", "text": ln, "bold": False, "fsize": 10.5,
                        "bullet": False, "dy": 6.0, "x0": 72.0, "page": item["page"], "from_box": True,
                    })
                continue
            passages[cur_p]["items"].append(item)
            continue

        if item["kind"] == "table":
            passages[cur_p]["items"].append(item)
            for r in item["rows"]:
                for c in r:
                    for bn in re.findall(r"\{\{blank:(\d+)\}\}", c):
                        qn = int(bn)
                        seen_q_nums.add(qn)
                        max_q_in_passage = max(max_q_in_passage, qn)
                        max_item_q_in_passage = max(max_item_q_in_passage, qn)
            continue

        txt = item["text"]
        # Explicit PASSAGE 2 / 3 marker
        mp = re.match(r"^(?:READING\s+)?PASSAGE\s+([123])\b[:\s]*$", txt, re.I)
        mr_p = re.match(r"^(?:READING\s+)?PASSAGE\s+([123])\s*[:|]?\s*Read\s+the\s+text", txt, re.I)
        if mp or mr_p:
            pidx = int((mp or mr_p).group(1)) - 1
            if pidx != cur_p and pidx > cur_p:
                cur_p = pidx
                max_q_in_passage = 0
                max_item_q_in_passage = 0
            continue

        mr_r = re.match(r"^Read\s+the\s+text\s+and\s+answer\s+questions\s+(\d+)\s*[–-]\s*(\d+)", txt, re.I)
        if mr_r:
            q_start = int(mr_r.group(1))
            if 13 <= q_start <= 18 and cur_p == 0 and max_q_in_passage >= 10:
                cur_p = 1
                max_q_in_passage = 0
                max_item_q_in_passage = 0
            elif q_start >= 25 and cur_p <= 1 and max_q_in_passage >= 22:
                cur_p = 2
                max_q_in_passage = 0
                max_item_q_in_passage = 0
            continue

        # Detect Reading Passage X has N paragraphs ONLY when explicit PASSAGE 2/3 headers are absent
        if explicit_p2_p3 < 2:
            mr_has = re.match(r"^(?:The\s+)?Reading\s+Passage\s+([123])\s+has\b", txt, re.I)
            if mr_has:
                pidx = int(mr_has.group(1)) - 1
                if pidx == cur_p + 1 and ((pidx == 1 and max_q_in_passage >= 12) or (pidx == 2 and max_q_in_passage >= 24)):
                    cur_p = pidx
                    max_q_in_passage = 0
                    max_item_q_in_passage = 0

        heading_slot = is_heading_slot_line(txt)
        norm_txt = txt if heading_slot else normalize_blanks(txt)
        m_qhdr = re.match(r"^Questions?\s+(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?", txt, re.I)
        is_q_hdr = bool(m_qhdr)
        all_qs_here: list[int] = []
        actual_items_here: list[int] = []
        if m_qhdr:
            hq1 = int(m_qhdr.group(1))
            hq2 = int(m_qhdr.group(2)) if m_qhdr.group(2) else hq1
            q_start_here = hq1
            if 1 <= hq1 <= hq2 <= 40:
                all_qs_here.extend(range(hq1, hq2 + 1))
        elif not heading_slot:
            m_multi = re.match(r"^(?:Q?(\d{1,2}))\s*[-–,]\s*(\d{1,2})\b", norm_txt)
            q_start_here = starts_question_num(norm_txt)
            if m_multi and 1 <= int(m_multi.group(1)) < int(m_multi.group(2)) <= 40:
                q1, q2 = int(m_multi.group(1)), int(m_multi.group(2))
                all_qs_here.extend(range(q1, q2 + 1))
                actual_items_here.extend(range(q1, q2 + 1))
            elif q_start_here:
                all_qs_here.append(q_start_here)
                actual_items_here.append(q_start_here)
            blanks_here = [int(b) for b in re.findall(r"\{\{blank:(\d+)\}\}", norm_txt)]
            all_qs_here.extend(blanks_here)
            actual_items_here.extend(blanks_here)
        else:
            q_start_here = None
            blanks_here = []

        # Enable next-passage transition ONLY once the final question of Passage 1 (>=13) or Passage 2 (>=26)
        # has actually started appearing as a question stem/blank (never prematurely inside Q22-26 options!)
        p1_done = cur_p == 0 and (max_item_q_in_passage >= 13 or (max_q_in_passage >= 13 and heading_slot))
        p2_done = cur_p == 1 and (max_item_q_in_passage >= 26 or (max_q_in_passage >= 26 and heading_slot))

        is_option_or_q_item = (
            looks_like_instruction(txt)
            or is_q_hdr
            or item["bullet"]
            or item.get("from_box")
            or bool(blanks_here)
            or (starts_question_num(norm_txt) is not None)
            or bool(re.match(r"^(?:[A-K]\s+[a-z]|[A-K][\.\)]\s+[a-zA-Z]|(?:i{1,3}|iv|vi{0,3}|ix|x|xi|xii)[\.\):\s]\s+[A-Z])", txt))
            or bool(re.match(r"^(?:List of |Words |Box |Paragraph\s+[A-I]\b|\*|TRUE\b|FALSE\b|NOT GIVEN\b|YES\b|NO\b|KEY\b|VOL\s+\d|Choose\b|Which TWO|Below are)", txt, re.I))
        )

        is_prose_start = False
        if (p1_done or p2_done) and (heading_slot or (not is_option_or_q_item and len(txt) >= 4 and not txt[0].islower())):
            if heading_slot:
                is_prose_start = True
            else:
                last_page = passages[cur_p]["items"][-1].get("page", 1) if passages[cur_p]["items"] else 1
                next_items = [stream[k] for k in range(i + 1, min(n, i + 7)) if stream[k]["kind"] == "line"]
                next_lines = [nx["text"] for nx in next_items]
                ahead_str = " ".join(next_lines)
                immediate_opt_or_q = any(
                    nx["bullet"]
                    or re.match(r"^(?:Questions?\s+\d|List of |Choose\b|\d{1,2}[-–]\d{1,2}\b|\d{1,2}\s+[A-Z]|[B-K](?:\.|\s+)[a-z])", nx["text"])
                    for nx in next_items[:3]
                )
                # Ensure a standalone uppercase/bold passage title on same or new page triggers cleanly when prose follows
                if len(ahead_str) >= 160 and not immediate_opt_or_q and "{{blank:" not in normalize_blanks(ahead_str[:180]):
                    prev_line_txt = passages[cur_p]["items"][-1].get("text", "") if passages[cur_p]["items"] else ""
                    wrapped_q_line = (
                        item.get("page", 1) == last_page
                        and prev_line_txt
                        and not prev_line_txt.startswith("•")
                        and not prev_line_txt.rstrip().endswith((".", "?", "!", ":", ")"))
                        and len(txt) < 120
                        and not item["bold"]
                        and not txt.isupper()
                        and not any(re.match(r"^(?:A\s+[A-Z]|14\b|\(14\))", nx) for nx in next_lines[:2])
                    )
                    if not wrapped_q_line:
                        is_prose_start = True

        if is_prose_start and explicit_p2_p3 < 2:
            cur_p = min(2, cur_p + 1)
            max_q_in_passage = 0
            max_item_q_in_passage = 0

        if cur_p == 0 and max_q_in_passage >= 13 and is_q_hdr and q_start_here and q_start_here >= 14:
            cur_p = 1
            max_q_in_passage = 0
            max_item_q_in_passage = 0
        elif cur_p == 1 and max_q_in_passage >= 26 and is_q_hdr and q_start_here and q_start_here >= 27:
            cur_p = 2
            max_q_in_passage = 0
            max_item_q_in_passage = 0

        passages[cur_p]["items"].append(item)
        for qn in all_qs_here:
            if qn and (cur_p == 0 and 1 <= qn <= 15 or cur_p == 1 and 13 <= qn <= 28 or cur_p == 2 and 25 <= qn <= 40):
                seen_q_nums.add(qn)
                max_q_in_passage = max(max_q_in_passage, qn)
        for qn in actual_items_here:
            if qn and (cur_p == 0 and 1 <= qn <= 15 or cur_p == 1 and 13 <= qn <= 28 or cur_p == 2 and 25 <= qn <= 40):
                max_item_q_in_passage = max(max_item_q_in_passage, qn)

    return passages


# ---------------------------------------------------------------------------
# Parse a single Passage bucket into structured { title, subtitle, paragraphs, groups }
# ---------------------------------------------------------------------------

def parse_passage_bucket(items: list[dict], passage_num: int, vol: int, test: int) -> dict:
    """Separate prose paragraphs from question blocks inside one Passage bucket."""
    # First classify each item inside this passage as prose vs question-region
    # Rule: Once a `Questions X-Y` header OR `looks_like_instruction` appears, we are in Question mode
    # UNTIL a clear Passage Title/Paragraph `(14) ___` / `A  <long prose>` appears!
    # Also remember Cambridge format: Matching Headings (`Questions 14-20` + `List of Headings`) often sits
    # right ABOVE Passage 2's title & paragraphs!

    prose_items: list[dict] = []
    question_items: list[dict] = []
    mode = "unknown"  # "prose" or "question"
    q_seen_in_region: set[int] = set()

    for idx, it in enumerate(items):
        if it["kind"] == "image":
            question_items.append(it)
            continue
        if it["kind"] == "table":
            # Wait: Is a table prose or question? If it has {{blank:N}} or sits inside question mode, it's question_items!
            has_blank = any("{{blank:" in c for r in it["rows"] for c in r)
            if has_blank or mode == "question":
                mode = "question"
                question_items.append(it)
            else:
                prose_items.append(it)
            continue

        txt = it["text"]
        norm = txt if is_heading_slot_line(txt) else normalize_blanks(txt)
        is_q_hdr = bool(re.match(r"^Questions?\s+(\d+)", txt, re.I))
        is_heading_slot = is_heading_slot_line(txt) or bool(re.match(r"^Section\s+[A-G]\b", txt, re.I))
        is_instr = looks_like_instruction(txt)
        is_opt_header = bool(re.match(r"^(?:List of (?:Headings|Ideas|Researchers|People|Factors|Statements|Countries|Findings|Actions|Words)|Paragraphs?\s+[A-I]|You should spend about \d+ minutes)\b", txt, re.I))

        if re.match(r"^You should spend about \d+ minutes", txt, re.I):
            continue

        # Ignore Reading Passage X has N paragraphs when transitioning back from pre-passage Questions 14-20
        if is_q_hdr or (is_instr and not is_heading_slot) or is_opt_header:
            # Wait: "Reading Passage 2 has 7 paragraphs" is part of Matching Headings instruction, keep in question_items!
            mode = "question"
            question_items.append(it)
            continue

        if is_heading_slot:
            mode = "prose"
            prose_items.append(it)
            continue

        # Check transition FROM pre-passage Questions (like List of Headings / List of People) TO Passage prose!
        if mode == "question":
            # Does this line look like the Passage Title or first labeled Paragraph `A   Text...`?
            is_labeled_para = bool(re.match(r"^([A-I])(?:\s*[\.\):]|\s{1,4})(?=[A-Z‘“'\"]|[a-z])", txt)) and len(txt) > 90
            # Note: sometimes option "A   the role of..." is short or starts lowercase, whereas Paragraph A is multi-sentence / > 140 chars!
            if is_labeled_para and len(txt) > 130:
                mode = "prose"
                prose_items.append(it)
                continue
            # Standalone single-letter paragraph label A / Section A followed by long prose
            if re.fullmatch(r"[A-I]", txt) and idx + 1 < len(items) and items[idx + 1]["kind"] == "line" and len(items[idx + 1]["text"]) > 130:
                mode = "prose"
                prose_items.append(it)
                continue
            # Bold Passage Title appearing AFTER List of Headings (only when we haven't collected prose paragraphs yet!)
            if not prose_items and not it["bullet"] and not it.get("from_box") and not re.match(r"^(?:[ivx]{1,4}\s|[A-K][\s\.]|\d{1,2}\b)", txt):
                # Peek ahead 3 items to see if prose follows
                ahead = " ".join(items[k].get("text", "") for k in range(idx + 1, min(len(items), idx + 5)) if items[k]["kind"] == "line")
                if len(ahead) > 220 and "{{blank:" not in normalize_blanks(ahead) and not re.match(r"^\d{1,2}\s", ahead):
                    mode = "prose"
                    prose_items.append(it)
                    continue

            # What if we are ALREADY in a Passage's trailing Questions section vs a blank prose line?
            # If we have no prose yet and this is clearly long prose (>160 chars, no blank, not an option/statement)
            if not prose_items and len(txt) > 160 and "{{blank:" not in norm and starts_question_num(norm) is None and not re.match(r"^[A-K]\s", txt):
                mode = "prose"
                prose_items.append(it)
                continue

            question_items.append(it)
            for b in re.findall(r"\{\{blank:(\d+)\}\}", norm):
                q_seen_in_region.add(int(b))
        else:
            # Handle omitted "Questions 14-16" header when prose jumps straight into bold/optioned MCQ (e.g. V7 T01 Q14-16)
            qn_direct = starts_question_num(norm)
            if qn_direct and ((passage_num == 1 and 1 <= qn_direct <= 14) or (passage_num == 2 and 14 <= qn_direct <= 27) or (passage_num == 3 and 26 <= qn_direct <= 40)):
                next_t = items[idx + 1]["text"] if idx + 1 < len(items) and items[idx + 1]["kind"] == "line" else ""
                if it["bold"] or re.match(r"^[A-D](?:\.|\s+)[A-Za-z]", next_t) or "{{blank:" in norm:
                    mode = "question"
                    question_items.append(it)
                    continue
            mode = "prose"
            prose_items.append(it)

    # Assemble clean prose title, subtitle, and paragraphs from prose_items
    title, subtitle, paragraphs = assemble_prose_paragraphs(prose_items, passage_num)

    # Parse question_items into typed Question Groups and flat questions
    groups, questions = parse_question_groups(question_items, passage_num, vol, test)

    return {
        "passageNumber": passage_num,
        "title": title,
        "subtitle": subtitle,
        "paragraphs": paragraphs,
        "groups": groups,
        "questions": questions,
    }


def assemble_prose_paragraphs(prose_items: list[dict], passage_num: int) -> tuple[str, str, list[dict]]:
    lines = [it for it in prose_items if it["kind"] == "line"]
    # First 1-2 short non-labeled lines (before long prose or Paragraph A) form Title & optional Subtitle
    title = ""
    subtitle = ""
    body_start = 0

    for i, it in enumerate(lines[:5]):
        t = it["text"]
        if re.match(r"^\(\d+\)\s*_{3,}", t) or re.match(r"^([A-I])(?:\s*[\.\):]|\s+)(?=[A-Z‘“'\"])", t) and len(t) > 95:
            break
        if len(t) > 165:
            break
        if not title:
            title = t
            body_start = i + 1
        elif not subtitle and len(t) < 130 and not re.match(r"^[A-I]\s+[A-Z]", t):
            # Could be wrapped second line of title or subtitle
            if len(title) < 55 and not title.endswith((".", "?", "!")):
                if it.get("fsize", 11) >= lines[i - 1].get("fsize", 11) - 0.5 and it["bold"] == lines[i - 1]["bold"]:
                    title = f"{title} {t}"
                else:
                    subtitle = t
            else:
                subtitle = t
            body_start = i + 1
        else:
            break

    if not title:
        title = f"Reading Passage {passage_num}"

    # Group body lines into paragraphs
    paragraphs: list[dict] = []
    cur_label: str | None = None
    cur_buf: list[str] = []
    cur_slot_label: str | None = None

    def flush_para():
        nonlocal cur_label, cur_buf, cur_slot_label
        if not cur_buf:
            return
        text = " ".join(cur_buf)
        # Rejoin hyphenated line-break artifacts ONLY when obvious? Safer: normalize spaces cleanly.
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            cur_buf = []
            return
        pid = cur_label or cur_slot_label or f"P{len(paragraphs) + 1}"
        # Avoid duplicate IDs if malformed
        existing_ids = {p["id"] for p in paragraphs}
        if pid in existing_ids:
            pid = f"P{len(paragraphs) + 1}"
        para = {"id": pid, "text": text}
        if cur_label:
            para["label"] = cur_label
        elif cur_slot_label:
            para["label"] = cur_slot_label
        paragraphs.append(para)
        cur_label = None
        cur_slot_label = None
        cur_buf = []

    body_lines = lines[body_start:]
    for idx, it in enumerate(body_lines):
        t = it["text"]
        if re.match(r"^Read\s+the\s+text\s+and\s+answer", t, re.I):
            continue

        # Check heading slot marker like "(14) ___________________" or "14...." or "27…"
        if is_heading_slot_line(t):
            m_slot = re.search(r"(\d{1,2})", t)
            flush_para()
            if m_slot:
                cur_slot_label = f"Q{m_slot.group(1)}"
            continue

        # Standalone single letter paragraph label: "A", "B", ... on its own line
        if re.fullmatch(r"[A-I]", t):
            flush_para()
            cur_label = t
            continue

        # Leading labeled paragraph: "A  The...", "A.Birds...", "AWhat is...", "I    In comparing..." (Vol 7 T12 "I " typo -> "I")
        m_lbl = re.match(r"^([A-I])(?:\.\s*|\s+)([A-Z‘“'\"\d\(].+)$", t)
        # Also catch glued "AWhat", "BSince", "CAlthough" from DOCX/PDF extraction:
        m_glued = re.match(r"^([A-I])([A-Z][a-z]{2,}.+)$", t) if not m_lbl else None
        # Careful not to match English words starting with "A " like "A survey of..." or "I think..." or "A few..."!
        if m_lbl:
            cand_lbl, rest = m_lbl.group(1), m_lbl.group(2)
            first_word = rest.split()[0] if rest.split() else ""
            # Distinguish real section label ("A", "B", ...) from English article "A <Capitalized Proper Noun>" or "I <Verb>"
            prev_lbl = paragraphs[-1].get("label", "@") if paragraphs else "@"
            is_next_label = not paragraphs or (len(cand_lbl) == 1 and len(prev_lbl) == 1 and ord(cand_lbl) == ord(prev_lbl) + 1)
            is_caps_start = bool(re.match(r"^[A-Z‘“'\"]", rest)) and cand_lbl != "I"
            # Check: in "A 19th-century..." or "A French...", rest starts with capital letter too, so require either cand_lbl != 'A' or is_next_label or period "A." or two+ spaces in raw, OR bold font!
            is_explicit_sep = bool(re.match(r"^[A-I](?:\.|\s{2,})", t))
            if cand_lbl != "A" and cand_lbl != "I":
                # Wait: could a wrapped line randomly start with "B... "? Unlikely if previous ended with period or has space, and even less likely unless chronological!
                if is_explicit_sep or is_next_label or (len(cur_buf) == 0) or (cur_buf and cur_buf[-1].rstrip().endswith((".", "?", "!", "”", '"'))):
                    flush_para()
                    cur_label = cand_lbl
                    cur_buf.append(rest)
                    continue
            elif is_explicit_sep or (len(paragraphs) == 0 and len(cur_buf) == 0 and is_next_label):
                flush_para()
                cur_label = cand_lbl
                cur_buf.append(rest)
                continue
        elif m_glued:
            cand_lbl, rest = m_glued.group(1), m_glued.group(2)
            # Only split glued "AWhat" if it's NOT a real English word ("Although", "According", "American", "Australian", ...)
            # Real words have lowercase letter 2! "AWhat" has UPPERCASE W right after capital A!
            if rest[0].isupper() and not (t[:2] in ("US", "UK", "UN", "EU", "AI", "IQ", "DNA", "NASA")):
                flush_para()
                cur_label = cand_lbl
                cur_buf.append(rest)
                continue

        # Footnote line like "*Malagasy: of Madagascar" or "______"
        if t.startswith("*") and len(t) < 140 and idx >= len(body_lines) - 2:
            flush_para()
            continue

        # Normal paragraph boundary check (when previous line ended a sentence and vertical gap `dy` or short previous line)
        prev_ended = bool(cur_buf and cur_buf[-1].rstrip().endswith((".", "?", "!", "”", "’", '"', "'")))
        prev_short = bool(cur_buf and len(cur_buf[-1]) < 62 and prev_ended)
        big_dy = it.get("dy", 0) > (it.get("fsize", 11) * 1.15)
        if cur_buf and (big_dy or prev_short) and not cur_label and not cur_slot_label and re.match(r"^[A-Z‘“'\d\"\(]", t):
            flush_para()

        cur_buf.append(t)

    flush_para()
    return title, subtitle, paragraphs


# ---------------------------------------------------------------------------
# Question Group & Type Classifier (handles all IDP Reading types!)
# ---------------------------------------------------------------------------

def infer_group_type(instr: str, sample_lines: list[str], has_table: bool, has_image: bool) -> str:
    il = instr.lower()
    if has_table:
        return "table_completion"
    if has_image or "label the diagram" in il:
        return "diagram_label"
    if (
        "choose true" in il
        or ("true" in il and ("false" in il or "not given" in il or "agrees with the information" in il))
        or any(re.search(r"\bTRUE\s+FALSE\s+NOT GIVEN\b", s) for s in sample_lines)
    ):
        return "tfng"
    if (
        "choose yes" in il
        or ("yes" in il and ("no" in il or "not given" in il or "claims of the writer" in il or "views of the writer" in il))
        or any(re.search(r"\bYES\s+NO\s+NOT GIVEN\b", s) for s in sample_lines)
    ):
        return "ynng"
    if "using the list of words" in il or "from the box" in il or "word box" in il or "phrases, a-" in il or "list of words" in il:
        return "summary_box"
    roman_opts = sum(1 for s in sample_lines if re.match(r"^(?:i{1,3}|iv|vi{0,3}|ix|x|xi|xii)[\.\):\s]\s*[A-Za-z]", s, re.I))
    is_notes_or_gap = "one word" in il or "no more than" in il or "complete the" in il or any("{{blank:" in normalize_blanks(s) for s in sample_lines)
    if "list of headings" in il or "correct heading" in il or (not is_notes_or_gap and "choose the correct answer" not in il and roman_opts >= 2):
        return "matching_headings"
    if "which paragraph contains" in il or "which section contains" in il or any(re.fullmatch(r"A\s+B\s+C\s+D(?:\s+[E-K])+", s.strip()) for s in sample_lines):
        return "matching_info"
    if "correct ending" in il or "ending, a-" in il:
        return "matching_sentence_endings"
    if "choose two" in il or "choose three" in il:
        return "mcq_multi"
    if (
        "match each" in il
        or "following statements" in il
        or "list of researchers" in il
        or "list of people" in il
        or "following people" in il
        or "following ideas" in il
        or "use the information" in il
        or "correct researcher" in il
        or re.search(r"(?:correct|appropriate)\s+letters?,\s*[a-k](?:\s*,\s*[a-k]|\s+or\s+[a-k]|\s*[–-]\s*[a-k])", il)
        or "in boxes" in il
    ):
        return "matching_features"
    if "answer the questions" in il and "write no more than" in il and not any("{{blank:" in s for s in sample_lines):
        return "short_answer"
    if "one word" in il or "no more than" in il or "complete the" in il or any("{{blank:" in normalize_blanks(s) for s in sample_lines):
        return "gap_fill"
    if "choose the correct letter" in il or "choose the correct answer" in il:
        return "mcq_single"
    return "mcq_single"


def extract_word_limit(instr: str) -> str | None:
    m = re.search(r"(ONE WORD(?: ONLY| AND/OR A NUMBER)?|NO MORE THAN (?:TWO|THREE|ONE) WORDS?(?: AND/OR A NUMBER)?)", instr, re.I)
    return m.group(1).upper() if m else None


def parse_question_groups(
    question_items: list[dict], passage_num: int, vol: int, test: int
) -> tuple[list[dict], dict[int, dict]]:
    """Parse question items in one Passage into typed ReadingQuestionGroup[] and Q dict."""
    # Split into raw chunks starting on `Questions X–Y` OR standalone instruction block when PDF omitted `Questions X-Y`
    chunks: list[dict] = []
    cur: dict | None = None

    def new_chunk(q_range: list[int] | None = None):
        nonlocal cur
        cur = {"range": q_range, "items": []}
        chunks.append(cur)

    for it in question_items:
        if it["kind"] != "line":
            if not cur:
                new_chunk(None)
            cur["items"].append(it)
            continue

        txt = it["text"]
        # Remove trailing \b so glued DOCX headers like "Questions 10–13Complete the summary" split cleanly!
        m_hdr = re.match(r"^Questions?\s+(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?(.*)$", txt, re.I)
        if m_hdr:
            q1 = int(m_hdr.group(1))
            q2 = int(m_hdr.group(2)) if m_hdr.group(2) else q1
            if 1 <= q1 <= 40 and q1 <= q2 <= 40:
                new_chunk([q1, q2])
                rest = m_hdr.group(3).strip()
                if rest:
                    cur["items"].append({**it, "text": rest})
                continue

        # Handle omitted "Questions 1-5" header (e.g. V7 T16 Q1-5 starts directly with "Choose TRUE...")
        if not cur and looks_like_instruction(txt):
            new_chunk(None)
        elif cur and cur["range"] is not None:
            # Check if a brand new "Choose TRUE..." / "Complete..." starts WITHOUT "Questions X-Y" right after last Q
            pass
        if not cur:
            new_chunk(None)
        cur["items"].append(it)

    groups: list[dict] = []
    q_dict: dict[int, dict] = {}

    for g_idx, ch in enumerate(chunks):
        raw_items = ch["items"]
        line_texts = [x["text"] for x in raw_items if x["kind"] == "line"]
        tables = [x["rows"] for x in raw_items if x["kind"] == "table"]
        images = [x for x in raw_items if x["kind"] == "image"]

        # Collect instruction lines cleanly EVEN IF an option box ("A Project STAR...") came right before "Choose the correct letter..."
        instr_lines = []
        body_items = []
        seen_first_q = False
        for x in raw_items:
            if x["kind"] != "line":
                seen_first_q = True
                body_items.append(x)
                continue
            t = x["text"]
            norm_t = normalize_blanks(t)
            is_q_start = starts_question_num(norm_t) is not None or "{{blank:" in norm_t
            if is_q_start:
                seen_first_q = True
            if not seen_first_q:
                if looks_like_instruction(t) or re.match(
                    r"^(?:NB\b|Write\b|Choose\b|Do the\b|Look at\b|Match\b|Use the\b|(?:The\s+)?Reading Passage|(?:The\s+)?text has|In boxes|choose\s+(?:FALSE|NO|NOT)|or\s+(?:choose\s+)?NOT\s+GIVEN|statement\s+contradicts|GIVEN\s+if)",
                    t,
                    re.I,
                ):
                    instr_lines.append(t)
                    continue
                elif len(instr_lines) > 0 and len(t) < 160 and instr_lines[-1][-1] not in ".!?" and not re.match(r"^(?:[A-K]|[ivx]{1,4})[\.\s)]", t):
                    instr_lines.append(t)
                    continue
            body_items.append(x)

        instruction = " ".join(instr_lines).strip()
        q_type = infer_group_type(instruction, line_texts, bool(tables), bool(images))
        word_limit = extract_word_limit(instruction)

        body_lines = [x for x in body_items if x["kind"] == "line"]
        options, remaining_lines = extract_group_options(q_type, body_lines, ch["range"], instruction)

        missing_box_note: str | None = None
        if not options and q_type in ("matching_sentence_endings", "summary_box") and vol == 10:
            rng_m = re.search(r"A\s*[–-]\s*([D-K])", instruction, re.I)
            end_let = rng_m.group(1).upper() if rng_m else "I"
            options = [
                {"key": chr(c), "text": f"Phương án {chr(c)} (PDF gốc Vol 10 thiếu bảng mô tả)"}
                for c in range(ord("A"), ord(end_let) + 1)
            ]
            missing_box_note = f"PDF gốc Vol 10 không in kèm bảng mô tả lựa chọn A–{end_let} cho nhóm câu này; hãy chọn chữ cái tương ứng."

        # Auto-heal V9 T1 DOCX source typo ("6 ..." inside Questions 7-13 when blank 7 is missing and 6 isn't in range)
        if ch["range"] and q_type in ("gap_fill", "summary_box", "table_completion", "diagram_label"):
            r1, r2 = ch["range"]
            present = {
                int(b) for x in remaining_lines for b in re.findall(r"\{\{blank:(\d+)\}\}", normalize_blanks(x["text"]))
            }
            if (r1 - 1) in present and r1 not in present:
                for x in remaining_lines:
                    x["text"] = re.sub(
                        rf"(?<!\d){r1 - 1}(?=\s*(?:[_.\u200b]{{2,}}|…))", str(r1), x["text"], count=1
                    )

        # Fix range if None (e.g. V7 T16 Q1-5)
        q_items_parsed, summary_text = parse_questions_from_lines(
            q_type, remaining_lines, tables, options, ch["range"]
        )

        # Ensure every Q in declared range OR extracted blanks exists
        q_nums = sorted(set(q_items_parsed.keys()) | (set(range(ch["range"][0], ch["range"][1] + 1)) if ch["range"] else set()))
        if ch["range"]:
            r1, r2 = ch["range"]
            for qn in q_nums:
                if qn not in q_items_parsed:
                    prompt_lbl = f"Section/Paragraph for Question {qn}" if q_type == "matching_headings" else f"Question {qn}"
                    q_items_parsed[qn] = {
                        "number": qn,
                        "prompt": prompt_lbl,
                        "type": q_type,
                    }
                    if options and q_type in ("matching_headings", "matching_info", "matching_features", "matching_sentence_endings"):
                        q_items_parsed[qn]["options"] = options

        if not q_nums:
            continue

        gid = f"v{vol}-t{test}-p{passage_num}-g{g_idx + 1}"
        group_obj: dict = {
            "id": gid,
            "questionRange": [min(q_nums), max(q_nums)],
            "type": q_type,
            "instruction": instruction or f"Questions {min(q_nums)}–{max(q_nums)}",
        }
        if word_limit:
            group_obj["wordLimit"] = word_limit
        if missing_box_note:
            group_obj["missingBoxNote"] = missing_box_note
        if options:
            group_obj["options"] = options
        if summary_text:
            group_obj["bodyText"] = summary_text
        if tables:
            headers = tables[0][0] if len(tables[0]) > 1 else []
            rows = tables[0][1:] if len(tables[0]) > 1 else tables[0]
            group_obj["table"] = {"headers": headers, "rows": rows}
        if images:
            diag_url = save_diagram_png(vol, test, g_idx + 1, images[0])
            if diag_url:
                group_obj["diagramUrl"] = diag_url

        if q_type == "mcq_multi":
            m_cnt = re.search(r"choose\s+(TWO|THREE|FOUR)", instruction, re.I)
            group_obj["selectCount"] = {"TWO": 2, "THREE": 3, "FOUR": 4}.get((m_cnt.group(1).upper() if m_cnt else "TWO"), 2)

        group_obj["questions"] = [q_items_parsed[qn] for qn in q_nums]
        groups.append(group_obj)
        for qn in q_nums:
            q_dict[qn] = q_items_parsed[qn]

    return groups, q_dict


def save_diagram_png(vol: int, test: int, idx: int, img_meta: dict) -> str | None:
    if vol == 7:
        sub = "Test 1-10" if test <= 10 else "Test 11-16"
        fp = VOL7_DIR / sub / f"Test {test}.pdf"
    elif vol == 8:
        fp = VOL8_DIR / ("Tets 11.pdf" if test == 11 else f"Test {test}.pdf")
    else:
        return None
    doc = pymupdf.open(str(fp))
    raw = doc.extract_image(img_meta["xref"])
    doc.close()
    out_dir = PUBLIC_DATA / f"vol-{vol}" / f"test-{test}"
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = f"diagram-{idx}.png"
    (out_dir / fname).write_bytes(raw["image"])
    return f"./data/vol-{vol}/test-{test}/{fname}"


def extract_group_options(
    q_type: str, body_lines: list[dict], q_range: list[int] | None, instruction: str = ""
) -> tuple[list[dict], list[dict]]:
    """Extract List of Headings / Word Box / List of People / Endings when shared at group level."""
    if q_type not in (
        "matching_headings", "matching_info", "matching_features",
        "matching_sentence_endings", "summary_box", "mcq_multi"
    ):
        return [], body_lines

    options: list[dict] = []
    remaining: list[dict] = []
    auto_idx = 0

    idx = 0
    while idx < len(body_lines):
        it = body_lines[idx]
        idx += 1
        t = it["text"].strip()
        if not t:
            continue
        if re.match(r"^(?:List[s]? of (?:Headings|Ideas|Researchers|People|Factors|Endings|Words|Animals|Events|Paragraphs)|Choose TWO|Below are some)$", t, re.I):
            continue
        # Ignore horizontal checkbox grid headers like "A B C D E F G H" or "i ii iii iv"
        if re.fullmatch(r"(?:[A-K]\s+){2,}[A-K]", t) or re.fullmatch(r"(?:[ivx]{1,4}\s+){2,}[ivx]{1,4}", t, re.I):
            continue

        # Merge standalone Roman numeral ("i") or letter ("A") with its description on the immediately following line
        if (
            (q_type == "matching_headings" and re.fullmatch(r"x|ix|iv|v?i{1,3}|xi|xii|xiii", t, re.I))
            or (q_type in ("matching_features", "matching_sentence_endings", "summary_box") and re.fullmatch(r"[A-K]\.?", t))
        ) and idx < len(body_lines):
            nxt = body_lines[idx]["text"].strip()
            if nxt and not looks_like_instruction(nxt) and starts_question_num(normalize_blanks(nxt)) is None and not re.fullmatch(r"[A-K]\.?|x|ix|iv|v?i{1,3}|xi|xii|xiii", nxt, re.I):
                t = f"{t} {nxt}"
                idx += 1

        # Strip leading box title like "List of Researchers A Joseph Allen B Craig..."
        t_clean = re.sub(
            r"^(?:List[s]?\s+of\s+[A-Za-z\s]+?:?|Word\s+Box:?|List\s+of\s+Words:?)\s+(?=(?:[A-K]|i{1,3}|iv|v|vi{1,3}|ix|x|xi|xii)\b)",
            "",
            t,
            flags=re.I,
        ).strip()

        # Multi-pair line inside summary word box / unpacked table row
        if it.get("from_box") or t_clean != t or re.findall(r"(?:^|\s)([A-K])\s+[a-z][^\n]{2,}?(?=\s+[A-K]\s+[a-z]|\s*$)", t_clean):
            if q_type in ("summary_box", "matching_headings", "matching_features", "matching_sentence_endings"):
                if q_type == "matching_headings":
                    parts = re.split(r"\s+(?=(?:x|ix|iv|v?i{1,3}|xi|xii|xiii)(?:\.)?\s+[A-Z])", t_clean, flags=re.I)
                else:
                    parts = re.split(r"\s+(?=[A-K](?:\.)?\s+[A-Za-z])", t_clean)
                if len(parts) > 1:
                    matched_all = True
                    temp_opts = []
                    for p in parts:
                        mo = re.match(r"^([ivx]{1,4}|[A-K])\.?\s+(.+)$", p.strip(), re.I)
                        if mo and (ROMAN_RE.match(mo.group(1)) if q_type == "matching_headings" else len(mo.group(1)) == 1):
                            k = mo.group(1).lower() if q_type == "matching_headings" else mo.group(1).upper()
                            temp_opts.append({"key": k, "text": mo.group(2).strip()})
                        else:
                            matched_all = False
                    if matched_all and temp_opts:
                        options.extend(temp_opts)
                        continue

        # Bullet MCQ_MULTI option without A-E letter prefix (Vol 8 style `\u200bThey can affect...`)
        if q_type == "mcq_multi" and it.get("bullet") and not re.match(r"^[A-G][\.\s\)]", t_clean):
            key = chr(ord("A") + auto_idx)
            auto_idx += 1
            options.append({"key": key, "text": t_clean})
            # Check wrapped continuation of bullet line without bullet marker
            while idx < len(body_lines) and not body_lines[idx].get("bullet") and len(body_lines[idx]["text"]) < 45 and not re.match(r"^(?:Questions?\s+\d|\d{1,2}\s+[A-Z])", body_lines[idx]["text"]):
                options[-1]["text"] += " " + body_lines[idx]["text"].strip()
                idx += 1
            continue

        # Standard option line: `i  Title` or `A. Feature` or `A Feature` (must NOT start with question number `14 ...`)
        norm_t = normalize_blanks(t_clean)
        if starts_question_num(norm_t) is None and "{{blank:" not in norm_t and not re.match(r"^\d{1,2}[-–]\d{1,2}\b", t_clean):
            if q_type == "matching_headings":
                mr = re.match(r"^(x|ix|iv|v?i{1,3}|xi|xii|xiii)[\.\:\)]\s*(.+)$|^(x|ix|iv|v?i{1,3}|xi|xii|xiii)\s+(.+)$", t_clean, re.I)
                if mr:
                    rk = (mr.group(1) or mr.group(3)).lower()
                    rt = (mr.group(2) or mr.group(4)).strip()
                    if rt:
                        options.append({"key": rk, "text": rt})
                        continue
            else:
                ml = re.match(r"^([A-K])(?:\.|\)|\s+)\s*(.+)$", t_clean)
                if ml and not (ml.group(1) == "A" and len(ml.group(2)) > 110 and q_type == "summary_box"):
                    if q_type != "summary_box" or len(ml.group(2)) < 45 or it.get("from_box"):
                        options.append({"key": ml.group(1).upper(), "text": ml.group(2).strip()})
                        continue
            # Wrapped continuation of previous option
            if options and not remaining and (not t_clean[0].isdigit()) and len(t_clean) < 105:
                options[-1]["text"] += " " + t_clean
                continue

        remaining.append(it)

    # Always ensure `matching_info` exposes its paragraph letter options A..end_let
    if q_type == "matching_info" and len(options) < 2:
        rng_m = re.search(r"A\s*[–-]\s*([D-K])", instruction + " " + " ".join(it["text"] for it in body_lines[:4]), re.I)
        end_let = rng_m.group(1).upper() if rng_m else "H"
        options = [{"key": chr(c), "text": f"Paragraph {chr(c)}"} for c in range(ord("A"), ord(end_let) + 1)]

    cleaned_rem = [it for it in remaining if not re.fullmatch(r"[A-K]|TRUE|FALSE|NOT GIVEN|YES|NO", it["text"].strip())]
    return options, cleaned_rem


def parse_questions_from_lines(
    q_type: str,
    lines: list[dict],
    tables: list[list[list[str]]],
    shared_options: list[dict],
    q_range: list[int] | None,
) -> tuple[dict[int, dict], str | None]:
    """Parse individual question items (1..40) or prose summary with {{blank:N}} placeholders."""
    questions: dict[int, dict] = {}
    body_text_parts: list[str] = []

    if q_type in ("summary_box", "gap_fill", "table_completion", "diagram_label"):
        # Check if body consists of prose/notes containing {{blank:N}} rather than numbered stems
        merged_lines = [normalize_blanks(x["text"]) for x in lines]
        joined = "\n".join(merged_lines)
        all_blanks = [int(b) for b in re.findall(r"\{\{blank:(\d+)\}\}", joined)]
        if tables:
            for tb in tables:
                for row in tb:
                    for cell in row:
                        all_blanks.extend(int(b) for b in re.findall(r"\{\{blank:(\d+)\}\}", cell))
        # Preserve readable summary/notes text for inline IDP blank rendering
        if merged_lines and not tables:
            body_text = "\n".join(merged_lines)
            if q_range:
                body_text = re.sub(
                    r"\{\{blank:(\d+)\}\}",
                    lambda m: m.group(0) if q_range[0] <= int(m.group(1)) <= q_range[1] else m.group(1),
                    body_text,
                )
        else:
            body_text = None

        # Also extract per-question contextual snippet around each {{blank:N}} for grading/review prompt display
        full_src = "\n".join(merged_lines + [" | ".join(r) for tb in tables for r in tb])
        sentences = re.split(r"(?<=[.!?\n])\s+", full_src)
        for bn in sorted(set(all_blanks)):
            if q_range and not (q_range[0] <= bn <= q_range[1]):
                continue
            match_sent = next((s.strip() for s in sentences if f"{{{{blank:{bn}}}}}" in s), f"Complete blank {bn}")
            questions[bn] = {"number": bn, "prompt": match_sent, "type": q_type}
        if not questions and merged_lines:
            # Handle lines prefixed with number "23 Prompt..." without dots blank
            for ln in merged_lines:
                mq = starts_question_num(ln)
                if mq:
                    questions[mq] = {"number": mq, "prompt": re.sub(rf"^{mq}\s*\.?\s*", "", ln), "type": q_type}
        return questions, body_text

    # MCQ Multi ("21-22 Which TWO... A ... B ...")
    if q_type == "mcq_multi" and q_range:
        prompt_parts = []
        opts = list(shared_options)
        for it in lines:
            t = it["text"]
            m_o = re.match(r"^([A-G])(?:\.|\)|\s+)\s*(.+)$", t)
            if m_o and not re.match(r"^\d{1,2}\s*[–-]\s*\d{1,2}", t):
                opts.append({"key": m_o.group(1).upper(), "text": m_o.group(2).strip()})
            else:
                prompt_parts.append(re.sub(r"^\d{1,2}\s*[-–,]\s*\d{1,2}\s*", "", t).strip())
        prompt_str = " ".join(p for p in prompt_parts if p).strip() or f"Questions {q_range[0]}–{q_range[1]}"
        siblings = list(range(q_range[0], q_range[1] + 1))
        for qn in siblings:
            questions[qn] = {
                "number": qn,
                "prompt": prompt_str,
                "type": "mcq_multi",
                "options": opts,
                "siblingNumbers": siblings,
            }
        return questions, None

    # Numbered items (TFNG, YNNG, MCQ Single, Matching Headings/Info/Features/Endings, Short Answer)
    cur_q: int | None = None
    cur_stem: list[str] = []
    cur_opts: list[dict] = []

    def flush_q():
        nonlocal cur_q, cur_stem, cur_opts
        if cur_q is None:
            return
        # Fallback for PDF MCQs whose 4 choices omit "A." / bullet markers after "?" or incomplete stem (e.g. V10 T5 Q38-40)
        if q_type == "mcq_single" and len(cur_opts) < 2 and len(cur_stem) >= 5:
            stem_end = 1
            for k, seg in enumerate(cur_stem):
                if seg.rstrip().endswith(("?", ":")):
                    stem_end = k + 1
                    break
            tail = cur_stem[stem_end:]
            if 2 <= len(tail) <= 4:
                cur_opts = [{"key": chr(ord("A") + idx), "text": opt_t} for idx, opt_t in enumerate(tail)]
                cur_stem = cur_stem[:stem_end]
        stem = re.sub(r"\s+", " ", " ".join(cur_stem)).strip()
        q_obj: dict = {
            "number": cur_q,
            "prompt": stem or f"Question {cur_q}",
            "type": q_type,
        }
        if cur_opts:
            q_obj["options"] = cur_opts
        elif q_type in ("matching_headings", "matching_info", "matching_features", "matching_sentence_endings") and shared_options:
            q_obj["options"] = shared_options
        questions[cur_q] = q_obj
        cur_q = None
        cur_stem = []
        cur_opts = []

    auto_opt_idx = 0
    for it in lines:
        t = it["text"]
        if re.match(r"^(?:TRUE|FALSE|NOT GIVEN|YES|NO)\s*$", t, re.I):
            continue
        qn = starts_question_num(t)
        if qn is not None and (not q_range or q_range[0] <= qn <= q_range[1] or qn in (q_range[0], q_range[1])):
            flush_q()
            cur_q = qn
            auto_opt_idx = 0
            rest = re.sub(rf"^{qn}\s*\.?\s*", "", t).strip()
            # Check if inline A..D option started on same line
            cur_stem.append(rest)
            continue

        if cur_q is not None:
            if q_type == "mcq_single":
                # Handle PDF lines packing two MCQ options on one line ("A.foo B.bar" or "psychology. D.express...")
                pieces = re.split(r"\s+(?=[B-D]\.(?:\s|[A-Za-z]))", t)
                if len(pieces) > 1:
                    for pc in pieces:
                        pc = pc.strip()
                        mo = re.match(r"^([A-D])(?:\.|\)|\s+)\s*(.+)$", pc)
                        if mo:
                            cur_opts.append({"key": mo.group(1).upper(), "text": mo.group(2).strip()})
                        elif cur_opts:
                            cur_opts[-1]["text"] += " " + pc
                    continue
                m_opt = re.match(r"^([A-D])(?:\.|\)|\s+)\s*(.+)$", t)
                if m_opt:
                    cur_opts.append({"key": m_opt.group(1).upper(), "text": m_opt.group(2).strip()})
                    continue
                if it.get("bullet") and not re.match(r"^[A-D]\.", t):
                    key = chr(ord("A") + auto_opt_idx)
                    auto_opt_idx += 1
                    cur_opts.append({"key": key, "text": t})
                    continue
                if cur_opts:
                    cur_opts[-1]["text"] += " " + t
                    continue
            cur_stem.append(t)

    flush_q()
    return questions, None


# ---------------------------------------------------------------------------
# Key Loaders Across Vol 7, Vol 8, Vol 9, Vol 10
# ---------------------------------------------------------------------------

def load_all_vol7_keys() -> dict[int, dict[int, dict]]:
    """Load keys & native explanations/evidence for Vol 7 Tests 1..16."""
    keys: dict[int, dict[int, dict]] = {t: {} for t in range(1, 17)}

    # 1. Key Read VOL 7 (T1-T10).pdf
    doc_k = pymupdf.open(str(VOL7_DIR / "Test 1-10" / "Key Read VOL 7 (T1-T10).pdf"))
    full_t = "\n".join(pg.get_text("text") for pg in doc_k)
    doc_k.close()
    blocks = re.split(r"TEST\s+(\d+)\s*:", full_t)
    for i in range(1, len(blocks), 2):
        tnum = int(blocks[i])
        body = blocks[i + 1]
        # Split inline multi-column numbered items: "1. Raindrops   11. NOT GIVEN   21. YES"
        parts = re.split(r"(?:^|\s{2,}|\n)(\d{1,2})\s*\.\s*", body)
        for j in range(1, len(parts), 2):
            qn = int(parts[j])
            ans = re.sub(r"\s+", " ", parts[j + 1]).strip()
            ans = re.split(r"\s+(?=PASSAGE|TEST|\d{1,2}\.)", ans)[0].strip()
            if 1 <= tnum <= 10 and 1 <= qn <= 40:
                keys[tnum][qn] = {"answer": ans, "evidence": "", "vi_ev": "", "vi_expl": ""}

    # 2. Enrich T1-T11 + supply T12 from giải vol 7.{1..12}.docx
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    for tnum in range(1, 13):
        fp = VOL7_DIR / "Explaination Read VOL 7" / f"giải vol 7.{tnum}.docx"
        if not fp.exists():
            continue
        with zipfile.ZipFile(fp) as z:
            body = ET.fromstring(z.read("word/document.xml")).find("w:body", ns)
        paras = ["".join(t.text or "" for t in p.findall(".//w:t", ns)).strip() for p in body.findall(".//w:p", ns)]
        paras = [p for p in paras if p]

        cur_qs: list[int] = []
        ans_val = ""
        ev_val = ""
        para_notes: list[str] = []
        in_para = False

        def commit_v7():
            nonlocal cur_qs, ans_val, ev_val, para_notes
            for qn in cur_qs:
                slot = keys[tnum].setdefault(qn, {"answer": "", "evidence": "", "vi_ev": "", "vi_expl": ""})
                if not slot["answer"] and ans_val:
                    slot["answer"] = ans_val
                if ev_val:
                    slot["evidence"] = ev_val
                if para_notes:
                    slot["paraphrase_note"] = "; ".join(para_notes)
            cur_qs = []
            ans_val = ""
            ev_val = ""
            para_notes = []

        for p in paras:
            mq = re.match(r"^Câu\s*hỏi\s*(\d{1,2})(?:\s*[-–&,]\s*(\d{1,2}))?", p, re.I)
            if mq:
                commit_v7()
                q1 = int(mq.group(1))
                q2 = int(mq.group(2)) if mq.group(2) else q1
                cur_qs = list(range(q1, q2 + 1)) if q2 >= q1 else [q1]
                in_para = False
                continue
            if cur_qs:
                ma = re.match(r"^Đáp\s*án\s*:\s*(.+)$", p, re.I)
                if ma:
                    ans_val = ma.group(1).strip()
                    in_para = False
                    continue
                me = re.match(r"^Câu\s*trong\s*passage[^:]*:\s*(.+)$", p, re.I)
                if me:
                    ev_val = me.group(1).strip().strip('“”"')
                    in_para = False
                    continue
                if re.match(r"^So\s*sánh\s*paraphrase", p, re.I):
                    in_para = True
                    continue
                if in_para and not p.startswith(("PASSAGE", "Dịch", "Câu hỏi")):
                    para_notes.append(p)
        commit_v7()

    # 3. Override T11 answers cleanly from Key Test 11.pdf (40/40 Câu số format)
    d11 = pymupdf.open(str(VOL7_DIR / "Test 11-16" / "Key Test 11.pdf"))
    t11 = "\n".join(pg.get_text("text") for pg in d11)
    d11.close()
    c_blocks = re.split(r"Câu\s*số\s*(\d{1,2}(?:\s*[-–]\s*\d{1,2})?)\s*:\s*", t11)
    for i in range(1, len(c_blocks), 2):
        spec = c_blocks[i]
        val = c_blocks[i + 1].splitlines()[0].strip()
        nums = [int(x) for x in re.findall(r"\d+", spec)]
        qs = list(range(nums[0], nums[1] + 1)) if len(nums) == 2 else nums
        for qn in qs:
            keys[11].setdefault(qn, {"answer": "", "evidence": "", "vi_ev": "", "vi_expl": ""})["answer"] = val

    # 4. T13-T14 from Key VOL 7 TEST 13 và 14.pdf (full answers + quotes + VI translations + explanations!)
    d13 = pymupdf.open(str(VOL7_DIR / "Explaination Read VOL 7" / "Key VOL 7 TEST 13 và 14.pdf"))
    t13_text = "\n".join(pg.get_text("text") for pg in d13)
    d13.close()
    m_split = re.split(r"VOL\s*7\s*TEST\s*(13|14)\b", t13_text, flags=re.I)
    for i in range(1, len(m_split), 2):
        tnum = int(m_split[i])
        sec = m_split[i + 1]
        lines = [re.sub(r"\s+", " ", l).strip() for l in sec.splitlines() if l.strip()]
        # Ignore compact key summary grid at bottom of T13/T14 and parse detailed entries "1 - ink ... Đoạn chứa đáp án: ... Giải thích: ..."
        cur_qs = []
        mode = None
        en_buf, vi_buf, ex_buf = [], [], []

        def flush13():
            nonlocal cur_qs, en_buf, vi_buf, ex_buf, mode
            for qn in cur_qs:
                keys[tnum][qn] = {
                    "answer": keys[tnum].get(qn, {}).get("answer", ""),
                    "evidence": " ".join(en_buf).strip(),
                    "vi_ev": " ".join(vi_buf).strip(),
                    "vi_expl": " ".join(ex_buf).strip(),
                }
            cur_qs = []
            en_buf, vi_buf, ex_buf = [], [], []
            mode = None

        for ln in lines:
            mq = re.match(r"^(\d{1,2}(?:\s*-\s*\d{1,2})?)\s*[-–.:]\s*(.+)$", ln)
            if mq and not re.match(r"^(?:19|20)\d{2}", ln):
                qn_list = [int(x) for x in re.findall(r"\d+", mq.group(1))]
                if all(1 <= x <= 40 for x in qn_list):
                    flush13()
                    cur_qs = list(range(qn_list[0], qn_list[1] + 1)) if len(qn_list) == 2 else qn_list
                    for qn in cur_qs:
                        keys[tnum][qn] = {"answer": mq.group(2).strip(), "evidence": "", "vi_ev": "", "vi_expl": ""}
                    mode = None
                    continue
            if re.match(r"^Đoạn chứa đáp án", ln, re.I):
                mode = "ev"
                continue
            if re.match(r"^Giải thích", ln, re.I):
                mode = "ex"
                continue
            if re.match(r"^(?:Câu hỏi|PASSAGE\s+[123])$", ln, re.I):
                mode = None
                continue
            if cur_qs:
                if mode == "ev":
                    if any(ch in ln for ch in "ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ"):
                        vi_buf.append(ln)
                    else:
                        en_buf.append(ln)
                elif mode == "ex":
                    ex_buf.append(ln)
        flush13()

    # 5. T15 from Test 15.pdf p12-14 (including red 0xff0000 inline answer spans for Q8-13!)
    d15 = pymupdf.open(str(VOL7_DIR / "Test 11-16" / "Test 15.pdf"))
    t15_lines = []
    for pno in range(11, len(d15)):
        for b in d15[pno].get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                full = "".join(sp["text"] for sp in ln["spans"]).strip()
                reds = [sp["text"].strip() for sp in ln["spans"] if sp["color"] not in (0, 0x15191E, 0x060606, 0x222222) and sp["text"].strip()]
                if full:
                    t15_lines.append((full, reds))
    d15.close()
    cur_q = None
    cur_ev = []
    for full, reds in t15_lines:
        mq = re.match(r"^(\d{1,2})\s*(?:[-–.:]\s*(.*)|(\.[A-C]))$", full)
        if mq and 1 <= int(mq.group(1)) <= 40:
            if cur_q:
                keys[15][cur_q]["evidence"] = " ".join(cur_ev).strip()
            cur_q = int(mq.group(1))
            rest = (mq.group(2) or mq.group(3) or "").strip(" .")
            if rest and ":" in rest and cur_q <= 26:
                ans_part, ev_part = rest.split(":", 1)
                keys[15][cur_q] = {"answer": ans_part.strip(), "evidence": "", "vi_ev": "", "vi_expl": ""}
                cur_ev = [ev_part.strip()]
            elif rest and ":" in rest:
                ans_part, ev_part = rest.split(":", 1)
                keys[15][cur_q] = {"answer": ans_part.strip(), "evidence": "", "vi_ev": "", "vi_expl": ""}
                cur_ev = [ev_part.strip()]
            else:
                ans_part = rest.split(":", 1)[0].strip() if ":" in rest else rest
                keys[15][cur_q] = {"answer": reds[0] if reds else ans_part, "evidence": "", "vi_ev": "", "vi_expl": ""}
                cur_ev = [rest]
        elif cur_q:
            if reds and (not keys[15][cur_q]["answer"] or len(keys[15][cur_q]["answer"]) > 30):
                keys[15][cur_q]["answer"] = reds[0]
            cur_ev.append(full)
    if cur_q:
        keys[15][cur_q]["evidence"] = " ".join(cur_ev).strip()

    # 6. T16 from Test 16.pdf p12-13 (including full-sentence answers on Q23-26 diffed against prompt)
    d16 = pymupdf.open(str(VOL7_DIR / "Test 11-16" / "Test 16.pdf"))
    t16_text = "\n".join(d16[pno].get_text("text") for pno in range(11, len(d16)))
    d16.close()
    cur_q = None
    cur_ev = []
    for raw_ln in t16_text.splitlines():
        ln = re.sub(r"\s+", " ", raw_ln).strip()
        if not ln:
            continue
        mq = re.match(
            r"^(\d{1,2})\s*(?:[-–]\s*)?(?:(TRUE|FALSE|NOT GIVEN|YES|NO|[A-H]|[ivx]{1,4}|[a-z-]+)\s*[-–:.]\s*(.*)|([A-Z].+))$",
            ln,
        )
        if mq and 1 <= int(mq.group(1)) <= 40:
            if cur_q:
                keys[16][cur_q]["evidence"] = " ".join(cur_ev).strip()
            cur_q = int(mq.group(1))
            ans_tok = (mq.group(2) or "").strip()
            ev_or_sent = (mq.group(3) or mq.group(4) or "").strip()
            keys[16][cur_q] = {"answer": ans_tok or ev_or_sent, "evidence": "", "vi_ev": "", "vi_expl": "", "filled_sentence": ev_or_sent if not ans_tok else ""}
            cur_ev = [ev_or_sent] if ans_tok else []
        elif cur_q:
            cur_ev.append(ln)
    if cur_q:
        keys[16][cur_q]["evidence"] = " ".join(cur_ev).strip()

    return keys


def load_vol9_keys(test_num: int, passages: list[dict]) -> dict[int, dict]:
    """Load Vol 9 keys (TEST 1..9-R.docx) mapping col-per-passage accurately including mcq_multi siblings."""
    fp = VOL9_DIR / "KEY - EXPLAINATION" / f"KEY TEST {test_num}-R.docx"
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(fp) as z:
        body = ET.fromstring(z.read("word/document.xml")).find("w:body", ns)

    out: dict[int, dict] = {}
    tbls = body.findall(".//w:tbl", ns)
    if not tbls:
        # Format like KEY TEST 1-R.docx ("Câu số 1:\nFALSE")
        txt = "\n".join("".join(t.text or "" for t in p.findall(".//w:t", ns)).strip() for p in body.findall(".//w:p", ns))
        blocks = re.split(r"Câu\s*số\s*(\d{1,2}(?:\s*[-–&,]\s*\d{1,2})?)\s*:\s*", txt)
        for i in range(1, len(blocks), 2):
            val = next((l.strip() for l in blocks[i + 1].splitlines() if l.strip() and l.strip() != "..."), "")
            nums = [int(x) for x in re.findall(r"\d+", blocks[i])]
            qs = list(range(nums[0], nums[1] + 1)) if len(nums) == 2 else nums
            for qn in qs:
                out[qn] = {"answer": val, "evidence": "", "vi_ev": "", "vi_expl": ""}
        return out

    rows = tbls[0].findall("w:tr", ns)
    cols = [[] for _ in range(3)]
    for r in rows[1:]:
        for c_idx, tc in enumerate(r.findall("w:tc", ns)[:3]):
            for p_el in tc.findall(".//w:p", ns):
                pt = "".join(t.text or "" for t in p_el.findall(".//w:t", ns)).strip()
                if pt:
                    cols[c_idx].append(pt)

    # Map each column to slots of that passage (collapsing mcq_multi siblings into 1 slot when len(col) < len(qs)!)
    for p_idx, p_obj in enumerate(passages[:3]):
        col_vals = cols[p_idx] if p_idx < len(cols) else []
        slots: list[list[int]] = []
        seen_sib: set[int] = set()
        for grp in p_obj["groups"]:
            if grp["type"] == "mcq_multi" and len(grp["questions"]) > 1:
                nums = [q["number"] for q in grp["questions"]]
                if len(col_vals) < len(p_obj["questions"]):
                    slots.append(nums)
                    seen_sib.update(nums)
                    continue
            for q in grp["questions"]:
                if q["number"] not in seen_sib:
                    slots.append([q["number"]])

        # Wait: if Passage has 2 mcq_multi pairs (len(slots) matches len(col_vals)) or even singletons:
        for idx, slot_qs in enumerate(slots):
            val = col_vals[idx] if idx < len(col_vals) else ""
            # Handle packed answer like "A, C" or "A/D" or "B&E" for multi slot, OR pair-wise
            if len(slot_qs) > 1:
                parts = re.findall(r"\b([A-G])\b", val.upper())
                if parts:
                    val_joined = ", ".join(sorted(set(parts)))
                    for qn in slot_qs:
                        out[qn] = {"answer": val_joined, "evidence": "", "vi_ev": "", "vi_expl": ""}
                    continue
            for qn in slot_qs:
                out[qn] = {"answer": val, "evidence": "", "vi_ev": "", "vi_expl": ""}

    return out


def load_vol10_keys(test_num: int, doc10: pymupdf.Document) -> dict[int, dict]:
    """Load valid keys ONLY for Vol 10 Tests 1, 2, 4, 6; return {} for T3 & T5 (mismatched source keys)."""
    if test_num in (3, 5):
        return {}
    _, end_p, key_start_p = VOL10_PAGE_RANGES[test_num]
    lines: list[str] = []
    for pno in range(key_start_p - 1, end_p):
        lines.extend(x["text"] for x in extract_vol10_page_lines(doc10[pno]))

    txt = "\n".join(lines)
    blocks = re.split(r"Câu\s*số\s*(\d{1,2}(?:\s*[-–&,]\s*\d{1,2})?)\s*:\s*", txt)
    out: dict[int, dict] = {}
    for i in range(1, len(blocks), 2):
        val = next((l.strip() for l in blocks[i + 1].splitlines() if l.strip() and not l.strip().startswith(("...", "PASSAGE"))), "")
        nums = [int(x) for x in re.findall(r"\d+", blocks[i])]
        qs = list(range(nums[0], nums[1] + 1)) if len(nums) == 2 else nums
        for qn in qs:
            out[qn] = {"answer": val, "evidence": "", "vi_ev": "", "vi_expl": ""}
    return out


# ---------------------------------------------------------------------------
# Answer Cleaning, Accepted Variants, Verbatim Evidence Grounding & VI Generation
# ---------------------------------------------------------------------------

def canonicalize_answer(raw_ans: str, q_meta: dict) -> tuple[str, list[str]]:
    """Return canonical answer + list of valid accepted answers matching question type."""
    q_type = q_meta["type"]
    s = re.sub(r"\s+", " ", raw_ans or "").strip(" .;:\t")
    if not s:
        return "", []

    # Fix filled-sentence answer in Vol 7 T16 Q23-26 using diff against prompt blank!
    if q_meta.get("type") == "gap_fill" and len(s.split()) > 5 and "{{blank:" in q_meta.get("prompt", ""):
        pr = q_meta["prompt"]
        # Match surrounding prefix/suffix words around {{blank:N}}
        m_pre_suf = re.match(r"^(.*?)\{\{blank:\d+\}\}(.*)$", pr)
        if m_pre_suf:
            pre = m_pre_suf.group(1).strip().split()[-3:]
            suf = m_pre_suf.group(2).strip().split()[:3]
            pat = ""
            if pre:
                pat += re.escape(" ".join(pre)) + r"\s+"
            pat += r"([A-Za-z0-9'-]+(?:\s+[A-Za-z0-9'-]+){0,2})"
            if suf:
                pat += r"\s+" + re.escape(" ".join(suf))
            md = re.search(pat, s, re.I)
            if md:
                s = md.group(1).strip()

    if q_type in ("tfng", "ynng"):
        parts = [re.sub(r"[^A-Z]", "", p.upper()) for p in re.split(r"[/,|]", s) if p.strip()]
        canonical_tok = ""
        variants: list[str] = []
        mapping = (
            {
                "TRUE": ("TRUE", "T"), "T": ("TRUE", "T"),
                "FALSE": ("FALSE", "F"), "F": ("FALSE", "F"),
                "NOTGIVEN": ("NOT GIVEN", "NG"), "NG": ("NOT GIVEN", "NG"),
            }
            if q_type == "tfng"
            else {
                "YES": ("YES", "Y"), "Y": ("YES", "Y"),
                "NO": ("NO", "N"), "N": ("NO", "N"),
                "NOTGIVEN": ("NOT GIVEN", "NG"), "NG": ("NOT GIVEN", "NG"),
            }
        )
        for p in parts:
            if p in mapping:
                canon, abbr = mapping[p]
                if not canonical_tok:
                    canonical_tok = canon
                for v in (canon, abbr):
                    if v not in variants:
                        variants.append(v)
        if canonical_tok:
            return canonical_tok, variants

    if q_type == "matching_headings":
        # Strip trailing label words ("vi A vital source..." -> "vi")
        tok = re.split(r"[\s.:–-]+", s)[0].lower()
        # Handle OCR confusion ii / II / 11
        tok = {"1": "i", "11": "ii", "111": "iii", "l": "i", "ll": "ii", "lll": "iii"}.get(tok, tok)
        if ROMAN_RE.match(tok):
            return tok, [tok]

    if q_type in ("mcq_single", "matching_info", "matching_features", "matching_sentence_endings", "summary_box"):
        # Strip trailing description ("C is embodied", "D wood", "B — Malcolm Douglas", "A. Birds often...")
        m_let = re.match(r"^([A-K])(?:\s*$|\s*[.:–—-]|\s+[a-zA-Z])", s)
        if m_let:
            ch = m_let.group(1).upper()
            return ch, [ch]
        if len(s) == 1 and s.upper().isalpha():
            ch = s.upper()
            return ch, [ch]

    if q_type == "mcq_multi":
        letters = sorted(set(re.findall(r"\b([A-G])\b", s.upper())))
        if letters:
            joined = ", ".join(letters)
            return joined, letters

    # Gap fill / table / diagram / short answer: support "/" or "," alternatives like "seven years, 7 years"
    alts = [a.strip() for a in re.split(r"\s*/\s*|\s*,\s*(?=[A-Za-z0-9])", s) if a.strip() and len(a.strip()) <= 35]
    # Preserve normal number commas like "1,000"
    if re.search(r"\d,\d{3}", s):
        alts = [a.strip() for a in re.split(r"\s*/\s*", s) if a.strip()]
    if not alts:
        alts = [s]
    canonical = alts[0]
    variants = list(dict.fromkeys(alts))
    return canonical, variants


def split_into_sentences(text: str) -> list[str]:
    # Clean sentence splitter preserving abbreviations moderately
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9‘“'\"])", text)
    return [p.strip() for p in parts if p.strip()]


def content_tokens(text: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-z0-9'-]+", text.lower())
        if len(w) > 2 and w not in STOPWORDS
    }


def locate_verbatim_evidence(
    passage: dict,
    q_meta: dict,
    raw_evidence: str,
    canonical_ans: str,
) -> tuple[str, str, str]:
    """
    Find exact verbatim sentence(s) inside passage paragraphs.
    Guarantees `evidenceQuote in paragraph['text']` == True and accurate `evidenceLocation`.
    """
    paras = passage["paragraphs"]
    if not paras:
        return "", "", ""

    q_type = q_meta["type"]
    ev_clean = re.sub(r"^(?:Paragraph|Passage|Section)\s+[A-I]\s*[:\-]\s*", "", raw_evidence or "", flags=re.I).strip()

    # Check if key explicitly restricts paragraph ID like "C" for matching_info/headings
    target_pid: str | None = None
    if q_type == "matching_info" and len(canonical_ans) == 1 and canonical_ans.isalpha():
        target_pid = canonical_ans.upper()
    elif q_type in ("matching_headings",) and isinstance(q_meta.get("prompt"), str):
        mp = re.search(r"\bParagraph\s+([A-I])\b|\bSection\s+([A-I])\b", q_meta["prompt"], re.I)
        if mp:
            target_pid = (mp.group(1) or mp.group(2)).upper()

    search_tokens = content_tokens(ev_clean) | content_tokens(q_meta.get("prompt", ""))
    ans_toks = content_tokens(canonical_ans) if q_type in ("gap_fill", "table_completion", "diagram_label", "short_answer") else set()
    # Add selected option text tokens for MCQ/matching!
    if canonical_ans and q_meta.get("options"):
        ans_keys = [k.strip() for k in canonical_ans.split(",")]
        for opt in q_meta["options"]:
            if opt["key"].upper() in [ak.upper() for ak in ans_keys]:
                search_tokens |= content_tokens(opt["text"])

    ev_norm = re.sub(r"\W+", " ", ev_clean.lower()).strip()

    best_score = -1.0
    best_para = paras[0]
    best_sent_idx = 0
    best_quote = split_into_sentences(paras[0]["text"])[0] if paras[0]["text"] else ""

    for p in paras:
        if target_pid and p["id"].upper() != target_pid and any(x["id"].upper() == target_pid for x in paras):
            continue
        sents = split_into_sentences(p["text"])
        if not sents:
            continue
        for si, sent in enumerate(sents):
            sent_low = sent.lower()
            s_toks = content_tokens(sent)
            overlap = len(s_toks & search_tokens)
            ans_bonus = 4.0 * len(s_toks & ans_toks)
            if canonical_ans and q_type in ("gap_fill", "table_completion", "diagram_label", "short_answer") and canonical_ans.lower() in sent_low:
                ans_bonus += 6.0

            seq_score = 0.0
            if len(ev_norm) >= 20:
                sn = re.sub(r"\W+", " ", sent_low).strip()
                if ev_norm[:40] in sn or sn[:40] in ev_norm:
                    seq_score += 20.0
                else:
                    seq_score += 8.0 * difflib.SequenceMatcher(None, ev_norm[:120], sn[:120]).ratio()

            total = overlap * 1.6 + ans_bonus + seq_score
            if total > best_score:
                best_score = total
                best_para = p
                best_sent_idx = si
                best_quote = sent

    # Verify exact substring invariant!
    if best_quote not in best_para["text"]:
        # Fallback: first sentence of best_para
        sents = split_into_sentences(best_para["text"])
        best_quote = sents[0] if sents else best_para["text"][:220]
        best_sent_idx = 0

    lbl = best_para.get("label") or best_para["id"].replace("P", "")
    loc = f"Đoạn {lbl}, câu {best_sent_idx + 1}"
    return best_para["id"], loc, best_quote


def translate_batch_vi(texts: list[str], cache: dict[str, str]) -> dict[str, str]:
    """Translate unique English evidence quotes to natural Vietnamese with persistent JSON cache."""
    missing = [t for t in dict.fromkeys(texts) if t and t not in cache]
    if not missing:
        return cache

    print(f"Translating {len(missing)} unique English evidence sentences to Vietnamese...")
    SEP = "\n###SPLIT###\n"
    batch: list[str] = []
    batch_len = 0

    def send_batch(items: list[str]):
        if not items:
            return
        payload = SEP.join(items)
        url = (
            "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q="
            + urllib.parse.quote(payload)
        )
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                translated_full = "".join(seg[0] for seg in data[0] if seg and seg[0])
                parts = [p.strip() for p in translated_full.split("###SPLIT###")]
                if len(parts) == len(items):
                    for src, dst in zip(items, parts):
                        cache[src] = dst
                    return
                break
            except Exception:
                time.sleep(1.0 * (attempt + 1))

        # Single-item fallback if split count mismatched or transient error
        for src in items:
            for attempt in range(2):
                try:
                    u1 = (
                        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q="
                        + urllib.parse.quote(src)
                    )
                    with urllib.request.urlopen(urllib.request.Request(u1, headers={"User-Agent": "Mozilla/5.0"}), timeout=15) as resp:
                        d1 = json.loads(resp.read().decode("utf-8"))
                    cache[src] = "".join(seg[0] for seg in d1[0] if seg and seg[0]).strip()
                    break
                except Exception:
                    time.sleep(0.6)
            cache.setdefault(src, src)

    processed = 0
    for txt in missing:
        if len(batch) >= 12 or batch_len + len(txt) > 2600:
            send_batch(batch)
            processed += len(batch)
            if processed % 120 == 0:
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                VI_TRANSLATE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"  translated {processed}/{len(missing)}...")
            batch = []
            batch_len = 0
            time.sleep(0.12)
        batch.append(txt)
        batch_len += len(txt)

    if batch:
        send_batch(batch)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    VI_TRANSLATE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  done translating all {len(missing)} items.")
    return cache


def build_concise_explanation_vi(q_meta: dict, ans: str, loc: str, raw_key_info: dict) -> str:
    """Create direct, 1-2 sentence Vietnamese explanation covering paraphrase / logic / elimination."""
    native_expl = re.sub(r"\s+", " ", raw_key_info.get("vi_expl", "")).strip()
    if native_expl and len(native_expl) >= 18:
        return native_expl

    q_type = q_meta["type"]
    note = re.sub(r"\s+", " ", raw_key_info.get("paraphrase_note", "")).strip()
    paraphrase_hint = f" ({note})" if note else ""

    if q_type == "tfng":
        if ans == "TRUE":
            return f"Đúng (TRUE) — Thông tin tại {loc} khẳng định trùng khớp ý với phát biểu trong câu hỏi{paraphrase_hint}."
        if ans == "FALSE":
            return f"Sai (FALSE) — Dữ kiện tại {loc} trái ngược trực tiếp với nội dung mà câu hỏi nêu ra{paraphrase_hint}."
        return f"Không đề cập (NOT GIVEN) — Bài đọc quanh {loc} chỉ nêu ngữ cảnh liên quan, không có chi tiết xác nhận hay bác bỏ phát biểu này."
    if q_type == "ynng":
        if ans == "YES":
            return f"Đồng ý (YES) — Quan điểm tác giả thể hiện ở {loc} hoàn toàn trùng với nhận định trong câu hỏi{paraphrase_hint}."
        if ans == "NO":
            return f"Trái quan điểm (NO) — Tác giả tại {loc} lập luận ngược lại với nhận định của câu hỏi{paraphrase_hint}."
        return f"Không có thông tin (NOT GIVEN) — Quanh {loc} tác giả không đưa ra đánh giá hay khẳng định về ý này."
    if q_type in ("gap_fill", "table_completion", "diagram_label", "short_answer", "summary_box"):
        return f"Đối chiếu câu hỏi với ngữ cảnh tại {loc} để điền \"{ans}\"{paraphrase_hint}."
    if q_type == "matching_headings":
        return f"Ý chính bao trùm toàn bộ {loc} tương ứng tiêu đề {ans}{paraphrase_hint}; các tiêu đề khác chỉ nêu chi tiết phụ hoặc sai trọng tâm."
    if q_type == "matching_info":
        return f"Chi tiết được hỏi xuất hiện trực tiếp trong đoạn {ans} ({loc}){paraphrase_hint}."
    if q_type in ("mcq_single", "mcq_multi", "matching_features", "matching_sentence_endings"):
        return f"Thông tin tại {loc} khớp trực tiếp với lựa chọn {ans}{paraphrase_hint}; các phương án còn lại sai lệch chi tiết hoặc không được nhắc tới."
    return f"Căn cứ trực tiếp tại {loc}, đáp án chính xác là {ans}{paraphrase_hint}."


# ---------------------------------------------------------------------------
# Curated Academic Reading Core Flashcards (60 high-yield IELTS Reading cards)
# ---------------------------------------------------------------------------

CORE_READING_CARDS: list[dict] = [
    {"word": "corroborate", "phonetic": "/kəˈrɒb.ə.reɪt/", "meaningVi": "chứng thực, củng cố bằng chứng", "partOfSpeech": "verb", "paraphrases": ["confirm", "support the claim", "verify"], "exampleEn": "Archaeological findings corroborate early written accounts of the settlement.", "exampleVi": "Các phát hiện khảo cổ chứng thực những ghi chép ban đầu về khu định cư."},
    {"word": "unprecedented", "phonetic": "/ʌnˈpres.ɪ.den.tɪd/", "meaningVi": "chưa từng có tiền lệ", "partOfSpeech": "adj", "paraphrases": ["never seen before", "first time", "unmatched"], "exampleEn": "Global temperatures rose at an unprecedented rate during that decade.", "exampleVi": "Nhiệt độ toàn cầu tăng với tốc độ chưa từng có trong thập kỷ đó."},
    {"word": "disparity", "phonetic": "/dɪˈspær.ə.ti/", "meaningVi": "sự chênh lệch, khác biệt rõ rệt", "partOfSpeech": "noun", "paraphrases": ["gap", "inequality", "difference"], "exampleEn": "The study highlights a stark disparity between rural and urban access.", "exampleVi": "Nghiên cứu chỉ ra sự chênh lệch rõ rệt giữa nông thôn và thành thị."},
    {"word": "mitigate", "phonetic": "/ˈmɪt.ɪ.ɡeɪt/", "meaningVi": "giảm nhẹ, làm dịu bớt tác hại", "partOfSpeech": "verb", "paraphrases": ["reduce the impact", "alleviate", "lessen"], "exampleEn": "Coastal wetlands help mitigate the destructive force of storm surges.", "exampleVi": "Vùng ngập nước ven biển giúp giảm nhẹ sức tàn phá của bão triều."},
    {"word": "ubiquitous", "phonetic": "/juːˈbɪk.wɪ.təs/", "meaningVi": "có mặt ở khắp nơi, phổ biến rộng", "partOfSpeech": "adj", "paraphrases": ["found everywhere", "widespread", "omnipresent"], "exampleEn": "Single-use plastics became ubiquitous within half a century.", "exampleVi": "Nhựa dùng một lần trở nên phổ biến khắp nơi chỉ trong nửa thế kỷ."},
    {"word": "refute", "phonetic": "/rɪˈfjuːt/", "meaningVi": "bác bỏ (giả thuyết, lập luận)", "partOfSpeech": "verb", "paraphrases": ["disprove", "rebut", "challenge a theory"], "exampleEn": "Subsequent experiments refuted the belief that memory is fixed at birth.", "exampleVi": "Các thí nghiệm sau đó đã bác bỏ niềm tin rằng trí nhớ cố định từ khi sinh."},
    {"word": "exacerbate", "phonetic": "/ɪɡˈzæs.ə.beɪt/", "meaningVi": "làm trầm trọng thêm", "partOfSpeech": "verb", "paraphrases": ["worsen", "aggravate", "intensify"], "exampleEn": "Deforestation exacerbated seasonal flooding across the river basin.", "exampleVi": "Phá rừng làm tình trạng ngập lụt theo mùa trong lưu vực sông thêm trầm trọng."},
    {"word": "catalyst", "phonetic": "/ˈkæt.əl.ɪst/", "meaningVi": "chất xúc tác, nhân tố thúc đẩy", "partOfSpeech": "noun", "paraphrases": ["trigger", "driving force", "spark"], "exampleEn": "The invention of the printing press acted as a catalyst for literacy.", "exampleVi": "Phát minh máy in đóng vai trò chất xúc tác cho việc biết chữ."},
    {"word": "negligible", "phonetic": "/ˈneɡ.lɪ.dʒə.bəl/", "meaningVi": "không đáng kể, rất nhỏ", "partOfSpeech": "adj", "paraphrases": ["insignificant", "minimal", "marginal"], "exampleEn": "The sensor had a negligible effect on the bird's flight speed.", "exampleVi": "Cảm biến ảnh hưởng không đáng kể tới tốc độ bay của chim."},
    {"word": "plausible", "phonetic": "/ˈplɔː.zə.bəl/", "meaningVi": "hợp lý, có vẻ đáng tin", "partOfSpeech": "adj", "paraphrases": ["credible", "reasonable explanation", "believable"], "exampleEn": "Climate shifts offer a plausible explanation for the migration.", "exampleVi": "Biến đổi khí hậu là lời giải thích hợp lý cho cuộc di cư."},
    {"word": "rudimentary", "phonetic": "/ˌruː.dɪˈmen.tər.i/", "meaningVi": "sơ khai, thô sơ, cơ bản", "partOfSpeech": "adj", "paraphrases": ["basic", "primitive", "early form"], "exampleEn": "Early navigators relied on rudimentary astronomical charts.", "exampleVi": "Các thủy thủ thời kỳ đầu dựa vào bản đồ thiên văn thô sơ."},
    {"word": "proliferate", "phonetic": "/prəˈlɪf.ə.reɪt/", "meaningVi": "sinh sôi, gia tăng nhanh chóng", "partOfSpeech": "verb", "paraphrases": ["multiply rapidly", "mushroom", "expand quickly"], "exampleEn": "Research centres began to proliferate during the late nineteenth century.", "exampleVi": "Các trung tâm nghiên cứu tăng nhanh vào cuối thế kỷ XIX."},
    {"word": "intrinsic", "phonetic": "/ɪnˈtrɪn.zɪk/", "meaningVi": "vốn có, nội tại, bản chất", "partOfSpeech": "adj", "paraphrases": ["inherent", "built-in", "essential part"], "exampleEn": "Play is considered an intrinsic element of cognitive development.", "exampleVi": "Vui chơi được xem là yếu tố vốn có trong phát triển nhận thức."},
    {"word": "ambiguous", "phonetic": "/æmˈbɪɡ.ju.əs/", "meaningVi": "mơ hồ, có thể hiểu nhiều nghĩa", "partOfSpeech": "adj", "paraphrases": ["unclear", "open to interpretation", "vague"], "exampleEn": "The fossil record remains ambiguous regarding exact ancestry.", "exampleVi": "Hồ sơ hóa thạch vẫn còn mơ hồ về nguồn gốc chính xác."},
    {"word": "erratic", "phonetic": "/ɪˈræt.ɪk/", "meaningVi": "thất thường, không ổn định", "partOfSpeech": "adj", "paraphrases": ["unpredictable", "irregular", "inconsistent"], "exampleEn": "Erratic rainfall patterns threatened traditional farming calendars.", "exampleVi": "Lượng mưa thất thường đe dọa lịch canh tác truyền thống."},
    {"word": "scrutinize", "phonetic": "/ˈskruː.tɪ.naɪz/", "meaningVi": "xem xét kỹ lưỡng, soi xét", "partOfSpeech": "verb", "paraphrases": ["examine closely", "inspect", "analyse in detail"], "exampleEn": "Auditors scrutinized centuries of shipping manifests.", "exampleVi": "Các nhà nghiên cứu xem xét kỹ lưỡng hàng thế kỷ sổ vận tải tàu."},
    {"word": "stagnate", "phonetic": "/stæɡˈneɪt/", "meaningVi": "trì trệ, dậm chân tại chỗ", "partOfSpeech": "verb", "paraphrases": ["stop growing", "remain static", "level off"], "exampleEn": "After rapid growth, productivity began to stagnate in the 1990s.", "exampleVi": "Sau giai đoạn tăng nhanh, năng suất bắt đầu chững lại thập niên 1990."},
    {"word": "precursor", "phonetic": "/priːˈkɜː.sər/", "meaningVi": "tiền thân, dấu hiệu báo trước", "partOfSpeech": "noun", "paraphrases": ["forerunner", "ancestor", "early version"], "exampleEn": "Signal drums were a precursor to long-distance telegraphy.", "exampleVi": "Trống hiệu là tiền thân của điện báo đường dài."},
    {"word": "consensus", "phonetic": "/kənˈsen.səs/", "meaningVi": "sự đồng thuận chung", "partOfSpeech": "noun", "paraphrases": ["general agreement", "shared view", "common ground"], "exampleEn": "There is little consensus among linguists on how grammar emerged.", "exampleVi": "Ít có sự đồng thuận giữa các nhà ngôn ngữ học về nguồn gốc ngữ pháp."},
    {"word": "divergent", "phonetic": "/daɪˈvɜː.dʒənt/", "meaningVi": "phân kỳ, khác biệt hướng đi", "partOfSpeech": "adj", "paraphrases": ["differing", "conflicting", "contrasting views"], "exampleEn": "Historians hold divergent views on why the guild dissolved.", "exampleVi": "Các sử gia có quan điểm khác nhau về lý do phường hội tan rã."},
    {"word": "empirical", "phonetic": "/ɪmˈpɪr.ɪ.kəl/", "meaningVi": "dựa trên thực nghiệm, quan sát thực tế", "partOfSpeech": "adj", "paraphrases": ["based on observation", "experimental", "data-driven"], "exampleEn": "Gilbert replaced speculation with empirical testing.", "exampleVi": "Gilbert thay thế suy đoán bằng kiểm chứng thực nghiệm."},
    {"word": "skeptical", "phonetic": "/ˈskep.tɪ.kəl/", "meaningVi": "hoài nghi, chưa tin ngay", "partOfSpeech": "adj", "paraphrases": ["doubtful", "cautious", "unconvinced"], "exampleEn": "Initial reviewers remained skeptical about the vaccine's stability.", "exampleVi": "Giới phản biện ban đầu vẫn hoài nghi về độ ổn định của vắc-xin."},
    {"word": "viable", "phonetic": "/ˈvaɪ.ə.bəl/", "meaningVi": "khả thi, có thể tồn tại/áp dụng", "partOfSpeech": "adj", "paraphrases": ["feasible", "workable", "practical alternative"], "exampleEn": "Solar desalination is becoming an economically viable option.", "exampleVi": "Khử mặn bằng năng lượng mặt trời đang trở thành lựa chọn khả thi về kinh tế."},
    {"word": "obsolete", "phonetic": "/ˌɒb.səˈliːt/", "meaningVi": "lỗi thời, không còn được dùng", "partOfSpeech": "adj", "paraphrases": ["outdated", "no longer used", "superseded"], "exampleEn": "Electronic catalogues made card indexes largely obsolete.", "exampleVi": "Danh mục điện tử khiến thẻ mục lục giấy phần lớn trở nên lỗi thời."},
    {"word": "detrimental", "phonetic": "/ˌdet.rɪˈmen.təl/", "meaningVi": "có hại, bất lợi", "partOfSpeech": "adj", "paraphrases": ["harmful", "damaging", "adverse effect"], "exampleEn": "Prolonged noise exposure can have a detrimental effect on concentration.", "exampleVi": "Tiếp xúc tiếng ồn kéo dài có thể gây hại cho sự tập trung."},
    {"word": "expedite", "phonetic": "/ˈek.spə.daɪt/", "meaningVi": "đẩy nhanh tiến độ, xúc tiến", "partOfSpeech": "verb", "paraphrases": ["speed up", "accelerate", "facilitate"], "exampleEn": "Rail links expedited the transport of perishable grain.", "exampleVi": "Tuyến đường sắt đẩy nhanh việc vận chuyển ngũ cốc dễ hỏng."},
    {"word": "alleviate", "phonetic": "/əˈliː.vi.eɪt/", "meaningVi": "làm dịu, giảm bớt (căng thẳng/đau)", "partOfSpeech": "verb", "paraphrases": ["ease", "relieve", "reduce strain"], "exampleEn": "Quiet recovery rooms helped alleviate workplace burnout.", "exampleVi": "Phòng nghỉ yên tĩnh giúp giảm tình trạng kiệt sức nơi làm việc."},
    {"word": "pervasive", "phonetic": "/pəˈveɪ.sɪv/", "meaningVi": "lan tỏa sâu rộng, phổ biến", "partOfSpeech": "adj", "paraphrases": ["widespread", "permeating", "deep-rooted"], "exampleEn": "Fear of failure has a pervasive influence on consumer choices.", "exampleVi": "Nỗi sợ thất bại ảnh hưởng sâu rộng tới lựa chọn của người tiêu dùng."},
    {"word": "resilient", "phonetic": "/rɪˈzɪl.i.ənt/", "meaningVi": "kiên cường, hồi phục nhanh", "partOfSpeech": "adj", "paraphrases": ["adaptable", "robust", "able to recover"], "exampleEn": "Native grasses proved surprisingly resilient after coastal storms.", "exampleVi": "Cỏ bản địa cho thấy khả năng phục hồi đáng ngạc nhiên sau bão biển."},
    {"word": "incentive", "phonetic": "/ɪnˈsen.tɪv/", "meaningVi": "động lực, sự khích lệ/ưu đãi", "partOfSpeech": "noun", "paraphrases": ["motivation", "encouragement", "financial reward"], "exampleEn": "Tax breaks provided landowners with an incentive to reforest.", "exampleVi": "Ưu đãi thuế tạo động lực để chủ đất trồng lại rừng."},
    {"word": "inadvertently", "phonetic": "/ˌɪn.ədˈvɜː.tənt.li/", "meaningVi": "vô tình, không chủ đích", "partOfSpeech": "adv", "paraphrases": ["unintentionally", "by accident", "without intending"], "exampleEn": "Traders inadvertently introduced invasive beetles inside timber crates.", "exampleVi": "Thương nhân vô tình đưa bọ cánh cứng xâm lấn theo thùng gỗ."},
    {"word": "subsequently", "phonetic": "/ˈsʌb.sɪ.kwənt.li/", "meaningVi": "sau đó, tiếp theo", "partOfSpeech": "adv", "paraphrases": ["later on", "afterwards", "following this"], "exampleEn": "The patent was sold and subsequently refined for commercial shipping.", "exampleVi": "Bằng sáng chế được bán và sau đó cải tiến cho vận tải thương mại."},
    {"word": "predominantly", "phonetic": "/prɪˈdɒm.ɪ.nənt.li/", "meaningVi": "chủ yếu, phần lớn", "partOfSpeech": "adv", "paraphrases": ["mainly", "largely", "chiefly"], "exampleEn": "Early buyers were predominantly wealthy collectors from port cities.", "exampleVi": "Người mua ban đầu chủ yếu là các nhà sưu tầm giàu có tại thành phố cảng."},
    {"word": "simultaneously", "phonetic": "/ˌsɪm.əlˈteɪ.ni.əs.li/", "meaningVi": "đồng thời, cùng một lúc", "partOfSpeech": "adv", "paraphrases": ["at the same time", "concurrently", "together"], "exampleEn": "Few brains can process two complex sentences simultaneously.", "exampleVi": "Ít bộ não xử lý đồng thời hai câu phức tạp hiệu quả."},
    {"word": "controversy", "phonetic": "/ˈkɒn.trə.vɜː.si/", "meaningVi": "cuộc tranh cãi kéo dài", "partOfSpeech": "noun", "paraphrases": ["debate", "dispute", "heated disagreement"], "exampleEn": "New shelf-stacking tactics sparked controversy among psychologists.", "exampleVi": "Chiến thuật xếp kệ hàng mới gây ra tranh cãi trong giới tâm lý học."},
    {"word": "speculate", "phonetic": "/ˈspek.jə.leɪt/", "meaningVi": "suy đoán (thiếu bằng chứng chắc chắn)", "partOfSpeech": "verb", "paraphrases": ["hypothesize", "guess", "propose without proof"], "exampleEn": "Scientists speculate that Martian microbes may still survive underground.", "exampleVi": "Các nhà khoa học suy đoán vi sinh vật sao Hỏa có thể vẫn tồn tại dưới lòng đất."},
    {"word": "anecdotal", "phonetic": "/ˌæn.ɪkˈdəʊ.təl/", "meaningVi": "mang tính giai thoại/kể lại (không phải số liệu)", "partOfSpeech": "adj", "paraphrases": ["personal accounts", "unverified stories", "non-statistical"], "exampleEn": "Historians must separate anecdotal stories from measured rainfall records.", "exampleVi": "Sử gia cần tách chuyện truyền miệng khỏi hồ sơ đo lượng mưa."},
    {"word": "indigenous", "phonetic": "/ɪnˈdɪdʒ.ɪ.nəs/", "meaningVi": "bản địa, có nguồn gốc tại chỗ", "partOfSpeech": "adj", "paraphrases": ["native", "local origin", "aboriginal"], "exampleEn": "Early botanists catalogued dozens of indigenous medicinal shrubs.", "exampleVi": "Các nhà thực vật học lập danh mục hàng chục loài cây thuốc bản địa."},
    {"word": "compromise", "phonetic": "/ˈkɒm.prə.maɪz/", "meaningVi": "thỏa hiệp hoặc làm suy yếu (tùy ngữ cảnh)", "partOfSpeech": "verb", "paraphrases": ["weaken", "undermine", "reach a middle ground"], "exampleEn": "Rushing field tests can compromise the accuracy of soil readings.", "exampleVi": "Đẩy nhanh thử nghiệm hiện trường có thể làm giảm độ chính xác mẫu đất."},
    {"word": "fluctuate", "phonetic": "/ˈflʌk.tʃu.eɪt/", "meaningVi": "dao động, biến động lên xuống", "partOfSpeech": "verb", "paraphrases": ["vary", "rise and fall", "shift unpredictably"], "exampleEn": "Wholesale bulb prices fluctuated wildly during the spring of 1637.", "exampleVi": "Giá củ hoa bán buôn dao động dữ dội vào mùa xuân năm 1637."},
    {"word": "monopolize", "phonetic": "/məˈnɒp.əl.aɪz/", "meaningVi": "độc chiếm, chi phối hoàn toàn", "partOfSpeech": "verb", "paraphrases": ["dominate", "control exclusively", "corner the market"], "exampleEn": "A handful of guilds monopolized purple dye imports across Europe.", "exampleVi": "Một số ít phường hội độc chiếm nhập khẩu thuốc nhuộm tím ở châu Âu."},
    {"word": "substantiate", "phonetic": "/səbˈstæn.ʃi.eɪt/", "meaningVi": "chứng minh bằng dẫn chứng cụ thể", "partOfSpeech": "verb", "paraphrases": ["back up", "prove with evidence", "validate"], "exampleEn": "Satellite imagery helped substantiate the glaciologist's predictions.", "exampleVi": "Ảnh vệ tinh giúp chứng minh dự báo của nhà nghiên cứu băng hà."},
    {"word": "repercussion", "phonetic": "/ˌriː.pəˈkʌʃ.ən/", "meaningVi": "hệ quả, tác động dây chuyền", "partOfSpeech": "noun", "paraphrases": ["consequence", "knock-on effect", "outcome"], "exampleEn": "Financial models clarify possible repercussions before firms sign contracts.", "exampleVi": "Mô hình tài chính làm rõ các hệ quả trước khi doanh nghiệp ký hợp đồng."},
    {"word": "prohibitively", "phonetic": "/prəˈhɪb.ɪ.tɪv.li/", "meaningVi": "đắt đỏ/cao tới mức ngăn cản", "partOfSpeech": "adv", "paraphrases": ["too expensive to afford", "excessively costly"], "exampleEn": "Strict compliance testing was prohibitively expensive for small workshops.", "exampleVi": "Kiểm định nghiêm ngặt quá tốn kém đối với các xưởng nhỏ."},
    {"word": "circumvent", "phonetic": "/ˌsɜː.kəmˈvent/", "meaningVi": "lách qua, tránh được trở ngại", "partOfSpeech": "verb", "paraphrases": ["bypass", "get around", "avoid regulations"], "exampleEn": "Merchants devised clever routes to circumvent harbour inspection fees.", "exampleVi": "Thương nhân tìm cách lách phí kiểm tra tại bến cảng."},
    {"word": "deliberately", "phonetic": "/dɪˈlɪb.ər.ət.li/", "meaningVi": "có chủ đích, cố ý", "partOfSpeech": "adv", "paraphrases": ["intentionally", "on purpose", "calculatedly"], "exampleEn": "Retailers deliberately place essential staples at the back of stores.", "exampleVi": "Nhà bán lẻ cố ý đặt hàng thiết yếu ở cuối cửa hàng."},
    {"word": "finite", "phonetic": "/ˈfaɪ.naɪt/", "meaningVi": "hữu hạn, có giới hạn", "partOfSpeech": "adj", "paraphrases": ["limited", "bounded", "exhaustible"], "exampleEn": "The brain appears to have a finite capacity for conscious multitasking.", "exampleVi": "Bộ não dường như có giới hạn hữu hạn cho việc đa nhiệm có ý thức."},
    {"word": "impetus", "phonetic": "/ˈɪm.pɪ.təs/", "meaningVi": "cú hích, động lực thúc đẩy", "partOfSpeech": "noun", "paraphrases": ["momentum", "stimulus", "driving push"], "exampleEn": "Worker shortages gave farmers the impetus to mechanize planting.", "exampleVi": "Thiếu nhân công tạo cú hích để nông dân cơ giới hóa gieo hạt."},
    {"word": "discard", "phonetic": "/dɪˈskɑːd/", "meaningVi": "loại bỏ, vứt bỏ (lý thuyết/vật dụng)", "partOfSpeech": "verb", "paraphrases": ["abandon", "throw away", "reject old ideas"], "exampleEn": "Long-held assumptions were discarded once DNA analysis arrived.", "exampleVi": "Các giả định lâu đời bị loại bỏ khi phân tích DNA xuất hiện."},
    {"word": "overlook", "phonetic": "/ˌəʊ.vəˈlʊk/", "meaningVi": "bỏ sót, không chú ý tới", "partOfSpeech": "verb", "paraphrases": ["fail to notice", "neglect", "miss an aspect"], "exampleEn": "Classic studies often overlooked how emotion shapes persuasion.", "exampleVi": "Nghiên cứu kinh điển thường bỏ sót vai trò của cảm xúc trong thuyết phục."},
    {"word": "attribute to", "phonetic": "/əˈtrɪb.juːt tuː/", "meaningVi": "quy cho, cho là nguyên nhân bởi", "partOfSpeech": "verb phrase", "paraphrases": ["explain by", "credit to", "link cause to"], "exampleEn": "Researchers attributed the rising scores to visual media exposure.", "exampleVi": "Các nhà nghiên cứu cho rằng điểm số tăng là do tiếp xúc truyền thông hình ảnh."},
    {"word": "eradicate", "phonetic": "/ɪˈræd.ɪ.keɪt/", "meaningVi": "xóa sổ, loại bỏ hoàn toàn", "partOfSpeech": "verb", "paraphrases": ["eliminate completely", "wipe out", "destroy"], "exampleEn": "Introduced amphibians failed to eradicate the cane beetle.", "exampleVi": "Loài lưỡng cư được đưa vào đã thất bại trong việc diệt sạch bọ hại mía."},
    {"word": "feasible", "phonetic": "/ˈfiː.zə.bəl/", "meaningVi": "khả thi, thực hiện được", "partOfSpeech": "adj", "paraphrases": ["achievable", "practical", "viable"], "exampleEn": "Collecting bottom-up emissions data for every item is barely feasible.", "exampleVi": "Thu thập dữ liệu phát thải chi tiết cho từng sản phẩm gần như không khả thi."},
    {"word": "skepticism", "phonetic": "/ˈskep.tɪ.sɪ.zəm/", "meaningVi": "thái độ hoài nghi khoa học", "partOfSpeech": "noun", "paraphrases": ["doubt", "hesitation", "critical questioning"], "exampleEn": "Astronomers greeted reports of artificial canals with skepticism.", "exampleVi": "Các nhà thiên văn đón nhận báo cáo về kênh đào nhân tạo với sự hoài nghi."},
    {"word": "augment", "phonetic": "/ɔːɡˈment/", "meaningVi": "tăng cường, bổ sung mở rộng", "partOfSpeech": "verb", "paraphrases": ["enhance", "supplement", "boost"], "exampleEn": "Adaptive software could soon augment conventional hearing aids.", "exampleVi": "Phần mềm thích ứng có thể sớm nâng cấp máy trợ thính thông thường."},
    {"word": "culminate", "phonetic": "/ˈkʌl.mɪ.neɪt/", "meaningVi": "lên tới đỉnh điểm, dẫn đến kết quả cuối", "partOfSpeech": "verb", "paraphrases": ["reach a peak", "result in", "conclude with"], "exampleEn": "Years of field trials culminated in an ocean-going iron steamship.", "exampleVi": "Nhiều năm thử nghiệm dẫn tới thành quả là tàu hơi nước vỏ sắt vượt đại dương."},
    {"word": "constrain", "phonetic": "/kənˈstreɪn/", "meaningVi": "kìm hãm, giới hạn phạm vi", "partOfSpeech": "verb", "paraphrases": ["restrict", "limit", "hold back"], "exampleEn": "High fuel consumption initially constrained trans-Atlantic voyages.", "exampleVi": "Tiêu thụ nhiều than ban đầu giới hạn các chuyến vượt Đại Tây Dương."},
    {"word": "deteriorate", "phonetic": "/dɪˈtɪə.ri.ə.reɪt/", "meaningVi": "xấu đi, suy giảm chất lượng", "partOfSpeech": "verb", "paraphrases": ["decline rapidly", "worsen", "degrade"], "exampleEn": "Performance deteriorates sharply when attention splits across tasks.", "exampleVi": "Hiệu suất suy giảm mạnh khi sự chú ý bị chia nhỏ cho nhiều việc."},
    {"word": "unanimous", "phonetic": "/juːˈnæn.ɪ.məs/", "meaningVi": "nhất trí hoàn toàn", "partOfSpeech": "adj", "paraphrases": ["total agreement", "everyone agreed", "all without exception"], "exampleEn": "Notice traps: 'unanimous' in TFNG when the passage says scientists debated!", "exampleVi": "Bẫy phổ biến: 'unanimous' thường biến câu TFNG thành FALSE nếu bài nêu vẫn tranh luận."},
    {"word": "inevitable", "phonetic": "/ɪnˈev.ɪ.tə.bəl/", "meaningVi": "tất yếu, không thể tránh khỏi", "partOfSpeech": "adj", "paraphrases": ["unavoidable", "bound to happen", "certain"], "exampleEn": "Automation made structural changes in small workshops inevitable.", "exampleVi": "Tự động hóa khiến sự thay đổi cơ cấu ở xưởng nhỏ trở thành tất yếu."},
]


def update_vocab_core(manifest_ready_id: str = "vol-7-test-1"):
    vp = PUBLIC_DATA / "vocab-core.json"
    existing = json.loads(vp.read_text(encoding="utf-8")) if vp.exists() else []
    kept = [c for c in existing if not str(c.get("id", "")).startswith("core-r-")]
    now_iso = "2026-11-26T12:00:00Z"
    new_cards = []
    for idx, item in enumerate(CORE_READING_CARDS, 1):
        new_cards.append({
            "id": f"core-r-{idx:03d}",
            "word": item["word"],
            "phonetic": item["phonetic"],
            "meaningVi": item["meaningVi"],
            "partOfSpeech": item["partOfSpeech"],
            "category": "reading_academic",
            "paraphrases": item["paraphrases"],
            "exampleEn": item["exampleEn"],
            "exampleVi": item["exampleVi"],
            "source": "core",
            "sourceTestId": manifest_ready_id,
            "easeFactor": 2.5,
            "intervalDays": 0,
            "repetitions": 0,
            "nextReviewAt": now_iso,
            "createdAt": now_iso,
        })
    merged = kept + new_cards
    vp.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {vp}: {len(kept)} existing + {len(new_cards)} reading_academic = {len(merged)} total core cards.")


# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-translate", action="store_true", help="Skip network Vietnamese translation for rapid structural check")
    args = parser.parse_args()

    vol7_keys = load_all_vol7_keys()
    vol8_keys = json.loads(VOL8_KEYS_CACHE.read_text(encoding="utf-8")) if VOL8_KEYS_CACHE.exists() else {}
    vol8_boxes = json.loads(VOL8_BOXES_CACHE.read_text(encoding="utf-8")) if VOL8_BOXES_CACHE.exists() else []
    vi_cache: dict[str, str] = json.loads(VI_TRANSLATE_CACHE.read_text(encoding="utf-8")) if VI_TRANSLATE_CACHE.exists() else {}
    doc10 = pymupdf.open(str(VOL10_PDF))

    manifest_entries: list[dict] = []
    all_tests_data: list[tuple[dict, Path, dict[int, dict]]] = []
    evidence_to_translate: list[str] = []

    specs = (
        [(7, t) for t in range(1, 17)]
        + [(8, t) for t in range(1, 13)]
        + [(9, t) for t in range(1, 10)]
        + [(10, t) for t in range(1, 7)]
    )

    structural_issues = []

    for vol, tnum in specs:
        if vol == 7:
            sub = "Test 1-10" if tnum <= 10 else "Test 11-16"
            fp = VOL7_DIR / sub / f"Test {tnum}.pdf"
            doc = pymupdf.open(str(fp))
            max_p = 11 if tnum in (15, 16) else len(doc)
            doc.close()
            stream = extract_pdf_stream(fp, max_page=max_p)
            src_name = f"VOL 7- ORIGINAL EXAMS/Reading/{sub}/Test {tnum}.pdf"
        elif vol == 8:
            fname = "Tets 11.pdf" if tnum == 11 else f"Test {tnum}.pdf"
            fp = VOL8_DIR / fname
            stream = extract_pdf_stream(fp)
            src_name = f"VOL 8 - ORIGINAL EXAMS/READING/{fname}"
        elif vol == 9:
            fname = "TEST 1 -R.docx" if tnum == 1 else f"TEST {tnum}-R.docx"
            fp = VOL9_DIR / fname
            stream = extract_docx_stream(fp)
            src_name = f"VOL 9 - ORIGINAL EXAMS/READING/{fname}"
        else:
            start_p, end_p, key_start_p = VOL10_PAGE_RANGES[tnum]
            stream = []
            for pno in range(start_p - 1, key_start_p - 1):
                stream.extend(extract_vol10_page_lines(doc10[pno]))
            src_name = f"VOL 10 KEY.pdf (pp.{start_p}-{end_p})"

        raw_passages = segment_into_three_passages(stream, vol, tnum, vol8_boxes)
        passages = [parse_passage_bucket(raw_passages[i]["items"], i + 1, vol, tnum) for i in range(3)]

        # Merge Keys
        if vol == 7:
            raw_keys = vol7_keys[tnum]
        elif vol == 8:
            raw_keys = {int(k): v for k, v in vol8_keys.get(str(tnum), {}).items()}
        elif vol == 9:
            raw_keys = load_vol9_keys(tnum, passages)
        else:
            raw_keys = load_vol10_keys(tnum, doc10)

        all_qs: dict[int, dict] = {}
        for p_obj in passages:
            for qn, qm in p_obj["questions"].items():
                all_qs[qn] = qm

        key_count = 0
        # Normalize mcq_multi sibling answers if source key listed individual letters per Q (e.g. V7 T16 Q21=A, Q22=C -> "A, C")
        for p_obj in passages:
            for grp in p_obj["groups"]:
                if grp["type"] == "mcq_multi" and len(grp["questions"]) > 1:
                    sib_nums = [q["number"] for q in grp["questions"]]
                    raw_sib_vals = [raw_keys.get(n, {}).get("answer", "") for n in sib_nums]
                    letters = sorted({ch.upper() for v in raw_sib_vals for ch in re.findall(r"\b([A-G])\b", v.upper())})
                    if len(letters) >= 2:
                        merged_ev = " ".join(
                            dict.fromkeys(raw_keys.get(n, {}).get("evidence", "") for n in sib_nums if raw_keys.get(n, {}).get("evidence"))
                        ).strip()
                        joined_let = ", ".join(letters)
                        for n in sib_nums:
                            raw_keys.setdefault(n, {"answer": "", "evidence": "", "vi_ev": "", "vi_expl": ""})
                            raw_keys[n]["answer"] = joined_let
                            if merged_ev and not raw_keys[n].get("evidence"):
                                raw_keys[n]["evidence"] = merged_ev

        # Attach canonical answers + verbatim evidence quotes
        for p_obj in passages:
            for grp in p_obj["groups"]:
                for q in grp["questions"]:
                    qn = q["number"]
                    rk = raw_keys.get(qn, {})
                    raw_ans = rk.get("answer", "")
                    if vol == 10 and tnum in (3, 5):
                        canonical, variants = "", []
                    else:
                        canonical, variants = canonicalize_answer(raw_ans, q)
                    if variants:
                        key_count += 1
                    q["acceptedAnswers"] = variants

                    if variants:
                        pid, loc, quote = locate_verbatim_evidence(
                            p_obj, q, rk.get("evidence", ""), canonical
                        )
                        q["evidenceParagraphId"] = pid
                        q["evidenceLocation"] = loc
                        q["evidenceQuote"] = quote
                        if rk.get("vi_ev"):
                            q["evidenceTranslationVi"] = rk["vi_ev"]
                        else:
                            q["evidenceTranslationVi"] = ""
                            if quote:
                                evidence_to_translate.append(quote)
                        q["explanationVi"] = build_concise_explanation_vi(q, canonical, loc, rk)
                    else:
                        q["evidenceParagraphId"] = ""
                        q["evidenceLocation"] = ""
                        q["evidenceQuote"] = ""
                        q["evidenceTranslationVi"] = ""
                        q["explanationVi"] = "Chưa có Answer Key hợp lệ trong bộ nguồn gốc cho câu hỏi này."

            # Remove temp flat `questions` helper before serializing JSON
            p_obj.pop("questions", None)
            # Attach questionRange on Passage
            grp_nums = [n for g in p_obj["groups"] for n in g["questionRange"]]
            p_obj["questionRange"] = [min(grp_nums), max(grp_nums)] if grp_nums else [0, 0]

        missing_qs = [n for n in range(1, 41) if n not in all_qs]
        empty_paras = [p["passageNumber"] for p in passages if not p["paragraphs"]]
        missing_opts = [
            f"Q{g['questionRange'][0]}-{g['questionRange'][1]}({g['type']})"
            for p in passages for g in p["groups"]
            if g["type"] in ("mcq_multi", "matching_headings", "matching_features", "matching_sentence_endings", "summary_box")
            and not g.get("options")
        ]
        if missing_qs or empty_paras or missing_opts:
            structural_issues.append(f"V{vol} T{tnum:02d}: missingQ={missing_qs} emptyP={empty_paras} missingOpts={missing_opts}")

        has_passages = all(len(p["paragraphs"]) > 0 for p in passages)
        has_questions = len(all_qs) == 40
        has_key = key_count == 40
        is_partial = not (has_passages and has_questions and has_key)
        missing_comps = []
        if not has_passages:
            missing_comps.append("Passages")
        if not has_questions:
            missing_comps.append(f"Questions ({40 - len(all_qs)} thiếu)")
        if not has_key:
            missing_comps.append("Answer Key (nguồn PDF không khớp đề)" if (vol == 10 and tnum in (3, 5)) else f"Answer Key ({40 - key_count} thiếu)")

        missing_note: str | None = None
        if vol == 10 and tnum in (3, 5):
            missing_note = (
                f"Bộ đề Vol 10 Test {tnum} có file đáp án đi kèm bị lệch sang bài đọc khác trong PDF gốc, nên hệ thống chỉ chấm khi bạn tự nạp Answer Key hợp lệ tại Quản lý dữ liệu."
            )
        elif vol == 9 and tnum == 3 and key_count < 40:
            missing_note = (
                f"File gốc KEY TEST 3-R.docx chỉ cung cấp {key_count}/40 đáp án (thiếu câu 40 ở Passage 3). Bạn vẫn có thể làm bài và chấm {key_count} câu có đáp án hoặc bổ sung câu 40 tại Quản lý dữ liệu."
            )

        test_id = f"vol-{vol}-test-{tnum}"
        out_path = PUBLIC_DATA / f"vol-{vol}" / f"test-{tnum}" / "reading.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "vol": vol,
            "test": tnum,
            "testId": test_id,
            "title": f"IELTS Reading Vol {vol} - Test {tnum}",
            "sourceName": src_name,
            "status": "partial" if is_partial else "ready",
            "hasKey": has_key,
            "keyCount": key_count,
            "missingNote": missing_note,
            "passages": passages,
        }
        all_tests_data.append((payload, out_path, raw_keys))

        manifest_entries.append({
            "vol": vol,
            "test": tnum,
            "testId": test_id,
            "title": payload["title"],
            "passageTitles": [p["title"] for p in passages],
            "questionCount": len(all_qs),
            "keyCount": key_count,
            "hasPassages": has_passages,
            "hasQuestions": has_questions,
            "hasKey": has_key,
            "status": payload["status"],
            "missingComponents": missing_comps,
            "sourceName": src_name,
            "dataUrl": f"./data/vol-{vol}/test-{tnum}/reading.json",
        })

    doc10.close()

    print(f"\n=== STRUCTURAL PARSE AUDIT (43 TESTS) ===")
    print(f"Issues ({len(structural_issues)}):")
    for iss in structural_issues:
        print(" ", iss)
    ready_cnt = sum(1 for m in manifest_entries if m["status"] == "ready")
    print(f"Ready: {ready_cnt}/43 | Partial: {43 - ready_cnt}/43")

    if not args.skip_translate:
        vi_cache = translate_batch_vi(evidence_to_translate, vi_cache)
        for payload, _, _ in all_tests_data:
            for p_obj in payload["passages"]:
                for grp in p_obj["groups"]:
                    for q in grp["questions"]:
                        if q["evidenceQuote"] and not q["evidenceTranslationVi"]:
                            q["evidenceTranslationVi"] = vi_cache.get(q["evidenceQuote"], "")
    else:
        print(f"(--skip-translate) {len(set(evidence_to_translate))} unique quotes queued for translation.")

    for payload, out_path, _ in all_tests_data:
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest = {
        "generatedAt": "2026-11-26T12:00:00Z",
        "totalTests": len(manifest_entries),
        "readyTests": ready_cnt,
        "partialTests": len(manifest_entries) - ready_cnt,
        "tests": manifest_entries,
    }
    (PUBLIC_DATA / "reading-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    update_vocab_core("vol-7-test-1")
    print(f"Wrote reading-manifest.json & {len(all_tests_data)} reading.json files.")


if __name__ == "__main__":
    main()
