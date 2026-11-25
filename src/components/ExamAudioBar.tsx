import { Lock, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { formatSecondsClock } from '../lib/subtitleParser';
import type { ExamAudioMode, PartData } from '../types';

interface ExamAudioBarProps {
  audioMode: ExamAudioMode;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  hasStartedRealExam: boolean;
  parts: PartData[];
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onSkip: (delta: number) => void;
  onRateChange: (rate: number) => void;
}

const RATES = [0.75, 0.9, 1.0, 1.15, 1.25, 1.5];

export function ExamAudioBar({
  audioMode,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  hasStartedRealExam,
  parts,
  onTogglePlay,
  onSeek,
  onSkip,
  onRateChange,
}: ExamAudioBarProps) {
  const isReal = audioMode === 'real';
  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="idp-surface border-b px-3 py-2 flex flex-wrap items-center gap-3 shrink-0 text-xs">
      {/* Play / Pause */}
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={isReal && hasStartedRealExam && isPlaying}
        className={`px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 cursor-pointer ${
          isReal && hasStartedRealExam && isPlaying
            ? 'bg-slate-200 text-slate-600 cursor-not-allowed'
            : 'bg-[#1e40af] hover:bg-[#1e3a8a] text-white'
        }`}
      >
        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        <span>
          {isReal
            ? hasStartedRealExam
              ? isPlaying
                ? 'Đang phát (Thi thật)'
                : 'Tiếp tục phát'
              : 'Bắt đầu phát Audio'
            : isPlaying
            ? 'Tạm dừng'
            : 'Phát'}
        </span>
      </button>

      {/* Practice seek controls */}
      {!isReal ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSkip(-5)}
            className="px-2 py-1 rounded border idp-surface hover:opacity-80 flex items-center gap-0.5 cursor-pointer"
            title="Lùi 5 giây (Alt + Left)"
          >
            <RotateCcw className="w-3 h-3" />
            <span>-5s</span>
          </button>
          <button
            type="button"
            onClick={() => onSkip(5)}
            className="px-2 py-1 rounded border idp-surface hover:opacity-80 flex items-center gap-0.5 cursor-pointer"
            title="Tới 5 giây (Alt + Right)"
          >
            <span>+5s</span>
            <RotateCw className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded idp-muted border border-current/15">
          <Lock className="w-3 h-3" />
          <span>Khóa tua &amp; tốc độ 1.0x</span>
        </span>
      )}

      {/* Progress / Scrubber */}
      <div className="flex-1 min-w-[180px] flex items-center gap-2">
        <span className="font-mono tabular-nums w-11 text-right">
          {formatSecondsClock(currentTime)}
        </span>
        {isReal ? (
          <div className="flex-1 h-2 rounded-full bg-slate-300/60 overflow-hidden">
            <div
              className="h-full bg-[#1e40af] transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        ) : (
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.5}
            value={Math.min(currentTime, duration || 1)}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Thanh tua audio"
            className="flex-1 accent-[#1e40af] cursor-pointer"
          />
        )}
        <span className="font-mono tabular-nums w-11">
          {formatSecondsClock(duration)}
        </span>
      </div>

      {/* Practice Speed + Part Jumps */}
      {!isReal && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="opacity-75">Tốc độ:</span>
            <select
              value={playbackRate}
              onChange={(e) => onRateChange(Number(e.target.value))}
              className="idp-input border rounded px-1.5 py-0.5 text-xs cursor-pointer"
            >
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            {parts.map((p) => (
              <button
                key={p.partNumber}
                type="button"
                onClick={() => onSeek(p.startTime)}
                className="px-2 py-0.5 rounded border idp-muted hover:opacity-85 text-[11px] font-medium cursor-pointer"
                title={`Nhảy tới ${p.title} (${formatSecondsClock(p.startTime)})`}
              >
                P{p.partNumber}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
