"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import "./landing.css";

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
      grad.addColorStop(0, "rgba(0,198,255,0)");
      grad.addColorStop(0.5, "rgba(51,183,255,1)");
      grad.addColorStop(1, "rgba(0,159,255,0)");

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
      ctx!.shadowColor = "rgba(0,159,255,0.6)";
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
  { role: "user" as const, text: "Más cinemática, contraluz cálido", img: "" },
  { role: "bot" as const, text: "", img: "/landing/gen-2.jpg" },
  { role: "user" as const, text: "Más contraste en las sombras", img: "" },
  { role: "bot" as const, text: "", img: "/landing/gen-4.jpg" },
  { role: "user" as const, text: "Agrega texto: 1to1 Studio", img: "" },
  { role: "bot" as const, text: "", img: "/landing/gen-1.jpg" },
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
          key={`${i}-${m.text || m.img}`}
          className={`l-b4-msg ${m.role === "user" ? "l-b4-msg-user" : "l-b4-msg-bot"}`}
          style={{ animation: "chatFadeIn 300ms ease-out" }}
        >
          {m.role === "bot" ? (
            <span className="img">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.img} alt="" className="block w-full h-full object-cover" />
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
function BrandLogo({ height = 40 }: { height?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt=""
      className="block"
      style={{ height, width: 'auto' }}
    />
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
/*  MAIN PAGE                                                          */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  const typedText = useTypingAnimation(
    "Retrato editorial de una mujer, luz suave de ventana, pelicula 35mm, fondo gris calido"
  );

  const landingImages = {
    hero: '/landing/gen-4.jpg',
    bento1a: '/landing/gen-2.jpg',
    bento1b: '/landing/gen-3.jpg',
    bento1c: '/landing/gen-4.jpg',
    bento2: '/landing/gen-1.jpg',
    chat1: '/landing/gen-2.jpg',
    chat2: '/landing/gen-4.jpg',
    chat3: '/landing/gen-1.jpg',
  };

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <>

      <div className="landing-page">
        {/* =========== NAV =========== */}
        <nav className={`l-nav${scrolled ? " scrolled" : ""}`}>
          <div className="container-l l-nav-row">
            <Link href="/" className="l-brand">
              <span className="l-brand-mark">
                <BrandLogo />
              </span>
              1to1 Studio
            </Link>
            <div className="l-nav-links">
              <a href="#producto">Producto</a>
              <a href="#modelos">Modelos</a>
              <a href="#precios">Precios</a>
              <a href="#faq">Preguntas</a>
            </div>
            <div className="l-nav-cta">
              <Link href="/login" className="btn-l btn-l-ghost">
                Iniciar sesión
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
              Genera imágenes, videos y audio de alta calidad con los mejores modelos del mercado. Una sola herramienta para todo tu trabajo creativo — sin curva de aprendizaje.
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
              500 créditos gratis al registrarte. Sin tarjeta de crédito.
            </div>
          </div>

          {/* HERO PRODUCT SHOT */}
          <div className="l-hero-shot-wrap" id="producto">
            <div className="l-hero-shot">
              <div className="l-hero-shot-window">
                {/* Sidebar rail */}
                <div className="l-shot-rail">
                  <div className="mark">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.png" alt="" />
                  </div>
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
                      Calidad editorial. Edición conversacional. Hasta 4K.
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
                    <span className="cost">-40 cr</span>
                  </div>
                </div>

                {/* Preview — result + recent strip */}
                <div className="l-shot-preview">
                  <div className="l-shot-img" style={{ gridColumn: "1 / -1", gridRow: "1 / -1", marginTop: 0, position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={landingImages.hero} alt="Generación de ejemplo" className="block w-full h-full object-cover" />
                    <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div className="mono" style={{ fontSize: 10, color: "var(--text-2)", background: "rgba(9,9,11,0.7)", borderRadius: 6, padding: "3px 8px", backdropFilter: "blur(6px)", border: "1px solid var(--hairline)" }}>
                        Nano Banana Pro · 1:1 · 2K · -40 cr · 14s
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
                Todo lo que necesitas para <em>crear más rápido</em>
              </h2>
              <p>
                Imagen, video y audio bajo una misma interfaz. Itera con prompts, edita en lenguaje natural y organízalo por proyectos.
              </p>
            </div>

            <div className="l-bento">
              {/* Image generation */}
              <article className="l-b-card l-b-1">
                <span className="l-b-tag">Imagen</span>
                <h3>De prompt a imagen en segundos</h3>
                <p>
                  3 modelos, brand kit integrado, sin fondo automático y prompt assistant con IA. Escribe lo que imaginas y 1to1 lo crea.
                </p>
                <div className="l-b-visual">
                  <div className="l-b1-stack">
                    <div className="l-b1-tile t1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={landingImages.bento1a} alt="" className="block w-full h-full object-cover" />
                    </div>
                    <div className="l-b1-tile t2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={landingImages.bento1b} alt="" className="block w-full h-full object-cover" />
                    </div>
                    <div className="l-b1-tile t3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={landingImages.bento1c} alt="" className="block w-full h-full object-cover" />
                    </div>
                  </div>
                </div>
              </article>

              {/* Video */}
              <article className="l-b-card l-b-2">
                <span className="l-b-tag">Video</span>
                <h3>Clips cinematográficos en segundos</h3>
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={landingImages.bento2} alt="" className="block w-full h-full object-cover" />
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
                <h3>Voces realistas en 8 idiomas</h3>
                <p>Genera narraciones a partir de texto en segundos</p>
                <div className="l-b-visual">
                  <BentoWave />
                </div>
              </article>

              {/* Conversational */}
              <article className="l-b-card l-b-4">
                <span className="l-b-tag">Edición conversacional</span>
                <h3>Edita escribiendo lo que quieres cambiar</h3>
                <p>
                  «Más cinemática», «sin fondo», «más contraste» — 1to1 entiende intención, no parámetros.
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
              <p>Pagas créditos según el modelo. 1to1 te sugiere el adecuado según la tarea.</p>
            </div>

            <div className="l-models-grid">
              <div className="l-model-card">
                <div className="name">Imagen</div>
                <div className="who">Nano Banana Pro · FLUX 2 Pro · Nano Flash</div>
                <p className="desc">
                  Tres modelos para cada necesidad: borradores rápidos, calidad editorial con edición conversacional, o fotorrealismo de producción.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    Hasta 4K de resolución
                  </li>
                  <li>
                    <CheckIcon />
                    Brand kit integrado
                  </li>
                  <li>
                    <CheckIcon />
                    Sin fondo automático (PNG)
                  </li>
                  <li>
                    <CheckIcon />
                    Edición conversacional
                  </li>
                </ul>
                <div className="meter">
                  <span>~6-18 s</span>
                  <span>20-75 cr</span>
                </div>
              </div>

              <div className="l-model-card l-model-card-featured">
                <div className="name">Video</div>
                <div className="who">Kling 3.0 Standard/Pro · Veo 3.1 Fast/Standard/Lite</div>
                <p className="desc">
                  Genera clips cinematográficos con audio nativo. Duración flexible, imágenes de referencia y estilos predefinidos.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    Audio nativo integrado
                  </li>
                  <li>
                    <CheckIcon />
                    Edición conversacional
                  </li>
                  <li>
                    <CheckIcon />
                    5-10s con Kling, 4-8s con Veo
                  </li>
                  <li>
                    <CheckIcon />
                    Audio nativo (Kling opcional, Veo siempre)
                  </li>
                  <li>
                    <CheckIcon />
                    Imágenes de referencia (inicio + final)
                  </li>
                </ul>
                <div className="meter">
                  <span>5-10s Kling · 4-8s Veo</span>
                  <span>15-120 cr/s</span>
                </div>
              </div>

              <div className="l-model-card">
                <div className="name">Audio</div>
                <div className="who">ElevenLabs Multilingual v2 · Flash v2.5 · V3</div>
                <p className="desc">
                  Texto a voz en 8 idiomas con clonación de voz. Tags expresivos, chunking automático para textos largos.
                </p>
                <ul>
                  <li>
                    <CheckIcon />
                    Clonación de voz (experimental, gratis)
                  </li>
                  <li>
                    <CheckIcon />
                    Hasta 20.000 caracteres por generación
                  </li>
                  <li>
                    <CheckIcon />
                    3 modelos: calidad, velocidad o expresividad
                  </li>
                </ul>
                <div className="meter">
                  <span>~3-15 s</span>
                  <span>15-30 cr/1000 chars</span>
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
                Paga solo por lo que <em>crees</em>
              </h2>
              <p>500 créditos gratis al registrarte. Compra packs cuando los necesites.</p>
            </div>

            <div className="l-pricing-grid">
              {/* Gratis */}
              <div className="l-tier">
                <div className="tname">Registro</div>
                <div className="price">
                  500
                  <span className="per">créditos gratis</span>
                </div>
                <div className="summary">Para explorar 1to1 sin compromiso</div>
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
                    Prompt assistant, brand kits, campañas
                  </li>
                </ul>
                <Link href="/signup" className="cta-btn">
                  Empezar gratis
                </Link>
              </div>

              {/* Pack recomendado */}
              <div className="l-tier l-tier-pro">
                <div className="tname">Costos por generación</div>
                <div className="price" style={{ fontSize: 28 }}>
                  Pago por uso
                </div>
                <div className="summary">Cada modelo consume créditos diferentes.</div>
                <span className="credits">
                  <span className="ic">
                    <CreditIcon />
                  </span>
                  Compra packs desde billing
                </span>
                <ul>
                  <li>
                    <CheckIcon />
                    Imagen: desde 20 cr (Flash) hasta 75 cr (Pro 4K)
                  </li>
                  <li>
                    <CheckIcon />
                    Video: 15-120 cr/s según modelo
                  </li>
                  <li>
                    <CheckIcon />
                    Audio: 15-30 cr por 1000 caracteres
                  </li>
                  <li>
                    <CheckIcon />
                    Prompt assistant: 3 cr por mejora
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
                  Sin límites
                </div>
                <div className="summary">Todas las features desde el día uno.</div>
                <span className="credits">
                  <span className="ic">
                    <CreditIcon />
                  </span>
                  Sin planes ni suscripciones

                </span>
                <ul>
                  <li>
                    <CheckIcon />
                    Clonación de voz (gratis, experimental)
                  </li>
                  <li>
                    <CheckIcon />
                    Presets comunitarios
                  </li>
                  <li>
                    <CheckIcon />
                    Edición conversacional
                  </li>
                  <li>
                    <CheckIcon />
                    Biblioteca, campañas, referencias
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
              <h2>Lo que más nos preguntan</h2>
            </div>
            <div className="l-faq">
              <details className="l-faq-item" open>
                <summary>¿Cómo funcionan los créditos?</summary>
                <div className="l-faq-body">
                  Cada generación consume créditos según el modelo y tipo. Imágenes desde 20 cr (Flash) hasta 75 cr (Pro 4K). Video desde 15 cr/s (Veo Lite) hasta 120 cr/s (Veo Standard). Audio desde 15 cr/1000 chars (Flash) hasta 30 cr (V3). Recibes 500 créditos gratis al registrarte.
                </div>
              </details>
              <details className="l-faq-item">
                <summary>¿Qué modelos de imagen hay?</summary>
                <div className="l-faq-body">
                  Nano Banana Pro (editorial, edición conversacional, 4K), Nano Flash (rápido, borradores), y FLUX 2 Pro (fotorrealismo de producción). Puedes usar brand kits para inyectar tu identidad visual automáticamente.
                </div>
              </details>
              <details className="l-faq-item">
                <summary>¿Qué modelos de video incluye?</summary>
                <div className="l-faq-body">
                  Kling 3.0 Standard y Pro (5-10s, audio nativo opcional, imágenes de referencia inicio+final) y Veo 3.1 Fast, Standard y Lite (4-8s, audio nativo siempre incluido, hasta 1080p).
                </div>
              </details>
              <details className="l-faq-item">
                <summary>¿Puedo clonar mi voz?</summary>
                <div className="l-faq-body">
                  Sí, la clonación de voz está disponible como feature experimental y gratuita. Sube 1-2 minutos de audio limpio y usa tu voz clonada en cualquier generación de texto a voz.
                </div>
              </details>
              <details className="l-faq-item">
                <summary>¿Qué son los presets comunitarios?</summary>
                <div className="l-faq-body">
                  Puedes guardar la configuración de cualquier generación como preset y publicarlo para que otros lo usen. Explora presets de la comunidad con imagen, modelo y prompt listos para generar.
                </div>
              </details>
              <details className="l-faq-item">
                <summary>¿Cómo funciona el prompt assistant?</summary>
                <div className="l-faq-body">
                  Usa Gemini Flash para reescribir tu prompt optimizado para el modelo elegido. Funciona en imagen, video y audio con instrucciones especializadas para cada tipo de contenido.
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
              <p>500 créditos gratis al registrarte. Sin tarjeta. Sin suscripción.</p>
              <div className="l-cta-buttons">
                <Link href="/signup" className="btn-l btn-l-primary btn-l-lg">
                  Empezar gratis
                  <ArrowIcon />
                </Link>
                <Link href="/login" className="btn-l btn-l-secondary btn-l-lg">
                  Iniciar sesión
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
                    <BrandLogo />
                  </span>
                  1to1 Studio
                </Link>
                <p>Plataforma creativa con IA. Imagen, video y audio para creadores</p>
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
                  <li><Link href="/login">Iniciar sesión</Link></li>
                  <li><a href="#precios">Creditos</a></li>
                  <li><a href="#faq">Preguntas</a></li>
                </ul>
              </div>
            </div>
            <div className="l-foot-bottom">
              <span>2026 1to1 Studio</span>
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
