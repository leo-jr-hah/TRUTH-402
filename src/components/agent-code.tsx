"use client";

import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const BASE = "http://localhost:3000";

const snippets = [
  {
    title: "Run the sample agent",
    code: "npm run agent:x402 -- --market mkt-sports-final",
  },
  {
    title: "Or do it with curl",
    code: `# 1. Ask. The server answers 402 with an invoice.
curl -i ${BASE}/api/oracle/markets/mkt-sports-final/signal

# 2. Pay, then ask again with proof (demo digest shown).
curl ${BASE}/api/oracle/markets/mkt-sports-final/signal \\
  -H 'Authorization: Payment method="sui", digest="demo-sui-tx-1", invoice="<invoiceToken>", id="<id>"'`,
  },
];

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

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await writeClipboard(value)) {
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1800);
        }
      }}
      aria-label={done ? "Copied" : `Copy ${label}`}
      className={`grid size-11 shrink-0 place-items-center rounded-xl border transition-colors active:scale-90 ${done ? "border-teal text-teal" : "border-line-strong text-ink hover:border-ink"}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? "check" : "copy"}
          initial={{ scale: 0.4, rotate: -40, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="inline-flex"
        >
          {done ? <Check size={18} /> : <Copy size={18} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export function AgentCode() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {snippets.map((s) => (
        <div key={s.title} className="card min-w-0 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">{s.title}</h3>
            <CopyButton value={s.code} label={s.title.toLowerCase()} />
          </div>
          <pre className="bg-navy text-fog mt-3 overflow-x-auto rounded-xl p-4 font-mono text-xs leading-relaxed whitespace-pre">
            {s.code}
          </pre>
        </div>
      ))}
    </div>
  );
}
