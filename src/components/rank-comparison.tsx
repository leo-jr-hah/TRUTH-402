"use client";

import { useSyncExternalStore } from "react";

import { RankFlip, type RankFlipRow } from "@/components/landing/rank-flip";

const subscribe = () => () => {};

/**
 * Node and browsers ship different ICU compact-currency rules ($142.0K vs
 * $142K). Keep an accessible, locale-independent server fallback, then mount
 * the existing interactive chart after hydration. No suppressed mismatches.
 */
export function RankComparison({ rows }: { rows: RankFlipRow[] }) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (ready) return <RankFlip rows={rows} />;
  return (
    <section
      aria-label="Trader rank comparison"
      className="border-line bg-panel text-ink rounded-2xl border p-3 sm:p-4"
    >
      <h2 className="text-base font-semibold">
        Big profit is not track record
      </h2>
      <p className="text-ink/60 mt-1 text-xs">
        Profit rank and track-record rank
      </p>
      <ul className="mt-3 space-y-1">
        {[...rows]
          .sort((a, b) => a.profitRank - b.profitRank)
          .slice(0, 6)
          .map((row) => (
            <li
              key={row.id}
              className="border-line flex min-h-10 items-center justify-between gap-3 rounded-lg border px-2 text-xs"
            >
              <span>{row.name}</span>
              <span>
                Profit #{row.profitRank} · Track record #{row.trustRank}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}
