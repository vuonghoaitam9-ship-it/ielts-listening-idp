import { Eye, EyeOff, Volume2, ArrowLeft, CheckSquare, Clock } from 'lucide-react';
import type { ContrastTheme, ExamTimerMode, FontScale } from '../types';

interface IdpHeaderProps {
  title: string;
  timerMode: ExamTimerMode;
  remainingSec: number;
  elapsedSec: number;
  timerPhase: 'listening' | 'check' | 'finished';
  volume: number;
  onVolumeChange: (v: number) => void;
  fontScale: FontScale;
  onFontScaleChange: (s: FontScale) => void;
  theme: ContrastTheme;
  onThemeChange: (t: ContrastTheme) => void;
  hiddenScreen: boolean;
  onToggleHide: () => void;
  answeredCount: number;
  onExit: () => void;
  onSubmit: () => void;
  isSubmitted: boolean;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function IdpHeader({
  title,
  timerMode,
  remainingSec,
  elapsedSec,
  timerPhase,
  volume,
  onVolumeChange,
  fontScale,
  onFontScaleChange,
  theme,
  onThemeChange,
  hiddenScreen,
  onToggleHide,
  answeredCount,
  onExit,
  onSubmit,
  isSubmitted,
}: IdpHeaderProps) {
  const isWarning = timerMode === 'idp' && !isSubmitted && remainingSec <= 120;

  return (
    <header
      className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 select-none shrink-0"
      style={{
        backgroundColor: 'var(--idp-header-bg)',
        color: 'var(--idp-header-text)',
        borderColor: 'var(--idp-border)',
      }}
    >
      {/* Left: Back + Test Title */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onExit}
          className="px-2.5 py-1 rounded border border-white/25 hover:bg-white/10 text-xs font-medium flex items-center gap-1 cursor-pointer"
          title="Quay lại danh sách đề"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Thoát</span>
        </button>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide">{title}</div>
          <div className="text-[11px] opacity-80">
            IELTS Listening · Đã trả lời {answeredCount}/40
          </div>
        </div>
      </div>

      {/* Center: IDP Clock */}
      <div className="flex items-center gap-2">
        <div
          className={`px-3 py-1 rounded border text-sm font-mono font-semibold tabular-nums flex items-center gap-1.5 ${
            isWarning
              ? 'bg-red-700 text-white border-red-400'
              : 'bg-black/25 border-white/25'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          {timerMode === 'idp' ? (
            <>
              <span>{formatClock(remainingSec)}</span>
              <span className="text-[11px] font-sans font-normal opacity-85 ml-1">
                {timerPhase === 'listening'
                  ? '30p nghe'
                  : timerPhase === 'check'
                  ? '2p kiểm tra'
                  : 'Hết giờ'}
              </span>
            </>
          ) : (
            <>
              <span>{formatClock(elapsedSec)}</span>
              <span className="text-[11px] font-sans font-normal opacity-85 ml-1">
                Tự do
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right: Volume, Font Size, Contrast, Hide, Submit */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Volume */}
        <label className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 text-xs">
          <Volume2 className="w-3.5 h-3.5 shrink-0" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            aria-label="Âm lượng"
            className="w-16 accent-blue-400 cursor-pointer"
          />
          <span className="w-7 text-right tabular-nums">{Math.round(volume * 100)}%</span>
        </label>

        {/* Font size */}
        <div className="flex items-center rounded border border-white/25 overflow-hidden text-xs">
          {(
            [
              ['small', 'A-'],
              ['standard', 'A'],
              ['large', 'A+'],
            ] as [FontScale, string][]
          ).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => onFontScaleChange(val)}
              className={`px-2 py-1 font-medium cursor-pointer ${
                fontScale === val ? 'bg-white text-slate-900' : 'hover:bg-white/10'
              }`}
              title={`Cỡ chữ: ${val}`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Contrast */}
        <div className="flex items-center rounded border border-white/25 overflow-hidden text-xs">
          {(
            [
              ['light', 'Sáng'],
              ['dark', 'Tối'],
              ['yellow-black', 'Vàng/Đen'],
            ] as [ContrastTheme, string][]
          ).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => onThemeChange(val)}
              className={`px-2 py-1 font-medium cursor-pointer ${
                theme === val ? 'bg-white text-slate-900' : 'hover:bg-white/10'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Hide button */}
        <button
          type="button"
          onClick={onToggleHide}
          className="px-2.5 py-1 rounded border border-white/25 hover:bg-white/10 text-xs font-medium flex items-center gap-1 cursor-pointer"
        >
          {hiddenScreen ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          <span>{hiddenScreen ? 'Hiện' : 'Hide'}</span>
        </button>

        {!isSubmitted && (
          <button
            type="button"
            onClick={onSubmit}
            className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>Nộp bài</span>
          </button>
        )}
      </div>
    </header>
  );
}
