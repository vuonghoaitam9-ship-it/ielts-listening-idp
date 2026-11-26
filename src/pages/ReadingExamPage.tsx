import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Eye, GripVertical } from 'lucide-react';
import { db } from '../db/database';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  HighlightToolbar,
  type HighlightSelectionRequest,
} from '../components/reading/HighlightToolbar';
import { ReadingHeader } from '../components/reading/ReadingHeader';
import { ReadingPassagePane } from '../components/reading/ReadingPassagePane';
import { ReadingQuestionPalette } from '../components/reading/ReadingQuestionPalette';
import { ReadingQuestionsPane } from '../components/reading/ReadingQuestionsPane';
import { ReadingReviewPane } from '../components/reading/ReadingReviewPane';
import {
  applyHighlight,
  removeHighlight,
  updateHighlightNote,
} from '../lib/highlightEngine';
import {
  loadReadingTestData,
  revokeReadingObjectUrls,
} from '../lib/readingDataLoader';
import { gradeReadingExam } from '../lib/readingGrading';
import type {
  HighlightColor,
  ReadingAttempt,
  ReadingFontSize,
  ReadingQuestionGradeResult,
  ReadingTestData,
  ReadingTheme,
  TextHighlight,
} from '../types/reading';

interface ReadingDraftState {
  mode: 'real' | 'practice';
  answers: Record<number, string>;
  flagged: number[];
  highlights: TextHighlight[];
  notepadText: string;
  activePassage: 1 | 2 | 3;
  startedAt: number;
  secondsRemaining: number;
  secondsElapsed: number;
}

const REAL_MODE_SECONDS = 60 * 60;

