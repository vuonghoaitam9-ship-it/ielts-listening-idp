import type { ReadingPassage } from '../../types/reading';

interface ReadingQuestionPaletteProps {
  passages: ReadingPassage[];
  answers: Record<number, string>;
  flagged: Set<number>;
  activePassage: 1 | 2 | 3;
  activeQuestion: number;
  onSelectQuestion: (qNum: number, passageNumber: 1 | 2 | 3) => void;
}

export function ReadingQuestionPalette({
  passages,
  answers,
  flagged,
  activePassage,
  activeQuestion,
  onSelectQuestion,
}: ReadingQuestionPaletteProps) {
  const safePassages =
    passages.length > 0
      ? passages
      : ([
          { passageNumber: 1 as const, questionRange: [1, 13] as [number, number] },
          { passageNumber: 2 as const, questionRange: [14, 26] as [number, number] },
          { passageNumber: 3 as const, questionRange: [27, 40] as [number, number] },
        ] as const);

  return (
    <footer className="idp-surface border-t px-3 py-2 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {safePassages.map((p) => {
            const nums: number[] = [];
            if ('groups' in p && p.groups.length > 0) {
              for (const g of p.groups) {
                for (const q of g.questions) nums.push(q.number);
              }
            }
            if (nums.length === 0) {
              const [s, e] = p.questionRange;
              for (let q = s; q <= e; q++) nums.push(q);
            } else {
              nums.sort((a, b) => a - b);
            }

            const isCurrentPassage = activePassage === p.passageNumber;

            return (
              <div
                key={p.passageNumber}
                className={`flex flex-wrap items-center gap-1 px-1.5 py-0.5 rounded ${
                  isCurrentPassage ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : ''
                }`}
              >
                <span className="text-[11px] font-bold opacity-85 mr-0.5">
                  P{p.passageNumber}
                </span>
                {nums.map((q) => {
                  const isAnswered = (answers[q] ?? '').trim().length > 0;
                  const isFlagged = flagged.has(q);
                  const isActive = activeQuestion === q;

                  let cls = 'idp-muted border-current/20';
                  if (isFlagged) {
                    cls = 'bg-amber-600 text-white border-amber-700';
                  } else if (isAnswered) {
                    cls = 'bg-[#1e40af] text-white border-[#1e40af]';
                  }

                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onSelectQuestion(q, p.passageNumber)}
                      className={`w-6 h-6 rounded border text-[11px] font-mono tabular-nums font-medium flex items-center justify-center cursor-pointer ${cls} ${
                        isActive ? 'ring-2 ring-offset-1 ring-emerald-500' : ''
                      }`}
                      title={`Câu ${q} (Passage ${p.passageNumber})${
                        isFlagged ? ' - Đã gắn cờ' : isAnswered ? ' - Đã làm' : ' - Chưa làm'
                      }`}
                    >
                      {q}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-[11px] opacity-80">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm border idp-muted inline-block" /> Chưa làm
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1e40af] inline-block" /> Đã làm
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" /> Gắn cờ
          </span>
        </div>
      </div>
    </footer>
  );
}
