import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VocabCard } from '../types';
import type { ReadingManifestData, ReadingTestData } from '../types/reading';

const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'public', 'data');

describe('Vol 7-10 packaged IELTS Reading & Core Vocab integrity', () => {
  it('contains valid reading-manifest.json with 43 tests (40 ready, 3 honest partial)', () => {
    const manifestPath = path.join(DATA_DIR, 'reading-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8')
    ) as ReadingManifestData;

    expect(manifest.totalTests).toBe(43);
    expect(manifest.readyTests).toBe(40);
    expect(manifest.partialTests).toBe(3);
    expect(manifest.tests).toHaveLength(43);

    const byId = new Map(manifest.tests.map((t) => [t.testId, t]));
    expect(byId.get('vol-9-test-3')?.status).toBe('partial');
    expect(byId.get('vol-9-test-3')?.keyCount).toBe(39);
    expect(byId.get('vol-10-test-3')?.status).toBe('partial');
    expect(byId.get('vol-10-test-3')?.keyCount).toBe(0);
    expect(byId.get('vol-10-test-5')?.status).toBe('partial');
    expect(byId.get('vol-10-test-5')?.keyCount).toBe(0);
  });

  it('verifies every Reading JSON has 3 passages, questions 1..40, valid diagrams, and verbatim quotes', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'reading-manifest.json'), 'utf8')
    ) as ReadingManifestData;

    for (const entry of manifest.tests) {
      expect(entry.dataUrl.startsWith('./data/')).toBe(true);
      const dataPath = path.join(DATA_DIR, entry.dataUrl.replace('./data/', ''));
      expect(fs.existsSync(dataPath)).toBe(true);

      const testJson = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as ReadingTestData;
      expect(testJson.passages).toHaveLength(3);

      const allNums: number[] = [];
      for (const p of testJson.passages) {
        expect(p.paragraphs.length).toBeGreaterThan(0);
        const paraIds = new Map(p.paragraphs.map((pr) => [pr.id, pr.text]));

        for (const g of p.groups) {
          if (g.diagramUrl) {
            expect(g.diagramUrl.startsWith('./data/')).toBe(true);
            const imgPath = path.join(DATA_DIR, g.diagramUrl.replace('./data/', ''));
            expect(fs.existsSync(imgPath)).toBe(true);
          }

          for (const q of g.questions) {
            allNums.push(q.number);
            if (q.acceptedAnswers.length > 0 && q.evidenceQuote) {
              const pText = paraIds.get(q.evidenceParagraphId) ?? '';
              expect(pText.includes(q.evidenceQuote)).toBe(true);
              expect(q.evidenceTranslationVi.trim().length).toBeGreaterThan(0);
              expect(q.explanationVi.trim().length).toBeGreaterThan(0);
            }
          }
        }
      }

      allNums.sort((a, b) => a - b);
      expect(allNums).toHaveLength(40);
      expect(allNums[0]).toBe(1);
      expect(allNums[39]).toBe(40);
    }
  });

  it('includes both Listening core cards and 60 Reading academic cards in vocab-core.json', () => {
    const vocabPath = path.join(DATA_DIR, 'vocab-core.json');
    const cards = JSON.parse(fs.readFileSync(vocabPath, 'utf8')) as VocabCard[];
    const readingCards = cards.filter((c) => c.category === 'reading_academic');

    expect(cards.length).toBe(239);
    expect(readingCards).toHaveLength(60);
    expect(readingCards[0].id).toBe('core-r-001');
    expect(readingCards[59].id).toBe('core-r-060');
  });
});
