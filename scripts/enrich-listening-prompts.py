import glob
import json
import os
import re
import pymupdf

ROOT = r'F:\IELTS\ielts-listening-idp'
DATA_DIR = os.path.join(ROOT, 'public', 'data')

PUA_RE = re.compile(r'[\uf000-\uf8ff]+')
HEADER_LINE_RE = re.compile(
    r'^(?:LISTENING\s+VOL.*|SECTION\s+\d+\s*|Read\s+the\s+text\s+and\s+answer.*|TEST\s*\d*\s*|Part\s+\d+\s*|Page\s+\d+\s*)$',
    re.I,
)
INSTRUCTION_LINE_RE = re.compile(
    r'^(?:Questions?\s+\d+.*|Complete\s+the\s+.*|Write\s+(?:ONE|NO\s+MORE\s+THAN|TWO|THREE).*|Choose\s+(?:the\s+correct|TWO|THREE|FOUR|FIVE|SIX).*|Label\s+the\s+.*|What\s+(?:information|advice|action|do\s+the).*|Which\s+(?:TWO|THREE|FOUR|FIVE).*|Answer\s+the\s+questions.*)$',
    re.I,
)


def clean_pdf_text(raw: str) -> str:
    txt = raw.replace('\r\n', '\n').replace('\r', '\n').replace('\xa0', ' ')
    txt = PUA_RE.sub('•', txt)
    # Strip trailing exam answer-key appendices inside PDFs (e.g. "Câu số 1:")
    key_appendix = re.search(r'(?m)^\s*Câu\s+số\s+\d+\s*[:.]', txt)
    if key_appendix:
        txt = txt[:key_appendix.start()]
    # Join question numbers separated from blank dots across a single line break
    txt = re.sub(
        r'(?<!\d)\b([1-9]|[1-3]\d|40)\s*\n\s*([_.…]{2,})',
        r'\1 \2',
        txt,
    )
    # Join standalone single capital option label "A\ntext" -> "A text"
    txt = re.sub(
        r'(?m)^[ \t]*([A-J])[ \t]*\n[ \t]*([^\nA-J0-9][^\n]*)$',
        r'\1 \2',
        txt,
    )
    return txt


def strip_running_headers(text: str) -> str:
    kept = []
    for line in text.split('\n'):
        s = re.sub(r'[ \t]+', ' ', line).strip()
        if HEADER_LINE_RE.match(s):
            continue
        kept.append(s)
    return '\n'.join(kept)


def split_question_blocks(full_text: str):
    """Splits PDF text into ordered (start_q, end_q, block_text) tuples."""
    # Detect both explicit "Questions X-Y" and fallback "Read the text and answer questions X-Y"
    raw_lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in full_text.split('\n')]
    # Collapse "Read the text and answer questions X-Y" ONLY if next non-empty line is NOT "Questions X-Y"
    processed_lines = []
    for i, line in enumerate(raw_lines):
        if re.match(r'^Read\s+the\s+text\s+and\s+answer\s+questions?\s+\d+\s*[-–—]\s*\d+\s*$', line, re.I):
            lookahead = ' '.join(raw_lines[i + 1:i + 4])
            if re.search(r'(?im)^\s*Questions?\s+\d+\s*[-–—]\s*\d+', lookahead) or re.match(r'^Questions?\s+\d+', raw_lines[i + 1] if i + 1 < len(raw_lines) else '', re.I):
                continue
            line = re.sub(r'^Read\s+the\s+text\s+and\s+answer\s+', '', line, flags=re.I)
        if HEADER_LINE_RE.match(line):
            continue
        processed_lines.append(line)

    clean = '\n'.join(processed_lines)
    pat = re.compile(r'(?im)^\s*Questions?\s+([1-9]|[1-3]\d|40)\s*[-–—]\s*([1-9]|[1-3]\d|40)\b')
    matches = list(pat.finditer(clean))
    blocks = []
    for idx, m in enumerate(matches):
        s_q = int(m.group(1))
        e_q = int(m.group(2))
        end_pos = matches[idx + 1].start() if idx + 1 < len(matches) else len(clean)
        blocks.append((s_q, e_q, clean[m.start():end_pos]))
    return blocks


