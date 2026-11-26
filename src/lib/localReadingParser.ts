import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { expandAcceptedVariants } from './grading';
import type {
  ReadingLocalOverride,
  ReadingParagraph,
  ReadingPassage,
  ReadingQuestion,
  ReadingQuestionGroup,
  ReadingTestData,
} from '../types/reading';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

export interface PdfInspectionResult {
  pageCount: number;
  totalChars: number;
  avgCharsPerPage: number;
  isScanned: boolean;
  extractedText: string;
}

export async function inspectReadingPdfFile(file: File): Promise<PdfInspectionResult> {
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const doc = await loadingTask.promise;

  const pageTexts: string[] = [];
  let totalChars = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    totalChars += text.length;
    pageTexts.push(text);
  }

  await doc.destroy();
  const avgCharsPerPage = totalChars / Math.max(1, doc.numPages);
  return {
    pageCount: doc.numPages,
    totalChars,
    avgCharsPerPage,
    isScanned: avgCharsPerPage < 200,
    extractedText: pageTexts.join('\n\n'),
  };
}

/**
 * Parses raw IELTS Reading answer keys ("1. TRUE", "Q14: B", "27: solar energy / sunlight").
 */
export function parseReadingKeyText(raw: string): Record<number, string[]> {
  const map: Record<number, string[]> = {};
  if (!raw.trim()) return map;

  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/(?:^|\s)(?:Q\.?\s*)?([1-9]|[1-3]\d|40)\s*[.):\-–]\s*/g, '\n$1: ');

  for (const line of normalized.split('\n')) {
    const m = /^\s*([1-9]|[1-3]\d|40)\s*[:.]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const qNum = Number(m[1]);
    const val = m[2].trim();
    if (!val || qNum < 1 || qNum > 40) continue;

    const expanded = expandAcceptedVariants(val);
    map[qNum] = expanded.length > 0 ? expanded : [val];
  }

  return map;
}

function defaultRangeForPassage(passageNumber: 1 | 2 | 3): [number, number] {
  if (passageNumber === 1) return [1, 13];
  if (passageNumber === 2) return [14, 26];
  return [27, 40];
}

function buildFallbackPassagesFromKeys(
  keyMap: Record<number, string[]>
): ReadingPassage[] {
  return ([1, 2, 3] as const).map((passageNumber) => {
    const [start, end] = defaultRangeForPassage(passageNumber);
    const questions: ReadingQuestion[] = [];
    for (let q = start; q <= end; q++) {
      questions.push({
        number: q,
        prompt: `Câu ${q} (xem nội dung trên đề PDF)`,
        type: 'short_answer',
        acceptedAnswers: keyMap[q] ?? [],
        evidenceParagraphId: '',
        evidenceLocation: '',
        evidenceQuote: '',
        evidenceTranslationVi: '',
        explanationVi:
          keyMap[q]?.length
            ? `Đáp án chuẩn theo Key tải lên: ${keyMap[q][0]}.`
            : 'Chưa có đáp án trong Key tải lên.',
      });
    }
    const group: ReadingQuestionGroup = {
      id: `local-p${passageNumber}-g1`,
      questionRange: [start, end],
      type: 'short_answer',
      instruction: `Questions ${start}–${end}: Xem đề PDF bên trái và nhập đáp án tương ứng.`,
      questions,
    };
    return {
      passageNumber,
      title: `Reading Passage ${passageNumber}`,
      questionRange: [start, end],
      paragraphs: [],
      groups: [group],
    };
  });
}

function parseStructuredTextToPassages(
  rawText: string,
  keyMap: Record<number, string[]>
): ReadingPassage[] {
  const passageChunks = rawText.split(/READING\s+PASSAGE\s+[123]/i);
  const bodyChunks = passageChunks.length >= 4 ? passageChunks.slice(1, 4) : [rawText];

  return ([1, 2, 3] as const).map((passageNumber, idx) => {
    const chunk = (bodyChunks[idx] ?? '').trim();

    const qSplitIdx = chunk.search(/\bQuestions?\s+\d{1,2}\s*[-–]/i);
    const passageBody = (qSplitIdx >= 0 ? chunk.slice(0, qSplitIdx) : chunk).trim();

    const lines = passageBody
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);

    const title = lines[0]?.slice(0, 140) || `Reading Passage ${passageNumber}`;
    const paraBlocks = lines.slice(1);
    const paragraphs: ReadingParagraph[] = (
      paraBlocks.length > 0 ? paraBlocks : passageBody ? [passageBody] : []
    ).map((block, pIdx) => {
      const labelMatch = /^([A-M])\s+[A-Z"'(]/.exec(block);
      const label = labelMatch ? labelMatch[1] : undefined;
      const text = label ? block.slice(1).trim() : block;
      return {
        id: `p${passageNumber}-${label || pIdx + 1}`,
        label,
        text,
      };
    });

    const fallback = buildFallbackPassagesFromKeys(keyMap)[idx];
    return {
      ...fallback,
      title,
      paragraphs,
    };
  });
}

