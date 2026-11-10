"use client";

import { motion } from "motion/react";
import { useState } from "react";

import type { CalibrationBucket, CredibilityBreakdown } from "@/types/domain";

const EASE = [0.16, 1, 0.3, 1] as const;

/** 90% interval as a range bar with a marker for the score. */
export function IntervalBar({
  score,
  className = "",
}: {
  score: CredibilityBreakdown;
  className?: string;
}) {
  const { lowerBound, upperBound } = score.credibleInterval;
  return (
    <div
      className={`bg-ink/10 relative h-2 rounded-full ${className}`}
      role="img"
      aria-label={`${score.credibleInterval.level}% interval ${lowerBound} to ${upperBound} percent`}
    >
      <motion.span
        className="bg-teal/35 absolute inset-y-0 rounded-full"
        style={{
          left: `${lowerBound}%`,
          width: `${upperBound - lowerBound}%`,
          originX: 0,
        }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.9, ease: EASE }}
      />
      <motion.span
        className="bg-teal absolute -top-1 h-4 w-1 rounded-full"
        initial={{ left: "50%", opacity: 0 }}
        animate={{ left: `${score.credibilityScore}%`, opacity: 1 }}
        transition={{
          type: "spring",
          stiffness: 160,
          damping: 18,
          delay: 0.25,
        }}
      />
    </div>
  );
}

const PLOT = { left: 56, right: 384, top: 34, bottom: 208 };
const PW = PLOT.right - PLOT.left;
const PH = PLOT.bottom - PLOT.top;

/**
 * Did confident calls come true? Observed accuracy against stated confidence.
 * Dashed ink line is the perfect match. Teal is what happened.
 */
export function CalibrationCurve({
  buckets,
}: {
  buckets: CalibrationBucket[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const px = (v: number) => PLOT.left + (v / 100) * PW;
  const py = (v: number) => PLOT.bottom - (v / 100) * PH;
  const points = buckets
    .filter((b) => b.averageConfidence !== null && b.actualAccuracy !== null)
    .map((b) => ({
      bucket: b,
      x: px(b.averageConfidence as number),
      y: py(b.actualAccuracy as number),
    }))
    .sort((a, b) => a.x - b.x);
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const shown = points.find((p) => p.bucket.id === active)?.bucket;
  const ticks = [0, 50, 100];

  return (
    <figure>
      <svg
        viewBox="0 0 400 252"
        className="text-ink h-auto w-full"
        role="img"
        aria-label="Stated confidence against how often those calls were right, with a dashed line for a perfect match"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PLOT.left}
              x2={PLOT.right}
              y1={py(tick)}
              y2={py(tick)}
              stroke="currentColor"
              strokeOpacity="0.12"
            />
            <line
              y1={PLOT.top}
              y2={PLOT.bottom}
              x1={px(tick)}
              x2={px(tick)}
              stroke="currentColor"
              strokeOpacity="0.08"
            />
            <text
              x={PLOT.left - 8}
              y={py(tick) + 4}
              textAnchor="end"
              fontSize="12"
              fill="currentColor"
              fillOpacity="0.7"
            >
              {tick}%
            </text>
            <text
              x={px(tick)}
              y={PLOT.bottom + 18}
              textAnchor={
                tick === 0 ? "start" : tick === 100 ? "end" : "middle"
              }
              fontSize="12"
              fill="currentColor"
              fillOpacity="0.7"
            >
              {tick}%
            </text>
          </g>
        ))}
        <motion.line
          x1={px(0)}
          y1={py(0)}
          x2={px(100)}
          y2={py(100)}
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeDasharray="5 5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: EASE }}
        />
        <text
          x={(PLOT.left + PLOT.right) / 2}
          y="246"
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill="currentColor"
          fillOpacity="0.8"
        >
          How sure they were
        </text>
        <text
          x={PLOT.left}
          y="16"
          fontSize="12"
          fontWeight="600"
          fill="currentColor"
          fillOpacity="0.8"
        >
          How often they were right
        </text>
        {points.length > 1 && (
          <motion.path
            d={path}
            fill="none"
            stroke="var(--teal)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.3, ease: EASE, delay: 0.2 }}
          />
        )}
        {points.map((p, i) => {
          const r = 5 + Math.min(5, Math.sqrt(p.bucket.totalCount) * 0.9);
          return (
            <motion.circle
              key={p.bucket.id}
              cx={p.x}
              cy={p.y}
              fill="var(--teal)"
              stroke="var(--ground)"
              strokeWidth="2"
              tabIndex={0}
              role="img"
              aria-label={`${p.bucket.label}: ${p.bucket.correctCount} of ${p.bucket.totalCount} right`}
              initial={{ r: 0 }}
              animate={{ r }}
              whileHover={{ r: r + 3 }}
              whileFocus={{ r: r + 3 }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 16,
                delay: 0.5 + i * 0.12,
              }}
              onPointerEnter={() => setActive(p.bucket.id)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(p.bucket.id)}
              onBlur={() => setActive(null)}
              className="focus-visible:stroke-ink cursor-pointer outline-none"
            />
          );
        })}
      </svg>
      <figcaption
        className="text-ink/70 mt-2 min-h-10 text-xs"
        aria-live="polite"
      >
        {shown ? (
          <span className="num">
            {shown.label}: {shown.correctCount} of {shown.totalCount} right,
            sure {shown.averageConfidence?.toFixed(0)}%, right{" "}
            {shown.actualAccuracy?.toFixed(0)}% of the time
          </span>
        ) : points.length ? (
          "Dots on the dashed line mean confidence matched results. Hover a dot for detail."
        ) : (
          "Not enough calls yet to draw a line."
        )}
      </figcaption>
    </figure>
  );
}

/** Track record over time, one point per resolved call. Values are 0 to 100. */
export function Sparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  if (values.length < 2) {
    return (
      <p className="text-ink/70 text-xs">
        Not enough resolved calls for a trend yet.
      </p>
    );
  }
  const px = (i: number) => 8 + (i / (values.length - 1)) * 184;
  const lo = Math.max(0, Math.min(...values) - 4);
  const hi = Math.min(100, Math.max(...values) + 4);
  const span = Math.max(1, hi - lo);
  const py = (v: number) => 50 - ((v - lo) / span) * 42;
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1];
  const first = values[0];
  const up = last >= first;
  return (
    <div>
      <svg
        viewBox="0 0 200 58"
        className="text-ink h-auto w-full"
        role="img"
        aria-label={label}
      >
        <line
          x1="8"
          x2="192"
          y1="54"
          y2="54"
          stroke="currentColor"
          strokeOpacity="0.15"
        />
        <motion.path
          d={d}
          fill="none"
          stroke="var(--teal)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: EASE }}
        />
        <motion.circle
          cx={px(values.length - 1)}
          cy={py(last)}
          fill="var(--teal)"
          initial={{ r: 0 }}
          animate={{ r: 4 }}
          transition={{ type: "spring", stiffness: 400, damping: 14, delay: 1 }}
        />
      </svg>
      <p className="num text-ink/70 mt-1 text-xs">
        {first.toFixed(0)} {up ? "↑" : "↓"} {last.toFixed(0)} over{" "}
        {values.length} resolved calls
      </p>
    </div>
  );
}
