"use client";

import { ArrowDownRight, ArrowUpRight, Zap } from "lucide-react";
import { AnimatePresence, animate, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { LiveNum, pct1 } from "@/components/market-parts";
import { Disclosure } from "@/components/ui/disclosure";
import {
  formatCredits,
  formatDateTime,
  formatProbability,
  initials,
} from "@/lib/format";
import { lmsrPrices } from "@/lib/market-maker";
import { removeEmDashes } from "@/lib/sanitize";
import type { Market, Trade } from "@/types/domain";

/** Replays recorded trades through the LMSR to rebuild price history. */
function replayHistory(market: Market): number[][] {
  const sums = new Map<string, number>();
  for (const trade of market.trades) {
    sums.set(trade.outcomeId, (sums.get(trade.outcomeId) ?? 0) + trade.shares);
  }
  const q = market.outcomes.map((o) => o.shares - (sums.get(o.id) ?? 0));
  try {
    const points = [lmsrPrices(q, market.liquidity)];
    for (const trade of market.trades) {
      const index = market.outcomes.findIndex((o) => o.id === trade.outcomeId);
      if (index === -1) continue;
      q[index] += trade.shares;
      points.push(lmsrPrices(q, market.liquidity));
    }
    return points;
  } catch {
    return [market.outcomes.map((o) => o.price)];
  }
}

const DASH = [undefined, "6 5", "2 5", "10 4 2 4"];
const OPACITY = [1, 0.6, 0.45, 0.35];

/** Price history rebuilt from recorded trades, one step per trade. */
export function HistoryChart({ market }: { market: Market }) {
  const series = useMemo(() => replayHistory(market), [market]);
  const box = useRef<HTMLDivElement>(null);
  const clip = useRef<SVGRectElement>(null);
  const prevCount = useRef<number | null>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const clipId = `clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const height = width < 420 ? 170 : 230;
  const pad = 14;
  const shown = [...market.outcomes]
    .sort((a, b) => b.price - a.price)
    .slice(0, 4);
  const indexOf = (id: string) => market.outcomes.findIndex((o) => o.id === id);
  const pts = series.length === 1 ? [series[0], series[0]] : series;
  const count = series.length;

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => {
      const w = node.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const before = prevCount.current;
    prevCount.current = count;
    const rect = clip.current;
    const node = box.current;
    if (!before || before >= count || !rect || !node) return;
    const full = node.clientWidth || 640;
    const controls = animate(
      ((before - 1) / Math.max(1, count - 1)) * full,
      full,
      {
        duration: 0.9,
        ease: [0.16, 1, 0.3, 1],
        onUpdate: (v) => rect.setAttribute("width", String(v)),
      },
    );
    return () => controls.stop();
  }, [count]);

  const x = (i: number) => (i / (pts.length - 1)) * width;
  const y = (p: number) => pad + (1 - p) * (height - pad * 2);
  const line = (o: number) =>
    pts
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p[o]).toFixed(1)}`,
      )
      .join(" ");
  const area = `${line(indexOf(shown[0].id))} L${width} ${height - pad} L0 ${height - pad} Z`;
  const active = hover ?? count - 1;
  const activeX = series.length === 1 ? width : x(active);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {shown.map((o, rank) => {
            const i = indexOf(o.id);
            return (
              <li key={o.id} className="flex items-center gap-2">
                <svg width="22" height="6" aria-hidden className="shrink-0">
                  <line
                    x1="1"
                    x2="21"
                    y1="3"
                    y2="3"
                    stroke="var(--ink)"
                    strokeOpacity={OPACITY[rank]}
                    strokeWidth="2.5"
                    strokeDasharray={DASH[rank]}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-ink/80 font-medium">
                  {removeEmDashes(o.label)}
                </span>
                <LiveNum
                  value={series[active]?.[i] ?? o.price}
                  format={pct1}
                  flash={false}
                  className="text-xs font-semibold"
                />
              </li>
            );
          })}
        </ul>
        <p className="num text-ink/65 text-xs">
          {count === 1
            ? "Start of market"
            : active === 0
              ? "Opening price"
              : `After trade ${active} of ${count - 1}`}
        </p>
      </div>
      <div
        ref={box}
        className="relative touch-pan-y select-none"
        style={{ height }}
        onPointerMove={(e) => {
          if (count < 2) return;
          const r = e.currentTarget.getBoundingClientRect();
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          setHover(Math.round(f * (count - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 overflow-visible"
          role="img"
          aria-label={`Price history across ${Math.max(0, count - 1)} recorded trades`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                ref={clip}
                x="0"
                y="-10"
                width={width}
                height={height + 20}
              />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1="0"
              x2={width}
              y1={y(g)}
              y2={y(g)}
              stroke="var(--ink)"
              strokeOpacity={g === 0.5 ? 0.2 : 0.1}
              strokeDasharray="3 6"
            />
          ))}
          <g clipPath={`url(#${clipId})`}>
            <motion.path
              d={area}
              fill="var(--ice)"
              fillOpacity={0.45}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.4 }}
            />
            {shown.map((o, rank) => (
              <motion.path
                key={o.id}
                d={line(indexOf(o.id))}
                fill="none"
                stroke="var(--ink)"
                strokeOpacity={OPACITY[rank]}
                strokeWidth={2.5}
                strokeDasharray={DASH[rank]}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{
                  duration: 1.2,
                  delay: rank * 0.12,
                  ease: [0.16, 1, 0.3, 1],
                }}
              />
            ))}
          </g>
          {hover !== null && count > 1 && (
            <line
              x1={activeX}
              x2={activeX}
              y1={0}
              y2={height}
              stroke="var(--ink)"
              strokeOpacity={0.35}
            />
          )}
        </svg>
        {shown.map((o) => {
          const p = series[active]?.[indexOf(o.id)] ?? o.price;
          return (
            <motion.span
              key={o.id}
              aria-hidden
              className="border-ground bg-ink absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
              animate={{ left: activeX, top: y(p) }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
            />
          );
        })}
        {[100, 50, 0].map((g) => (
          <span
            key={g}
            className="num text-ink/60 pointer-events-none absolute left-0 -translate-y-full text-[10px]"
            style={{ top: y(g / 100) - 2 }}
          >
            {g}%
          </span>
        ))}
        {count === 1 && (
          <p className="text-ink/70 pointer-events-none absolute top-[40%] left-1/2 w-max max-w-[80%] -translate-x-1/2 text-center text-sm">
            No trades yet. The line moves with the first one.
          </p>
        )}
      </div>
      <p className="text-ink/65 mt-3 text-xs">
        Built from {market.trades.length} recorded{" "}
        {market.trades.length === 1 ? "trade" : "trades"}. Hover to scrub.
      </p>
    </div>
  );
}

