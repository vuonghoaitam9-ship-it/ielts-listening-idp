import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ManifestData, TestData } from '../types';

const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT, 'public', 'data');

describe('Vol 7-10 packaged data & policy integrity', () => {
  it('contains valid manifest with 28 ready tests (Vol 7-9) and honest missing Vol 10', () => {
    const manifestPath = path.join(DATA_DIR, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestData;

    expect(manifest.sourceSummary.readyTests).toBe(28);
    expect(manifest.sourceSummary.missingTests).toBe(4);
    expect(manifest.sourceSummary.largestFileMB).toBeLessThan(50);

    const vol10 = manifest.tests.filter((t) => t.vol === 10);
    expect(vol10).toHaveLength(4);
    expect(vol10.every((t) => t.status === 'missing')).toBe(true);
  });

  it('verifies every ready test has exam.pdf, audio.mp3, relative ./data paths, and 40/40 questions', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8')
    ) as ManifestData;

    const ready = manifest.tests.filter((t) => t.status === 'ready');
    expect(ready).toHaveLength(28);

    for (const item of ready) {
      expect(item.dataUrl?.startsWith('./data/')).toBe(true);
      expect(item.pdfUrl?.startsWith('./data/')).toBe(true);
      expect(item.audioUrl?.startsWith('./data/')).toBe(true);

      const dataRel = item.dataUrl!.replace('./data/', '');
      const pdfRel = item.pdfUrl!.replace('./data/', '');
      const audioRel = item.audioUrl!.replace('./data/', '');

      const dataPath = path.join(DATA_DIR, dataRel);
      const pdfPath = path.join(DATA_DIR, pdfRel);
      const audioPath = path.join(DATA_DIR, audioRel);

      expect(fs.existsSync(dataPath)).toBe(true);
      expect(fs.existsSync(pdfPath)).toBe(true);
      expect(fs.existsSync(audioPath)).toBe(true);
      expect(fs.statSync(audioPath).size).toBeLessThan(50 * 1024 * 1024);

      const testJson = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as TestData;
      expect(testJson.questions).toHaveLength(40);
      expect(testJson.parts).toHaveLength(4);
      for (let pi = 0; pi < 3; pi++) {
        expect(testJson.parts[pi].startTime).toBeLessThanOrEqual(
          testJson.parts[pi + 1].startTime
        );
      }
      expect(testJson.transcriptSegments.length).toBeGreaterThan(10);
      expect(testJson.longSegments.length).toBeGreaterThan(3);
      for (let q = 1; q <= 40; q++) {
        const qItem = testJson.questions[q - 1];
        expect(qItem.number).toBe(q);
        expect(qItem.acceptedAnswers.length).toBeGreaterThan(0);
      }
    }
  });

  it('enforces strict original audio policy and forbids native browser dialogs (alert/confirm/prompt)', () => {
    const srcDir = path.join(ROOT, 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !full.includes('__tests__')) {
          files.push(full);
        }
      }
    };
    walk(srcDir);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content.includes('speechSynthesis')).toBe(false);
      expect(content.includes('SpeechSynthesisUtterance')).toBe(false);
      expect(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(content)).toBe(false);
    }
  });
});
