import type { HighlightColor, TextHighlight } from '../types/reading';

export interface ApplyHighlightInput {
  targetId: string;
  start: number;
  end: number;
  color: HighlightColor;
  note?: string;
  id?: string;
  createdAt?: number;
}

export interface HighlightSegment {
  text: string;
  start: number;
  end: number;
  highlight?: TextHighlight;
  isEvidence?: boolean;
}

function makeHighlightId(): string {
  return `hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Adds a non-overlapping character-offset highlight to `targetId`.
 * Any existing highlights overlapping `[start, end)` on the same `targetId`
 * are neatly trimmed/split around the new selection so intervals stay disjoint.
 */
export function applyHighlight(
  highlights: TextHighlight[],
  input: ApplyHighlightInput
): TextHighlight[] {
  const start = Math.max(0, Math.min(input.start, input.end));
  const end = Math.max(0, Math.max(input.start, input.end));
  if (end <= start) return highlights;

  const others = highlights.filter((h) => h.targetId !== input.targetId);
  const sameTarget = highlights.filter((h) => h.targetId === input.targetId);

  const carved: TextHighlight[] = [];
  for (const existing of sameTarget) {
    if (existing.end <= start || existing.start >= end) {
      carved.push(existing);
      continue;
    }
    if (existing.start < start) {
      carved.push({
        ...existing,
        end: start,
      });
    }
    if (existing.end > end) {
      carved.push({
        ...existing,
        id: existing.start < start ? `${existing.id}-tail` : existing.id,
        start: end,
        note: existing.start < start ? undefined : existing.note,
      });
    }
  }

  const trimmedNote = input.note?.trim() || undefined;
  carved.push({
    id: input.id ?? makeHighlightId(),
    targetId: input.targetId,
    start,
    end,
    color: input.color,
    note: trimmedNote,
    createdAt: input.createdAt ?? Date.now(),
  });

  carved.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: TextHighlight[] = [];
  for (const item of carved) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.end === item.start &&
      prev.color === item.color &&
      !prev.note &&
      !item.note
    ) {
      prev.end = item.end;
    } else {
      merged.push({ ...item });
    }
  }

  return [...others, ...merged];
}

export function removeHighlight(
  highlights: TextHighlight[],
  id: string
): TextHighlight[] {
  return highlights.filter((h) => h.id !== id);
}

export function updateHighlightNote(
  highlights: TextHighlight[],
  id: string,
  note: string | undefined
): TextHighlight[] {
  const cleanNote = note?.trim() || undefined;
  return highlights.map((h) => (h.id === id ? { ...h, note: cleanNote } : h));
}

/**
 * Finds `[start, end)` offsets of `quote` inside `text`, falling back to
 * whitespace-normalized matching if raw whitespace differs slightly.
 */
export function findQuoteRangeInText(
  text: string,
  quote: string
): { start: number; end: number } | null {
  const trimmed = quote.trim();
  if (!trimmed || !text) return null;

  const exactIdx = text.indexOf(trimmed);
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + trimmed.length };
  }

  const lowerIdx = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (lowerIdx !== -1) {
    return { start: lowerIdx, end: lowerIdx + trimmed.length };
  }

  const normChars: string[] = [];
  const origIndices: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (normChars.length > 0 && !inSpace) {
        normChars.push(' ');
        origIndices.push(i);
        inSpace = true;
      }
    } else {
      normChars.push(ch.toLowerCase());
      origIndices.push(i);
      inSpace = false;
    }
  }

  const normText = normChars.join('');
  const normQuote = trimmed.replace(/\s+/g, ' ').toLowerCase();
  const matchPos = normText.indexOf(normQuote);
  if (matchPos === -1) return null;

  const start = origIndices[matchPos];
  const lastOrig = origIndices[matchPos + normQuote.length - 1];
  return { start, end: lastOrig + 1 };
}

/**
 * Splits `text` into non-overlapping styled segments using user highlights
 * plus an optional active evidence quote overlay.
 */
export function buildHighlightSegments(
  text: string,
  targetHighlights: TextHighlight[],
  evidenceQuote?: string | null
): HighlightSegment[] {
  if (!text) return [];

  const sortedHl = [...targetHighlights]
    .filter((h) => h.end > 0 && h.start < text.length && h.end > h.start)
    .map((h) => ({
      ...h,
      start: Math.max(0, h.start),
      end: Math.min(text.length, h.end),
    }))
    .sort((a, b) => a.start - b.start);

  const evidenceRange = evidenceQuote ? findQuoteRangeInText(text, evidenceQuote) : null;

  const boundaries = new Set<number>([0, text.length]);
  for (const h of sortedHl) {
    boundaries.add(h.start);
    boundaries.add(h.end);
  }
  if (evidenceRange) {
    boundaries.add(evidenceRange.start);
    boundaries.add(evidenceRange.end);
  }

  const points = Array.from(boundaries).sort((a, b) => a - b);
  const segments: HighlightSegment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (e <= s) continue;

    const hl = sortedHl.find((h) => h.start <= s && h.end >= e);
    const isEvidence = Boolean(
      evidenceRange && evidenceRange.start <= s && evidenceRange.end >= e
    );

    segments.push({
      text: text.slice(s, e),
      start: s,
      end: e,
      highlight: hl,
      isEvidence,
    });
  }

  return segments;
}

function countCharsBefore(
  container: HTMLElement,
  endpointNode: Node,
  endpointOffset: number
): number {
  let count = 0;
  let found = false;

  const walk = (node: Node) => {
    if (found) return;
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      (node as Element).getAttribute('data-highlight-ignore') === 'true'
    ) {
      if (node === endpointNode || node.contains(endpointNode)) {
        found = true;
      }
      return;
    }

    if (node === endpointNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        count += Math.min(endpointOffset, node.textContent?.length ?? 0);
        found = true;
        return;
      }
      const limit = Math.min(endpointOffset, node.childNodes.length);
      for (let i = 0; i < limit; i++) {
        walk(node.childNodes[i]);
        if (found) return;
      }
      found = true;
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      count += node.textContent?.length ?? 0;
      return;
    }

    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i]);
      if (found) return;
    }
  };

  walk(container);
  return count;
}

/**
 * Computes plain-text character offsets `[start, end)` for a browser `Range`
 * inside `container`, ignoring nodes marked `data-highlight-ignore="true"`.
 */
export function getSelectionOffsetsWithin(
  container: HTMLElement,
  range: Range
): { start: number; end: number } | null {
  if (range.collapsed) return null;
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return null;
  }

  const start = countCharsBefore(container, range.startContainer, range.startOffset);
  const end = countCharsBefore(container, range.endContainer, range.endOffset);

  if (end <= start) return null;
  return { start, end };
}