def extract_letter_options(lines: list[str], valid_range=range(65, 76)):
    """Extracts A..J options formatted as 'A. text', 'A) text', or 'A text'."""
    options = []
    cur_key = None
    cur_parts = []
    opt_re = re.compile(r'^\s*([A-J])(?:\s*[.)]\s*|\s+)(.+?)\s*$')

    for raw in lines:
        s = raw.strip()
        if not s:
            if cur_key and cur_parts:
                options.append({'key': cur_key, 'text': re.sub(r'\s+', ' ', ' '.join(cur_parts)).strip()})
                cur_key = None
                cur_parts = []
            continue
        m = opt_re.match(s)
        if m and ord(m.group(1)) in valid_range:
            body = m.group(2).strip()
            if re.fullmatch(r'(?:[A-J]\s*)+', body):
                continue
            if cur_key:
                options.append({'key': cur_key, 'text': re.sub(r'\s+', ' ', ' '.join(cur_parts)).strip()})
            cur_key = m.group(1)
            cur_parts = [body]
        elif cur_key:
            if re.match(r'^\s*\d{1,2}(?:\s*[-–,&]\s*\d{1,2})?\s+', s) or re.search(r'\b\d{1,2}\s*[_.…]{2,}', s):
                options.append({'key': cur_key, 'text': re.sub(r'\s+', ' ', ' '.join(cur_parts)).strip()})
                cur_key = None
                cur_parts = []
            else:
                cur_parts.append(s)

    if cur_key:
        options.append({'key': cur_key, 'text': re.sub(r'\s+', ' ', ' '.join(cur_parts)).strip()})
    return options


def parse_mcq_block(s_q: int, e_q: int, block: str):
    """Parses MCQ single or multi-select stems + choices within [s_q, e_q]."""
    lines = [l.strip() for l in block.split('\n')]
    parsed = {}

    q_header_re = re.compile(r'^([1-9]|[1-3]\d|40)(?:\s*[-–,&]\s*([1-9]|[1-3]\d|40))?(?:\s*[.)]|\s+)\s*(.+)$')
    opt_re = re.compile(r'^([A-J])(?:[.)]\s*|\.\s*|\s+)(.+)$')

    current_nums = None
    stem_parts = []
    opts = []
    cur_opt_key = None
    cur_opt_parts = []
    in_options = False

    def flush_question():
        nonlocal current_nums, stem_parts, opts, cur_opt_key, cur_opt_parts, in_options
        if cur_opt_key:
            opts.append({'key': cur_opt_key, 'text': re.sub(r'\s+', ' ', ' '.join(cur_opt_parts)).strip()})
            cur_opt_key = None
            cur_opt_parts = []
        if current_nums and stem_parts:
            stem = re.sub(r'\s+', ' ', ' '.join(stem_parts)).strip()
            for qn in current_nums:
                if s_q <= qn <= e_q:
                    parsed[qn] = {
                        'promptContext': stem,
                        'options': list(opts) if opts else None,
                    }
        current_nums = None
        stem_parts = []
        opts = []
        in_options = False

    for line in lines:
        if not line or INSTRUCTION_LINE_RE.match(line):
            continue

        qm = q_header_re.match(line)
        if qm:
            q1 = int(qm.group(1))
            q2 = int(qm.group(2)) if qm.group(2) else None
            if s_q <= q1 <= e_q and (q2 is None or (s_q <= q2 <= e_q and q2 >= q1)):
                flush_question()
                current_nums = list(range(q1, (q2 or q1) + 1))
                stem_parts = [qm.group(3).strip()]
                continue

        if current_nums is not None:
            om = opt_re.match(line)
            if om and (om.group(1) == 'A' or in_options) and not re.match(r'^A\s+(?:marketing|group|study|survey|public)\b', line, re.I):
                if cur_opt_key:
                    opts.append({'key': cur_opt_key, 'text': re.sub(r'\s+', ' ', ' '.join(cur_opt_parts)).strip()})
                cur_opt_key = om.group(1)
                cur_opt_parts = [om.group(2).strip()]
                in_options = True
                continue

            if in_options and cur_opt_key:
                cur_opt_parts.append(line)
            else:
                stem_parts.append(line)

    flush_question()
    return parsed


