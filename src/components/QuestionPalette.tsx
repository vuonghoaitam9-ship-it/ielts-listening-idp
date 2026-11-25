interface QuestionPaletteProps {
  answers: Record<number, string>;
  flagged: Set<number>;
  activeQuestion: number;
  onSelectQuestion: (qNum: number) => void;
}

export function QuestionPalette({
  answers,
  flagged,
  activeQuestion,
  onSelectQuestion,
}: QuestionPaletteProps) {
  const parts: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];

  return (
    <footer className="idp-surface border-t px-3 py-2 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {parts.map((p) => {
            const start = (p - 1) * 10 + 1;
            const nums = Array.from({ length: 10 }, (_, idx) => start + idx);
            return (
              <div key={p} className="flex items-center gap-1">
                <span className="text-[11px] font-semibold opacity-75 mr-0.5">P{p}</span>
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
                      onClick={() => onSelectQuestion(q)}
                      className={`w-6 h-6 rounded border text-[11px] font-mono tabular-nums font-medium flex items-center justify-center cursor-pointer ${cls} ${
                        isActive ? 'ring-2 ring-offset-1 ring-emerald-500' : ''
                      }`}
                      title={`Câu ${q}${isFlagged ? ' (Đã gắn cờ)' : isAnswered ? ' (Đã làm)' : ' (Chưa làm)'}`}
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
