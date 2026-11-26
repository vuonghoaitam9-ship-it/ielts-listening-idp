import { db } from '../db/database';
import { buildLongSegmentsFromShort } from './subtitleParser';
import type { ManifestData, TestData, VocabCard } from '../types';

let manifestCache: ManifestData | null = null;
const activeObjectUrls: string[] = [];

export function revokeManagedObjectUrls(): void {
  while (activeObjectUrls.length > 0) {
    const url = activeObjectUrls.pop();
    if (url) URL.revokeObjectURL(url);
  }
}

export async function loadManifest(force = false): Promise<ManifestData> {
  if (manifestCache && !force) return manifestCache;
  const res = await fetch('./data/manifest.json');
  if (!res.ok) {
    throw new Error(`Không thể tải ./data/manifest.json (${res.status})`);
  }
  const data = (await res.json()) as ManifestData;
  manifestCache = data;
  return data;
}

export async function loadTestData(vol: number, testNumber: number): Promise<TestData | null> {
  const testId = `vol-${vol}-test-${testNumber}`;
  const manifest = await loadManifest();
  const item = manifest.tests.find((t) => t.id === testId);
  const override = await db.localOverrides.get(testId);
  const customTs = await db.customTimestamps.get(testId);

  let baseData: TestData | null = null;
  if (item?.dataUrl) {
    const res = await fetch(item.dataUrl);
    if (res.ok) {
      baseData = (await res.json()) as TestData;
    }
  }

  if (!baseData && !override?.customJson) {
    return null;
  }

  const merged: TestData = {
    ...(baseData ?? (override!.customJson as TestData)),
    ...(override?.customJson ?? {}),
  };

  if (override?.pdfBlob) {
    const url = URL.createObjectURL(override.pdfBlob);
    activeObjectUrls.push(url);
    merged.pdfUrl = url;
    merged.isLocalOverride = true;
  }
  if (override?.audioBlob) {
    const url = URL.createObjectURL(override.audioBlob);
    activeObjectUrls.push(url);
    merged.audioUrl = url;
    if (override.audioDurationSec) {
      merged.audioDurationSec = override.audioDurationSec;
    }
    merged.isLocalOverride = true;
  }

  if (customTs && customTs.segments.length > 0) {
    merged.transcriptSegments = customTs.segments;
    merged.longSegments =
      customTs.longSegments.length > 0
        ? customTs.longSegments
        : buildLongSegmentsFromShort(customTs.segments);
    merged.hasExactTimestamps = true;
    merged.timestampNote = 'Đang sử dụng mốc thời gian tùy chỉnh (lưu trong IndexedDB).';
  }

  return merged;
}

export async function seedVocabCoreIfNeeded(): Promise<void> {
  const existingCoreCount = await db.vocabCards.where('source').equals('core').count();
  if (existingCoreCount > 0) {
    const existingIds = new Set(
      (await db.vocabCards.where('source').equals('core').primaryKeys()).map(String)
    );
    const resExisting = await fetch('./data/vocab-core.json');
    if (!resExisting.ok) return;
    const rawCore = (await resExisting.json()) as Array<{
      id: string;
      word: string;
      ipa?: string;
      partOfSpeech?: string;
      meaningVi: string;
      exampleEn?: string;
      paraphraseNote?: string;
      spellingTrap?: string;
      category: import('../types').VocabCategory;
      source: 'core';
    }>;
    const now = Date.now();
    const missingCards: import('../types').VocabCard[] = rawCore
      .filter((item) => !existingIds.has(item.id))
      .map((item) => ({
        id: item.id,
        word: item.word,
        ipa: item.ipa ?? '',
        partOfSpeech: item.partOfSpeech ?? '',
        meaningVi: item.meaningVi,
        exampleEn: item.exampleEn ?? '',
        paraphraseNote: item.paraphraseNote ?? '',
        spellingTrap: item.spellingTrap ?? '',
        category: item.category,
        source: 'core',
        repetitions: 0,
        intervalDays: 0,
        easeFactor: 2.5,
        nextReviewAt: now,
        createdAt: now,
      }));
    if (missingCards.length > 0) {
      await db.vocabCards.bulkPut(missingCards);
    }
    return;
  }

  const res = await fetch('./data/vocab-core.json');
  if (!res.ok) return;
  const raw = (await res.json()) as Array<{
    id: string;
    word: string;
    ipa: string;
    partOfSpeech: string;
    meaningVi: string;
    exampleEn: string;
    paraphraseNote: string;
    spellingTrap: string;
    category: VocabCard['category'];
    source: 'core';
  }>;

  const now = Date.now();
  const cards: VocabCard[] = raw.map((item) => ({
    ...item,
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    nextReviewAt: now,
    createdAt: now,
  }));

  await db.vocabCards.bulkPut(cards);
}
