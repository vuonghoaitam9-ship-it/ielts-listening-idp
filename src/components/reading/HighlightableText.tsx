import { useMemo, useRef } from 'react';
import {
  buildHighlightSegments,
  getSelectionOffsetsWithin,
} from '../../lib/highlightEngine';
import type { HighlightColor, TextHighlight } from '../../types/reading';
import type { HighlightSelectionRequest } from './HighlightToolbar';

interface HighlightableTextProps {
  targetId: string;
  text: string;
  highlights: TextHighlight[];
  evidenceQuote?: string | null;
  disabled?: boolean;
  className?: string;
  onSelectRange: (req: HighlightSelectionRequest) => void;
  onClickHighlight: (
    hl: TextHighlight,
    rect: { left: number; top: number; bottom: number; width: number }
  ) => void;
}

const HIGHLIGHT_BG: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-200 text-slate-950 rounded-[2px]',
  green: 'bg-emerald-200 text-slate-950 rounded-[2px]',
  blue: 'bg-sky-200 text-slate-950 rounded-[2px]',
  pink: 'bg-pink-200 text-slate-950 rounded-[2px]',
};

export function HighlightableText({
  targetId,
  text,
  highlights,
  evidenceQuote = null,
  disabled = false,
  className = '',
  onSelectRange,
  onClickHighlight,
}: HighlightableTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);

  const targetHighlights = useMemo(
    () => highlights.filter((h) => h.targetId === targetId),
    [highlights, targetId]
  );

  const segments = useMemo(
    () => buildHighlightSegments(text, targetHighlights, evidenceQuote),
    [text, targetHighlights, evidenceQuote]
  );

  const handleMouseUp = () => {
    if (disabled || !containerRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const offsets = getSelectionOffsetsWithin(containerRef.current, range);
    if (!offsets) return;

    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return;

    onSelectRange({
      targetId,
      start: offsets.start,
      end: offsets.end,
      rect: {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
      },
    });
  };

  return (
    <span ref={containerRef} onMouseUp={handleMouseUp} className={className}>
      {segments.map((seg, idx) => {
        const hl = seg.highlight;
        const prevHlId = idx > 0 ? segments[idx - 1].highlight?.id : undefined;
        const isStartOfNote = Boolean(hl?.note && hl.id !== prevHlId);

        if (!hl && !seg.isEvidence) {
          return <span key={`${seg.start}-${seg.end}`}>{seg.text}</span>;
        }

        const colorClass = hl ? HIGHLIGHT_BG[hl.color] : '';
        const evidenceClass = seg.isEvidence
          ? 'bg-emerald-100 text-slate-950 ring-2 ring-emerald-600 rounded-[2px] font-medium px-0.5'
          : '';

        return (
          <mark
            key={`${seg.start}-${seg.end}`}
            data-evidence-quote={seg.isEvidence ? 'true' : undefined}
            title={hl?.note ? `Ghi chú: ${hl.note}` : undefined}
            onClick={(e) => {
              if (!hl) return;
              const sel = window.getSelection();
              if (sel && !sel.isCollapsed) return;
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              onClickHighlight(hl, {
                left: r.left,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
              });
            }}
            className={`${seg.isEvidence ? evidenceClass : colorClass} ${
              hl ? 'cursor-pointer' : ''
            }`}
          >
            {isStartOfNote && hl?.note && (
              <span
                data-highlight-ignore="true"
                className="inline-flex items-center px-1 py-0 mr-1 text-[10px] leading-tight font-semibold rounded bg-slate-800 text-white align-middle"
                title={hl.note}
              >
                Ghi chú
              </span>
            )}
            {seg.text}
          </mark>
        );
      })}
    </span>
  );
}
