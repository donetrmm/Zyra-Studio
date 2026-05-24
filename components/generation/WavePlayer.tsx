'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { downloadGenerationImage } from '@/lib/media-references/download-client';

function fmt(s: number): string {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

type Point = { x: number; y: number };

function sampleWave(t: number, amp: number, W: number, MID: number): Point[] {
  const N = 96;
  const pts: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = u * W;
    const edge = Math.sin(u * Math.PI);
    const a =
      Math.sin(t * 1.8 + u * 7.0) * 0.55 +
      Math.sin(t * 3.1 + u * 13.0) * 0.32 +
      Math.sin(t * 5.7 + u * 23.0) * 0.18 +
      Math.sin(t * 0.9 + u * 3.0) * 0.40;
    const micro = 0.5 + 0.5 * Math.sin(t * 0.6 + u * 1.8);
    const range = MID * amp;
    pts.push({ x, y: MID + a * micro * edge * range });
  }
  return pts;
}

function smoothPath(pts: Point[]): string {
  if (!pts.length) return '';
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(2)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(2)}, ${(p2.x - (p3.x - p1.x) / 6).toFixed(2)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function WavePlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const echoRef = useRef<SVGPathElement>(null);
  const echo2Ref = useRef<SVGPathElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const liveAmpRef = useRef(0.04);
  const scrubBoostRef = useRef(0);
  const rafRef = useRef(0);

  // Web Audio API: AnalyserNode para leer amplitud real del audio en cada frame
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const timeDomainRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  function ensureAnalyser() {
    if (analyserRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;
    timeDomainRef.current = new Uint8Array(analyser.fftSize);
  }

  // RMS de la señal de tiempo → amplitud normalizada 0..1
  function getRealtimeAmplitude(): number {
    const analyser = analyserRef.current;
    const data = timeDomainRef.current;
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    // Escalar a 0..1 con boost (RMS de voz ~0.05-0.3, queremos que llene)
    return Math.min(1, rms * 4);
  }

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // AudioContext requiere user gesture para iniciar
      ensureAnalyser();
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
    scrubBoostRef.current = 0.7;
    const fl = flashRef.current;
    if (fl) { fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on'); }
  }, []);

  const scrubTo = useCallback((e: React.PointerEvent | PointerEvent) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar) return;
    const r = bar.getBoundingClientRect();
    const x = e.clientX - r.left;
    const u = Math.max(0, Math.min(1, x / r.width));
    audio.currentTime = u * (audio.duration || 0);
    scrubBoostRef.current = 0.5;
  }, []);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadGenerationImage(src, 'zyra-audio');
    } catch (e) {
      toast.error(`No se pudo descargar${e instanceof Error ? `: ${e.message}` : ''}`);
    } finally {
      setDownloading(false);
    }
  }

  // Animation loop
  useEffect(() => {
    let lastFrame = performance.now();
    function tick() {
      const now = performance.now();
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;

      const svg = svgRef.current;
      const audio = audioRef.current;
      if (!svg || !audio) { rafRef.current = requestAnimationFrame(tick); return; }

      const rect = svg.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const MID = H / 2;
      if (W === 0 || H === 0) { rafRef.current = requestAnimationFrame(tick); return; }
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

      const pos = audio.currentTime;
      const dur = audio.duration || 1;
      const isPlaying = !audio.paused && !audio.ended;

      // Amplitud real del audio via Web Audio AnalyserNode
      const realAmp = isPlaying ? getRealtimeAmplitude() : 0;
      const target = Math.max(0.04, realAmp) + scrubBoostRef.current * 0.6;
      const k = target > liveAmpRef.current ? 0.18 : 0.10;
      liveAmpRef.current += (target - liveAmpRef.current) * k;
      scrubBoostRef.current = Math.max(0, scrubBoostRef.current - dt * 2.4);

      const amp = 0.78 * liveAmpRef.current;
      const t = now / 1000;
      const main = sampleWave(t, amp, W, MID);
      const e1 = sampleWave(t - 0.18, amp * 0.72, W, MID);
      const e2 = sampleWave(t - 0.36, amp * 0.46, W, MID);
      pathRef.current?.setAttribute('d', smoothPath(main));
      echoRef.current?.setAttribute('d', smoothPath(e1));
      echo2Ref.current?.setAttribute('d', smoothPath(e2));

      const pct = dur > 0 ? (pos / dur) * 100 : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // Sync React state from audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
    };
  }, []);

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowLeft') skip(-5);
      if (e.code === 'ArrowRight') skip(5);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, skip]);

  // Drag on progress bar
  const dragging = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrubTo(e);
  }, [scrubTo]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) scrubTo(e);
  }, [scrubTo]);
  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Hidden audio */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Wave stage */}
      <div className="relative flex-1 overflow-hidden">
        {/* Glow */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 transition-opacity duration-500',
            playing ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            background: 'radial-gradient(70% 40% at 50% 50%, rgba(123,97,255,0.18), transparent 70%)',
            filter: 'blur(20px)',
            animation: playing ? 'zyra-glow-breathe 4s ease-in-out infinite' : 'none',
          }}
        />

        <svg ref={svgRef} className="block h-full w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="waveGrad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#9985FF" stopOpacity={0.15} />
              <stop offset="15%" stopColor="#9985FF" stopOpacity={1} />
              <stop offset="50%" stopColor="#B9A7FF" stopOpacity={1} />
              <stop offset="85%" stopColor="#7B61FF" stopOpacity={1} />
              <stop offset="100%" stopColor="#7B61FF" stopOpacity={0.15} />
            </linearGradient>
            <linearGradient id="echoGrad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#7B61FF" stopOpacity={0} />
              <stop offset="50%" stopColor="#7B61FF" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#7B61FF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path ref={echo2Ref} fill="none" stroke="url(#echoGrad)" strokeWidth={1.0} strokeLinecap="round" opacity={playing ? 0.18 : 0} style={{ transition: 'opacity 360ms' }} />
          <path ref={echoRef} fill="none" stroke="url(#echoGrad)" strokeWidth={1.6} strokeLinecap="round" opacity={playing ? 0.35 : 0} style={{ transition: 'opacity 360ms' }} />
          <path
            ref={pathRef}
            fill="none"
            stroke="url(#waveGrad)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={playing ? 1 : 0.55}
            style={{
              filter: 'drop-shadow(0 0 10px rgba(123,97,255,0.55)) drop-shadow(0 0 30px rgba(123,97,255,0.25))',
              transition: 'opacity 360ms',
            }}
          />
        </svg>

        {/* Flash on scrub */}
        <div
          ref={flashRef}
          className="pointer-events-none absolute inset-0 opacity-0 [&.on]:animate-[zyra-flash_380ms_ease-out]"
          style={{
            background: 'radial-gradient(40% 30% at 50% 50%, rgba(185,167,255,0.25), transparent 70%)',
          }}
        />
      </div>

      {/* Progress bar */}
      <div
        ref={progressRef}
        className="relative flex h-[22px] cursor-pointer items-center px-7"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="relative h-[3px] w-full rounded-full bg-white/[0.07]">
          <div
            ref={fillRef}
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: '0%',
              background: 'linear-gradient(90deg, var(--primary), #B9A7FF)',
              boxShadow: '0 0 10px rgba(123,97,255,0.45)',
            }}
          />
          <div
            ref={thumbRef}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-[1.15]"
            style={{
              left: '0%',
              width: 12,
              height: 12,
              borderRadius: '999px',
              background: '#B9A7FF',
              boxShadow: '0 0 0 4px rgba(123,97,255,0.18), 0 0 14px rgba(123,97,255,0.45)',
            }}
          />
        </div>
      </div>

      {/* Bottom controls */}
      <div className="z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-7 pb-6 pt-3.5">
        {/* Status */}
        <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground/60">
          <span
            className={cn(
              'size-1.5 rounded-full',
              playing
                ? 'animate-[zyra-blink_1.4s_ease-in-out_infinite] bg-primary shadow-[0_0_8px_rgba(123,97,255,0.45)]'
                : 'bg-muted-foreground/40',
            )}
          />
          <span>{playing ? 'Reproduciendo' : 'Pausado'}</span>
        </div>

        {/* Time */}
        <div className="justify-self-center font-mono text-[26px] font-normal tracking-tight text-foreground">
          {fmt(currentTime)}
          <span className="ml-2 text-[14px] text-muted-foreground/60">/ {fmt(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="inline-flex items-center gap-2 justify-self-end">
          {/* Back 10s */}
          <button
            type="button"
            onClick={() => skip(-10)}
            title="Atrasar 10 s"
            className="relative grid size-10 place-items-center rounded-full border border-white/[0.14] bg-[#131A2E]/60 text-foreground backdrop-blur transition-all hover:border-white/[0.22] hover:bg-[#1A2240]/85 active:scale-[0.94]"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span className="pointer-events-none absolute font-mono text-[9.5px] font-medium text-foreground">10</span>
          </button>

          {/* Play/Pause */}
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-primary/[0.35] bg-primary/[0.14] px-4 text-[13px] font-medium text-foreground backdrop-blur transition-all hover:border-primary/50 hover:bg-primary/[0.22] active:scale-[0.96]"
          >
            {playing ? (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="currentColor" /></svg>
                Detener
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 11 11"><path d="M2 1 9.5 5.5 2 10z" fill="currentColor" /></svg>
                Reanudar
              </>
            )}
          </button>

          {/* Forward 10s */}
          <button
            type="button"
            onClick={() => skip(10)}
            title="Adelantar 10 s"
            className="relative grid size-10 place-items-center rounded-full border border-white/[0.14] bg-[#131A2E]/60 text-foreground backdrop-blur transition-all hover:border-white/[0.22] hover:bg-[#1A2240]/85 active:scale-[0.94]"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            <span className="pointer-events-none absolute font-mono text-[9.5px] font-medium text-foreground">10</span>
          </button>

          {/* Download */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            title="Descargar audio"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.14] bg-[#131A2E]/60 px-4 text-[13px] font-medium text-foreground backdrop-blur transition-all hover:border-white/[0.22] hover:bg-[#1A2240]/85 active:scale-[0.96]"
          >
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Descargar
          </button>
        </div>
      </div>

      <style>{`
        @keyframes zyra-glow-breathe {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 1.0; }
        }
        @keyframes zyra-blink {
          0%, 100% { opacity: 0.4; transform: scale(0.85); }
          50%      { opacity: 1; transform: scale(1.1); }
        }
        @keyframes zyra-flash {
          0%   { opacity: 0; }
          20%  { opacity: 0.9; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
