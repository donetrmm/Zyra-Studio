"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Typing animation hook                                              */
/* ------------------------------------------------------------------ */
function useTypingAnimation(text: string, speed = 40, pause = 4500) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    function type() {
      if (i <= text.length) {
        setDisplayed(text.slice(0, i));
        i++;
        timer = setTimeout(type, speed + Math.random() * 50);
      } else {
        timer = setTimeout(() => {
          i = 0;
          type();
        }, pause);
      }
    }
    type();
    return () => clearTimeout(timer);
  }, [text, speed, pause]);
  return displayed;
}

/* ------------------------------------------------------------------ */
/*  Bento mini-wave (canvas)                                           */
/* ------------------------------------------------------------------ */
function BentoWave() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf: number;
    function draw(t: number) {
      const time = t / 1000;
      const W = canvas!.width;
      const H = canvas!.height;
      const MID = H / 2;
      ctx!.clearRect(0, 0, W, H);

      const grad = ctx!.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "rgba(139,92,246,0)");
      grad.addColorStop(0.5, "rgba(167,139,250,1)");
      grad.addColorStop(1, "rgba(124,58,237,0)");

      ctx!.beginPath();
      const N = 48;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const x = u * W;
        const edge = Math.sin(u * Math.PI);
        const a =
          Math.sin(time * 2 + u * 8) * 0.55 +
          Math.sin(time * 3.4 + u * 15) * 0.32 +
          Math.sin(time * 5.8 + u * 24) * 0.18;
        const env = 0.5 + 0.5 * Math.sin(time * 0.7 + u * 2);
        const y = MID + a * env * edge * 36;
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.strokeStyle = grad;
      ctx!.lineWidth = 2;
      ctx!.lineCap = "round";
      ctx!.shadowColor = "rgba(124,58,237,0.6)";
      ctx!.shadowBlur = 6;
      ctx!.stroke();
      ctx!.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={110}
      className="w-full h-[140px]"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Animated chat for bento conversational card                        */
/* ------------------------------------------------------------------ */
const CHAT_FLOW = [
  { role: "user" as const, text: "Mas cinematica, contraluz calido", seed: 0 },
  { role: "bot" as const, text: "", seed: 1 },
  { role: "user" as const, text: "Mas contraste en las sombras", seed: 0 },
  { role: "bot" as const, text: "", seed: 5 },
  { role: "user" as const, text: "Agrega texto: Zyra Studio", seed: 0 },
  { role: "bot" as const, text: "", seed: 4 },
];