def parse_matching_or_map_block(s_q: int, e_q: int, block: str):
    """Parses matching items (with lettered box A-I) and map labels."""
    lines = [l.strip() for l in block.split('\n')]
    parsed = {}

    option_box_lines = []
    opt_line_re = re.compile(r'^([A-J])(?:\s*[.)]\s*|\s+)(.+)$')

    for line in lines:
        if not line or INSTRUCTION_LINE_RE.match(line):
            continue
        if re.fullmatch(r'(?:[A-J]\s*)+', line):
            continue
        if re.fullmatch(r'(?:Information|Comments|Options|Agreed actions|Things to do|Aspects of the experiment|Sections of Presentation|Products|People|Locations|Criticisms|Technical aspects of presentation)', line, re.I):
            continue
        om = opt_line_re.match(line)
        if om and not re.search(r'\b([1-9]|[1-3]\d|40)\s*[_.…]{2,}', line):
            option_box_lines.append(line)

    shared_opts = extract_letter_options(option_box_lines)
    if len(shared_opts) < 2 or shared_opts[0]['key'] != 'A':
        shared_opts = []

    trail_num_re = re.compile(r'^(.+?)\s+([1-9]|[1-3]\d|40)\s*[_.…]*\s*$')
    lead_num_re = re.compile(r'^([1-9]|[1-3]\d|40)(?:\s*[.)]|\s+)\s*(.+?)\s*[_.…]*$')

    for line in lines:
        if not line or INSTRUCTION_LINE_RE.match(line):
            continue
        if re.fullmatch(r'(?:[A-J]\s*)+', line):
            continue
        if opt_line_re.match(line) and shared_opts and any(line.startswith(o['key']) for o in shared_opts):
            continue

        m_lead = lead_num_re.match(line)
        if m_lead:
            qn = int(m_lead.group(1))
            if s_q <= qn <= e_q and qn not in parsed:
                text = re.sub(r'[_.…]+$', '', m_lead.group(2)).strip()
                if text:
                    parsed[qn] = {
                        'promptContext': text,
                        'options': shared_opts if shared_opts else None,
                    }
                    continue

        m_trail = trail_num_re.match(line)
        if m_trail:
            qn = int(m_trail.group(2))
            if s_q <= qn <= e_q and qn not in parsed:
                text = m_trail.group(1).strip()
                if text and not re.match(r'^Questions?\b', text, re.I):
                    parsed[qn] = {
                        'promptContext': text,
                        'options': shared_opts if shared_opts else None,
                    }

    return parsed


def normalize_gap_lines(s_q: int, e_q: int, block: str):
    """Converts numbered blanks in gap-fill/notes/table blocks into {{blank:N}} units."""
    raw_lines = [l.strip() for l in block.split('\n')]

    blank_dot_re = re.compile(r'(?<!\d)(?<!£)(?<!\$)\b([1-9]|[1-3]\d|40)\s*(?:[_…]+|\.{2,})(?:[.…]+)?')
    surround_dot_re = re.compile(r'(?:[_….]{2,})\s*([1-9]|[1-3]\d|40)\s*(?:[_….]{2,})')
    bare_lead_re = re.compile(r'^([•○●+\-*]?\s*)([1-9]|[1-3]\d|40)\s+([a-z(£$].*)$')
    clause_cont_re = re.compile(
        r'^(?:\{\{blank:\d+\}\}|[,.;:)]|(?:and|or|to|for|with|in|on|at|by|from|of|as|than|that|which|who|when|where|because|including|between|about|into|over|under|during|until|before|after)\b)'
    )

    units = []
    for raw in raw_lines:
        if not raw or INSTRUCTION_LINE_RE.match(raw) or HEADER_LINE_RE.match(raw):
            continue

        s_sub = surround_dot_re.sub(
            lambda m: f' __BLK_{m.group(1)}__ ' if s_q <= int(m.group(1)) <= e_q else m.group(0),
            raw,
        )
        s_sub = blank_dot_re.sub(
            lambda m: f' __BLK_{m.group(1)}__ ' if s_q <= int(m.group(1)) <= e_q else m.group(0),
            s_sub,
        )
        if '__BLK_' not in s_sub:
            bm = bare_lead_re.match(s_sub)
            if bm and s_q <= int(bm.group(2)) <= e_q:
                s_sub = f'{bm.group(1)}__BLK_{bm.group(2)}__ {bm.group(3)}'

        # Convert __BLK_q__ -> {{blank:q}} and strip leftover ellipses directly after blank
        s_sub = re.sub(r'\s*__BLK_(\d+)__(?:\s*[.…]{2,})?\s*', r' {{blank:\1}} ', s_sub)
        s_sub = re.sub(r'\s+', ' ', s_sub).strip()
        if not s_sub:
            continue

        is_bullet_start = bool(re.match(r'^(?:[•○●+\-*·]|\d{1,2}\.|[ivx]+\.|o\s+)', s_sub, re.I))

        if units and not is_bullet_start:
            prev = units[-1]
            prev_ends_punct = bool(re.search(r'[.?!)]$', prev))
            prev_unfinished = bool(
                re.search(
                    r'(?:\b(?:the|a|an|of|in|on|at|to|for|with|by|and|or|as|from|than|about|more|very|his|her|its|their|our|into|between|per)\s*)$',
                    prev,
                    re.I,
                )
            )
            is_short_ending = (
                '{{blank:' not in s_sub
                and len(s_sub.split()) <= 3
                and bool(re.match(r'^[a-z]', s_sub))
            )
            if not prev_ends_punct and (
                prev_unfinished or clause_cont_re.match(s_sub) or is_short_ending
            ):
                units[-1] = f'{prev} {s_sub}'
                continue

        units.append(re.sub(r'^(?:[•○●+\-*·]\s*|o\s+)', '', s_sub).strip())

    parsed = {}
    for unit in units:
        blanks_in_unit = [int(n) for n in re.findall(r'\{\{blank:(\d+)\}\}', unit)]
        if not blanks_in_unit:
            continue
        cleaned_unit = re.sub(r'\s+([.,;:?!)])', r'\1', unit).strip()
        # Clean leftover single trailing period right after a blank unless inside sentence
        cleaned_unit = re.sub(r'(\{\{blank:\d+\}\})\.$', r'\1', cleaned_unit).strip()
        for qn in blanks_in_unit:
            if s_q <= qn <= e_q and qn not in parsed:
                parsed[qn] = {
                    'promptContext': cleaned_unit,
                    'options': None,
                }
    return parsed