export function ReadingExamPage() {
  const { vol, test } = useParams<{ vol: string; test: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const volNum = Number(vol);
  const testNum = Number(test);
  const testId = `vol-${volNum}-test-${testNum}`;
  const draftKey = `ielts_reading_draft_${testId}`;
  const attemptIdParam = searchParams.get('attemptId');
  const requestedMode = searchParams.get('mode') === 'practice' ? 'practice' : 'real';

  const [testData, setTestData] = useState<ReadingTestData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<'real' | 'practice'>(requestedMode);
  const [activePassage, setActivePassage] = useState<1 | 2 | 3>(1);
  const [activeQuestion, setActiveQuestion] = useState<number>(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [highlights, setHighlights] = useState<TextHighlight[]>([]);
  const [notepadText, setNotepadText] = useState('');

  const [fontSize, setFontSize] = useState<ReadingFontSize>('standard');
  const [theme, setTheme] = useState<ReadingTheme>('light');
  const [screenHidden, setScreenHidden] = useState(false);

  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const [secondsRemaining, setSecondsRemaining] = useState<number>(REAL_MODE_SECONDS);
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);

  const [submittedAttempt, setSubmittedAttempt] = useState<ReadingAttempt | null>(null);
  const [activeEvidence, setActiveEvidence] = useState<{
    questionNumber: number;
    passageNumber: 1 | 2 | 3;
    paragraphId: string;
    quote: string;
  } | null>(null);

  const [splitPercent, setSplitPercent] = useState<number>(50);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const [selectionReq, setSelectionReq] = useState<HighlightSelectionRequest | null>(null);
  const [editingHl, setEditingHl] = useState<{
    highlight: TextHighlight;
    rect: { left: number; top: number; bottom: number; width: number };
  } | null>(null);

  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [confirmClearHlOpen, setConfirmClearHlOpen] = useState(false);

  // Load test JSON + optional saved attempt or localStorage draft
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setTestData(null);
    setSubmittedAttempt(null);
    setActiveEvidence(null);

    const run = async () => {
      try {
        const data = await loadReadingTestData(volNum, testNum);
        if (cancelled) return;
        if (!data) {
          setLoadError(`Không tìm thấy dữ liệu Reading cho Vol ${volNum} Test ${testNum}.`);
          return;
        }
        setTestData(data);

        if (attemptIdParam) {
          const savedAttempt = await db.readingAttempts.get(Number(attemptIdParam));
          if (!cancelled && savedAttempt && savedAttempt.testId === testId) {
            setSubmittedAttempt(savedAttempt);
            setAnswers(savedAttempt.answers);
            setFlagged(new Set(savedAttempt.flagged));
            setHighlights(savedAttempt.highlights ?? []);
            setMode(savedAttempt.mode);
            setActivePassage(1);
            setActiveQuestion(1);
            return;
          }
        }

        const rawDraft = localStorage.getItem(draftKey);
        if (rawDraft) {
          try {
            const draft = JSON.parse(rawDraft) as ReadingDraftState;
            setMode(draft.mode ?? requestedMode);
            setAnswers(draft.answers ?? {});
            setFlagged(new Set(draft.flagged ?? []));
            setHighlights(draft.highlights ?? []);
            setNotepadText(draft.notepadText ?? '');
            setActivePassage(draft.activePassage ?? 1);
            setStartedAt(draft.startedAt ?? Date.now());
            setSecondsRemaining(draft.secondsRemaining ?? REAL_MODE_SECONDS);
            setSecondsElapsed(draft.secondsElapsed ?? 0);
            return;
          } catch {
            localStorage.removeItem(draftKey);
          }
        }

        setMode(requestedMode);
        setAnswers({});
        setFlagged(new Set());
        setHighlights([]);
        setNotepadText('');
        setActivePassage(1);
        setActiveQuestion(1);
        setStartedAt(Date.now());
        setSecondsRemaining(REAL_MODE_SECONDS);
        setSecondsElapsed(0);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Lỗi tải đề Reading.');
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      revokeReadingObjectUrls();
    };
  }, [volNum, testNum, testId, draftKey, attemptIdParam, requestedMode]);

  // Persist draft while in exam mode
  useEffect(() => {
    if (!testData || submittedAttempt) return;
    const draft: ReadingDraftState = {
      mode,
      answers,
      flagged: Array.from(flagged),
      highlights,
      notepadText,
      activePassage,
      startedAt,
      secondsRemaining,
      secondsElapsed,
    };
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // Ignore quota exceeded on draft storage
    }
  }, [
    testData,
    submittedAttempt,
    draftKey,
    mode,
    answers,
    flagged,
    highlights,
    notepadText,
    activePassage,
    startedAt,
    secondsRemaining,
    secondsElapsed,
  ]);

  const performSubmit = useCallback(async () => {
    if (!testData || submittedAttempt) return;
    setConfirmSubmitOpen(false);
    setScreenHidden(false);

    const attempt = gradeReadingExam({
      testData,
      answers,
      flagged: Array.from(flagged),
      highlights,
      mode,
      startedAt,
      finishedAt: Date.now(),
    });

    const id = await db.readingAttempts.add(attempt);
    const saved = { ...attempt, id };
    localStorage.removeItem(draftKey);
    setSubmittedAttempt(saved);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('attemptId', String(id));
      return next;
    }, { replace: true });
  }, [
    testData,
    submittedAttempt,
    answers,
    flagged,
    highlights,
    mode,
    startedAt,
    draftKey,
    setSearchParams,
  ]);

  // Countdown / Elapsed timer
  useEffect(() => {
    if (!testData || submittedAttempt) return;
    const timer = window.setInterval(() => {
      if (mode === 'real') {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            window.clearInterval(timer);
            void performSubmit();
            return 0;
          }
          return prev - 1;
        });
      } else {
        setSecondsElapsed((prev) => prev + 1);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [testData, submittedAttempt, mode, performSubmit]);

  // Resizable Split-Screen Drag Handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.max(28, Math.min(72, pct)));
    };
    const onUp = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const currentPassage = useMemo(() => {
    if (!testData) return null;
    return (
      testData.passages.find((p) => p.passageNumber === activePassage) ??
      testData.passages[0] ??
      null
    );
  }, [testData, activePassage]);

  const handleSelectQuestion = (qNum: number, passageNumber: 1 | 2 | 3) => {
    setActiveQuestion(qNum);
    setActivePassage(passageNumber);
    window.setTimeout(() => {
      const el = document.getElementById(`reading-q-${qNum}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 40);
  };

  const handleLocateEvidence = (result: ReadingQuestionGradeResult) => {
    setActiveEvidence({
      questionNumber: result.questionNumber,
      passageNumber: result.passageNumber,
      paragraphId: result.evidenceParagraphId,
      quote: result.evidenceQuote,
    });
    setActivePassage(result.passageNumber);

    window.setTimeout(() => {
      const leftRoot = leftPaneRef.current;
      if (!leftRoot) return;
      const quoteEl = leftRoot.querySelector('[data-evidence-quote="true"]');
      if (quoteEl) {
        quoteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const paraEl = document.getElementById(`reading-para-${result.evidenceParagraphId}`);
      if (paraEl) {
        paraEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
  };

  const handleRetryExam = () => {
    localStorage.removeItem(draftKey);
    setSubmittedAttempt(null);
    setActiveEvidence(null);
    setAnswers({});
    setFlagged(new Set());
    setHighlights([]);
    setActivePassage(1);
    setActiveQuestion(1);
    setStartedAt(Date.now());
    setSecondsRemaining(REAL_MODE_SECONDS);
    setSecondsElapsed(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('attemptId');
      return next;
    }, { replace: true });
  };

  const handleApplyHighlight = (
    req: HighlightSelectionRequest,
    color: HighlightColor,
    note?: string
  ) => {
    setHighlights((prev) =>
      applyHighlight(prev, {
        targetId: req.targetId,
        start: req.start,
        end: req.end,
        color,
        note,
      })
    );
    window.getSelection()?.removeAllRanges();
    setSelectionReq(null);
  };

  const handleUpdateHighlightColor = (id: string, color: HighlightColor) => {
    const target = highlights.find((h) => h.id === id);
    if (!target) return;
    setHighlights((prev) =>
      applyHighlight(prev, {
        id: target.id,
        targetId: target.targetId,
        start: target.start,
        end: target.end,
        color,
        note: target.note,
        createdAt: target.createdAt,
      })
    );
    setEditingHl((cur) =>
      cur && cur.highlight.id === id
        ? { ...cur, highlight: { ...cur.highlight, color } }
        : cur
    );
  };

  const answeredCount = useMemo(() => {
    let cnt = 0;
    for (let q = 1; q <= 40; q++) {
      if ((answers[q] ?? '').trim().length > 0) cnt++;
    }
    return cnt;
  }, [answers]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-300 rounded-md p-6 max-w-md w-full space-y-3">
          <h1 className="text-base font-bold text-slate-900">Không thể mở đề Reading</h1>
          <p className="text-xs text-slate-600">{loadError}</p>
          <button
            type="button"
            onClick={() => navigate('/reading')}
            className="px-3 py-1.5 rounded bg-[#0f2942] text-white text-xs font-semibold cursor-pointer"
          >
            Quay lại danh sách Reading
          </button>
        </div>
      </div>
    );
  }

  if (!testData || !currentPassage) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center text-xs text-slate-600">
        Đang tải đề IELTS Reading Vol {volNum} - Test {testNum}...
      </div>
    );
  }

  const clockDisplay = submittedAttempt
    ? submittedAttempt.durationSec
    : mode === 'real'
    ? secondsRemaining
    : secondsElapsed;

  return (
    <div
      className={`idp-bg idp-theme-${theme} idp-font-${fontSize} h-screen flex flex-col overflow-hidden relative`}
    >
      <ReadingHeader
        vol={testData.vol}
        test={testData.test}
        activePassage={activePassage}
        mode={mode}
        secondsDisplay={clockDisplay}
        fontSize={fontSize}
        theme={theme}
        screenHidden={screenHidden}
        isReviewMode={Boolean(submittedAttempt)}
        highlightCount={highlights.length}
        onExit={() => navigate('/reading')}
        onSelectPassage={(p) => {
          setActivePassage(p);
          const targetP = testData.passages.find((item) => item.passageNumber === p);
          if (targetP) setActiveQuestion(targetP.questionRange[0]);
        }}
        onChangeMode={(nextMode) => {
          setMode(nextMode);
          if (nextMode === 'real' && secondsRemaining <= 0) {
            setSecondsRemaining(REAL_MODE_SECONDS);
          }
        }}
        onChangeFontSize={setFontSize}
        onChangeTheme={setTheme}
        onToggleHide={() => setScreenHidden((v) => !v)}
        onClearHighlights={() => setConfirmClearHlOpen(true)}
        onRequestSubmit={() => setConfirmSubmitOpen(true)}
      />

      {/* Partial Source Notice if key missing in original doc */}
      {testData.missingNote && !submittedAttempt && (
        <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-300 text-amber-950 text-xs flex items-center gap-2 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{testData.missingNote}</span>
        </div>
      )}

      {/* IDP Split-Screen Body */}
      <div
        ref={splitContainerRef}
        className="flex-1 min-h-0 flex flex-col lg:flex-row relative"
      >
        {/* Left Pane: Passage */}
        <div
          ref={leftPaneRef}
          style={{ width: `${splitPercent}%` }}
          className="h-1/2 lg:h-full w-full lg:w-auto min-w-0 idp-surface border-b lg:border-b-0 lg:border-r border-current/20 max-lg:!w-full"
        >
          <ReadingPassagePane
            testData={testData}
            passage={currentPassage}
            highlights={highlights}
            activeEvidence={activeEvidence}
            notepadText={notepadText}
            onNotepadChange={setNotepadText}
            onSelectRange={(req) => {
              setEditingHl(null);
              setSelectionReq(req);
            }}
            onClickHighlight={(hl, rect) => {
              setSelectionReq(null);
              setEditingHl({ highlight: hl, rect });
            }}
          />
        </div>

        {/* Draggable Splitter Bar */}
        <div
          role="separator"
          aria-orientation="vertical"
          title="Kéo sang trái/phải để điều chỉnh độ rộng hai khung"
          onMouseDown={() => {
            isDraggingRef.current = true;
          }}
          className="hidden lg:flex items-center justify-center w-2 shrink-0 bg-slate-200/80 hover:bg-[#1e40af]/30 border-r border-current/15 cursor-col-resize select-none"
        >
          <GripVertical className="w-3 h-3 text-slate-500" />
        </div>

        {/* Right Pane: Questions OR Review Mode */}
        <div ref={rightPaneRef} className="flex-1 min-w-0 h-1/2 lg:h-full idp-surface">
          {submittedAttempt ? (
            <ReadingReviewPane
              attempt={submittedAttempt}
              activeEvidenceQuestion={activeEvidence?.questionNumber ?? null}
              onLocateEvidence={handleLocateEvidence}
              onRetryExam={handleRetryExam}
              onExitToList={() => navigate('/reading')}
            />
          ) : (
            <ReadingQuestionsPane
              passage={currentPassage}
              answers={answers}
              flagged={flagged}
              activeQuestion={activeQuestion}
              highlights={highlights}
              onChangeAnswer={(qNum, val) =>
                setAnswers((prev) => ({ ...prev, [qNum]: val }))
              }
              onToggleFlag={(qNum) =>
                setFlagged((prev) => {
                  const next = new Set(prev);
                  if (next.has(qNum)) next.delete(qNum);
                  else next.add(qNum);
                  return next;
                })
              }
              onFocusQuestion={(qNum) => setActiveQuestion(qNum)}
              onSelectRange={(req) => {
                setEditingHl(null);
                setSelectionReq(req);
              }}
              onClickHighlight={(hl, rect) => {
                setSelectionReq(null);
                setEditingHl({ highlight: hl, rect });
              }}
            />
          )}
        </div>

        {/* IDP Hide Overlay */}
        {screenHidden && (
          <div className="absolute inset-0 z-40 bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="text-lg font-bold">Màn hình thi đang tạm ẩn (Screen Hidden)</div>
            <p className="text-xs text-slate-300 max-w-md leading-relaxed">
              Nội dung bài đọc và câu hỏi đã được che theo chế độ IDP Hide. Đồng hồ vẫn tiếp tục
              chạy. Nhấn nút bên dưới để tiếp tục làm bài.
            </p>
            <button
              type="button"
              onClick={() => setScreenHidden(false)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-white text-[#0f2942] text-xs font-bold cursor-pointer hover:bg-slate-100"
            >
              <Eye className="w-4 h-4" />
              <span>Hiện lại đề thi</span>
            </button>
          </div>
        )}
      </div>

      {/* Bottom 40-Question Palette */}
      {!submittedAttempt && (
        <ReadingQuestionPalette
          passages={testData.passages}
          answers={answers}
          flagged={flagged}
          activePassage={activePassage}
          activeQuestion={activeQuestion}
          onSelectQuestion={handleSelectQuestion}
        />
      )}

      {/* Floating Highlighter + Note Toolbar */}
      <HighlightToolbar
        selection={selectionReq}
        editingHighlight={editingHl}
        onApplyColor={handleApplyHighlight}
        onUpdateColor={handleUpdateHighlightColor}
        onUpdateNote={(id, note) =>
          setHighlights((prev) => updateHighlightNote(prev, id, note))
        }
        onRemoveHighlight={(id) =>
          setHighlights((prev) => removeHighlight(prev, id))
        }
        onClose={() => {
          setSelectionReq(null);
          setEditingHl(null);
        }}
      />

      {/* Submit Dialog */}
      <ConfirmDialog
        open={confirmSubmitOpen}
        title="Nộp bài IELTS Reading"
        message={`Bạn đã điền ${answeredCount}/40 câu${
          flagged.size > 0 ? ` (${flagged.size} câu đang gắn cờ)` : ''
        }. Sau khi nộp, hệ thống sẽ chấm điểm Academic Band và mở chế độ Giải thích chi tiết. Xác nhận nộp bài?`}
        confirmLabel="Nộp bài ngay"
        cancelLabel="Quay lại kiểm tra"
        onConfirm={() => void performSubmit()}
        onCancel={() => setConfirmSubmitOpen(false)}
      />

      {/* Clear Highlights Dialog */}
      <ConfirmDialog
        open={confirmClearHlOpen}
        title="Xóa toàn bộ Highlight & Ghi chú"
        message={`Bạn muốn xóa toàn bộ ${highlights.length} vùng highlight và ghi chú đã đánh dấu trong đề thi này?`}
        confirmLabel="Xóa tất cả"
        cancelLabel="Giữ lại"
        danger
        onConfirm={() => {
          setHighlights([]);
          setSelectionReq(null);
          setEditingHl(null);
          setConfirmClearHlOpen(false);
        }}
        onCancel={() => setConfirmClearHlOpen(false)}
      />
    </div>
  );
}
