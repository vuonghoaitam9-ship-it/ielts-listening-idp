import { describe, expect, it } from 'vitest';
import { computeSm2Review, previewSm2IntervalLabel } from '../lib/sm2';

describe('SM-2 spaced repetition algorithm', () => {
  const baseCard = { repetitions: 0, intervalDays: 0, easeFactor: 2.5 };

  it('progresses intervals correctly on Good and Easy ratings', () => {
    const r1 = computeSm2Review(baseCard, 'good', 1000);
    expect(r1.repetitions).toBe(1);
    expect(r1.intervalDays).toBe(1);

    const r2 = computeSm2Review(r1, 'good', 2000);
    expect(r2.repetitions).toBe(2);
    expect(r2.intervalDays).toBe(6);

    const r3 = computeSm2Review(r2, 'easy', 3000);
    expect(r3.repetitions).toBe(3);
    expect(r3.intervalDays).toBeGreaterThan(10);
  });

  it('resets repetitions to 0 and keeps easeFactor >= 1.3 on Again', () => {
    let card = { repetitions: 3, intervalDays: 14, easeFactor: 1.4 };
    const failed = computeSm2Review(card, 'again', 5000);
    expect(failed.repetitions).toBe(0);
    expect(failed.intervalDays).toBe(1);
    expect(failed.easeFactor).toBeGreaterThanOrEqual(1.3);

    card = { repetitions: 3, intervalDays: 14, easeFactor: 1.3 };
    const failedAgain = computeSm2Review(card, 'again', 6000);
    expect(failedAgain.easeFactor).toBe(1.3);
    expect(previewSm2IntervalLabel(card, 'again')).toBe('1 ngày');
  });
});
