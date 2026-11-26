import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { db } from '../../db/database';
import {
  createReadingLocalOverrideFromUpload,
  inspectReadingPdfFile,
  type PdfInspectionResult,
} from '../../lib/localReadingParser';
import { loadReadingManifest } from '../../lib/readingDataLoader';
import type {
  ReadingManifestData,
  ReadingManifestEntry,
} from '../../types/reading';

export function ReadingDataManagerSection() {
  const [manifest, setManifest] = useState<ReadingManifestData | null>(null);
  const [volFilter, setVolFilter] = useState<number>(0);
  const [editingEntry, setEditingEntry] = useState<ReadingManifestEntry | null>(null);
  const [examFile, setExamFile] = useState<File | null>(null);
  const [pdfInfo, setPdfInfo] = useState<PdfInspectionResult | null>(null);
  const [rawKeyText, setRawKeyText] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const overrides = useLiveQuery(() => db.readingLocalOverrides.toArray(), []) ?? [];
  const overrideMap = useMemo(
    () => new Map(overrides.map((o) => [o.testId, o])),
    [overrides]
  );

  const reloadManifest = useCallback(() => {
    loadReadingManifest()
      .then(setManifest)
      .catch((err) =>
        setFeedback(err instanceof Error ? err.message : 'Lỗi tải Reading manifest.')
      );
  }, []);

  useEffect(() => {
    reloadManifest();
  }, [reloadManifest]);

  const volSummaries = useMemo(() => {
    if (!manifest) return [];
    return [7, 8, 9, 10].map((v) => {
      const items = manifest.tests.filter((t) => t.vol === v);
      const ready = items.filter((t) => t.status === 'ready').length;
      const missingDetails = items
        .filter((t) => t.status !== 'ready')
        .map((t) => `Test ${t.test} (${t.keyCount}/40)`);
      return {
        vol: v,
        total: items.length,
        ready,
        notes:
          missingDetails.length === 0
            ? `Đủ bài đọc P1–P3 + Key 40/40 cho toàn bộ ${items.length} đề.`
            : `Thiếu trong nguồn gốc: ${missingDetails.join(', ')}.`,
      };
    });
  }, [manifest]);

  const visibleTests = useMemo(() => {
    if (!manifest) return [];
    return manifest.tests.filter((t) => volFilter === 0 || t.vol === volFilter);
  }, [manifest, volFilter]);

  const openUploadModal = (entry: ReadingManifestEntry) => {
    setEditingEntry(entry);
    setExamFile(null);
    setPdfInfo(null);
    setRawKeyText(overrideMap.get(entry.testId)?.rawKeyText ?? '');
  };

  const handleSelectExamFile = async (file: File | null) => {
    setExamFile(file);
    setPdfInfo(null);
    if (file && file.name.toLowerCase().endsWith('.pdf')) {
      try {
        const info = await inspectReadingPdfFile(file);
        setPdfInfo(info);
      } catch {
        setFeedback('Không thể phân tích file PDF vừa chọn. Vui lòng kiểm tra định dạng.');
      }
    }
  };

  const handleSaveUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    if (!examFile && !rawKeyText.trim()) {
      setFeedback('Vui lòng chọn file đề (.json / .txt / .pdf) hoặc dán Answer Key.');
      return;
    }

    setSaving(true);
    try {
      const record = await createReadingLocalOverrideFromUpload({
        vol: editingEntry.vol,
        test: editingEntry.test,
        examFile,
        rawKeyText,
      });
      await db.readingLocalOverrides.put(record);
      reloadManifest();
      setFeedback(
        record.sourceMode === 'scanned_pdf'
          ? `Đã lưu PDF scan cho ${editingEntry.title} vào IndexedDB (hiển thị bằng PdfExamViewer).`
          : `Đã nạp dữ liệu Reading cho ${editingEntry.title} vào trình duyệt (${record.testData?.keyCount ?? 0}/40 Key).`
      );
      setEditingEntry(null);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Lỗi khi phân tích file tải lên.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOverride = async (entry: ReadingManifestEntry) => {
    await db.readingLocalOverrides.delete(entry.testId);
    reloadManifest();
    setFeedback(`Đã xóa dữ liệu cục bộ của ${entry.title}; khôi phục bản mặc định.`);
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center justify-between">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {manifest && (
        <section className="bg-white border border-slate-300 rounded-md p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                Kiểm kê nguồn dữ liệu IELTS Reading — Vol 7 đến Vol 10
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Thống kê trực tiếp từ bộ Original Exams (Passage 1–3, 40 câu hỏi, Answer Key,
                bằng chứng trích dẫn và bản dịch tiếng Việt).
              </p>
            </div>

            <div className="px-3 py-2 rounded bg-slate-100 border border-slate-200 text-xs">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" />
                <span>
                  Trạng thái chuẩn hóa: {manifest.readyTests} Đầy đủ / {manifest.partialTests} Thiếu thành phần
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Tổng cộng {manifest.totalTests} đề Reading · Cho phép nạp bổ sung JSON / TXT / PDF cục bộ
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {volSummaries.map((v) => (
              <div
                key={v.vol}
                className={`p-3 rounded border text-xs ${
                  v.ready === v.total
                    ? 'border-slate-300 bg-slate-50'
                    : 'border-amber-300 bg-amber-50/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-slate-900">Vol {v.vol}</span>
                  <span
                    className={`px-2 py-0.5 rounded font-semibold ${
                      v.ready === v.total
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-200 text-amber-950'
                    }`}
                  >
                    {v.ready}/{v.total} đề
                  </span>
                </div>
                <p className="text-slate-600 mt-1.5 leading-relaxed">{v.notes}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filter & Table */}
      <section className="bg-white border border-slate-300 rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {[0, 7, 8, 9, 10].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVolFilter(v)}
                className={`px-2.5 py-1 rounded border font-medium cursor-pointer ${
                  volFilter === v
                    ? 'bg-[#0f2942] text-white border-[#0f2942]'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {v === 0 ? 'Tất cả Vol 7–10' : `Vol ${v}`}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-500">
            Hỗ trợ nạp file cục bộ (.json, .txt, .pdf — tự nhận diện PDF scan &lt; 200 ký tự/trang)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-700">
                <th className="py-2.5 px-3 font-semibold">Đề Reading</th>
                <th className="py-2.5 px-2 font-semibold text-center">Passage 1–3</th>
                <th className="py-2.5 px-2 font-semibold text-center">Câu hỏi</th>
                <th className="py-2.5 px-2 font-semibold text-center">Answer Key</th>
                <th className="py-2.5 px-3 font-semibold">Trạng thái</th>
                <th className="py-2.5 px-3 font-semibold text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleTests.map((item) => {
                const ov = overrideMap.get(item.testId);
                const isReady = item.status === 'ready';

                return (
                  <tr key={item.testId} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">
                        Vol {item.vol} · Test {item.test}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-xs">
                        {item.sourceName}
                      </div>
                    </td>

                    <td className="py-2.5 px-2 text-center">
                      {item.hasPassages ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500 inline" />
                      )}
                    </td>

                    <td className="py-2.5 px-2 text-center font-mono">
                      {item.hasQuestions ? (
                        <span className="text-emerald-700 font-semibold">
                          {item.questionCount}/40
                        </span>
                      ) : (
                        <span className="text-red-600">{item.questionCount}/40</span>
                      )}
                    </td>

                    <td className="py-2.5 px-2 text-center font-mono">
                      {item.keyCount >= 40 ? (
                        <span className="text-emerald-700 font-semibold">40/40</span>
                      ) : (
                        <span className="text-amber-700 font-semibold">{item.keyCount}/40</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isReady ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
                            Đầy đủ
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-900 font-semibold">
                            <AlertTriangle className="w-3 h-3" /> Thiếu thành phần
                          </span>
                        )}
                        {ov && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 text-[11px]">
                            Đã ghi đè cục bộ
                          </span>
                        )}
                      </div>
                      {item.missingComponents.length > 0 && (
                        <div className="text-[11px] text-amber-800 mt-0.5">
                          {item.missingComponents.join(', ')}
                        </div>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openUploadModal(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium cursor-pointer"
                        >
                          <Upload className="w-3 h-3" />
                          <span>Nạp / Bổ sung</span>
                        </button>
                        {ov && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteOverride(item)}
                            className="p-1 rounded border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                            title="Xóa bản ghi đè cục bộ"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Reading Local Upload Modal */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-300 rounded-md shadow-lg w-full max-w-xl max-h-[90vh] overflow-auto">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Nạp / Bổ sung dữ liệu Reading — Vol {editingEntry.vol} · Test {editingEntry.test}
              </h3>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="p-1 rounded hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUpload} className="p-4 space-y-3 text-xs">
              <label className="block p-3 rounded border border-slate-300 bg-slate-50 cursor-pointer">
                <span className="font-semibold text-slate-800 block mb-1">
                  1. Chọn file đề (.json chuẩn Reading, .txt hoặc .pdf gốc)
                </span>
                <input
                  type="file"
                  accept=".json,.txt,.pdf,application/json,text/plain,application/pdf"
                  onChange={(e) => void handleSelectExamFile(e.target.files?.[0] ?? null)}
                  className="w-full"
                />
              </label>

              {pdfInfo && (
                <div
                  className={`p-2.5 rounded border text-xs ${
                    pdfInfo.isScanned
                      ? 'bg-amber-50 border-amber-300 text-amber-950'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  {pdfInfo.isScanned ? (
                    <span>
                      Phát hiện PDF dạng ảnh scan ({pdfInfo.avgCharsPerPage.toFixed(0)} ký
                      tự/trang &lt; 200 across {pdfInfo.pageCount} trang). Hệ thống sẽ hiển thị
                      trực tiếp PDF bằng trình xem PDF gốc.
                    </span>
                  ) : (
                    <span>
                      PDF chứa lớp văn bản sạch ({pdfInfo.avgCharsPerPage.toFixed(0)} ký
                      tự/trang · {pdfInfo.pageCount} trang) — tự động tách văn bản Passage.
                    </span>
                  )}
                </div>
              )}

              <label className="block">
                <span className="font-semibold text-slate-700 block mb-1">
                  2. Answer Key (mỗi câu 1 dòng: &quot;1. TRUE&quot;, &quot;14. solar energy&quot;...)
                </span>
                <textarea
                  rows={6}
                  value={rawKeyText}
                  onChange={(e) => setRawKeyText(e.target.value)}
                  placeholder={'1. TRUE\n2. FALSE\n3. NOT GIVEN\n...'}
                  className="w-full p-2.5 rounded border border-slate-300 font-mono"
                />
              </label>

              <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 rounded bg-[#0f2942] hover:bg-[#1e3a8a] text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Đang xử lý...' : 'Lưu dữ liệu Reading'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
