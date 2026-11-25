import { describe, expect, it } from 'vitest';
import {
  gradeListeningExam,
  isSingleAnswerMatch,
  normalizeIeltsAnswer,
  rawScoreToIeltsBand,
} from '../lib/grading';
import type { QuestionItem } from '../types';

describe('IELTS Listening grading engine', () => {
  it('normalizes case, UK/US spelling, dates, and currency/numbers', () => {
    expect(normalizeIeltsAnswer('  City  ')).toBe('city');
    expect(isSingleAnswerMatch('color', ['colour,color'])).toBe(true);
    expect(isSingleAnswerMatch('colour', ['color'])).toBe(true);
    expect(isSingleAnswerMatch('centre', ['center'])).toBe(true);
    expect(isSingleAnswerMatch('14000', ['14,000'])).toBe(true);
    expect(isSingleAnswerMatch('4:30', ['4.30'])).toBe(true);
    expect(isSingleAnswerMatch('80', ['$80'])).toBe(true);
    expect(isSingleAnswerMatch('July 12th', ['12th January', '12 July'])).toBe(true);
    expect(isSingleAnswerMatch('three', ['3'])).toBe(true);
    expect(isSingleAnswerMatch('problem solving', ['problem-solving'])).toBe(true);
  });

  it('handles slashes and optional parentheses', () => {
    expect(isSingleAnswerMatch('car', ['a (new) car'])).toBe(false);
    expect(isSingleAnswerMatch('a car', ['a (new) car'])).toBe(true);
    expect(isSingleAnswerMatch('a new car', ['a (new) car'])).toBe(true);
    expect(isSingleAnswerMatch('8 May', ['May 8th/8 May'])).toBe(true);
    expect(isSingleAnswerMatch('licence', ['license / lice'])).toBe(true);
  });

  it('prevents duplicate points on shared multi-select groups', () => {
    const mockQuestions: QuestionItem[] = [
      {
        number: 17,
        part: 2,
        promptContext: '',
        answerRaw: 'B, C',
        canonicalAnswer: 'B, C',
        acceptedAnswers: ['B', 'C'],
        sharedGroup: { groupId: 'g1', questionNumbers: [17, 18], poolAnswers: ['B', 'C'] },
        evidenceQuote: '',
        evidenceStartTime: 0,
        evidenceEndTime: 1,
        paraphrases: [],
        distractors: [],
        explanationVi: '',
      },
      {
        number: 18,
        part: 2,
        promptContext: '',
        answerRaw: 'B, C',
        canonicalAnswer: 'B, C',
        acceptedAnswers: ['B', 'C'],
        sharedGroup: { groupId: 'g1', questionNumbers: [17, 18], poolAnswers: ['B', 'C'] },
        evidenceQuote: '',
        evidenceStartTime: 0,
        evidenceEndTime: 1,
        paraphrases: [],
        distractors: [],
        explanationVi: '',
      },
    ];

    // Student enters B in both 17 and 18 -> only 1 point
    const dupRes = gradeListeningExam(mockQuestions, { 17: 'b', 18: 'B' }, []);
    expect(dupRes.score).toBe(1);

    // Student enters reversed order C, B -> 2 points
    const revRes = gradeListeningExam(mockQuestions, { 17: 'c', 18: 'b' }, [17]);
    expect(revRes.score).toBe(2);
    expect(revRes.results[0].flagged).toBe(true);
  });

  it('converts raw score /40 to standard IELTS Band', () => {
    expect(rawScoreToIeltsBand(40)).toBe(9.0);
    expect(rawScoreToIeltsBand(35)).toBe(8.0);
    expect(rawScoreToIeltsBand(30)).toBe(7.0);
    expect(rawScoreToIeltsBand(23)).toBe(6.0);
    expect(rawScoreToIeltsBand(16)).toBe(5.0);
    expect(rawScoreToIeltsBand(0)).toBe(0.0);
  });
});