function ActivityItem({ trade, market }: { trade: Trade; market: Market }) {
  const outcome = market.outcomes.find((o) => o.id === trade.outcomeId);
  const up = trade.priceAfter >= trade.priceBefore;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="border-line flex items-center gap-3 border-b py-3 last:border-b-0"
    >
      <span className="border-line-strong bg-panel-2 grid size-10 shrink-0 place-items-center rounded-full border text-xs font-bold">
        {initials(removeEmDashes(trade.displayName))}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {removeEmDashes(trade.displayName)}
          <span className="text-ink/70 font-normal">
            {" "}
            bought{" "}
            <span className="text-ink font-semibold">
              {removeEmDashes(outcome?.label ?? "an outcome")}
            </span>
          </span>
        </p>
        <p className="num text-ink/65 truncate text-xs">
          {formatDateTime(trade.createdAt)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="num text-sm font-semibold">
          {formatCredits(trade.amount)} cr
        </p>
        <p className="num text-ink/70 flex items-center justify-end gap-1 text-xs">
          {up ? (
            <ArrowUpRight size={12} aria-label="up" />
          ) : (
            <ArrowDownRight size={12} aria-label="down" />
          )}
          {formatProbability(trade.priceBefore, 0)} to{" "}
          {formatProbability(trade.priceAfter, 0)}
        </p>
      </div>
    </motion.li>
  );
}

export function TradeFeed({ market }: { market: Market }) {
  const feed = useMemo(() => [...market.trades].reverse(), [market.trades]);
  if (!feed.length) {
    return (
      <div className="border-line-strong rounded-2xl border border-dashed p-8 text-center">
        <motion.span
          animate={{ y: [0, -5, 0] }}
          transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
          className="bg-ice/60 text-ink mx-auto grid size-12 place-items-center rounded-full"
        >
          <Zap size={22} />
        </motion.span>
        <p className="mt-3 text-lg font-bold">No trades yet</p>
        <p className="text-ink/70 mt-1 text-sm">
          The first trade shows up here and moves the chart.
        </p>
      </div>
    );
  }
  return (
    <>
      <ul aria-label="Recent trades">
        <AnimatePresence initial={false}>
          {feed.slice(0, 6).map((trade) => (
            <ActivityItem key={trade.id} trade={trade} market={market} />
          ))}
        </AnimatePresence>
      </ul>
      {feed.length > 6 && (
        <Disclosure
          className="mt-4"
          summary={`Earlier trades (${feed.length - 6})`}
        >
          <ul>
            {feed.slice(6).map((trade) => (
              <ActivityItem key={trade.id} trade={trade} market={market} />
            ))}
          </ul>
        </Disclosure>
      )}
    </>
  );
}
