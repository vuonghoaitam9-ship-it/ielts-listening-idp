import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  Flag,
  Headphones,
  Play,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react';
import { formatSecondsClock } from '../lib/subtitleParser';
import { SaveVocabModal } from './SaveVocabModal';
import type { ExamAttempt, QuestionItem, TestData } from '../types';

interface ExamReviewViewProps {
  testData: TestData;
  attempt: ExamAttempt;
  onRetryExam: () => void;
  onGoDictation: () => void;
}

type FilterMode = 'all' | 'wrong' | 'correct' | 'flagged' | 'p1' | 'p2' | 'p3' | 'p4';

function highlightEvidence(quote: string, answer: string): React.ReactNode {
  if (!quote) return '(Chưa có trích dẫn transcript)';
  const cleanAns = answer.trim();
  if (!cleanAns || cleanAns.length < 2) return quote;
  const escaped = cleanAns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  const parts = quote.split(re);
  if (parts.length === 1) return quote;
  return parts.map((chunk, idx) =>
    idx % 2 === 1 ? (
      <mark key={idx} className="bg-amber-200 text-slate-900 px-0.5 rounded font-semibold">
        {chunk}
      </mark>
    ) : (
      <span key={idx}>{chunk}</span>
    )
  );
}

export function ExamReviewView({
  testData,
  attempt,
  onRetryExam,
  onGoDictation,
}: ExamReviewViewProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [playingQ, setPlayingQ] = useState<number | null>(null);
  const [vocabModal, setVocabModal] = useState<{ word: string; example: string } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopBoundaryRef = useRef<number>(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      if (playingQ !== null && stopBoundaryRef.current > 0 && audio.currentTime >= stopBoundaryRef.current) {
        audio.pause();
        setPlayingQ(null);
      }
    };
    const onEnded = () => setPlayingQ(null);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [playingQ]);

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

  const handlePlayEvidence = (q: QuestionItem) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingQ === q.number) {
      audio.pause();
      setPlayingQ(null);
      return;
    }
    const startSec = Math.max(0, q.evidenceStartTime - 1);
    const endSec = Math.min(testData.audioDurationSec || q.evidenceEndTime + 2, q.evidenceEndTime + 1.5);
    stopBoundaryRef.current = endSec;
    audio.currentTime = startSec;
    setPlayingQ(q.number);
    audio.play().catch(() => {
      setPlayingQ(null);
    });
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <audio ref={audioRef} src={testData.audioUrl} preload="metadata" />

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

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              ['all', `Tất cả (${attempt.results.length})`],
              ['wrong', `Câu sai (${attempt.results.filter((r) => !r.isCorrect).length})`],
              ['correct', `Câu đúng (${attempt.results.filter((r) => r.isCorrect).length})`],
              ['flagged', `Gắn cờ (${attempt.results.filter((r) => r.flagged).length})`],
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
      </div>

      {/* Detailed 40-question breakdown */}
      <div className="space-y-3">
        {filteredResults.map((res) => {
          const q = questionMap.get(res.questionNumber);
          if (!q) return null;
          const isThisPlaying = playingQ === q.number;

          return (
            <article
              key={q.number}
              className={`bg-white border rounded-md p-4 ${
                res.isCorrect ? 'border-slate-300' : 'border-red-300'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
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
                  {res.flagged && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-medium">
                      <Flag className="w-3 h-3" /> Đã gắn cờ
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePlayEvidence(q)}
                    className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer border ${
                      isThisPlaying
                        ? 'bg-red-700 text-white border-red-700'
                        : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
                    }`}
                  >
                    {isThisPlaying ? (
                      <Square className="w-3 h-3" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    <span>
                      {isThisPlaying
                        ? 'Dừng phát'
                        : `Nghe lại (${formatSecondsClock(q.evidenceStartTime)}–${formatSecondsClock(q.evidenceEndTime)})`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setVocabModal({
                        word: q.canonicalAnswer.length > 2 ? q.canonicalAnswer : '',
                        example: q.evidenceQuote,
                      })
                    }
                    className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    <span>Lưu từ vựng</span>
                  </button>
                </div>
              </div>

              {/* Answer comparison */}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
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

              {/* Evidence Transcript */}
              <div className="mt-3 p-3 rounded bg-slate-50 border border-slate-200 text-xs space-y-2">
                <div>
                  <span className="font-semibold text-slate-700">Trích dẫn Transcript: </span>
                  <span className="text-slate-800 leading-relaxed">
                    “{highlightEvidence(q.evidenceQuote, q.canonicalAnswer)}”
                  </span>
                </div>

                <div>
                  <span className="font-semibold text-slate-700">Giải thích: </span>
                  <span className="text-slate-700">{q.explanationVi}</span>
                </div>

                {q.paraphrases.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
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
    </div>
  );
}
