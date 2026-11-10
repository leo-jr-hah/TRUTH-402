"use client";

import { LoaderCircle, Search, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { CalibrationTable } from "@/components/calibration-table";
import { CopyHash } from "@/components/copy-hash";
import {
  CredibilityTable,
  sortCredibility,
} from "@/components/credibility-table";
import { PredictionCalibrationPanel } from "@/components/prediction-calibration-panel";
import { SegmentedControl } from "@/components/segmented-control";
import { TraderDetail } from "@/components/trader-detail";
import { Disclosure } from "@/components/ui/disclosure";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { removeEmDashes } from "@/lib/sanitize";
import type { InsightsSnapshot, VerdictoMemoryRecord } from "@/types/domain";
import type { PredictionCalibrationSnapshot } from "@/types/oracle";

type SortKey = "skill" | "profit";
type ScoreMode = "equal" | "recency";
type EvidenceTab = "scoring" | "confidence" | "benchmark" | "records";

interface GeneratedInsight {
  content: string;
  provider: "demo" | "agent-router";
  model?: string;
  cached: boolean;
  generatedAt: string;
}

interface ApiFailure {
  error?: { message?: string };
}

const RECORD_PAGE = 20;
const RESULT_PAGE = 5;

function recordById(
  snapshot: InsightsSnapshot,
): Map<string, VerdictoMemoryRecord> {
  return new Map(snapshot.records.map((record) => [record.recordId, record]));
}

function recordIdOf(text: string): string | undefined {
  const marker = "VERDICTO_DATA_V1:";
  const framed = `\n${marker}`;
  const at = text.lastIndexOf(framed);
  const envelope =
    at >= 0
      ? text.slice(at + framed.length)
      : text.startsWith(marker)
        ? text.slice(marker.length)
        : "";
  return /"recordId"\s*:\s*"([^"]+)"/u.exec(envelope)?.[1];
}

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(min-width: 1024px)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

const evidenceTabs: Array<{ value: EvidenceTab; label: string }> = [
  { value: "scoring", label: "Scoring" },
  { value: "confidence", label: "Confidence" },
  { value: "benchmark", label: "Benchmark" },
  { value: "records", label: "Records" },
];

