import { describe, expect, it } from 'vitest';
import {
  applyHighlight,
  buildHighlightSegments,
  findQuoteRangeInText,
  removeHighlight,
  updateHighlightNote,
} from '../lib/highlightEngine';

describe('Reading offset-based highlight engine', () => {
  const sampleText =
    'Archaeologists discovered ancient pottery fragments near the northern harbor in 1924.';

  it('adds non-overlapping highlights and splits/carves overlapping colors', () => {
    let list = applyHighlight([], {
      id: 'h1',
      targetId: 'p1-A',
      start: 0,
      end: 25,
      color: 'yellow',
      note: 'Subject',
      createdAt: 100,
    });
    expect(list).toHaveLength(1);

    // Overlap middle [15, 20) with green -> carves h1 into [0,15), [15,20), [20,25)
    list = applyHighlight(list, {
      id: 'h2',
      targetId: 'p1-A',
      start: 15,
      end: 20,
      color: 'green',
      createdAt: 200,
    });
    expect(list).toHaveLength(3);
    expect(list.map((h) => [h.start, h.end, h.color])).toEqual([
      [0, 15, 'yellow'],
      [15, 20, 'green'],
      [20, 25, 'yellow'],
    ]);
  });

  it('merges adjacent highlights of the same color without notes', () => {
    let list = applyHighlight([], {
      id: 'h1',
      targetId: 'p1-A',
      start: 0,
      end: 10,
      color: 'blue',
      createdAt: 100,
    });
    list = applyHighlight(list, {
      id: 'h2',
      targetId: 'p1-A',
      start: 10,
      end: 20,
      color: 'blue',
      createdAt: 101,
    });
    expect(list).toHaveLength(1);
    expect(list[0].start).toBe(0);
    expect(list[0].end).toBe(20);
  });

  it('updates notes and removes highlights cleanly', () => {
    let list = applyHighlight([], {
      id: 'h1',
      targetId: 'p1-B',
      start: 10,
      end: 20,
      color: 'pink',
      createdAt: 100,
    });
    list = updateHighlightNote(list, 'h1', 'Key evidence');
    expect(list[0].note).toBe('Key evidence');

    list = removeHighlight(list, 'h1');
    expect(list).toHaveLength(0);
  });

  it('builds disjoint segments combining user highlights and evidence quote overlay', () => {
    const list = applyHighlight([], {
      id: 'h1',
      targetId: 'p1-A',
      start: 0,
      end: 25,
      color: 'yellow',
      createdAt: 100,
    });

    const quote = 'discovered ancient pottery fragments';
    const range = findQuoteRangeInText(sampleText, quote);
    expect(range).not.toBeNull();

    const segments = buildHighlightSegments(sampleText, list, quote);
    expect(segments.map((s) => s.text).join('')).toBe(sampleText);

    const evidenceSegs = segments.filter((s) => s.isEvidence);
    expect(evidenceSegs.map((s) => s.text).join('')).toBe(quote);
    expect(segments.some((s) => s.highlight?.color === 'yellow' && s.isEvidence)).toBe(
      true
    );
  });
});
