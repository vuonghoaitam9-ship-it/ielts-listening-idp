import type { Sm2Rating, VocabCard } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

const QUALITY_MAP: Record<Sm2Rating, number> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
};

export interface Sm2ReviewOutcome {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: number;
  lastReviewedAt: number;
}

export function computeSm2Review(
  card: Pick<VocabCard, 'repetitions' | 'intervalDays' | 'easeFactor'>,
  rating: Sm2Rating,
  now = Date.now()
): Sm2ReviewOutcome {
  const q = QUALITY_MAP[rating];
  let repetitions = card.repetitions;
  let intervalDays = card.intervalDays;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) {
      intervalDays = rating === 'easy' ? 4 : 1;
    } else if (repetitions === 1) {
      intervalDays = rating === 'hard' ? 3 : rating === 'easy' ? 8 : 6;
    } else {
      const base = Math.round(intervalDays * card.easeFactor);
      if (rating === 'hard') {
        intervalDays = Math.max(2, Math.round(intervalDays * 1.2));
      } else if (rating === 'easy') {
        intervalDays = Math.max(4, Math.round(base * 1.3));
      } else {
        intervalDays = Math.max(2, base);
      }
    }
    repetitions += 1;
  }

  let easeFactor =
    card.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;
  easeFactor = Number(easeFactor.toFixed(2));

  return {
    repetitions,
    intervalDays,
    easeFactor,
    nextReviewAt: now + intervalDays * DAY_MS,
    lastReviewedAt: now,
  };
}

export function previewSm2IntervalLabel(
  card: Pick<VocabCard, 'repetitions' | 'intervalDays' | 'easeFactor'>,
  rating: Sm2Rating
): string {
  const out = computeSm2Review(card, rating, 0);
  if (out.intervalDays === 1) return '1 ngày';
  return `${out.intervalDays} ngày`;
}
