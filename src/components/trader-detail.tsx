"use client";

import { Check, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import { RankChips } from "@/components/credibility-table";
import { Sparkline } from "@/components/trust-charts";
import { formatDate } from "@/lib/format";
import { removeEmDashes } from "@/lib/sanitize";
import type {
  Credibility,
  ParticipantPerformanceMemory,
  VerdictoMemoryRecord,
} from "@/types/domain";

const DAY = 86_400_000;

function callsFor(
  records: VerdictoMemoryRecord[],
  participantId: string,
): ParticipantPerformanceMemory[] {
  return records
    .filter(
      (r): r is ParticipantPerformanceMemory =>
        r.kind === "participant_performance" &&
        r.participantId === participantId,
    )
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

/** Running recent-calls-count-more track record after each resolved call. */
function historyFrom(
  calls: ParticipantPerformanceMemory[],
  halfLifeDays: number,
): number[] {
  const mine = calls
    .map((r) => ({ at: Date.parse(r.occurredAt), correct: r.correct }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at);
  return mine.map((_, k) => {
    let correct = 0;
    let total = 0;
    for (let i = 0; i <= k; i++) {
      const weight = 2 ** (-(mine[k].at - mine[i].at) / DAY / halfLifeDays);
      total += weight;
      if (mine[i].correct) correct += weight;
    }
    return ((correct + 1) / (total + 2)) * 100;
  });
}

function ScoreBar({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        <p className="num text-teal text-sm font-semibold">
          {Math.round(value)}
        </p>
      </div>
      <div className="bg-ink/10 mt-1.5 h-2 overflow-hidden rounded-full">
        <motion.div
          className="bg-teal h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(2, Math.min(100, value))}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <p className="text-ink/70 mt-1 text-xs">{caption}</p>
    </div>
  );
}

/**
 * One trader's detail. `sheet` is a bottom sheet for phones, `dock` is a
 * column beside the list on desktop. Neither locks page scroll.
 */
export function TraderDetail({
  entry,
  records,
  halfLifeDays,
  variant,
  onClose,
}: {
  entry: Credibility;
  records: VerdictoMemoryRecord[];
  halfLifeDays: number;
  variant: "dock" | "sheet";
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const name = removeEmDashes(entry.displayName);
  const calls = useMemo(
    () => callsFor(records, entry.participantId),
    [records, entry.participantId],
  );
  const history = useMemo(
    () => historyFrom(calls, halfLifeDays),
    [calls, halfLifeDays],
  );
  const sampleSize = (entry.totalCount / (entry.totalCount + 10)) * 100;

  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
  }, [entry.participantId]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (variant !== "sheet" || event.key !== "Tab" || !panel.current) return;
    const focusable = panel.current.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], [tabindex='0']",
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const content = (
    <motion.div
      ref={panel}
      initial={
        variant === "sheet" ? { y: 60, opacity: 0 } : { opacity: 0, x: 16 }
      }
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={variant === "sheet" ? { y: 60, opacity: 0 } : { opacity: 0, x: 16 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      role={variant === "sheet" ? "dialog" : "region"}
      aria-modal={variant === "sheet" ? true : undefined}
      aria-label={`${name} details`}
      onKeyDown={onKeyDown}
      data-trader-panel={variant}
      className={
        variant === "sheet"
          ? "border-line-strong bg-ground fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl border p-5 pb-8"
          : "border-line bg-panel max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain rounded-2xl border p-5"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-2xl font-bold tracking-tight break-words">
            {name}
          </h3>
          <p className="num text-ink/75 mt-1 text-sm">
            Right {entry.correctCount} of {entry.totalCount} calls
          </p>
        </div>
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="border-line-strong hover:bg-ink/5 focus-visible:outline-teal grid size-11 shrink-0 place-items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95"
        >
          <X size={18} />
        </button>
      </div>

      <div className="mt-4">
        <RankChips entry={entry} />
      </div>

      <section
        className="mt-6"
        aria-labelledby={`built-${entry.participantId}`}
      >
        <h4
          id={`built-${entry.participantId}`}
          className="font-display text-base font-semibold"
        >
          How the track record is built
        </h4>
        <div className="mt-3 space-y-4">
          <ScoreBar
            label="Accuracy"
            value={entry.accuracy}
            caption="Share of calls that were right."
          />
          <ScoreBar
            label="Consistency"
            value={entry.credibleInterval.lowerBound}
            caption="Score in a bad stretch, not a lucky one."
          />
          <ScoreBar
            label="Sample size"
            value={sampleSize}
            caption={`${entry.totalCount} calls so far. More calls, more trust.`}
          />
        </div>
      </section>

      <section
        className="mt-6"
        aria-labelledby={`trend-${entry.participantId}`}
      >
        <h4
          id={`trend-${entry.participantId}`}
          className="font-display text-base font-semibold"
        >
          Track record over time
        </h4>
        <div className="mt-2">
          <Sparkline
            values={history}
            label={`Track record over time for ${name}`}
          />
        </div>
      </section>

      <section
        className="mt-6"
        aria-labelledby={`calls-${entry.participantId}`}
      >
        <h4
          id={`calls-${entry.participantId}`}
          className="font-display text-base font-semibold"
        >
          Their calls
        </h4>
        {calls.length === 0 ? (
          <p className="text-ink/70 mt-2 text-sm">No resolved calls yet.</p>
        ) : (
          <ul className="divide-line mt-2 divide-y">
            {calls.map((call) => (
              <li key={call.recordId} className="flex items-start gap-3 py-2.5">
                <span
                  className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
                    call.correct
                      ? "bg-teal text-fog"
                      : "border-line-strong text-ink border"
                  }`}
                  aria-hidden="true"
                >
                  {call.correct ? <Check size={14} /> : <X size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug font-medium break-words">
                    {removeEmDashes(call.marketTitle)}
                  </span>
                  <span className="text-ink/70 block text-xs">
                    {call.correct ? "Right" : "Wrong"}: backed{" "}
                    {removeEmDashes(call.predictedOutcomeLabel)} on{" "}
                    {formatDate(call.occurredAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </motion.div>
  );

  if (variant === "dock") return content;
  // Portal: a filtered ancestor (page transition) would otherwise capture fixed positioning.
  return createPortal(
    <>
      <motion.div
        aria-hidden="true"
        onClick={onClose}
        data-trader-backdrop
        className="bg-navy/40 fixed inset-0 z-[60]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      {content}
    </>,
    document.body,
  );
}
