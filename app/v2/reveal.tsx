"use client";

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

/* Util mínima para concatenar clases condicionales. */
export function cn(...inputs: Array<string | false | null | undefined>) {
  return inputs.filter(Boolean).join(" ");
}

const EASE = [0.21, 0.47, 0.32, 0.98] as const;

/* Reveal al entrar en viewport: sube + funde + desenfoca. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 26,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* Contenedor con stagger para grids; usar con <motion.*> hijos que usen `staggerItem`. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: EASE },
  },
};
