import { FileText, Highlighter } from 'lucide-react';
import { PdfExamViewer } from '../PdfExamViewer';
import { HighlightableText } from './HighlightableText';
import type { HighlightSelectionRequest } from './HighlightToolbar';
import type { ReadingPassage, ReadingTestData, TextHighlight } from '../../types/reading';

interface ReadingPassagePaneProps {
  testData: ReadingTestData;
  passage: ReadingPassage;
  highlights: TextHighlight[];
  activeEvidence: {
    passageNumber: 1 | 2 | 3;
    paragraphId: string;
    quote: string;
  } | null;
  notepadText: string;
  onNotepadChange: (val: string) => void;
  onSelectRange: (req: HighlightSelectionRequest) => void;
  onClickHighlight: (
    hl: TextHighlight,
    rect: { left: number; top: number; bottom: number; width: number }
  ) => void;
}

export function ReadingPassagePane({
  testData,
  passage,
  highlights,
  activeEvidence,
  notepadText,
  onNotepadChange,
  onSelectRange,
  onClickHighlight,
}: ReadingPassagePaneProps) {
  if (testData.sourceMode === 'scanned_pdf' && testData.localPdfUrl) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-2 border-b border-current/15 bg-amber-50 text-amber-900 text-xs flex items-center gap-2 shrink-0">
          <FileText className="w-4 h-4 shrink-0" />
          <span>
            {testData.missingNote ||
              'PDF scan cục bộ — đang hiển thị bản PDF gốc để làm bài đối chiếu.'}
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <PdfExamViewer
            pdfUrl={testData.localPdfUrl}
            questionPageRange={[1, 1]}
            notepadText={notepadText}
            onNotepadChange={onNotepadChange}
          />
        </div>
      </div>
    );
  }

  const [qStart, qEnd] = passage.questionRange;
  const isTargetPassage = activeEvidence?.passageNumber === passage.passageNumber;

  return (
    <div className="h-full overflow-y-auto px-5 py-4 space-y-4 leading-relaxed select-text">
      {/* IDP Passage Banner */}
      <div className="pb-3 border-b border-current/15 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#0f2942] text-white">
            Reading Passage {passage.passageNumber}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] opacity-75">
            <Highlighter className="w-3 h-3" />
            <span>Bôi đen văn bản để Highlight &amp; Ghi chú</span>
          </span>
        </div>

        <p className="text-xs opacity-80 italic pt-1">
          You should spend about 20 minutes on Questions {qStart}–{qEnd}, which are based on
          Reading Passage {passage.passageNumber} below.
        </p>

        <h1 className="text-lg font-bold tracking-tight pt-1">
          <HighlightableText
            targetId={`p-${passage.passageNumber}-title`}
            text={passage.title}
            highlights={highlights}
            onSelectRange={onSelectRange}
            onClickHighlight={onClickHighlight}
          />
        </h1>

        {passage.subtitle && (
          <p className="text-sm italic opacity-85">
            <HighlightableText
              targetId={`p-${passage.passageNumber}-subtitle`}
              text={passage.subtitle}
              highlights={highlights}
              onSelectRange={onSelectRange}
              onClickHighlight={onClickHighlight}
            />
          </p>
        )}
      </div>

      {/* Paragraphs */}
      <div className="space-y-4">
        {passage.paragraphs.map((para) => {
          const isEvidencePara =
            Boolean(isTargetPassage) && activeEvidence?.paragraphId === para.id;

          return (
            <div
              key={para.id}
              id={`reading-para-${para.id}`}
              className={`rounded-md transition-colors ${
                isEvidencePara
                  ? 'p-2.5 -mx-2.5 border border-emerald-500/60 bg-emerald-50/40'
                  : ''
              }`}
            >
              <p className="leading-[1.75]">
                {para.label && (
                  <span
                    data-highlight-ignore="true"
                    className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 mr-2 rounded bg-slate-800 text-white text-xs font-bold align-baseline"
                  >
                    {para.label}
                  </span>
                )}
                <HighlightableText
                  targetId={`p-${passage.passageNumber}-${para.id}`}
                  text={para.text}
                  highlights={highlights}
                  evidenceQuote={isEvidencePara ? activeEvidence?.quote : null}
                  onSelectRange={onSelectRange}
                  onClickHighlight={onClickHighlight}
                />
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
