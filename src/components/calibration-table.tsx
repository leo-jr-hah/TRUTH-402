"use client";

import { motion } from "motion/react";

import { CalibrationCurve } from "@/components/trust-charts";
import type { CalibrationBucket } from "@/types/domain";

function formatGap(gap: number): string {
  return `${gap > 0 ? "+" : ""}${gap.toFixed(1)} pts`;
}

export function CalibrationTable({
  buckets,
  weighted = false,
}: {
  buckets: CalibrationBucket[];
  weighted?: boolean;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="border-line bg-panel min-w-0 rounded-2xl border p-4 sm:p-5">
        <CalibrationCurve buckets={buckets} />
        <p className="text-ink/70 mt-2 text-xs">
          Compares how strongly traders backed a side with how often that side
          won.
        </p>
      </div>
      <ul className="min-w-0 space-y-3">
        {buckets.map((bucket, index) => {
          const gap = bucket.calibrationGap;
          return (
            <motion.li
              key={bucket.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                delay: index * 0.05,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="border-line rounded-xl border px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-display text-sm font-semibold">
                  {bucket.label}
                </p>
                <p className="num text-ink/80 text-xs font-semibold">
                  {gap === null
                    ? "Not available"
                    : `${gap > 0 ? "Right more often than sure" : gap < 0 ? "Right less often than sure" : "Matched"} (${formatGap(gap)})`}
                </p>
              </div>
              {bucket.totalCount ? (
                <>
                  <div className="bg-ink/10 relative mt-3 h-2.5 rounded-full">
                    {bucket.actualAccuracy !== null && (
                      <motion.span
                        className="bg-teal absolute inset-y-0 left-0 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${bucket.actualAccuracy}%` }}
                        transition={{
                          duration: 0.9,
                          ease: [0.16, 1, 0.3, 1],
                          delay: 0.15 + index * 0.05,
                        }}
                      />
                    )}
                    {bucket.averageConfidence !== null && (
                      <motion.span
                        className="bg-ink absolute -top-1 h-[18px] w-0.5 rounded-full"
                        initial={{ left: 0, opacity: 0 }}
                        animate={{
                          left: `${bucket.averageConfidence}%`,
                          opacity: 1,
                        }}
                        transition={{
                          type: "spring",
                          stiffness: 140,
                          damping: 16,
                          delay: 0.4 + index * 0.05,
                        }}
                      />
                    )}
                  </div>
                  <p className="num text-ink/75 mt-2 text-xs">
                    Right {bucket.correctCount} of {bucket.totalCount} calls.
                    Teal bar is how often they were right
                    {bucket.actualAccuracy === null
                      ? ""
                      : ` (${bucket.actualAccuracy.toFixed(0)}%)`}
                    , the tick is how sure they were
                    {bucket.averageConfidence === null
                      ? ""
                      : ` (${bucket.averageConfidence.toFixed(0)}%)`}
                    .
                    {weighted &&
                      ` Recent calls count more: ${bucket.evidenceWeight.toFixed(1)} effective calls.`}
                  </p>
                </>
              ) : (
                <p className="text-ink/70 mt-2 text-xs">No calls here yet.</p>
              )}
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
