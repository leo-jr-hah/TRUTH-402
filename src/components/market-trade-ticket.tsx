"use client";

import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { LiveNum, pct0 } from "@/components/market-parts";
import { OperatorTokenField } from "@/components/operator-token-field";
import { formatCredits } from "@/lib/format";
import { applyBuy } from "@/lib/market-maker";
import { removeEmDashes } from "@/lib/sanitize";
import type { Market } from "@/types/domain";

const noop = () => () => {};

/** Renders into document.body so a filtered or transformed ancestor cannot trap fixed layers. */
function BodyPortal({ children }: { children: React.ReactNode }) {
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return ready ? createPortal(children, document.body) : null;
}

export const CHIPS = [5, 25, 100, 500];
export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 10000;

export function parseAmount(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/u.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export function amountProblem(text: string): string | null {
  if (!text.trim()) return "Enter an amount.";
  const n = parseAmount(text);
  if (!Number.isFinite(n)) return "Use numbers only, like 50.";
  if (n < MIN_AMOUNT) return "The smallest trade is $1.";
  if (n > MAX_AMOUNT) return "The largest trade is $10,000.";
  return null;
}

export interface TicketProps {
  market: Market;
  selectedOutcome: string;
  onSelect: (id: string) => void;
  amountText: string;
  onAmount: (text: string) => void;
  displayName: string;
  onName: (name: string) => void;
  commitMode: "demo" | "live";
  walletConnected?: boolean;
  operatorRequired?: boolean;
  operatorToken: string;
  onToken: (value: string) => void;
  pending: boolean;
  recorded: boolean;
  message: string | null;
  error: string | null;
  onSubmit: (origin: HTMLElement | null) => void;
}

/** The whole trade in one small card: pick, amount, preview, one Buy button. */
export function TradeTicket(props: TicketProps) {
  const {
    market,
    selectedOutcome,
    onSelect,
    amountText,
    onAmount,
    displayName,
    onName,
    commitMode,
    walletConnected = true,
    operatorRequired = commitMode === "live",
    operatorToken,
    onToken,
    pending,
    recorded,
    message,
    error,
    onSubmit,
  } = props;
  const uid = useId();
  const buyRef = useRef<HTMLButtonElement>(null);
  const selected = market.outcomes.find((o) => o.id === selectedOutcome);
  const problem = amountProblem(amountText);
  const amount = parseAmount(amountText);
  const nameOk = displayName.trim().length >= 2;
  const needsToken = operatorRequired && !operatorToken;
  const impact = useMemo(() => {
    if (problem || !selected) return null;
    try {
      return applyBuy(
        market.outcomes,
        selectedOutcome,
        amount,
        market.liquidity,
      );
    } catch {
      return null;
    }
  }, [problem, selected, market, selectedOutcome, amount]);
  const many = market.outcomes.length > 3;
  const label = removeEmDashes(selected?.label ?? "outcome");

  return (
    <form
      className="text-ink flex w-full min-w-0 flex-col gap-3 lg:max-h-[480px]"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!problem && nameOk && !needsToken && !pending)
          onSubmit(buyRef.current);
      }}
    >
      <div className="min-h-0 min-w-0 space-y-3 lg:overflow-y-auto lg:overscroll-contain">
        <fieldset className="min-w-0">
          <legend className="text-ink/75 mb-1.5 text-xs font-semibold">
            Pick an outcome
          </legend>
          <div
            role="radiogroup"
            aria-label="Pick an outcome"
            className={`border-line divide-line grid grid-cols-1 divide-y rounded-lg border ${
              many
                ? "max-h-44 overflow-y-auto overscroll-contain lg:max-h-40"
                : "overflow-hidden"
            }`}
          >
            {market.outcomes.map((outcome) => {
              const on = selectedOutcome === outcome.id;
              return (
                <button
                  key={outcome.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onSelect(outcome.id)}
                  className={`focus-visible:outline-teal relative flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 lg:min-h-0 ${
                    on ? "text-ink" : "text-ink/75 hover:bg-ice/40"
                  }`}
                >
                  {on && (
                    <motion.span
                      layoutId={`pick-${uid}`}
                      className="bg-ice/60 absolute inset-0"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 34,
                      }}
                    />
                  )}
                  <span className="relative flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      {removeEmDashes(outcome.label)}
                    </span>
                    {on && (
                      <Check
                        size={15}
                        className="text-teal shrink-0"
                        aria-hidden
                      />
                    )}
                  </span>
                  <LiveNum
                    value={outcome.price}
                    format={(n) => `${(n * 100).toFixed(0)}¢`}
                    className="num relative w-12 shrink-0 text-right text-sm font-semibold"
                  />
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label
            htmlFor={`${uid}-amount`}
            className="text-ink/75 mb-1.5 block text-xs font-semibold"
          >
            Amount ($)
          </label>
          <div className="relative">
            <input
              id={`${uid}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={`num border-line text-ink focus-visible:outline-teal h-11 w-full min-w-0 rounded-lg border pr-3 pl-7 text-base font-semibold outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 lg:h-10 ${
                problem ? "bg-ice/40" : "bg-ground"
              }`}
              value={amountText}
              onChange={(event) => onAmount(event.target.value)}
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? `${uid}-amount-err` : undefined}
            />
            <span className="text-ink/60 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs">
              $
            </span>
          </div>
          {problem && (
            <p
              id={`${uid}-amount-err`}
              role="alert"
              className="text-ink/75 mt-1 text-xs font-medium"
            >
              {problem}
            </p>
          )}
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {CHIPS.map((value) => (
              <motion.button
                key={value}
                type="button"
                whileTap={{ scale: 0.94 }}
                className={`num border-line focus-visible:outline-teal min-h-11 rounded-md border px-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 lg:min-h-7 ${
                  !problem && amount === value
                    ? "bg-navy text-fog"
                    : "bg-ground text-ink hover:bg-ice/60"
                }`}
                onClick={() => onAmount(String(value))}
                aria-pressed={!problem && amount === value}
              >
                ${value}
              </motion.button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <span className="text-ink/75 shrink-0 text-xs font-semibold">
            Trading as
          </span>
          <input
            className="border-line bg-ground text-ink focus-visible:outline-teal h-10 min-w-0 flex-1 rounded-md border px-2.5 text-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 lg:h-8"
            required
            minLength={2}
            maxLength={80}
            value={displayName}
            onChange={(event) => onName(removeEmDashes(event.target.value))}
            autoComplete="name"
            aria-label="Your name"
            aria-invalid={!nameOk}
          />
        </label>

        {operatorRequired && (
          <OperatorTokenField value={operatorToken} onChange={onToken} />
        )}

        <AnimatePresence initial={false}>
          {error && (
            <motion.div
              key="err"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              role="alert"
              className="border-line bg-ground text-ink flex gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-xs [overflow-wrap:anywhere]"
            >
              <TriangleAlert
                size={16}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              {error}
            </motion.div>
          )}
          {message && !error && (
            <motion.div
              key="ok"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              role="status"
              className="border-line bg-ice/50 text-ink flex gap-2 overflow-hidden rounded-lg border px-2.5 py-2 text-xs [overflow-wrap:anywhere]"
            >
              <Check
                size={16}
                className="text-teal mt-0.5 shrink-0"
                aria-hidden
              />
              {message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="border-line shrink-0 space-y-2 border-t pt-2.5">
        <div className="min-w-0" aria-live="polite">
          {impact && selected ? (
            <dl className="flex items-baseline justify-between gap-2 text-xs whitespace-nowrap">
              <div className="flex min-w-0 items-baseline gap-1">
                <dt className="text-ink/65 shrink-0">Shares</dt>
                <dd className="num min-w-0 truncate font-semibold">
                  <LiveNum
                    value={impact.shares}
                    format={(n) => n.toFixed(1)}
                    flash={false}
                  />
                </dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-1">
                <dt className="text-ink/65 shrink-0">Avg price</dt>
                <dd className="num min-w-0 truncate font-semibold">
                  <LiveNum
                    value={amount / impact.shares}
                    format={(n) => `${(n * 100).toFixed(1)}¢`}
                    flash={false}
                  />
                </dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-1">
                <dt className="text-ink/65 shrink-0" title="Pays if it wins">
                  Payout
                </dt>
                <dd className="num min-w-0 truncate font-semibold">
                  <LiveNum
                    value={impact.shares}
                    format={(n) => `$${formatCredits(n)}`}
                    flash={false}
                  />
                </dd>
              </div>
            </dl>
          ) : (
            <div className="text-ink/60 flex justify-between gap-2 text-xs whitespace-nowrap">
              <span>Shares -</span>
              <span>Avg price -</span>
              <span>Payout -</span>
            </div>
          )}
        </div>

        {!walletConnected && (
          <p className="text-ink/65 text-xs">
            Wallet required. Use Connect wallet in the top bar.
          </p>
        )}

        <button
          ref={buyRef}
          type="submit"
          className="bg-navy text-fog hover:bg-navy/90 focus-visible:outline-teal inline-flex h-11 w-full min-w-0 items-center justify-center overflow-hidden rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:h-10"
          disabled={pending || Boolean(problem) || !nameOk || needsToken}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={pending ? "p" : recorded ? "r" : "i"}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="inline-flex max-w-full min-w-0 items-center justify-center gap-2"
            >
              {!walletConnected ? (
                <span className="truncate">Connect wallet to trade</span>
              ) : pending ? (
                <>
                  <LoaderCircle size={17} className="animate-spin" /> Buying
                </>
              ) : recorded ? (
                <>
                  <Check size={17} /> Bought
                </>
              ) : (
                <>
                  <span className="truncate">Buy {label}</span>
                  {!problem && (
                    <span className="num shrink-0 font-normal opacity-80">
                      {" "}
                      for ${formatCredits(amount)}
                    </span>
                  )}
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </form>
  );
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Bottom sheet: traps focus, closes on Escape or backdrop, restores scroll. */
export function TradeSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const opener = document.activeElement as HTMLElement | null;
    body.style.overflow = "hidden";
    panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = [
        ...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((node) => node.offsetParent !== null || node === panel.current);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.current.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onWide = () => {
      if (desktop.matches) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onWide);
      body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  return (
    <BodyPortal>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[60] lg:hidden">
            <motion.div
              className="bg-navy/45 absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              data-testid="sheet-backdrop"
            />
            <motion.div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="border-line bg-panel absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-3xl border px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-soft)] outline-none"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h2
                  id={titleId}
                  className="text-lg leading-snug font-bold text-balance [overflow-wrap:anywhere]"
                >
                  {title}
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="border-line text-ink hover:bg-ice/60 grid size-11 shrink-0 place-items-center rounded-full border"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>
              {children}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </BodyPortal>
  );
}

/** Fixed bar on small screens: the outcomes and prices are the tap targets. */
export function MobileActionBar({
  market,
  selectedOutcome,
  onPick,
}: {
  market: Market;
  selectedOutcome: string;
  onPick: (id: string) => void;
}) {
  const two = market.outcomes.length === 2;
  const selected = market.outcomes.find((o) => o.id === selectedOutcome);
  const targets = two ? market.outcomes : selected ? [selected] : [];
  return (
    <BodyPortal>
      <div
        className="border-line bg-panel/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
        data-testid="mobile-action-bar"
      >
        <div className="mx-auto flex max-w-xl gap-3">
          {targets.map((outcome, i) => (
            <button
              key={outcome.id}
              type="button"
              onClick={() => onPick(outcome.id)}
              className={`flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 rounded-full px-5 text-sm font-bold transition-transform active:scale-[0.97] ${
                two && i === 1
                  ? "border-line text-ink border"
                  : "bg-navy text-fog"
              }`}
            >
              <span className="truncate">
                {two ? "" : "Trade "}
                {removeEmDashes(outcome.label)}
              </span>
              <span className="num">{pct0(outcome.price)}</span>
            </button>
          ))}
        </div>
      </div>
    </BodyPortal>
  );
}
