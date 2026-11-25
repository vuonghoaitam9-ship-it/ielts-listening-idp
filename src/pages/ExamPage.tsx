import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Eye, Play, ShieldCheck, Sliders } from 'lucide-react';
import { AnswerSheet } from '../components/AnswerSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExamAudioBar } from '../components/ExamAudioBar';
import { ExamReviewView } from '../components/ExamReviewView';
import { IdpHeader } from '../components/IdpHeader';
import { PdfExamViewer } from '../components/PdfExamViewer';
import { QuestionPalette } from '../components/QuestionPalette';
import { db } from '../db/database';
import { pauseOthers, registerAudio } from '../lib/audioCoordinator';
import { loadTestData, revokeManagedObjectUrls } from '../lib/dataLoader';
import { gradeListeningExam } from '../lib/grading';
import type {
  ContrastTheme,
  ExamAttempt,
  ExamAudioMode,
  ExamTimerMode,
  FontScale,
  TestData,
} from '../types';

const IDP_LISTEN_SEC = 30 * 60;
const IDP_CHECK_SEC = 2 * 60;

export function ExamPage() {
  const { vol, test } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const volNum = Number(vol);
  const testNum = Number(test);
  const attemptIdParam = searchParams.get('attemptId');

  const [testData, setTestData] = useState<TestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Setup modal state before starting exam
  const [examStarted, setExamStarted] = useState(false);
  const [audioMode, setAudioMode] = useState<ExamAudioMode>('practice');
  const [timerMode, setTimerMode] = useState<ExamTimerMode>('idp');

  // IDP display settings
  const [theme, setTheme] = useState<ContrastTheme>('light');
  const [fontScale, setFontScale] = useState<FontScale>('standard');
  const [hiddenScreen, setHiddenScreen] = useState(false);

  // Split pane width %
  const [leftPct, setLeftPct] = useState(55);
  const isDraggingRef = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  // Exam state
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [activePart, setActivePart] = useState<1 | 2 | 3 | 4 | 'all'>('all');
  const [activeQuestion, setActiveQuestion] = useState(1);
  const [notepadText, setNotepadText] = useState('');
  const [submittedAttempt, setSubmittedAttempt] = useState<ExamAttempt | null>(null);
  const [confirmAction, setConfirmAction] = useState<'submit' | 'exit' | null>(null);

  // Audio state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [hasStartedRealAudio, setHasStartedRealAudio] = useState(false);

  // Clock state
  const [elapsedSec, setElapsedSec] = useState(0);
  const [remainingSec, setRemainingSec] = useState(IDP_LISTEN_SEC);
  const [timerPhase, setTimerPhase] = useState<'listening' | 'check' | 'finished'>('listening');

  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const draftKey = `idp-draft-v${volNum}-t${testNum}`;
  const noteKey = `idp-note-v${volNum}-t${testNum}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadErr(null);
    setSubmittedAttempt(null);
    setExamStarted(false);
    setAnswers({});
    setFlagged(new Set());
    setNotepadText('');
    setElapsedSec(0);
    setRemainingSec(IDP_LISTEN_SEC);
    setTimerPhase('listening');
    setHasStartedRealAudio(false);
    setCurrentTime(0);
    setIsPlaying(false);

    loadTestData(volNum, testNum)
      .then(async (data) => {
        if (!active) return;
        if (!data) {
          setLoadErr(
            `Bài thi Vol ${volNum} Test ${testNum} chưa có dữ liệu. Vui lòng nạp file cục bộ trong mục Quản lý dữ liệu.`
          );
          setLoading(false);
          return;
        }
        setTestData(data);
        setDuration(data.audioDurationSec || 0);

        const savedNote = localStorage.getItem(noteKey);
        if (savedNote) setNotepadText(savedNote);

        if (attemptIdParam) {
          const past = await db.examAttempts.get(Number(attemptIdParam));
          if (past && active) {
            setAnswers(past.answers);
            setFlagged(new Set(past.flagged));
            setSubmittedAttempt(past);
            setExamStarted(true);
          }
        } else {
          const savedDraft = localStorage.getItem(draftKey);
          if (savedDraft) {
            try {
              const parsed = JSON.parse(savedDraft);
              if (parsed.answers) setAnswers(parsed.answers);
              if (Array.isArray(parsed.flagged)) setFlagged(new Set(parsed.flagged));
            } catch {
              // ignore corrupt draft
            }
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setLoadErr(err instanceof Error ? err.message : 'Lỗi nạp dữ liệu đề thi.');
        setLoading(false);
      });

    return () => {
      active = false;
      revokeManagedObjectUrls();
    };
  }, [volNum, testNum, attemptIdParam, draftKey, noteKey]);

  // Persist draft answers & notepad
  useEffect(() => {
    if (!testData || submittedAttempt) return;
    localStorage.setItem(
      draftKey,
      JSON.stringify({ answers, flagged: Array.from(flagged) })
    );
  }, [answers, flagged, draftKey, testData, submittedAttempt]);

  useEffect(() => {
    if (!testData) return;
    localStorage.setItem(noteKey, notepadText);
  }, [notepadText, noteKey, testData]);

  // Sync volume, speed & single-audio registration to HTMLAudioElement
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const unreg = registerAudio(el);
    const onPlay = () => pauseOthers(el);
    el.addEventListener('play', onPlay);
    return () => {
      el.removeEventListener('play', onPlay);
      unreg();
    };
  }, [testData?.audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = audioMode === 'real' ? 1.0 : playbackRate;
    }
  }, [playbackRate, audioMode]);

  // Split-screen drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.max(28, Math.min(72, pct)));
    };
    const onUp = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Exam timer tick
  useEffect(() => {
    if (!examStarted || submittedAttempt || hiddenScreen) return;
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
      if (timerMode === 'idp') {
        setRemainingSec((prev) => {
          if (prev > 1) return prev - 1;
          if (timerPhase === 'listening') {
            setTimerPhase('check');
            return IDP_CHECK_SEC;
          }
          setTimerPhase('finished');
          return 0;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [examStarted, submittedAttempt, hiddenScreen, timerMode, timerPhase]);

  // Auto-submit when IDP 2-minute check phase ends
  useEffect(() => {
    if (timerMode === 'idp' && timerPhase === 'finished' && !submittedAttempt && testData) {
      handleSubmitExam(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerPhase]);

  // Keyboard shortcuts for practice audio (Alt+Space, Alt+Left, Alt+Right)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!examStarted || submittedAttempt || audioMode === 'real') return;
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.altKey && e.code === 'ArrowLeft') {
        e.preventDefault();
        skipAudio(-5);
      } else if (e.altKey && e.code === 'ArrowRight') {
        e.preventDefault();
        skipAudio(5);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (audioMode === 'real' && hasStartedRealAudio && !el.paused) {
      return;
    }
    if (el.paused) {
      el.play().then(() => {
        setIsPlaying(true);
        if (audioMode === 'real') setHasStartedRealAudio(true);
      }).catch(() => {});
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const seekAudio = (sec: number) => {
    if (audioMode === 'real' || !audioRef.current) return;
    const clamped = Math.max(0, Math.min(duration || 9999, sec));
    audioRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const skipAudio = (delta: number) => {
    if (audioMode === 'real' || !audioRef.current) return;
    seekAudio(audioRef.current.currentTime + delta);
  };

  const answeredCount = useMemo(
    () =>
      Object.values(answers).filter((v) => v.trim().length > 0).length,
    [answers]
  );

  const handleSelectQuestion = (qNum: number) => {
    setActiveQuestion(qNum);
    const targetPart = (Math.floor((qNum - 1) / 10) + 1) as 1 | 2 | 3 | 4;
    if (activePart !== 'all' && activePart !== targetPart) {
      setActivePart(targetPart);
    }
    setTimeout(() => {
      const inp = inputRefs.current.get(qNum);
      if (inp) {
        inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inp.focus();
      }
    }, 30);
  };

  const handleSubmitExam = async (autoTriggered = false) => {
    if (!testData || submittedAttempt) return;
    if (!autoTriggered && answeredCount < 40) {
      setConfirmAction('submit');
      return;
    }
    await finalizeSubmitExam();
  };

  const finalizeSubmitExam = async () => {
    if (!testData || submittedAttempt) return;
    setConfirmAction(null);
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    const graded = gradeListeningExam(
      testData.questions,
      answers,
      Array.from(flagged)
    );
    const attempt: ExamAttempt = {
      testId: testData.id,
      vol: testData.vol,
      testNumber: testData.testNumber,
      testTitle: testData.title,
      createdAt: Date.now(),
      durationUsedSec: elapsedSec,
      mode: audioMode,
      timerMode,
      answers: { ...answers },
      flagged: Array.from(flagged),
      ...graded,
    };
    const id = await db.examAttempts.add(attempt);
    attempt.id = id;
    localStorage.removeItem(draftKey);
    setSubmittedAttempt(attempt);
  };

  const handleExit = () => {
    if (examStarted && !submittedAttempt && answeredCount > 0) {
      setConfirmAction('exit');
      return;
    }
    navigate('/');
  };

  const handleRetryExam = () => {
    setSubmittedAttempt(null);
    setAnswers({});
    setFlagged(new Set());
    setElapsedSec(0);
    setRemainingSec(IDP_LISTEN_SEC);
    setTimerPhase('listening');
    setHasStartedRealAudio(false);
    setCurrentTime(0);
    setIsPlaying(false);
    setExamStarted(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-sm text-slate-600">
        Đang tải dữ liệu phòng thi IDP...
      </div>
    );
  }

  if (loadErr || !testData) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-300 rounded-md p-6 max-w-md w-full space-y-3 text-sm">
          <h2 className="font-semibold text-slate-900">Không thể mở bài thi</h2>
          <p className="text-xs text-slate-600">{loadErr}</p>
          <div className="flex items-center gap-2 pt-2">
            <Link
              to="/data"
              className="px-3 py-1.5 rounded bg-[#0f2942] text-white text-xs font-medium"
            >
              Mở Quản lý dữ liệu
            </Link>
            <Link
              to="/"
              className="px-3 py-1.5 rounded border border-slate-300 text-xs"
            >
              Về trang chủ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Pre-exam setup screen
  if (!examStarted && !submittedAttempt) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-4">
        <div className="bg-white border border-slate-300 rounded-md shadow-sm max-w-xl w-full p-6 space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              IDP Computer-Delivered IELTS Listening
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-1">{testData.title}</h1>
            <p className="text-xs text-slate-600 mt-1">
              Đề gốc PDF ({testData.questionPageRange[1]} trang hiển thị) · Audio gốc (
              {Math.round(testData.audioDurationSec / 60)} phút) · 40 câu hỏi
            </p>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <div className="font-semibold text-slate-800 mb-1.5 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                <span>Chế độ phát Audio</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setAudioMode('real')}
                  className={`p-3 rounded border text-left cursor-pointer ${
                    audioMode === 'real'
                      ? 'border-[#0f2942] bg-slate-900 text-white'
                      : 'border-slate-300 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Thi thật (IDP Strict)</span>
                  </div>
                  <p className="mt-1 opacity-80">
                    Phát một mạch từ đầu đến cuối, khóa thanh tua và tốc độ 1.0x.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setAudioMode('practice')}
                  className={`p-3 rounded border text-left cursor-pointer ${
                    audioMode === 'practice'
                      ? 'border-[#1e40af] bg-blue-50 text-slate-900 ring-1 ring-[#1e40af]'
                      : 'border-slate-300 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="font-semibold">Luyện tập (Practice)</div>
                  <p className="mt-1 text-slate-600">
                    Cho phép tua ±5 giây, chỉnh tốc độ 0.75x–1.5x và nhảy nhanh theo Part.
                  </p>
                </button>
              </div>
            </div>

            <div>
              <div className="font-semibold text-slate-800 mb-1.5">Đồng hồ đếm thời gian</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setTimerMode('idp');
                    setRemainingSec(IDP_LISTEN_SEC);
                    setTimerPhase('listening');
                  }}
                  className={`p-3 rounded border text-left cursor-pointer ${
                    timerMode === 'idp'
                      ? 'border-[#0f2942] bg-slate-100 ring-1 ring-[#0f2942]'
                      : 'border-slate-300 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="font-semibold">Chuẩn IDP (30p + 2p kiểm tra)</div>
                  <p className="mt-1 text-slate-600">
                    Tự động chuyển sang 2 phút kiểm tra đáp án và nộp bài khi hết giờ.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setTimerMode('free')}
                  className={`p-3 rounded border text-left cursor-pointer ${
                    timerMode === 'free'
                      ? 'border-[#0f2942] bg-slate-100 ring-1 ring-[#0f2942]'
                      : 'border-slate-300 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="font-semibold">Tự do (Không giới hạn)</div>
                  <p className="mt-1 text-slate-600">
                    Đếm thời gian đã làm, phù hợp khi luyện nghe kỹ từng Part.
                  </p>
                </button>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
            <Link
              to="/"
              className="px-3 py-2 rounded border border-slate-300 text-xs font-medium hover:bg-slate-50"
            >
              Quay lại
            </Link>
            <button
              type="button"
              onClick={() => setExamStarted(true)}
              className="px-4 py-2 rounded bg-[#0f2942] hover:bg-[#1e3a8a] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Bắt đầu làm bài</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const themeClass = `idp-theme-${theme} idp-font-${fontScale}`;

  // Post-submit Review screen
  if (submittedAttempt) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex flex-col">
        <IdpHeader
          title={`${testData.title} — Đã nộp bài`}
          timerMode={timerMode}
          remainingSec={0}
          elapsedSec={submittedAttempt.durationUsedSec}
          timerPhase="finished"
          volume={volume}
          onVolumeChange={setVolume}
          fontScale={fontScale}
          onFontScaleChange={setFontScale}
          theme="light"
          onThemeChange={() => {}}
          hiddenScreen={false}
          onToggleHide={() => {}}
          answeredCount={40}
          onExit={() => navigate('/')}
          onSubmit={() => {}}
          isSubmitted={true}
        />
        <div className="flex-1">
          <ExamReviewView
            testData={testData}
            attempt={submittedAttempt}
            onRetryExam={handleRetryExam}
            onGoDictation={() => navigate(`/dictation/${volNum}/${testNum}`)}
            onTestDataUpdated={setTestData}
          />
        </div>
      </div>
    );
  }

  // Active IDP Split-Screen Exam
  return (
    <div className={`h-screen flex flex-col overflow-hidden idp-bg ${themeClass}`}>
      <audio
        ref={audioRef}
        src={testData.audioUrl}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => setIsPlaying(false)}
      />

      <IdpHeader
        title={testData.title}
        timerMode={timerMode}
        remainingSec={remainingSec}
        elapsedSec={elapsedSec}
        timerPhase={timerPhase}
        volume={volume}
        onVolumeChange={setVolume}
        fontScale={fontScale}
        onFontScaleChange={setFontScale}
        theme={theme}
        onThemeChange={setTheme}
        hiddenScreen={hiddenScreen}
        onToggleHide={() => setHiddenScreen((h) => !h)}
        answeredCount={answeredCount}
        onExit={handleExit}
        onSubmit={() => handleSubmitExam(false)}
        isSubmitted={false}
      />

      <ExamAudioBar
        audioMode={audioMode}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        playbackRate={playbackRate}
        hasStartedRealExam={hasStartedRealAudio}
        parts={testData.parts}
        onTogglePlay={togglePlay}
        onSeek={seekAudio}
        onSkip={skipAudio}
        onRateChange={setPlaybackRate}
      />

      {/* Split Screen */}
      <div
        ref={splitContainerRef}
        className="flex-1 min-h-0 flex flex-col lg:flex-row relative overflow-hidden"
      >
        <div
          className="h-1/2 lg:h-full min-h-0 overflow-hidden w-full lg:w-[var(--split-left)]"
          style={{ '--split-left': `${leftPct}%` } as React.CSSProperties}
        >
          <PdfExamViewer
            pdfUrl={testData.pdfUrl}
            questionPageRange={testData.questionPageRange}
            notepadText={notepadText}
            onNotepadChange={setNotepadText}
          />
        </div>

        {/* Resizer bar (desktop) */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => {
            isDraggingRef.current = true;
          }}
          onDoubleClick={() => setLeftPct(55)}
          title="Kéo để thay đổi tỷ lệ màn hình (nháy đúp để đặt lại 55/45)"
          className="hidden lg:flex w-1.5 cursor-col-resize items-center justify-center bg-slate-300 hover:bg-[#1e40af] transition-colors shrink-0"
        />

        <div className="flex-1 h-1/2 lg:h-full min-h-0 overflow-hidden">
          <AnswerSheet
            parts={testData.parts}
            questions={testData.questions}
            answers={answers}
            flagged={flagged}
            activePart={activePart}
            activeQuestion={activeQuestion}
            inputRefs={inputRefs}
            onActivePartChange={setActivePart}
            onFocusQuestion={setActiveQuestion}
            onAnswerChange={(q, val) =>
              setAnswers((prev) => ({ ...prev, [q]: val }))
            }
            onToggleFlag={(q) =>
              setFlagged((prev) => {
                const next = new Set(prev);
                if (next.has(q)) next.delete(q);
                else next.add(q);
                return next;
              })
            }
          />
        </div>

        {/* Hide Screen Overlay */}
        {hiddenScreen && (
          <div className="absolute inset-0 z-40 bg-slate-950 text-white flex flex-col items-center justify-center gap-4 p-6">
            <div className="text-base font-semibold">Màn hình thi đang tạm ẩn (Hide Screen)</div>
            <p className="text-xs text-slate-300 text-center max-w-md">
              Đồng hồ đếm bài thi đã tạm dừng trong khi ẩn màn hình. Nhấn nút bên dưới để tiếp tục làm bài.
            </p>
            <button
              type="button"
              onClick={() => setHiddenScreen(false)}
              className="px-4 py-2 rounded bg-white text-slate-900 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Eye className="w-4 h-4" />
              <span>Quay lại màn hình thi</span>
            </button>
          </div>
        )}
      </div>

      <QuestionPalette
        answers={answers}
        flagged={flagged}
        activeQuestion={activeQuestion}
        onSelectQuestion={handleSelectQuestion}
      />

      <ConfirmDialog
        open={confirmAction === 'submit'}
        title="Xác nhận nộp bài thi"
        message={`Bạn đã trả lời ${answeredCount}/40 câu. Bạn có chắc chắn muốn nộp bài và xem kết quả chấm chữa ngay?`}
        confirmLabel="Nộp bài ngay"
        cancelLabel="Tiếp tục làm bài"
        onConfirm={finalizeSubmitExam}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        open={confirmAction === 'exit'}
        title="Thoát khỏi phòng thi"
        message="Bài làm hiện tại đã được lưu nháp tự động trên trình duyệt. Bạn muốn quay về trang chủ?"
        confirmLabel="Thoát phòng thi"
        cancelLabel="Ở lại làm bài"
        onConfirm={() => {
          setConfirmAction(null);
          navigate('/');
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
