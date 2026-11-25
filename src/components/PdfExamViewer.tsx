import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, FileText, StickyNote, ZoomIn, ZoomOut } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfExamViewerProps {
  pdfUrl: string;
  questionPageRange: [number, number];
  notepadText: string;
  onNotepadChange: (val: string) => void;
}

export function PdfExamViewer({
  pdfUrl,
  questionPageRange,
  notepadText,
  onNotepadChange,
}: PdfExamViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [onlyExamPages, setOnlyExamPages] = useState(true);
  const [scale, setScale] = useState(1.25);
  const [activePage, setActivePage] = useState(1);
  const [showNotepad, setShowNotepad] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  const hasHiddenKeyPages = questionPageRange[1] < totalPages;
  const maxVisiblePage = onlyExamPages && hasHiddenKeyPages ? questionPageRange[1] : totalPages;

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: pdfjsLib.PDFDocumentProxy | null = null;
    setLoading(true);
    setErrorMsg(null);

    const task = pdfjsLib.getDocument(pdfUrl);
    task.promise
      .then((doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        loadedDoc = doc;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setActivePage(1);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Không thể tải PDF gốc.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (loadedDoc) {
        loadedDoc.destroy();
      }
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdfDoc || maxVisiblePage === 0) return;
    let cancelled = false;
    const renderTasks: pdfjsLib.RenderTask[] = [];

    async function renderAll() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let pageNum = 1; pageNum <= maxVisiblePage; pageNum++) {
        if (cancelled) return;
        const canvas = canvasRefs.current.get(pageNum);
        if (!canvas || !pdfDoc) continue;
        const page = await pdfDoc.getPage(pageNum);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const rTask = page.render({ canvasContext: ctx, viewport });
        renderTasks.push(rTask);
        await rTask.promise.catch(() => {});
      }
    }

    renderAll();
    return () => {
      cancelled = true;
      for (const rt of renderTasks) {
        rt.cancel();
      }
    };
  }, [pdfDoc, maxVisiblePage, scale]);

  const scrollToPage = (p: number) => {
    const target = Math.max(1, Math.min(maxVisiblePage, p));
    setActivePage(target);
    const canvas = canvasRefs.current.get(target);
    canvas?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="h-full flex flex-col idp-surface border-r">
      {/* PDF Toolbar */}
      <div className="px-3 py-1.5 border-b idp-muted flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" />
            <span>Đề gốc PDF</span>
          </span>
          {maxVisiblePage > 0 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollToPage(activePage - 1)}
                disabled={activePage <= 1}
                className="p-1 rounded border idp-surface disabled:opacity-40 cursor-pointer"
                title="Trang trước"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="tabular-nums px-1">
                Trang {activePage}/{maxVisiblePage}
              </span>
              <button
                type="button"
                onClick={() => scrollToPage(activePage + 1)}
                disabled={activePage >= maxVisiblePage}
                className="p-1 rounded border idp-surface disabled:opacity-40 cursor-pointer"
                title="Trang sau"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {hasHiddenKeyPages && (
            <label className="flex items-center gap-1 cursor-pointer select-none ml-1">
              <input
                type="checkbox"
                checked={onlyExamPages}
                onChange={(e) => setOnlyExamPages(e.target.checked)}
              />
              <span>Ẩn trang Key ({questionPageRange[1] + 1}–{totalPages})</span>
            </label>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.65, Number((s - 0.15).toFixed(2))))}
            className="p-1 rounded border idp-surface cursor-pointer"
            title="Thu nhỏ"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="tabular-nums w-11 text-center">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(2.2, Number((s + 0.15).toFixed(2))))}
            className="p-1 rounded border idp-surface cursor-pointer"
            title="Phóng to"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setScale(1.25)}
            className="px-2 py-0.5 rounded border idp-surface cursor-pointer"
          >
            Vừa
          </button>
          <button
            type="button"
            onClick={() => setShowNotepad((v) => !v)}
            className={`px-2 py-0.5 rounded border flex items-center gap-1 cursor-pointer ${
              showNotepad ? 'bg-[#1e40af] text-white border-[#1e40af]' : 'idp-surface'
            }`}
          >
            <StickyNote className="w-3.5 h-3.5" />
            <span>Ghi chú</span>
          </button>
        </div>
      </div>

      {/* Optional Notepad Drawer */}
      {showNotepad && (
        <div className="p-2.5 border-b idp-muted shrink-0">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="font-semibold">Ghi chú nháp (tự động lưu theo đề)</span>
            <button
              type="button"
              onClick={() => onNotepadChange('')}
              className="underline opacity-75 hover:opacity-100 cursor-pointer"
            >
              Xóa nháp
            </button>
          </div>
          <textarea
            value={notepadText}
            onChange={(e) => onNotepadChange(e.target.value)}
            rows={4}
            placeholder="Ghi chú từ khóa, bẫy distractor, tên riêng nghe được..."
            className="w-full p-2 text-xs rounded border idp-input resize-y"
          />
        </div>
      )}

      {/* PDF Pages Scroll Area */}
      <div ref={containerRef} className="flex-1 overflow-auto p-4 space-y-4 idp-bg">
        {loading && (
          <div className="text-center py-12 text-sm opacity-75">
            Đang tải đề PDF gốc...
          </div>
        )}
        {errorMsg && (
          <div className="p-4 rounded border border-red-400 bg-red-50 text-red-800 text-xs">
            Lỗi tải PDF: {errorMsg}
          </div>
        )}
        {!loading &&
          !errorMsg &&
          Array.from({ length: maxVisiblePage }, (_, idx) => idx + 1).map((pageNum) => (
            <div key={pageNum} className="flex flex-col items-center">
              <div className="text-[11px] opacity-60 mb-1">Trang {pageNum}</div>
              <canvas
                ref={(el) => {
                  if (el) canvasRefs.current.set(pageNum, el);
                  else canvasRefs.current.delete(pageNum);
                }}
                className="pdf-canvas-filter shadow-sm border border-slate-300 bg-white max-w-none"
              />
            </div>
          ))}
      </div>
    </div>
  );
}
