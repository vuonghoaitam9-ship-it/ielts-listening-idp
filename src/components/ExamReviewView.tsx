import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FilePlus2,
  Flag,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { db } from '../db/database';
import { useSegmentAudio } from '../hooks/useSegmentAudio';
import { buildFilledListeningQuestion } from '../lib/filledQuestion';
import { buildLongSegmentsFromShort, formatSecondsClock } from '../lib/subtitleParser';
import { FilledQuestionBox } from './FilledQuestionBox';
import { SaveVocabModal } from './SaveVocabModal';
import { TimestampEditorModal } from './TimestampEditorModal';
import type { ExamAttempt, QuestionItem, TestData, TranscriptSegment } from '../types';

interface ExamReviewViewProps {
  testData: TestData;
  attempt: ExamAttempt;
  onRetryExam: () => void;
  onGoDictation: () => void;
  onTestDataUpdated?: (updated: TestData) => void;
}

type FilterMode = 'all' | 'wrong' | 'correct' | 'flagged' | 'p1' | 'p2' | 'p3' | 'p4';

const DISTRACTOR_TOKEN_RE =
  /\b(actually|sorry|however|instead|rather than|used to|originally|initially|no longer|afraid|but)\b/gi;

function buildAnswerHighlightPatterns(q: QuestionItem): string[] {
  const candidates = new Set<string>();
  const add = (val: string) => {
    const clean = val.trim();
    if (clean.length >= 2 && !/^[A-I]$/i.test(clean)) {
      candidates.add(clean);
    }
  };
  add(q.canonicalAnswer);
  for (const acc of q.acceptedAnswers) add(acc);
  return Array.from(candidates).sort((a, b) => b.length - a.length);
}

function renderAnnotatedTranscript(text: string, q: QuestionItem): React.ReactNode {
  if (!text) return null;
  const ansTerms = buildAnswerHighlightPatterns(q);
  const ansPart = ansTerms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const combinedSource = ansPart
    ? `(${ansPart})|(${DISTRACTOR_TOKEN_RE.source})`
    : `(${DISTRACTOR_TOKEN_RE.source})`;
  const combinedRe = new RegExp(combinedSource, 'gi');

  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = combinedRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(<span key={keyIdx++}>{text.slice(lastIdx, match.index)}</span>);
    }
    const matchedStr = match[0];
    const isAnswer =
      ansPart.length > 0 &&
      ansTerms.some((t) => t.toLowerCase() === matchedStr.toLowerCase());

    if (isAnswer) {
      nodes.push(
        <mark
          key={keyIdx++}
          className="bg-amber-200 text-slate-900 px-1 rounded font-semibold"
          title="Cụm từ chứa đáp án chuẩn"
        >
          {matchedStr}
        </mark>
      );
    } else {
      nodes.push(
        <span
          key={keyIdx++}
          className="underline decoration-red-500 decoration-2 underline-offset-2 text-red-900 bg-red-50 px-0.5 rounded"
          title="Dấu hiệu bẫy gây nhiễu (distractor)"
        >
          {matchedStr}
        </span>
      );
    }
    lastIdx = match.index + matchedStr.length;
  }

  if (lastIdx < text.length) {
    nodes.push(<span key={keyIdx++}>{text.slice(lastIdx)}</span>);
  }
  return nodes;
}

function resolveQuestionBounds(
  q: QuestionItem,
  testData: TestData
): { start: number; end: number; isEstimated: boolean } {
  const dur = Math.max(testData.audioDurationSec || 1800, 60);
  const hasValidRange =
    Number.isFinite(q.evidenceStartTime) &&
    Number.isFinite(q.evidenceEndTime) &&
    q.evidenceEndTime > q.evidenceStartTime + 0.2;

  if (hasValidRange) {
    const padBefore = q.timestampEdited ? 0 : testData.hasExactTimestamps ? 0.2 : 0.5;
    const padAfter = q.timestampEdited ? 0 : testData.hasExactTimestamps ? 0.25 : 0.6;
    const start = Math.max(0, Number((q.evidenceStartTime - padBefore).toFixed(2)));
    const end = Math.min(dur, Number((q.evidenceEndTime + padAfter).toFixed(2)));
    return {
      start,
      end: Math.max(start + 0.5, end),
      isEstimated: !testData.hasExactTimestamps && !q.timestampEdited,
    };
  }

  // Fallback estimate based on question position within its Part
  const partMeta = testData.parts.find((p) => p.partNumber === q.part);
  const pStart = partMeta?.startTime ?? ((q.part - 1) * dur) / 4;
  const pEnd = partMeta?.endTime ?? (q.part * dur) / 4;
  const posInPart = (q.number - 1) % 10;
  const span = Math.max(30, pEnd - pStart);
  const estCenter = pStart + ((posInPart + 0.5) / 10) * span;
  const estStart = Math.max(0, Number((estCenter - 6).toFixed(2)));
  const estEnd = Math.min(dur, Number((estCenter + 7).toFixed(2)));
  return {
    start: estStart,
    end: Math.max(estStart + 2, estEnd),
    isEstimated: true,
  };
}

