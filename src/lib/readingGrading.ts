import { isSingleAnswerMatch, normalizeIeltsAnswer } from './grading';
import type {
  ReadingAttempt,
  ReadingPassageStats,
  ReadingQuestion,
  ReadingQuestionGradeResult,
  ReadingTestData,
  TextHighlight,
} from '../types/reading';

/**
 * Official IDP / Cambridge IELTS Academic Reading raw score (out of 40) to Band conversion.
 */
export function rawScoreToAcademicReadingBand(rawScore: number, keyedTotal = 40): number {
  if (keyedTotal <= 0) return 0;
  const normalized40 =
    keyedTotal === 40
      ? Math.max(0, Math.min(40, Math.round(rawScore)))
      : Math.max(0, Math.min(40, Math.round((rawScore / keyedTotal) * 40)));

  if (normalized40 >= 39) return 9.0;
  if (normalized40 >= 37) return 8.5;
  if (normalized40 >= 35) return 8.0;
  if (normalized40 >= 33) return 7.5;
  if (normalized40 >= 30) return 7.0;
  if (normalized40 >= 27) return 6.5;
  if (normalized40 >= 23) return 6.0;
  if (normalized40 >= 19) return 5.5;
  if (normalized40 >= 15) return 5.0;
  if (normalized40 >= 13) return 4.5;
  if (normalized40 >= 10) return 4.0;
  if (normalized40 >= 8) return 3.5;
  if (normalized40 >= 6) return 3.0;
  if (normalized40 >= 4) return 2.5;
  if (normalized40 >= 3) return 2.0;
  if (normalized40 >= 2) return 1.5;
  if (normalized40 >= 1) return 1.0;
  return 0.0;
}

function normalizeReadingValue(
  value: string,
  type: ReadingQuestion['type']
): string {
  const base = normalizeIeltsAnswer(value);
  if (!base) return '';

  if (type === 'tfng') {
    if (base === 't') return 'true';
    if (base === 'f') return 'false';
    if (base === 'ng' || base === 'notgiven') return 'not given';
  }
  if (type === 'ynng') {
    if (base === 'y') return 'yes';
    if (base === 'n') return 'no';
    if (base === 'ng' || base === 'notgiven') return 'not given';
  }
  return base;
}

function matchesReadingSingle(
  userAnswer: string,
  acceptedAnswers: string[],
  type: ReadingQuestion['type']
): boolean {
  const normUser = normalizeReadingValue(userAnswer, type);
  if (!normUser) return false;

  if (type === 'tfng' || type === 'ynng') {
    return acceptedAnswers.some(
      (acc) => normalizeReadingValue(acc, type) === normUser
    );
  }

  return isSingleAnswerMatch(userAnswer, acceptedAnswers);
}

export interface GradeReadingExamInput {
  testData: ReadingTestData;
  answers: Record<number, string>;
  flagged: number[];
  highlights: TextHighlight[];
  mode: 'real' | 'practice';
  startedAt: number;
  finishedAt?: number;
}

