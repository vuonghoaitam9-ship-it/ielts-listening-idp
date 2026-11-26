import { useState, type ReactNode } from 'react';
import { AlertCircle, Flag, Info, X } from 'lucide-react';
import { HighlightableText } from './HighlightableText';
import type { HighlightSelectionRequest } from './HighlightToolbar';
import type {
  ReadingOption,
  ReadingPassage,
  ReadingQuestion,
  ReadingQuestionGroup,
  TextHighlight,
} from '../../types/reading';

interface ReadingQuestionsPaneProps {
  passage: ReadingPassage;
  answers: Record<number, string>;
  flagged: Set<number>;
  activeQuestion: number;
  highlights: TextHighlight[];
  disabled?: boolean;
  onChangeAnswer: (qNum: number, val: string) => void;
  onToggleFlag: (qNum: number) => void;
  onFocusQuestion: (qNum: number) => void;
  onSelectRange: (req: HighlightSelectionRequest) => void;
  onClickHighlight: (
    hl: TextHighlight,
    rect: { left: number; top: number; bottom: number; width: number }
  ) => void;
}

const MATCHING_GROUP_TYPES = new Set([
  'matching_headings',
  'matching_info',
  'matching_features',
  'matching_sentence_endings',
]);

function renderInlineBlankTemplate(
  text: string,
  renderBlank: (qNum: number) => ReactNode
): ReactNode {
  const parts = text.split(/(\{\{blank:\d+\}\})/g);
  return parts.map((part, idx) => {
    const m = /^\{\{blank:(\d+)\}\}$/.exec(part);
    if (!m) {
      return <span key={idx}>{part}</span>;
    }
    const qNum = Number(m[1]);
    return <span key={`b-${qNum}-${idx}`}>{renderBlank(qNum)}</span>;
  });
}

