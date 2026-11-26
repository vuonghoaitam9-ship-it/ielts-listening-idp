export type ContrastTheme = 'light' | 'dark' | 'yellow-black';
export type FontScale = 'small' | 'standard' | 'large';
export type ExamTimerMode = 'idp' | 'free';
export type ExamAudioMode = 'real' | 'practice';

export interface SharedAnswerGroup {
  groupId: string;
  questionNumbers: number[];
  poolAnswers: string[];
}

export interface ParaphrasePair {
  questionTerm: string;
  audioTerm: string;
}

export interface QuestionItem {
  number: number;
  part: 1 | 2 | 3 | 4;
  promptContext: string;
  answerRaw: string;
  canonicalAnswer: string;
  acceptedAnswers: string[];
  sharedGroup: SharedAnswerGroup | null;
  evidenceQuote: string;
  evidenceStartTime: number;
  evidenceEndTime: number;
  timestampEdited?: boolean;
  paraphrases: ParaphrasePair[];
  distractors: string[];
  explanationVi: string;
}

export interface PartData {
  partNumber: 1 | 2 | 3 | 4;
  title: string;
  questionRange: [number, number];
  startTime: number;
  endTime: number;
  topicHint: string;
}

export interface TranscriptSegment {
  id: string;
  part: 1 | 2 | 3 | 4;
  startTime: number;
  endTime: number;
  text: string;
  timestampSource: 'exact' | 'estimated' | 'custom';
  qTags?: number[];
}

export interface DictationLongSegment {
  id: string;
  part: 1 | 2 | 3 | 4;
  startTime: number;
  endTime: number;
  text: string;
  segmentIds: string[];
  timestampSource: 'exact' | 'estimated' | 'custom';
}

export interface TestData {
  id: string;
  vol: number;
  testNumber: number;
  title: string;
  pdfUrl: string;
  pdfPages: number;
  questionPageRange: [number, number];
  audioUrl: string;
  audioDurationSec: number;
  hasExactTimestamps: boolean;
  timestampNote: string;
  parts: PartData[];
  questions: QuestionItem[];
  transcriptSegments: TranscriptSegment[];
  longSegments: DictationLongSegment[];
  isLocalOverride?: boolean;
}

export interface TestManifestItem {
  id: string;
  vol: number;
  testNumber: number;
  title: string;
  status: 'ready' | 'missing';
  dataUrl: string | null;
  pdfUrl: string | null;
  audioUrl: string | null;
  pdfPages: number;
  questionPageRange: [number, number];
  audioDurationSec: number;
  audioOriginalSizeMB: number;
  audioOptimizedSizeMB: number;
  pdfSizeMB: number;
  hasPdf: boolean;
  hasAudio: boolean;
  hasTranscript: boolean;
  hasKey: boolean;
  hasExactTimestamps: boolean;
  questionCount: number;
  shortSegmentCount: number;
  longSegmentCount: number;
  sourceNotes: string;
}

export interface VolumeSummary {
  vol: number;
  label: string;
  ready: number;
  total: number;
  notes: string;
}

export interface ManifestData {
  schemaVersion: number;
  generatedAt: string;
  sourceSummary: {
    totalTests: number;
    readyTests: number;
    missingTests: number;
    totalRawAudioMB: number;
    totalPackagedDataMB: number;
    largestFilePath: string;
    largestFileMB: number;
    volumes: VolumeSummary[];
  };
  tests: TestManifestItem[];
}

export interface QuestionGradeResult {
  questionNumber: number;
  part: 1 | 2 | 3 | 4;
  userAnswer: string;
  canonicalAnswer: string;
  acceptedAnswers: string[];
  isCorrect: boolean;
  flagged: boolean;
}

export interface ExamAttempt {
  id?: number;
  testId: string;
  vol: number;
  testNumber: number;
  testTitle: string;
  createdAt: number;
  durationUsedSec: number;
  mode: ExamAudioMode;
  timerMode: ExamTimerMode;
  answers: Record<number, string>;
  flagged: number[];
  score: number;
  total: number;
  band: number;
  partScores: Record<1 | 2 | 3 | 4, number>;
  results: QuestionGradeResult[];
}

export interface LocalTestOverride {
  testId: string;
  vol: number;
  testNumber: number;
  title: string;
  pdfBlob?: Blob;
  audioBlob?: Blob;
  audioDurationSec?: number;
  customJson?: Partial<TestData>;
  updatedAt: number;
}

export interface CustomTimestampSet {
  testId: string;
  segments: TranscriptSegment[];
  longSegments: DictationLongSegment[];
  updatedAt: number;
}

export interface DictationProgressRecord {
  id: string; // `${testId}::${mode}::${segmentId}`
  testId: string;
  mode: 'short' | 'long';
  segmentId: string;
  bestAccuracy: number;
  attempts: number;
  lastUserText: string;
  updatedAt: number;
}

export type VocabCategory =
  | 'dates_numbers'
  | 'places_maps'
  | 'academic_p3_p4'
  | 'paraphrase_pairs'
  | 'reading_academic'
  | 'saved_from_test';

export type Sm2Rating = 'again' | 'hard' | 'good' | 'easy';

export interface VocabCard {
  id: string;
  word: string;
  ipa: string;
  partOfSpeech: string;
  meaningVi: string;
  exampleEn: string;
  paraphraseNote: string;
  spellingTrap: string;
  category: VocabCategory;
  source: 'core' | 'user';
  sourceTestId?: string;
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: number;
  lastReviewedAt?: number;
  createdAt: number;
}
