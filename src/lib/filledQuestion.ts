import type { QuestionItem } from '../types';
import type {
  ReadingOption,
  ReadingQuestion,
  ReadingQuestionGroup,
} from '../types/reading';

export interface FilledQuestionPart {
  text: string;
  isAnswer?: boolean;
  isSecondaryBlank?: boolean;
}

export interface FilledQuestionView {
  parts: FilledQuestionPart[];
  suffixAnswer?: string;
  diagramUrl?: string;
}

const PUA_RE = /[\uf000-\uf8ff]+/g;

function cleanText(raw: string): string {
  return raw
    .replace(PUA_RE, '•')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function stripLeadingBullet(line: string): string {
  return line
    .trim()
    .replace(/^(?:[•○●▪▫+\-*·]\s+|o\s+)/, '')
    .trim();
}

/**
 * Resolves an answer key (e.g. "C", "v", "v) Heading", "G (popular)") against option choices.
 */
function resolveOptionDisplay(
  rawAnswer: string,
  options: ReadingOption[] | undefined
): string {
  const trimmed = rawAnswer.trim();
  if (!trimmed || !options || options.length === 0) return trimmed;

  // Match bare letter/Roman key, or key with inline "(note)" / ") text"
  const keyMatch = /^([A-J]|[ivx]+)(?:\s*[.)]\s*(.+)|\s*\(([^)]+)\))?$/i.exec(trimmed);
  if (keyMatch) {
    const k = keyMatch[1];
    const found = options.find((o) => o.key.toLowerCase() === k.toLowerCase());
    if (
      found &&
      found.text &&
      found.text.toLowerCase() !== found.key.toLowerCase() &&
      !found.text.startsWith('Phương án ')
    ) {
      return `${found.key}. ${found.text}`;
    }
    if (keyMatch[2]) return `${k}. ${keyMatch[2].trim()}`;
    return trimmed;
  }

  return trimmed;
}

/**
 * Extracts the exact bullet/sentence unit from `bodyText` / `prompt` that contains `{{blank:qNum}}`.
 */
