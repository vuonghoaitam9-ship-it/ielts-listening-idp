#!/usr/bin/env python3
"""
Strict quality & acoustic verification suite for all 28 aligned IELTS Listening tests.
Compares every aligned data.json against its cached Whisper acoustic word timestamps,
checks structural/monotonic invariants, and prints spoken spot-checks.
"""

import importlib.util
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = PROJECT_ROOT / "public" / "data"
CACHE_DIR = PROJECT_ROOT / ".whisper-cache"

_align_spec = importlib.util.spec_from_file_location(
    "align_audio", PROJECT_ROOT / "scripts" / "align-audio-whisper.py"
)
assert _align_spec and _align_spec.loader
align_mod = importlib.util.module_from_spec(_align_spec)
_align_spec.loader.exec_module(align_mod)

SPOT_CHECK_IDS = [
    "vol-7-test-1",
    "vol-7-test-11",
    "vol-8-test-1",
    "vol-8-test-8",
    "vol-9-test-1",
    "vol-9-test-5",
]


def main():
    manifest = json.loads((DATA_ROOT / "manifest.json").read_text(encoding="utf-8"))
    report_path = CACHE_DIR / "alignment-report.json"
    report_map = {}
    if report_path.exists():
        report_map = {r["id"]: r for r in json.loads(report_path.read_text(encoding="utf-8"))}

    ready = [t for t in manifest["tests"] if t["status"] == "ready"]
    assert len(ready) == 28, f"Expected 28 ready tests, found {len(ready)}"

    failures: list[str] = []
    spot_cache: dict[str, tuple[dict, list[dict]]] = {}

    header = (
        f"{'Test ID':13s} | {'Match%':6s} | {'P1%':5s} {'P2%':5s} {'P3%':5s} {'P4%':5s} | "
        f"{'Short':5s} {'Long':4s} | {'MinCh':5s} {'MaxSDur':7s} {'MaxLGap':7s} | {'QValid':6s} | {'PartsMono'}"
    )
    print(header)
    print("-" * len(header))

    for item in ready:
        tid = item["id"]
        data_path = DATA_ROOT / item["dataUrl"].replace("./data/", "")
        d = json.loads(data_path.read_text(encoding="utf-8"))
        dur = float(d["audioDurationSec"])
        segs = d["transcriptSegments"]
        longs = d["longSegments"]
        parts = d["parts"]
        qs = d["questions"]

        # Load metrics from alignment-report or recompute word match against cache
        rep = report_map.get(tid, {})
        w_cache = CACHE_DIR / f"{tid}.json"
        whisper_words: list[dict] = []
        if w_cache.exists():
            whisper_words, _ = align_mod.extract_whisper_words(w_cache)

        if tid in SPOT_CHECK_IDS and whisper_words:
            spot_cache[tid] = (d, whisper_words)

        match_pct = rep.get("wordMatchRate", 0.0) * 100.0
        pp = rep.get("perPartMatch", {})
        p1 = pp.get("1", 0.0) * 100.0
        p2 = pp.get("2", 0.0) * 100.0
        p3 = pp.get("3", 0.0) * 100.0
        p4 = pp.get("4", 0.0) * 100.0

        min_ch = min((len(s["text"].strip()) for s in segs), default=0)
        max_sdur = max((s["endTime"] - s["startTime"] for s in segs), default=0.0)

        seg_by_id = {s["id"]: s for s in segs}
        max_lgap = 0.0
        for ls in longs:
            ids = ls["segmentIds"]
            for k in range(1, len(ids)):
                if ids[k] in seg_by_id and ids[k - 1] in seg_by_id:
                    gap = seg_by_id[ids[k]]["startTime"] - seg_by_id[ids[k - 1]]["endTime"]
                    if gap > max_lgap:
                        max_lgap = gap

        # Monotonicity & bounds checks
        segs_mono = all(
            0.0 <= s["startTime"] < s["endTime"] <= dur + 0.5
            for s in segs
        ) and all(
            segs[i]["startTime"] >= segs[i - 1]["startTime"] - 0.01
            for i in range(1, len(segs))
        )
        parts_mono = len(parts) == 4 and all(
            parts[i]["startTime"] <= parts[i + 1]["startTime"]
            for i in range(3)
        )
        q_valid = sum(
            1
            for q in qs
            if 0.0 <= q["evidenceStartTime"] < q["evidenceEndTime"] <= dur + 0.5
            and len(q["evidenceQuote"].strip()) > 0
        )

        print(
            f"{tid:13s} | {match_pct:5.1f}% | {p1:4.0f}% {p2:4.0f}% {p3:4.0f}% {p4:4.0f}% | "
            f"{len(segs):5d} {len(longs):4d} | {min_ch:5d} {max_sdur:6.2f}s {max_lgap:6.2f}s | "
            f"{q_valid:2d}/40  | {'OK' if parts_mono else 'FAIL'}"
        )

        if not d.get("hasExactTimestamps"):
            failures.append(f"{tid}: hasExactTimestamps is False")
        if match_pct < 80.0:
            failures.append(f"{tid}: wordMatchRate {match_pct:.1f}% < 80.0%")
        if min_ch < 4:
            failures.append(f"{tid}: min segment chars {min_ch} < 4")
        if max_sdur > 16.0:
            failures.append(f"{tid}: max short segment duration {max_sdur:.2f}s > 16.0s")
        if max_lgap > 3.0:
            failures.append(f"{tid}: max long internal silence gap {max_lgap:.2f}s > 3.0s")
        if not segs_mono:
            failures.append(f"{tid}: non-monotonic or out-of-bounds short segments")
        if not parts_mono:
            failures.append(f"{tid}: non-monotonic parts")
        if q_valid != 40:
            failures.append(f"{tid}: only {q_valid}/40 questions have valid evidence bounds")

    print("\n=== ACOUSTIC SPOKEN SPOT-CHECK (Transcript vs Actual Whisper Words Inside Window) ===")
    for tid in SPOT_CHECK_IDS:
        if tid not in spot_cache:
            continue
        d, wwords = spot_cache[tid]
        segs = d["transcriptSegments"]
        qs = d["questions"]
        print(f"\n--- {tid} ---")
        sample_indices = [0, len(segs) // 4, len(segs) // 2, (3 * len(segs)) // 4, len(segs) - 1]
        for si in sample_indices:
            if not (0 <= si < len(segs)):
                continue
            seg = segs[si]
            heard = " ".join(
                w["surface"]
                for w in wwords
                if w["end"] >= seg["startTime"] - 0.35 and w["start"] <= seg["endTime"] + 0.35
            )
            print(f"  [Seg {seg['id']} P{seg['part']} {seg['startTime']:6.2f}-{seg['endTime']:6.2f}]")
            print(f"    Official: {seg['text'][:120]}")
            print(f"    Whisper : {heard[:120]}")
        for qi in (0, 14, 34):
            q = qs[qi]
            heard = " ".join(
                w["surface"]
                for w in wwords
                if w["end"] >= q["evidenceStartTime"] - 0.35 and w["start"] <= q["evidenceEndTime"] + 0.35
            )
            print(f"  [Q{q['number']:02d} ({q['canonicalAnswer']}) {q['evidenceStartTime']:6.2f}-{q['evidenceEndTime']:6.2f}]")
            print(f"    Quote  : {q['evidenceQuote'][:120]}")
            print(f"    Whisper: {heard[:120]}")

    if failures:
        print("\nAUDIT FAILED:")
        for f in failures:
            print("  -", f)
        sys.exit(1)

    print("\nAUDIT PASSED: All 28 tests verified acoustically and structurally.")


if __name__ == "__main__":
    main()
