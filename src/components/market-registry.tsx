"use client";

import { Search, SearchX, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState } from "react";

import { MarketCard } from "@/components/market-card";
import { Select } from "@/components/ui/select";
import { removeEmDashes } from "@/lib/sanitize";
import {
  MARKET_CATEGORIES,
  marketCategory,
  type MarketCategory,
} from "@/lib/market-category";
import type {
  Market,
  MarketStatus,
  MemoryCalibratedProbability,
} from "@/types/domain";

type StatusFilter = "all" | MarketStatus;
type SortKey = "default" | "volume" | "voices" | "newest";

const statusOptions = [
  { value: "all", label: "All markets" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
];
const sortOptions = [
  { value: "default", label: "Featured" },
  { value: "volume", label: "Most volume" },
  { value: "voices", label: "Most traders" },
  { value: "newest", label: "Newest" },
];

const voices = (m: Market) =>
  new Set(m.trades.map((t) => t.participantId)).size;

export function MarketRegistry({
  markets,
  previews = {},
}: {
  markets: Market[];
  previews?: Record<string, MemoryCalibratedProbability[]>;
}) {
  const pillId = useId();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [category, setCategory] = useState<MarketCategory>("All");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const rows = markets.filter((market) => {
      const matchesQuery =
        !normalized ||
        `${market.title} ${market.description} ${market.sponsor} ${market.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(normalized);
      return (
        matchesQuery &&
        (status === "all" || market.status === status) &&
        (category === "All" || marketCategory(market) === category)
      );
    });
    if (sort === "volume") rows.sort((a, b) => b.totalVolume - a.totalVolume);
    else if (sort === "voices") rows.sort((a, b) => voices(b) - voices(a));
    else if (sort === "newest")
      rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return rows;
  }, [markets, query, status, category, sort]);

  const dirty =
    query !== "" ||
    status !== "all" ||
    category !== "All" ||
    sort !== "default";
  const reset = () => {
    setQuery("");
    setStatus("all");
    setSort("default");
    setCategory("All");
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
          <label className="group relative min-w-0 flex-1">
            <span className="sr-only">Search markets</span>
            <Search
              size={20}
              className="text-ink/55 group-focus-within:text-teal pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 transition-colors"
            />
            <input
              type="text"
              inputMode="search"
              className="field !border-line !bg-panel !text-ink placeholder:!text-ink/55 focus:!bg-ice/40 !h-10 !min-h-10 !w-full !rounded-lg !py-0 !pr-9 !pl-9 !text-sm"
              placeholder="Search markets"
              value={query}
              onChange={(event) => setQuery(removeEmDashes(event.target.value))}
            />
            <AnimatePresence>
              {query && (
                <motion.button
                  type="button"
                  aria-label="Clear search"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  onClick={() => setQuery("")}
                  className="text-ink/65 hover:bg-ice/60 hover:text-ink focus-visible:bg-ice absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md transition-colors"
                >
                  <X size={16} />
                </motion.button>
              )}
            </AnimatePresence>
          </label>

          <details className="relative shrink-0">
            <summary
              aria-label={`Market category: ${category}`}
              className="border-line bg-panel text-ink hover:bg-ice/60 focus-visible:bg-ice flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition-colors [&::-webkit-details-marker]:hidden"
            >
              <span className="max-w-16 truncate">
                {category === "All" ? "Category" : category}
              </span>
              <span className="text-ink/55" aria-hidden>
                &#9662;
              </span>
            </summary>
            <div
              className="border-line bg-panel absolute top-full right-0 z-20 mt-1 flex w-56 flex-wrap gap-1 rounded-lg border p-2"
              role="group"
              aria-label="Registry market category"
            >
              {MARKET_CATEGORIES.map((value) => {
                const active = category === value;
                return (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={active}
                    onClick={() => setCategory(value)}
                    className={`border-line relative inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold transition-colors duration-200 ${
                      active
                        ? "text-fog"
                        : "text-ink/75 hover:bg-ice/60 hover:text-ink"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={`${pillId}-active`}
                        className="bg-navy absolute inset-0 rounded-full"
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 32,
                        }}
                      />
                    )}
                    <span className="relative">{value}</span>
                  </button>
                );
              })}
            </div>
          </details>

          <div
            aria-live="polite"
            className="text-ink/70 flex shrink-0 items-center gap-2 text-xs"
          >
            <span className="num sr-only whitespace-nowrap lg:not-sr-only">
              {filtered.length} {filtered.length === 1 ? "market" : "markets"}
            </span>
            <span className="flex items-center gap-2 text-xs">
              <span
                className="hidden items-center gap-1.5 whitespace-nowrap 2xl:inline-flex"
                aria-hidden
              >
                <span className="bg-navy h-1.5 w-4 rounded-full" /> Crowd price
              </span>
              <span
                className="hidden items-center gap-1.5 whitespace-nowrap 2xl:inline-flex"
                aria-hidden
              >
                <span className="bg-teal h-3.5 w-[3px] rounded-full" /> Track
                record
              </span>
              {dirty && (
                <button
                  type="button"
                  onClick={reset}
                  title="Clear filters"
                  className="text-ink hover:bg-ice/60 focus-visible:bg-ice grid size-8 shrink-0 place-items-center rounded-md transition-colors"
                >
                  <X size={16} aria-hidden />
                  <span className="sr-only">Clear filters</span>
                </button>
              )}
            </span>
          </div>
        </div>

        <div
          role="group"
          aria-label="Market status"
          className="border-line bg-panel inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
        >
          {statusOptions.map(({ value, label }) => {
            const active = status === value;
            return (
              <button
                type="button"
                key={value}
                aria-pressed={active}
                onClick={() => setStatus(value as StatusFilter)}
                className={`focus-visible:bg-teal focus-visible:text-fog h-7 rounded-md px-1.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-none ${
                  active
                    ? "bg-navy text-fog"
                    : "text-ink/70 hover:bg-ice/60 hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <Select
          label="Sort markets"
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          options={sortOptions}
          align="right"
          className="!border-line !bg-panel !text-ink [&>button]:!border-line [&>button]:!bg-panel [&>button]:!text-ink !h-10 !min-h-10 w-32 shrink-0 !rounded-lg !py-0 !text-xs [&>button]:!h-10 [&>button]:!min-h-10 [&>button]:!rounded-lg [&>button]:!px-2 [&>button]:!py-0 [&>button]:!text-xs"
        />
      </div>

      <motion.div
        layout
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {filtered.map((market) => (
            <motion.div
              key={market.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{
                layout: { type: "spring", stiffness: 300, damping: 32 },
                opacity: { duration: 0.2 },
                y: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
              }}
              className="min-w-0"
            >
              <MarketCard market={market} preview={previews[market.id]} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {filtered.length === 0 && (
        <div className="border-line bg-panel flex flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed p-3">
          <SearchX size={28} className="text-ink/60 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-ink text-sm font-semibold">No markets found</h2>
            <p className="text-ink/70 mt-0.5 text-xs">
              Try another search or clear the filters.
            </p>
          </div>
          <button
            type="button"
            className="border-line bg-ice/60 text-ink hover:bg-teal hover:text-fog focus-visible:bg-teal focus-visible:text-fog inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-xs font-semibold transition-colors"
            onClick={reset}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
