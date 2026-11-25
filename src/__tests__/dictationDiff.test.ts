import { describe, expect, it } from 'vitest';
import { computeDictationDiff } from '../lib/dictationDiff';

describe('Word-level Dictation Diff', () => {
  it('scores 100% on exact match ignoring punctuation, case, and extra spaces', () => {
    const res = computeDictationDiff(
      'We recommend the Oxford Suite — for eighty guests!',
      '   we   recommend   the oxford suite for eighty guests   '
    );
    expect(res.accuracy).toBe(100);
    expect(res.correctCount).toBe(8);
    expect(res.missingCount).toBe(0);
    expect(res.extraCount).toBe(0);
    expect(res.misspelledCount).toBe(0);
  });

  it('normalizes contractions, numbers/words, UK/US spelling, and hyphenated compounds', () => {
    const r1 = computeDictationDiff(
      "Don't forget self-catering is eighty pounds in the city centre.",
      'do not forget self catering is 80 pounds in the city center'
    );
    expect(r1.accuracy).toBe(100);
    expect(r1.misspelledCount).toBe(0);
    expect(r1.missingCount).toBe(0);

    const r2 = computeDictationDiff(
      'We do not have a colour option.',
      "we don't have a color option"
    );
    expect(r2.accuracy).toBe(100);
  });

  it('identifies misspelled, missing, and extra words accurately', () => {
    const res = computeDictationDiff(
      'The accommodation includes white tablecloths and menus.',
      'The accomodation white tablecloths and extra menus'
    );
    expect(
      res.tokens.some(
        (t) => t.status === 'misspelled' && t.word === 'accomodation' && t.expected === 'accommodation'
      )
    ).toBe(true);
    expect(res.tokens.some((t) => t.status === 'missing' && t.expected === 'includes')).toBe(true);
    expect(res.tokens.some((t) => t.status === 'extra' && t.word === 'extra')).toBe(true);
    expect(res.accuracy).toBeGreaterThan(40);
    expect(res.accuracy).toBeLessThan(90);
  });

  it('treats missing apostrophe in contraction as misspelled with full original word', () => {
    const res = computeDictationDiff("Don't forget your ticket.", 'dont forget your ticket');
    expect(res.tokens[0]).toEqual({
      word: 'dont',
      expected: "Don't",
      status: 'misspelled',
    });
    expect(res.correctCount).toBe(3);
  });
});
