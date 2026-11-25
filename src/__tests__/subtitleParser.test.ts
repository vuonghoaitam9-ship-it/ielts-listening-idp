import { describe, expect, it } from 'vitest';
import {
  buildLongSegmentsFromShort,
  exportSegmentsToVtt,
  parseSubtitlesToSegments,
} from '../lib/subtitleParser';

describe('Subtitle & Timestamp parser', () => {
  it('parses SRT and VTT formats and exports valid VTT', () => {
    const srt = `1
00:00:05,200 --> 00:00:09,800
Hello, Clarence House Hotel.

2
00:00:10,000 --> 00:00:15,500
I'm calling about wedding arrangements.`;

    const segs = parseSubtitlesToSegments(srt, 1);
    expect(segs).toHaveLength(2);
    expect(segs[0].startTime).toBe(5.2);
    expect(segs[0].endTime).toBe(9.8);
    expect(segs[1].text).toContain('wedding arrangements');

    const vtt = exportSegmentsToVtt(segs);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    const reParsed = parseSubtitlesToSegments(vtt, 1);
    expect(reParsed).toHaveLength(2);
    expect(reParsed[0].startTime).toBe(5.2);
  });

  it('parses LRC format and builds long segments within each Part', () => {
    const lrc = `[00:05.00] First sentence.
[00:10.50] Second sentence.
[00:16.00] Third sentence.
[00:24.00] Fourth sentence.`;

    const shortSegs = parseSubtitlesToSegments(lrc, 2);
    expect(shortSegs).toHaveLength(4);
    const longSegs = buildLongSegmentsFromShort(shortSegs);
    expect(longSegs.length).toBeGreaterThanOrEqual(1);
    expect(longSegs[0].part).toBe(2);
    expect(longSegs[0].segmentIds.length).toBeGreaterThanOrEqual(2);
  });

  it('splits long dictation groups cleanly across silence gaps > 2.5s within the same Part', () => {
    const shortSegs = [
      { id: 'seg-001', part: 1 as const, startTime: 20, endTime: 25, text: 'First sentence before pause.', timestampSource: 'exact' as const },
      { id: 'seg-002', part: 1 as const, startTime: 25.4, endTime: 30, text: 'Second sentence before pause.', timestampSource: 'exact' as const },
      { id: 'seg-003', part: 1 as const, startTime: 60.5, endTime: 65, text: 'First sentence after 30s silence.', timestampSource: 'exact' as const },
      { id: 'seg-004', part: 1 as const, startTime: 65.3, endTime: 71, text: 'Second sentence after 30s silence.', timestampSource: 'exact' as const },
    ];
    const longSegs = buildLongSegmentsFromShort(shortSegs);
    expect(longSegs).toHaveLength(2);
    expect(longSegs[0].segmentIds).toEqual(['seg-001', 'seg-002']);
    expect(longSegs[0].endTime).toBe(30);
    expect(longSegs[1].segmentIds).toEqual(['seg-003', 'seg-004']);
    expect(longSegs[1].startTime).toBe(60.5);
  });
});
