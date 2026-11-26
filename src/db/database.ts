import Dexie, { type Table } from 'dexie';
import type {
  CustomTimestampSet,
  DictationProgressRecord,
  ExamAttempt,
  LocalTestOverride,
  VocabCard,
} from '../types';

import type { ReadingAttempt, ReadingLocalOverride } from '../types/reading';

class IeltsListeningIdpDB extends Dexie {
  examAttempts!: Table<ExamAttempt, number>;
  localOverrides!: Table<LocalTestOverride, string>;
  customTimestamps!: Table<CustomTimestampSet, string>;
  dictationProgress!: Table<DictationProgressRecord, string>;
  vocabCards!: Table<VocabCard, string>;
  readingAttempts!: Table<ReadingAttempt, number>;
  readingLocalOverrides!: Table<ReadingLocalOverride, string>;

  constructor() {
    super('IeltsListeningIdpDB');
    this.version(1).stores({
      examAttempts: '++id, testId, vol, createdAt',
      localOverrides: 'testId, vol, updatedAt',
      customTimestamps: 'testId, updatedAt',
      dictationProgress: 'id, testId, mode, updatedAt',
      vocabCards: 'id, category, source, nextReviewAt, word',
    });
    this.version(2).stores({
      examAttempts: '++id, testId, vol, createdAt',
      localOverrides: 'testId, vol, updatedAt',
      customTimestamps: 'testId, updatedAt',
      dictationProgress: 'id, testId, mode, updatedAt',
      vocabCards: 'id, category, source, nextReviewAt, word',
      readingAttempts: '++id, testId, vol, finishedAt',
      readingLocalOverrides: 'testId, vol, updatedAt',
    });
  }
}

export const db = new IeltsListeningIdpDB();
