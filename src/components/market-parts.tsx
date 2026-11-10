"use client";

import { animate } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { Market, Outcome } from "@/types/domain";

export const pct0 = (n: number) => `${Math.round(n * 100)}%`;
export const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

export function rankedOutcomes(market: Market): Outcome[] {
  return [...market.outcomes].sort(
    (a, b) => b.price - a.price || a.label.localeCompare(b.label),
  );
}

/**
 * A number that tweens to every new value. The DOM text is owned by the
 * animation after first paint.
 */
export function LiveNum({
  value,
  format,
  className = "",
  flash = true,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  flash?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const fmt = useRef(format);
  const [initial] = useState(() => format(value));
  useEffect(() => {
    fmt.current = format;
  });
  useEffect(() => {
    const node = ref.current;
    const from = prev.current;
    if (!node || from === value) return;
    prev.current = value;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (flash && !reduce) {
      node.classList.remove("tick-up", "tick-down");
      void node.offsetWidth;
      node.classList.add(value > from ? "tick-up" : "tick-down");
    }
    const controls = animate(from, value, {
      duration: reduce ? 0 : 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = fmt.current(v);
      },
      onComplete: () => {
        node.textContent = fmt.current(value);
      },
    });
    return () => controls.stop();
  }, [value, flash]);
  return (
    <span
      ref={ref}
      className={`num inline-block ${className}`}
      suppressHydrationWarning
    >
      {initial}
    </span>
  );
}