function AnimatedChat() {
  const [messages, setMessages] = useState<typeof CHAT_FLOW>([]);
  const [typing, setTyping] = useState(false);
  const [nextIdx, setNextIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function addNext() {
      const idx = nextIdx;
      if (idx >= CHAT_FLOW.length) {
        timer = setTimeout(() => {
          setMessages([]);
          setNextIdx(0);
        }, 2500);
        return;
      }
      setTyping(true);
      const delay = CHAT_FLOW[idx].role === "bot" ? 1400 : 500;
      timer = setTimeout(() => {
        setTyping(false);
        setMessages((prev) => [...prev, CHAT_FLOW[idx]]);
        setNextIdx(idx + 1);
      }, delay);
    }
    timer = setTimeout(addNext, 600);
    return () => clearTimeout(timer);
  }, [nextIdx, messages.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  const typingRole = nextIdx < CHAT_FLOW.length ? CHAT_FLOW[nextIdx].role : "bot";

  return (
    <div ref={scrollRef} className="l-b4-chat l-b4-chat-animated" style={{ height: 160, overflowY: "hidden", maskImage: "linear-gradient(transparent 0px, black 40px, black 100%)", WebkitMaskImage: "linear-gradient(transparent 0px, black 40px, black 100%)" }}>
      {messages.map((m, i) => (
        <div
          key={`${i}-${m.text || m.seed}`}
          className={`l-b4-msg ${m.role === "user" ? "l-b4-msg-user" : "l-b4-msg-bot"}`}
          style={{ animation: "chatFadeIn 300ms ease-out" }}
        >
          {m.role === "bot" ? (
            <span className="img">
              <GradientPlaceholder seed={m.seed} />
            </span>
          ) : (
            m.text
          )}
        </div>
      ))}
      {typing && (
        <div
          className={`l-b4-msg ${typingRole === "user" ? "l-b4-msg-user" : "l-b4-msg-bot"}`}
          style={{ animation: "chatFadeIn 200ms ease-out" }}
        >
          <span className="l-typing-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SVG Icons                                                          */
/* ------------------------------------------------------------------ */
function ZyraLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 5h14L5 19h14" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}

function CreditIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
      <circle cx="4" cy="4" r="3" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Gradient placeholder component (for bento tiles etc.)              */
/* ------------------------------------------------------------------ */
function GradientPlaceholder({ seed }: { seed: number }) {
  const palettes = [
    ["#7c3aed", "#5b21b6", "#1A0F4A"],
    ["#FFC4D6", "#7c3aed", "#2E1B5C"],
    ["#a78bfa", "#5BD4FF", "#1E2A4E"],
    ["#FFD58E", "#FF7AB6", "#3E1F4E"],
    ["#5BD4FF", "#7c3aed", "#0F1A3C"],
    ["#FF9270", "#7c3aed", "#2A1340"],
  ];
  const p = palettes[seed % palettes.length];
  const gid = `gp${seed}`;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className="block w-full h-full"
    >
      <defs>
        <radialGradient id={gid} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor={p[0]} />
          <stop offset="55%" stopColor={p[1]} />
          <stop offset="100%" stopColor={p[2]} />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${gid})`} />
      <circle
        cx={`${20 + ((seed * 13) % 60)}%`}
        cy={`${15 + ((seed * 7) % 55)}%`}
        r="22%"
        fill={p[0]}
        opacity="0.35"
      />
      <ellipse cx={`${50 + ((seed * 5) % 40)}%`} cy="75%" rx="60%" ry="28%" fill={p[2]} opacity="0.5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  MAIN PAGE                                                          */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  const typedText = useTypingAnimation(
    "Retrato editorial de una mujer, luz suave de ventana, pelicula 35mm, fondo gris calido"
  );

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <>
      <style jsx global>{`
        /* =========== CSS VARIABLES =========== */
        :root {
          --bg-deep: #09090b;
          --bg-1: #0c0c0f;
          --bg-2: #18181b;
          --bg-3: #27272a;
          --hairline: rgba(255,255,255,0.06);
          --hairline-strong: rgba(255,255,255,0.12);
          --text-1: #fafafa;
          --text-2: #a1a1aa;
          --text-3: #71717a;
          --text-4: #52525b;
          --accent-l: #7c3aed;
          --accent-2l: #8b5cf6;
          --accent-3l: #a78bfa;
          --accent-soft-l: rgba(124,58,237,0.14);
          --accent-glow-l: rgba(124,58,237,0.45);
          --accent-rim-l: rgba(124,58,237,0.35);
        }

        .landing-page {
          background: var(--bg-deep);
          color: var(--text-1);
          font-family: var(--font-heading, 'Geist', -apple-system, sans-serif);
          font-size: 15px;
          line-height: 1.55;
          letter-spacing: -0.005em;
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
        }

        .landing-page *,
        .landing-page *::before,
        .landing-page *::after {
          box-sizing: border-box;
        }

        .mono {
          font-family: var(--font-mono, 'Geist Mono', ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }

        .container-l {
          max-width: 1180px;
          margin: 0 auto;
          padding: 0 28px;
        }

        /* =========== NAV =========== */
        .l-nav {
          position: sticky;
          top: 0;
          z-index: 50;
          padding: 14px 0;
          background: rgba(11,15,25,0.7);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid transparent;
          transition: border-color 200ms;
        }
        .l-nav.scrolled { border-bottom-color: var(--hairline); }
        .l-nav-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }
        .l-brand {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-weight: 500;
          font-size: 15px;
          letter-spacing: -0.01em;
          color: var(--text-1);
          text-decoration: none;
        }
        .l-brand-mark {
          width: 28px; height: 28px; border-radius: 8px;
          background: linear-gradient(135deg, #7c3aed, #5b21b6);
          display: grid; place-items: center;
          box-shadow: 0 6px 20px -8px var(--accent-glow-l), inset 0 0 0 1px rgba(255,255,255,0.08);
          color: #fff;
        }
        .l-nav-links {
          display: flex; gap: 4px;
          padding: 4px;
          border-radius: 999px;
          border: 1px solid var(--hairline);
          background: rgba(19,26,46,0.5);
        }
        .l-nav-links a {
          padding: 7px 14px;
          border-radius: 999px;
          color: var(--text-2);
          font-size: 13px;
          font-weight: 500;
          transition: color 140ms, background 140ms;
          text-decoration: none;
        }
        .l-nav-links a:hover { color: var(--text-1); background: rgba(255,255,255,0.04); }

        .l-nav-cta {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }

        /* =========== BUTTONS =========== */
        .btn-l {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 14px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 500;
          border: 1px solid transparent;
          transition: background 140ms, border-color 140ms, transform 100ms;
          text-decoration: none;
          cursor: pointer;
          background: none;
          color: inherit;
        }
        .btn-l:active { transform: scale(0.97); }
        .btn-l-ghost { color: var(--text-2); }
        .btn-l-ghost:hover { color: var(--text-1); }
        .btn-l-secondary {
          background: rgba(255,255,255,0.05);
          border-color: var(--hairline-strong);
          color: var(--text-1);
        }
        .btn-l-secondary:hover { background: rgba(255,255,255,0.08); }
        .btn-l-primary {
          background: linear-gradient(180deg, #8b5cf6, #6d28d9);
          color: #fff;
          box-shadow: 0 8px 22px -8px var(--accent-glow-l), inset 0 0 0 1px rgba(255,255,255,0.10);
        }
        .btn-l-primary:hover { box-shadow: 0 12px 30px -8px var(--accent-glow-l), inset 0 0 0 1px rgba(255,255,255,0.14); }
        .btn-l-lg {
          padding: 12px 22px;
          font-size: 14.5px;
          border-radius: 12px;
        }

        /* =========== HERO =========== */
        .l-hero {
          position: relative;
          padding: 96px 0 60px;
          text-align: center;
          overflow: hidden;
        }
        .l-hero::before {
          content: "";
          position: absolute; inset: -10% -10% auto -10%;
          height: 540px;
          background:
            radial-gradient(60% 50% at 50% 30%, rgba(124,58,237,0.22), transparent 65%),
            radial-gradient(40% 30% at 20% 70%, rgba(91,33,182,0.10), transparent 70%),
            radial-gradient(40% 30% at 80% 70%, rgba(167,139,250,0.08), transparent 70%);
          filter: blur(10px);
          pointer-events: none;
          z-index: 0;
        }
        .l-hero::after {
          content: "";
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 60px 60px;
          mask-image: radial-gradient(ellipse at 50% 35%, #000 35%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }
        .l-hero-inner { position: relative; z-index: 1; }

        .l-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 5px 14px 5px 6px;
          border-radius: 999px;
          background: rgba(124,58,237,0.08);
          border: 1px solid var(--accent-rim-l);
          font-size: 12px;
          color: var(--text-2);
          margin-bottom: 28px;
        }
        .l-eyebrow-tag {
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--accent-l);
          color: #fff;
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.04em;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .l-eyebrow-tag::before {
          content: "";
          display: inline-block;
          width: 5px; height: 5px;
          border-radius: 999px;
          background: #fff;
          animation: blink-l 1.6s ease-in-out infinite;
        }
        @keyframes blink-l {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }

        .l-hero-title {
          font-size: clamp(40px, 6.5vw, 76px);
          font-weight: 500;
          letter-spacing: -0.035em;
          line-height: 1.02;
          margin: 0 auto 22px;
          max-width: 14ch;
          text-wrap: balance;
        }
        .l-hero-title .gradient-text {
          background: linear-gradient(180deg, var(--accent-3l) 0%, var(--accent-l) 60%, var(--accent-l) 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .l-hero-sub {
          font-size: clamp(16px, 1.6vw, 19px);
          color: var(--text-2);
          max-width: 540px;
          margin: 0 auto 36px;
          text-wrap: pretty;
          line-height: 1.5;
        }
        .l-hero-cta {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 18px;
        }
        .l-trust {
          display: inline-flex;
          align-items: center;
          gap: 14px;
          font-size: 12px;
          color: var(--text-3);
        }

        /* =========== HERO PRODUCT SHOT =========== */
        .l-hero-shot-wrap {
          position: relative;
          margin: 50px auto 0;
          max-width: 1080px;
          padding: 0 20px;
        }
        .l-hero-shot {
          position: relative;
          border-radius: 22px;
          background: linear-gradient(180deg, rgba(26,34,64,0.5) 0%, rgba(14,19,34,0.85) 100%);
          border: 1px solid var(--hairline-strong);
          box-shadow:
            0 60px 120px -40px rgba(0,0,0,0.7),
            0 0 0 1px rgba(124,58,237,0.06),
            inset 0 1px 0 rgba(255,255,255,0.04);
          overflow: hidden;
          height: 540px;
        }
        .l-hero-shot-window {
          display: flex;
          height: 100%;
        }

        /* Sidebar rail */
        .l-shot-rail {
          width: 52px;
          flex-shrink: 0;
          border-right: 1px solid var(--hairline);
          padding: 14px 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          background: var(--bg-1);
        }
        .l-shot-rail .mark {
          width: 30px; height: 30px;
          border-radius: 9px;
          background: linear-gradient(135deg, #7c3aed, #5b21b6);
          margin-bottom: 8px;
          box-shadow: 0 4px 14px -6px var(--accent-glow-l);
        }
        .l-shot-rail .it {
          width: 34px; height: 34px;
          border-radius: 8px;
          background: rgba(255,255,255,0.04);
        }
        .l-shot-rail .it-active {
          background: var(--bg-3);
          border: 1px solid var(--hairline-strong);
          position: relative;
        }
        .l-shot-rail .it-active::before {
          content: "";
          position: absolute;
          left: -8px; top: 50%;
          width: 3px; height: 16px;
          background: var(--accent-l);
          border-radius: 999px;
          transform: translateY(-50%);
          box-shadow: 0 0 8px var(--accent-l);
        }

        /* Controls column */
        .l-shot-ctrl {
          width: 280px;
          flex-shrink: 0;
          padding: 18px;
          border-right: 1px solid var(--hairline);
          background: var(--bg-1);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .l-shot-ctrl h4 {
          margin: 0 0 8px;
          font-size: 11.5px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-3);
          font-weight: 500;
          display: flex; align-items: center; gap: 6px;
        }
        .l-shot-ctrl .step {
          width: 14px; height: 14px;
          border-radius: 999px;
          background: var(--accent-soft-l);
          border: 1px solid var(--accent-rim-l);
          color: var(--accent-2l);
          display: inline-grid; place-items: center;
          font-size: 9px;
          font-family: var(--font-mono, 'Geist Mono', monospace);
          letter-spacing: 0;
        }

        .l-shot-prompt {
          background: var(--bg-2);
          border: 1px solid var(--hairline);
          border-radius: 10px;
          padding: 12px;
          font-size: 12.5px;
          color: var(--text-1);
          line-height: 1.5;
          min-height: 60px;
        }
        .l-caret {
          display: inline-block;
          width: 1.5px; height: 13px;
          background: var(--accent-2l);
          vertical-align: text-bottom;
          margin-left: 1px;
          animation: caret-l 0.9s steps(2) infinite;
          box-shadow: 0 0 8px var(--accent-l);
        }
        @keyframes caret-l { 50% { opacity: 0; } }

        .l-shot-chips {
          display: flex; gap: 6px; flex-wrap: wrap;
        }
        .l-shot-chip {
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 11.5px;
          background: var(--bg-2);
          border: 1px solid var(--hairline);
          color: var(--text-2);
        }
        .l-shot-chip-active {
          background: var(--accent-soft-l);
          border-color: var(--accent-rim-l);
          color: var(--text-1);
        }

        .l-shot-aspects {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }
        .l-shot-ar {
          height: 40px;
          border-radius: 8px;
          background: var(--bg-2);
          border: 1px solid var(--hairline);
          position: relative;
          display: grid;
          place-items: center;
        }
        .l-shot-ar-active { border-color: var(--accent-l); background: var(--accent-soft-l); }
        .l-ar-shape {
          border-radius: 2px;
          border: 1.5px solid var(--text-3);
        }
        .l-shot-ar-active .l-ar-shape { border-color: var(--accent-2l); }

        .l-shot-generate {
          margin-top: auto;
          padding: 11px;
          border-radius: 10px;
          background: linear-gradient(180deg, #8b5cf6, #6d28d9);
          color: #fff;
          font-size: 13px;
          font-weight: 500;
          text-align: center;
          display: flex; align-items: center; justify-content: center; gap: 7px;
          box-shadow: 0 8px 22px -8px var(--accent-glow-l), inset 0 0 0 1px rgba(255,255,255,0.10);
        }
        .l-shot-generate .cost {
          margin-left: 4px;
          padding-left: 8px;
          border-left: 1px solid rgba(255,255,255,0.18);
          font-family: var(--font-mono, 'Geist Mono', monospace);
          opacity: 0.9;
        }

        /* Preview column */
        .l-shot-preview {
          flex: 1;
          min-width: 0;
          padding: 20px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr 1fr;
          gap: 12px;
          background:
            radial-gradient(50% 40% at 20% 20%, rgba(124,58,237,0.06), transparent 60%),
            var(--bg-deep);
          position: relative;
        }
        .l-shot-img {
          position: relative;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid var(--hairline);
          margin-top: 16px;
        }
        .l-shot-img:first-child { margin-top: 0; }
        .l-shot-img-loading::before {
          content: "";
          position: absolute; inset: 0;
          background: linear-gradient(110deg, transparent 30%, rgba(124,58,237,0.25), transparent 70%);
          background-size: 200% 100%;
          animation: shimmer-l 1.8s linear infinite;
          z-index: 1;
        }
        .l-shot-img-loading::after {
          content: "Generando \\00B7 14 s";
          position: absolute;
          bottom: 10px; left: 10px;
          font-size: 10.5px;
          letter-spacing: 0.04em;
          font-family: var(--font-mono, 'Geist Mono', monospace);
          color: var(--text-1);
          background: rgba(11,15,25,0.7);
          border: 1px solid var(--hairline-strong);
          border-radius: 6px;
          padding: 3px 7px;
          backdrop-filter: blur(6px);
          z-index: 2;
        }
        @keyframes shimmer-l {
          0% { background-position: -100% 0; }
          100% { background-position: 200% 0; }
        }

        /* =========== SECTION HEADS =========== */
        .l-sec-head {
          text-align: center;
          margin-bottom: 60px;
        }
        .l-sec-eyebrow {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 999px;
          background: var(--accent-soft-l);
          border: 1px solid var(--accent-rim-l);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent-2l);
          font-family: var(--font-mono, 'Geist Mono', monospace);
          margin-bottom: 18px;
        }
        .l-sec-head h2 {
          margin: 0 0 14px;
          font-size: clamp(30px, 4vw, 46px);
          font-weight: 500;
          letter-spacing: -0.025em;
          line-height: 1.05;
          max-width: 18ch;
          margin-left: auto;
          margin-right: auto;
          text-wrap: balance;
          color: var(--text-1);
        }
        .l-sec-head h2 em {
          font-style: normal;
          color: var(--accent-2l);
        }
        .l-sec-head p {
          margin: 0 auto;
          max-width: 540px;
          color: var(--text-2);
          font-size: 16px;
          text-wrap: pretty;
        }

        /* =========== BENTO =========== */
        .l-bento-section { padding: 110px 0 60px; }
        .l-bento {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 14px;
        }
        .l-b-card {
          position: relative;
          background: linear-gradient(180deg, rgba(26,34,64,0.4) 0%, rgba(14,19,34,0.85) 100%);
          border: 1px solid var(--hairline-strong);
          border-radius: 18px;
          overflow: hidden;
          padding: 26px;
          display: flex;
          flex-direction: column;
          min-height: 320px;
        }
        .l-b-card::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(80% 60% at 0% 0%, rgba(124,58,237,0.10), transparent 60%);
          pointer-events: none;
          opacity: 0;
          transition: opacity 300ms;
        }
        .l-b-card:hover::before { opacity: 1; }
        .l-b-1 { grid-column: span 4; }
        .l-b-2 { grid-column: span 2; }
        .l-b-3 { grid-column: span 2; }
        .l-b-4 { grid-column: span 4; min-height: 280px; }

        .l-b-card h3 {
          margin: 0 0 8px;
          font-size: 22px;
          font-weight: 500;
          letter-spacing: -0.015em;
          color: var(--text-1);
        }
        .l-b-card > p {
          margin: 0;
          color: var(--text-2);
          font-size: 14px;
          max-width: 36ch;
          text-wrap: pretty;
        }
        .l-b-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent-2l);
          font-family: var(--font-mono, 'Geist Mono', monospace);
          margin-bottom: 14px;
        }
        .l-b-tag::before {
          content: "";
          width: 5px; height: 5px;
          border-radius: 999px;
          background: var(--accent-l);
          box-shadow: 0 0 6px var(--accent-l);
        }
        .l-b-visual {
          flex: 1;
          margin: 22px -26px -26px;
          padding: 22px 26px 0;
          position: relative;
          display: grid;
          place-items: center;
          overflow: hidden;
        }

        /* B1 stacked tiles */
        .l-b1-stack {
          position: relative;
          width: 100%;
          height: 220px;
          display: flex;
          justify-content: center;
          perspective: 800px;
        }
        .l-b1-tile {
          position: absolute;
          width: 150px;
          aspect-ratio: 3/4;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid var(--hairline-strong);
          box-shadow: 0 16px 40px -12px rgba(0,0,0,0.5);
          transition: transform 600ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .l-b1-tile.t1 { transform: translateX(-110px) rotate(-8deg) translateY(8px); z-index: 1; }
        .l-b1-tile.t2 { transform: translateX(0) rotate(0deg); z-index: 3; }
        .l-b1-tile.t3 { transform: translateX(110px) rotate(8deg) translateY(8px); z-index: 2; }
        .l-b-card:hover .l-b1-tile.t1 { transform: translateX(-130px) rotate(-12deg) translateY(0); }
        .l-b-card:hover .l-b1-tile.t3 { transform: translateX(130px) rotate(12deg) translateY(0); }
        .l-b-card:hover .l-b1-tile.t2 { transform: translateY(-6px); }

        /* B3 library grid */
        .l-b3-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          width: 100%;
        }
        .l-b3-grid .t {
          aspect-ratio: 1/1;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid var(--hairline);
        }

        /* B4 chat */
        .l-b4-chat {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          max-width: 420px;
          margin: 0 auto;
        }
        .l-b4-msg {
          padding: 9px 12px;
          border-radius: 12px;
          font-size: 12.5px;
          line-height: 1.45;
          max-width: 78%;
        }
        .l-b4-msg-user {
          align-self: flex-end;
          background: var(--accent-soft-l);
          border: 1px solid var(--accent-rim-l);
          color: var(--text-1);
          border-bottom-right-radius: 4px;
        }
        .l-b4-msg-bot {
          align-self: flex-start;
          background: var(--bg-2);
          border: 1px solid var(--hairline);
          color: var(--text-2);
          border-bottom-left-radius: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .l-b4-msg-bot .img {
          width: 36px; height: 44px;
          border-radius: 6px;
          overflow: hidden;
          flex-shrink: 0;
          border: 1px solid var(--hairline);
        }

        @keyframes chatFadeIn {
          from { opacity: 0; transform: translateY(8px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .l-b4-chat-animated {
          display: flex;
          flex-direction: column;
          gap: 10px;
          justify-content: flex-end;
        }
        .l-b4-chat-animated .l-b4-msg {
          animation: chatFadeIn 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .l-typing-dots {
          display: inline-flex;
          gap: 4px;
          align-items: center;
          height: 16px;
        }
        .l-typing-dots span {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: var(--text-3);
          animation: dotBounce 1.2s ease-in-out infinite;
        }
        .l-typing-dots span:nth-child(2) { animation-delay: 0.15s; }
        .l-typing-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes dotBounce {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }

        /* =========== MODELS =========== */
        .l-models-section { padding: 80px 0; }
        .l-models-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-top: 36px;
        }
        .l-model-card {
          background: linear-gradient(180deg, rgba(26,34,64,0.4) 0%, rgba(14,19,34,0.85) 100%);
          border: 1px solid var(--hairline-strong);
          border-radius: 16px;
          padding: 24px;
          position: relative;
          transition: border-color 200ms, transform 200ms;
        }
        .l-model-card:hover {
          border-color: rgba(124,58,237,0.3);
          transform: translateY(-2px);
        }
        .l-model-card-featured {
          border-color: var(--accent-rim-l);
        }
        .l-model-card-featured::after {
          content: "Recomendado";
          position: absolute;
          top: -1px; right: 18px;
          font-size: 10px;
          font-family: var(--font-mono, 'Geist Mono', monospace);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 4px 10px;
          background: var(--accent-l);
          color: #fff;
          border-radius: 0 0 6px 6px;
        }
        .l-model-card .name {
          font-size: 16px;
          font-weight: 500;
          margin: 0 0 4px;
          letter-spacing: -0.01em;
          color: var(--text-1);
        }
        .l-model-card .who {
          font-size: 11.5px;
          color: var(--text-3);
          font-family: var(--font-mono, 'Geist Mono', monospace);
          margin-bottom: 18px;
        }
        .l-model-card .desc {
          font-size: 13.5px;
          color: var(--text-2);
          margin-bottom: 22px;
          min-height: 4em;
          text-wrap: pretty;
        }
        .l-model-card ul {
          margin: 0; padding: 0; list-style: none;
          display: flex; flex-direction: column; gap: 10px;
          font-size: 13px; color: var(--text-2);
        }
        .l-model-card li {
          display: flex; align-items: flex-start; gap: 8px;
        }
        .l-model-card li svg { flex-shrink: 0; margin-top: 3px; color: var(--accent-2l); }
        .l-model-card .meter {
          margin-top: 22px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11.5px;
          color: var(--text-3);
          font-family: var(--font-mono, 'Geist Mono', monospace);
          padding-top: 18px;
          border-top: 1px solid var(--hairline);
        }

        /* =========== PRICING =========== */
        .l-pricing-section { padding: 100px 0 80px; }
        .l-pricing-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-top: 50px;
        }
        .l-tier {
          background: linear-gradient(180deg, rgba(26,34,64,0.4) 0%, rgba(14,19,34,0.85) 100%);
          border: 1px solid var(--hairline-strong);
          border-radius: 18px;
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          position: relative;
        }
        .l-tier-pro {
          border-color: var(--accent-rim-l);
          background:
            radial-gradient(50% 40% at 50% 0%, rgba(124,58,237,0.18), transparent 60%),
            linear-gradient(180deg, rgba(26,34,64,0.5) 0%, rgba(14,19,34,0.9) 100%);
        }
        .l-tier-pro::after {
          content: "Mas popular";
          position: absolute;
          top: -12px; left: 50%;
          transform: translateX(-50%);
          background: var(--accent-l);
          color: #fff;
          font-size: 11px;
          font-weight: 500;
          padding: 4px 12px;
          border-radius: 999px;
          letter-spacing: 0.02em;
        }
        .l-tier .tname { font-size: 13px; font-weight: 500; color: var(--text-2); letter-spacing: 0.05em; text-transform: uppercase; }
        .l-tier .price {
          font-size: 44px;
          font-weight: 400;
          letter-spacing: -0.02em;
          line-height: 1;
          display: flex;
          align-items: baseline;
          gap: 6px;
          color: var(--text-1);
        }
        .l-tier .price .currency { font-size: 18px; color: var(--text-3); }
        .l-tier .price .per { font-size: 13px; color: var(--text-3); }
        .l-tier .summary { font-size: 13.5px; color: var(--text-2); }
        .l-tier .credits {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 999px;
          background: var(--bg-3);
          border: 1px solid var(--hairline-strong);
          font-family: var(--font-mono, 'Geist Mono', monospace);
          font-size: 12px;
          color: var(--text-1);
        }
        .l-tier .credits .ic {
          width: 14px; height: 14px;
          border-radius: 4px;
          background: var(--accent-soft-l);
          display: grid; place-items: center;
          color: var(--accent-2l);
        }
        .l-tier ul {
          list-style: none;
          padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 10px;
          font-size: 13.5px; color: var(--text-2);
        }
        .l-tier ul li { display: flex; align-items: flex-start; gap: 8px; }
        .l-tier ul li svg { flex-shrink: 0; margin-top: 3px; color: var(--accent-2l); }
        .l-tier .cta-btn {
          margin-top: auto;
          padding: 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--hairline-strong);
          color: var(--text-1);
          font-size: 13px;
          font-weight: 500;
          text-align: center;
          text-decoration: none;
          display: block;
          transition: background 140ms;
        }
        .l-tier .cta-btn:hover { background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.18); }
        .l-tier-pro .cta-btn {
          background: linear-gradient(180deg, #8b5cf6, #6d28d9);
          border-color: transparent;
          color: #fff;
          box-shadow: 0 8px 22px -8px var(--accent-glow-l);
        }
        .l-tier-pro .cta-btn:hover {
          background: linear-gradient(180deg, #9b6ff7, #7c3aed);
          box-shadow: 0 12px 30px -8px var(--accent-glow-l);
        }

        /* =========== FAQ =========== */
        .l-faq-section { padding: 80px 0; }
        .l-faq {
          max-width: 720px;
          margin: 0 auto;
        }
        .l-faq-item {
          border-top: 1px solid var(--hairline);
          padding: 18px 0;
        }
        .l-faq-item:last-child {
          border-bottom: 1px solid var(--hairline);
        }
        .l-faq-item summary {
          list-style: none;
          cursor: pointer;
          font-size: 15.5px;
          font-weight: 500;
          color: var(--text-1);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }
        .l-faq-item summary::-webkit-details-marker { display: none; }
        .l-faq-item summary::after {
          content: "+";
          font-size: 22px;
          color: var(--text-3);
          font-weight: 300;
          transition: transform 200ms;
        }
        .l-faq-item[open] summary::after { transform: rotate(45deg); }
        .l-faq-body {
          padding-top: 12px;
          color: var(--text-2);
          font-size: 14px;
          line-height: 1.55;
          text-wrap: pretty;
        }

        /* =========== CTA =========== */
        .l-cta-section { padding: 100px 0 80px; }
        .l-cta-card {
          position: relative;
          text-align: center;
          padding: 80px 32px;
          border-radius: 24px;
          border: 1px solid var(--accent-rim-l);
          background:
            radial-gradient(60% 50% at 50% 0%, rgba(124,58,237,0.25), transparent 70%),
            linear-gradient(180deg, rgba(26,34,64,0.45) 0%, rgba(14,19,34,0.85) 100%);
          overflow: hidden;
        }
        .l-cta-card::before {
          content: "";
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          mask-image: radial-gradient(ellipse at 50% 30%, #000 40%, transparent 75%);
          pointer-events: none;
        }
        .l-cta-card h2 {
          position: relative;
          margin: 0 auto 16px;
          font-size: clamp(30px, 4vw, 46px);
          font-weight: 500;
          letter-spacing: -0.025em;
          max-width: 14ch;
          line-height: 1.05;
          text-wrap: balance;
          color: var(--text-1);
        }
        .l-cta-card p {
          position: relative;
          margin: 0 auto 32px;
          max-width: 480px;
          color: var(--text-2);
        }

        /* =========== FOOTER =========== */
        .l-footer {
          border-top: 1px solid var(--hairline);
          padding: 50px 0 30px;
        }
        .l-foot-row {
          display: grid;
          grid-template-columns: 2fr repeat(3, 1fr);
          gap: 40px;
          margin-bottom: 50px;
        }
        .l-foot-row h5 {
          margin: 0 0 14px;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-3);
          font-weight: 500;
        }
        .l-foot-row ul {
          list-style: none; padding: 0; margin: 0;
          display: flex; flex-direction: column; gap: 10px;
        }
        .l-foot-row a {
          color: var(--text-2);
          font-size: 13.5px;
          transition: color 140ms;
          text-decoration: none;
        }
        .l-foot-row a:hover { color: var(--text-1); }
        .l-foot-brand p {
          margin: 14px 0 0;
          color: var(--text-3);
          font-size: 13px;
          max-width: 32ch;
        }
        .l-foot-bottom {
          padding-top: 24px;
          border-top: 1px solid var(--hairline);
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: var(--text-3);
          font-size: 12px;
          font-family: var(--font-mono, 'Geist Mono', monospace);
        }
        .l-foot-bottom .links {
          display: flex; gap: 18px;
        }
        .l-foot-bottom a {
          color: var(--text-3);
          text-decoration: none;
          transition: color 140ms;
        }
        .l-foot-bottom a:hover { color: var(--text-1); }

        /* =========== RESPONSIVE =========== */
        @media (max-width: 900px) {
          .l-nav-links { display: none; }
          .l-hero { padding: 60px 0 40px; }
          .l-hero-shot { height: auto; }
          .l-hero-shot-window { flex-direction: column; }
          .l-shot-rail { display: none; }
          .l-shot-ctrl { width: 100%; border-right: 0; border-bottom: 1px solid var(--hairline); }
          .l-shot-preview { grid-template-columns: 1fr 1fr; min-height: 320px; }
          .l-bento { grid-template-columns: 1fr; }
          .l-b-1, .l-b-2, .l-b-3, .l-b-4 { grid-column: span 1; }
          .l-models-grid, .l-pricing-grid { grid-template-columns: 1fr; }
          .l-foot-row { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      <div className="landing-page">
        {/* =========== NAV =========== */}
        <nav className={`l-nav${scrolled ? " scrolled" : ""}`}>
          <div className="container-l l-nav-row">
            <Link href="/" className="l-brand">
              <span className="l-brand-mark">
                <ZyraLogo />
              </span>
              Zyra
            </Link>
            <div className="l-nav-links">
              <a href="#producto">Producto</a>
              <a href="#modelos">Modelos</a>
              <a href="#precios">Precios</a>
              <a href="#faq">Preguntas</a>
            </div>
            <div className="l-nav-cta">
              <Link href="/login" className="btn-l btn-l-ghost">
                Iniciar sesion
              </Link>
              <Link href="/signup" className="btn-l btn-l-primary">
                Empezar gratis
              </Link>
            </div>
          </div>
        </nav>

        {/* =========== HERO =========== */}
        <header className="l-hero">
          <div className="container-l l-hero-inner">
            <h1 className="l-hero-title">
              Create <span className="gradient-text">Beyond Limits</span>
            </h1>

            <p className="l-hero-sub">
              Genera imagenes, videos y audio de alta calidad con los mejores modelos del mercado. Una sola herramienta para todo tu trabajo creativo — sin curva de aprendizaje.
            </p>

            <div className="l-hero-cta">
              <Link href="/signup" className="btn-l btn-l-primary btn-l-lg">
                Empezar gratis
                <ArrowIcon />
              </Link>
              <Link href="/login" className="btn-l btn-l-secondary btn-l-lg">
                Ya tengo cuenta
              </Link>
            </div>

            <div className="mono" style={{ fontSize: 12, color: "var(--text-3)", marginTop: 16 }}>
              500 creditos gratis al registrarte. Sin tarjeta de credito.
            </div>
          </div>

          {/* HERO PRODUCT SHOT */}
          <div className="l-hero-shot-wrap" id="producto">
            <div className="l-hero-shot">
              <div className="l-hero-shot-window">
                {/* Sidebar rail */}
                <div className="l-shot-rail">
                  <div className="mark" />
                  <div className="it it-active" />
                  <div className="it" />
                  <div className="it" />
                  <div className="it" />
                </div>

                {/* Controls column — matches real ControlsPanel */}
                <div className="l-shot-ctrl">
                  <div>
                    <h4>
                      <span className="step">1</span> Elige el modelo
                    </h4>
                    <div style={{ background: "var(--bg-2)", border: "1px solid var(--hairline)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, color: "var(--text-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Nano Banana Pro</span>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4l3 3 3-3"/></svg>
                    </div>
                    <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "var(--accent-soft-l)", border: "1px solid var(--accent-rim-l)", fontSize: 11, color: "var(--text-2)", lineHeight: 1.4 }}>
                      Calidad editorial. Edicion conversacional. Hasta 4K.
                    </div>
                  </div>

                  <div>
                    <h4>
                      <span className="step">2</span> Describe tu imagen
                    </h4>
                    <div className="l-shot-prompt">
                      <span>{typedText}</span>
                      <span className="l-caret" />
                    </div>
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-3)" }}>
                        <SparkleIcon />
                        <span>Mejorar con IA</span>
                        <span className="mono" style={{ fontSize: 10, opacity: 0.7 }}>-5 cr</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4>
                      <span className="step">3</span> Brand Kit
                    </h4>
                    <div style={{ background: "var(--bg-2)", border: "1px solid var(--hairline)", borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "var(--text-3)" }}>
                      Sin brand kit
                    </div>
                  </div>

                  <div>
                    <h4>
                      <span className="step">4</span> Formato
                    </h4>
                    <div className="l-shot-aspects">
                      <div className="l-shot-ar l-shot-ar-active">
                        <div className="l-ar-shape" style={{ width: 16, height: 16 }} />
                      </div>
                      <div className="l-shot-ar">
                        <div className="l-ar-shape" style={{ width: 18, height: 12 }} />
                      </div>
                      <div className="l-shot-ar">
                        <div className="l-ar-shape" style={{ width: 12, height: 18 }} />
                      </div>
                      <div className="l-shot-ar">
                        <div className="l-ar-shape" style={{ width: 20, height: 11 }} />
                      </div>
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--hairline)", borderRadius: 6, padding: "5px 8px" }}>
                        <div style={{ width: 12, height: 12, borderRadius: 3, border: "1.5px solid var(--text-3)" }} />
                        Sin fondo
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--hairline)", borderRadius: 6, padding: "5px 8px" }}>
                        <div style={{ width: 12, height: 12, borderRadius: 3, border: "1.5px solid var(--text-3)" }} />
                        Texto en imagen
                      </div>
                    </div>
                  </div>

                  <div className="l-shot-generate">
                    <SparkleIcon />
                    Generar imagen
                    <span className="cost">-90 cr</span>
                  </div>
                </div>

                {/* Preview — result + recent strip */}
                <div className="l-shot-preview">
                  <div className="l-shot-img" style={{ gridColumn: "1 / -1", gridRow: "1 / -1", marginTop: 0, position: "relative" }}>
                    <GradientPlaceholder seed={2} />
                    <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div className="mono" style={{ fontSize: 10, color: "var(--text-2)", background: "rgba(9,9,11,0.7)", borderRadius: 6, padding: "3px 8px", backdropFilter: "blur(6px)", border: "1px solid var(--hairline)" }}>
                        Nano Banana Pro · 1:1 · 2K · -90 cr · 14s
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <div style={{ width: 28, height: 28, borderRadius: "999px", background: "rgba(9,9,11,0.6)", border: "1px solid var(--hairline-strong)", display: "grid", placeItems: "center" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* =========== BENTO =========== */}
        <section className="l-bento-section" id="features">
          <div className="container-l">
            <div className="l-sec-head">
              <span className="l-sec-eyebrow">Una herramienta</span>
              <h2>
                Todo lo que necesitas para <em>crear mas rapido</em>
              </h2>
              <p>
                Imagen, video y audio bajo una misma interfaz. Itera con prompts, edita en lenguaje natural y organiza por proyectos.
              </p>
            </div>

            <div className="l-bento">
              {/* Image generation */}
              <article className="l-b-card l-b-1">
                <span className="l-b-tag">Imagen</span>
                <h3>De prompt a imagen en segundos.</h3>
                <p>
                  3 modelos, brand kit integrado, sin fondo automatico y prompt assistant con IA. Escribe lo que imaginas y Zyra lo crea.
                </p>
                <div className="l-b-visual">
                  <div className="l-b1-stack">
                    <div className="l-b1-tile t1">
                      <GradientPlaceholder seed={5} />
                    </div>
                    <div className="l-b1-tile t2">
                      <GradientPlaceholder seed={2} />
                    </div>
                    <div className="l-b1-tile t3">
                      <GradientPlaceholder seed={0} />
                    </div>
                  </div>
                </div>
              </article>

              {/* Video */}
              <article className="l-b-card l-b-2">
                <span className="l-b-tag">Video</span>
                <h3>Clips cinematograficos en segundos.</h3>
                <p>Kling 3.0 y Veo 3.1 con audio nativo integrado.</p>
                <div className="l-b-visual">
                  <div style={{ width: "100%", position: "relative" }}>
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "16/9",
                        borderRadius: 12,
                        overflow: "hidden",
                        border: "1px solid var(--hairline)",
                        position: "relative",
                      }}
                    >
                      <GradientPlaceholder seed={3} />
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "grid",
                          placeItems: "center",
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "999px",
                            background: "rgba(11,15,25,0.6)",
                            border: "1px solid var(--hairline-strong)",
                            display: "grid",
                            placeItems: "center",
                            backdropFilter: "blur(6px)",
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 12 12" fill="white">
                            <path d="M3 1.5 10 6 3 10.5z" />
                          </svg>
                        </div>
                      </div>
                      <div
                        className="mono"
                        style={{
                          position: "absolute",
                          bottom: 8,
                          left: 8,
                          fontSize: 10,
                          color: "var(--text-2)",
                          background: "rgba(11,15,25,0.7)",
                          borderRadius: 4,
                          padding: "2px 6px",
                        }}
                      >
                        0:05 / 0:10
                      </div>
                    </div>
                  </div>
                </div>
              </article>

              {/* Audio */}
              <article className="l-b-card l-b-3">
                <span className="l-b-tag">Audio</span>
                <h3>Voces realistas en 8 idiomas.</h3>
                <p>Genera narraciones a partir de texto en segundos.</p>
                <div className="l-b-visual">
                  <BentoWave />
                </div>
              </article>

              {/* Conversational */}
              <article className="l-b-card l-b-4">
                <span className="l-b-tag">Edicion conversacional</span>
                <h3>Edita escribiendo lo que quieres cambiar.</h3>
                <p>
                  «Mas cinematica», «sin fondo», «mas contraste» — Zyra entiende intencion, no parametros.
                </p>
                <div className="l-b-visual">
                  <AnimatedChat />
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* =========== MODELS =========== */}
        <section className="l-models-section" id="modelos">
          <div className="container-l">
            <div className="l-sec-head">
              <span className="l-sec-eyebrow">Modelos</span>
              <h2>
                Los mejores motores, <em>una sola cuenta</em>
              </h2>
              <p>Pagas creditos segun el modelo. Zyra te sugiere el adecuado segun la tarea.</p>
            </div>

            <div className="l-models-grid">
              <div className="l-model-card">
                <div className="name">Imagen</div>
                <div className="who">Nano Banana Pro · FLUX 2 Pro · Nano Flash</div>
                <p className="desc">
                  Tres modelos para cada necesidad: borradores rapidos, calidad editorial con edicion conversacional, o fotorrealismo de produccion.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    Hasta 4K de resolucion
                  </li>
                  <li>
                    <CheckIcon />
                    Brand kit integrado
                  </li>
                  <li>
                    <CheckIcon />
                    Sin fondo automatico (PNG)
                  </li>
                  <li>
                    <CheckIcon />
                    Edicion conversacional
                  </li>
                </ul>
                <div className="meter">
                  <span>~6-18 s</span>
                  <span>30-120 cr</span>
                </div>
              </div>

              <div className="l-model-card l-model-card-featured">
                <div className="name">Video</div>
                <div className="who">Kling 3.0 Standard/Pro · Veo 3.1 Fast/Standard/Lite</div>
                <p className="desc">
                  Genera clips cinematograficos con audio nativo. Duracion flexible, imagenes de referencia y estilos predefinidos.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    Texto en imagen perfecto
                  </li>
                  <li>
                    <CheckIcon />
                    Edicion conversacional
                  </li>
                  <li>
                    <CheckIcon />
                    5-10s con Kling, 4-8s con Veo
                  </li>
                  <li>
                    <CheckIcon />
                    Audio nativo (Kling toggle, Veo siempre)
                  </li>
                  <li>
                    <CheckIcon />
                    Imagenes de referencia (inicio + final)
                  </li>
                </ul>
                <div className="meter">
                  <span>5-10s Kling · 4-8s Veo</span>
                  <span>40-300 cr/s</span>
                </div>
              </div>

              <div className="l-model-card">
                <div className="name">Audio</div>
                <div className="who">ElevenLabs Multilingual v2 · Flash v2.5 · V3</div>
                <p className="desc">
                  Texto a voz en 8 idiomas con clonacion de voz. Tags expresivos, chunking automatico para textos largos.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    Clonacion de voz (experimental, gratis)
                  </li>
                  <li>
                    <CheckIcon />
                    Hasta 20.000 caracteres por generacion
                  </li>
                  <li>
                    <CheckIcon />
                    3 modelos: calidad, velocidad o expresividad
                  </li>
                </ul>
                <div className="meter">
                  <span>~3-15 s</span>
                  <span>70-350 cr/1000 chars</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =========== PRICING =========== */}
        <section className="l-pricing-section" id="precios">
          <div className="container-l">
            <div className="l-sec-head">
              <span className="l-sec-eyebrow">Creditos</span>
              <h2>
                Paga solo por lo que <em>creas</em>
              </h2>
              <p>500 creditos gratis al registrarte. Compra packs cuando los necesites.</p>
            </div>

            <div className="l-pricing-grid">
              {/* Gratis */}
              <div className="l-tier">
                <div className="tname">Registro</div>
                <div className="price">
                  500
                  <span className="per">creditos gratis</span>
                </div>
                <div className="summary">Para explorar Zyra sin compromiso.</div>
                <span className="credits">
                  <span className="ic">
                    <CreditIcon />
                  </span>
                  Al crear tu cuenta
                </span>
                <ul>
                  <li>
                    <CheckIcon />
                    Todos los modelos disponibles
                  </li>
                  <li>
                    <CheckIcon />
                    Imagen, video y audio
                  </li>
                  <li>
                    <CheckIcon />
                    Prompt assistant, brand kits, campanas
                  </li>
                </ul>
                <Link href="/signup" className="cta-btn">
                  Empezar gratis
                </Link>
              </div>

              {/* Pack recomendado */}
              <div className="l-tier l-tier-pro">
                <div className="tname">Costos por generacion</div>
                <div className="price" style={{ fontSize: 28 }}>
                  Pago por uso
                </div>
                <div className="summary">Cada modelo consume creditos diferentes.</div>
                <span className="credits">
                  <span className="ic">
                    <CreditIcon />
                  </span>
                  Compra packs desde billing
                </span>
                <ul>
                  <li>
                    <CheckIcon />
                    Imagen: desde 30 cr (Flash) a 120 cr (Pro 4K)
                  </li>
                  <li>
                    <CheckIcon />
                    Video: 40-300 cr/s segun modelo
                  </li>
                  <li>
                    <CheckIcon />
                    Audio: 70-350 cr por 1000 caracteres
                  </li>
                  <li>
                    <CheckIcon />
                    Prompt assistant: 5 cr por mejora
                  </li>
                </ul>
                <Link href="/signup" className="cta-btn">
                  Crear cuenta
                </Link>
              </div>

              {/* Features */}
              <div className="l-tier">
                <div className="tname">Todo incluido</div>
                <div className="price" style={{ fontSize: 28 }}>
                  Sin limites
                </div>
                <div className="summary">Todas las features desde el dia uno.</div>
                <span className="credits">
                  <span className="ic">
                    <CreditIcon />
                  </span>
                  Sin planes ni suscripciones
                </span>
                <ul>
                  <li>
                    <CheckIcon />
                    Clonacion de voz (gratis, experimental)
                  </li>
                  <li>
                    <CheckIcon />
                    Presets comunitarios
                  </li>
                  <li>
                    <CheckIcon />
                    Edicion conversacional
                  </li>
                  <li>
                    <CheckIcon />
                    Biblioteca, campanas, referencias
                  </li>
                </ul>
                <Link href="/signup" className="cta-btn">
                  Empezar gratis
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* =========== FAQ =========== */}
        <section className="l-faq-section" id="faq">
          <div className="container-l">
            <div className="l-sec-head">
              <span className="l-sec-eyebrow">Preguntas</span>
              <h2>Lo que mas nos preguntan</h2>
            </div>
            <div className="l-faq">
              <details className="l-faq-item" open>
                <summary>Como funcionan los creditos?</summary>
                <div className="l-faq-body">
                  Cada generacion consume creditos segun el modelo y tipo. Imagenes desde 30 cr (Flash) hasta 120 cr (Pro 4K). Video desde 40 cr/s (Kling Standard) hasta 300 cr/s (Veo Standard). Audio desde 70 cr/1000 chars (Flash) hasta 350 cr (V3). Recibes 500 creditos gratis al registrarte.
                </div>
              </details>
              <details className="l-faq-item">
                <summary>Que modelos de imagen hay?</summary>
                <div className="l-faq-body">
                  Nano Banana Pro (editorial, edicion conversacional, 4K), Nano Flash (rapido, borradores), y FLUX 2 Pro (fotorrealismo de produccion). Puedes usar brand kits para inyectar tu identidad visual automaticamente.
                </div>
              </details>
              <details className="l-faq-item">
                <summary>Que modelos de video incluye?</summary>
                <div className="l-faq-body">
                  Kling 3.0 Standard y Pro (5-10s, audio nativo opcional, imagenes de referencia inicio+final) y Veo 3.1 Fast, Standard y Lite (4-8s, audio nativo siempre incluido, hasta 1080p).
                </div>
              </details>
              <details className="l-faq-item">
                <summary>Puedo clonar mi voz?</summary>
                <div className="l-faq-body">
                  Si, la clonacion de voz esta disponible como feature experimental y gratuita. Sube 1-2 minutos de audio limpio y usa tu voz clonada en cualquier generacion de texto a voz.
                </div>
              </details>
              <details className="l-faq-item">
                <summary>Que son los presets comunitarios?</summary>
                <div className="l-faq-body">
                  Puedes guardar la configuracion de cualquier generacion como preset y publicarlo para que otros lo usen. Explora presets de la comunidad con imagen, modelo y prompt listos para generar.
                </div>
              </details>
              <details className="l-faq-item">
                <summary>Como funciona el prompt assistant?</summary>
                <div className="l-faq-body">
                  Usa Gemini Flash para reescribir tu prompt optimizado para el modelo elegido. Funciona en imagen, video y audio con instrucciones especializadas para cada tipo.
                </div>
              </details>
            </div>
          </div>
        </section>

        {/* =========== CTA =========== */}
        <section className="l-cta-section">
          <div className="container-l">
            <div className="l-cta-card">
              <h2>Empieza a crear en 30 segundos</h2>
              <p>500 creditos gratis al registrarte. Sin tarjeta. Sin suscripcion.</p>
              <div style={{ position: "relative", display: "inline-flex", gap: 10 }}>
                <Link href="/signup" className="btn-l btn-l-primary btn-l-lg">
                  Empezar gratis
                  <ArrowIcon />
                </Link>
                <Link href="/login" className="btn-l btn-l-secondary btn-l-lg">
                  Iniciar sesion
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* =========== FOOTER =========== */}
        <footer className="l-footer">
          <div className="container-l">
            <div className="l-foot-row" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
              <div className="l-foot-brand">
                <Link href="/" className="l-brand">
                  <span className="l-brand-mark">
                    <ZyraLogo />
                  </span>
                  Zyra Studio
                </Link>
                <p>Plataforma creativa con IA. Imagen, video y audio para creadores.</p>
              </div>
              <div>
                <h5>Producto</h5>
                <ul>
                  <li><a href="#features">Imagen</a></li>
                  <li><a href="#features">Video</a></li>
                  <li><a href="#features">Audio</a></li>
                  <li><a href="#modelos">Modelos</a></li>
                </ul>
              </div>
              <div>
                <h5>Cuenta</h5>
                <ul>
                  <li><Link href="/signup">Crear cuenta</Link></li>
                  <li><Link href="/login">Iniciar sesion</Link></li>
                  <li><a href="#precios">Creditos</a></li>
                  <li><a href="#faq">Preguntas</a></li>
                </ul>
              </div>
            </div>
            <div className="l-foot-bottom">
              <span>2026 Zyra Studio</span>
              <div className="links">
                <a href="#faq">FAQ</a>
                <a href="#precios">Precios</a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
