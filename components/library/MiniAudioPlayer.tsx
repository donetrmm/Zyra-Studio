'use client';

import { useEffect, useRef, useState } from 'react';

// Player de audio custom para DetailAside — sin controles nativos del browser.
export function MiniAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setProgress(0); };
    const onTime = () => {
      setCurrentTime(a.currentTime);
      if (a.duration > 0) setProgress((a.currentTime / a.duration) * 100);
    };
    const onMeta = () => setDuration(a.duration);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
    };
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function scrub(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    a.currentTime = u * a.duration;
  }

  function fmt(s: number): string {
    s = Math.max(0, Math.floor(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return (
    <div className="w-full rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
      <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />
      <div className="flex items-center gap-3">
        {/* Play / Pause */}
        <button
          type="button"
          onClick={toggle}
          className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary transition-colors hover:bg-primary/20"
        >
          {playing ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="6" width="3" height="10" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2 0.5 9 5 2 9.5z" fill="currentColor" />
            </svg>
          )}
        </button>

        {/* Progress + time */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="group relative h-[6px] cursor-pointer rounded-full bg-white/[0.07]"
            onClick={scrub}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-primary/60"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
              style={{
                left: `${progress}%`,
                width: 10,
                height: 10,
                borderRadius: '999px',
                background: 'var(--primary)',
                boxShadow: '0 0 6px rgba(0,159,255,0.5)',
              }}
            />
          </div>
          <div className="flex justify-between font-mono text-[11px] text-muted-foreground/60">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
