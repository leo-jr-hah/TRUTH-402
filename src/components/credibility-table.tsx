"use client";

import { ArrowDown, ArrowRight, ArrowUp, ChevronRight } from "lucide-react";
import { motion } from "motion/react";

import { formatCredits, formatDate, initials } from "@/lib/format";
import { removeEmDashes } from "@/lib/sanitize";
import type { Credibility } from "@/types/domain";

export type LeaderboardSort = "profit" | "skill" | "consistency";

/** Order entries by the chosen key. Profit is cash-style luck, skill is track record, consistency is the interval floor. */
export function sortCredibility(
  entries: Credibility[],
  key: LeaderboardSort,
): Credibility[] {
  const copy = [...entries];
  if (key === "profit") return copy.sort((a, b) => a.profitRank - b.profitRank);
  if (key === "skill") return copy.sort((a, b) => a.trustRank - b.trustRank);
  return copy.sort(
    (a, b) =>
      b.credibleInterval.lowerBound - a.credibleInterval.lowerBound ||
      a.trustRank - b.trustRank,
  );
}

function signed(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "-" : ""}${formatCredits(Math.abs(rounded))}`;
}

/** Profit rank and track-record rank as two labelled chips with a direction arrow. */
export function RankChips({ entry }: { entry: Credibility }) {
  const better = entry.rankDelta > 0;
  const worse = entry.rankDelta < 0;
  const Direction = better ? ArrowUp : worse ? ArrowDown : null;
  return (
    <span
      className="flex flex-wrap items-center gap-1.5 text-xs font-semibold"
      role="group"
      aria-label={`Profit rank ${entry.profitRank}, track record rank ${entry.trustRank}`}
    >
      <span className="num border-line-strong text-ink inline-flex min-h-7 items-center rounded-full border px-2.5 whitespace-nowrap">
        Profit #{entry.profitRank}
      </span>
      <ArrowRight
        size={14}
        aria-hidden="true"
        className="text-ink/60 shrink-0"
      />
      <span className="num bg-teal/15 text-teal inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 whitespace-nowrap">
        Track record #{entry.trustRank}
        {Direction && <Direction size={13} aria-hidden="true" />}
      </span>
    </span>
  );
}

export function CredibilityTable({
  entries,
  limit,
  showBreakdown = false,
  onSelect,
  selectedId = null,
}: {
  entries: Credibility[];
  limit?: number;
  showBreakdown?: boolean;
  /** Kept for existing callers: the bar always shows track record. */
  weighted?: boolean;
  activeSort?: LeaderboardSort;
  records?: unknown;
  halfLifeDays?: number;
  /** When set, each row is a button that reports the trader id. */
  onSelect?: (participantId: string, trigger: HTMLElement) => void;
  selectedId?: string | null;
}) {
  const visible = limit ? entries.slice(0, limit) : entries;

  if (!visible.length) {
    return (
      <div className="border-line-strong grid place-items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
        <p className="text-ink/70 max-w-sm text-sm">
          No traders yet. Resolve a market to start a track record.
        </p>
      </div>
    );
  }

  const grid = "sm:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,1.3fr)_7rem]";

  return (
    <div>
      <div
        className={`text-ink/70 mb-2 hidden gap-x-4 px-4 text-xs font-semibold sm:grid ${grid} ${onSelect ? "pr-11" : ""}`}
        aria-hidden="true"
      >
        <span />
        <span>Trader</span>
        <span>Track record</span>
        <span className="text-right">Profit</span>
      </div>
      <span className="sr-only">Skill vs. profit rank</span>
      <ol className="space-y-2">
        {visible.map((entry, index) => {
          const name = removeEmDashes(entry.displayName);
          const selected = selectedId === entry.participantId;
          const body = (
            <>
              <span
                className={`font-display num text-xl font-bold sm:text-2xl ${index === 0 ? "text-teal" : "text-ink/60"}`}
              >
                {index + 1}
              </span>
              <span className="flex min-w-0 items-center gap-3">
                <span className="font-display border-line-strong bg-panel grid size-10 shrink-0 place-items-center rounded-full border text-xs font-bold">
                  {initials(name)}
                </span>
                <span className="min-w-0">
                  <span className="font-display block truncate text-base font-semibold">
                    {name}
                  </span>
                  <span className="num text-ink/75 block text-sm font-normal">
                    Right {entry.correctCount} of {entry.totalCount} calls
                  </span>
                </span>
              </span>
              <span className="col-span-2 flex items-center gap-3 sm:col-span-1">
                <span
                  className="bg-ink/10 relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full"
                  role="img"
                  aria-label={`Track record ${entry.credibilityScore.toFixed(0)} out of 100`}
                >
                  <motion.span
                    className="bg-teal absolute inset-y-0 left-0 rounded-full"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.max(2, Math.min(100, entry.credibilityScore))}%`,
                    }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  />
                </span>
                <span className="num text-teal w-8 shrink-0 text-right text-sm font-semibold">
                  {entry.credibilityScore.toFixed(0)}
                </span>
              </span>
              {showBreakdown && (
                <span className="num text-ink hidden text-right text-sm font-semibold sm:block">
                  {signed(entry.rawPnl)}
                </span>
              )}
              {showBreakdown && (
                <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 sm:col-span-4 sm:col-start-2">
                  <RankChips entry={entry} />
                  <span className="num text-ink/70 text-xs sm:hidden">
                    Profit {signed(entry.rawPnl)}
                  </span>
                  <span className="text-ink/70 text-xs">
                    Last call {formatDate(entry.lastActiveAt)}
                  </span>
                  {entry.inferredEntryCount > 0 && (
                    <span className="text-ink/70 text-xs" aria-hidden="true">
                      {entry.inferredEntryCount} older calls estimated
                    </span>
                  )}
                </span>
              )}
              <span className="sr-only">
                {entry.credibleInterval.level}% interval{" "}
                {entry.credibleInterval.lowerBound.toFixed(1)} to{" "}
                {entry.credibleInterval.upperBound.toFixed(1)}%.
                {entry.inferredEntryCount > 0
                  ? ` ${entry.inferredEntryCount} estimated legacy entries.`
                  : ""}
              </span>
            </>
          );
          const rowGrid = `grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 ${grid}`;
          return (
            <motion.li
              key={entry.participantId}
              layout="position"
              transition={{
                layout: { type: "spring", stiffness: 380, damping: 36 },
              }}
              data-trader={entry.participantId}
            >
              {onSelect ? (
                <button
                  type="button"
                  onClick={(event) =>
                    onSelect(entry.participantId, event.currentTarget)
                  }
                  aria-haspopup="dialog"
                  aria-pressed={selected}
                  className={`group focus-visible:outline-teal relative w-full rounded-xl border px-4 py-3.5 pr-11 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    selected
                      ? "border-teal bg-ice/40"
                      : "border-line bg-panel hover:border-line-strong"
                  }`}
                >
                  <span className={rowGrid}>{body}</span>
                  <ChevronRight
                    size={18}
                    aria-hidden="true"
                    className="text-ink/50 absolute top-1/2 right-3 -translate-y-1/2 transition-transform duration-300 group-hover:translate-x-0.5"
                  />
                </button>
              ) : (
                <div className="border-line bg-panel rounded-xl border px-4 py-3.5">
                  <span className={rowGrid}>{body}</span>
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
