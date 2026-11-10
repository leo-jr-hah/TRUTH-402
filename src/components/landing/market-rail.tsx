"use client";

import { ArrowUpRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

export interface RailMarket {
  id: string;
  title: string;
  lead: string;
  crowd: number;
  record?: number;
  traders: number;
  category?: string;
}

const RAIL_CATEGORIES = [
  { value: "all", label: "All" },
  { value: "sports", label: "Sports" },
  { value: "crypto", label: "Crypto" },
  { value: "macro", label: "Macro" },
] as const;

/** Familiar market cards: what you see on any prediction market, plus the track-record tick. */
export function MarketRail({ markets }: { markets: RailMarket[] }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const filteredMarkets =
    activeCategory === "all"
      ? markets
      : markets.filter((m) => m.category === activeCategory);

  return (
    <div className="text-ink">
      <div
        role="group"
        aria-label="Filter markets by category"
        className="mb-3 flex flex-wrap items-center gap-1"
      >
        {RAIL_CATEGORIES.map((category) => (
          <button
            key={category.value}
            type="button"
            aria-pressed={activeCategory === category.value}
            onClick={() => setActiveCategory(category.value)}
            className={`focus-visible:outline-teal relative isolate rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              activeCategory === category.value
                ? "text-fog"
                : "text-ink/70 hover:text-ink"
            }`}
          >
            {activeCategory === category.value && (
              <motion.span
                layoutId="rail-pill"
                aria-hidden="true"
                className="bg-navy pointer-events-none absolute inset-0 -z-10 rounded-full"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            {category.label}
          </button>
        ))}
      </div>

      <motion.div
        layoutScroll
        className="relative -mx-4 flex snap-x [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        <AnimatePresence mode="popLayout">
          {filteredMarkets.map((m, i) => {
            const recordDelta =
              typeof m.crowd === "number" && typeof m.record === "number"
                ? m.record - m.crowd
                : undefined;

            return (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-5% 0px" }}
                exit={{
                  opacity: 0,
                  y: 12,
                  transition: { duration: 0.18, delay: 0 },
                }}
                transition={{
                  duration: 0.7,
                  delay: i * 0.06,
                  ease: [0.16, 1, 0.3, 1],
                  layout: { duration: 0.25, delay: 0 },
                }}
                className="shrink-0 snap-start"
              >
                <Link
                  href={`/markets/${m.id}`}
                  className="card card-interactive group border-line bg-panel flex h-full w-[19rem] flex-col justify-between p-4 sm:w-[21rem]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="line-clamp-3 min-h-[3.5rem] text-base leading-snug font-semibold tracking-tight">
                      {m.title}
                    </h3>
                    <ArrowUpRight
                      className="group-hover:text-teal mt-1 shrink-0 opacity-40 transition-all duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
                      size={20}
                    />
                  </div>
                  <div className="mt-4">
                    <div className="flex items-end justify-between">
                      <span className="max-w-[10rem] truncate text-sm font-medium opacity-70">
                        {m.lead}
                      </span>
                      <span className="num font-display text-3xl leading-none font-bold">
                        {m.crowd}
                        <span className="text-lg opacity-60">¢</span>
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="bg-ice relative h-2 min-w-0 flex-1 rounded-full">
                        <motion.div
                          className="bg-navy absolute inset-y-0 left-0 rounded-full"
                          initial={{ width: 0 }}
                          whileInView={{ width: `${m.crowd}%` }}
                          viewport={{ once: true }}
                          transition={{
                            duration: 1,
                            delay: 0.2,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                        />
                        {m.record !== undefined && (
                          <motion.span
                            className="bg-teal ring-panel absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
                            initial={{ left: "0%" }}
                            whileInView={{ left: `${m.record}%` }}
                            viewport={{ once: true }}
                            transition={{
                              type: "spring",
                              stiffness: 90,
                              damping: 14,
                              delay: 0.5,
                            }}
                            title={`Track-record view ${m.record}%`}
                          />
                        )}
                      </div>
                      {recordDelta !== undefined && (
                        <span
                          className={`bg-ice/50 shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap tabular-nums ${
                            recordDelta > 0 ? "text-teal" : "text-ink/60"
                          }`}
                        >
                          {recordDelta >= 0 ? "+" : ""}
                          {recordDelta} pts track record
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex justify-between text-xs opacity-70">
                      <span>
                        {m.record !== undefined
                          ? `Track record ${m.record}%`
                          : "Report locked"}
                      </span>
                      <span>{m.traders} traders</span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {filteredMarkets.length === 0 && (
          <p role="status" className="text-ink/60 py-3 text-xs">
            No markets in this category.
          </p>
        )}
      </motion.div>
    </div>
  );
}