function findTranscriptContext(
  q: QuestionItem,
  segments: TranscriptSegment[]
): {
  prev: TranscriptSegment | null;
  current: TranscriptSegment | null;
  next: TranscriptSegment | null;
  partSegments: TranscriptSegment[];
} {
  const partSegments = segments.filter((s) => s.part === q.part);
  const pool = partSegments.length > 0 ? partSegments : segments;
  if (pool.length === 0) {
    return { prev: null, current: null, next: null, partSegments: [] };
  }

  const quoteNorm = q.evidenceQuote.trim().toLowerCase();
  const hasBounds =
    Number.isFinite(q.evidenceStartTime) &&
    Number.isFinite(q.evidenceEndTime) &&
    q.evidenceEndTime > q.evidenceStartTime;
  const mid = hasBounds ? (q.evidenceStartTime + q.evidenceEndTime) / 2 : 0;
  let matchIdx = -1;

  if (quoteNorm.length >= 10 || hasBounds) {
    let bestScore = -Infinity;
    pool.forEach((s, i) => {
      const sNorm = s.text.trim().toLowerCase();
      let sc = 0;
      if (quoteNorm.length >= 10 && sNorm.length > 0) {
        if (sNorm === quoteNorm) {
          sc += 100;
        } else if (
          sNorm.length >= 15 &&
          (quoteNorm.includes(sNorm) ||
            sNorm.includes(quoteNorm.slice(0, Math.min(40, quoteNorm.length))))
        ) {
          sc += 65;
        } else if (quoteNorm.includes(sNorm)) {
          sc += 15;
        }
      }
      if (hasBounds) {
        const sMid = (s.startTime + s.endTime) / 2;
        const dist = Math.abs(sMid - mid);
        sc += Math.max(0, 40 - dist * 0.8);
      }
      if (sc > bestScore) {
        bestScore = sc;
        matchIdx = i;
      }
    });
  }

  if (matchIdx === -1) {
    const posInPart = (q.number - 1) % 10;
    matchIdx = Math.min(pool.length - 1, Math.floor((posInPart / 10) * pool.length));
  }

  return {
    prev: matchIdx > 0 ? pool[matchIdx - 1] : null,
    current: pool[matchIdx] ?? null,
    next: matchIdx + 1 < pool.length ? pool[matchIdx + 1] : null,
    partSegments: pool,
  };
}

