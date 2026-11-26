import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ReadingDataManagerSection } from '../components/reading/ReadingDataManagerSection';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HardDrive,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { db } from '../db/database';
import { loadManifest, loadTestData, revokeManagedObjectUrls } from '../lib/dataLoader';
import { buildLocalTestData } from '../lib/localKeyParser';
import type { ManifestData, TestManifestItem } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

async function measureAudioDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve) => {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        resolve(Number.isFinite(a.duration) ? Number(a.duration.toFixed(2)) : 1500);
      };
      a.onerror = () => resolve(1500);
      a.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function measurePdfPages(blob: Blob): Promise<number> {
  const buf = await blob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = doc.numPages;
  await doc.destroy();
  return pages;
}

export function DataManagerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'reading' ? 'reading' : 'listening';
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [volFilter, setVolFilter] = useState<number>(0);
  const [editingItem, setEditingItem] = useState<TestManifestItem | null>(null);

  // Local upload form state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [rawKey, setRawKey] = useState('');
  const [rawTranscript, setRawTranscript] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const overrides = useLiveQuery(() => db.localOverrides.toArray(), []) ?? [];
  const overrideMap = new Map(overrides.map((o) => [o.testId, o]));

  useEffect(() => {
    loadManifest().then(setManifest).catch(() => {});
    return () => revokeManagedObjectUrls();
  }, []);

  const openEditor = (item: TestManifestItem) => {
    setEditingItem(item);
    setPdfFile(null);
    setAudioFile(null);
    setRawKey('');
    setRawTranscript('');
  };

  const handleUploadSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setSaving(true);
    try {
      const existingBase = await loadTestData(editingItem.vol, editingItem.testNumber);
      const prevOverride = await db.localOverrides.get(editingItem.id);

      const nextPdfBlob = pdfFile ?? prevOverride?.pdfBlob;
      const nextAudioBlob = audioFile ?? prevOverride?.audioBlob;

      if (!existingBase && (!nextPdfBlob || !nextAudioBlob)) {
        setFeedback('Đối với bài chưa có dữ liệu trên repo (như Vol 10), cần chọn đủ file PDF đề gốc và Audio gốc.');
        setSaving(false);
        return;
      }

      const audioDur = nextAudioBlob
        ? await measureAudioDuration(nextAudioBlob)
        : existingBase?.audioDurationSec ?? 1500;
      const pdfPages = nextPdfBlob
        ? await measurePdfPages(nextPdfBlob)
        : existingBase?.pdfPages ?? 6;

      let customJson = prevOverride?.customJson;
      if (rawKey.trim() || rawTranscript.trim() || !existingBase) {
        const built = buildLocalTestData({
          testId: editingItem.id,
          vol: editingItem.vol,
          testNumber: editingItem.testNumber,
          title: editingItem.title,
          pdfUrl: `./data/vol-${editingItem.vol}/test-${editingItem.testNumber}/exam.pdf`,
          pdfPages,
          audioUrl: `./data/vol-${editingItem.vol}/test-${editingItem.testNumber}/audio.mp3`,
          audioDurationSec: audioDur,
          rawKeyText: rawKey,
          rawTranscriptText: rawTranscript,
        });
        customJson = built;
      }

      await db.localOverrides.put({
        testId: editingItem.id,
        vol: editingItem.vol,
        testNumber: editingItem.testNumber,
        title: editingItem.title,
        pdfBlob: nextPdfBlob,
        audioBlob: nextAudioBlob,
        audioDurationSec: audioDur,
        customJson,
        updatedAt: Date.now(),
      });

      setFeedback(`Đã lưu dữ liệu cục bộ cho ${editingItem.title} vào IndexedDB.`);
      setEditingItem(null);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Lỗi xử lý file cục bộ.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportLocalJson = async (item: TestManifestItem) => {
    const data = await loadTestData(item.vol, item.testNumber);
    if (!data) return;
    const exportObj = {
      ...data,
      pdfUrl: `./data/vol-${item.vol}/test-${item.testNumber}/exam.pdf`,
      audioUrl: `./data/vol-${item.vol}/test-${item.testNumber}/audio.mp3`,
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.id}-data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteOverride = async (testId: string) => {
    await db.localOverrides.delete(testId);
    setFeedback(`Đã xóa bản ghi cục bộ của ${testId}.`);
  };

  const visibleTests =
    manifest?.tests.filter((t) => volFilter === 0 || t.vol === volFilter) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-300 pb-3">
        <button
          type="button"
          onClick={() => setSearchParams({})}
          className={`px-3.5 py-1.5 rounded border text-xs font-semibold cursor-pointer ${
            activeTab === 'listening'
              ? 'bg-[#0f2942] text-white border-[#0f2942]'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
        >
          Nguồn Listening (32 đề)
        </button>
        <button
          type="button"
          onClick={() => setSearchParams({ tab: 'reading' })}
          className={`px-3.5 py-1.5 rounded border text-xs font-semibold cursor-pointer ${
            activeTab === 'reading'
              ? 'bg-[#0f2942] text-white border-[#0f2942]'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
        >
          Nguồn Reading (43 đề)
        </button>
      </div>

      {activeTab === 'reading' ? (
        <ReadingDataManagerSection />
      ) : (
        <>
          {feedback && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center justify-between">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Source Audit Summary */}
      {manifest && (
        <section className="bg-white border border-slate-300 rounded-md p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                Kiểm kê nguồn dữ liệu (Source Audit) — Vol 7 đến Vol 10
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Trạng thái thực tế từng thành phần (PDF gốc, Audio gốc, Transcript, Answer Key) và dung lượng đóng gói cho GitHub Pages.
              </p>
            </div>
            <div className="px-3 py-2 rounded bg-slate-100 border border-slate-200 text-xs">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" />
                <span>
                  Dung lượng Repo: {manifest.sourceSummary.totalPackagedDataMB} MB
                </span>
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Audio gốc thô: {manifest.sourceSummary.totalRawAudioMB} MB · File lớn nhất:{' '}
                {manifest.sourceSummary.largestFileMB} MB (&lt; 50 MB chuẩn GitHub)
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {manifest.sourceSummary.volumes.map((v) => (
              <div
                key={v.vol}
                className={`p-3 rounded border text-xs ${
                  v.ready === v.total
                    ? 'border-slate-300 bg-slate-50'
                    : 'border-amber-300 bg-amber-50/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-slate-900">{v.label}</span>
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
            Hỗ trợ nạp file cục bộ (PDF, Audio, SRT/VTT, Key) vào IndexedDB
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-700">
                <th className="py-2.5 px-3 font-semibold">Bài thi</th>
                <th className="py-2.5 px-2 font-semibold text-center">PDF gốc</th>
                <th className="py-2.5 px-2 font-semibold text-center">Audio gốc</th>
                <th className="py-2.5 px-2 font-semibold text-center">Transcript</th>
                <th className="py-2.5 px-2 font-semibold text-center">Answer Key</th>
                <th className="py-2.5 px-2 font-semibold text-center">Timestamp</th>
                <th className="py-2.5 px-3 font-semibold">Dung lượng / Ghi chú</th>
                <th className="py-2.5 px-3 font-semibold text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleTests.map((t) => {
                const ov = overrideMap.get(t.id);
                const hasPdf = t.hasPdf || Boolean(ov?.pdfBlob);
                const hasAudio = t.hasAudio || Boolean(ov?.audioBlob);
                const hasTr = t.hasTranscript || Boolean(ov?.customJson?.transcriptSegments?.length);
                const hasKey = t.hasKey || Boolean(ov?.customJson?.questions?.some((q) => q.canonicalAnswer));

                const Badge = ({ ok, label }: { ok: boolean; label?: string }) =>
                  ok ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {label && <span>{label}</span>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Thiếu</span>
                    </span>
                  );

                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">
                      {t.title}
                      {ov && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px]">
                          Cục bộ
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <Badge ok={hasPdf} label={hasPdf ? `${t.pdfPages || '?'}tr` : undefined} />
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <Badge
                        ok={hasAudio}
                        label={
                          hasAudio
                            ? `${Math.round((ov?.audioDurationSec ?? t.audioDurationSec) / 60)}p`
                            : undefined
                        }
                      />
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <Badge ok={hasTr} />
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <Badge ok={hasKey} label={hasKey ? '40 câu' : undefined} />
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {t.hasExactTimestamps ? (
                        <span className="text-emerald-700 font-medium">Gốc</span>
                      ) : hasTr ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" /> Ước lượng
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 max-w-xs">
                      {t.status === 'ready' ? (
                        <span>
                          MP3 {t.audioOptimizedSizeMB} MB + PDF {t.pdfSizeMB} MB · {t.sourceNotes}
                        </span>
                      ) : (
                        <span className="text-amber-800">{t.sourceNotes}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={() => openEditor(t)}
                        className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Upload className="w-3 h-3" />
                        <span>{t.status === 'ready' ? 'Ghi đè cục bộ' : 'Nạp file cục bộ'}</span>
                      </button>
                      {ov && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleExportLocalJson(t)}
                            className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
                            title="Xuất data.json để đẩy lên GitHub"
                          >
                            <Download className="w-3 h-3" />
                            <span>JSON</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOverride(t.id)}
                            className="p-1 rounded border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                            title="Xóa bản ghi cục bộ"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
        </>
      )}

      {/* Local Upload Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-300 rounded-md shadow-lg w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Nạp dữ liệu cục bộ cho {editingItem.title}
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1 rounded hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSave} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block p-3 rounded border border-slate-300 bg-slate-50 cursor-pointer">
                  <span className="font-semibold block mb-1">1. File PDF đề gốc (.pdf)</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                    className="w-full"
                  />
                </label>

                <label className="block p-3 rounded border border-slate-300 bg-slate-50 cursor-pointer">
                  <span className="font-semibold block mb-1">2. File Audio gốc (.mp3/.m4a/.wav/.mp4)</span>
                  <input
                    type="file"
                    accept="audio/*,video/mp4,.mp3,.m4a,.wav,.mp4"
                    onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                    className="w-full"
                  />
                </label>
              </div>

              <label className="block">
                <span className="font-semibold text-slate-700 block mb-1">
                  3. Answer Key (mỗi câu 1 dòng: &quot;1. city&quot; ... &quot;40. malls&quot;)
                </span>
                <textarea
                  rows={5}
                  value={rawKey}
                  onChange={(e) => setRawKey(e.target.value)}
                  placeholder={'1. city\n2. photos\n...'}
                  className="w-full p-2.5 rounded border border-slate-300 font-mono"
                />
              </label>

              <label className="block">
                <span className="font-semibold text-slate-700 block mb-1">
                  4. Transcript hoặc phụ đề .SRT / .VTT (tùy chọn)
                </span>
                <textarea
                  rows={5}
                  value={rawTranscript}
                  onChange={(e) => setRawTranscript(e.target.value)}
                  placeholder="Dán nội dung transcript hoặc file .srt/.vtt tại đây..."
                  className="w-full p-2.5 rounded border border-slate-300"
                />
              </label>

              <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 rounded bg-[#0f2942] hover:bg-[#1e3a8a] text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Đang xử lý...' : 'Lưu vào trình duyệt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