export function InsightsDashboard({
  initialSnapshot,
  initialCalibration,
  calibrationMode,
  selectedRecordId,
  operatorRequired = false,
}: {
  initialSnapshot: InsightsSnapshot;
  initialCalibration: PredictionCalibrationSnapshot | null;
  calibrationMode: "demo" | "live";
  selectedRecordId?: string;
  operatorRequired?: boolean;
}) {
  const [recalled, setRecalled] = useState<InsightsSnapshot | null>(null);
  const [recallRan, setRecallRan] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("skill");
  const [scoreMode, setScoreMode] = useState<ScoreMode>("equal");
  const [tab, setTab] = useState<EvidenceTab>(
    selectedRecordId ? "records" : "scoring",
  );
  const [selectedTrader, setSelectedTrader] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedInsight | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [visibleRecords, setVisibleRecords] = useState(RECORD_PAGE);
  const trigger = useRef<HTMLElement | null>(null);
  const openedAtScroll = useRef(0);
  const isDesktop = useIsDesktop();
  const tabsId = useId();

  const evidenceSnapshot = recalled ?? initialSnapshot;
  const records = useMemo(
    () => recordById(evidenceSnapshot),
    [evidenceSnapshot],
  );
  const recency = scoreMode === "recency";
  const board = useMemo(
    () =>
      sortCredibility(
        recency
          ? initialSnapshot.recencyWeighted.leaderboard
          : initialSnapshot.leaderboard,
        sortKey,
      ),
    [recency, initialSnapshot, sortKey],
  );
  const calibration = recency
    ? initialSnapshot.recencyWeighted.calibration
    : initialSnapshot.calibration;
  const selectedEntry = selectedTrader
    ? (board.find((entry) => entry.participantId === selectedTrader) ?? null)
    : null;
  const halfLife = initialSnapshot.recencyWeighted.halfLifeDays;

  // Deep link to one memory record: open once, scroll once.
  useEffect(() => {
    if (!selectedRecordId) return;
    const timer = setTimeout(() => {
      document
        .getElementById(`memory-${selectedRecordId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 600);
    return () => clearTimeout(timer);
  }, [selectedRecordId]);

  const closeTrader = useCallback(() => {
    setSelectedTrader(null);
    const origin = trigger.current;
    trigger.current = null;
    requestAnimationFrame(() => {
      origin?.focus({ preventScroll: true });
      if (Math.abs(window.scrollY - openedAtScroll.current) > 1) {
        window.scrollTo({ top: openedAtScroll.current, behavior: "instant" });
      }
    });
  }, []);

  function openTrader(id: string, element: HTMLElement) {
    if (selectedTrader === id) {
      closeTrader();
      return;
    }
    if (!selectedTrader) {
      trigger.current = element;
      openedAtScroll.current = window.scrollY;
    }
    setSelectedTrader(id);
  }

  useEffect(() => {
    if (!selectedTrader) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeTrader();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTrader, closeTrader]);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setSearchError(null);
    setGenerated(null);
    try {
      const parameters = new URLSearchParams();
      if (query.trim()) parameters.set("query", query.trim());
      parameters.set("limit", "100");
      const response = await fetch(`/api/insights?${parameters}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as InsightsSnapshot & ApiFailure;
      if (!response.ok || !Array.isArray(payload.memories)) {
        throw new Error(payload.error?.message || "Recall failed.");
      }
      setRecalled(payload);
      setRecallRan(true);
      setShowAllResults(false);
      setVisibleRecords(RECORD_PAGE);
    } catch (caught) {
      setSearchError(
        caught instanceof Error
          ? removeEmDashes(caught.message)
          : "Recall failed.",
      );
    } finally {
      setSearching(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setGenerationError(null);
    setGenerated(null);
    try {
      const response = await fetch("/api/insights/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(operatorToken
            ? { authorization: `Bearer ${operatorToken}` }
            : {}),
        },
        body: JSON.stringify({ query: query.trim() || undefined }),
      });
      const payload = (await response.json()) as GeneratedInsight & ApiFailure;
      if (!response.ok || !payload.content) {
        throw new Error(payload.error?.message || "Could not write an answer.");
      }
      setGenerated(payload);
    } catch (caught) {
      setGenerationError(
        caught instanceof Error
          ? removeEmDashes(caught.message)
          : "Could not write an answer.",
      );
    } finally {
      setGenerating(false);
      setOperatorToken("");
    }
  }

  const results = recalled?.memories ?? [];
  const shownResults = showAllResults ? results : results.slice(0, RESULT_PAGE);
  const memories = evidenceSnapshot.memories;
  const shownMemories = selectedRecordId
    ? memories
    : memories.slice(0, visibleRecords);

  const showDock = Boolean(selectedEntry) && isDesktop;

  return (
    <div className="space-y-10">
      <section aria-labelledby="board-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2
              id="board-title"
              className="font-display text-2xl font-bold tracking-tight"
            >
              Leaderboard
            </h2>
            <p className="text-ink/75 mt-1 text-sm" aria-live="polite">
              {sortKey === "skill"
                ? "Ordered by track record."
                : "Ordered by profit."}
              {recency ? " Recent calls count more." : ""}
            </p>
          </div>
          <SegmentedControl<SortKey>
            label="Sort leaderboard"
            className="w-full sm:w-auto"
            value={sortKey}
            onChange={setSortKey}
            options={[
              { value: "skill", label: "Sort by Track record", tone: "teal" },
              { value: "profit", label: "Sort by Profit", tone: "navy" },
            ]}
          />
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            <CredibilityTable
              entries={board}
              showBreakdown
              onSelect={openTrader}
              selectedId={selectedTrader}
            />
          </div>
          <div className="sticky top-24 min-w-0 self-start">
            {showDock && selectedEntry ? (
              <TraderDetail
                key={selectedEntry.participantId}
                entry={selectedEntry}
                records={initialSnapshot.records}
                halfLifeDays={halfLife}
                variant="dock"
                onClose={closeTrader}
              />
            ) : (
              <section
                aria-labelledby="ask-title"
                className="border-line bg-panel rounded-2xl border p-4"
              >
                <h2
                  id="ask-title"
                  className="font-display text-lg font-bold tracking-tight"
                >
                  Ask the memory
                </h2>
                <p className="text-ink/75 mt-1 text-sm">
                  Search past calls, then get a short written answer.
                </p>

                <form
                  onSubmit={search}
                  className="mt-4 flex flex-col gap-2 sm:flex-row"
                >
                  <label className="group relative min-w-0 flex-1">
                    <span className="sr-only">Search the memory</span>
                    <Search
                      size={17}
                      className="text-ink/60 group-focus-within:text-teal pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 transition-colors"
                    />
                    <input
                      className="field !pl-10"
                      value={query}
                      onChange={(event) =>
                        setQuery(removeEmDashes(event.target.value))
                      }
                      placeholder="A trader name or a topic"
                    />
                  </label>
                  <button
                    type="submit"
                    className="button-secondary"
                    disabled={searching}
                  >
                    {searching ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : null}
                    {searching ? "Recalling..." : "Recall"}
                  </button>
                </form>

                {searchError && (
                  <p
                    role="alert"
                    className="border-line-strong mt-3 rounded-xl border px-4 py-3 text-sm"
                  >
                    {searchError}
                  </p>
                )}

                {recallRan && (
                  <div className="mt-4" data-testid="recall-results">
                    <p className="text-sm font-semibold" aria-live="polite">
                      {results.length === 0
                        ? "Nothing found. Try a broader search."
                        : `${results.length} result${results.length === 1 ? "" : "s"}`}
                    </p>
                    {results.length > 0 && (
                      <ul className="divide-line mt-2 divide-y">
                        {shownResults.map((memory) => {
                          const id = recordIdOf(memory.text);
                          const parsed = id ? records.get(id) : undefined;
                          const text = parsed
                            ? removeEmDashes(parsed.summary)
                            : removeEmDashes(
                                memory.text.split("\n").slice(0, 2).join(" "),
                              );
                          return (
                            <li
                              key={`${memory.blobId}-${memory.createdAt}`}
                              className="py-2.5"
                            >
                              <p className="text-ink/70 text-xs">
                                {parsed ? humanize(parsed.kind) : "Memory"}
                                {parsed
                                  ? `, ${formatDate(parsed.occurredAt)}`
                                  : ""}
                              </p>
                              <p className="line-clamp-2 text-sm break-words">
                                {text}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {results.length > RESULT_PAGE && (
                      <button
                        type="button"
                        className="text-teal decoration-teal/30 hover:decoration-teal mt-2 min-h-11 text-sm font-semibold underline"
                        onClick={() => setShowAllResults((v) => !v)}
                      >
                        {showAllResults
                          ? "Show fewer"
                          : `Show all ${results.length} results`}
                      </button>
                    )}
                  </div>
                )}

                <div className="border-line mt-5 border-t pt-5">
                  {operatorRequired && (
                    <label className="mb-4 block max-w-sm">
                      <span className="field-label">Operator token</span>
                      <input
                        type="password"
                        className="field"
                        value={operatorToken}
                        onChange={(event) =>
                          setOperatorToken(event.target.value)
                        }
                        autoComplete="off"
                        maxLength={200}
                      />
                      <span className="text-ink/70 mt-1.5 block text-xs">
                        Sent once as a header. Never stored.
                      </span>
                    </label>
                  )}
                  <button
                    type="button"
                    className="button-primary group w-full sm:w-auto"
                    disabled={
                      generating ||
                      initialSnapshot.records.length === 0 ||
                      (operatorRequired && !operatorToken)
                    }
                    onClick={() => void generate()}
                  >
                    {generating ? (
                      <LoaderCircle size={17} className="animate-spin" />
                    ) : (
                      <Sparkles
                        size={17}
                        className="transition-transform duration-500 group-hover:scale-125 group-hover:rotate-[24deg]"
                      />
                    )}
                    {generating
                      ? "Writing answer..."
                      : generated
                        ? "Generate again"
                        : "Generate insight"}
                  </button>

                  <div aria-live="polite" className="mt-4">
                    {generating && (
                      <div className="space-y-2" aria-hidden="true">
                        <div className="skeleton h-4 w-full rounded" />
                        <div className="skeleton h-4 w-11/12 rounded" />
                        <div className="skeleton h-4 w-2/3 rounded" />
                      </div>
                    )}
                    {generationError && (
                      <p
                        role="alert"
                        className="border-line-strong rounded-xl border px-4 py-3 text-sm"
                      >
                        {generationError}
                      </p>
                    )}
                    {generated && !generating && (
                      <motion.div
                        key={generated.generatedAt}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        className="bg-ice/40 rounded-xl p-4"
                        data-testid="insight-answer"
                      >
                        <p className="text-sm leading-6 whitespace-pre-line">
                          {removeEmDashes(generated.content)}
                        </p>
                        <p className="text-ink/70 mt-3 text-xs">
                          {generated.provider === "agent-router"
                            ? removeEmDashes(generated.model ?? "AI model")
                            : "Demo writer"}
                          {generated.cached ? ", saved answer" : ", new answer"}
                        </p>
                      </motion.div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
        <AnimatePresence>
          {!isDesktop && selectedEntry && (
            <TraderDetail
              key="sheet"
              entry={selectedEntry}
              records={initialSnapshot.records}
              halfLifeDays={halfLife}
              variant="sheet"
              onClose={closeTrader}
            />
          )}
        </AnimatePresence>
      </section>

      <Disclosure
        defaultOpen={Boolean(selectedRecordId)}
        summary={
          <span className="block py-0.5">
            <span className="font-display block text-lg font-bold">
              How scores are built
            </span>
            <span className="text-ink/75 block text-sm font-normal">
              Evidence, charts and raw records.
            </span>
          </span>
        }
      >
        <div className="space-y-6">
          <div
            role="tablist"
            aria-label="Evidence"
            className="flex flex-wrap gap-2"
          >
            {evidenceTabs.map((item) => {
              const active = tab === item.value;
              return (
                <button
                  key={item.value}
                  id={`${tabsId}-tab-${item.value}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(item.value)}
                  onKeyDown={(event) => {
                    const dir =
                      event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowLeft"
                          ? -1
                          : 0;
                    if (!dir) return;
                    event.preventDefault();
                    const index = evidenceTabs.findIndex(
                      (t) => t.value === tab,
                    );
                    const next =
                      evidenceTabs[
                        (index + dir + evidenceTabs.length) %
                          evidenceTabs.length
                      ];
                    setTab(next.value);
                    document
                      .getElementById(`${tabsId}-tab-${next.value}`)
                      ?.focus();
                  }}
                  className={`focus-visible:outline-teal min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    active
                      ? "border-navy bg-navy text-fog"
                      : "border-line-strong text-ink/80 hover:bg-ink/5"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`${tabsId}-panel`}
            aria-labelledby={`${tabsId}-tab-${tab}`}
            className="min-w-0"
          >
            {tab === "scoring" && (
              <div className="space-y-8">
                <div className="space-y-3">
                  <h3 className="font-display text-xl font-bold tracking-tight">
                    Three things make a track record
                  </h3>
                  <ul className="text-ink/80 max-w-prose space-y-2 text-sm">
                    <li>
                      <strong className="text-ink">Accuracy:</strong> how often
                      the trader backed the winning side.
                    </li>
                    <li>
                      <strong className="text-ink">Consistency:</strong> the
                      score in a bad stretch, not a lucky one.
                    </li>
                    <li>
                      <strong className="text-ink">Sample size:</strong> more
                      calls earn more trust.
                    </li>
                  </ul>
                </div>
                <div className="space-y-3">
                  <h3 className="font-display text-base font-semibold">
                    Which calls count
                  </h3>
                  <SegmentedControl<ScoreMode>
                    label="Weighting"
                    value={scoreMode}
                    onChange={setScoreMode}
                    options={[
                      { value: "equal", label: "Equal weight", tone: "navy" },
                      {
                        value: "recency",
                        label: "Recent counts more",
                        tone: "navy",
                      },
                    ]}
                  />
                  <p className="text-ink/75 max-w-prose text-sm">
                    {recency
                      ? `Every ${halfLife} days, an older call counts half as much. The leaderboard above uses this.`
                      : "Every call counts once. The leaderboard above uses this."}
                    {recency && initialSnapshot.recencyWeighted.anchorAt
                      ? ` Newest call: ${formatDate(initialSnapshot.recencyWeighted.anchorAt)}.`
                      : ""}
                  </p>
                </div>
                <ul className="divide-line divide-y">
                  {board.map((entry) => (
                    <li
                      key={entry.participantId}
                      className="flex flex-col gap-0.5 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                    >
                      <span className="font-semibold break-words">
                        {removeEmDashes(entry.displayName)}
                      </span>
                      <span className="num text-ink/75">
                        Accuracy {entry.accuracy.toFixed(0)}%, 90% interval{" "}
                        {entry.credibleInterval.lowerBound.toFixed(0)} to{" "}
                        {entry.credibleInterval.upperBound.toFixed(0)}%
                      </span>
                    </li>
                  ))}
                </ul>
                <Disclosure summary="Technical details">
                  <p className="text-ink/80 max-w-prose text-sm leading-6">
                    Each call has an edge: the outcome (0 or 1) minus the
                    probability paid. The skill score shrinks the mean edge by
                    n/(n+10) and divides by the standard error, with a 0.05
                    floor. The track record bar is the Beta(1,1) posterior mean,
                    (correct + 1) / (total + 2). The 90% interval is the
                    equal-tail posterior interval, so small samples show wide
                    ranges. Profit rank uses conviction-weighted edge, not cash
                    returns.
                  </p>
                </Disclosure>
              </div>
            )}

            {tab === "confidence" && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-display text-xl font-bold tracking-tight">
                    Did confident calls come true?
                  </h3>
                  <p className="text-ink/75 mt-1 max-w-prose text-sm">
                    Each bar below is a group of calls with similar confidence.
                  </p>
                </div>
                <CalibrationTable buckets={calibration} weighted={recency} />
              </div>
            )}

            {tab === "benchmark" && (
              <PredictionCalibrationPanel
                initial={initialCalibration}
                mode={calibrationMode}
                operatorRequired={operatorRequired}
              />
            )}

            {tab === "records" && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-display text-xl font-bold tracking-tight">
                    Raw memory records
                  </h3>
                  <p className="text-ink/75 mt-1 max-w-prose text-sm">
                    {evidenceSnapshot.memories.length} recalled,{" "}
                    {evidenceSnapshot.records.length} readable.{" "}
                    {evidenceSnapshot.provider === "walrus"
                      ? "From Walrus Memory."
                      : "From the local demo memory."}{" "}
                    Updated {formatDateTime(evidenceSnapshot.generatedAt)}.
                  </p>
                </div>
                {selectedRecordId &&
                  !evidenceSnapshot.records.some(
                    (record) => record.recordId === selectedRecordId,
                  ) && (
                    <p
                      role="status"
                      className="border-line-strong rounded-xl border p-4 text-sm"
                    >
                      That record is not in the current results. Try a search
                      above.
                    </p>
                  )}
                {memories.length === 0 && (
                  <p className="border-line-strong text-ink/75 rounded-2xl border border-dashed p-8 text-center text-sm">
                    Nothing recalled. Resolve a market, or try a broader search.
                  </p>
                )}
                <div className="space-y-2">
                  {shownMemories.map((memory) => {
                    const id = recordIdOf(memory.text);
                    const parsed = id ? records.get(id) : undefined;
                    const displayText = removeEmDashes(memory.text);
                    return (
                      <div
                        key={`${memory.blobId}-${memory.createdAt}`}
                        id={id ? `memory-${id}` : undefined}
                        className="scroll-mt-28"
                      >
                        <Disclosure
                          defaultOpen={Boolean(id) && id === selectedRecordId}
                          summary={
                            <span className="block min-w-0">
                              <span className="text-ink/70 block text-xs font-normal">
                                {parsed ? humanize(parsed.kind) : "Memory"}
                                {memory.createdAt
                                  ? `, ${formatDateTime(memory.createdAt)}`
                                  : ""}
                              </span>
                              <span className="mt-1 line-clamp-2 block text-sm leading-5 font-medium break-words">
                                {parsed
                                  ? removeEmDashes(parsed.summary)
                                  : displayText
                                      .split("\n")
                                      .slice(0, 3)
                                      .join(" ")}
                              </span>
                            </span>
                          }
                        >
                          <div className="space-y-4">
                            <div className="text-ink/75 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                              <span className="inline-flex flex-wrap items-center gap-2">
                                blob{" "}
                                <CopyHash
                                  value={memory.blobId}
                                  label="blob id"
                                />
                              </span>
                              {id && (
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  record{" "}
                                  <CopyHash value={id} label="record id" />
                                </span>
                              )}
                            </div>
                            <pre className="num border-line bg-ground max-h-80 overflow-auto rounded-xl border p-4 text-xs leading-5 break-words whitespace-pre-wrap">
                              {displayText}
                            </pre>
                          </div>
                        </Disclosure>
                      </div>
                    );
                  })}
                </div>
                {!selectedRecordId && memories.length > visibleRecords && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setVisibleRecords((n) => n + RECORD_PAGE)}
                  >
                    Show more ({memories.length - visibleRecords} left)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
