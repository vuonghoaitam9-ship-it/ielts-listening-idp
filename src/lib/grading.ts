import type { QuestionGradeResult, QuestionItem } from '../types';

const UK_US_MAP: Record<string, string> = {
  colour: 'color',
  colours: 'colors',
  coloured: 'colored',
  favour: 'favor',
  favourite: 'favorite',
  centre: 'center',
  centres: 'centers',
  theatre: 'theater',
  metre: 'meter',
  metres: 'meters',
  centimetre: 'centimeter',
  centimetres: 'centimeters',
  kilometre: 'kilometer',
  kilometres: 'kilometers',
  litre: 'liter',
  litres: 'liters',
  licence: 'license',
  practise: 'practice',
  travelling: 'traveling',
  travelled: 'traveled',
  cancelled: 'canceled',
  cancelling: 'canceling',
  labelling: 'labeling',
  labelled: 'labeled',
  programme: 'program',
  programmes: 'programs',
  catalogue: 'catalog',
  dialogue: 'dialog',
  cheque: 'check',
  organisation: 'organization',
  organise: 'organize',
  recognise: 'recognize',
  prioritise: 'prioritize',
  fertiliser: 'fertilizer',
  behaviour: 'behavior',
  neighbour: 'neighbor',
  neighbourhood: 'neighborhood',
  harbour: 'harbor',
  ageing: 'aging',
  jewellery: 'jewelry',
  grey: 'gray',
  defence: 'defense',
  offence: 'offense',
  centred: 'centered',
};

const WORD_NUMBERS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
};

const MONTHS: Record<string, string> = {
  jan: 'january',
  january: 'january',
  feb: 'february',
  february: 'february',
  mar: 'march',
  march: 'march',
  apr: 'april',
  april: 'april',
  may: 'may',
  jun: 'june',
  june: 'june',
  jul: 'july',
  july: 'july',
  aug: 'august',
  august: 'august',
  sep: 'september',
  sept: 'september',
  september: 'september',
  oct: 'october',
  october: 'october',
  nov: 'november',
  november: 'november',
  dec: 'december',
  december: 'december',
};