export async function createReadingLocalOverrideFromUpload(params: {
  vol: number;
  test: number;
  examFile?: File | null;
  rawKeyText: string;
}): Promise<ReadingLocalOverride> {
  const { vol, test, examFile, rawKeyText } = params;
  const testId = `vol-${vol}-test-${test}`;
  const keyMap = parseReadingKeyText(rawKeyText);

  if (examFile && examFile.name.toLowerCase().endsWith('.json')) {
    const jsonText = await examFile.text();
    const parsed = JSON.parse(jsonText) as ReadingTestData;
    if (!Array.isArray(parsed.passages) || parsed.passages.length !== 3) {
      throw new Error('File JSON không hợp lệ: cần đủ 3 Passage.');
    }

    let keyCount = 0;
    const passages = parsed.passages.map((p) => ({
      ...p,
      groups: p.groups.map((g) => ({
        ...g,
        questions: g.questions.map((q) => {
          const accepted = keyMap[q.number] ?? q.acceptedAnswers ?? [];
          if (accepted.length > 0) keyCount++;
          return { ...q, acceptedAnswers: accepted };
        }),
      })),
    }));

    return {
      testId,
      vol,
      test,
      updatedAt: Date.now(),
      sourceMode: 'structured',
      rawKeyText,
      testData: {
        ...parsed,
        vol,
        test,
        testId,
        keyCount,
        hasKey: keyCount > 0,
        status: keyCount >= 40 ? 'ready' : 'partial',
        passages,
      },
    };
  }

  if (examFile && examFile.name.toLowerCase().endsWith('.pdf')) {
    const info = await inspectReadingPdfFile(examFile);
    if (info.isScanned) {
      const passages = buildFallbackPassagesFromKeys(keyMap);
      const keyCount = Object.keys(keyMap).length;
      return {
        testId,
        vol,
        test,
        updatedAt: Date.now(),
        sourceMode: 'scanned_pdf',
        pdfBlob: examFile,
        rawKeyText,
        missingNote: `PDF scan (${info.avgCharsPerPage.toFixed(0)} ký tự/trang < 200): hiển thị trực tiếp bản PDF gốc.`,
        testData: {
          vol,
          test,
          testId,
          title: `Vol ${vol} - Test ${test} (PDF Scan cục bộ)`,
          sourceName: examFile.name,
          status: keyCount >= 40 ? 'ready' : 'partial',
          hasKey: keyCount > 0,
          keyCount,
          passages,
          sourceMode: 'scanned_pdf',
        },
      };
    }

    const passages = parseStructuredTextToPassages(info.extractedText, keyMap);
    const keyCount = Object.keys(keyMap).length;
    return {
      testId,
      vol,
      test,
      updatedAt: Date.now(),
      sourceMode: 'structured',
      rawKeyText,
      testData: {
        vol,
        test,
        testId,
        title: `Vol ${vol} - Test ${test} (PDF cục bộ)`,
        sourceName: examFile.name,
        status: keyCount >= 40 ? 'ready' : 'partial',
        hasKey: keyCount > 0,
        keyCount,
        passages,
      },
    };
  }

  // Plain text file or key-only upload
  const textContent = examFile ? await examFile.text() : '';
  const passages = parseStructuredTextToPassages(textContent, keyMap);
  const keyCount = Object.keys(keyMap).length;

  return {
    testId,
    vol,
    test,
    updatedAt: Date.now(),
    sourceMode: 'structured',
    rawKeyText,
    testData: {
      vol,
      test,
      testId,
      title: `Vol ${vol} - Test ${test} (Tải lên cục bộ)`,
      sourceName: examFile?.name ?? 'Key cục bộ',
      status: keyCount >= 40 ? 'ready' : 'partial',
      hasKey: keyCount > 0,
      keyCount,
      passages,
    },
  };
}
