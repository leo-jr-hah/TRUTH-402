"use client";

import { animate, useInView } from "motion/react";
import { useEffect, useRef } from "react";

/** Tweens to `value` when scrolled into view, and again whenever it changes. */
export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.1,
  className = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: "-10% 0px" });
  const from = useRef(0);
  useEffect(() => {
    if (!seen || !ref.current) return;
    const node = ref.current;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const controls = animate(reduce ? value : from.current, value, {
      duration: reduce ? 0 : duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = `${prefix}${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
      },
    });
    from.current = value;
    return () => controls.stop();
  }, [seen, value, decimals, prefix, suffix, duration]);
  return (
    <span ref={ref} className={`num ${className}`}>
      {prefix}
      {value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}
