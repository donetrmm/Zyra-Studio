"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Play, Check } from "lucide-react";
import { cn } from "./reveal";

const EASE = [0.21, 0.47, 0.32, 0.98] as const;

/* Titular con revelado palabra por palabra; las últimas dos en gradiente de acento. */
function Headline({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <h1 className="text-[2.6rem] sm:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.05]">
      {words.map((w, i) => {
        const accent = i >= words.length - 2;
        return (
          <motion.span
            key={`${w}-${i}`}
            className={cn(
              "inline-block",
              accent &&
                "bg-gradient-to-r from-[#7cd9ff] via-[#00c6ff] to-[#009fff] bg-clip-text text-transparent"
            )}
            initial={{ opacity: 0, y: "0.4em", filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.15 + i * 0.07, duration: 0.7, ease: EASE }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        );
      })}
    </h1>
  );
}

type Stage = { id: string; label: string; status: "done" | "active" | "pending" };

const BASE: Stage[] = [
  { id: "plan", label: "Plan", status: "done" },
  { id: "muestra", label: "Muestra", status: "active" },
  { id: "lote", label: "Lote", status: "pending" },
  { id: "entrega", label: "Entrega", status: "pending" },
];

/* Mock del pipeline de campaña: avanza solo de etapa en etapa. */
function PipelineMock() {
  const [stages, setStages] = useState<Stage[]>(BASE);
  const [progress, setProgress] = useState(33);

  useEffect(() => {
    const t = setInterval(() => {
      setStages((prev) => {
        const active = prev.findIndex((s) => s.status === "active");
        if (active === -1 || active >= prev.length - 1) return BASE;
        return prev.map((s, i) => {
          if (i <= active) return { ...s, status: "done" };
          if (i === active + 1) return { ...s, status: "active" };
          return { ...s, status: "pending" };
        });
      });
      setProgress((p) => (p >= 100 ? 33 : p + 33 > 100 ? 100 : p + 33));
    }, 2100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative w-full">
      <div className="relative">
        <div className="flex justify-between mb-7 relative z-10">
          {stages.map((stage) => (
            <div key={stage.id} className="flex flex-col items-center gap-3">
              <motion.div
                className={cn(
                  "w-11 h-11 rounded-full grid place-items-center border transition-colors duration-500",
                  stage.status === "done" && "bg-[#009fff] border-[#009fff]",
                  stage.status === "active" &&
                    "bg-[#009fff]/15 border-[#009fff]",
                  stage.status === "pending" &&
                    "bg-zinc-900 border-zinc-700"
                )}
                animate={
                  stage.status === "active"
                    ? {
                        boxShadow: [
                          "0 0 0px rgba(0,159,255,0.0)",
                          "0 0 24px rgba(0,159,255,0.55)",
                          "0 0 0px rgba(0,159,255,0.0)",
                        ],
                      }
                    : { boxShadow: "0 0 0px rgba(0,159,255,0)" }
                }
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                {stage.status === "done" ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  >
                    <Check className="w-5 h-5 text-white" strokeWidth={3} />
                  </motion.span>
                ) : stage.status === "active" ? (
                  <motion.span
                    className="w-2.5 h-2.5 rounded-full bg-[#009fff]"
                    animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                  />
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
                )}
              </motion.div>
              <span
                className={cn(
                  "text-[13px] font-medium transition-colors duration-500",
                  stage.status === "pending" ? "text-zinc-500" : "text-[#7cd9ff]"
                )}
              >
                {stage.label}
              </span>
            </div>
          ))}
        </div>

        <div className="absolute top-[22px] left-5 right-5 h-px bg-zinc-800">
          <motion.div
            className="h-full bg-[#009fff] shadow-[0_0_10px_rgba(0,159,255,0.8)]"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          />
        </div>
      </div>

      <div className="mt-7 rounded-xl bg-zinc-950/60 border border-white/10 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-400">Campaña · Lanzamiento Verano</span>
          <span className="text-xs font-mono text-[#7cd9ff]">{progress}%</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-[#009fff] to-[#00c6ff]"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {["/landing/gen-3.jpg", "/landing/gen-4.jpg", "/landing/gen-2.jpg"].map(
            (img, i) => (
              <motion.div
                key={img}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.12, duration: 0.5 }}
                className="relative h-16 overflow-hidden rounded-lg border border-white/10"
              >
                <Image src={img} alt="" fill sizes="90px" className="object-cover" />
              </motion.div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <header className="relative overflow-hidden">
      {/* Grid sutil + glow superior */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
        }}
      />
      <motion.div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[480px] w-[820px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(0,159,255,0.22), transparent)" }}
        animate={{ opacity: [0.5, 0.85, 0.5] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative mx-auto max-w-[1180px] px-7 pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Columna texto */}
          <div className="space-y-7">
            <motion.div
              className="inline-flex items-center gap-2 rounded-full border border-[#009fff]/25 bg-[#009fff]/10 px-3.5 py-1.5"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.6 }}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#009fff] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#009fff]" />
              </span>
              <span className="text-[13px] font-medium text-[#7cd9ff]">
                Campaign Studio
              </span>
            </motion.div>

            <Headline text="De un brief a una campaña completa" />

            <motion.p
              className="text-lg text-zinc-400 leading-relaxed max-w-xl"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              1to1 Studio dirige, produce y entrega campañas publicitarias con
              calidad de director creativo senior — en lote, con menos
              iteraciones y costo visible.
            </motion.p>

            <motion.div
              className="flex flex-col sm:flex-row gap-3"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65, duration: 0.6 }}
            >
              <Link
                href="/signup"
                className="group relative inline-flex items-center justify-center gap-2 rounded-xl bg-[#009fff] px-7 py-3.5 font-semibold text-white transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,159,255,0.45)] hover:-translate-y-0.5"
              >
                Empezar gratis
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="#como-funciona"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.02] px-7 py-3.5 font-semibold text-zinc-100 transition-colors duration-300 hover:border-[#009fff]/50 hover:bg-[#009fff]/5"
              >
                <Play className="w-4 h-4" />
                Ver cómo funciona
              </a>
            </motion.div>

            <motion.p
              className="font-mono text-xs text-zinc-500"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.85, duration: 0.6 }}
            >
              500 créditos gratis al registrarte. Sin tarjeta de crédito.
            </motion.p>
          </div>

          {/* Columna mock */}
          <motion.div
            className="relative"
            initial={{ opacity: 0, x: 40, filter: "blur(8px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.35 }}
          >
            <div className="absolute -inset-6 rounded-[28px] bg-gradient-to-tr from-[#009fff]/20 to-transparent blur-3xl" />
            <div className="relative rounded-2xl border border-white/10 bg-zinc-900/50 p-7 shadow-2xl backdrop-blur-sm">
              <PipelineMock />
            </div>
          </motion.div>
        </div>
      </div>
    </header>
  );
}
