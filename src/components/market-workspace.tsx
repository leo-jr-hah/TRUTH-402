"use client";

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Equal,
  Flag,
  Gavel,
  LoaderCircle,
  Lock,
  RotateCcw,
  TriangleAlert,
  Trophy,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useId, useMemo, useRef, useState } from "react";

import { HistoryChart, TradeFeed } from "@/components/market-activity";
import { LiveNum, pct0, rankedOutcomes } from "@/components/market-parts";
import {
  MobileActionBar,
  TradeSheet,
  TradeTicket,
  parseAmount,
} from "@/components/market-trade-ticket";
import { OperatorTokenField } from "@/components/operator-token-field";
import { OraclePanel } from "@/components/oracle-panel";
import { MarketStatusPill, MemoryStatusPill } from "@/components/status-pill";
import { burst } from "@/components/ui/burst";
import { CountUp } from "@/components/ui/count-up";
import { Disclosure } from "@/components/ui/disclosure";
import { Select } from "@/components/ui/select";
import {
  requestWalletConnect,
  useSuiWallet,
} from "@/components/wallet-connect";
import { formatWalletAddress } from "@/lib/sui-wallet";
import { formatCredits, formatDateTime, humanize } from "@/lib/format";
import { computeMemoryCalibratedSignal } from "@/lib/memory/credibility";
import { closingSignal } from "@/lib/memory/settlement";
import { removeEmDashes } from "@/lib/sanitize";
import type {
  Credibility,
  Market,
  MemoryCalibratedProbability,
  Trade,
} from "@/types/domain";

interface ApiFailure {
  error?: { message?: string };
}

type TabKey = "activity" | "report" | "details";
const TABS: { key: TabKey; label: string }[] = [
  { key: "activity", label: "Activity" },
  { key: "report", label: "Track record" },
  { key: "details", label: "Details" },
];

function firstLine(text: string): string {
  const clean = removeEmDashes(text).replace(/\s+/g, " ").trim();
  const match = clean.match(/^.*?[.!?](?=\s|$)/u);
  return (match ? match[0] : clean).slice(0, 160);
}

function gapWords(gap: number): string {
  if (gap > 0) return "Traders with good records lean higher.";
  if (gap < 0) return "Traders with good records lean lower.";
  return "Same view as the crowd.";
}

function Numbers({
  market,
  record,
  onOpenReport,
}: {
  market: Market;
  record: MemoryCalibratedProbability[] | null;
  onOpenReport: () => void;
}) {
  const leader = rankedOutcomes(market)[0];
  const crowd = Math.round(leader.price * 100);
  const row = record?.find((entry) => entry.outcomeId === leader.id);
  const track = row ? Math.round(row.oracleProbability * 100) : null;
  const gap = track === null ? 0 : track - crowd;
  return (
    <section aria-label="Crowd and track record" className="card p-3 sm:p-4">
      <p className="text-ink/75 text-xs">
        Chance of{" "}
        <span className="text-ink font-semibold">
          {removeEmDashes(leader.label)}
        </span>
      </p>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold">Crowd</p>
          <p className="display mt-1 flex text-xl">
            <CountUp value={crowd} suffix="%" />
          </p>
          <p className="text-ink/70 mt-1 text-xs">What the market price says</p>
        </div>
        <div>
          <p className="text-teal text-xs font-semibold">Track record</p>
          <p className="display text-teal mt-1 flex text-xl">
            {track === null ? (
              <span className="text-ink/45 inline-flex items-center gap-2">
                <Lock aria-hidden className="size-5" />
                <span className="sr-only">Locked</span>
              </span>
            ) : (
              <CountUp value={track} suffix="%" />
            )}
          </p>
          <p className="text-ink/70 mt-1 text-xs">
            Same bets, weighted by past accuracy
          </p>
        </div>
      </div>
      <div className="border-line mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
        {track === null ? (
          <button
            type="button"
            onClick={onOpenReport}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline"
          >
            Get the track-record report <ArrowRight size={14} aria-hidden />
          </button>
        ) : (
          <>
            <span className="bg-ice text-ink inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold">
              {gap > 0 ? (
                <ArrowUpRight size={15} aria-hidden />
              ) : gap < 0 ? (
                <ArrowDownRight size={15} aria-hidden />
              ) : (
                <Equal size={15} aria-hidden />
              )}
              <CountUp
                value={Math.abs(gap)}
                prefix={gap > 0 ? "+" : gap < 0 ? "-" : ""}
                suffix=" pts"
              />
            </span>
            <span className="text-ink/80 text-xs">{gapWords(gap)}</span>
          </>
        )}
      </div>
    </section>
  );
}

