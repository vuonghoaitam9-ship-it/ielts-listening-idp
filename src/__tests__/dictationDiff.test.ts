import { describe, expect, it } from 'vitest';
import { computeDictationDiff } from '../lib/dictationDiff';

describe('Word-level Dictation Diff', () => {
  it('scores 100% on exact match ignoring punctuation and case', () => {
    const res = computeDictationDiff(
      'We recommend the Oxford Suite for eighty guests.',
      'we recommend the oxford suite for eighty guests'
    );
    expect(res.accuracy).toBe(100);
    expect(res.correctCount).toBe(8);
    expect(res.missingCount).toBe(0);
    expect(res.extraCount).toBe(0);
    expect(res.misspelledCount).toBe(0);
  });

  it('identifies misspelled, missing, and extra words accurately', () => {
    const res = computeDictationDiff(
      'The accommodation includes white tablecloths and menus.',
      'The accomodation white tablecloths and extra menus'
    );
    expect(res.tokens.some((t) => t.status === 'misspelled' && t.expected === 'accommodation')).toBe(true);
    expect(res.tokens.some((t) => t.status === 'missing' && t.expected === 'includes')).toBe(true);
    expect(res.tokens.some((t) => t.status === 'extra' && t.word === 'extra')).toBe(true);
    expect(res.accuracy).toBeGreaterThan(40);
    expect(res.accuracy).toBeLessThan(90);
  });
});
