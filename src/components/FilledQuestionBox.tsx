import type { FilledQuestionView } from '../lib/filledQuestion';

interface FilledQuestionBoxProps {
  filled: FilledQuestionView;
  variant?: 'idp' | 'light';
}

export function FilledQuestionBox({
  filled,
  variant = 'light',
}: FilledQuestionBoxProps) {
  const containerCls =
    variant === 'idp'
      ? 'idp-muted border border-current/20 rounded p-2.5 text-xs space-y-1.5'
      : 'bg-slate-50 border border-slate-200 rounded p-2.5 text-xs text-slate-800 space-y-1.5';

  const secondaryCls =
    variant === 'idp'
      ? 'inline-block px-1.5 py-0.5 mx-0.5 rounded bg-slate-200/80 text-slate-900 border border-slate-400/50 font-medium'
      : 'inline-block px-1.5 py-0.5 mx-0.5 rounded bg-slate-200 text-slate-800 border border-slate-300 font-medium';

  return (
    <div className={containerCls}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">
        Câu hỏi gốc (đã điền đáp án):
      </div>

      <div className="leading-relaxed text-[13px]">
        {filled.parts.map((part, idx) => {
          if (part.isAnswer) {
            return (
              <mark
                key={idx}
                className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-emerald-100 text-emerald-950 border border-emerald-400 font-semibold"
              >
                {part.text}
              </mark>
            );
          }
          if (part.isSecondaryBlank) {
            return (
              <span key={idx} className={secondaryCls} title="Đáp án của ô trống lân cận">
                {part.text}
              </span>
            );
          }
          return <span key={idx}>{part.text}</span>;
        })}

        {filled.suffixAnswer && (
          <span className="inline-flex items-center gap-1.5 ml-2 align-baseline">
            <span className="font-bold opacity-70">→</span>
            <mark className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-950 border border-emerald-400 font-semibold">
              {filled.suffixAnswer}
            </mark>
          </span>
        )}
      </div>

      {filled.diagramUrl && (
        <div className="pt-1">
          <img
            src={filled.diagramUrl}
            alt="Sơ đồ câu hỏi gốc"
            className="max-h-48 w-auto rounded border border-slate-300 bg-white"
          />
        </div>
      )}
    </div>
  );
}