function extractBlankUnit(sourceText: string, qNum: number): string {
  const token = `{{blank:${qNum}}}`;
  const rawLines = sourceText.replace(/\r\n/g, '\n').split('\n');

  const units: string[] = [];
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const startsBullet = /^(?:[•○●▪▫+\-*·]\s+|o\s+|\d+\.\s+|[ivx]+\.\s+)/i.test(trimmed);
    const cleanedLine = stripLeadingBullet(trimmed);
    if (!cleanedLine) continue;

    if (units.length > 0 && !startsBullet) {
      const prev = units[units.length - 1];
      const prevEndsSentence = /[.?!)]$/.test(prev);
      const prevOpenPhrase =
        /\b(?:the|a|an|of|in|on|at|to|for|with|by|and|or|as|from|into|like|than|about|more|very|their|his|her|its|our)\s*$/i.test(
          prev
        );
      const startsContinuation = /^(?:\{\{blank:\d+\}\}|[a-z(,.;:)])/.test(cleanedLine);

      if (!prevEndsSentence && (prevOpenPhrase || startsContinuation)) {
        units[units.length - 1] = `${prev} ${cleanedLine}`;
        continue;
      }
    }

    units.push(cleanedLine);
  }

  const matchedUnit = units.find((u) => u.includes(token));
  if (!matchedUnit) {
    return cleanText(sourceText.replace(/\n+/g, ' '));
  }

  // Narrow multi-sentence prose blocks down to the exact sentence containing `{{blank:qNum}}`.
  const sentences = matchedUnit.split(/(?<=[.?!])\s+(?=[A-Z“"']|\{\{blank:)/);
  if (sentences.length > 1) {
    const hit = sentences.find((s) => s.includes(token));
    if (hit) return cleanText(hit);
  }

  return cleanText(matchedUnit);
}

function splitTemplateToParts(
  template: string,
  primaryQNum: number,
  primaryDisplay: string,
  resolveSecondary: (qNum: number) => string
): FilledQuestionPart[] {
  const rawParts = template.split(/(\{\{blank:\d+\}\})/g);
  const parts: FilledQuestionPart[] = [];

  for (const piece of rawParts) {
    if (!piece) continue;
    const m = /^\{\{blank:(\d+)\}\}$/.exec(piece);
    if (!m) {
      parts.push({ text: piece });
      continue;
    }

    const num = Number(m[1]);
    if (num === primaryQNum) {
      parts.push({ text: primaryDisplay, isAnswer: true });
    } else {
      parts.push({ text: resolveSecondary(num), isSecondaryBlank: true });
    }
  }

  return parts.length > 0 ? parts : [{ text: template }];
}

function extractTableCellUnit(
  group: ReadingQuestionGroup | undefined,
  qNum: number,
  fallbackPrompt: string
): string {
  const token = `{{blank:${qNum}}}`;
  const table = group?.table;
  if (!table) return extractBlankUnit(fallbackPrompt, qNum);

  const allRows = [table.headers, ...table.rows];
  for (let r = 0; r < allRows.length; r++) {
    const row = allRows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c] ?? '';
      if (!cell.includes(token)) continue;

      let combined = cell.trim();

      // Rejoin wrapped PDF table continuation rows in the same column
      if (
        r > 0 &&
        /^(?:of|to|for|with|in|on|at|by|from|after|before|and|or|\{\{blank:)/i.test(
          combined
        )
      ) {
        const prevCell = (allRows[r - 1]?.[c] ?? '').replace(/\s+[o•●]\s*$/, '').trim();
        if (prevCell && !/\{\{blank:\d+\}\}/.test(prevCell)) {
          // Deduplicate repeated trailing word when wrapped line repeats preposition ("before the invention o" + "of {{blank:8}}")
          const prevClean = prevCell.replace(/\s+\bo$/, '').trim();
          combined = `${prevClean} ${combined}`.trim();
        }
      }

      // Include column-0 context label if blank lives in another column
      if (c > 0) {
        const rowLabel = (row[0] ?? '').trim();
        const isBoilerplate =
          /^(?:Complete the|Write\s+)/i.test(rowLabel) || !rowLabel;
        if (!isBoilerplate && !/\{\{blank:\d+\}\}/.test(rowLabel)) {
          combined = `${rowLabel}: ${combined}`;
        }
      }

      return cleanText(combined.replace(/\s+[o•●]\s*$/g, ''));
    }
  }

  return cleanText(fallbackPrompt.replace(/^\|+\s*/, '').replace(/\n+/g, ' '));
}

export interface BuildFilledReadingInput {
  question: ReadingQuestion;
  group?: ReadingQuestionGroup;
  canonicalAnswer: string;
  acceptedAnswers: string[];
  unkeyed: boolean;
  questionMap?: Map<number, ReadingQuestion>;
}

/**
 * Formats an IELTS Reading question together with its standard answer filled directly in context.
 */
export function buildFilledReadingQuestion(
  input: BuildFilledReadingInput
): FilledQuestionView {
  const { question, group, canonicalAnswer, acceptedAnswers, unkeyed, questionMap } =
    input;
  const qNum = question.number;
  const options = question.options ?? group?.options;

  const secondaryResolver = (otherNum: number): string => {
    const sib = questionMap?.get(otherNum);
    const ans = sib?.acceptedAnswers[0];
    if (!ans) return `[Q${otherNum}]`;
    return group?.type === 'summary_box'
      ? resolveOptionDisplay(ans, group.options)
      : ans;
  };

  if (unkeyed) {
    const template =
      group?.type === 'table_completion'
        ? extractTableCellUnit(group, qNum, question.prompt)
        : group?.type === 'gap_fill' || group?.type === 'summary_box'
        ? extractBlankUnit(group.bodyText || question.prompt, qNum)
        : cleanText(question.prompt);

    if (template.includes(`{{blank:${qNum}}}`)) {
      return {
        parts: splitTemplateToParts(
          template,
          qNum,
          '______ (Chưa có Key gốc)',
          secondaryResolver
        ),
        diagramUrl: group?.diagramUrl,
      };
    }

    return {
      parts: [
        {
          text:
            question.prompt && !/^Question \d+$/i.test(question.prompt.trim())
              ? cleanText(question.prompt)
              : `Câu ${qNum} (ô trống bị in thiếu/trùng số trên tài liệu gốc)`,
        },
      ],
      suffixAnswer: 'Chưa có Key gốc',
      diagramUrl: group?.diagramUrl,
    };
  }

  // Gap Fill & Summary Completion
  if (question.type === 'gap_fill' || question.type === 'summary_box') {
    const sourceText = group?.bodyText || question.prompt;
    const unit = extractBlankUnit(sourceText, qNum);
    const ansDisplay =
      question.type === 'summary_box'
        ? resolveOptionDisplay(canonicalAnswer, options)
        : canonicalAnswer;

    if (unit.includes(`{{blank:${qNum}}}`)) {
      return {
        parts: splitTemplateToParts(unit, qNum, ansDisplay, secondaryResolver),
      };
    }
    const cleanFallback =
      question.prompt && !/^Question \d+$/i.test(question.prompt.trim())
        ? cleanText(question.prompt)
        : `Câu ${qNum} (ô trống bị in thiếu/trùng số trên tài liệu gốc)`;
    return {
      parts: /\{\{blank:\d+\}\}/.test(cleanFallback)
        ? splitTemplateToParts(cleanFallback, qNum, ansDisplay, secondaryResolver)
        : [{ text: cleanFallback }],
      suffixAnswer: ansDisplay,
    };
  }

  // Table Completion
  if (question.type === 'table_completion') {
    const unit = extractTableCellUnit(group, qNum, question.prompt);
    if (unit.includes(`{{blank:${qNum}}}`)) {
      return {
        parts: splitTemplateToParts(unit, qNum, canonicalAnswer, secondaryResolver),
      };
    }
    return {
      parts: /\{\{blank:\d+\}\}/.test(unit)
        ? splitTemplateToParts(unit, qNum, canonicalAnswer, secondaryResolver)
        : [{ text: unit }],
      suffixAnswer: canonicalAnswer,
    };
  }

  // Multi-select MCQ
  if (question.type === 'mcq_multi') {
    const resolvedMulti = acceptedAnswers
      .map((a) => resolveOptionDisplay(a, options))
      .join(' · ');
    return {
      parts: [{ text: cleanText(question.prompt) }],
      suffixAnswer: resolvedMulti || canonicalAnswer,
    };
  }

  // Matching Headings / Info / Features / Sentence Endings / Single MCQ / TFNG / YNNG
  if (
    question.type === 'mcq_single' ||
    question.type === 'matching_headings' ||
    question.type === 'matching_info' ||
    question.type === 'matching_features' ||
    question.type === 'matching_sentence_endings'
  ) {
    const promptText =
      question.type === 'matching_headings' &&
      /^Section\/Paragraph for Question \d+$/i.test(question.prompt.trim())
        ? `Section / Đoạn văn (Câu ${qNum})`
        : cleanText(question.prompt);

    return {
      parts: [{ text: promptText }],
      suffixAnswer: resolveOptionDisplay(canonicalAnswer, options),
    };
  }

  // Diagram Label / Short Answer / Fallback
  const rawPrompt = cleanText(question.prompt);
  if (rawPrompt.includes(`{{blank:${qNum}}}`)) {
    return {
      parts: splitTemplateToParts(rawPrompt, qNum, canonicalAnswer, secondaryResolver),
      diagramUrl: group?.diagramUrl,
    };
  }

  const normalizedPrompt =
    question.type === 'diagram_label' && /^Question \d+$/i.test(rawPrompt)
      ? `Nhãn số ${qNum} trên sơ đồ`
      : rawPrompt || `Câu ${qNum}`;

  return {
    parts: [{ text: normalizedPrompt }],
    suffixAnswer: canonicalAnswer,
    diagramUrl: group?.diagramUrl,
  };
}

/**
 * Formats an IELTS Listening question together with its standard answer filled in context.
 */
export function buildFilledListeningQuestion(
  q: QuestionItem,
  questionMap?: Map<number, QuestionItem>
): FilledQuestionView {
  const prompt = cleanText(q.promptContext || '');
  const rawAnswer = (q.answerRaw || q.canonicalAnswer).trim();

  // Resolve option descriptions when letter-choice answers are available
  let resolvedSuffix = rawAnswer;
  if (q.options && q.options.length > 0) {
    if (rawAnswer.includes(',')) {
      resolvedSuffix = rawAnswer
        .split(',')
        .map((part) => resolveOptionDisplay(part.trim(), q.options))
        .join(' · ');
    } else {
      resolvedSuffix = resolveOptionDisplay(rawAnswer, q.options);
    }
  }

  const token = `{{blank:${q.number}}}`;
  if (prompt.includes(token)) {
    return {
      parts: splitTemplateToParts(prompt, q.number, rawAnswer, (otherNum) => {
        const sib = questionMap?.get(otherNum);
        return (sib?.canonicalAnswer || sib?.answerRaw || `[Q${otherNum}]`).trim();
      }),
    };
  }

  if (!prompt || /^(?:TEST|LISTENING\s+VOL.*)$/i.test(prompt)) {
    return {
      parts: [{ text: `Câu ${q.number} (đề PDF gốc)` }],
      suffixAnswer: resolvedSuffix,
    };
  }

  return {
    parts: [{ text: prompt }],
    suffixAnswer: resolvedSuffix,
  };
}
