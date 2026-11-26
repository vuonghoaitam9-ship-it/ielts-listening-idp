import { ArrowLeft, CheckCircle2, Clock, Eye, EyeOff, Highlighter } from 'lucide-react';
import type { ReadingFontSize, ReadingTheme } from '../../types/reading';

interface ReadingHeaderProps {
  vol: number;
  test: number;
  activePassage: 1 | 2 | 3;
  mode: 'real' | 'practice';
  secondsDisplay: number;
  fontSize: ReadingFontSize;
  theme: ReadingTheme;
  screenHidden: boolean;
  isReviewMode: boolean;
  highlightCount: number;
  onExit: () => void;
  onSelectPassage: (p: 1 | 2 | 3) => void;
  onChangeMode?: (mode: 'real' | 'practice') => void;
  onChangeFontSize: (s: ReadingFontSize) => void;
  onChangeTheme: (t: ReadingTheme) => void;
  onToggleHide: () => void;
  onClearHighlights?: () => void;
  onRequestSubmit: () => void;
}

function formatClockMmSs(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ReadingHeader({
  vol,
  test,
  activePassage,
  mode,
  secondsDisplay,
  fontSize,
  theme,
  screenHidden,
  isReviewMode,
  highlightCount,
  onExit,
  onSelectPassage,
  onChangeMode,
  onChangeFontSize,
  onChangeTheme,
  onToggleHide,
  onClearHighlights,
  onRequestSubmit,
}: ReadingHeaderProps) {
  const isLowTime = !isReviewMode && mode === 'real' && secondsDisplay <= 300;
  const isCriticalTime = !isReviewMode && mode === 'real' && secondsDisplay <= 60;

  return (
    <header className="bg-[#0f2942] text-white border-b border-slate-700 px-3 py-2 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left: Exit + Vol/Test/Passage + Passage Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-600 bg-slate-800/70 hover:bg-slate-700 text-xs cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Thoát</span>
          </button>

          <div className="px-2 py-1 rounded bg-slate-900/50 border border-slate-700 text-xs font-semibold tracking-tight">
            Vol {vol} · Test {test} · Passage {activePassage}
          </div>

          <div className="inline-flex items-center rounded border border-slate-600 overflow-hidden text-xs">
            {([1, 2, 3] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onSelectPassage(p)}
                className={`px-2.5 py-1 font-medium cursor-pointer ${
                  activePassage === p
                    ? 'bg-white text-[#0f2942] font-semibold'
                    : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700'
                }`}
              >
                P{p}
              </button>
            ))}
          </div>

          {!isReviewMode && onChangeMode && (
            <div className="hidden sm:inline-flex items-center rounded border border-slate-600 overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => onChangeMode('real')}
                className={`px-2 py-1 cursor-pointer ${
                  mode === 'real'
                    ? 'bg-[#1e40af] text-white font-semibold'
                    : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Thi thật (60p)
              </button>
              <button
                type="button"
                onClick={() => onChangeMode('practice')}
                className={`px-2 py-1 cursor-pointer ${
                  mode === 'practice'
                    ? 'bg-[#1e40af] text-white font-semibold'
                    : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Tự do
              </button>
            </div>
          )}
        </div>

        {/* Center: Countdown / Elapsed Clock */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1 rounded border text-xs font-mono tabular-nums font-semibold ${
            isCriticalTime
              ? 'bg-red-700 border-red-400 text-white'
              : isLowTime
              ? 'bg-amber-600 border-amber-300 text-white'
              : 'bg-slate-900/70 border-slate-600 text-slate-100'
          }`}
          title={
            mode === 'real'
              ? 'Thời gian làm bài còn lại (60 phút)'
              : 'Thời gian đã luyện tập (chế độ tự do)'
          }
        >
          <Clock className="w-3.5 h-3.5" />
          <span>{formatClockMmSs(secondsDisplay)}</span>
          <span className="text-[10px] font-sans font-normal opacity-80">
            {isReviewMode ? 'Chấm chữa' : mode === 'real' ? 'Còn lại' : 'Tự do'}
          </span>
        </div>

        {/* Right: Font size, Theme Contrast, Highlights, Hide, Submit */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Font Scale */}
          <div
            className="inline-flex items-center rounded border border-slate-600 overflow-hidden text-[11px]"
            aria-label="Cỡ chữ"
          >
            {(
              [
                ['small', 'A-'],
                ['standard', 'A'],
                ['large', 'A+'],
              ] as [ReadingFontSize, string][]
            ).map(([sz, lbl]) => (
              <button
                key={sz}
                type="button"
                onClick={() => onChangeFontSize(sz)}
                className={`px-2 py-1 font-semibold cursor-pointer ${
                  fontSize === sz
                    ? 'bg-white text-[#0f2942]'
                    : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700'
                }`}
                title={`Cỡ chữ: ${lbl}`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {/* Contrast Theme */}
          <div
            className="inline-flex items-center rounded border border-slate-600 overflow-hidden text-[11px]"
            aria-label="Độ tương phản"
          >
            {(
              [
                ['light', 'Sáng'],
                ['dark', 'Tối'],
                ['yellow-black', 'Vàng/Đen'],
              ] as [ReadingTheme, string][]
            ).map(([th, lbl]) => (
              <button
                key={th}
                type="button"
                onClick={() => onChangeTheme(th)}
                className={`px-2 py-1 font-medium cursor-pointer ${
                  theme === th
                    ? 'bg-white text-[#0f2942] font-semibold'
                    : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {highlightCount > 0 && !isReviewMode && onClearHighlights && (
            <button
              type="button"
              onClick={onClearHighlights}
              title="Xóa toàn bộ highlight & ghi chú hiện tại"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-600 bg-slate-800/70 hover:bg-slate-700 text-[11px] cursor-pointer"
            >
              <Highlighter className="w-3 h-3 text-yellow-300" />
              <span>{highlightCount}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleHide}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-600 bg-slate-800/70 hover:bg-slate-700 text-xs font-medium cursor-pointer"
            title="Tạm ẩn màn hình làm bài (IDP Hide)"
          >
            {screenHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{screenHidden ? 'Hiện đề' : 'Hide'}</span>
          </button>

          {!isReviewMode && (
            <button
              type="button"
              onClick={onRequestSubmit}
              className="inline-flex items-center gap-1 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Nộp bài</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
