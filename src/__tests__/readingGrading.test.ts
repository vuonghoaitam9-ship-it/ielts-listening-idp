import { describe, expect, it } from 'vitest';
import {
  gradeReadingExam,
  rawScoreToAcademicReadingBand,
} from '../lib/readingGrading';
import type { ReadingTestData } from '../types/reading';

describe('IELTS Academic Reading grading engine', () => {
  it('converts Academic Reading raw scores accurately to IELTS Band', () => {
    expect(rawScoreToAcademicReadingBand(40)).toBe(9.0);
    expect(rawScoreToAcademicReadingBand(39)).toBe(9.0);
    expect(rawScoreToAcademicReadingBand(35)).toBe(8.0);
    expect(rawScoreToAcademicReadingBand(33)).toBe(7.5);
    expect(rawScoreToAcademicReadingBand(30)).toBe(7.0);
    expect(rawScoreToAcademicReadingBand(27)).toBe(6.5);
    expect(rawScoreToAcademicReadingBand(23)).toBe(6.0);
    expect(rawScoreToAcademicReadingBand(19)).toBe(5.5);
    expect(rawScoreToAcademicReadingBand(15)).toBe(5.0);
    expect(rawScoreToAcademicReadingBand(0)).toBe(0.0);
  });

  it('grades TFNG, YNNG, Roman numerals, variants, order-independent mcq_multi, and unkeyed items', () => {
    const mockTest: ReadingTestData = {
      vol: 7,
      test: 1,
      testId: 'vol-7-test-1',
      title: 'Mock Reading Test',
      sourceName: 'Test',
      status: 'partial',
      hasKey: true,
      keyCount: 5,
      passages: [
        {
          passageNumber: 1,
          title: 'Passage 1',
          questionRange: [1, 2],
          paragraphs: [{ id: 'p1-1', text: 'Sample paragraph.' }],
          groups: [
            {
              id: 'g1',
              questionRange: [1, 2],
              type: 'tfng',
              instruction: 'TRUE / FALSE / NOT GIVEN',
              questions: [
                {
                  number: 1,
                  prompt: 'Stmt 1',
                  type: 'tfng',
                  acceptedAnswers: ['TRUE'],
                  evidenceParagraphId: 'p1-1',
                  evidenceLocation: 'Đoạn 1',
                  evidenceQuote: 'Sample',
                  evidenceTranslationVi: 'Mẫu',
                  explanationVi: 'Giải thích 1',
                },
                {
                  number: 2,
                  prompt: 'Stmt 2',
                  type: 'tfng',
                  acceptedAnswers: ['NOT GIVEN'],
                  evidenceParagraphId: 'p1-1',
                  evidenceLocation: 'Đoạn 1',
                  evidenceQuote: 'Sample',
                  evidenceTranslationVi: 'Mẫu',
                  explanationVi: 'Giải thích 2',
                },
              ],
            },
          ],
        },
        {
          passageNumber: 2,
          title: 'Passage 2',
          questionRange: [3, 5],
          paragraphs: [{ id: 'p2-A', label: 'A', text: 'Passage 2 content.' }],
          groups: [
            {
              id: 'g2',
              questionRange: [3, 3],
              type: 'matching_headings',
              instruction: 'Headings',
              questions: [
                {
                  number: 3,
                  prompt: 'Paragraph A',
                  type: 'matching_headings',
                  acceptedAnswers: ['iv'],
                  evidenceParagraphId: 'p2-A',
                  evidenceLocation: 'Đoạn A',
                  evidenceQuote: 'Passage 2',
                  evidenceTranslationVi: 'Đoạn 2',
                  explanationVi: 'Giải thích 3',
                },
              ],
            },
            {
              id: 'g3',
              questionRange: [4, 5],
              type: 'mcq_multi',
              selectCount: 2,
              instruction: 'Choose TWO letters',
              questions: [
                {
                  number: 4,
                  prompt: 'Option 1',
                  type: 'mcq_multi',
                  siblingNumbers: [4, 5],
                  acceptedAnswers: ['B', 'E'],
                  evidenceParagraphId: 'p2-A',
                  evidenceLocation: 'Đoạn A',
                  evidenceQuote: 'content',
                  evidenceTranslationVi: 'nội dung',
                  explanationVi: 'Giải thích 4',
                },
                {
                  number: 5,
                  prompt: 'Option 2',
                  type: 'mcq_multi',
                  siblingNumbers: [4, 5],
                  acceptedAnswers: ['B', 'E'],
                  evidenceParagraphId: 'p2-A',
                  evidenceLocation: 'Đoạn A',
                  evidenceQuote: 'content',
                  evidenceTranslationVi: 'nội dung',
                  explanationVi: 'Giải thích 5',
                },
              ],
            },
          ],
        },
        {
          passageNumber: 3,
          title: 'Passage 3',
          questionRange: [6, 6],
          paragraphs: [{ id: 'p3-1', text: 'Unkeyed passage.' }],
          groups: [
            {
              id: 'g4',
              questionRange: [6, 6],
              type: 'gap_fill',
              instruction: 'ONE WORD',
              questions: [
                {
                  number: 6,
                  prompt: 'Unkeyed Q',
                  type: 'gap_fill',
                  acceptedAnswers: [],
                  evidenceParagraphId: 'p3-1',
                  evidenceLocation: '',
                  evidenceQuote: '',
                  evidenceTranslationVi: '',
                  explanationVi: 'Unkeyed',
                },
              ],
            },
          ],
        },
      ],
    };

    const reversedOk = gradeReadingExam({
      testData: mockTest,
      answers: {
        1: 'true',
        2: 'not given',
        3: 'IV',
        4: 'e',
        5: 'B',
        6: 'anything',
      },
      flagged: [2],
      highlights: [],
      mode: 'practice',
      startedAt: 1000,
      finishedAt: 61000,
    });

    expect(reversedOk.keyedTotal).toBe(5);
    expect(reversedOk.score).toBe(5);
    expect(reversedOk.durationSec).toBe(60);
    expect(reversedOk.results.find((r) => r.questionNumber === 2)?.flagged).toBe(true);
    expect(reversedOk.results.find((r) => r.questionNumber === 6)?.unkeyed).toBe(true);

    // Duplicate selection on mcq_multi awards only 1 point
    const dupRes = gradeReadingExam({
      testData: mockTest,
      answers: {
        1: 'TRUE',
        2: 'FALSE',
        3: 'iv',
        4: 'B',
        5: 'b',
      },
      flagged: [],
      highlights: [],
      mode: 'real',
      startedAt: 1000,
      finishedAt: 2000,
    });

    expect(dupRes.score).toBe(3); // Q1 (1) + Q3 (1) + Q4 (1), Q2 wrong, Q5 duplicate
  });
});
