"use client";

import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { burst } from "@/components/ui/burst";

function truncate(value: string, head: number, tail: number): string {
  return value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}...${value.slice(-tail)}`;
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Truncated mono hash with a copy button whose icon swaps to a check. */
export function CopyHash({
  value,
  label = "hash",
  head = 8,
  tail = 6,
  className = "",
}: {
  value: string;
  label?: string;
  head?: number;
  tail?: number;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    const ok = await writeClipboard(value);
    setState(ok ? "copied" : "failed");
    if (ok && button.current) burst(button.current, "lime", 12);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  }

  return (
    <span
      className={`border-line bg-panel text-ink/75 inline-flex max-w-full items-center gap-1 rounded-lg border pl-2.5 font-mono text-[11px] ${className}`}
    >
      <span className="truncate" title={value}>
        {truncate(value, head, tail)}
      </span>
      <button
        ref={button}
        type="button"
        onClick={() => void copy()}
        aria-label={
          state === "copied"
            ? `Copied ${label}`
            : state === "failed"
              ? `Copy ${label} failed`
              : `Copy ${label}`
        }
        className={`group grid size-11 shrink-0 place-items-center rounded-lg transition-colors duration-200 active:scale-90 ${
          state === "copied"
            ? "text-teal"
            : state === "failed"
              ? "text-ink"
              : "text-ink/70 hover:bg-ink/10 hover:text-ink"
        }`}
      >
        <AnimatePresence mode="wait" initial={false}>
          {state === "copied" ? (
            <motion.span
              key="check"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 20 }}
            >
              <Check size={15} />
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="transition-transform duration-300 ease-[var(--ease-spring)] group-hover:scale-110 group-hover:-rotate-6"
            >
              <Copy size={15} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? `${label} copied` : ""}
      </span>
    </span>
  );
}
