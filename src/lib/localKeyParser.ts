import { expandAcceptedVariants } from './grading';
import { buildLongSegmentsFromShort, parseSubtitlesToSegments } from './subtitleParser';
import type { PartData, QuestionItem, TestData, TranscriptSegment } from '../types';

export function parseRawKeyText(rawKey: string): Record<number, { raw: string; accepted: string[] }> {
  const result: Record<number, { raw: string; accepted: string[] }> = {};
  const lines = rawKey
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Format: "1. city" or "1: city" or "Câu số 1: city"
    const m = line.match(/^(?:câu\s*số\s*)?(\d{1,2})\s*[.:)\-]\s*(.+)$/i);
    if (m) {
      const q = Number(m[1]);
      if (q >= 1 && q <= 40) {
        const val = m[2].trim();
        result[q] = { raw: val, accepted: expandAcceptedVariants(val) };
      }
    }
  }

  // Fallback if user pasted 40 plain lines without numbers
  if (Object.keys(result).length === 0 && lines.length >= 10) {
    lines.slice(0, 40).forEach((val, idx) => {
      const q = idx + 1;
      result[q] = { raw: val, accepted: expandAcceptedVariants(val) };
    });
  }
  return result;
}

export function parseRawTranscriptToSegments(
  rawTranscript: string,
  durationSec: number
): TranscriptSegment[] {
  const subs = parseSubtitlesToSegments(rawTranscript, 1);
  if (subs.length > 0) return subs;

  const sentences = rawTranscript
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return [];
  const totalChars = sentences.reduce((sum, s) => sum + Math.max(s.length, 10), 0);
  const safeDur = Math.max(durationSec, sentences.length * 4);
  let cursor = 0;

  return sentences.map((text, idx) => {
    const share = (Math.max(text.length, 10) / totalChars) * safeDur;
    const startTime = Number(cursor.toFixed(2));
    const endTime = Number(Math.min(safeDur, cursor + Math.max(share, 1.5)).toFixed(2));
    cursor = endTime;
    const part = (Math.min(4, Math.floor((idx / sentences.length) * 4) + 1) as 1 | 2 | 3 | 4);
    return {
      id: `seg-${String(idx + 1).padStart(3, '0')}`,
      part,
      startTime,
      endTime,
      text,
      timestampSource: 'estimated',
    };
  });
}

export function buildLocalTestData(params: {
  testId: string;
  vol: number;
  testNumber: number;
  title: string;
  pdfUrl: string;
  pdfPages: number;
  audioUrl: string;
  audioDurationSec: number;
  rawKeyText: string;
  rawTranscriptText: string;
}): TestData {
  const keyMap = parseRawKeyText(params.rawKeyText);
  const segs = parseRawTranscriptToSegments(params.rawTranscriptText, params.audioDurationSec);
  const longSegs = buildLongSegmentsFromShort(segs);

  const parts: PartData[] = [1, 2, 3, 4].map((p) => {
    const partNum = p as 1 | 2 | 3 | 4;
    const pSegs = segs.filter((s) => s.part === partNum);
    const startTime = pSegs[0]?.startTime ?? ((p - 1) * params.audioDurationSec) / 4;
    const endTime = pSegs[pSegs.length - 1]?.endTime ?? (p * params.audioDurationSec) / 4;
    return {
      partNumber: partNum,
      title: `Part ${p}`,
      questionRange: [(p - 1) * 10 + 1, p * 10],
      startTime,
      endTime,
      topicHint: `Section ${p} (Questions ${(p - 1) * 10 + 1}–${p * 10})`,
    };
  });

  const questions: QuestionItem[] = Array.from({ length: 40 }, (_, i) => {
    const q = i + 1;
    const part = (Math.floor(i / 10) + 1) as 1 | 2 | 3 | 4;
    const entry = keyMap[q];
    const seg = segs[Math.min(segs.length - 1, Math.floor((i / 40) * segs.length))];
    return {
      number: q,
      part,
      promptContext: '',
      answerRaw: entry?.raw ?? '',
      canonicalAnswer: entry?.raw ?? '',
      acceptedAnswers: entry?.accepted ?? (entry?.raw ? [entry.raw] : []),
      sharedGroup: null,
      evidenceQuote: seg?.text ?? '',
      evidenceStartTime: seg?.startTime ?? 0,
      evidenceEndTime: seg?.endTime ?? 5,
      paraphrases: [],
      distractors: [],
      explanationVi: entry?.raw
        ? `Đáp án chuẩn là "${entry.raw}" (từ tệp Key người dùng nạp cục bộ).`
        : 'Chưa có đáp án cho câu này trong tệp Key cục bộ.',
    };
  });

  return {
    id: params.testId,
    vol: params.vol,
    testNumber: params.testNumber,
    title: params.title,
    pdfUrl: params.pdfUrl,
    pdfPages: params.pdfPages,
    questionPageRange: [1, Math.max(1, params.pdfPages)],
    audioUrl: params.audioUrl,
    audioDurationSec: params.audioDurationSec,
    hasExactTimestamps: segs.some((s) => s.timestampSource === 'custom'),
    timestampNote: 'Dữ liệu nạp cục bộ từ trình duyệt (lưu trong IndexedDB).',
    parts,
    questions,
    transcriptSegments: segs,
    longSegments: longSegs,
    isLocalOverride: true,
  };
}
