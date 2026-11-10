"use client";

import { ArrowLeft, Search } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NotFound() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [q, setQ] = useState("");

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/markets?q=${encodeURIComponent(term)}` : "/markets");
  };

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-12 text-center">
      <div className="w-full max-w-md">
        <div className="relative mx-auto h-24 w-48" aria-hidden="true">
          <span className="display absolute inset-0 grid place-items-center text-7xl opacity-15">
            404
          </span>
          <motion.span
            className="border-ink bg-ground absolute top-1/2 left-1/2 -mt-6 -ml-6 grid size-12 place-items-center rounded-full border"
            animate={reduce ? undefined : { x: [-48, 48, -48], y: [-6, 6, -6] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          >
            <Search size={20} />
          </motion.span>
        </div>
        <h1 className="display mt-6 text-4xl sm:text-5xl">
          We can&apos;t find that page
        </h1>
        <p className="mt-3 opacity-80">Search the markets instead.</p>
        <form onSubmit={go} role="search" className="mt-6 flex gap-2">
          <label htmlFor="nf-q" className="sr-only">
            Search markets
          </label>
          <input
            id="nf-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search markets"
            className="field min-w-0 flex-1"
            autoComplete="off"
          />
          <button type="submit" className="button-primary" aria-label="Search">
            <Search size={17} aria-hidden="true" />
            <span className="hidden sm:inline">Search</span>
          </button>
        </form>
        <div className="mt-6">
          <Link href="/markets" className="button-secondary">
            <ArrowLeft size={17} aria-hidden="true" />
            Back to Markets
          </Link>
        </div>
      </div>
    </div>
  );
}
