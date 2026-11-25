import { useCallback, useEffect, useRef, useState } from 'react';
import { pauseOthers, registerAudio } from '../lib/audioCoordinator';

export interface PlaySegmentOptions {
  id: string;
  startTime: number;
  endTime: number;
  rate?: number;
  loop?: boolean;
  padBefore?: number;
  padAfter?: number;
}

export interface UseSegmentAudioResult {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  activeId: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  clipStart: number;
  clipEnd: number;
  progressPct: number;
  error: string | null;
  playSegment: (opts: PlaySegmentOptions) => void;
  pause: () => void;
  resume: () => void;
  replay: () => void;
  seekTo: (sec: number) => void;
  setRate: (rate: number) => void;
  setLoop: (loop: boolean) => void;
  stop: () => void;
}

export function useSegmentAudio(
  audioSrc: string | undefined,
  fallbackDurationSec = 0
): UseSegmentAudioResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playTokenRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const clipRef = useRef<{
    id: string;
    clipStart: number;
    clipEnd: number;
    rate: number;
    loop: boolean;
  } | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const cancelMonitor = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Register audio element with global single-audio coordinator
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    return registerAudio(el);
  }, [audioSrc]);

  // Reset playback state when audio source changes
  useEffect(() => {
    playTokenRef.current += 1;
    cancelMonitor();
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
    clipRef.current = null;
    setActiveId(null);
    setIsPlaying(false);
    setIsBuffering(false);
    setCurrentTime(0);
    setClipStart(0);
    setClipEnd(0);
    setProgressPct(0);
    setError(null);
  }, [audioSrc, cancelMonitor]);

  const finishClip = useCallback(
    (audio: HTMLAudioElement, resetStart: number) => {
      cancelMonitor();
      audio.pause();
      try {
        audio.currentTime = resetStart;
      } catch {
        // Ignore seek errors if audio is not ready
      }
      setIsPlaying(false);
      setIsBuffering(false);
      setCurrentTime(resetStart);
      setProgressPct(0);
    },
    [cancelMonitor]
  );

  const startMonitor = useCallback(
    (token: number) => {
      cancelMonitor();
      const tick = () => {
        if (token !== playTokenRef.current) return;
        const audio = audioRef.current;
        const clip = clipRef.current;
        if (!audio || !clip) return;

        if (audio.paused) {
          return;
        }

        const cur = audio.currentTime;
        const span = Math.max(0.1, clip.clipEnd - clip.clipStart);
        const pct = Math.max(0, Math.min(100, ((cur - clip.clipStart) / span) * 100));
        setCurrentTime(cur);
        setProgressPct(pct);

        if (cur >= clip.clipEnd - 0.02) {
          if (clip.loop) {
            audio.currentTime = clip.clipStart;
            setCurrentTime(clip.clipStart);
            setProgressPct(0);
          } else {
            finishClip(audio, clip.clipStart);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [cancelMonitor, finishClip]
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const clip = clipRef.current;
      if (!clip) return;
      const cur = audio.currentTime;
      const span = Math.max(0.1, clip.clipEnd - clip.clipStart);
      if (!audio.paused) {
        setCurrentTime(cur);
        setProgressPct(Math.max(0, Math.min(100, ((cur - clip.clipStart) / span) * 100)));
        if (cur >= clip.clipEnd - 0.02) {
          if (clip.loop) {
            audio.currentTime = clip.clipStart;
          } else {
            finishClip(audio, clip.clipStart);
          }
        }
      }
    };

    const onEnded = () => {
      const clip = clipRef.current;
      if (!clip) {
        setIsPlaying(false);
        return;
      }
      if (clip.loop) {
        audio.currentTime = clip.clipStart;
        audio.play().catch(() => {});
      } else {
        finishClip(audio, clip.clipStart);
      }
    };

    const onAudioError = () => {
      cancelMonitor();
      setIsPlaying(false);
      setIsBuffering(false);
      setError('Không thể phát tệp audio gốc.');
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onAudioError);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onAudioError);
      cancelMonitor();
    };
  }, [audioSrc, cancelMonitor, finishClip]);

  const playSegment = useCallback(
    (opts: PlaySegmentOptions) => {
      const audio = audioRef.current;
      if (!audio || !audioSrc) return;

      const token = ++playTokenRef.current;
      cancelMonitor();
      pauseOthers(audio);
      if (!audio.paused) {
        audio.pause();
      }

      const padBefore = opts.padBefore ?? 0;
      const padAfter = opts.padAfter ?? 0;
      const rawStart = Math.max(0, opts.startTime - padBefore);
      const rawEnd = Math.max(rawStart + 0.4, opts.endTime + padAfter);
      const rate = opts.rate ?? clipRef.current?.rate ?? 1.0;
      const loop = opts.loop ?? false;

      const knownDur =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : fallbackDurationSec > 0
          ? fallbackDurationSec
          : rawEnd + 2;

      const startClamped = Math.max(0, Math.min(rawStart, Math.max(0, knownDur - 0.5)));
      const endClamped = Math.min(knownDur, Math.max(startClamped + 0.4, rawEnd));

      clipRef.current = {
        id: opts.id,
        clipStart: Number(startClamped.toFixed(2)),
        clipEnd: Number(endClamped.toFixed(2)),
        rate,
        loop,
      };

      setActiveId(opts.id);
      setClipStart(clipRef.current.clipStart);
      setClipEnd(clipRef.current.clipEnd);
      setCurrentTime(clipRef.current.clipStart);
      setProgressPct(0);
      setError(null);
      setIsBuffering(audio.readyState < 1);

      const launchPlayback = () => {
        if (token !== playTokenRef.current || !clipRef.current) return;
        const dur =
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : knownDur;
        const finalStart = Math.max(
          0,
          Math.min(clipRef.current.clipStart, Math.max(0, dur - 0.4))
        );
        const finalEnd = Math.min(dur, Math.max(finalStart + 0.4, clipRef.current.clipEnd));
        clipRef.current.clipStart = Number(finalStart.toFixed(2));
        clipRef.current.clipEnd = Number(finalEnd.toFixed(2));
        setClipStart(clipRef.current.clipStart);
        setClipEnd(clipRef.current.clipEnd);

        try {
          audio.currentTime = clipRef.current.clipStart;
          audio.playbackRate = clipRef.current.rate;
        } catch {
          // Ignore seek errors
        }

        const p = audio.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            if (token !== playTokenRef.current) {
              audio.pause();
              return;
            }
            setIsBuffering(false);
            setIsPlaying(true);
            startMonitor(token);
          }).catch((err: unknown) => {
            if (token !== playTokenRef.current) return;
            const name = err instanceof Error ? err.name : '';
            if (name === 'AbortError') return;
            setIsBuffering(false);
            setIsPlaying(false);
            setError('Trình duyệt tạm chặn phát tự động. Hãy bấm Phát lại.');
          });
        }
      };

      if (audio.readyState >= 1) {
        launchPlayback();
      } else {
        const onLoaded = () => {
          audio.removeEventListener('loadedmetadata', onLoaded);
          launchPlayback();
        };
        audio.addEventListener('loadedmetadata', onLoaded);
        audio.load();
      }
    },
    [audioSrc, cancelMonitor, fallbackDurationSec, startMonitor]
  );

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    cancelMonitor();
    audio.pause();
    setIsPlaying(false);
    setIsBuffering(false);
  }, [cancelMonitor]);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    const clip = clipRef.current;
    if (!audio || !clip) return;
    const token = ++playTokenRef.current;
    pauseOthers(audio);
    if (audio.currentTime < clip.clipStart || audio.currentTime >= clip.clipEnd - 0.05) {
      audio.currentTime = clip.clipStart;
    }
    audio.playbackRate = clip.rate;
    audio
      .play()
      .then(() => {
        if (token !== playTokenRef.current) return;
        setIsPlaying(true);
        startMonitor(token);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setIsPlaying(false);
      });
  }, [startMonitor]);

  const replay = useCallback(() => {
    const clip = clipRef.current;
    if (!clip) return;
    playSegment({
      id: clip.id,
      startTime: clip.clipStart,
      endTime: clip.clipEnd,
      rate: clip.rate,
      loop: clip.loop,
      padBefore: 0,
      padAfter: 0,
    });
  }, [playSegment]);

  const seekTo = useCallback((sec: number) => {
    const audio = audioRef.current;
    const clip = clipRef.current;
    if (!audio || !clip) return;
    const clamped = Math.max(clip.clipStart, Math.min(clip.clipEnd - 0.05, sec));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
    const span = Math.max(0.1, clip.clipEnd - clip.clipStart);
    setProgressPct(Math.max(0, Math.min(100, ((clamped - clip.clipStart) / span) * 100)));
  }, []);

  const setRate = useCallback((rate: number) => {
    if (clipRef.current) {
      clipRef.current.rate = rate;
    }
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const setLoop = useCallback((loop: boolean) => {
    if (clipRef.current) {
      clipRef.current.loop = loop;
    }
  }, []);

  const stop = useCallback(() => {
    playTokenRef.current += 1;
    cancelMonitor();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    setIsPlaying(false);
    setIsBuffering(false);
    setProgressPct(0);
  }, [cancelMonitor]);

  return {
    audioRef,
    activeId,
    isPlaying,
    isBuffering,
    currentTime,
    clipStart,
    clipEnd,
    progressPct,
    error,
    playSegment,
    pause,
    resume,
    replay,
    seekTo,
    setRate,
    setLoop,
    stop,
  };
}
