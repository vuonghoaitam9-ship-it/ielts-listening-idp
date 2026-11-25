import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  HelpCircle,
  Pause,
  Play,
  Repeat,
  RotateCcw,
} from 'lucide-react';
import { SaveVocabModal } from '../components/SaveVocabModal';
import { TimestampEditorModal } from '../components/TimestampEditorModal';
import { db } from '../db/database';
import { loadManifest, loadTestData, revokeManagedObjectUrls } from '../lib/dataLoader';
import { computeDictationDiff, type DictationDiffResult } from '../lib/dictationDiff';
import { buildLongSegmentsFromShort, formatSecondsClock } from '../lib/subtitleParser';
import type { ManifestData, TestData, TranscriptSegment } from '../types';

export function DictationPage() {
  const { vol, test } = useParams();
  const navigate = useNavigate();
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [selectedVol, setSelectedVol] = useState<number>(Number(vol) || 7);
  const [selectedTest, setSelectedTest] = useState<number>(Number(test) || 1);
  const [testData, setTestData] = useState<TestData | null>(null);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<'short' | 'long'>('short');
  const [partFilter, setPartFilter] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [segIndex, setSegIndex] = useState(0);

  const [userInput, setUserInput] = useState('');
  const [diffResult, setDiffResult] = useState<DictationDiffResult | null>(null);
  const [showFullAnswer, setShowFullAnswer] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [loopSegment, setLoopSegment] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);

  const [showTsModal, setShowTsModal] = useState(false);
  const [vocabTarget, setVocabTarget] = useState<{ word: string; example: string } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [bestMap, setBestMap] = useState<Record<string, number>>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loopRef = useRef(loopSegment);
  loopRef.current = loopSegment;

  useEffect(() => {
    loadManifest().then((m) => setManifest(m)).catch(() => {});
  }, []);

  useEffect(() => {
    if (vol && test) {
      setSelectedVol(Number(vol));
      setSelectedTest(Number(test));
    }
  }, [vol, test]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDiffResult(null);
    setShowFullAnswer(false);
    setUserInput('');
    setSegIndex(0);

    loadTestData(selectedVol, selectedTest)
      .then(async (data) => {
        if (!active) return;
        setTestData(data);
        if (data) {
          const rows = await db.dictationProgress
            .where('testId')
            .equals(data.id)
            .toArray();
          const map: Record<string, number> = {};
          for (const r of rows) map[`${r.mode}::${r.segmentId}`] = r.bestAccuracy;
          if (active) setBestMap(map);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setTestData(null);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      revokeManagedObjectUrls();
    };
  }, [selectedVol, selectedTest]);

  const activeList = useMemo(() => {
    if (!testData) return [];
    const base =
      mode === 'short' ? testData.transcriptSegments : testData.longSegments;
    return partFilter === 0 ? base : base.filter((s) => s.part === partFilter);
  }, [testData, mode, partFilter]);

  const currentSeg = activeList[segIndex] ?? null;

  useEffect(() => {
    setSegIndex(0);
    setUserInput('');
    setDiffResult(null);
    setShowFullAnswer(false);
  }, [mode, partFilter]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSeg) return;
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (isPlaying && audio.currentTime >= currentSeg.endTime) {
        if (loopRef.current) {
          audio.currentTime = currentSeg.startTime;
          audio.play().catch(() => {});
        } else {
          audio.pause();
          setIsPlaying(false);
        }
      }
    };
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [currentSeg, isPlaying]);

  const playCurrentSegment = () => {
    const audio = audioRef.current;
    if (!audio || !currentSeg) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    audio.currentTime = currentSeg.startTime;
    audio.playbackRate = speed;
    setIsPlaying(true);
    audio.play().catch(() => setIsPlaying(false));
  };

  const replayFromStart = () => {
    const audio = audioRef.current;
    if (!audio || !currentSeg) return;
    audio.currentTime = currentSeg.startTime;
    audio.playbackRate = speed;
    setIsPlaying(true);
    audio.play().catch(() => setIsPlaying(false));
  };

  const goSegment = (idx: number) => {
    const clamped = Math.max(0, Math.min(activeList.length - 1, idx));
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    setSegIndex(clamped);
    setUserInput('');
    setDiffResult(null);
    setShowFullAnswer(false);
  };

  // Keyboard shortcuts: Ctrl+Space replay, Ctrl+Left/Right navigate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        replayFromStart();
      } else if (e.ctrlKey && e.code === 'ArrowLeft') {
        e.preventDefault();
        goSegment(segIndex - 1);
      } else if (e.ctrlKey && e.code === 'ArrowRight') {
        e.preventDefault();
        goSegment(segIndex + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleCheck = async () => {
    if (!currentSeg || !testData) return;
    const res = computeDictationDiff(currentSeg.text, userInput);
    setDiffResult(res);

    const recordId = `${testData.id}::${mode}::${currentSeg.id}`;
    const prev = await db.dictationProgress.get(recordId);
    const best = Math.max(prev?.bestAccuracy ?? 0, res.accuracy);
    await db.dictationProgress.put({
      id: recordId,
      testId: testData.id,
      mode,
      segmentId: currentSeg.id,
      bestAccuracy: best,
      attempts: (prev?.attempts ?? 0) + 1,
      lastUserText: userInput,
      updatedAt: Date.now(),
    });
    setBestMap((m) => ({ ...m, [`${mode}::${currentSeg.id}`]: best }));
  };

  const handleHintNextWord = () => {
    if (!currentSeg) return;
    const expWords = currentSeg.text.trim().split(/\s+/);
    const curWords = userInput.trim() ? userInput.trim().split(/\s+/) : [];
    // Find first index where user diverges or stopped
    let targetIdx = 0;
    while (
      targetIdx < curWords.length &&
      targetIdx < expWords.length &&
      curWords[targetIdx].toLowerCase().replace(/[^a-z0-9]/g, '') ===
        expWords[targetIdx].toLowerCase().replace(/[^a-z0-9]/g, '')
    ) {
      targetIdx++;
    }
    if (targetIdx >= expWords.length) return;
    const nextList = [...curWords.slice(0, targetIdx), expWords[targetIdx]];
    setUserInput(nextList.join(' ') + ' ');
  };

  const handleHintNextLetter = () => {
    if (!currentSeg) return;
    const expWords = currentSeg.text.trim().split(/\s+/);
    const curWords = userInput.trim() ? userInput.trim().split(/\s+/) : [];
    let wIdx = 0;
    while (
      wIdx < curWords.length &&
      wIdx < expWords.length &&
      curWords[wIdx].toLowerCase().replace(/[^a-z0-9]/g, '') ===
        expWords[wIdx].toLowerCase().replace(/[^a-z0-9]/g, '')
    ) {
      wIdx++;
    }
    if (wIdx >= expWords.length) return;
    const targetWord = expWords[wIdx];
    const typedPartial = curWords[wIdx] ?? '';
    const nextCharCount = Math.min(targetWord.length, typedPartial.length + 1);
    const partial = targetWord.slice(0, nextCharCount);
    const rebuilt = [...curWords.slice(0, wIdx), partial].join(' ');
    setUserInput(rebuilt);
  };

  const handleApplyCustomTimestamps = (newSegs: TranscriptSegment[]) => {
    if (!testData) return;
    setTestData({
      ...testData,
      transcriptSegments: newSegs,
      longSegments: buildLongSegmentsFromShort(newSegs),
      hasExactTimestamps: true,
      timestampNote: 'Đang dùng mốc thời gian tùy chỉnh (IndexedDB).',
    });
    setSegIndex(0);
    setToastMsg('Đã cập nhật mốc thời gian mới cho bài Dictation.');
    setTimeout(() => setToastMsg(null), 3000);
  };

  const availableTestsForVol = useMemo(() => {
    if (!manifest) return [];
    return manifest.tests.filter((t) => t.vol === selectedVol);
  }, [manifest, selectedVol]);

  return (
    <div className="space-y-4">
      {toastMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#0f2942] text-white px-4 py-2 rounded text-xs font-medium shadow-md">
          {toastMsg}
        </div>
      )}

      {/* Top Controls */}
      <section className="bg-white border border-slate-300 rounded-md p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Luyện Dictation từ Audio gốc (Short &amp; Long)
            </h1>
            <p className="text-xs text-slate-600">
              Phát trực tiếp từng câu hoặc cụm đoạn trên audio thật Vol 7–10 · Chấm lỗi từng từ (Word-level Diff)
            </p>
          </div>

          {testData && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTsModal(true)}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Chỉnh Timestamp / Nhập SRT</span>
              </button>
              <Link
                to={`/exam/${selectedVol}/${selectedTest}`}
                className="px-3 py-1.5 rounded bg-[#0f2942] text-white text-xs font-medium hover:bg-[#1e3a8a]"
              >
                Mở bài thi PDF
              </Link>
            </div>
          )}
        </div>

        {/* Selectors */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="font-medium text-slate-700">Vol:</span>
            <select
              value={selectedVol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSelectedVol(v);
                setSelectedTest(1);
                navigate(`/dictation/${v}/1`);
              }}
              className="px-2 py-1 rounded border border-slate-300 bg-white cursor-pointer"
            >
              {[7, 8, 9, 10].map((v) => (
                <option key={v} value={v}>
                  Vol {v}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="font-medium text-slate-700">Test:</span>
            <select
              value={selectedTest}
              onChange={(e) => {
                const t = Number(e.target.value);
                setSelectedTest(t);
                navigate(`/dictation/${selectedVol}/${t}`);
              }}
              className="px-2 py-1 rounded border border-slate-300 bg-white cursor-pointer"
            >
              {availableTestsForVol.map((t) => (
                <option key={t.id} value={t.testNumber}>
                  Test {t.testNumber} {t.status === 'missing' ? '(Thiếu file)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center rounded border border-slate-300 overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('short')}
              className={`px-3 py-1 font-medium cursor-pointer ${
                mode === 'short' ? 'bg-[#0f2942] text-white' : 'bg-white text-slate-700'
              }`}
            >
              Đoạn ngắn (3–10s)
            </button>
            <button
              type="button"
              onClick={() => setMode('long')}
              className={`px-3 py-1 font-medium cursor-pointer ${
                mode === 'long' ? 'bg-[#0f2942] text-white' : 'bg-white text-slate-700'
              }`}
            >
              Đoạn dài (20–45s)
            </button>
          </div>

          <div className="flex items-center gap-1">
            {([0, 1, 2, 3, 4] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPartFilter(p)}
                className={`px-2.5 py-1 rounded border font-medium cursor-pointer ${
                  partFilter === p
                    ? 'bg-[#1e40af] text-white border-[#1e40af]'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                {p === 0 ? 'Tất cả Part' : `Part ${p}`}
              </button>
            ))}
          </div>
        </div>

        {testData && !testData.hasExactTimestamps && (
          <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {testData.timestampNote} Bấm <strong>Chỉnh Timestamp / Nhập SRT</strong> để căn mốc chuẩn nếu đoạn cắt lệch vài giây.
            </span>
          </div>
        )}
      </section>

      {loading && (
        <div className="bg-white border border-slate-300 rounded-md p-8 text-center text-sm text-slate-600">
          Đang nạp audio và phân đoạn transcript...
        </div>
      )}

      {!loading && !testData && (
        <div className="bg-white border border-slate-300 rounded-md p-6 space-y-2 text-xs">
          <div className="font-semibold text-sm text-slate-900">
            Vol {selectedVol} Test {selectedTest} chưa có dữ liệu Listening
          </div>
          <p className="text-slate-600">
            Vui lòng vào mục <strong>Dữ liệu Vol 7–10</strong> để tải lên file Audio gốc và Transcript/SRT cục bộ.
          </p>
          <Link
            to="/data"
            className="inline-block px-3 py-1.5 rounded bg-[#0f2942] text-white font-medium"
          >
            Mở Quản lý dữ liệu
          </Link>
        </div>
      )}

      {!loading && testData && currentSeg && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left 2 cols: Dictation player + input + diff */}
          <div className="lg:col-span-2 space-y-4">
            <audio ref={audioRef} src={testData.audioUrl} preload="metadata" />

            {/* Player Card */}
            <div className="bg-white border border-slate-300 rounded-md p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-semibold">
                    {mode === 'short' ? 'Đoạn ngắn' : 'Đoạn dài'} #{segIndex + 1}/{activeList.length}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                    Part {currentSeg.part}
                  </span>
                  <span className="font-mono text-slate-600 tabular-nums">
                    {formatSecondsClock(currentSeg.startTime)} – {formatSecondsClock(currentSeg.endTime)} (
                    {(currentSeg.endTime - currentSeg.startTime).toFixed(1)}s)
                  </span>
                </div>

                {bestMap[`${mode}::${currentSeg.id}`] !== undefined && (
                  <span className="text-emerald-700 font-semibold tabular-nums">
                    Cao nhất: {bestMap[`${mode}::${currentSeg.id}`]}%
                  </span>
                )}
              </div>

              {/* Audio buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={playCurrentSegment}
                  className="px-3.5 py-1.5 rounded bg-[#1e40af] hover:bg-[#1e3a8a] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isPlaying ? 'Tạm dừng' : 'Phát đoạn này'}</span>
                </button>

                <button
                  type="button"
                  onClick={replayFromStart}
                  className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium flex items-center gap-1 cursor-pointer"
                  title="Phím tắt: Ctrl + Space"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Nghe lại (Ctrl+Space)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setLoopSegment((v) => !v)}
                  className={`px-3 py-1.5 rounded border text-xs font-medium flex items-center gap-1 cursor-pointer ${
                    loopSegment
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Lặp đoạn</span>
                </button>

                <label className="flex items-center gap-1 text-xs ml-auto">
                  <span className="text-slate-600">Tốc độ:</span>
                  <select
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    className="px-2 py-1 rounded border border-slate-300 bg-white cursor-pointer"
                  >
                    {[0.6, 0.75, 0.85, 1.0, 1.15, 1.25].map((r) => (
                      <option key={r} value={r}>
                        {r}x
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Segment Progress */}
              <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-[#1e40af] transition-all"
                  style={{
                    width: `${
                      currentSeg.endTime > currentSeg.startTime
                        ? Math.max(
                            0,
                            Math.min(
                              100,
                              ((currentTime - currentSeg.startTime) /
                                (currentSeg.endTime - currentSeg.startTime)) *
                                100
                            )
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>

              {/* Typing area */}
              <div className="space-y-2 pt-1">
                <textarea
                  rows={mode === 'long' ? 5 : 3}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="Nghe và gõ lại chính xác những gì bạn nghe được..."
                  spellCheck={false}
                  className="w-full p-3 rounded border border-slate-300 text-sm focus:outline-2 focus:outline-[#1e40af]"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleHintNextLetter}
                      className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Gợi ý chữ cái</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleHintNextWord}
                      className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer"
                    >
                      Gợi ý 1 từ
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFullAnswer((v) => !v)}
                      className="px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{showFullAnswer ? 'Ẩn đáp án' : 'Hiện đáp án'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goSegment(segIndex - 1)}
                      disabled={segIndex <= 0}
                      className="px-2.5 py-1.5 rounded border border-slate-300 bg-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Trước</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCheck}
                      className="px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Kiểm tra</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => goSegment(segIndex + 1)}
                      disabled={segIndex >= activeList.length - 1}
                      className="px-2.5 py-1.5 rounded border border-slate-300 bg-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                    >
                      <span>Tiếp</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {showFullAnswer && (
                <div className="p-3 rounded bg-slate-100 border border-slate-300 text-xs space-y-1">
                  <div className="font-semibold text-slate-700">Transcript gốc:</div>
                  <div className="text-slate-900 leading-relaxed">{currentSeg.text}</div>
                </div>
              )}
            </div>

            {/* Word-level Diff Output */}
            {diffResult && (
              <div className="bg-white border border-slate-300 rounded-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-900 tabular-nums">
                      Độ chính xác: {diffResult.accuracy}%
                    </span>
                    <span className="text-xs text-slate-600">
                      Đúng {diffResult.correctCount}/{diffResult.totalExpected} · Sai chính tả{' '}
                      {diffResult.misspelledCount} · Thiếu {diffResult.missingCount} · Dư{' '}
                      {diffResult.extraCount}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Bấm vào bất kỳ từ nào để lưu sang Flashcard SM-2
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 leading-relaxed">
                  {diffResult.tokens.map((tok, i) => {
                    let cls = 'bg-emerald-100 text-emerald-900 border-emerald-300';
                    let label = tok.word;
                    if (tok.status === 'misspelled') {
                      cls = 'bg-amber-100 text-amber-950 border-amber-400';
                      label = `${tok.word} → ${tok.expected}`;
                    } else if (tok.status === 'missing') {
                      cls = 'bg-red-100 text-red-900 border-red-300';
                      label = `[thiếu: ${tok.word}]`;
                    } else if (tok.status === 'extra') {
                      cls = 'bg-slate-200 text-slate-700 border-slate-400 line-through';
                    }

                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          setVocabTarget({
                            word: (tok.expected || tok.word).replace(/[^a-zA-Z0-9'-]/g, ''),
                            example: currentSeg.text,
                          })
                        }
                        className={`px-1.5 py-0.5 rounded border text-xs font-medium cursor-pointer hover:opacity-80 ${cls}`}
                        title="Lưu từ này vào Flashcard"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 border border-emerald-400" /> Đúng
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-200 border border-amber-400" /> Sai chính tả
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-red-200 border border-red-400" /> Thiếu từ
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm bg-slate-300 border border-slate-500" /> Dư từ
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setVocabTarget({ word: '', example: currentSeg.text })
                    }
                    className="inline-flex items-center gap-1 text-[#1e40af] font-medium hover:underline cursor-pointer"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    <span>Lưu cụm từ từ đoạn này</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right column: Segment selector list */}
          <aside className="bg-white border border-slate-300 rounded-md flex flex-col max-h-[600px]">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 text-xs font-semibold flex items-center justify-between">
              <span>
                Danh sách đoạn ({activeList.length})
              </span>
              <span className="text-[11px] font-normal text-slate-500">
                {mode === 'short' ? 'Short' : 'Long'}
              </span>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-slate-100">
              {activeList.map((seg, idx) => {
                const best = bestMap[`${mode}::${seg.id}`];
                const isCur = idx === segIndex;
                return (
                  <button
                    key={seg.id}
                    type="button"
                    onClick={() => goSegment(idx)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 cursor-pointer ${
                      isCur ? 'bg-blue-50 text-[#0f2942] font-semibold' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono">#{idx + 1}</span>
                        <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                          P{seg.part}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {formatSecondsClock(seg.startTime)}
                        </span>
                      </div>
                    </div>
                    {best !== undefined && (
                      <span
                        className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded ${
                          best >= 85
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {best}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      )}

      {showTsModal && testData && (
        <TimestampEditorModal
          testId={testData.id}
          audioUrl={testData.audioUrl}
          audioDurationSec={testData.audioDurationSec}
          initialSegments={testData.transcriptSegments}
          onClose={() => setShowTsModal(false)}
          onApplied={handleApplyCustomTimestamps}
        />
      )}

      {vocabTarget && testData && (
        <SaveVocabModal
          initialWord={vocabTarget.word}
          initialExample={vocabTarget.example}
          sourceTestId={testData.id}
          onClose={() => setVocabTarget(null)}
          onSaved={(w) => {
            setToastMsg(`Đã lưu "${w}" vào kho Flashcard SM-2.`);
            setTimeout(() => setToastMsg(null), 3000);
          }}
        />
      )}
    </div>
  );
}
