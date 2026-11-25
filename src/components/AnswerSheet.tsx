import { Flag } from 'lucide-react';
import type { PartData, QuestionItem } from '../types';

interface AnswerSheetProps {
  parts: PartData[];
  questions: QuestionItem[];
  answers: Record<number, string>;
  flagged: Set<number>;
  activePart: 1 | 2 | 3 | 4 | 'all';
  activeQuestion: number;
  inputRefs: React.MutableRefObject<Map<number, HTMLInputElement>>;
  onActivePartChange: (p: 1 | 2 | 3 | 4 | 'all') => void;
  onFocusQuestion: (qNum: number) => void;
  onAnswerChange: (qNum: number, val: string) => void;
  onToggleFlag: (qNum: number) => void;
}

export function AnswerSheet({
  parts,
  questions,
  answers,
  flagged,
  activePart,
  activeQuestion,
  inputRefs,
  onActivePartChange,
  onFocusQuestion,
  onAnswerChange,
  onToggleFlag,
}: AnswerSheetProps) {
  const visibleParts =
    activePart === 'all' ? parts : parts.filter((p) => p.partNumber === activePart);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, qNum: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = Math.min(40, qNum + 1);
      onFocusQuestion(next);
      setTimeout(() => {
        inputRefs.current.get(next)?.focus();
      }, 15);
    }
  };

  return (
    <div className="h-full flex flex-col idp-surface">
      {/* Part Tabs */}
      <div className="px-3 py-1.5 border-b idp-muted flex flex-wrap items-center justify-between gap-2 shrink-0">
        <span className="text-xs font-semibold">Phiếu trả lời (Answer Sheet 1–40)</span>
        <div className="flex items-center gap-1 text-xs">
          {([1, 2, 3, 4, 'all'] as const).map((tab) => (
            <button
              key={String(tab)}
              type="button"
              onClick={() => onActivePartChange(tab)}
              className={`px-2 py-0.5 rounded border font-medium cursor-pointer ${
                activePart === tab
                  ? 'bg-[#1e40af] text-white border-[#1e40af]'
                  : 'idp-surface'
              }`}
            >
              {tab === 'all' ? 'Cả 4 Part' : `Part ${tab}`}
            </button>
          ))}
        </div>
      </div>

      {/* Questions List */}
      <div className="flex-1 overflow-auto p-3 space-y-5">
        {visibleParts.map((part) => {
          const partQuestions = questions.filter((q) => q.part === part.partNumber);
          return (
            <section key={part.partNumber} className="space-y-2">
              <div className="pb-1 border-b flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide">
                  Part {part.partNumber} · Questions {part.questionRange[0]}–{part.questionRange[1]}
                </h3>
              </div>

              <div className="space-y-1.5">
                {partQuestions.map((q) => {
                  const isActive = activeQuestion === q.number;
                  const isFlagged = flagged.has(q.number);
                  const val = answers[q.number] ?? '';
                  const isMultiNote =
                    q.sharedGroup && q.sharedGroup.questionNumbers[0] === q.number;

                  return (
                    <div key={q.number}>
                      {isMultiNote && q.sharedGroup && (
                        <div className="text-[11px] opacity-75 px-2 py-1 mb-1 rounded idp-muted">
                          Nhóm câu {q.sharedGroup.questionNumbers.join('–')}: nhập mỗi ô 1 chữ cái đáp án (không cần đúng thứ tự).
                        </div>
                      )}
                      <div
                        className={`flex items-center gap-2 p-1.5 rounded border transition-colors ${
                          isActive ? 'border-[#1e40af] ring-1 ring-[#1e40af]' : 'border-transparent'
                        }`}
                      >
                        <span className="w-7 text-right font-mono font-semibold text-xs tabular-nums shrink-0">
                          {q.number}.
                        </span>
                        <input
                          ref={(el) => {
                            if (el) inputRefs.current.set(q.number, el);
                            else inputRefs.current.delete(q.number);
                          }}
                          type="text"
                          value={val}
                          onFocus={() => onFocusQuestion(q.number)}
                          onChange={(e) => onAnswerChange(q.number, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, q.number)}
                          placeholder={`Đáp án câu ${q.number}...`}
                          autoComplete="off"
                          spellCheck={false}
                          className="flex-1 px-2.5 py-1.5 rounded border idp-input text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => onToggleFlag(q.number)}
                          className={`p-1.5 rounded border cursor-pointer shrink-0 ${
                            isFlagged
                              ? 'bg-amber-600 text-white border-amber-700'
                              : 'idp-surface opacity-60 hover:opacity-100'
                          }`}
                          title={isFlagged ? 'Bỏ gắn cờ' : 'Gắn cờ xem lại'}
                          aria-label={`Gắn cờ câu ${q.number}`}
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
