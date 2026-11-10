"use client";

import { ArrowRight, BriefcaseBusiness, GitFork } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

const spring = { type: "spring", stiffness: 160, damping: 20 } as const;

/** Crowd bars with a teal track-record tick. Hover swaps the leader. */
function ChoiceArt({ active }: { active: boolean }) {
  const rows = [
    { key: "a", label: "Ship now", crowd: 0.62, swap: 0.34, track: 0.7 },
    { key: "b", label: "Wait", crowd: 0.38, swap: 0.66, track: 0.3 },
  ];
  return (
    <div className="space-y-4" aria-hidden>
      {rows.map((r) => {
        const v = active ? r.swap : r.crowd;
        return (
          <div key={r.key}>
            <div className="num mb-1.5 flex justify-between text-sm font-medium">
              <span>{r.label}</span>
              <span>{Math.round(v * 100)}¢</span>
            </div>
            <div className="bg-ink/10 relative h-1.5 rounded-full">
              <motion.div
                className="bg-ink h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${v * 100}%` }}
                transition={spring}
              />
              <motion.span
                className="bg-teal absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                initial={{ left: 0 }}
                animate={{ left: `${(active ? 1 - r.track : r.track) * 100}%` }}
                transition={spring}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A ranked list that reshuffles on hover: several proposals, one ranking. */
function RankArt({ active }: { active: boolean }) {
  const base = [
    { id: "n", label: "North Grid", v: 0.42 },
    { id: "m", label: "Mossbank", v: 0.27 },
    { id: "k", label: "Kelp Labs", v: 0.19 },
  ];
  const order = active ? [base[2], base[0], base[1]] : base;
  return (
    <ul className="space-y-3" aria-hidden>
      {order.map((r, i) => (
        <motion.li
          key={r.id}
          layout
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="flex items-center gap-3"
        >
          <span className="num border-line-strong grid size-6 shrink-0 place-items-center rounded-md border text-xs">
            {i + 1}
          </span>
          <span className="w-24 shrink-0 truncate text-sm font-medium">
            {r.label}
          </span>
          <span className="bg-ink/10 h-1.5 flex-1 overflow-hidden rounded-full">
            <span
              className={`block h-full rounded-full ${i === 0 ? "bg-teal" : "bg-ink"}`}
              style={{ width: `${r.v * 200}%`, maxWidth: "100%" }}
            />
          </span>
        </motion.li>
      ))}
    </ul>
  );
}

const formats = [
  {
    href: "/markets/new/simple",
    icon: GitFork,
    title: "Simple choice",
    description: "Crowd picks one of a few.",
    Art: ChoiceArt,
  },
  {
    href: "/markets/new/opportunity",
    icon: BriefcaseBusiness,
    title: "Opportunity",
    description: "Rank several proposals against each other.",
    Art: RankArt,
  },
];

export function FormatChooser() {
  const [hot, setHot] = useState<string | null>(null);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {formats.map((f, i) => {
        const Icon = f.icon;
        const active = hot === f.href;
        return (
          <motion.div
            key={f.href}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.08 + i * 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            onHoverStart={() => setHot(f.href)}
            onHoverEnd={() => setHot(null)}
          >
            <Link
              href={f.href}
              onFocus={() => setHot(f.href)}
              onBlur={() => setHot(null)}
              className="card card-interactive group flex h-full flex-col p-6 sm:p-8"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="bg-ice/60 text-ink grid size-12 place-items-center rounded-2xl">
                  <Icon size={22} />
                </span>
                <span className="border-line-strong group-hover:bg-ink group-hover:text-ground grid size-11 place-items-center rounded-full border transition-colors">
                  <ArrowRight size={18} />
                </span>
              </div>
              <h2 className="font-display mt-6 text-3xl font-semibold tracking-[-0.03em]">
                {f.title}
              </h2>
              <p className="text-ink/75 mt-2 text-base">{f.description}</p>
              <div className="border-line bg-ground/60 mt-6 rounded-2xl border p-5">
                <f.Art active={active} />
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
