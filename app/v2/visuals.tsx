"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "./reveal";

/* =================== Onda de audio (canvas) =================== */
export function AudioWave() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = (t: number) => {
      const time = t / 1000;
      const W = canvas.width;
      const H = canvas.height;
      const MID = H / 2;
      ctx.clearRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "rgba(0,198,255,0)");
      grad.addColorStop(0.5, "rgba(51,183,255,1)");
      grad.addColorStop(1, "rgba(0,159,255,0)");
      ctx.beginPath();
      const N = 56;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const x = u * W;
        const edge = Math.sin(u * Math.PI);
        const a =
          Math.sin(time * 2 + u * 8) * 0.55 +
          Math.sin(time * 3.4 + u * 15) * 0.32 +
          Math.sin(time * 5.8 + u * 24) * 0.18;
        const env = 0.5 + 0.5 * Math.sin(time * 0.7 + u * 2);
        const y = MID + a * env * edge * 28;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(0,159,255,0.6)";
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={300} height={90} className="h-[80px] w-full" />;
}

/* =================== Chat de dirección creativa =================== */
type Msg = { role: "user" | "bot"; text?: string; img?: string };

const FLOW: Msg[] = [
  { role: "user", text: "Más cinemática, contraluz cálido" },
  { role: "bot", img: "/landing/gen-2.jpg" },
  { role: "user", text: "Genera una variante para TikTok" },
  { role: "bot", img: "/landing/gen-4.jpg" },
  { role: "user", text: "Caption: «Tu verano, en 1to1»" },
  { role: "bot", img: "/landing/gen-1.jpg" },
];

export function DirectionChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [idx, setIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (idx >= FLOW.length) {
        timer = setTimeout(() => {
          setMsgs([]);
          setIdx(0);
        }, 2400);
        return;
      }
      setTyping(true);
      const delay = FLOW[idx].role === "bot" ? 1300 : 550;
      timer = setTimeout(() => {
        setTyping(false);
        setMsgs((prev) => [...prev, FLOW[idx]]);
        setIdx((i) => i + 1);
      }, delay);
    };
    timer = setTimeout(step, 600);
    return () => clearTimeout(timer);
  }, [idx]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, typing]);

  const typingRole = idx < FLOW.length ? FLOW[idx].role : "bot";

  return (
    <div
      ref={scrollRef}
      className="flex h-[180px] flex-col gap-2.5 overflow-hidden"
      style={{
        maskImage: "linear-gradient(transparent 0, black 36px, black 100%)",
        WebkitMaskImage: "linear-gradient(transparent 0, black 36px, black 100%)",
      }}
    >
      {msgs.map((m, i) => (
        <motion.div
          key={`${i}-${m.text ?? m.img}`}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "max-w-[80%] rounded-xl px-3 py-2 text-[12.5px] leading-snug",
            m.role === "user"
              ? "self-end rounded-br-sm border border-[#009fff]/35 bg-[#009fff]/15 text-zinc-100"
              : "self-start rounded-bl-sm border border-white/8 bg-zinc-800/80 text-zinc-300"
          )}
        >
          {m.role === "bot" && m.img ? (
            <span className="block h-11 w-9 overflow-hidden rounded-md border border-white/10">
              <Image src={m.img} alt="" width={36} height={44} className="h-full w-full object-cover" />
            </span>
          ) : (
            m.text
          )}
        </motion.div>
      ))}
      {typing && (
        <div
          className={cn(
            "max-w-[80%] rounded-xl px-3 py-2.5",
            typingRole === "user"
              ? "self-end border border-[#009fff]/35 bg-[#009fff]/15"
              : "self-start border border-white/8 bg-zinc-800/80"
          )}
        >
          <span className="flex h-3 items-center gap-1">
            {[0, 1, 2].map((d) => (
              <motion.span
                key={d}
                className="h-1.5 w-1.5 rounded-full bg-zinc-400"
                animate={{ y: [0, -3, 0], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: d * 0.15 }}
              />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

/* =================== Dirección del Prompt Director =================== */
const PLAN_ROWS = [
  { k: "Formato", v: "Voz Cercana" },
  { k: "Concepto", v: "Testimonio: resultado en 7 días" },
  { k: "Cámara", v: "Selfie handheld, a nivel de ojos" },
  { k: "Modelo", v: "Seedance 2.0 · 8 s · 9:16" },
];

/* Representa cómo el Prompt Director razona un brief en dirección de producción:
   campos por formato/modelo + referencias @ + validación de producibilidad. */
export function PlanMock() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setN((x) => (x >= PLAN_ROWS.length + 1 ? 0 : x + 1)),
      1050
    );
    return () => clearInterval(t);
  }, []);

  return (
    <div className="font-mono text-[12px]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-zinc-500">brief → dirección</span>
        <span className="text-[#7cd9ff]">Prompt Director</span>
      </div>
      <div className="space-y-1.5">
        {PLAN_ROWS.map((row, i) => (
          <motion.div
            key={row.k}
            initial={false}
            animate={{ opacity: n > i ? 1 : 0.18 }}
            transition={{ duration: 0.3 }}
            className="flex gap-2"
          >
            <span className="w-16 shrink-0 text-zinc-500">{row.k}</span>
            <span className="text-zinc-200">{row.v}</span>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={false}
        animate={{ opacity: n > PLAN_ROWS.length ? 1 : 0.18 }}
        transition={{ duration: 0.3 }}
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {["@Producto frontal", "@Cast: Sofía"].map((r) => (
          <span
            key={r}
            className="rounded-md border border-[#009fff]/30 bg-[#009fff]/10 px-1.5 py-0.5 text-[11px] text-[#7cd9ff]"
          >
            {r}
          </span>
        ))}
      </motion.div>
      <motion.div
        initial={false}
        animate={{ opacity: n > PLAN_ROWS.length ? 1 : 0.18 }}
        transition={{ duration: 0.3 }}
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-emerald-400"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        Producible · 1 acción + 1 movimiento por toma
      </motion.div>
    </div>
  );
}

/* =================== Marquee de creativos =================== */
const SHOTS = [
  "/landing/gen-1.jpg",
  "/landing/gen-2.jpg",
  "/landing/gen-3.jpg",
  "/landing/gen-4.jpg",
];

export function CreativesMarquee() {
  const row = [...SHOTS, ...SHOTS, ...SHOTS];
  return (
    <div className="relative overflow-hidden py-2">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24"
        style={{ background: "linear-gradient(90deg, #09090b, transparent)" }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24"
        style={{ background: "linear-gradient(270deg, #09090b, transparent)" }}
      />
      <motion.div
        className="flex gap-4"
        animate={{ x: ["0%", "-33.333%"] }}
        transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
      >
        {row.map((src, i) => (
          <div
            key={i}
            className="relative h-44 w-32 shrink-0 overflow-hidden rounded-xl border border-white/8 sm:h-56 sm:w-40"
          >
            <Image
              src={src}
              alt=""
              fill
              sizes="160px"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </div>
        ))}
      </motion.div>
    </div>
  );
}
