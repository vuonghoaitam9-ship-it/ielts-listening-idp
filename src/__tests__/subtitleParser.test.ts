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
});
