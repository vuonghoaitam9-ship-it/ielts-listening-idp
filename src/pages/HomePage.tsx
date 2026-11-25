import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  Clock,
  FileText,
  Headphones,
  Play,
  Upload,
  AlertCircle,
} from 'lucide-react';
import { db } from '../db/database';
import { loadManifest, seedVocabCoreIfNeeded } from '../lib/dataLoader';
import { formatSecondsClock } from '../lib/subtitleParser';
import type { ManifestData } from '../types';

export function HomePage() {
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [volFilter, setVolFilter] = useState<number>(0);

  const attempts =
    useLiveQuery(() => db.examAttempts.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const overrides = useLiveQuery(() => db.localOverrides.toArray(), []) ?? [];
  const vocabCards = useLiveQuery(() => db.vocabCards.toArray(), []) ?? [];

  useEffect(() => {
    loadManifest()
      .then(setManifest)
      .catch((err) =>
        setLoadErr(err instanceof Error ? err.message : 'Không thể tải manifest.json')
      );
    seedVocabCoreIfNeeded().catch(() => {});
  }, []);

  const overrideIds = useMemo(
    () => new Set(overrides.map((o) => o.testId)),
    [overrides]
  );

  const bestAttemptByTest = useMemo(() => {
    const map = new Map<string, { score: number; band: number; id?: number }>();
    for (const a of attempts) {
      const prev = map.get(a.testId);
      if (!prev || a.score > prev.score) {
        map.set(a.testId, { score: a.score, band: a.band, id: a.id });
      }
    }
    return map;
  }, [attempts]);

  const dueVocabCount = useMemo(() => {
    const now = Date.now();
    return vocabCards.filter((c) => c.nextReviewAt <= now).length;
  }, [vocabCards]);

  const avgBand = useMemo(() => {
    if (attempts.length === 0) return null;
    const recent = attempts.slice(0, 5);
    const avg = recent.reduce((sum, a) => sum + a.band, 0) / recent.length;
    return avg.toFixed(1);
  }, [attempts]);

  const filteredTests = useMemo(() => {
    if (!manifest) return [];
    return manifest.tests.filter((t) => volFilter === 0 || t.vol === volFilter);
  }, [manifest, volFilter]);

  return (
    <div className="space-y-6">
      {loadErr && (
        <div className="p-4 rounded bg-red-50 border border-red-300 text-xs text-red-800">
          Lỗi tải dữ liệu: {loadErr}
        </div>
      )}

      {/* Quick Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-300 rounded-md p-4">
          <div className="text-xs text-slate-500">Đề sẵn sàng (Vol 7–10)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {manifest
              ? manifest.tests.filter(
                  (t) => t.status === 'ready' || overrideIds.has(t.id)
                ).length
              : '—'}{' '}
            <span className="text-sm font-normal text-slate-500">
              / {manifest?.sourceSummary.totalTests ?? 32}
            </span>
          </div>
        </div>
        <div className="bg-white border border-slate-300 rounded-md p-4">
          <div className="text-xs text-slate-500">Số lần nộp bài</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {attempts.length}
          </div>
        </div>
        <div className="bg-white border border-slate-300 rounded-md p-4">
          <div className="text-xs text-slate-500">Band trung bình gần nhất</div>
          <div className="text-2xl font-bold text-[#0f2942] mt-1 tabular-nums">
            {avgBand ?? '—'}
          </div>
        </div>
        <Link
          to="/vocab"
          className="bg-white border border-slate-300 rounded-md p-4 hover:border-[#1e40af] transition-colors"
        >
          <div className="text-xs text-slate-500">Từ vựng cần ôn (SM-2)</div>
          <div className="text-2xl font-bold text-[#1e40af] mt-1 tabular-nums">
            {dueVocabCount}{' '}
            <span className="text-xs font-medium text-slate-500">thẻ hôm nay</span>
          </div>
        </Link>
      </section>

      {/* Filter & Tests List */}
      <section className="bg-white border border-slate-300 rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900">
              Bộ đề IELTS Listening Vol 7 – Vol 10 (Audio gốc &amp; PDF chuẩn IDP)
            </h1>
            <p className="text-xs text-slate-600">
              Chọn bài thi để mở phòng thi chia đôi màn hình (PDF gốc + Phiếu điền đáp án 1–40) hoặc luyện Dictation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {[0, 7, 8, 9, 10].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVolFilter(v)}
                className={`px-3 py-1 rounded border font-medium cursor-pointer ${
                  volFilter === v
                    ? 'bg-[#0f2942] text-white border-[#0f2942]'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                {v === 0 ? 'Tất cả' : `Vol ${v}`}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
          {filteredTests.map((t) => {
            const isReady = t.status === 'ready' || overrideIds.has(t.id);
            const best = bestAttemptByTest.get(t.id);

            return (
              <article
                key={t.id}
                className={`border rounded-md p-4 flex flex-col justify-between gap-3 ${
                  isReady ? 'border-slate-300 bg-white' : 'border-amber-300 bg-amber-50/40'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-bold text-sm text-slate-900">{t.title}</h2>
                    {isReady ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Đủ dữ liệu
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-200 text-amber-950 text-[11px] font-semibold">
                        <AlertCircle className="w-3 h-3" /> Thiếu tài liệu
                      </span>
                    )}
                  </div>

                  {isReady ? (
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" /> {t.questionPageRange[1]} trang đề
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock className="w-3 h-3" /> {Math.round(t.audioDurationSec / 60)} phút
                      </span>
                      <span>40 câu</span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-900 leading-relaxed">
                      {t.sourceNotes}
                    </p>
                  )}

                  {best && (
                    <div className="text-xs font-medium text-[#0f2942] bg-slate-100 rounded px-2 py-1 inline-block tabular-nums">
                      Thành tích cao nhất: {best.score}/40 (Band {best.band.toFixed(1)})
                    </div>
                  )}
                </div>

                {isReady ? (
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 text-xs">
                    <Link
                      to={`/exam/${t.vol}/${t.testNumber}`}
                      className="flex-1 py-1.5 px-2.5 rounded bg-[#0f2942] hover:bg-[#1e3a8a] text-white font-semibold flex items-center justify-center gap-1"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Vào phòng thi IDP</span>
                    </Link>
                    <Link
                      to={`/dictation/${t.vol}/${t.testNumber}`}
                      className="py-1.5 px-2.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium flex items-center gap-1"
                    >
                      <Headphones className="w-3.5 h-3.5" />
                      <span>Dictation</span>
                    </Link>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-amber-200/70 text-xs">
                    <Link
                      to="/data"
                      className="w-full py-1.5 px-2.5 rounded border border-amber-400 bg-white hover:bg-amber-50 text-amber-950 font-semibold flex items-center justify-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Nạp file cục bộ (PDF + Audio)</span>
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* Recent Attempts Table */}
      {attempts.length > 0 && (
        <section className="bg-white border border-slate-300 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-bold text-slate-900">
              Lịch sử làm bài gần đây
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/50">
                  <th className="py-2 px-3">Bài thi</th>
                  <th className="py-2 px-3">Ngày làm</th>
                  <th className="py-2 px-3">Chế độ</th>
                  <th className="py-2 px-3">Thời gian</th>
                  <th className="py-2 px-3">Điểm</th>
                  <th className="py-2 px-3">Band</th>
                  <th className="py-2 px-3 text-right">Xem lại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {attempts.slice(0, 10).map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-semibold text-slate-900">{a.testTitle}</td>
                    <td className="py-2 px-3 text-slate-600 tabular-nums">
                      {new Date(a.createdAt).toLocaleString('vi-VN')}
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {a.mode === 'real' ? 'Thi thật' : 'Luyện tập'}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-slate-600">
                      {formatSecondsClock(a.durationUsedSec)}
                    </td>
                    <td className="py-2 px-3 font-semibold tabular-nums">
                      {a.score}/{a.total}
                    </td>
                    <td className="py-2 px-3 font-bold text-[#0f2942] tabular-nums">
                      {a.band.toFixed(1)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Link
                        to={`/exam/${a.vol}/${a.testNumber}?attemptId=${a.id}`}
                        className="text-[#1e40af] font-medium hover:underline"
                      >
                        Mở giải thích chi tiết
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
