import Dexie, { type Table } from 'dexie';
import type {
  CustomTimestampSet,
  DictationProgressRecord,
  ExamAttempt,
  LocalTestOverride,
  VocabCard,
} from '../types';

class IeltsListeningIdpDB extends Dexie {
  examAttempts!: Table<ExamAttempt, number>;
  localOverrides!: Table<LocalTestOverride, string>;
  customTimestamps!: Table<CustomTimestampSet, string>;
  dictationProgress!: Table<DictationProgressRecord, string>;
  vocabCards!: Table<VocabCard, string>;

  constructor() {
    super('IeltsListeningIdpDB');
    this.version(1).stores({
      examAttempts: '++id, testId, vol, createdAt',
      localOverrides: 'testId, vol, updatedAt',
      customTimestamps: 'testId, updatedAt',
      dictationProgress: 'id, testId, mode, updatedAt',
      vocabCards: 'id, category, source, nextReviewAt, word',
    });
  }
}

export const db = new IeltsListeningIdpDB();