export function normalizeIeltsAnswer(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  // Remove leading currency symbols or trailing punctuation
  s = s.replace(/[£$€]/g, ' ');
  s = s.replace(/['’]/g, "'");
  // Normalize 14,000 -> 14000
  s = s.replace(/(\d),(\d{3})\b/g, '$1$2');
  // Normalize 4.30 or 8:55 time formats consistently to 4:30
  s = s.replace(/\b(\d{1,2})\.(\d{2})\b/g, '$1:$2');
  // Normalize 20% -> 20 percent
  s = s.replace(/(\d+)\s*%/g, '$1 percent');
  // Hyphens / dashes -> spaces
  s = s.replace(/[-–—/]+/g, ' ');
  // Strip outer/stray punctuation except colons inside time and apostrophes
  s = s.replace(/[.,!?;:"()[\]]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Normalize UK/US spelling, number words, and ordinal suffixes in dates
  const tokens = s.split(' ').filter(Boolean).map((tok) => {
    const clean = UK_US_MAP[tok] ?? tok;
    if (WORD_NUMBERS[clean]) return WORD_NUMBERS[clean];
    if (MONTHS[clean]) return MONTHS[clean];
    // 12th -> 12, 1st -> 1, 2nd -> 2, 3rd -> 3
    const ord = clean.match(/^(\d{1,2})(?:st|nd|rd|th)$/);
    if (ord) return ord[1];
    return clean;
  });

  // Normalize "of" in dates: "11 of july" -> "11 july"
  const filtered = tokens.filter((t, i) => {
    if (t === 'of' && i > 0 && /^\d+$/.test(tokens[i - 1]) && i + 1 < tokens.length && Object.values(MONTHS).includes(tokens[i + 1])) {
      return false;
    }
    return true;
  });

  // Canonicalize "month day" to "day month" so "july 11" matches "11 july"
  if (
    filtered.length === 2 &&
    Object.values(MONTHS).includes(filtered[0]) &&
    /^\d{1,2}$/.test(filtered[1])
  ) {
    return `${filtered[1]} ${filtered[0]}`;
  }

  return filtered.join(' ');
}

/** Expand a single raw answer pattern containing slashes, non-numeric commas, or optional parentheses. */
export function expandAcceptedVariants(rawPattern: string): string[] {
  const variants = new Set<string>();
  const slashParts = rawPattern.split('/').map((x) => x.trim()).filter(Boolean);
  const commaSplitParts: string[] = [];
  for (const part of slashParts) {
    if (/,(?!\d{3}\b)/.test(part)) {
      commaSplitParts.push(...part.split(/,(?!\d{3}\b)/).map((x) => x.trim()).filter(Boolean));
    } else {
      commaSplitParts.push(part);
    }
  }
  for (const part of commaSplitParts) {
    variants.add(normalizeIeltsAnswer(part));
    if (part.includes('(') && part.includes(')')) {
      variants.add(normalizeIeltsAnswer(part.replace(/[()]/g, '')));
      variants.add(normalizeIeltsAnswer(part.replace(/\([^)]*\)/g, '')));
    }
  }
  return Array.from(variants).filter(Boolean);
}

export function isSingleAnswerMatch(userAnswer: string, acceptedAnswers: string[]): boolean {
  const normUser = normalizeIeltsAnswer(userAnswer);
  if (!normUser) return false;
  for (const acc of acceptedAnswers) {
    const expanded = expandAcceptedVariants(acc);
    if (expanded.includes(normUser)) {
      return true;
    }
  }
  return false;
}

/** Standard IDP IELTS Listening 40-question raw score -> Band conversion. */
export function rawScoreToIeltsBand(score: number): number {
  if (score >= 39) return 9.0;
  if (score >= 37) return 8.5;
  if (score >= 35) return 8.0;
  if (score >= 32) return 7.5;
  if (score >= 30) return 7.0;
  if (score >= 26) return 6.5;
  if (score >= 23) return 6.0;
  if (score >= 18) return 5.5;
  if (score >= 16) return 5.0;
  if (score >= 13) return 4.5;
  if (score >= 10) return 4.0;
  if (score >= 6) return 3.5;
  if (score >= 4) return 3.0;
  return score > 0 ? 2.5 : 0.0;
}

export function gradeListeningExam(
  questions: QuestionItem[],
  userAnswers: Record<number, string>,
  flaggedNumbers: number[]
): {
  score: number;
  total: number;
  band: number;
  partScores: Record<1 | 2 | 3 | 4, number>;
  results: QuestionGradeResult[];
} {
  const flaggedSet = new Set(flaggedNumbers);
  // Track consumed pool answers per shared multi-select group so duplicate inputs don't double-score
  const groupPoolRemaining = new Map<string, string[]>();
  for (const q of questions) {
    if (q.sharedGroup && !groupPoolRemaining.has(q.sharedGroup.groupId)) {
      groupPoolRemaining.set(
        q.sharedGroup.groupId,
        q.sharedGroup.poolAnswers.map((a) => normalizeIeltsAnswer(a))
      );
    }
  }

  const results: QuestionGradeResult[] = [];
  const partScores: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let score = 0;

  for (const q of questions) {
    const rawUser = (userAnswers[q.number] ?? '').trim();
    let isCorrect = false;

    if (q.sharedGroup) {
      const pool = groupPoolRemaining.get(q.sharedGroup.groupId) ?? [];
      const normUser = normalizeIeltsAnswer(rawUser);
      const matchIdx = normUser ? pool.indexOf(normUser) : -1;
      if (matchIdx !== -1) {
        isCorrect = true;
        pool.splice(matchIdx, 1);
      }
    } else {
      isCorrect = isSingleAnswerMatch(rawUser, q.acceptedAnswers);
    }

    if (isCorrect) {
      score += 1;
      partScores[q.part] += 1;
    }

    results.push({
      questionNumber: q.number,
      part: q.part,
      userAnswer: rawUser,
      canonicalAnswer: q.canonicalAnswer,
      acceptedAnswers: q.acceptedAnswers,
      isCorrect,
      flagged: flaggedSet.has(q.number),
    });
  }

  return {
    score,
    total: questions.length,
    band: rawScoreToIeltsBand(score),
    partScores,
    results,
  };
}
