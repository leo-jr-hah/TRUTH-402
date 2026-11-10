"use client";

import { Trophy } from "lucide-react";
import { motion } from "motion/react";

import { CountUp } from "@/components/ui/count-up";
import { formatCredits } from "@/lib/format";
import { removeEmDashes } from "@/lib/sanitize";
import type { Market, MemoryCalibratedProbability } from "@/types/domain";

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/**
 * One thin bar. The fill is the crowd price (ink). When a track record
 * value exists, a teal tick marks it on the same scale.
 */
export function CrowdBar({
  crowd,
  track,
  label,
  className = "",
}: {
  crowd: number;
  track?: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`bg-ink/10 relative h-1.5 w-full rounded-full ${className}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp(crowd) * 100)}
    >
      <motion.div
        className="bg-ink h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${clamp(crowd) * 100}%` }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />
      {track !== undefined && (
        <motion.span
          aria-hidden
          className="bg-teal absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          initial={{ left: 0, opacity: 0 }}
          animate={{ left: `${clamp(track) * 100}%`, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
    </div>
  );
}

/** Every outcome as a labelled crowd bar, leader first. */
export function OutcomeBars({
  market,
  compact = false,
  probabilities,
}: {
  market: Market;
  compact?: boolean;
  probabilities?: MemoryCalibratedProbability[];
}) {
  const outcomes = [...market.outcomes].sort((a, b) => b.price - a.price);
  const visible = compact ? outcomes.slice(0, 3) : outcomes;

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {visible.map((outcome) => {
        const winner = market.winningOutcomeId === outcome.id;
        const signal = probabilities?.find((r) => r.outcomeId === outcome.id);
        const crowd = signal?.marketProbability ?? outcome.price;
        const label = removeEmDashes(outcome.label);
        return (
          <div key={outcome.id}>
            <div className="mb-1.5 flex items-end justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-semibold">
                {winner && <Trophy size={14} className="text-teal shrink-0" />}
                <span className="truncate">{label}</span>
              </span>
              <span className="num shrink-0 font-semibold">
                <CountUp value={crowd * 100} suffix="%" duration={0.7} />
                {signal && (
                  <span className="text-teal ml-2 font-medium">
                    <CountUp
                      value={signal.oracleProbability * 100}
                      suffix="%"
                      duration={0.7}
                    />
                  </span>
                )}
                {!compact && (
                  <span className="text-ink/65 ml-2 text-xs font-normal">
                    {formatCredits(outcome.volume)} cr
                  </span>
                )}
              </span>
            </div>
            <CrowdBar
              crowd={crowd}
              track={signal?.oracleProbability}
              label={`${label} crowd price`}
            />
          </div>
        );
      })}
      {compact && outcomes.length > visible.length && (
        <p className="text-ink/65 text-xs">
          +{outcomes.length - visible.length} more
        </p>
      )}
    </div>
  );
}
