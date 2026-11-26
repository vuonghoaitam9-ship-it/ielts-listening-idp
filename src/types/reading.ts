export type ReadingQuestionType =
  | 'tfng'
  | 'ynng'
  | 'mcq_single'
  | 'mcq_multi'
  | 'matching_headings'
  | 'matching_info'
  | 'matching_features'
  | 'matching_sentence_endings'
  | 'summary_box'
  | 'gap_fill'
  | 'table_completion'
  | 'diagram_label'
  | 'short_answer';

export interface ReadingOption {
  key: string;
  text: string;
}

export interface ReadingQuestion {
  number: number;
  prompt: string;
  type: ReadingQuestionType;
  options?: ReadingOption[];
  siblingNumbers?: number[];
  acceptedAnswers: string[];
  evidenceParagraphId: string;
  evidenceLocation: string;
  evidenceQuote: string;
  evidenceTranslationVi: string;
  explanationVi: string;
}

export interface ReadingTable {
  headers: string[];
  rows: string[][];
}

export interface ReadingQuestionGroup {
  id: string;
  questionRange: [number, number];
  type: ReadingQuestionType;
  instruction: string;
  wordLimit?: string;
  missingBoxNote?: string;
  options?: ReadingOption[];
  bodyText?: string;
  table?: ReadingTable;
  diagramUrl?: string;
  selectCount?: number;
  questions: ReadingQuestion[];
}

export interface ReadingParagraph {
  id: string;
  label?: string;
  text: string;
}

export interface ReadingPassage {
  passageNumber: 1 | 2 | 3;
  title: string;
  subtitle?: string;
  questionRange: [number, number];
  paragraphs: ReadingParagraph[];
  groups: ReadingQuestionGroup[];
}

export interface ReadingTestData {
  vol: number;
  test: number;
  testId: string;
  title: string;
  sourceName: string;
  status: 'ready' | 'partial';
  hasKey: boolean;
  keyCount: number;
  missingNote?: string | null;
  passages: ReadingPassage[];
  sourceMode?: 'structured' | 'scanned_pdf';
  localPdfUrl?: string;
  isLocalOverride?: boolean;
}

export interface ReadingManifestEntry {
  vol: number;
  test: number;
  testId: string;
  title: string;
  passageTitles: string[];
  questionCount: number;
  keyCount: number;
  hasPassages: boolean;
  hasQuestions: boolean;
  hasKey: boolean;
  status: 'ready' | 'partial';
  missingComponents: string[];
  sourceName: string;
  dataUrl: string;
}

export interface ReadingManifestData {
  generatedAt: string;
  totalTests: number;
  readyTests: number;
  partialTests: number;
  tests: ReadingManifestEntry[];
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface TextHighlight {
  id: string;
  targetId: string;
  start: number;
  end: number;
  color: HighlightColor;
  note?: string;
  createdAt: number;
}

export interface ReadingQuestionGradeResult {
  questionNumber: number;
  passageNumber: 1 | 2 | 3;
  type: ReadingQuestionType;
  userAnswer: string;
  acceptedAnswers: string[];
  canonicalAnswer: string;
  isCorrect: boolean;
  unkeyed: boolean;
  flagged: boolean;
  evidenceParagraphId: string;
  evidenceLocation: string;
  evidenceQuote: string;
  evidenceTranslationVi: string;
  explanationVi: string;
  siblingNumbers?: number[];
}

export interface ReadingPassageStats {
  passageNumber: 1 | 2 | 3;
  title: string;
  correct: number;
  keyedTotal: number;
  totalQuestions: number;
}

export interface ReadingAttempt {
  id?: number;
  testId: string;
  vol: number;
  test: number;
  title: string;
  mode: 'real' | 'practice';
  startedAt: number;
  finishedAt: number;
  durationSec: number;
  answers: Record<number, string>;
  flagged: number[];
  highlights: TextHighlight[];
  score: number;
  keyedTotal: number;
  band: number;
  passageStats: ReadingPassageStats[];
  results: ReadingQuestionGradeResult[];
}

export type ReadingFontSize = 'small' | 'standard' | 'large';
export type ReadingTheme = 'light' | 'dark' | 'yellow-black';

export interface ReadingLocalOverride {
  testId: string;
  vol: number;
  test: number;
  updatedAt: number;
  sourceMode: 'structured' | 'scanned_pdf';
  testData?: ReadingTestData;
  pdfBlob?: Blob;
  rawKeyText?: string;
  missingNote?: string;
}
