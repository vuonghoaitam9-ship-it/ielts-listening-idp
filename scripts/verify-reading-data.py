#!/usr/bin/env python3
"""
Strict structural & data integrity validator for all 43 IELTS Reading JSON exams (Vol 7–10).
"""

import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = PROJECT_ROOT / "public" / "data"


def main():
    manifest_path = PUBLIC_DATA / "reading-manifest.json"
    assert manifest_path.exists(), f"Missing {manifest_path}"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    tests = manifest.get("tests", [])
    assert len(tests) == 43, f"Expected 43 tests, got {len(tests)}"

    errors: list[str] = []
    warnings: list[str] = []

    for entry in tests:
        tid = entry["testId"]
        data_rel = entry["dataUrl"].lstrip("./")
        fp = PROJECT_ROOT / "public" / data_rel
        if not fp.exists():
            errors.append(f"{tid}: missing JSON file {fp}")
            continue

        data = json.loads(fp.read_text(encoding="utf-8"))
        passages = data.get("passages", [])
        if len(passages) != 3:
            errors.append(f"{tid}: expected 3 passages, got {len(passages)}")
            continue

        seen_qs: dict[int, dict] = {}
        for p in passages:
            pno = p["passageNumber"]
            paras = p.get("paragraphs", [])
            if not paras:
                errors.append(f"{tid} P{pno}: empty paragraphs")
            para_map = {pr["id"]: pr["text"] for pr in paras}

            groups = p.get("groups", [])
            if not groups:
                errors.append(f"{tid} P{pno}: no question groups")

            for g in groups:
                q_type = g.get("type", "")
                diag = g.get("diagramUrl")
                if diag:
                    diag_fp = PROJECT_ROOT / "public" / diag.lstrip("./")
                    if not diag_fp.exists():
                        errors.append(f"{tid} {g['id']}: missing diagram {diag_fp}")

                if q_type in ("mcq_multi", "matching_headings", "matching_info", "matching_features", "matching_sentence_endings", "summary_box"):
                    if len(g.get("options", [])) < 2:
                        errors.append(f"{tid} {g['id']} ({q_type}): missing options (<2)")

                qs = g.get("questions", [])
                for q in qs:
                    qn = q["number"]
                    if qn in seen_qs:
                        errors.append(f"{tid}: duplicate Q{qn}")
                    seen_qs[qn] = q

                    if q_type == "mcq_single" and len(q.get("options", [])) < 2 and len(g.get("options", [])) < 2:
                        errors.append(f"{tid} Q{qn} (mcq_single): missing options (<2)")

                    if not q.get("prompt"):
                        errors.append(f"{tid} Q{qn}: empty prompt")

                    ans = q.get("acceptedAnswers", [])
                    if data["status"] == "ready" and not ans:
                        errors.append(f"{tid} Q{qn}: ready test missing acceptedAnswers")
                    if ans:
                        ev_pid = q.get("evidenceParagraphId", "")
                        ev_quote = q.get("evidenceQuote", "")
                        if ev_pid not in para_map:
                            errors.append(f"{tid} Q{qn}: evidenceParagraphId {ev_pid!r} not in passage P{pno}")
                        elif not ev_quote or ev_quote not in para_map[ev_pid]:
                            errors.append(f"{tid} Q{qn}: evidenceQuote is not exact substring of paragraph {ev_pid}")
                        if not q.get("evidenceTranslationVi"):
                            warnings.append(f"{tid} Q{qn}: missing evidenceTranslationVi")
                        if not q.get("explanationVi"):
                            errors.append(f"{tid} Q{qn}: missing explanationVi")

                # Verify {{blank:N}} placeholders in bodyText/table correspond to questions in group
                txt_blobs = []
                if g.get("bodyText"):
                    txt_blobs.append(g["bodyText"])
                if g.get("table"):
                    for row in g["table"].get("rows", []):
                        txt_blobs.extend(row)
                for bnum in re.findall(r"\{\{blank:(\d+)\}\}", " ".join(txt_blobs)):
                    if int(bnum) not in [x["number"] for x in qs]:
                        errors.append(f"{tid} {g['id']}: orphaned blank {{{{blank:{bnum}}}}}")

        missing = [n for n in range(1, 41) if n not in seen_qs]
        if missing:
            errors.append(f"{tid}: missing question numbers {missing}")

        if data["vol"] == 10 and data["test"] in (3, 5):
            if data["status"] != "partial" or data["hasKey"]:
                errors.append(f"{tid}: Vol 10 T{data['test']} must be status='partial' and hasKey=False")

    if manifest.get("readyTests") != 40 or manifest.get("partialTests") != 3:
        errors.append(f"Expected readyTests=40 & partialTests=3, got ready={manifest.get('readyTests')} partial={manifest.get('partialTests')}")

    print(f"Verified {len(tests)} tests (ready={manifest.get('readyTests')}, partial={manifest.get('partialTests')}).")
    print(f"Errors: {len(errors)} | Warnings (e.g. skip-translate): {len(warnings)}")
    for e in errors[:60]:
        print("  ERROR:", e)
    if len(errors) > 60:
        print(f"  ... ({len(errors) - 60} more errors)")
    for w in warnings[:10]:
        print("  WARN:", w)

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
