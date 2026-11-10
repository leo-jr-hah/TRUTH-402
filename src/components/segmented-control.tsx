"use client";

import { motion } from "motion/react";
import { useId } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Pill color when active. Teal is track record, navy is everything else. */
  tone?: "teal" | "navy";
}

const pill = {
  teal: "bg-teal",
  navy: "bg-navy",
} as const;

/** Segmented control with a pill that slides between options. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  label: string;
  className?: string;
}) {
  const group = useId();
  return (
    <div
      role="group"
      aria-label={label}
      className={`border-line-strong bg-panel relative inline-flex max-w-full rounded-2xl border p-1 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`font-display relative min-h-11 min-w-0 flex-1 rounded-xl px-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 active:scale-95 sm:flex-none sm:px-4 sm:text-sm ${
              active ? "text-fog" : "text-ink/70 hover:text-ink"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`segment-${group}`}
                className={`absolute inset-0 rounded-xl ${pill[option.tone ?? "navy"]}`}
                transition={{ type: "spring", stiffness: 480, damping: 34 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
