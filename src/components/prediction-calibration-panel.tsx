"use client";

import { ArrowUpRight, RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { formatCredits } from "@/lib/format";
import { removeEmDashes } from "@/lib/sanitize";
import type { PredictionCalibrationSnapshot } from "@/types/oracle";

type Entry = PredictionCalibrationSnapshot["entries"][number];

/** Ink dot is where profit ranks someone, teal dot where track record ranks them, the bar is the gap. */
function RankGap({ entry, size }: { entry: Entry; size: number }) {
  const at = (rank: number) =>
    size <= 1 ? 50 : ((rank - 1) / (size - 1)) * 100;
  const a = at(entry.profitRank);
  const b = at(entry.trustRank);
  return (
    <span
      className="relative block h-9"
      role="img"
      aria-label={`Profit rank ${entry.profitRank}, track record rank ${entry.trustRank}`}
    >
      <span className="bg-line-strong absolute inset-x-3 top-1/2 h-px" />
      <span className="absolute inset-x-3 top-0 bottom-0">
        <motion.span
          className="bg-ink/25 absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
          initial={{ left: `${a}%`, width: 0 }}
          animate={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(a - b)}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
        />
        <motion.span
          className="bg-ink ring-panel absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
          initial={{ left: "0%", scale: 0 }}
          animate={{ left: `${a}%`, scale: 1 }}
          transition={{ type: "spring", stiffness: 160, damping: 16 }}
        />
        <motion.span
          className="bg-teal ring-panel absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
          initial={{ left: "0%", scale: 0 }}
          animate={{ left: `${b}%`, scale: 1 }}
          transition={{
            type: "spring",
            stiffness: 120,
            damping: 15,
            delay: 0.15,
          }}
        />
      </span>
    </span>
  );
}

export function PredictionCalibrationPanel({
  initial,
  mode,
  operatorRequired = mode === "live",
}: {
  initial: PredictionCalibrationSnapshot | null;
  mode: "demo" | "live";
  operatorRequired?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  async function sync() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/oracle/calibration", {
        cache: "no-store",
        headers: operatorToken
          ? { authorization: `Bearer ${operatorToken}` }
          : {},
      });
      const payload =
        (await response.json()) as PredictionCalibrationSnapshot & {
          error?: { message?: string };
        };
      if (!response.ok)
        throw new Error(
          payload.error?.message || "Could not load the comparison.",
        );
      setSnapshot(payload);
    } catch (caught) {
      setError(
        removeEmDashes(
          caught instanceof Error
            ? caught.message
            : "Could not load the comparison.",
        ),
      );
    } finally {
      setBusy(false);
      setOperatorToken("");
    }
  }

  const entries = snapshot
    ? [...snapshot.entries].sort((a, b) => a.profitRank - b.profitRank)
    : [];
  const size = Math.max(
    1,
    ...entries.map((e) => Math.max(e.profitRank, e.trustRank)),
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-prose min-w-0">
          <h3 className="font-display text-xl font-bold tracking-tight">
            Big profit is not always a good track record
          </h3>
          <p className="text-ink/75 mt-2 text-sm">
            {snapshot?.provider === "demo"
              ? "Synthetic cross-category benchmark. Six sample traders. "
              : "Tatum Prediction. Read-only comparison. "}
            <Link
              href="/about#rank-method"
              className="group text-teal decoration-teal/30 hover:decoration-teal inline-flex items-center gap-0.5 font-semibold underline"
            >
              How ranking works
              <ArrowUpRight
                size={14}
                className="transition-transform duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </p>
        </div>
        <button
          type="button"
          className="button-secondary group"
          onClick={sync}
          disabled={busy || (operatorRequired && !operatorToken)}
        >
          <RefreshCw
            size={15}
            className={
              busy
                ? "animate-spin"
                : "transition-transform duration-500 group-hover:rotate-180"
            }
          />
          {busy
            ? "Loading..."
            : mode === "demo"
              ? "Reload sample"
              : "Sync comparison"}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="border-line-strong bg-panel rounded-xl border px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}
      {operatorRequired && (
        <label className="block max-w-sm">
          <span className="field-label">Operator token for live sync</span>
          <input
            type="password"
            className="field"
            value={operatorToken}
            onChange={(event) => setOperatorToken(event.target.value)}
            maxLength={200}
            autoComplete="off"
          />
        </label>
      )}

      {snapshot ? (
        <>
          <div className="text-ink/75 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-2">
              <span className="bg-ink size-3 rounded-full" /> Profit rank
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="bg-teal size-3 rounded-full" /> Track record rank
            </span>
          </div>
          <ul
            className={`space-y-3 transition-opacity ${busy ? "opacity-50" : ""}`}
          >
            {entries.map((entry, index) => (
              <motion.li
                key={entry.wallet}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.45,
                  delay: index * 0.06,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="border-line bg-panel grid items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,9rem)]"
              >
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold break-words">
                    {removeEmDashes(entry.displayName)}
                  </p>
                  <p className="text-ink/75 text-xs">
                    {entry.rankDelta < 0
                      ? "Profit outruns evidence"
                      : entry.rankDelta > 0
                        ? "Track record outruns profit"
                        : "Ranks match"}
                  </p>
                </div>
                <RankGap entry={entry} size={size} />
                <div className="num text-ink/75 text-xs md:text-right">
                  <p className="text-ink font-semibold">
                    Profit #{entry.profitRank}, Track record #{entry.trustRank}
                  </p>
                  <p>{entry.totalCount} calls</p>
                  <p>Profit ${formatCredits(entry.leaderboardPnlUsd)}</p>
                </div>
              </motion.li>
            ))}
          </ul>
          <p className="text-ink/70 text-xs leading-5">
            {removeEmDashes(snapshot.scope)}{" "}
            {snapshot.truncated ? "Position history may be cut short." : ""}
          </p>
          {snapshot.ingestion && (
            <p className="num text-ink/70 text-xs leading-5">
              Loaded: {snapshot.ingestion.closedPositions} closed positions,{" "}
              {snapshot.ingestion.openPositions} open positions,{" "}
              {snapshot.ingestion.tradeFills} fills,{" "}
              {snapshot.ingestion.holderGroups} holder groups.{" "}
              {snapshot.ingestion.scope}
            </p>
          )}
        </>
      ) : (
        <p className="border-line-strong text-ink/75 rounded-xl border border-dashed p-6 text-center text-sm">
          Nothing loaded yet. Sync to compare profit rank with track record.
        </p>
      )}
    </section>
  );
}
