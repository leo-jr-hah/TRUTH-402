"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface RankFlipRow {
  id: string;
  name: string;
  profitRank: number;
  trustRank: number;
  profit?: number;
  skill?: number;
  samples?: number;
  blobId?: string;
}

type RankColumn = "profit" | "trust";

interface Connector {
  id: string;
  width: number;
  height: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const columns = [
  { key: "profit", title: "Ranked by profit" },
  { key: "trust", title: "Ranked by track record" },
] as const;

const profitFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const valueFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

function hasValue(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function RankFlip({ rows }: { rows: RankFlipRow[] }) {
  const sectionId = useId();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [connector, setConnector] = useState<Connector | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<RankColumn, Map<string, HTMLLIElement>>>({
    profit: new Map(),
    trust: new Map(),
  });

  const rankings = useMemo(() => {
    // Select one cohort before sorting so both columns show the same traders.
    const profit = [...rows]
      .sort((a, b) => a.profitRank - b.profitRank)
      .slice(0, 6);

    const trust = [...profit].sort(
      (a, b) => a.trustRank - b.trustRank || a.profitRank - b.profitRank,
    );

    return { profit, trust };
  }, [rows]);

  const activeId =
    rankings.profit.find((row) => row.id === hoveredId)?.id ??
    rankings.profit.find((row) => row.id === focusedId)?.id ??
    null;

  useLayoutEffect(() => {
    if (activeId === null) {
      return;
    }

    const container = containerRef.current;
    const profitRow = rowRefs.current.profit.get(activeId);
    const trustRow = rowRefs.current.trust.get(activeId);

    if (!container || !profitRow || !trustRow) {
      setConnector(null);
      return;
    }

    const measure = () => {
      const bounds = container.getBoundingClientRect();
      const from = profitRow.getBoundingClientRect();
      const to = trustRow.getBoundingClientRect();

      if (!bounds.width || !bounds.height) {
        setConnector(null);
        return;
      }

      const next: Connector = {
        id: activeId,
        width: bounds.width,
        height: bounds.height,
        x1: from.right - bounds.left,
        y1: from.top + from.height / 2 - bounds.top,
        x2: to.left - bounds.left,
        y2: to.top + to.height / 2 - bounds.top,
      };

      setConnector((current) =>
        current?.id === next.id &&
        current.width === next.width &&
        current.height === next.height &&
        current.x1 === next.x1 &&
        current.y1 === next.y1 &&
        current.x2 === next.x2 &&
        current.y2 === next.y2
          ? current
          : next,
      );
    };

    measure();

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);

    observer?.observe(container);
    observer?.observe(profitRow);
    observer?.observe(trustRow);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeId, rankings]);

  const visibleConnector = activeId === null ? null : connector;
  const connectorMidpoint = visibleConnector
    ? (visibleConnector.x1 + visibleConnector.x2) / 2
    : 0;

  return (
    <section
      aria-labelledby={`${sectionId}-title`}
      aria-describedby={`${sectionId}-description`}
      className="border-line bg-panel text-ink w-full max-w-full rounded-2xl border p-3 sm:p-4"
    >
      <header>
        <h2
          id={`${sectionId}-title`}
          className="text-base leading-6 font-semibold tracking-tight"
        >
          Big profit is not track record
        </h2>
        <p
          id={`${sectionId}-description`}
          className="text-ink/60 mt-1 text-xs leading-4"
        >
          Hover or focus a trader to see how their rank changes.
        </p>
      </header>

      <p id={`${sectionId}-help`} className="sr-only">
        The same trader is highlighted in both columns. Up and down arrows show
        the change from profit rank to track record rank. Tab to an insights
        link when one is available.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-6 sm:gap-x-10">
        {columns.map((column) => (
          <h3
            key={column.key}
            id={`${sectionId}-${column.key}`}
            className="min-w-0 text-xs leading-4 font-semibold tracking-normal"
          >
            {column.title}
          </h3>
        ))}
      </div>

      <div
        ref={containerRef}
        className="relative mt-2 grid grid-cols-2 gap-x-6 sm:gap-x-10"
      >
        {rankings.profit.length === 0 ? (
          <p
            role="status"
            className="border-line bg-ground/50 text-ink/60 col-span-2 rounded-lg border px-3 py-4 text-center text-xs"
          >
            No traders to compare yet.
          </p>
        ) : (
          columns.map((column) => (
            <ol
              key={column.key}
              role="list"
              aria-labelledby={`${sectionId}-${column.key}`}
              aria-describedby={`${sectionId}-help`}
              className="m-0 min-w-0 list-none space-y-1 p-0"
            >
              {rankings[column.key].map((row) => {
                const isProfit = column.key === "profit";
                const rank = isProfit ? row.profitRank : row.trustRank;
                const change = row.profitRank - row.trustRank;
                const distance = Math.abs(change);
                const isActive = row.id === activeId;

                const profitValue = hasValue(row.profit)
                  ? profitFormatter.format(row.profit)
                  : "N/A";
                const skillValue = hasValue(row.skill)
                  ? `Skill ${valueFormatter.format(row.skill)}`
                  : null;
                const sampleLabel = hasValue(row.samples)
                  ? `${valueFormatter.format(row.samples)} ${
                      row.samples === 1 ? "sample" : "samples"
                    }`
                  : null;

                const metricValue = isProfit
                  ? profitValue
                  : (skillValue ?? sampleLabel ?? "N/A");
                const recordLabel =
                  [skillValue, sampleLabel].filter(Boolean).join(", ") ||
                  "Track record value not available";
                const metricLabel = isProfit
                  ? profitValue === "N/A"
                    ? "Profit not available"
                    : `Profit ${profitValue}`
                  : recordLabel;

                const changeLabel =
                  change === 0
                    ? "No rank change between the two rankings"
                    : `${change > 0 ? "Up" : "Down"} ${distance} ${
                        distance === 1 ? "place" : "places"
                      } from profit rank ${row.profitRank} to track record rank ${row.trustRank}`;

                return (
                  <li
                    key={row.id}
                    value={rank}
                    ref={(node) => {
                      if (node) {
                        rowRefs.current[column.key].set(row.id, node);
                      } else {
                        rowRefs.current[column.key].delete(row.id);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`${row.name}, ${
                      isProfit ? "profit" : "track record"
                    } rank ${rank}. ${metricLabel}. ${changeLabel}.`}
                    data-trader-id={row.id}
                    data-rank-column={column.key}
                    data-active={isActive}
                    onMouseEnter={() => setHoveredId(row.id)}
                    onMouseLeave={() => {
                      setHoveredId((current) =>
                        current === row.id ? null : current,
                      );
                    }}
                    onFocus={() => {
                      setFocusedId(row.id);
                      setHoveredId(null);
                    }}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setFocusedId((current) =>
                          current === row.id ? null : current,
                        );
                      }
                    }}
                    className={`border-line focus-visible:outline-teal relative flex h-10 min-w-0 items-center gap-1.5 rounded-lg border px-1.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none ${
                      isActive
                        ? "bg-ice/30 ring-teal/70 ring-1 ring-inset"
                        : "bg-ground/50"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="text-ink/60 min-w-4 shrink-0 text-center font-mono text-[11px] leading-none"
                    >
                      {rank}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        title={row.name}
                        className="block truncate text-xs leading-4 font-medium"
                      >
                        {row.name}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-3 tabular-nums">
                        <span
                          title={metricLabel}
                          className="text-ink/60 min-w-0 truncate"
                        >
                          {metricValue}
                        </span>
                        {!isProfit && (
                          <span
                            aria-hidden="true"
                            title={changeLabel}
                            className={`shrink-0 font-medium whitespace-nowrap ${
                              change > 0 ? "text-teal" : "text-ink/60"
                            }`}
                          >
                            {change > 0 ? "↑" : change < 0 ? "↓" : "="}{" "}
                            {distance}
                          </span>
                        )}
                      </span>
                    </span>

                    {row.blobId && (
                      <a
                        href={`/insights?record=${encodeURIComponent(row.blobId)}`}
                        aria-label={`View insights for ${row.name}`}
                        title={`View insights for ${row.name}`}
                        className="text-teal hover:bg-teal/10 focus-visible:outline-teal inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 motion-reduce:transition-none"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                          className="size-3"
                        >
                          <path d="M4 12 12 4M5 4h7v7" />
                        </svg>
                      </a>
                    )}
                  </li>
                );
              })}
            </ol>
          ))
        )}

        {visibleConnector && visibleConnector.id === activeId && (
          <svg
            viewBox={`0 0 ${visibleConnector.width} ${visibleConnector.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
            className="text-teal pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
          >
            <path
              d={`M ${visibleConnector.x1} ${visibleConnector.y1} C ${connectorMidpoint} ${visibleConnector.y1}, ${connectorMidpoint} ${visibleConnector.y2}, ${visibleConnector.x2} ${visibleConnector.y2}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="opacity-80"
            />
            <circle
              cx={visibleConnector.x1}
              cy={visibleConnector.y1}
              r="2"
              fill="currentColor"
            />
            <circle
              cx={visibleConnector.x2}
              cy={visibleConnector.y2}
              r="2"
              fill="currentColor"
            />
          </svg>
        )}
      </div>
    </section>
  );
}
