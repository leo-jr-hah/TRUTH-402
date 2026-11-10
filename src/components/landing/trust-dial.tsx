"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";

const CX = 200;
const CY = 190;
const R = 150;
const pt = (v: number, r = R) => {
  const a = Math.PI * (1 - v / 100);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
};
const arc = (from: number, to: number, r = R) => {
  const [x1, y1] = pt(from, r);
  const [x2, y2] = pt(to, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
};

/**
 * Drag the needle, or the slider, to decide how much track record counts.
 * 0 = pure crowd. 100 = fully track-record weighted.
 */
export function TrustDial({
  crowd,
  record,
  title,
}: {
  crowd: number;
  record: number;
  title: string;
}) {
  const [weight, setWeight] = useState(55);
  const w = useMotionValue(55);
  const svg = useRef<SVGSVGElement>(null);
  const you = useTransform(w, (x) => crowd + ((record - crowd) * x) / 100);
  const nx = useTransform(you, (v) => pt(v, R - 8)[0]);
  const ny = useTransform(you, (v) => pt(v, R - 8)[1]);
  const [shown, setShown] = useState(crowd + ((record - crowd) * 55) / 100);
  useEffect(() => you.on("change", (v) => setShown(v)), [you]);

  const set = (x: number) => {
    const c = Math.max(0, Math.min(100, x));
    setWeight(Math.round(c));
    animate(w, c, { type: "spring", stiffness: 160, damping: 18 });
  };

  const [tx, ty] = pt(crowd, R + 22);
  const [rx, ry] = pt(record, R + 22);
  const lo = Math.min(crowd, record);
  const hi = Math.max(crowd, record);

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <svg
          ref={svg}
          viewBox="0 0 400 230"
          className="w-full"
          role="img"
          aria-label={`Gauge for ${title}. Crowd ${crowd} percent, track-record view ${record} percent, your blend ${shown.toFixed(1)} percent.`}
        >
          <path
            d={arc(0, 100)}
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <motion.path
            d={arc(lo, hi)}
            fill="none"
            stroke="var(--teal)"
            strokeWidth="14"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
          {[0, 25, 50, 75, 100].map((v) => {
            const [x1, y1] = pt(v, R + 14);
            const [x2, y2] = pt(v, R + 24);
            return (
              <line
                key={v}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--line-strong)"
                strokeWidth="2"
              />
            );
          })}
          <g>
            <circle cx={tx} cy={ty} r="5" fill="var(--ink)" />
            <circle cx={rx} cy={ry} r="5" fill="var(--teal)" />
          </g>
          <motion.line
            x1={CX}
            y1={CY}
            x2={nx}
            y2={ny}
            stroke="var(--ink)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <motion.circle cx={nx} cy={ny} r="9" fill="var(--ink)" />
          <circle cx={CX} cy={CY} r="14" fill="var(--ink)" />
          <circle cx={CX} cy={CY} r="5" fill="var(--ground)" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold opacity-70">{title}</p>
        <div className="num font-display mt-1 text-[clamp(4rem,9vw,7rem)] leading-none font-bold tracking-tighter">
          {shown.toFixed(0)}
          <span className="text-[0.45em] opacity-60">%</span>
        </div>
        <label className="mt-8 block">
          <span className="flex items-center justify-between text-sm font-semibold">
            How much should track record count?
            <span className="num text-teal">{weight}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={weight}
            onChange={(e) => set(Number(e.target.value))}
            className="bg-line-strong accent-teal [&::-webkit-slider-thumb]:border-ground [&::-webkit-slider-thumb]:bg-teal mt-3 h-2 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:shadow-md"
          />
        </label>
        <div className="mt-6 flex gap-6 text-sm">
          <span className="flex items-center gap-2">
            <span className="bg-ink size-2.5 rounded-full" /> Crowd{" "}
            <b className="num">{crowd}%</b>
          </span>
          <span className="flex items-center gap-2">
            <span className="bg-teal size-2.5 rounded-full" /> Track record{" "}
            <b className="num">{record}%</b>
          </span>
        </div>
      </div>
    </div>
  );
}
