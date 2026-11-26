import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Trash2, X } from 'lucide-react';
import type { HighlightColor, TextHighlight } from '../../types/reading';

export interface HighlightSelectionRequest {
  targetId: string;
  start: number;
  end: number;
  rect: { left: number; top: number; bottom: number; width: number };
}

interface HighlightToolbarProps {
  selection: HighlightSelectionRequest | null;
  editingHighlight: {
    highlight: TextHighlight;
    rect: { left: number; top: number; bottom: number; width: number };
  } | null;
  onApplyColor: (
    selection: HighlightSelectionRequest,
    color: HighlightColor,
    note?: string
  ) => void;
  onUpdateColor: (id: string, color: HighlightColor) => void;
  onUpdateNote: (id: string, note: string | undefined) => void;
  onRemoveHighlight: (id: string) => void;
  onClose: () => void;
}

const COLOR_SWATCHES: Array<{
  color: HighlightColor;
  label: string;
  bgClass: string;
}> = [
  { color: 'yellow', label: 'Vàng', bgClass: 'bg-yellow-300 border-yellow-600' },
  { color: 'green', label: 'Xanh lá', bgClass: 'bg-emerald-300 border-emerald-600' },
  { color: 'blue', label: 'Xanh dương', bgClass: 'bg-sky-300 border-sky-600' },
  { color: 'pink', label: 'Hồng', bgClass: 'bg-pink-300 border-pink-600' },
];

export function HighlightToolbar({
  selection,
  editingHighlight,
  onApplyColor,
  onUpdateColor,
  onUpdateNote,
  onRemoveHighlight,
  onClose,
}: HighlightToolbarProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [pendingColor, setPendingColor] = useState<HighlightColor>('yellow');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingHighlight) {
      setNoteDraft(editingHighlight.highlight.note ?? '');
      setNoteOpen(Boolean(editingHighlight.highlight.note));
      setPendingColor(editingHighlight.highlight.color);
    } else if (selection) {
      setNoteDraft('');
      setNoteOpen(false);
      setPendingColor('yellow');
    }
  }, [editingHighlight, selection]);

  useEffect(() => {
    if (!selection && !editingHighlight) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Ignore mouseup immediately after dragging a selection
        if (e.type === 'mousedown') onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mousedown', handleOutside);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleOutside);
    };
  }, [selection, editingHighlight, onClose]);

  const anchor = editingHighlight?.rect ?? selection?.rect;
  if (!anchor || (!selection && !editingHighlight)) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const panelWidth = 264;
  const rawLeft = anchor.left + anchor.width / 2 - panelWidth / 2;
  const left = Math.max(12, Math.min(vw - panelWidth - 12, rawLeft));
  const placeBelow = anchor.top < 110;
  const top = placeBelow ? anchor.bottom + 8 : Math.max(8, anchor.top - (noteOpen ? 128 : 54));

  return (
    <div
      ref={panelRef}
      data-highlight-ignore="true"
      style={{ position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${panelWidth}px` }}
      className="z-50 bg-white text-slate-900 border border-slate-400 rounded-md shadow-lg p-2 space-y-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {COLOR_SWATCHES.map((sw) => {
            const isActive = editingHighlight
              ? editingHighlight.highlight.color === sw.color
              : pendingColor === sw.color;
            return (
              <button
                key={sw.color}
                type="button"
                title={`Highlight màu ${sw.label}`}
                aria-label={`Highlight màu ${sw.label}`}
                onClick={() => {
                  setPendingColor(sw.color);
                  if (editingHighlight) {
                    onUpdateColor(editingHighlight.highlight.id, sw.color);
                  } else if (selection && !noteOpen) {
                    onApplyColor(selection, sw.color);
                  }
                }}
                className={`w-6 h-6 rounded border cursor-pointer transition-transform ${sw.bgClass} ${
                  isActive ? 'ring-2 ring-slate-900 scale-105' : 'hover:scale-105'
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Thêm / sửa ghi chú"
            aria-label="Ghi chú"
            onClick={() => setNoteOpen((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
              noteOpen
                ? 'bg-[#0f2942] text-white border-[#0f2942]'
                : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Ghi chú</span>
          </button>

          {editingHighlight && (
            <button
              type="button"
              title="Xóa highlight"
              aria-label="Xóa highlight"
              onClick={() => {
                onRemoveHighlight(editingHighlight.highlight.id);
                onClose();
              }}
              className="p-1 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            aria-label="Đóng thanh highlight"
            onClick={onClose}
            className="p-1 rounded text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {noteOpen && (
        <div className="space-y-1.5 pt-1 border-t border-slate-200">
          <textarea
            rows={2}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Nhập ghi chú ngắn cho đoạn văn..."
            className="w-full px-2 py-1 rounded border border-slate-300 text-xs text-slate-900 bg-white focus:outline-2 focus:outline-[#1e40af]"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 rounded border border-slate-300 bg-white text-[11px] cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => {
                if (editingHighlight) {
                  onUpdateNote(editingHighlight.highlight.id, noteDraft);
                  onClose();
                } else if (selection) {
                  onApplyColor(selection, pendingColor, noteDraft);
                }
              }}
              className="px-2.5 py-1 rounded bg-[#0f2942] text-white text-[11px] font-semibold cursor-pointer"
            >
              Lưu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
