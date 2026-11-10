"use client";

import { KeyRound, LockKeyhole } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

export function OperatorTokenField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const filled = value.length > 0;
  return (
    <label
      className={`group bg-panel block rounded-2xl border p-4 transition-colors duration-300 ${
        filled
          ? "border-teal/60"
          : "border-line-strong hover:border-ink/60 focus-within:border-teal"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span
          className={`relative grid size-9 shrink-0 place-items-center rounded-xl transition-colors duration-300 ${
            filled ? "bg-teal/15 text-teal" : "bg-ink/10 text-ink"
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={filled ? "on" : "off"}
              initial={{ scale: 0.4, rotate: -40, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.4, rotate: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 22 }}
              className="grid place-items-center"
            >
              {filled ? <LockKeyhole size={17} /> : <KeyRound size={17} />}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="min-w-0">
          <span className="font-display block text-sm font-bold">
            Operator token for live actions
          </span>
          <span className="text-ink/70 block text-xs">
            {filled ? "Ready for the next action" : "Needed before you can act"}
          </span>
        </span>
      </span>
      <input
        type="password"
        className="field mt-3"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        maxLength={200}
        placeholder="Paste token"
      />
      <span className="text-ink/60 mt-2 block text-xs leading-5">
        A live provider is on. The token goes out as an authorization header
        once, then is wiped. It is never stored.
      </span>
    </label>
  );
}