def parse_block_questions(s_q: int, e_q: int, block: str):
    low = block.lower()
    is_map = 'label the map' in low or 'label the plan' in low or 'label the diagram' in low
    is_choose_mcq = bool(
        re.search(r'\bchoose\s+(?:the\s+correct\s+answer|two|three)\b', low)
        and not re.search(r'next\s+to\s+questions', low)
    )
    is_matching = bool(
        re.search(r'next\s+to\s+questions|\bchoose\s+(?:the\s+correct\s+letter|five|six|four|seven)\b', low)
        and not is_map
    )

    if is_map or is_matching:
        res = parse_matching_or_map_block(s_q, e_q, block)
        if len(res) >= (e_q - s_q + 1) * 0.6:
            return res

    if is_choose_mcq:
        res = parse_mcq_block(s_q, e_q, block)
        if len(res) >= (e_q - s_q + 1) * 0.6:
            return res

    gap_res = normalize_gap_lines(s_q, e_q, block)
    if len(gap_res) >= (e_q - s_q + 1) * 0.5:
        return gap_res

    mcq_res = parse_mcq_block(s_q, e_q, block)
    if len(mcq_res) > len(gap_res):
        return mcq_res
    match_res = parse_matching_or_map_block(s_q, e_q, block)
    if len(match_res) > len(gap_res):
        return match_res
    return gap_res


def sanitize_existing_prompt(raw: str) -> str:
    txt = PUA_RE.sub('•', raw or '')
    txt = txt.replace('\xa0', ' ')
    txt = re.sub(r'\s+', ' ', txt).strip()
    return txt


def main():
    json_paths = sorted(glob.glob(os.path.join(DATA_DIR, 'vol-*', 'test-*', 'data.json')))
    total_q = 0
    parsed_count = 0
    low_tests = []

    for jp in json_paths:
        test_dir = os.path.dirname(jp)
        pdf_path = os.path.join(test_dir, 'exam.pdf')
        if not os.path.exists(pdf_path):
            continue

        doc = pymupdf.open(pdf_path)
        full_text = '\n'.join(clean_pdf_text(page.get_text('text')) for page in doc)
        doc.close()

        blocks = split_question_blocks(full_text)
        extracted = {}
        for s_q, e_q, btxt in blocks:
            res = parse_block_questions(s_q, e_q, btxt)
            for k, v in res.items():
                if k not in extracted:
                    extracted[k] = v

        with open(jp, 'r', encoding='utf-8') as f:
            data = json.load(f)

        test_parsed = 0
        for q in data.get('questions', []):
            total_q += 1
            qn = q.get('number')
            if qn in extracted:
                q['promptContext'] = extracted[qn]['promptContext']
                if extracted[qn]['options']:
                    q['options'] = extracted[qn]['options']
                else:
                    q.pop('options', None)
                parsed_count += 1
                test_parsed += 1
            else:
                q['promptContext'] = sanitize_existing_prompt(q.get('promptContext', ''))
                q.pop('options', None)

        if test_parsed < 36:
            low_tests.append((data.get('id'), test_parsed))

        with open(jp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')

    print(f'Enriched Listening prompts: {parsed_count}/{total_q} across {len(json_paths)} tests ({parsed_count*100/max(1,total_q):.1f}%)')
    if low_tests:
        print('Tests <36/40:', low_tests)

    for sample_rel in ['vol-7\\test-1\\data.json', 'vol-7\\test-11\\data.json', 'vol-8\\test-1\\data.json', 'vol-9\\test-1\\data.json']:
        sp = os.path.join(DATA_DIR, sample_rel)
        if os.path.exists(sp):
            sd = json.load(open(sp, encoding='utf-8'))
            print(f'\n--- {sd["id"]} sample ---')
            for qn in [1, 2, 11, 21, 26, 31, 33, 34]:
                q = next((x for x in sd['questions'] if x['number'] == qn), None)
                if q:
                    opt_len = len(q.get('options') or [])
                    print(f'  Q{qn}: {q["promptContext"]!r} | ans={q["answerRaw"]!r} | opts={opt_len}')


if __name__ == '__main__':
    main()
