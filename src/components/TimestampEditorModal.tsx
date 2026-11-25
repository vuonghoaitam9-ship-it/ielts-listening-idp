import { useEffect, useRef, useState } from 'react';
import { Download, Play, Upload, X, Check } from 'lucide-react';
import { pauseOthers, registerAudio } from '../lib/audioCoordinator';
import { parseRawTranscriptToSegments } from '../lib/localKeyParser';
import {
  buildLongSegmentsFromShort,
  exportSegmentsToVtt,
  formatSecondsClock,
  parseSubtitlesToSegments,
} from '../lib/subtitleParser';
import { db } from '../db/database';
import type { TranscriptSegment } from '../types';

interface TimestampEditorModalProps {
  testId: string;
  audioUrl: string;
  audioDurationSec: number;
  initialSegments: TranscriptSegment[];
  onClose: () => void;
  onApplied: (segments: TranscriptSegment[]) => void;
}

export function TimestampEditorModal({
  testId,
  audioUrl,
  audioDurationSec,
  initialSegments,
  onClose,
  onApplied,
}: TimestampEditorModalProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>(() =>
    initialSegments.map((s) => ({ ...s }))
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [subText, setSubText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const unreg = registerAudio(el);
    const onPlay = () => pauseOthers(el);
    el.addEventListener('play', onPlay);
    return () => {
      el.removeEventListener('play', onPlay);
      unreg();
    };
  }, []);

  const updateSegment = (idx: number, patch: Partial<TranscriptSegment>) => {
    setSegments((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch, timestampSource: 'custom' } : item))
    );
  };

  const handleMarkStart = () => {
    if (!segments[activeIdx]) return;
    const cur = audioRef.current?.currentTime ?? 0;
    updateSegment(activeIdx, { startTime: Number(cur.toFixed(2)) });
  };

  const handleMarkEndAndNext = () => {
    if (!segments[activeIdx]) return;
    const cur = audioRef.current?.currentTime ?? 0;
    const endT = Number(Math.max(segments[activeIdx].startTime + 0.5, cur).toFixed(2));
    updateSegment(activeIdx, { endTime: endT });
    if (activeIdx + 1 < segments.length) {
      updateSegment(activeIdx + 1, { startTime: endT });
      setActiveIdx(activeIdx + 1);
    }
  };

  const handleImportSubtitles = () => {
    const trimmed = subText.trim();
    if (!trimmed) {
      setStatusMsg('Vui lòng dán nội dung SRT / VTT / LRC hoặc văn bản Transcript.');
      return;
    }
    let parsed = parseSubtitlesToSegments(trimmed, 1);
    let modeNote = 'phụ đề';
    if (parsed.length === 0) {
      parsed = parseRawTranscriptToSegments(trimmed, audioDurationSec || 1500);
      modeNote = 'văn bản thuần (đã chia câu và ước lượng mốc giờ)';
    }
    if (parsed.length === 0) {
      setStatusMsg('Không nhận diện được nội dung hợp lệ.');
      return;
    }
    setSegments(parsed);
    setActiveIdx(0);
    setShowImport(false);
    setStatusMsg(`Đã nạp ${parsed.length} đoạn từ ${modeNote}.`);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const txt = await file.text();
    let parsed = parseSubtitlesToSegments(txt, 1);
    if (parsed.length === 0) {
      parsed = parseRawTranscriptToSegments(txt, audioDurationSec || 1500);
    }
    if (parsed.length === 0) {
      setStatusMsg('File không chứa dữ liệu transcript hoặc phụ đề hợp lệ.');
      return;
    }
    setSegments(parsed);
    setActiveIdx(0);
    setStatusMsg(`Đã nhập ${parsed.length} đoạn từ ${file.name}.`);
  };

  const handleExportVtt = () => {
    const content = exportSegmentsToVtt(segments);
    const blob = new Blob([content], { type: 'text/vtt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${testId}.vtt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    const clean = segments.map((s) => ({
      ...s,
      startTime: Math.max(0, Number(s.startTime.toFixed(2))),
      endTime: Math.max(s.startTime + 0.4, Number(s.endTime.toFixed(2))),
      timestampSource: 'custom' as const,
    }));
    await db.customTimestamps.put({
      testId,
      segments: clean,
      longSegments: buildLongSegmentsFromShort(clean),
      updatedAt: Date.now(),
    });
    onApplied(clean);
    onClose();
  };

  const handleDistributeEvenly = () => {
    const dur = audioDurationSec || audioRef.current?.duration || 1500;
    const totChars = segments.reduce((acc, s) => acc + Math.max(s.text.length, 10), 0) || 1;
    let cursor = 0;
    setSegments(
      segments.map((s) => {
        const span = (Math.max(s.text.length, 10) / totChars) * dur;
        const st = Number(cursor.toFixed(2));
        const en = Number(Math.min(dur, cursor + span).toFixed(2));
        cursor = en;
        return { ...s, startTime: st, endTime: en, timestampSource: 'custom' };
      })
    );
    setStatusMsg('Đã phân bổ lại mốc thời gian theo độ dài văn bản.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white text-slate-900 border border-slate-300 rounded-md shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Biên tập Timestamp &amp; Nhập SRT / VTT</h3>
            <p className="text-xs text-slate-500">
              Gắn mốc thời gian chính xác trên audio gốc hoặc nhập file .srt/.vtt/.lrc (lưu IndexedDB)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50">
          <audio ref={audioRef} src={audioUrl} controls className="w-full h-9" />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleMarkStart}
              className="px-2.5 py-1 rounded bg-[#0f2942] text-white font-medium cursor-pointer"
            >
              Đặt Start (#{activeIdx + 1})
            </button>
            <button
              type="button"
              onClick={handleMarkEndAndNext}
              className="px-2.5 py-1 rounded bg-[#1e40af] text-white font-medium cursor-pointer"
            >
              Đặt End &amp; Sang câu tiếp
            </button>
            <button
              type="button"
              onClick={handleDistributeEvenly}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 cursor-pointer"
            >
              Chia đều theo độ dài chữ
            </button>
            <label className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 flex items-center gap-1 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Nhập file .SRT/.VTT</span>
              <input
                type="file"
                accept=".srt,.vtt,.lrc,.txt"
                onChange={handleFileImport}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowImport((v) => !v)}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 cursor-pointer"
            >
              Dán nội dung SRT/VTT
            </button>
            <button
              type="button"
              onClick={handleExportVtt}
              className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Xuất .VTT</span>
            </button>
          </div>

          {statusMsg && (
            <div className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded px-2.5 py-1.5">
              {statusMsg}
            </div>
          )}

          {showImport && (
            <div className="space-y-2">
              <textarea
                rows={4}
                value={subText}
                onChange={(e) => setSubText(e.target.value)}
                placeholder="Dán nội dung file .srt, .vtt hoặc .lrc tại đây..."
                className="w-full p-2 text-xs rounded border border-slate-300 bg-white font-mono"
              />
              <button
                type="button"
                onClick={handleImportSubtitles}
                className="px-3 py-1 rounded bg-slate-900 text-white text-xs font-medium cursor-pointer"
              >
                Áp dụng nội dung đã dán
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-1.5 text-xs">
          {segments.map((seg, idx) => (
            <div
              key={seg.id}
              onClick={() => setActiveIdx(idx)}
              className={`p-2 rounded border flex flex-wrap items-center gap-2 cursor-pointer ${
                activeIdx === idx
                  ? 'border-[#1e40af] bg-blue-50/60'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="w-8 font-mono font-semibold text-slate-500">#{idx + 1}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (audioRef.current) {
                    audioRef.current.currentTime = seg.startTime;
                    audioRef.current.play().catch(() => {});
                  }
                }}
                className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-100 cursor-pointer"
                title={`Nghe từ ${formatSecondsClock(seg.startTime)}`}
              >
                <Play className="w-3 h-3" />
              </button>
              <input
                type="number"
                step="0.1"
                value={seg.startTime}
                onChange={(e) => updateSegment(idx, { startTime: Number(e.target.value) })}
                className="w-20 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono tabular-nums"
              />
              <span>→</span>
              <input
                type="number"
                step="0.1"
                value={seg.endTime}
                onChange={(e) => updateSegment(idx, { endTime: Number(e.target.value) })}
                className="w-20 px-1.5 py-1 rounded border border-slate-300 bg-white font-mono tabular-nums"
              />
              <input
                type="text"
                value={seg.text}
                onChange={(e) => updateSegment(idx, { text: e.target.value })}
                className="flex-1 min-w-[200px] px-2 py-1 rounded border border-slate-300 bg-white"
              />
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100 text-xs cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Lưu Timestamp</span>
          </button>
        </div>
      </div>
    </div>
  );
}
