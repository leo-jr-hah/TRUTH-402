"use client";

import { ArrowDownRight, ArrowUpRight, Users } from "lucide-react";
import Link from "next/link";

import { CrowdBar } from "@/components/outcome-bars";
import { MarketStatusPill } from "@/components/status-pill";
import { marketCategory } from "@/lib/market-category";
import { removeEmDashes } from "@/lib/sanitize";
import type { Market, MemoryCalibratedProbability } from "@/types/domain";

const cents = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Polymarket-style card: question, leading outcome in cents, one thin
 * crowd bar with a teal tick for the track record, then status and traders.
 * `inert` renders the same card without a link (used by the live preview).
 */
export function MarketCard({
  market,
  preview,
  inert = false,
}: {
  market: Market;
  preview?: MemoryCalibratedProbability[];
  inert?: boolean;
}) {
  const traders = new Set(market.trades.map((t) => t.participantId)).size;
  const sorted = [...market.outcomes].sort((a, b) => b.price - a.price);
  const lead =
    sorted.find((o) => o.id === market.winningOutcomeId) ?? sorted[0];
  const signal = lead
    ? preview?.find((row) => row.outcomeId === lead.id)
    : undefined;
  const crowd = signal?.marketProbability ?? lead?.price ?? 0;
  const track = signal?.oracleProbability;
  const shift = signal ? signal.edgeDivergence * 100 : undefined;
  const title = removeEmDashes(market.title);
  const category = marketCategory(market);
  const volume =
    "volume" in market &&
    typeof market.volume === "number" &&
    Number.isFinite(market.volume)
      ? market.volume
      : undefined;
  const closesAt =
    "closesAt" in market &&
    typeof market.closesAt === "string" &&
    Number.isFinite(Date.parse(market.closesAt))
      ? market.closesAt
      : undefined;

  return (
    <article
      data-category={category}
      className={`card group has-[a:focus-visible]:outline-teal border-line bg-panel text-ink relative flex h-full min-h-[130px] min-w-0 flex-col gap-1 rounded-xl border p-3 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 ${inert ? "" : "card-interactive"}`}
    >
      <h2 className="line-clamp-2 text-sm leading-4 font-semibold">
        {inert ? (
          title
        ) : (
          <Link
            href={`/markets/${market.id}`}
            className="rounded-md outline-none after:absolute after:inset-0 after:z-0 after:rounded-xl after:content-['']"
          >
            {title}
          </Link>
        )}
      </h2>

      {lead && (
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex w-14 shrink-0 flex-col">
            <span className="text-ink/65 truncate text-[10px] leading-4 font-medium">
              {market.status === "resolved" ? "Winner: " : ""}
              {removeEmDashes(lead.label)}
            </span>
            <span className="num text-teal text-xl leading-6 font-semibold tracking-tight">
              {cents(crowd)}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-1 text-[10px] leading-4">
              <span className="text-ink/65 shrink-0">chance</span>
              {track !== undefined ? (
                <>
                  <span className="num text-teal min-w-0 truncate font-semibold">
                    Track record {Math.round(track * 100)}%
                  </span>
                  {shift !== undefined && Math.round(shift) !== 0 && (
                    <span className="num text-ink/65 inline-flex shrink-0 items-center gap-0.5">
                      {shift > 0 ? (
                        <ArrowUpRight size={12} aria-hidden />
                      ) : (
                        <ArrowDownRight size={12} aria-hidden />
                      )}
                      {shift > 0 ? "+" : ""}
                      {shift.toFixed(0)} pp
                    </span>
                  )}
                  <span className="sr-only">
                    Memory-Calibrated Forecast versus Raw Market Price. Alpha
                    Shift {shift?.toFixed(1)} percentage points.
                  </span>
                </>
              ) : null}
            </div>
            <CrowdBar
              crowd={crowd}
              track={track}
              label={`${removeEmDashes(lead.label)} crowd price`}
              className="mt-1"
            />
          </div>
        </div>
      )}

      <div className="text-ink/70 border-line mt-auto flex min-w-0 flex-nowrap items-center gap-1.5 border-t pt-1 text-[10px] leading-4 whitespace-nowrap">
        <span className="num min-w-0 truncate">
          {volume !== undefined
            ? `${new Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(volume)} vol`
            : `${market.trades.length} ${market.trades.length === 1 ? "trade" : "trades"}`}
        </span>
        <span className="inline-flex shrink-0 [&>*]:rounded-full [&>*]:border-0 [&>*]:px-2 [&>*]:py-0.5 [&>*]:text-[11px] [&>*]:leading-4">
          <MarketStatusPill status={market.status} />
        </span>
        <span className="num inline-flex shrink-0 items-center gap-1">
          <Users size={14} aria-hidden />
          {traders} {traders === 1 ? "trader" : "traders"}
        </span>
        {closesAt !== undefined && (
          <time dateTime={closesAt} className="ml-auto min-w-0 truncate">
            Closes{" "}
            {new Date(closesAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
          </time>
        )}
      </div>
    </article>
  );
}