export function gradeReadingExam(input: GradeReadingExamInput): ReadingAttempt {
  const { testData, answers, flagged, highlights, mode, startedAt } = input;
  const finishedAt = input.finishedAt ?? Date.now();
  const flaggedSet = new Set(flagged);

  const flatQuestions: Array<{ passageNumber: 1 | 2 | 3; q: ReadingQuestion }> = [];
  for (const p of testData.passages) {
    for (const g of p.groups) {
      for (const q of g.questions) {
        flatQuestions.push({ passageNumber: p.passageNumber, q });
      }
    }
  }
  flatQuestions.sort((a, b) => a.q.number - b.q.number);

  // Pre-track shared sibling pools (`mcq_multi`) so reversed order works without double credit.
  const consumedByPoolKey = new Map<string, Set<number>>();
  const siblingCorrectMap = new Map<number, boolean>();

  for (const { q } of flatQuestions) {
    if (!q.siblingNumbers || q.siblingNumbers.length <= 1 || q.acceptedAnswers.length === 0) {
      continue;
    }
    const poolKey = [...q.siblingNumbers].sort((a, b) => a - b).join('-');
    if (consumedByPoolKey.has(poolKey)) continue;

    const used = new Set<number>();
    consumedByPoolKey.set(poolKey, used);

    const poolItems = q.acceptedAnswers.map((a) => a.trim()).filter(Boolean);
    const orderedNums = [...q.siblingNumbers].sort((a, b) => a - b);

    for (const qNum of orderedNums) {
      const ans = (answers[qNum] ?? '').trim();
      if (!ans) {
        siblingCorrectMap.set(qNum, false);
        continue;
      }

      let matchedIdx = -1;
      for (let idx = 0; idx < poolItems.length; idx++) {
        if (used.has(idx)) continue;
        if (matchesReadingSingle(ans, [poolItems[idx]], q.type)) {
          matchedIdx = idx;
          break;
        }
      }

      if (matchedIdx !== -1) {
        used.add(matchedIdx);
        siblingCorrectMap.set(qNum, true);
      } else {
        siblingCorrectMap.set(qNum, false);
      }
    }
  }

  const results: ReadingQuestionGradeResult[] = flatQuestions.map(
    ({ passageNumber, q }) => {
      const userAnswer = (answers[q.number] ?? '').trim();
      const unkeyed = q.acceptedAnswers.length === 0;
      let isCorrect = false;

      if (!unkeyed) {
        if (q.siblingNumbers && q.siblingNumbers.length > 1) {
          isCorrect = siblingCorrectMap.get(q.number) ?? false;
        } else {
          isCorrect = matchesReadingSingle(userAnswer, q.acceptedAnswers, q.type);
        }
      }

      const canonicalAnswer =
        q.siblingNumbers && q.siblingNumbers.length > 1 && q.acceptedAnswers.length > 0
          ? q.acceptedAnswers.join(', ')
          : q.acceptedAnswers[0] ?? '';

      return {
        questionNumber: q.number,
        passageNumber,
        type: q.type,
        userAnswer,
        acceptedAnswers: q.acceptedAnswers,
        canonicalAnswer,
        isCorrect,
        unkeyed,
        flagged: flaggedSet.has(q.number),
        evidenceParagraphId: q.evidenceParagraphId,
        evidenceLocation: q.evidenceLocation,
        evidenceQuote: q.evidenceQuote,
        evidenceTranslationVi: q.evidenceTranslationVi,
        explanationVi: q.explanationVi,
        siblingNumbers: q.siblingNumbers,
      };
    }
  );

  const passageStats: ReadingPassageStats[] = testData.passages.map((p) => {
    const pResults = results.filter((r) => r.passageNumber === p.passageNumber);
    const keyed = pResults.filter((r) => !r.unkeyed);
    const correct = keyed.filter((r) => r.isCorrect).length;
    return {
      passageNumber: p.passageNumber,
      title: p.title,
      correct,
      keyedTotal: keyed.length,
      totalQuestions: pResults.length,
    };
  });

  const keyedResults = results.filter((r) => !r.unkeyed);
  const score = keyedResults.filter((r) => r.isCorrect).length;
  const keyedTotal = keyedResults.length;
  const band = keyedTotal > 0 ? rawScoreToAcademicReadingBand(score, keyedTotal) : 0;

  return {
    testId: testData.testId,
    vol: testData.vol,
    test: testData.test,
    title: testData.title,
    mode,
    startedAt,
    finishedAt,
    durationSec: Math.max(0, Math.round((finishedAt - startedAt) / 1000)),
    answers: { ...answers },
    flagged: [...flagged],
    highlights: [...highlights],
    score,
    keyedTotal,
    band,
    passageStats,
    results,
  };
}