export function ExamReviewView({
  testData,
  attempt,
  onRetryExam,
  onGoDictation,
  onTestDataUpdated,
}: ExamReviewViewProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [reviewRate, setReviewRate] = useState<0.75 | 1.0>(1.0);
  const [expandedPartByQ, setExpandedPartByQ] = useState<Record<number, boolean>>({});
  const [editingBoundsQ, setEditingBoundsQ] = useState<number | null>(null);
  const [draftStart, setDraftStart] = useState<number>(0);
  const [draftEnd, setDraftEnd] = useState<number>(0);
  const [showTsModal, setShowTsModal] = useState(false);

  const [vocabModal, setVocabModal] = useState<{ word: string; example: string } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const segAudio = useSegmentAudio(testData.audioUrl, testData.audioDurationSec);

  const wrongCount = useMemo(
    () => attempt.results.filter((r) => !r.isCorrect).length,
    [attempt.results]
  );
  const correctCount = attempt.results.length - wrongCount;
  const flaggedCount = useMemo(
    () => attempt.results.filter((r) => r.flagged).length,
    [attempt.results]
  );

  const questionMap = useMemo(() => {
    const m = new Map<number, QuestionItem>();
    for (const q of testData.questions) m.set(q.number, q);
    return m;
  }, [testData.questions]);

  const filteredResults = useMemo(() => {
    return attempt.results.filter((r) => {
      if (filter === 'wrong') return !r.isCorrect;
      if (filter === 'correct') return r.isCorrect;
      if (filter === 'flagged') return r.flagged;
      if (filter === 'p1') return r.part === 1;
      if (filter === 'p2') return r.part === 2;
      if (filter === 'p3') return r.part === 3;
      if (filter === 'p4') return r.part === 4;
      return true;
    });
  }, [attempt.results, filter]);

  const handleSpeedSelect = (r: 0.75 | 1.0) => {
    setReviewRate(r);
    segAudio.setRate(r);
  };

  const handleTogglePlayQuestion = (q: QuestionItem, bounds: { start: number; end: number }) => {
    const clipId = `q-${q.number}`;
    if (segAudio.activeId === clipId && segAudio.isPlaying) {
      segAudio.pause();
      return;
    }
    if (
      segAudio.activeId === clipId &&
      !segAudio.isPlaying &&
      segAudio.progressPct > 0 &&
      segAudio.progressPct < 98
    ) {
      segAudio.resume();
      return;
    }
    segAudio.playSegment({
      id: clipId,
      startTime: bounds.start,
      endTime: bounds.end,
      rate: reviewRate,
      loop: false,
      padBefore: 0,
      padAfter: 0,
    });
  };

  const handleReplayQuestion = (q: QuestionItem, bounds: { start: number; end: number }) => {
    segAudio.playSegment({
      id: `q-${q.number}`,
      startTime: bounds.start,
      endTime: bounds.end,
      rate: reviewRate,
      loop: false,
      padBefore: 0,
      padAfter: 0,
    });
  };

  const handleSaveQuestionBounds = async (q: QuestionItem) => {
    const safeStart = Math.max(0, Number(draftStart.toFixed(2)));
    const safeEnd = Math.max(safeStart + 0.5, Number(draftEnd.toFixed(2)));

    const updatedQuestions = testData.questions.map((item) =>
      item.number === q.number
        ? {
            ...item,
            evidenceStartTime: safeStart,
            evidenceEndTime: safeEnd,
            timestampEdited: true,
          }
        : item
    );
    const updatedTestData: TestData = {
      ...testData,
      questions: updatedQuestions,
    };

    const existingOverride = await db.localOverrides.get(testData.id);
    await db.localOverrides.put({
      ...(existingOverride ?? {
        testId: testData.id,
        vol: testData.vol,
        testNumber: testData.testNumber,
        title: testData.title,
      }),
      customJson: {
        ...(existingOverride?.customJson ?? {}),
        questions: updatedQuestions,
      },
      updatedAt: Date.now(),
    });

    onTestDataUpdated?.(updatedTestData);
    setEditingBoundsQ(null);
    setToastMsg(`Đã lưu mốc giờ mới cho Câu ${q.number} (${formatSecondsClock(safeStart)}–${formatSecondsClock(safeEnd)}).`);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleApplyTranscriptModal = (newSegs: TranscriptSegment[]) => {
    const updated: TestData = {
      ...testData,
      transcriptSegments: newSegs,
      longSegments: buildLongSegmentsFromShort(newSegs),
      hasExactTimestamps: true,
      timestampNote: 'Đang dùng mốc thời gian tùy chỉnh (IndexedDB).',
    };
    onTestDataUpdated?.(updated);
    setToastMsg('Đã cập nhật Transcript & mốc thời gian mới.');
    setTimeout(() => setToastMsg(null), 3000);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Single Audio Controller element for the entire Review screen */}
      <audio ref={segAudio.audioRef} src={testData.audioUrl} preload="metadata" />

      {toastMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#0f2942] text-white px-4 py-2 rounded text-xs font-medium shadow-md">
          {toastMsg}
        </div>
      )}

      {/* Score Summary Card */}
      <section className="bg-white border border-slate-300 rounded-md p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Kết quả chấm tự động · {testData.title}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-4">
              <div className="text-3xl font-bold text-slate-900 tabular-nums">
                {attempt.score} / {attempt.total}
              </div>
              <div className="px-3 py-1 rounded bg-[#0f2942] text-white text-sm font-semibold tabular-nums">
                Band IELTS Listening: {attempt.band.toFixed(1)}
              </div>
              <span className="text-xs text-slate-600 tabular-nums">
                Thời gian làm: {formatSecondsClock(attempt.durationUsedSec)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRetryExam}
              className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Làm lại bài thi</span>
            </button>
            <button
              type="button"
              onClick={onGoDictation}
              className="px-3 py-1.5 rounded bg-[#1e40af] hover:bg-[#1e3a8a] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Headphones className="w-3.5 h-3.5" />
              <span>Luyện Dictation bài này</span>
            </button>
          </div>
        </div>

        {/* Part breakdown */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-200">
          {([1, 2, 3, 4] as const).map((p) => (
            <div key={p} className="p-2.5 rounded bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Part {p}</div>
              <div className="text-base font-bold text-slate-900 tabular-nums">
                {attempt.partScores[p]} / 10
              </div>
            </div>
          ))}
        </div>

        {!testData.hasExactTimestamps && (
          <div className="mt-3 p-2.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{testData.timestampNote}</span>
          </div>
        )}
      </section>

      {/* Filter Bar + Global Review Speed */}
      <div className="bg-white border border-slate-300 rounded-md p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded border font-semibold cursor-pointer ${
              filter === 'all'
                ? 'bg-[#0f2942] text-white border-[#0f2942]'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Tất cả câu ({attempt.results.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('wrong')}
            className={`px-3 py-1.5 rounded border font-semibold cursor-pointer ${
              filter === 'wrong'
                ? 'bg-red-700 text-white border-red-700'
                : 'bg-red-50 text-red-900 border-red-300 hover:bg-red-100'
            }`}
          >
            Chỉ các câu làm sai ({wrongCount})
          </button>

          <span className="mx-1 text-slate-300">|</span>

          {(
            [
              ['correct', `Câu đúng (${correctCount})`],
              ['flagged', `Gắn cờ (${flaggedCount})`],
              ['p1', 'Part 1'],
              ['p2', 'Part 2'],
              ['p3', 'Part 3'],
              ['p4', 'Part 4'],
            ] as [FilterMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilter(mode)}
              className={`px-2.5 py-1 rounded border font-medium cursor-pointer ${
                filter === mode
                  ? 'bg-[#0f2942] text-white border-[#0f2942]'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-600">Tốc độ nghe lại:</span>
          {([0.75, 1.0] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleSpeedSelect(r)}
              className={`px-2.5 py-1 rounded border font-mono font-medium cursor-pointer ${
                reviewRate === r
                  ? 'bg-[#1e40af] text-white border-[#1e40af]'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>

      {segAudio.error && (
        <div className="p-3 rounded bg-red-50 border border-red-300 text-xs text-red-800">
          {segAudio.error}
        </div>
      )}

      {filteredResults.length === 0 && (
        <div className="bg-white border border-slate-300 rounded-md p-6 text-center text-xs text-slate-600">
          Không có câu nào khớp bộ lọc hiện tại.
        </div>
      )}

      {/* Detailed breakdown cards */}
      <div className="space-y-4">
        {filteredResults.map((res) => {
          const q = questionMap.get(res.questionNumber);
          if (!q) return null;

          const bounds = resolveQuestionBounds(q, testData);
          const clipId = `q-${q.number}`;
          const isThisActive = segAudio.activeId === clipId;
          const isThisPlaying = isThisActive && segAudio.isPlaying;
          const ctx = findTranscriptContext(q, testData.transcriptSegments);
          const isPartExpanded = Boolean(expandedPartByQ[q.number]);
          const targetTranscriptText = ctx.current?.text || q.evidenceQuote;

          return (
            <article
              key={q.number}
              className={`bg-white border rounded-md p-4 space-y-3 ${
                res.isCorrect ? 'border-slate-300' : 'border-red-300'
              }`}
            >
              {/* Card Header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1 font-mono text-sm font-bold text-slate-900">
                    {res.isCorrect ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600" />
                    )}
                    <span>Câu {q.number}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium">
                    Part {q.part}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      res.isCorrect
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {res.isCorrect ? 'Đúng' : res.userAnswer ? 'Sai' : 'Bỏ trống'}
                  </span>
                  {res.flagged && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-medium">
                      <Flag className="w-3 h-3" /> Đã gắn cờ
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setVocabModal({
                      word: q.canonicalAnswer.length > 2 ? q.canonicalAnswer : '',
                      example: targetTranscriptText,
                    })
                  }
                  className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium flex items-center gap-1 cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Lưu từ vựng</span>
                </button>
              </div>

              {/* 0. Original Question With Standard Answer Filled */}
              <FilledQuestionBox
                filled={buildFilledListeningQuestion(q, questionMap)}
                variant="light"
              />

              {/* 1. Answer Comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block mb-0.5">Đáp án bạn nhập:</span>
                  <span
                    className={`font-semibold text-sm ${
                      res.isCorrect ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {res.userAnswer || '(Bỏ trống)'}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-emerald-50/60 border border-emerald-200">
                  <span className="text-slate-600 block mb-0.5">Đáp án chuẩn:</span>
                  <span className="font-semibold text-sm text-emerald-900">
                    {q.answerRaw}
                  </span>
                  {q.acceptedAnswers.length > 1 && (
                    <span className="block text-[11px] text-slate-600 mt-0.5">
                      Biến thể hợp lệ: {q.acceptedAnswers.join(' | ')}
                    </span>
                  )}
                </div>
              </div>

              {/* 2. Per-Question Mini Audio Player */}
              <div className="p-3 rounded border border-slate-300 bg-slate-50 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handleTogglePlayQuestion(q, bounds)}
                    className={`px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 cursor-pointer ${
                      isThisPlaying
                        ? 'bg-red-700 hover:bg-red-600 text-white'
                        : 'bg-[#0f2942] hover:bg-[#1e3a8a] text-white'
                    }`}
                  >
                    {isThisPlaying ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isThisPlaying
                        ? 'Tạm dừng'
                        : isThisActive && segAudio.progressPct > 0
                        ? 'Tiếp tục đoạn câu này'
                        : 'Nghe lại đoạn câu này'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReplayQuestion(q, bounds)}
                    className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 font-medium flex items-center gap-1 cursor-pointer"
                    title="Phát lại từ đầu đoạn"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Phát lại</span>
                  </button>

                  <div className="flex items-center rounded border border-slate-300 overflow-hidden bg-white">
                    {([0.75, 1.0] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleSpeedSelect(r)}
                        className={`px-2 py-1 font-mono text-[11px] cursor-pointer ${
                          reviewRate === r
                            ? 'bg-[#1e40af] text-white font-semibold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {r}x
                      </button>
                    ))}
                  </div>

                  <span className="font-mono text-[11px] text-slate-600 tabular-nums ml-auto">
                    {formatSecondsClock(bounds.start)} → {formatSecondsClock(bounds.end)}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      if (editingBoundsQ === q.number) {
                        setEditingBoundsQ(null);
                      } else {
                        setEditingBoundsQ(q.number);
                        setDraftStart(bounds.start);
                        setDraftEnd(bounds.end);
                      }
                    }}
                    className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Clock className="w-3 h-3" />
                    <span>Chỉnh mốc giờ</span>
                  </button>
                </div>

                {/* Mini Timeline Scrubber */}
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-600 tabular-nums">
                  <span>
                    {formatSecondsClock(
                      isThisActive
                        ? Math.max(bounds.start, segAudio.currentTime)
                        : bounds.start
                    )}
                  </span>
                  <input
                    type="range"
                    min={bounds.start}
                    max={Math.max(bounds.start + 0.5, bounds.end)}
                    step={0.1}
                    value={
                      isThisActive
                        ? Math.min(bounds.end, Math.max(bounds.start, segAudio.currentTime))
                        : bounds.start
                    }
                    onChange={(e) => {
                      const sec = Number(e.target.value);
                      if (!isThisActive) {
                        segAudio.playSegment({
                          id: clipId,
                          startTime: sec,
                          endTime: bounds.end,
                          rate: reviewRate,
                          loop: false,
                        });
                      } else {
                        segAudio.seekTo(sec);
                      }
                    }}
                    aria-label={`Thanh tua đoạn câu ${q.number}`}
                    className="flex-1 accent-[#1e40af] cursor-pointer"
                  />
                  <span>{formatSecondsClock(bounds.end)}</span>
                </div>

                {bounds.isEstimated && (
                  <div className="text-[11px] text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Chưa có mốc thời gian chính xác cho câu này (đang phát theo vị trí ước lượng trong Part {q.part}).
                    </span>
                  </div>
                )}

                {editingBoundsQ === q.number && (
                  <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">
                      <span>Start (giây):</span>
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        value={draftStart}
                        onChange={(e) => setDraftStart(Number(e.target.value))}
                        className="w-20 px-2 py-1 rounded border border-slate-300 bg-white font-mono tabular-nums"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      <span>End (giây):</span>
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        value={draftEnd}
                        onChange={(e) => setDraftEnd(Number(e.target.value))}
                        className="w-20 px-2 py-1 rounded border border-slate-300 bg-white font-mono tabular-nums"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleSaveQuestionBounds(q)}
                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>Lưu mốc</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 3. Contextual Transcript Block directly below Mini Player */}
              <div
                className={`p-3 rounded border text-xs space-y-2 transition-colors ${
                  isThisPlaying
                    ? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-400'
                    : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">
                    Transcript đoạn câu {q.number}
                    {isThisPlaying && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px]">
                        Đang phát
                      </span>
                    )}
                  </span>

                  {ctx.partSegments.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedPartByQ((prev) => ({
                          ...prev,
                          [q.number]: !prev[q.number],
                        }))
                      }
                      className="text-[#1e40af] hover:underline font-medium flex items-center gap-1 cursor-pointer"
                    >
                      {isPartExpanded ? (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" />
                          <span>Thu gọn Transcript Part {q.part}</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>Xem toàn bộ Transcript Part {q.part}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {!targetTranscriptText ? (
                  <div className="p-2.5 rounded bg-white border border-slate-200 space-y-2">
                    <div className="text-slate-600">Chưa có transcript cho đoạn này.</div>
                    <button
                      type="button"
                      onClick={() => setShowTsModal(true)}
                      className="px-2.5 py-1 rounded bg-[#0f2942] text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                    >
                      <FilePlus2 className="w-3.5 h-3.5" />
                      <span>Tải / Dán nhanh Transcript</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5 leading-relaxed">
                    {ctx.prev && (
                      <p className="text-slate-500">
                        {ctx.prev.text}
                      </p>
                    )}
                    <p
                      className={`p-2 rounded border text-slate-900 ${
                        isThisPlaying
                          ? 'bg-white border-emerald-400'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      {renderAnnotatedTranscript(targetTranscriptText, q)}
                    </p>
                    {ctx.next && (
                      <p className="text-slate-500">
                        {ctx.next.text}
                      </p>
                    )}
                  </div>
                )}

                {isPartExpanded && ctx.partSegments.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-200 max-h-60 overflow-auto space-y-1">
                    {ctx.partSegments.map((seg) => {
                      const isTargetSeg = ctx.current?.id === seg.id;
                      const isSegPlayingNow =
                        segAudio.isPlaying &&
                        segAudio.currentTime >= seg.startTime - 0.1 &&
                        segAudio.currentTime <= seg.endTime + 0.1 &&
                        isThisActive;

                      return (
                        <button
                          key={seg.id}
                          type="button"
                          onClick={() =>
                            segAudio.playSegment({
                              id: clipId,
                              startTime: seg.startTime,
                              endTime: seg.endTime,
                              rate: reviewRate,
                              loop: false,
                            })
                          }
                          className={`w-full text-left px-2 py-1.5 rounded border text-xs flex items-start gap-2 cursor-pointer ${
                            isSegPlayingNow
                              ? 'bg-emerald-100 border-emerald-500 text-slate-900 font-medium'
                              : isTargetSeg
                              ? 'bg-amber-50 border-amber-300 text-slate-900'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                            {formatSecondsClock(seg.startTime)}
                          </span>
                          <span>{seg.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 4. Vietnamese Explanation directly below Transcript */}
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <div>
                    <span className="font-semibold text-slate-800">Giải thích: </span>
                    <span className="text-slate-700">{q.explanationVi}</span>
                  </div>

                  {q.paraphrases.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-700">Paraphrase:</span>
                      {q.paraphrases.map((p, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-900"
                        >
                          {p.questionTerm} → {p.audioTerm}
                        </span>
                      ))}
                    </div>
                  )}

                  {q.distractors.length > 0 && (
                    <div className="text-amber-900 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                      <span className="font-semibold">Bẫy gây nhiễu (Distractor): </span>
                      <span>{q.distractors.join(' ')}</span>
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {vocabModal && (
        <SaveVocabModal
          initialWord={vocabModal.word}
          initialExample={vocabModal.example}
          sourceTestId={testData.id}
          onClose={() => setVocabModal(null)}
          onSaved={(w) => {
            setToastMsg(`Đã lưu "${w}" vào Flashcard SM-2.`);
            setTimeout(() => setToastMsg(null), 3000);
          }}
        />
      )}

      {showTsModal && (
        <TimestampEditorModal
          testId={testData.id}
          audioUrl={testData.audioUrl}
          audioDurationSec={testData.audioDurationSec}
          initialSegments={testData.transcriptSegments}
          onClose={() => setShowTsModal(false)}
          onApplied={handleApplyTranscriptModal}
        />
      )}
    </div>
  );
}
