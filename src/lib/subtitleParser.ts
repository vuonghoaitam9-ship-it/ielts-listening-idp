import type { DictationLongSegment, TranscriptSegment } from '../types';

function parseClockToSeconds(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return Number(cleaned) || 0;
}

export function formatSecondsClock(sec: number, withMs = false): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const base = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (!withMs) return base;
  return `${base}.${String(ms).padStart(3, '0')}`;
}

export function parseSubtitlesToSegments(
  rawText: string,
  defaultPart: 1 | 2 | 3 | 4 = 1
): TranscriptSegment[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const segments: TranscriptSegment[] = [];
  const timeRangeRe =
    /(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?/;

  if (timeRangeRe.test(normalized)) {
    const blocks = normalized
      .replace(/^WEBVTT[^\n]*\n+/i, '')
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const timeIdx = lines.findIndex((l) => timeRangeRe.test(l));
      if (timeIdx === -1) continue;
      const [startStr, endStr] = lines[timeIdx].split('-->').map((x) => x.trim().split(/\s+/)[0]);
      const startTime = Number(parseClockToSeconds(startStr).toFixed(2));
      const endTime = Number(Math.max(startTime + 0.5, parseClockToSeconds(endStr)).toFixed(2));
      const text = lines
        .slice(timeIdx + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!text) continue;
      segments.push({
        id: `seg-${String(segments.length + 1).padStart(3, '0')}`,
        part: defaultPart,
        startTime,
        endTime,
        text,
        timestampSource: 'custom',
      });
    }
    return segments;
  }

  // Support LRC format: [mm:ss.xx] line text
  const lrcLines = normalized.split('\n');
  const lrcItems: { time: number; text: string }[] = [];
  for (const line of lrcLines) {
    const m = line.match(/^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*(.+)$/);
    if (m) {
      lrcItems.push({ time: parseClockToSeconds(m[1]), text: m[2].trim() });
    }
  }
  if (lrcItems.length > 0) {
    return lrcItems.map((item, idx) => {
      const nextTime = idx + 1 < lrcItems.length ? lrcItems[idx + 1].time : item.time + 5;
      return {
        id: `seg-${String(idx + 1).padStart(3, '0')}`,
        part: defaultPart,
        startTime: Number(item.time.toFixed(2)),
        endTime: Number(Math.max(item.time + 0.8, nextTime).toFixed(2)),
        text: item.text,
        timestampSource: 'custom',
      };
    });
  }

  return [];
}

export function exportSegmentsToVtt(segments: TranscriptSegment[]): string {
  const lines = ['WEBVTT', ''];
  segments.forEach((seg, idx) => {
    const startH = Math.floor(seg.startTime / 3600);
    const startM = Math.floor((seg.startTime % 3600) / 60);
    const startS = (seg.startTime % 60).toFixed(3).padStart(6, '0');
    const endH = Math.floor(seg.endTime / 3600);
    const endM = Math.floor((seg.endTime % 3600) / 60);
    const endS = (seg.endTime % 60).toFixed(3).padStart(6, '0');
    lines.push(String(idx + 1));
    lines.push(
      `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:${startS} --> ${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:${endS}`
    );
    lines.push(seg.text);
    lines.push('');
  });
  return lines.join('\n');
}

export function buildLongSegmentsFromShort(
  shortSegments: TranscriptSegment[]
): DictationLongSegment[] {
  const longSegments: DictationLongSegment[] = [];
  let i = 0;
  while (i < shortSegments.length) {
    const part = shortSegments[i].part;
    const startT = shortSegments[i].startTime;
    const group: TranscriptSegment[] = [shortSegments[i]];
    let j = i + 1;
    while (j < shortSegments.length && shortSegments[j].part === part) {
      const span = shortSegments[j].endTime - startT;
      if (group.length >= 5 || (group.length >= 3 && span >= 24) || span > 42) {
        break;
      }
      group.push(shortSegments[j]);
      j++;
    }
    longSegments.push({
      id: `long-${String(longSegments.length + 1).padStart(3, '0')}`,
      part,
      startTime: group[0].startTime,
      endTime: group[group.length - 1].endTime,
      text: group.map((g) => g.text).join(' '),
      segmentIds: group.map((g) => g.id),
      timestampSource: group[0].timestampSource,
    });
    i = j;
  }
  return longSegments;
}