function OutcomeRows({
  market,
  record,
  selected,
  onPick,
}: {
  market: Market;
  record: MemoryCalibratedProbability[] | null;
  selected: string;
  onPick: (id: string) => void;
}) {
  const open = market.status === "open";
  const ranked = rankedOutcomes(market);
  return (
    <section aria-label="Outcomes">
      <ul className="space-y-2">
        {ranked.map((outcome) => {
          const row = record?.find((entry) => entry.outcomeId === outcome.id);
          const winner = market.winningOutcomeId === outcome.id;
          const on = open && selected === outcome.id;
          const body = (
            <>
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-bold [overflow-wrap:anywhere]">
                    {removeEmDashes(outcome.label)}
                    {winner && (
                      <Trophy
                        size={15}
                        aria-label="Winner"
                        className="shrink-0"
                      />
                    )}
                  </span>
                  {outcome.description && (
                    <span className="text-ink/70 mt-0.5 block text-xs [overflow-wrap:anywhere]">
                      {removeEmDashes(outcome.description)}
                      {outcome.submitter
                        ? ` (from ${removeEmDashes(outcome.submitter)})`
                        : ""}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {row && (
                    <span className="num text-teal text-xs font-semibold">
                      <span className="sr-only">Track record </span>
                      {Math.round(row.oracleProbability * 100)}%
                    </span>
                  )}
                  <LiveNum
                    value={outcome.price}
                    format={pct0}
                    className="text-xl font-bold"
                  />
                </span>
              </span>
              <span className="bg-ice/60 relative mt-2 block h-1.5 overflow-hidden rounded-full">
                <span
                  className="signal-bar bg-navy absolute inset-y-0 left-0 block rounded-full"
                  style={{ width: `${outcome.price * 100}%` }}
                  role="meter"
                  aria-label={`${removeEmDashes(outcome.label)} crowd price`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(outcome.price * 100)}
                />
                {row && (
                  <span
                    aria-hidden
                    className="bg-teal absolute inset-y-0 w-1 -translate-x-1/2 rounded-full"
                    style={{ left: `${row.oracleProbability * 100}%` }}
                  />
                )}
              </span>
            </>
          );
          return (
            <motion.li
              key={outcome.id}
              layout="position"
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              {open ? (
                <button
                  type="button"
                  onClick={() => onPick(outcome.id)}
                  aria-pressed={on}
                  className={`border-line block min-h-14 w-full rounded-xl border p-3 text-left transition-colors ${
                    on ? "bg-ice" : "bg-panel hover:bg-ice/40"
                  }`}
                >
                  {body}
                </button>
              ) : (
                <div className="border-line bg-panel rounded-xl border p-3">
                  {body}
                </div>
              )}
            </motion.li>
          );
        })}
      </ul>
      {record && (
        <p className="text-ink/70 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-navy h-1.5 w-5 rounded-full" /> Crowd
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-teal h-3 w-1 rounded-full" /> Track record
          </span>
        </p>
      )}
    </section>
  );
}

function ResolvedResult({ market }: { market: Market }) {
  const winner = market.outcomes.find((o) => o.id === market.winningOutcomeId);
  const { leader } = closingSignal(market.outcomes);
  const changes = (market.learningUpdate?.changes ?? [])
    .map((change) => ({
      change,
      move: change.before
        ? change.before.trustRank - change.after.trustRank
        : 0,
    }))
    .sort((a, b) => Math.abs(b.move) - Math.abs(a.move))
    .filter((entry) => entry.move !== 0)
    .slice(0, 3);
  const confirmed = market.memoryReceipts.filter(
    (r) => r.status === "confirmed",
  );
  const provider = confirmed.some((r) => r.provider === "walrus")
    ? "walrus"
    : confirmed[0]?.provider;
  return (
    <motion.section
      aria-label="Result"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="card p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <motion.span
            initial={{ scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: "spring",
              stiffness: 380,
              damping: 14,
              delay: 0.15,
            }}
            className="bg-navy text-fog grid size-10 shrink-0 place-items-center rounded-xl"
          >
            <Trophy size={22} aria-hidden />
          </motion.span>
          <div className="min-w-0">
            <p className="text-ink/75 text-xs">Winner</p>
            <h2 className="display text-xl [overflow-wrap:anywhere]">
              {removeEmDashes(winner?.label ?? "The outcome")}
            </h2>
          </div>
        </div>
        <MemoryStatusPill status={market.memoryStatus} provider={provider} />
      </div>
      {market.resolutionNote && (
        <p className="text-ink/80 mt-3 max-w-[60ch] text-sm">
          {removeEmDashes(market.resolutionNote)}
        </p>
      )}
      <p className="text-ink/75 mt-3 text-sm">
        The crowd favored {removeEmDashes(leader.label)} at {pct0(leader.price)}
        {market.resolvedAt
          ? `. Closed ${formatDateTime(market.resolvedAt)}.`
          : "."}
      </p>
      {changes.length > 0 && (
        <div className="border-line mt-3 border-t pt-3">
          <h3 className="text-sm font-bold">What changed for traders</h3>
          <ul className="mt-2 space-y-1.5">
            {changes.map(({ change, move }) => (
              <li
                key={change.participantId}
                className="flex flex-wrap items-center justify-between gap-x-4 text-sm"
              >
                <span className="font-semibold">
                  {removeEmDashes(change.displayName)}
                </span>
                <span className="num text-ink/80 inline-flex items-center gap-1.5">
                  Accuracy rank{" "}
                  {change.before ? `#${change.before.trustRank}` : "new"}
                  <ArrowRight size={12} aria-hidden />
                  <span className="text-teal font-semibold">
                    #{change.after.trustRank}
                  </span>
                  {move !== 0 && (
                    <span className="inline-flex items-center text-xs">
                      {move > 0 ? (
                        <ArrowUpRight size={12} aria-hidden />
                      ) : (
                        <ArrowDownRight size={12} aria-hidden />
                      )}
                      {move > 0 ? "+" : "-"}
                      {Math.abs(move)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.section>
  );
}

export function MarketWorkspace({
  initialMarket,
  paymentMode,
  commitMode,
  trustWeights = null,
  operatorRequired = commitMode === "live",
  sandboxEnabled = false,
}: {
  initialMarket: Market;
  paymentMode: "demo" | "live";
  commitMode: "demo" | "live";
  /** participantId to accuracy weight, or null when the view is unavailable. */
  trustWeights?: Record<string, number> | null;
  operatorRequired?: boolean;
  sandboxEnabled?: boolean;
}) {
  const [market, setMarket] = useState(initialMarket);
  const [tab, setTab] = useState<TabKey>("activity");
  const [operatorToken, setOperatorToken] = useState("");
  const ranked = useMemo(() => rankedOutcomes(market), [market]);
  const [selectedOutcome, setSelectedOutcome] = useState(
    ranked[0]?.id ?? market.outcomes[0]?.id ?? "",
  );
  const [amountText, setAmountText] = useState("50");
  const { connected } = useSuiWallet();
  const [customName, setDisplayName] = useState<string | null>(null);
  const displayName =
    customName ??
    (connected ? formatWalletAddress(connected.address) : "Calibrated Trader");
  const [tradePending, setTradePending] = useState(false);
  const [tradeMessage, setTradeMessage] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const tabsId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [winningOutcomeId, setWinningOutcomeId] = useState(
    market.winningOutcomeId ?? ranked[0]?.id ?? "",
  );
  const [resolutionNote, setResolutionNote] = useState(
    removeEmDashes(market.resolutionNote ?? ""),
  );
  const [confirmResolution, setConfirmResolution] = useState(false);
  const [resolvePending, setResolvePending] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const record = useMemo(() => {
    if (!trustWeights || market.status !== "open") return null;
    try {
      const board = Object.entries(trustWeights).map(
        ([participantId, shrinkageSkillScore]) =>
          ({ participantId, shrinkageSkillScore }) as Credibility,
      );
      return computeMemoryCalibratedSignal(market, board);
    } catch {
      return null;
    }
  }, [market, trustWeights]);

  const participants = new Set(market.trades.map((t) => t.participantId)).size;
  const open = market.status === "open";
  const selected = market.outcomes.find((o) => o.id === selectedOutcome);

  async function placeTrade(origin: HTMLElement | null) {
    const amount = parseAmount(amountText);
    setTradePending(true);
    setTradeError(null);
    setTradeMessage(null);
    try {
      if (connected?.kind !== "wallet") {
        requestWalletConnect();
        return;
      }

      const response = await fetch(`/api/markets/${market.id}/trade`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(operatorToken
            ? { authorization: `Bearer ${operatorToken}` }
            : {}),
        },
        body: JSON.stringify({
          outcomeId: selectedOutcome,
          amount,
          displayName: displayName.trim(),
          participantId: connected.address,
          role: "trader",
        }),
      });
      const payload = (await response.json()) as
        { market: Market; trade: Trade } | ApiFailure;
      if (!response.ok || !("market" in payload)) {
        const message = "error" in payload ? payload.error?.message : undefined;
        throw new Error(message || "The trade could not be recorded.");
      }
      setMarket(payload.market);
      const chosen = payload.market.outcomes.find(
        (o) => o.id === selectedOutcome,
      );
      setTradeMessage(
        `Bought ${removeEmDashes(chosen?.label ?? "the outcome")} for $${formatCredits(amount)}. It is now at ${pct0(chosen?.price ?? 0)}.`,
      );
      setRecorded(true);
      window.setTimeout(() => setRecorded(false), 2200);
      if (origin) burst(origin, "lime");
    } catch (caught) {
      setTradeError(
        caught instanceof Error
          ? removeEmDashes(caught.message)
          : "The trade could not be recorded.",
      );
    } finally {
      setTradePending(false);
      setOperatorToken("");
    }
  }

  async function resolve(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setResolvePending(true);
    setResolveError(null);
    try {
      const response = await fetch(`/api/markets/${market.id}/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(operatorToken
            ? { authorization: `Bearer ${operatorToken}` }
            : {}),
        },
        body: JSON.stringify({
          winningOutcomeId:
            market.status === "resolved"
              ? market.winningOutcomeId
              : winningOutcomeId,
          resolutionNote:
            market.status === "resolved"
              ? market.resolutionNote
              : resolutionNote,
        }),
      });
      const payload = (await response.json()) as {
        market?: Market;
      } & ApiFailure;
      if (!response.ok || !payload.market) {
        throw new Error(
          payload.error?.message || "The market could not be resolved.",
        );
      }
      setMarket(payload.market);
      setWinningOutcomeId(payload.market.winningOutcomeId ?? "");
      setResolutionNote(removeEmDashes(payload.market.resolutionNote ?? ""));
      setConfirmResolution(false);
      setSheetOpen(false);
      burst(
        { x: window.innerWidth / 2, y: window.innerHeight / 3 },
        "lime",
        48,
      );
    } catch (caught) {
      setResolveError(
        caught instanceof Error
          ? removeEmDashes(caught.message)
          : "The market could not be resolved.",
      );
    } finally {
      setResolvePending(false);
      setOperatorToken("");
    }
  }

  function pickFromBar(id: string) {
    setSelectedOutcome(id);
    setTradeMessage(null);
    setTradeError(null);
    setSheetOpen(true);
  }
  function pickFromRow(id: string) {
    setSelectedOutcome(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setTradeMessage(null);
      setTradeError(null);
      setSheetOpen(true);
    }
  }

  function onTabKey(event: React.KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].key);
    tabRefs.current[TABS[next].key]?.focus();
  }

  const ticketProps = {
    market,
    walletConnected: connected?.kind === "wallet",
    selectedOutcome,
    onSelect: (id: string) => {
      setSelectedOutcome(id);
      setTradeMessage(null);
      setTradeError(null);
    },
    amountText,
    onAmount: setAmountText,
    displayName,
    onName: setDisplayName,
    commitMode,
    operatorRequired,
    operatorToken,
    onToken: setOperatorToken,
    pending: tradePending,
    recorded,
    message: tradeMessage,
    error: tradeError,
    onSubmit: (origin: HTMLElement | null) => void placeTrade(origin),
  };

  const learning = market.learningUpdate;

  return (
    <div
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] ${
        open ? "pb-24 lg:pb-0" : ""
      }`}
    >
      <header className="card min-w-0 flex-1 space-y-2 p-3 sm:p-4 lg:col-start-1 lg:row-start-1">
        <div className="text-ink/75 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <MarketStatusPill status={market.status} />
          <span className="num">
            <LiveNum
              value={market.totalVolume}
              format={(n) => `${formatCredits(n)} credits`}
              flash={false}
            />
          </span>
          <span className="num">
            {participants} {participants === 1 ? "trader" : "traders"}
          </span>
        </div>
        <h1 className="font-display max-w-4xl text-xl leading-tight font-[650] tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">
          {removeEmDashes(market.title)}
        </h1>
        {market.description && (
          <p className="text-ink/75 max-w-[62ch] text-sm [overflow-wrap:anywhere]">
            {firstLine(market.description)}
          </p>
        )}
      </header>

      <aside
        aria-label="Trade"
        className="flex w-full min-w-0 shrink-0 flex-col gap-4 self-start lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:w-[360px]"
      >
        {open ? (
          <section className="card p-3 sm:p-4">
            <h2 className="mb-3 text-base font-bold">Buy</h2>
            <TradeTicket {...ticketProps} />
          </section>
        ) : (
          <section className="card p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <span className="bg-navy text-fog grid size-9 place-items-center rounded-xl">
                <Flag size={19} aria-hidden />
              </span>
              <div>
                <p className="text-base font-bold">Trading is closed</p>
                <p className="text-ink/75 text-sm">
                  The sponsor has made the call.
                </p>
              </div>
            </div>
          </section>
        )}
        <div className="min-w-0 lg:order-first lg:max-h-56 lg:overflow-y-auto">
          <OutcomeRows
            market={market}
            record={record}
            selected={selectedOutcome}
            onPick={pickFromRow}
          />
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-4 lg:col-start-1 lg:row-start-2">
        {market.status === "resolved" ? (
          <ResolvedResult market={market} />
        ) : (
          <Numbers
            market={market}
            record={record}
            onOpenReport={() => setTab("report")}
          />
        )}

        <div className="card min-w-0 p-3 sm:p-4">
          <div
            role="tablist"
            aria-label="Market sections"
            className="border-line flex gap-1 border-b"
          >
            {TABS.map((item, index) => {
              const on = tab === item.key;
              return (
                <button
                  key={item.key}
                  ref={(node) => {
                    tabRefs.current[item.key] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`${tabsId}-tab-${item.key}`}
                  aria-selected={on}
                  aria-controls={`${tabsId}-panel-${item.key}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setTab(item.key)}
                  onKeyDown={(event) => onTabKey(event, index)}
                  className={`relative min-h-11 px-3 text-sm font-semibold transition-colors ${
                    on ? "text-ink" : "text-ink/65 hover:text-ink"
                  }`}
                >
                  {item.label}
                  {on && (
                    <motion.span
                      layoutId={`${tabsId}-underline`}
                      className="bg-navy absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                      transition={{
                        type: "spring",
                        stiffness: 480,
                        damping: 36,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`${tabsId}-panel-activity`}
            aria-labelledby={`${tabsId}-tab-activity`}
            hidden={tab !== "activity"}
            className="space-y-4 pt-3"
          >
            <section aria-labelledby={`${tabsId}-hist`}>
              <h2
                id={`${tabsId}-hist`}
                className="mb-2 text-base font-bold tracking-[-0.02em]"
              >
                Price history
              </h2>
              <HistoryChart market={market} />
            </section>
            <section aria-labelledby={`${tabsId}-feed`}>
              <h2
                id={`${tabsId}-feed`}
                className="mb-2 flex items-baseline justify-between gap-3 text-base font-bold tracking-[-0.02em]"
              >
                Recent trades
                <span className="num text-ink/70 text-sm font-normal">
                  {market.trades.length}
                </span>
              </h2>
              <TradeFeed market={market} />
            </section>
          </div>

          <div
            role="tabpanel"
            id={`${tabsId}-panel-report`}
            aria-labelledby={`${tabsId}-tab-report`}
            hidden={tab !== "report"}
            className="pt-3"
          >
            <OraclePanel
              key={`${market.id}:${market.updatedAt}`}
              market={market}
              paymentMode={paymentMode}
              commitMode={commitMode}
              operatorRequired={operatorRequired}
              sandboxEnabled={sandboxEnabled}
            />
          </div>

          <div
            role="tabpanel"
            id={`${tabsId}-panel-details`}
            aria-labelledby={`${tabsId}-tab-details`}
            hidden={tab !== "details"}
            className="space-y-4 pt-3"
          >
            <section>
              <h2 className="text-base font-bold tracking-[-0.02em]">
                About this market
              </h2>
              <p className="text-ink/80 mt-2 max-w-[66ch] text-sm leading-5 [overflow-wrap:anywhere]">
                {removeEmDashes(market.description)}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-ink/70 text-xs">Format</dt>
                  <dd className="font-medium">
                    {market.type === "simple" ? "Pick one" : "Ranked options"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/70 text-xs">Opened</dt>
                  <dd className="font-medium">
                    {formatDateTime(market.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/70 text-xs">Sponsor</dt>
                  <dd className="font-medium [overflow-wrap:anywhere]">
                    {removeEmDashes(market.sponsor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink/70 text-xs">Liquidity</dt>
                  <dd className="num font-medium">b = {market.liquidity}</dd>
                </div>
              </dl>
              {market.tags.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {market.tags.map((tag) => (
                    <li
                      key={tag}
                      className="border-line bg-ice/40 text-ink/75 rounded-full border px-2.5 py-1 text-xs font-medium [overflow-wrap:anywhere]"
                    >
                      {removeEmDashes(tag)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-ink/75 mt-3 text-sm">
                The sponsor makes the final call. Trader prices are evidence,
                not a vote. Credits are simulated.
              </p>
            </section>

            {learning && (
              <section>
                <h2 className="text-base font-bold tracking-[-0.02em]">
                  Who moved after the result
                </h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead>
                      <tr className="border-line text-ink/70 border-b text-xs">
                        <th className="pb-2 font-medium">Trader</th>
                        <th className="pb-2 font-medium">Profit rank</th>
                        <th className="text-teal pb-2 font-medium">
                          Accuracy rank
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {learning.changes.map((change) => (
                        <tr
                          key={change.participantId}
                          className="border-line border-b"
                        >
                          <td className="py-2.5 pr-3 font-semibold">
                            {removeEmDashes(change.displayName)}
                          </td>
                          <td className="num">
                            {change.before
                              ? `#${change.before.profitRank}`
                              : "New"}
                            <ArrowRight
                              size={11}
                              className="mx-1 inline"
                              aria-hidden
                            />
                            #{change.after.profitRank}
                          </td>
                          <td className="num text-teal">
                            {change.before
                              ? `#${change.before.trustRank}`
                              : "New"}
                            <ArrowRight
                              size={11}
                              className="mx-1 inline"
                              aria-hidden
                            />
                            #{change.after.trustRank}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {market.status === "resolved" &&
              market.memoryReceipts.length > 0 && (
                <section>
                  <h2 className="text-base font-bold tracking-[-0.02em]">
                    Saved records
                  </h2>
                  <Disclosure
                    className="mt-3"
                    summary={`${market.memoryReceipts.length} receipts`}
                  >
                    <ul className="space-y-2">
                      {market.memoryReceipts.map((receipt) => (
                        <li
                          key={`${receipt.provider}:${receipt.recordId}`}
                          className="border-line flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-semibold">
                              {receipt.recordId}
                            </p>
                            <p className="text-ink/70 text-xs">
                              {humanize(receipt.kind)}
                            </p>
                            {receipt.blobId && (
                              <Link
                                href={`/insights?record=${encodeURIComponent(receipt.recordId)}`}
                                className="mt-1 block truncate font-mono text-xs underline"
                              >
                                Inspect {receipt.blobId}
                              </Link>
                            )}
                          </div>
                          <MemoryStatusPill
                            status={receipt.status}
                            provider={receipt.provider}
                          />
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                  {market.memoryStatus === "failed" && (
                    <div className="border-line bg-ice/40 mt-3 rounded-xl border p-3">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <TriangleAlert size={16} aria-hidden /> Some records did
                        not save
                      </p>
                      <p className="text-ink/80 mt-1 text-sm">
                        The result is safe. Retrying only redoes the missing
                        saves.
                      </p>
                      {resolveError && (
                        <p role="alert" className="mt-2 text-sm">
                          {resolveError}
                        </p>
                      )}
                      <button
                        type="button"
                        className="button-secondary mt-3"
                        disabled={resolvePending}
                        onClick={() => void resolve()}
                      >
                        <RotateCcw
                          size={15}
                          className={resolvePending ? "animate-spin" : ""}
                          aria-hidden
                        />
                        {resolvePending ? "Retrying" : "Retry saving"}
                      </button>
                    </div>
                  )}
                </section>
              )}

            {open && (
              <section>
                <Disclosure summary="Resolve market" className="max-w-xl">
                  <div className="space-y-4">
                    <p className="text-ink/80 text-sm">
                      For the sponsor only. This ends trading for everyone.
                    </p>
                    <AnimatePresence mode="wait" initial={false}>
                      {!confirmResolution ? (
                        <motion.div
                          key="edit"
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -12 }}
                          className="space-y-4"
                        >
                          <div>
                            <span className="field-label">Who won</span>
                            <Select
                              label="Winning outcome"
                              value={winningOutcomeId}
                              onChange={setWinningOutcomeId}
                              options={ranked.map((outcome) => ({
                                value: outcome.id,
                                label: removeEmDashes(outcome.label),
                                hint: `Crowd said ${pct0(outcome.price)}`,
                              }))}
                            />
                          </div>
                          <label className="block">
                            <span className="field-label">Why this one</span>
                            <textarea
                              className="textarea min-h-24"
                              required
                              minLength={5}
                              maxLength={1000}
                              value={resolutionNote}
                              onChange={(event) =>
                                setResolutionNote(
                                  removeEmDashes(event.target.value),
                                )
                              }
                              placeholder="One or two sentences on the result"
                            />
                          </label>
                          <button
                            type="button"
                            className="button-secondary"
                            disabled={
                              resolutionNote.trim().length < 5 ||
                              !winningOutcomeId
                            }
                            onClick={() => setConfirmResolution(true)}
                          >
                            Review <ArrowRight size={15} aria-hidden />
                          </button>
                        </motion.div>
                      ) : (
                        <motion.form
                          key="review"
                          onSubmit={resolve}
                          initial={{ opacity: 0, x: 12 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 12 }}
                          className="border-line space-y-3 rounded-xl border p-4"
                        >
                          <p className="flex items-center gap-2 text-sm font-semibold">
                            <TriangleAlert size={16} aria-hidden /> This cannot
                            be undone
                          </p>
                          <p className="display text-xl [overflow-wrap:anywhere]">
                            {removeEmDashes(
                              market.outcomes.find(
                                (o) => o.id === winningOutcomeId,
                              )?.label ?? "Outcome",
                            )}{" "}
                            wins
                          </p>
                          <p className="text-ink/80 text-sm [overflow-wrap:anywhere]">
                            {removeEmDashes(resolutionNote)}
                          </p>
                          {operatorRequired && (
                            <OperatorTokenField
                              value={operatorToken}
                              onChange={setOperatorToken}
                            />
                          )}
                          {resolveError && (
                            <p role="alert" className="text-sm font-medium">
                              {resolveError}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => setConfirmResolution(false)}
                              disabled={resolvePending}
                            >
                              Go back
                            </button>
                            <button
                              type="submit"
                              className="button-primary"
                              disabled={
                                resolvePending ||
                                (operatorRequired && !operatorToken)
                              }
                            >
                              {resolvePending ? (
                                <>
                                  <LoaderCircle
                                    size={16}
                                    className="animate-spin"
                                  />{" "}
                                  Closing
                                </>
                              ) : (
                                <>
                                  <Gavel size={16} aria-hidden /> Confirm
                                </>
                              )}
                            </button>
                          </div>
                        </motion.form>
                      )}
                    </AnimatePresence>
                    {resolveError && !confirmResolution && (
                      <p role="alert" className="text-sm font-medium">
                        {resolveError}
                      </p>
                    )}
                  </div>
                </Disclosure>
              </section>
            )}
          </div>
        </div>
      </div>

      {open && selected && (
        <>
          <MobileActionBar
            market={market}
            selectedOutcome={selectedOutcome}
            onPick={pickFromBar}
          />
          <TradeSheet
            open={sheetOpen}
            onClose={closeSheet}
            title={removeEmDashes(market.title)}
          >
            <TradeTicket {...ticketProps} />
          </TradeSheet>
        </>
      )}
    </div>
  );
}
