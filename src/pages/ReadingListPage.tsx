import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Database,
  Play,
  Search,
} from 'lucide-react';
import { db } from '../db/database';
import { loadReadingManifest } from '../lib/readingDataLoader';
import type { ReadingAttempt, ReadingManifestData } from '../types/reading';

export function ReadingListPage() {
  const [manifest, setManifest] = useState<ReadingManifestData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [volFilter, setVolFilter] = useState<'all' | number>('all');
  const [search, setSearch] = useState('');

  const attempts = useLiveQuery(
    () => db.readingAttempts.orderBy('finishedAt').reverse().toArray(),
    [],
    [] as ReadingAttempt[]
  );

  useEffect(() => {
    let cancelled = false;
    loadReadingManifest()
      .then((data) => {
        if (!cancelled) setManifest(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Lỗi tải danh sách Reading.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const latestByTestId = useMemo(() => {
    const map = new Map<string, ReadingAttempt>();
    for (const a of attempts) {
      if (!map.has(a.testId)) map.set(a.testId, a);
    }
    return map;
  }, [attempts]);

  const filteredTests = useMemo(() => {
    if (!manifest) return [];
    const q = search.trim().toLowerCase();
    return manifest.tests.filter((t) => {
      if (volFilter !== 'all' && t.vol !== volFilter) return false;
      if (!q) return true;
      const hay = `${t.title} vol ${t.vol} test ${t.test} ${t.passageTitles.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [manifest, volFilter, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#0f2942]" />
            <span>IELTS Academic Reading — Vol 7–10 (IDP Standard)</span>
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Giao diện chia đôi màn hình chuẩn IDP, Highlight 4 màu kèm ghi chú, tự động chấm
            Academic Band và trích xuất bằng chứng kèm dịch tiếng Việt.
          </p>
        </div>

        <Link
          to="/data?tab=reading"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
        >
          <Database className="w-3.5 h-3.5" />
          <span>Quản lý nguồn dữ liệu</span>
        </Link>
      </section>

      {error && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-900 text-xs">
          {error}
        </div>
      )}

      {/* Summary Stats */}
      {manifest && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-300 rounded-md p-3">
            <div className="text-[11px] text-slate-500">Tổng đề Reading</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
              {manifest.totalTests} đề
            </div>
          </div>
          <div className="bg-white border border-slate-300 rounded-md p-3">
            <div className="text-[11px] text-slate-500">Đủ bài đọc + Key 40/40</div>
            <div className="text-xl font-bold text-emerald-700 tabular-nums mt-0.5">
              {manifest.readyTests} đề
            </div>
          </div>
          <div className="bg-white border border-slate-300 rounded-md p-3">
            <div className="text-[11px] text-slate-500">Thiếu Key trong tài liệu gốc</div>
            <div className="text-xl font-bold text-amber-700 tabular-nums mt-0.5">
              {manifest.partialTests} đề
            </div>
          </div>
          <div className="bg-white border border-slate-300 rounded-md p-3">
            <div className="text-[11px] text-slate-500">Số lần đã nộp Reading</div>
            <div className="text-xl font-bold text-[#1e40af] tabular-nums mt-0.5">
              {attempts.length} lượt
            </div>
          </div>
        </section>
      )}

      {/* Filter Bar */}
      <section className="bg-white border border-slate-300 rounded-md p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(['all', 7, 8, 9, 10] as const).map((v) => {
            const count =
              v === 'all'
                ? manifest?.tests.length ?? 0
                : manifest?.tests.filter((t) => t.vol === v).length ?? 0;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setVolFilter(v)}
                className={`px-3 py-1 rounded border font-medium cursor-pointer ${
                  volFilter === v
                    ? 'bg-[#0f2942] text-white border-[#0f2942]'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {v === 'all' ? `Tất cả (${count})` : `Vol ${v} (${count})`}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên bài đọc, Vol, Test..."
            className="w-full pl-8 pr-3 py-1.5 rounded border border-slate-300 text-xs focus:outline-2 focus:outline-[#1e40af]"
          />
        </div>
      </section>

      {/* Catalog Grid */}
      {!manifest && !error ? (
        <div className="bg-white border border-slate-300 rounded-md p-8 text-center text-xs text-slate-500">
          Đang tải danh mục IELTS Reading Vol 7–10...
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredTests.map((entry) => {
            const latest = latestByTestId.get(entry.testId);
            const isReady = entry.status === 'ready';

            return (
              <article
                key={entry.testId}
                className="bg-white border border-slate-300 rounded-md p-4 flex flex-col justify-between gap-3 hover:border-slate-400 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-[#0f2942] uppercase tracking-wider">
                        Vol {entry.vol} · Test {entry.test}
                      </div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        {entry.title}
                      </h2>
                    </div>

                    {isReady ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] font-semibold shrink-0">
                        <CheckCircle2 className="w-3 h-3" /> {entry.keyCount}/40 Key
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-semibold shrink-0"
                        title={entry.missingComponents.join(', ')}
                      >
                        <AlertTriangle className="w-3 h-3" /> {entry.keyCount}/40 Key
                      </span>
                    )}
                  </div>

                  {/* Passage Titles */}
                  <ul className="space-y-1 text-xs text-slate-600 pt-1">
                    {entry.passageTitles.map((pt, idx) => (
                      <li key={idx} className="truncate">
                        <span className="font-mono font-semibold text-slate-700 mr-1">
                          P{idx + 1}:
                        </span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200">
                  {latest && (
                    <div className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1">
                      <span className="text-slate-600">Lần gần nhất:</span>
                      <Link
                        to={`/reading/${entry.vol}/${entry.test}?attemptId=${latest.id}`}
                        className="font-semibold text-[#1e40af] hover:underline"
                      >
                        {latest.score}/{latest.keyedTotal} · Band {latest.band.toFixed(1)} (Xem lại)
                      </Link>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Link
                      to={`/reading/${entry.vol}/${entry.test}?mode=real`}
                      className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-[#0f2942] hover:bg-[#1e3a8a] text-white font-semibold"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Thi thật (60p)</span>
                    </Link>
                    <Link
                      to={`/reading/${entry.vol}/${entry.test}?mode=practice`}
                      className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Tự do</span>
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Recent Attempts Table */}
      {attempts.length > 0 && (
        <section className="bg-white border border-slate-300 rounded-md overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800">
            Lịch sử làm bài Reading gần đây
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Đề thi</th>
                  <th className="text-left px-3 py-2 font-semibold">Chế độ</th>
                  <th className="text-left px-3 py-2 font-semibold">Điểm</th>
                  <th className="text-left px-3 py-2 font-semibold">Band</th>
                  <th className="text-left px-3 py-2 font-semibold">Ngày nộp</th>
                  <th className="text-right px-3 py-2 font-semibold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {attempts.slice(0, 10).map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      Vol {a.vol} · Test {a.test}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {a.mode === 'real' ? 'Thi thật (60p)' : 'Tự do'}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                      {a.score}/{a.keyedTotal}
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-[#1e40af]">
                      {a.band.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {new Date(a.finishedAt).toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/reading/${a.vol}/${a.test}?attemptId=${a.id}`}
                        className="text-[#1e40af] font-semibold hover:underline"
                      >
                        Xem chấm chữa
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
