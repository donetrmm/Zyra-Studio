"use client";

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Interpola suavemente el número mostrado desde el valor previo hasta `target`
// con easing out-cubic. Si el usuario prefiere reducir movimiento, salta directo
// al target sin animar.
export function useAnimatedNumber(target: number, duration = 700): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);

  useEffect(() => {
    if (displayRef.current === target) return;
    if (prefersReducedMotion()) {
      displayRef.current = target;
      return;
    }

    const start = displayRef.current;
    const startedAt = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(start + (target - start) * eased);
      displayRef.current = value;
      setDisplay(value);
      if (t < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  // Reduced motion: saltar directo al target sin animar (sin setState en effect).
  if (prefersReducedMotion()) return target;
  return display;
}

// Devuelve "up" | "down" durante un breve período tras cambiar `value`,
// para tintear el número y comunicar dirección del cambio.
export function useFlashOnChange(
  value: number,
  duration = 900,
): "up" | "down" | null {
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    if (prefersReducedMotion()) {
      prev.current = value;
      return;
    }
    setDirection(value > prev.current ? "up" : "down");
    prev.current = value;
    const id = setTimeout(() => setDirection(null), duration);
    return () => clearTimeout(id);
  }, [value, duration]);

  return direction;
}
