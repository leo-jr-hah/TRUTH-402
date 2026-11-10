"use client";

import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Designed replacement for native <select>. Keyboard: Enter/Space/ArrowDown open,
 * arrows move, Enter picks, Escape closes, type-ahead on first letter.
 * Renders a hidden input when `name` is passed so plain <form> posts still work.
 */
export function Select({
  value,
  onChange,
  options,
  label,
  name,
  id,
  className = "",
  align = "left",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  name?: string;
  id?: string;
  className?: string;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const listId = `${triggerId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const openMenu = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };
  const pick = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key.length === 1) {
      const next = options.findIndex((o) =>
        o.label.toLowerCase().startsWith(e.key.toLowerCase()),
      );
      if (next >= 0) setActive(next);
    }
  };

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={onKeyDown}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        id={triggerId}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="group border-line-strong bg-ground text-ink hover:border-ink/60 focus-visible:border-teal aria-expanded:border-teal flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-left text-[0.95rem] transition-[border-color,box-shadow] duration-200 disabled:cursor-not-allowed disabled:opacity-40 aria-expanded:shadow-[0_0_0_3px_rgb(22_125_141/0.2)]"
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          size={16}
          className={`text-ink/60 shrink-0 transition-transform duration-300 ease-[var(--ease-out-expo)] ${open ? "text-teal rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -6, scale: 0.97, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(3px)" }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transformOrigin: align === "right" ? "top right" : "top left",
            }}
            className={`border-line-strong bg-panel-2 absolute z-50 mt-2 max-h-72 min-w-full overflow-auto rounded-xl border p-1.5 shadow-[var(--shadow-soft)] ${align === "right" ? "right-0" : "left-0"}`}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={`flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-sm transition-colors duration-100 ${i === active ? "bg-ink/10 text-ink" : "text-ink/75"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && (
                    <span className="text-ink/50 block truncate text-xs">
                      {o.hint}
                    </span>
                  )}
                </span>
                {o.value === value && (
                  <Check size={15} className="text-teal shrink-0" />
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
