"use client";

import { Check, Database, TriangleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { humanize } from "@/lib/format";
import type { Market, MemoryPublishStatus } from "@/types/domain";

const ease = [0.16, 1, 0.3, 1] as const;
const spring = { type: "spring", stiffness: 420, damping: 36 } as const;
const pillClassName =
  "inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-panel py-1 pr-3 pl-2.5 align-middle font-sans text-xs font-medium leading-4 text-ink";

export function MarketStatusPill({ status }: { status: Market["status"] }) {
  const reduceMotion = useReducedMotion();

  return status === "open" ? (
    <span className={pillClassName}>
      <span
        aria-hidden
        className="relative grid size-4 shrink-0 place-items-center"
      >
        <span className="bg-ink relative size-1.5 rounded-full">
          <motion.span
            className="bg-ink absolute inset-0 rounded-full"
            initial={false}
            animate={
              reduceMotion
                ? { scale: 1, opacity: 0 }
                : { scale: [1, 2], opacity: [0.3, 0] }
            }
            transition={{
              duration: reduceMotion ? 0 : 1.8,
              repeat: reduceMotion ? 0 : Infinity,
              ease,
            }}
          />
        </span>
      </span>
      Open
    </span>
  ) : (
    <span className={pillClassName}>
      <motion.span
        aria-hidden
        className="bg-panel-2 text-ink grid size-4 shrink-0 place-items-center rounded-full"
        initial={reduceMotion ? false : { scale: 0.8, rotate: -24 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={reduceMotion ? { duration: 0 } : spring}
      >
        <Check size={10} strokeWidth={3} />
      </motion.span>
      Resolved
    </span>
  );
}

export function MemoryStatusPill({
  status,
  provider,
}: {
  status: MemoryPublishStatus;
  provider?: "demo" | "walrus";
}) {
  const reduceMotion = useReducedMotion();
  const failure = status === "failed";
  const confirmed = status === "confirmed";
  const pending = status === "pending";
  const Icon = failure ? TriangleAlert : confirmed ? Check : Database;

  return (
    <span className={pillClassName}>
      <motion.span
        key={status}
        aria-hidden
        className="text-ink/70 grid size-4 shrink-0 place-items-center"
        initial={
          reduceMotion
            ? false
            : failure
              ? { rotate: 0, scale: 1, opacity: 1 }
              : { rotate: 0, scale: 0.8, opacity: 0 }
        }
        animate={
          reduceMotion
            ? { rotate: 0, scale: 1, opacity: 1 }
            : failure
              ? { rotate: [0, -6, 5, -3, 0], scale: 1, opacity: 1 }
              : pending
                ? {
                    rotate: 0,
                    scale: [1, 1.06, 1],
                    opacity: [0.8, 1, 0.8],
                  }
                : { rotate: 0, scale: 1, opacity: 1 }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : failure
              ? { duration: 0.45, delay: 0.1, ease }
              : pending
                ? { duration: 1.8, repeat: Infinity, ease }
                : spring
        }
      >
        <Icon size={12} strokeWidth={failure || confirmed ? 2.6 : 2} />
      </motion.span>
      <span className="min-w-0 truncate">
        {confirmed && provider
          ? `${provider === "walrus" ? "Mainnet" : "Demo"} confirmed`
          : humanize(status)}
      </span>
    </span>
  );
}