export function ReadingQuestionsPane({
  passage,
  answers,
  flagged,
  activeQuestion,
  highlights,
  disabled = false,
  onChangeAnswer,
  onToggleFlag,
  onFocusQuestion,
  onSelectRange,
  onClickHighlight,
}: ReadingQuestionsPaneProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);

  const renderFlagBtn = (qNum: number) => {
    const isFlagged = flagged.has(qNum);
    return (
      <button
        type="button"
        onClick={() => onToggleFlag(qNum)}
        title={isFlagged ? 'Bỏ gắn cờ câu này' : 'Gắn cờ xem lại'}
        aria-label={`Gắn cờ câu ${qNum}`}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-pointer ${
          isFlagged
            ? 'bg-amber-600 text-white border-amber-700'
            : 'border-current/20 opacity-75 hover:opacity-100'
        }`}
      >
        <Flag className="w-3 h-3" />
      </button>
    );
  };

  const renderInlineInput = (qNum: number, compact = false) => {
    const val = answers[qNum] ?? '';
    return (
      <span
        id={`reading-q-${qNum}`}
        className={`inline-flex items-center gap-1 mx-1 my-0.5 align-baseline ${
          activeQuestion === qNum ? 'ring-1 ring-emerald-500 rounded px-0.5' : ''
        }`}
      >
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded bg-[#0f2942] text-white text-[11px] font-bold font-mono tabular-nums">
          {qNum}
        </span>
        <input
          type="text"
          value={val}
          disabled={disabled}
          onFocus={() => onFocusQuestion(qNum)}
          onChange={(e) => onChangeAnswer(qNum, e.target.value)}
          placeholder={`Q${qNum}`}
          autoComplete="off"
          spellCheck={false}
          className={`idp-input px-2 py-0.5 rounded border text-sm font-medium focus:outline-2 focus:outline-[#1e40af] ${
            compact ? 'w-32 sm:w-36' : 'w-36 sm:w-44'
          }`}
        />
      </span>
    );
  };

  const renderSummaryBlank = (qNum: number, group: ReadingQuestionGroup) => {
    const options = group.options ?? [];
    if (options.length === 0) {
      return renderInlineInput(qNum, true);
    }

    const val = answers[qNum] ?? '';
    const isDropHighlight = dragKey !== null && dragGroupId === group.id;

    return (
      <span
        id={`reading-q-${qNum}`}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          const dropped = e.dataTransfer.getData('text/plain') || dragKey;
          if (dropped) {
            onChangeAnswer(qNum, dropped);
            onFocusQuestion(qNum);
          }
          setDragKey(null);
          setDragGroupId(null);
        }}
        className={`inline-flex items-center gap-1 mx-1 my-0.5 px-1 py-0.5 rounded border align-baseline ${
          isDropHighlight
            ? 'border-dashed border-emerald-600 bg-emerald-50/40'
            : activeQuestion === qNum
            ? 'border-emerald-500 bg-emerald-50/20'
            : 'border-current/25'
        }`}
      >
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded bg-[#0f2942] text-white text-[11px] font-bold font-mono tabular-nums">
          {qNum}
        </span>
        <select
          value={val}
          disabled={disabled}
          onFocus={() => onFocusQuestion(qNum)}
          onChange={(e) => onChangeAnswer(qNum, e.target.value)}
          aria-label={`Chọn đáp án cho câu ${qNum}`}
          className="idp-input px-1.5 py-0.5 rounded text-xs font-semibold min-w-[84px] max-w-[190px] cursor-pointer"
        >
          <option value="">-- Kéo/Chọn --</option>
          {options.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.text && opt.text !== opt.key ? `${opt.key}. ${opt.text}` : opt.key}
            </option>
          ))}
        </select>
        {val && !disabled && (
          <button
            type="button"
            onClick={() => onChangeAnswer(qNum, '')}
            title="Xóa lựa chọn"
            className="p-0.5 opacity-60 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </span>
    );
  };

  const renderGroupOptionsBox = (
    group: ReadingQuestionGroup,
    options: ReadingOption[],
    headingLabel: string
  ) => {
    const usedKeys = new Set<string>();
    for (const q of group.questions) {
      const v = (answers[q.number] ?? '').trim().toUpperCase();
      if (v) usedKeys.add(v);
    }

    return (
      <div className="idp-muted border border-current/20 rounded-md p-3 space-y-2">
        <div className="text-xs font-semibold flex items-center justify-between gap-2">
          <span>{headingLabel}</span>
          <span className="text-[11px] font-normal opacity-75">
            Kéo thả vào ô hoặc chọn trong danh sách thả xuống
          </span>
        </div>

        <div className="grid grid-cols-1 gap-1.5">
          {options.map((opt) => {
            const isUsed = usedKeys.has(opt.key.trim().toUpperCase());
            return (
              <div
                key={opt.key}
                draggable={!disabled}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', opt.key);
                  setDragKey(opt.key);
                  setDragGroupId(group.id);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setDragGroupId(null);
                }}
                className={`px-2.5 py-1.5 rounded border text-xs flex items-start gap-2 select-none ${
                  !disabled ? 'cursor-grab active:cursor-grabbing' : ''
                } ${
                  isUsed
                    ? 'border-[#1e40af]/50 bg-blue-50/30 opacity-80'
                    : 'idp-surface border-current/20 hover:border-[#1e40af]'
                }`}
              >
                <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-[#0f2942] text-white text-[11px] shrink-0">
                  {opt.key}
                </span>
                <span className="leading-snug">
                  {opt.text && opt.text !== opt.key ? opt.text : `Lựa chọn ${opt.key}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderRadioChoiceGroup = (
    q: ReadingQuestion,
    choices: Array<{ value: string; label: string }>
  ) => {
    const selected = (answers[q.number] ?? '').trim();
    const isActive = activeQuestion === q.number;

    return (
      <div
        key={q.number}
        id={`reading-q-${q.number}`}
        onClick={() => onFocusQuestion(q.number)}
        className={`p-3 rounded-md border space-y-2.5 ${
          isActive ? 'border-[#1e40af] ring-1 ring-[#1e40af]/40' : 'border-current/20'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 text-sm">
            <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded bg-[#0f2942] text-white text-xs font-bold font-mono tabular-nums shrink-0 mt-0.5">
              {q.number}
            </span>
            <div className="leading-relaxed">
              <HighlightableText
                targetId={`q-${q.number}`}
                text={q.prompt}
                highlights={highlights}
                onSelectRange={onSelectRange}
                onClickHighlight={onClickHighlight}
              />
            </div>
          </div>
          {renderFlagBtn(q.number)}
        </div>

        <div className="flex flex-col gap-1.5 pl-8">
          {choices.map((ch) => {
            const checked = selected.toUpperCase() === ch.value.toUpperCase();
            return (
              <label
                key={ch.value}
                className={`flex items-start gap-2 px-2.5 py-1.5 rounded border text-xs cursor-pointer transition-colors ${
                  checked
                    ? 'border-[#1e40af] bg-blue-50/40 font-semibold'
                    : 'border-current/15 hover:border-current/35'
                }`}
              >
                <input
                  type="radio"
                  name={`reading-q-${q.number}`}
                  value={ch.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    onFocusQuestion(q.number);
                    onChangeAnswer(q.number, ch.value);
                  }}
                  className="mt-0.5 accent-[#1e40af]"
                />
                <span className="leading-snug">{ch.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  const renderGroupBody = (group: ReadingQuestionGroup) => {
    const [gStart, gEnd] = group.questionRange;

    // 1. Gap Fill / Summary Completion (with optional Word Bank)
    if (
      (group.type === 'gap_fill' || group.type === 'summary_box') &&
      group.bodyText
    ) {
      const lines = group.bodyText.split('\n');
      const missingQuestions = group.questions.filter(
        (q) => !group.bodyText!.includes(`{{blank:${q.number}}}`)
      );

      return (
        <div className="space-y-3">
          {group.type === 'summary_box' && group.options && group.options.length > 0 && (
            renderGroupOptionsBox(group, group.options, 'Word Bank (Bảng từ gợi ý)')
          )}

          <div className="idp-muted border border-current/20 rounded-md p-3.5 space-y-2 text-sm leading-relaxed">
            {lines.map((line, lineIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={lineIdx} className="h-1" />;
              return (
                <div key={lineIdx} className="leading-[1.9]">
                  {renderInlineBlankTemplate(line, (qNum) =>
                    group.type === 'summary_box'
                      ? renderSummaryBlank(qNum, group)
                      : renderInlineInput(qNum)
                  )}
                </div>
              );
            })}
          </div>

          {missingQuestions.length > 0 && (
            <div className="space-y-2">
              {missingQuestions.map((mq) => (
                <div
                  key={mq.number}
                  className="p-2.5 rounded-md border border-current/20 flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="text-xs opacity-90 flex-1 min-w-[200px]">
                    {mq.prompt && mq.prompt !== `Question ${mq.number}`
                      ? mq.prompt
                      : `Câu ${mq.number}`}
                  </span>
                  {group.type === 'summary_box'
                    ? renderSummaryBlank(mq.number, group)
                    : renderInlineInput(mq.number)}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] opacity-80">
            <span>Gắn cờ nhanh:</span>
            {group.questions.map((q) => (
              <button
                key={q.number}
                type="button"
                onClick={() => onToggleFlag(q.number)}
                className={`px-1.5 py-0.5 rounded border font-mono cursor-pointer ${
                  flagged.has(q.number)
                    ? 'bg-amber-600 text-white border-amber-700'
                    : 'border-current/25'
                }`}
              >
                Q{q.number}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // 2. Table Completion
    if (group.type === 'table_completion' && group.table) {
      return (
        <div className="space-y-3">
          <div className="overflow-x-auto border border-current/25 rounded-md">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="idp-muted border-b border-current/20">
                  {group.table.headers.map((h, i) => (
                    <th key={i} className="text-left p-2 font-semibold border-r border-current/15 last:border-r-0">
                      {renderInlineBlankTemplate(h, (qNum) => renderInlineInput(qNum, true))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-current/15">
                {group.table.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className="p-2 align-top border-r border-current/15 last:border-r-0 leading-relaxed"
                      >
                        {renderInlineBlankTemplate(cell, (qNum) =>
                          renderInlineInput(qNum, true)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] opacity-80">
            <span>Gắn cờ nhanh:</span>
            {group.questions.map((q) => (
              <button
                key={q.number}
                type="button"
                onClick={() => onToggleFlag(q.number)}
                className={`px-1.5 py-0.5 rounded border font-mono cursor-pointer ${
                  flagged.has(q.number)
                    ? 'bg-amber-600 text-white border-amber-700'
                    : 'border-current/25'
                }`}
              >
                Q{q.number}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // 3. Diagram Label Completion
    if (group.type === 'diagram_label') {
      return (
        <div className="space-y-3">
          {group.diagramUrl && (
            <div className="border border-current/25 rounded-md p-2 bg-white">
              <img
                src={group.diagramUrl}
                alt={`Diagram Questions ${gStart}–${gEnd}`}
                className="max-w-full h-auto mx-auto rounded"
              />
            </div>
          )}

          <div className="space-y-2">
            {group.questions.map((q) => (
              <div
                key={q.number}
                id={`reading-q-${q.number}`}
                className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-md border border-current/20"
              >
                <div className="flex items-center gap-2 text-sm flex-1 min-w-[200px]">
                  <span className="font-mono font-bold text-xs px-1.5 py-0.5 rounded bg-[#0f2942] text-white">
                    {q.number}
                  </span>
                  <span className="text-xs opacity-85">
                    {q.prompt && q.prompt !== `Question ${q.number}`
                      ? q.prompt
                      : `Nhãn số ${q.number} trên sơ đồ`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={answers[q.number] ?? ''}
                    disabled={disabled}
                    onFocus={() => onFocusQuestion(q.number)}
                    onChange={(e) => onChangeAnswer(q.number, e.target.value)}
                    placeholder={`Đáp án Q${q.number}`}
                    autoComplete="off"
                    spellCheck={false}
                    className="idp-input px-2.5 py-1 rounded border text-sm w-44"
                  />
                  {renderFlagBtn(q.number)}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // 4. TRUE / FALSE / NOT GIVEN and YES / NO / NOT GIVEN
    if (group.type === 'tfng' || group.type === 'ynng') {
      const choices =
        group.type === 'tfng'
          ? [
              { value: 'TRUE', label: 'TRUE' },
              { value: 'FALSE', label: 'FALSE' },
              { value: 'NOT GIVEN', label: 'NOT GIVEN' },
            ]
          : [
              { value: 'YES', label: 'YES' },
              { value: 'NO', label: 'NO' },
              { value: 'NOT GIVEN', label: 'NOT GIVEN' },
            ];

      return (
        <div className="space-y-2.5">
          {group.questions.map((q) => renderRadioChoiceGroup(q, choices))}
        </div>
      );
    }

    // 5. Multiple Choice Single
    if (group.type === 'mcq_single') {
      return (
        <div className="space-y-3">
          {group.questions.map((q) => {
            const opts = q.options ?? group.options ?? [];
            if (opts.length === 0) {
              return (
                <div
                  key={q.number}
                  id={`reading-q-${q.number}`}
                  className="p-2.5 rounded-md border border-current/20 flex items-center justify-between gap-2"
                >
                  <span className="text-sm">
                    <strong>{q.number}.</strong> {q.prompt}
                  </span>
                  {renderInlineInput(q.number, true)}
                </div>
              );
            }
            return renderRadioChoiceGroup(
              q,
              opts.map((o) => ({
                value: o.key,
                label: o.text ? `${o.key}. ${o.text}` : o.key,
              }))
            );
          })}
        </div>
      );
    }

    // 6. Multiple Choice Multi (Choose TWO / THREE letters with shared siblings)
    if (group.type === 'mcq_multi') {
      const renderedClusters = new Set<string>();

      return (
        <div className="space-y-3">
          {group.questions.map((q) => {
            const siblings =
              q.siblingNumbers && q.siblingNumbers.length > 1
                ? [...q.siblingNumbers].sort((a, b) => a - b)
                : group.questions.map((gq) => gq.number);
            const clusterKey = siblings.join('-');
            if (renderedClusters.has(clusterKey)) return null;
            renderedClusters.add(clusterKey);

            const opts = q.options ?? group.options ?? [];
            const maxSelect = group.selectCount ?? siblings.length;
            const selectedKeys = siblings
              .map((num) => (answers[num] ?? '').trim().toUpperCase())
              .filter(Boolean);

            const toggleOption = (optKey: string) => {
              if (disabled) return;
              const upper = optKey.toUpperCase();
              const isSelected = selectedKeys.includes(upper);
              let next: string[];
              if (isSelected) {
                next = selectedKeys.filter((k) => k !== upper);
              } else if (selectedKeys.length < maxSelect) {
                next = [...selectedKeys, upper];
              } else {
                // Replace earliest choice if user picks a new option beyond maxSelect
                next = [...selectedKeys.slice(1), upper];
              }
              siblings.forEach((sNum, idx) => {
                onChangeAnswer(sNum, next[idx] ?? '');
              });
              onFocusQuestion(siblings[0]);
            };

            return (
              <div
                key={clusterKey}
                id={`reading-q-${siblings[0]}`}
                className="p-3 rounded-md border border-current/25 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 text-sm">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#0f2942] text-white text-xs font-bold font-mono shrink-0">
                      Q{siblings[0]}–{siblings[siblings.length - 1]}
                    </span>
                    <div className="font-medium leading-relaxed">
                      <HighlightableText
                        targetId={`q-${siblings[0]}`}
                        text={q.prompt}
                        highlights={highlights}
                        onSelectRange={onSelectRange}
                        onClickHighlight={onClickHighlight}
                      />
                    </div>
                  </div>
                  <span className="text-[11px] font-mono opacity-80 shrink-0">
                    Đã chọn {selectedKeys.length}/{maxSelect}
                  </span>
                </div>

                <div className="space-y-1.5 pl-2">
                  {opts.map((opt) => {
                    const checked = selectedKeys.includes(opt.key.trim().toUpperCase());
                    return (
                      <label
                        key={opt.key}
                        className={`flex items-start gap-2 px-2.5 py-1.5 rounded border text-xs cursor-pointer ${
                          checked
                            ? 'border-[#1e40af] bg-blue-50/40 font-semibold'
                            : 'border-current/15 hover:border-current/35'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleOption(opt.key)}
                          className="mt-0.5 accent-[#1e40af]"
                        />
                        <span>
                          <strong>{opt.key}.</strong> {opt.text}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // 7. Matching (Headings, Info, Features, Sentence Endings) with Drag & Drop + Dropdown
    if (MATCHING_GROUP_TYPES.has(group.type)) {
      const options = group.options ?? group.questions[0]?.options ?? [];
      const boxTitle =
        group.type === 'matching_headings'
          ? 'List of Headings'
          : group.type === 'matching_sentence_endings'
          ? 'List of Sentence Endings'
          : group.type === 'matching_features'
          ? 'List of Options / Features'
          : 'Paragraphs / Sections';

      return (
        <div className="space-y-3">
          {options.length > 0 && renderGroupOptionsBox(group, options, boxTitle)}

          <div className="space-y-2">
            {group.questions.map((q) => {
              const qOpts = q.options && q.options.length > 0 ? q.options : options;
              const val = answers[q.number] ?? '';
              const matchedOpt = qOpts.find(
                (o) => o.key.toUpperCase() === val.trim().toUpperCase()
              );
              const isDropTarget = dragKey !== null && dragGroupId === group.id;

              return (
                <div
                  key={q.number}
                  id={`reading-q-${q.number}`}
                  onClick={() => onFocusQuestion(q.number)}
                  onDragOver={(e) => {
                    if (disabled) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (disabled) return;
                    e.preventDefault();
                    const dropped = e.dataTransfer.getData('text/plain') || dragKey;
                    if (dropped) {
                      onChangeAnswer(q.number, dropped);
                      onFocusQuestion(q.number);
                    }
                    setDragKey(null);
                    setDragGroupId(null);
                  }}
                  className={`p-2.5 rounded-md border space-y-2 transition-colors ${
                    isDropTarget
                      ? 'border-dashed border-emerald-600 bg-emerald-50/30'
                      : activeQuestion === q.number
                      ? 'border-[#1e40af] ring-1 ring-[#1e40af]/40'
                      : 'border-current/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 text-sm flex-1">
                      <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded bg-[#0f2942] text-white text-xs font-bold font-mono tabular-nums shrink-0 mt-0.5">
                        {q.number}
                      </span>
                      <div className="leading-snug">
                        <HighlightableText
                          targetId={`q-${q.number}`}
                          text={q.prompt}
                          highlights={highlights}
                          onSelectRange={onSelectRange}
                          onClickHighlight={onClickHighlight}
                        />
                      </div>
                    </div>
                    {renderFlagBtn(q.number)}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-8">
                    <select
                      value={val}
                      disabled={disabled}
                      onFocus={() => onFocusQuestion(q.number)}
                      onChange={(e) => onChangeAnswer(q.number, e.target.value)}
                      aria-label={`Chọn ghép nối câu ${q.number}`}
                      className="idp-input px-2 py-1 rounded border text-xs font-semibold min-w-[160px] max-w-full cursor-pointer"
                    >
                      <option value="">-- Kéo thẻ vào đây hoặc chọn --</option>
                      {qOpts.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.text && opt.text !== opt.key
                            ? `${opt.key}. ${opt.text.slice(0, 72)}`
                            : opt.key}
                        </option>
                      ))}
                    </select>

                    {val && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1e40af] text-white text-xs font-semibold">
                        <span>
                          {matchedOpt && matchedOpt.text && matchedOpt.text !== matchedOpt.key
                            ? `${matchedOpt.key}: ${matchedOpt.text.slice(0, 48)}${
                                matchedOpt.text.length > 48 ? '…' : ''
                              }`
                            : val}
                        </span>
                        {!disabled && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onChangeAnswer(q.number, '');
                            }}
                            className="hover:opacity-75 cursor-pointer"
                            aria-label="Xóa đáp án"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // 8. Default / Short Answer / Generic fallback
    return (
      <div className="space-y-2.5">
        {group.questions.map((q) => (
          <div
            key={q.number}
            id={`reading-q-${q.number}`}
            onClick={() => onFocusQuestion(q.number)}
            className={`p-3 rounded-md border space-y-2 ${
              activeQuestion === q.number
                ? 'border-[#1e40af] ring-1 ring-[#1e40af]/40'
                : 'border-current/20'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 text-sm flex-1">
                <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded bg-[#0f2942] text-white text-xs font-bold font-mono tabular-nums shrink-0 mt-0.5">
                  {q.number}
                </span>
                <div className="leading-snug">
                  <HighlightableText
                    targetId={`q-${q.number}`}
                    text={q.prompt}
                    highlights={highlights}
                    onSelectRange={onSelectRange}
                    onClickHighlight={onClickHighlight}
                  />
                </div>
              </div>
              {renderFlagBtn(q.number)}
            </div>

            <div className="pl-8">
              <input
                type="text"
                value={answers[q.number] ?? ''}
                disabled={disabled}
                onFocus={() => onFocusQuestion(q.number)}
                onChange={(e) => onChangeAnswer(q.number, e.target.value)}
                placeholder={`Nhập đáp án câu ${q.number}...`}
                autoComplete="off"
                spellCheck={false}
                className="idp-input w-full max-w-sm px-2.5 py-1.5 rounded border text-sm"
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-6">
      {passage.groups.map((group) => {
        const [gStart, gEnd] = group.questionRange;
        return (
          <section key={group.id} className="space-y-3 pb-4 border-b border-current/15 last:border-b-0">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold tracking-tight">
                  Questions {gStart}–{gEnd}
                </h2>
                {group.wordLimit && (
                  <span className="px-2 py-0.5 rounded border border-red-400/60 bg-red-50/60 text-red-900 text-[11px] font-bold uppercase tracking-wide">
                    {group.wordLimit}
                  </span>
                )}
              </div>

              <p className="text-xs opacity-90 leading-relaxed font-medium">
                <HighlightableText
                  targetId={`grp-${group.id}-inst`}
                  text={group.instruction}
                  highlights={highlights}
                  onSelectRange={onSelectRange}
                  onClickHighlight={onClickHighlight}
                />
              </p>

              {group.missingBoxNote && (
                <div className="flex items-start gap-2 px-2.5 py-2 rounded border border-amber-400/70 bg-amber-50/70 text-amber-950 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{group.missingBoxNote}</span>
                </div>
              )}

              {group.wordLimit && (
                <div className="flex items-center gap-1 text-[11px] opacity-75">
                  <Info className="w-3 h-3" />
                  <span>Lưu ý giới hạn từ chính xác theo đề thi IDP ({group.wordLimit}).</span>
                </div>
              )}
            </div>

            {renderGroupBody(group)}
          </section>
        );
      })}
    </div>
  );
}
