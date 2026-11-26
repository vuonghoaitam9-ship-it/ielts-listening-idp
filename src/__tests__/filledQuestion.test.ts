import { describe, expect, it } from 'vitest';
import {
  buildFilledListeningQuestion,
  buildFilledReadingQuestion,
} from '../lib/filledQuestion';
import type { QuestionItem } from '../types';
import type { ReadingQuestion, ReadingQuestionGroup } from '../types/reading';

describe('Filled original question formatter', () => {
  it('fills Reading gap_fill multi-line bullets cleanly without leaking adjacent bullets', () => {
    const q1: ReadingQuestion = {
      number: 1,
      prompt: 'full block',
      type: 'gap_fill',
      acceptedAnswers: ['Raindrops'],
      evidenceParagraphId: 'P1',
      evidenceLocation: 'Đoạn 1',
      evidenceQuote: 'ignored raindrops.',
      evidenceTranslationVi: '',
      explanationVi: '',
    };
    const q2: ReadingQuestion = {
      number: 2,
      prompt: 'full block',
      type: 'gap_fill',
      acceptedAnswers: ['Stomach'],
      evidenceParagraphId: 'P2',
      evidenceLocation: 'Đoạn 2',
      evidenceQuote: 'temporary stomach',
      evidenceTranslationVi: '',
      explanationVi: '',
    };
    const group: ReadingQuestionGroup = {
      id: 'g1',
      questionRange: [1, 2],
      type: 'gap_fill',
      instruction: 'ONE WORD ONLY',
      bodyText: [
        'Carnivorous Plants',
        'Drosera',
        'o He understood why the plant did not respond to {{blank:1}}',
        'Venus Flytrap',
        'o He demonstrated how leaves close and then, for a short period, act like',
        'a {{blank:2}}',
        'o Next unrelated bullet.',
      ].join('\n'),
      questions: [q1, q2],
    };

    const filled1 = buildFilledReadingQuestion({
      question: q1,
      group,
      canonicalAnswer: 'Raindrops',
      acceptedAnswers: ['Raindrops'],
      unkeyed: false,
    });
    expect(filled1.parts).toEqual([
      { text: 'He understood why the plant did not respond to ' },
      { text: 'Raindrops', isAnswer: true },
    ]);

    const filled2 = buildFilledReadingQuestion({
      question: q2,
      group,
      canonicalAnswer: 'Stomach',
      acceptedAnswers: ['Stomach'],
      unkeyed: false,
    });
    expect(filled2.parts).toEqual([
      { text: 'He demonstrated how leaves close and then, for a short period, act like a ' },
      { text: 'Stomach', isAnswer: true },
    ]);
  });

  it('resolves Reading summary_box Word Bank, table_completion, mcq_single, mcq_multi, matching, diagram & unkeyed', () => {
    const summaryGroup: ReadingQuestionGroup = {
      id: 'sum',
      questionRange: [27, 27],
      type: 'summary_box',
      instruction: 'Summary',
      options: [
        { key: 'A', text: 'experience' },
        { key: 'J', text: 'species' },
      ],
      bodyText:
        'First sentence without blank. They want it to include other {{blank:27}} that are judged to demonstrate understanding.',
      questions: [
        {
          number: 27,
          prompt: '',
          type: 'summary_box',
          acceptedAnswers: ['J'],
          evidenceParagraphId: 'p1',
          evidenceLocation: '',
          evidenceQuote: '',
          evidenceTranslationVi: '',
          explanationVi: '',
        },
      ],
    };

    const sumFilled = buildFilledReadingQuestion({
      question: summaryGroup.questions[0],
      group: summaryGroup,
      canonicalAnswer: 'J',
      acceptedAnswers: ['J'],
      unkeyed: false,
    });
    expect(sumFilled.parts.find((p) => p.isAnswer)?.text).toBe('J. species');
    expect(sumFilled.parts[0].text.startsWith('They want it')).toBe(true);

    const tableGroup: ReadingQuestionGroup = {
      id: 'tbl',
      questionRange: [8, 8],
      type: 'table_completion',
      instruction: 'Table',
      table: {
        headers: ['Category', 'Notes'],
        rows: [
          ['Using chilli', "chilli's ability to fight germs was significant before the invention o"],
          ['', 'of {{blank:8}}'],
        ],
      },
      questions: [
        {
          number: 8,
          prompt: '| of {{blank:8}}',
          type: 'table_completion',
          acceptedAnswers: ['refrigeration'],
          evidenceParagraphId: 'p1',
          evidenceLocation: '',
          evidenceQuote: '',
          evidenceTranslationVi: '',
          explanationVi: '',
        },
      ],
    };

    const tblFilled = buildFilledReadingQuestion({
      question: tableGroup.questions[0],
      group: tableGroup,
      canonicalAnswer: 'refrigeration',
      acceptedAnswers: ['refrigeration'],
      unkeyed: false,
    });
    expect(tblFilled.parts.map((p) => p.text).join('')).toContain(
      'before the invention of refrigeration'
    );

    const multiFilled = buildFilledReadingQuestion({
      question: {
        number: 20,
        prompt: 'Which TWO statements are true?',
        type: 'mcq_multi',
        siblingNumbers: [20, 21],
        options: [
          { key: 'B', text: 'First true choice' },
          { key: 'E', text: 'Second true choice' },
        ],
        acceptedAnswers: ['B', 'E'],
        evidenceParagraphId: 'p1',
        evidenceLocation: '',
        evidenceQuote: '',
        evidenceTranslationVi: '',
        explanationVi: '',
      },
      canonicalAnswer: 'B, E',
      acceptedAnswers: ['B', 'E'],
      unkeyed: false,
    });
    expect(multiFilled.suffixAnswer).toBe(
      'B. First true choice · E. Second true choice'
    );

    const diagramFilled = buildFilledReadingQuestion({
      question: {
        number: 14,
        prompt: 'Question 14',
        type: 'diagram_label',
        acceptedAnswers: ['chain'],
        evidenceParagraphId: 'B',
        evidenceLocation: '',
        evidenceQuote: '',
        evidenceTranslationVi: '',
        explanationVi: '',
      },
      group: {
        id: 'd1',
        questionRange: [14, 16],
        type: 'diagram_label',
        instruction: 'Label diagram',
        diagramUrl: './data/vol-7/test-12/diagram-1.png',
        questions: [],
      },
      canonicalAnswer: 'chain',
      acceptedAnswers: ['chain'],
      unkeyed: false,
    });
    expect(diagramFilled.parts[0].text).toBe('Nhãn số 14 trên sơ đồ');
    expect(diagramFilled.suffixAnswer).toBe('chain');
    expect(diagramFilled.diagramUrl).toBe('./data/vol-7/test-12/diagram-1.png');

    const unkeyedFilled = buildFilledReadingQuestion({
      question: {
        number: 40,
        prompt: 'What is the final word {{blank:40}}?',
        type: 'gap_fill',
        acceptedAnswers: [],
        evidenceParagraphId: 'p1',
        evidenceLocation: '',
        evidenceQuote: '',
        evidenceTranslationVi: '',
        explanationVi: '',
      },
      canonicalAnswer: '',
      acceptedAnswers: [],
      unkeyed: true,
    });
    expect(unkeyedFilled.parts.find((p) => p.isAnswer)?.text).toContain('Chưa có Key gốc');
  });

  it('fills Listening inline blanks, multi-blank sentences, and MCQ/Matching options cleanly', () => {
    const q33: QuestionItem = {
      number: 33,
      part: 4,
      promptContext: 'Research will become {{blank:33}}, since more {{blank:34}} work there.',
      answerRaw: 'collaborative',
      canonicalAnswer: 'collaborative',
      acceptedAnswers: ['collaborative'],
      sharedGroup: null,
      evidenceQuote: '',
      evidenceStartTime: 0,
      evidenceEndTime: 1,
      paraphrases: [],
      distractors: [],
      explanationVi: '',
    };
    const q34: QuestionItem = {
      ...q33,
      number: 34,
      answerRaw: 'psychologists',
      canonicalAnswer: 'psychologists',
      acceptedAnswers: ['psychologists'],
    };
    const qMap = new Map<number, QuestionItem>([
      [33, q33],
      [34, q34],
    ]);

    const filled33 = buildFilledListeningQuestion(q33, qMap);
    expect(filled33.parts).toEqual([
      { text: 'Research will become ' },
      { text: 'collaborative', isAnswer: true },
      { text: ', since more ' },
      { text: 'psychologists', isSecondaryBlank: true },
      { text: ' work there.' },
    ]);

    const q11: QuestionItem = {
      number: 11,
      part: 2,
      promptContext: 'hand cream',
      options: [{ key: 'G', text: 'popular overseas' }],
      answerRaw: 'G (popular)',
      canonicalAnswer: 'G',
      acceptedAnswers: ['G'],
      sharedGroup: null,
      evidenceQuote: '',
      evidenceStartTime: 0,
      evidenceEndTime: 1,
      paraphrases: [],
      distractors: [],
      explanationVi: '',
    };
    const filled11 = buildFilledListeningQuestion(q11);
    expect(filled11.parts).toEqual([{ text: 'hand cream' }]);
    expect(filled11.suffixAnswer).toBe('G. popular overseas');
  });

  it('never leaves raw {{blank:M}} tokens when falling back on a gap_fill prose unit', () => {
    const q37: ReadingQuestion = {
      number: 37,
      prompt: 'Question 37',
      type: 'gap_fill',
      acceptedAnswers: ['sub-arctic'],
      evidenceParagraphId: 'P1',
      evidenceLocation: '',
      evidenceQuote: '',
      evidenceTranslationVi: '',
      explanationVi: '',
    };
    const q38: ReadingQuestion = {
      ...q37,
      number: 38,
      acceptedAnswers: ['short'],
    };
    const qMap = new Map<number, ReadingQuestion>([
      [37, q37],
      [38, q38],
    ]);
    const group: ReadingQuestionGroup = {
      id: 'g-fallback',
      questionRange: [37, 38],
      type: 'gap_fill',
      instruction: 'Summary',
      bodyText:
        'Conditions were 37..…… and fires lasted a {{blank:38}} time.',
      questions: [q37, q38],
    };

    const filled37 = buildFilledReadingQuestion({
      question: q37,
      group,
      canonicalAnswer: 'sub-arctic',
      acceptedAnswers: ['sub-arctic'],
      unkeyed: false,
      questionMap: qMap,
    });
    const combined = filled37.parts.map((p) => p.text).join('');
    expect(combined).not.toContain('{{blank:');
    expect(combined).toContain('Câu 37');
    expect(filled37.suffixAnswer).toBe('sub-arctic');
  });
});
