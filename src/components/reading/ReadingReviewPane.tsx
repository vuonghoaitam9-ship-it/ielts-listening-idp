import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  Crosshair,
  Flag,
  HelpCircle,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { SaveVocabModal } from '../SaveVocabModal';
import type {
  ReadingAttempt,
  ReadingQuestionGradeResult,
} from '../../types/reading';

interface ReadingReviewPaneProps {
  attempt: ReadingAttempt;
  activeEvidenceQuestion: number | null;
  onLocateEvidence: (result: ReadingQuestionGradeResult) => void;
  onRetryExam: () => void;
  onExitToList: () => void;
}

type ReviewFilter = 'all' | 'wrong' | 'flagged' | 'p1' | 'p2' | 'p3';

function pickInitialWord(r: ReadingQuestionGradeResult): string {
  const ans = r.canonicalAnswer.trim();
  if (ans && !/^(TRUE|FALSE|NOT GIVEN|YES|NO|[A-I]|i+|iv|vi*|ix|x)$/i.test(ans)) {
    return ans.split(',')[0].trim();
  }
  return '';
}

export function ReadingReviewPane({
  attempt,
  activeEvidenceQuestion,
  onLocateEvidence,
  onRetryExam,
  onExitToList,
}: ReadingReviewPaneProps) {
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [vocabModal, setVocabModal] = useState<{ word: string; example: string } | null>(
    null
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const wrongCount = useMemo(
    () => attempt.results.filter((r) => !r.unkeyed && !r.isCorrect).length,
    [attempt.results]
  );
  const flaggedCount = useMemo(
    () => attempt.results.filter((r) => r.flagged).length,
    [attempt.results]
  );

  const filteredResults = useMemo(() => {
    return attempt.results.filter((r) => {
      if (filter === 'wrong') return !r.unkeyed && !r.isCorrect;
      if (filter === 'flagged') return r.flagged;
      if (filter === 'p1') return r.passageNumber === 1;
      if (filter === 'p2') return r.passageNumber === 2;
      if (filter === 'p3') return r.passageNumber === 3;
      return true;
    });
  }, [attempt.results, filter]);

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-4">
      {/* Summary Score + Academic Band + Per-passage breakdown */}
      <section className="idp-surface border border-current/25 rounded-md p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider opacity-70 font-semibold">
                Điểm Reading
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {attempt.score} / {attempt.keyedTotal}
              </div>
            </div>

            <div className="px-3 py-1.5 rounded bg-[#0f2942] text-white text-center">
              <div className="text-[10px] uppercase tracking-wider opacity-80">
                Academic Band
              </div>
              <div className="text-lg font-bold font-mono tabular-nums">
                {attempt.band.toFixed(1)}
              </div>
            </div>

            <div className="text-xs opacity-80 space-y-0.5">
              <div>
                Thời gian làm: <strong>{Math.floor(attempt.durationSec / 60)}p {attempt.durationSec % 60}s</strong>
              </div>
              <div>
                Chế độ: <strong>{attempt.mode === 'real' ? 'Thi thật (60p)' : 'Tự do'}</strong>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRetryExam}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#0f2942] hover:bg-[#1e3a8a] text-white text-xs font-semibold cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Làm lại đề</span>
            </button>
            <button
              type="button"
              onClick={onExitToList}
              className="px-3 py-1.5 rounded border border-current/25 text-xs font-medium cursor-pointer"
            >
              Danh sách đề
            </button>
          </div>
        </div>

        {/* Per-passage breakdown */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-current/15 text-xs">
          {attempt.passageStats.map((ps) => (
            <div
              key={ps.passageNumber}
              className="idp-muted border border-current/15 rounded px-2.5 py-1.5"
            >
              <div className="font-semibold truncate">
                P{ps.passageNumber}: {ps.correct}/{ps.keyedTotal}
              </div>
              <div className="text-[11px] opacity-75 truncate">{ps.title}</div>
            </div>
          ))}
        </div>

        {attempt.keyedTotal < 40 && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded border border-amber-400/70 bg-amber-50/70 text-amber-950 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Đề này hiện có {attempt.keyedTotal}/40 câu có đáp án trong tài liệu gốc; các câu
              chưa có Key được đánh dấu rõ và không tính vào mẫu số điểm.
            </span>
          </div>
        )}
      </section>

      {toastMsg && (
        <div className="px-3 py-2 rounded bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-medium">
          {toastMsg}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {(
          [
            ['all', `Tất cả (${attempt.results.length})`],
            ['wrong', `Chỉ câu sai (${wrongCount})`],
            ['flagged', `Đã gắn cờ (${flaggedCount})`],
            ['p1', 'Passage 1'],
            ['p2', 'Passage 2'],
            ['p3', 'Passage 3'],
          ] as [ReviewFilter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-2.5 py-1 rounded border font-medium cursor-pointer ${
              filter === key
                ? 'bg-[#0f2942] text-white border-[#0f2942]'
                : 'idp-surface border-current/25 opacity-85 hover:opacity-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 4-Line Review Cards */}
      {filteredResults.length === 0 ? (
        <div className="idp-muted border border-current/20 rounded-md p-6 text-center text-xs opacity-80">
          Không có câu nào khớp bộ lọc hiện tại.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredResults.map((r) => {
            const isLocated = activeEvidenceQuestion === r.questionNumber;

            return (
              <article
                key={r.questionNumber}
                className={`idp-surface border rounded-md p-3.5 space-y-2 text-xs ${
                  isLocated
                    ? 'border-emerald-600 ring-2 ring-emerald-500/40'
                    : r.unkeyed
                    ? 'border-amber-300'
                    : r.isCorrect
                    ? 'border-current/20'
                    : 'border-red-400/70'
                }`}
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-current/15">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-[#0f2942] text-white">
                      Câu {r.questionNumber}
                    </span>
                    <span className="opacity-75 font-medium">Passage {r.passageNumber}</span>
                    {r.flagged && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-medium">
                        <Flag className="w-3 h-3" /> Đã gắn cờ
                      </span>
                    )}
                  </div>

                  <div>
                    {r.unkeyed ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                        <HelpCircle className="w-3.5 h-3.5" /> Chưa có Key gốc
                      </span>
                    ) : r.isCorrect ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Chính xác
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-900 font-semibold">
                        <XCircle className="w-3.5 h-3.5" /> Sai
                      </span>
                    )}
                  </div>
                </div>

                {/* Line 1: Your Answer vs Standard Answer + Locate Button */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      Bạn điền:{' '}
                      <strong className={r.isCorrect || r.unkeyed ? '' : 'text-red-600 line-through'}>
                        {r.userAnswer || '(Bỏ trống)'}
                      </strong>
                    </span>
                    <span>
                      Đáp án chuẩn:{' '}
                      <strong className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        {r.unkeyed ? '(Thiếu trong nguồn)' : r.canonicalAnswer}
                      </strong>
                    </span>
                  </div>

                  {r.evidenceParagraphId && (
                    <button
                      type="button"
                      onClick={() => onLocateEvidence(r)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-semibold cursor-pointer ${
                        isLocated
                          ? 'bg-emerald-600 text-white border-emerald-700'
                          : 'bg-[#0f2942] text-white border-[#0f2942] hover:bg-[#1e3a8a]'
                      }`}
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      <span>
                        Định vị đoạn văn{r.evidenceLocation ? ` (${r.evidenceLocation})` : ''}
                      </span>
                    </button>
                  )}
                </div>

                {/* Line 2: Verbatim English Evidence Quote + Save to Flashcard */}
                {r.evidenceQuote && (
                  <div className="flex items-start justify-between gap-2 p-2 rounded idp-muted border border-current/15">
                    <div className="leading-relaxed">
                      <span className="font-semibold">Bằng chứng: </span>
                      <span className="italic">“{r.evidenceQuote}”</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setVocabModal({
                          word: pickInitialWord(r),
                          example: r.evidenceQuote,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-current/25 bg-white text-slate-900 hover:bg-slate-100 text-[11px] font-semibold shrink-0 cursor-pointer"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5 text-[#1e40af]" />
                      <span>Lưu Flashcard</span>
                    </button>
                  </div>
                )}

                {/* Line 3: Vietnamese Translation of Evidence */}
                {r.evidenceTranslationVi && (
                  <div className="leading-relaxed">
                    <span className="font-semibold">Dịch nghĩa: </span>
                    <span className="opacity-90">{r.evidenceTranslationVi}</span>
                  </div>
                )}

                {/* Line 4: Concise Vietnamese Explanation */}
                {r.explanationVi && (
                  <div className="leading-relaxed">
                    <span className="font-semibold">Giải thích: </span>
                    <span className="opacity-90">{r.explanationVi}</span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {vocabModal && (
        <SaveVocabModal
          initialWord={vocabModal.word}
          initialExample={vocabModal.example}
          sourceTestId={`reading:${attempt.testId}`}
          onClose={() => setVocabModal(null)}
          onSaved={(w) => {
            setToastMsg(`Đã lưu "${w}" vào Flashcard SM-2.`);
            setTimeout(() => setToastMsg(null), 3000);
          }}
        />
      )}
    </div>
  );
}
