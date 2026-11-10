"use client";

import { ArrowDown, ArrowUp, Bot, Check, FileText, X } from "lucide-react";
import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
} from "motion/react";
import { useEffect, useState } from "react";

const EASE = [0.16, 1, 0.3, 1] as const;

type Wallet = {
  name: string;
  side: "Yes" | "No";
  stake: number;
  /** record before the market ends: [right, total] */
  before: [number, number];
  /** next market bet */
  next: { side: "Yes" | "No"; stake: number };
};

/** The market in the story ends with the answer Yes. */
const RESULT: "Yes" | "No" = "Yes";

const WALLETS: Wallet[] = [
  {
    name: "Ada",
    side: "Yes",
    stake: 25,
    before: [6, 8],
    next: { side: "Yes", stake: 20 },
  },
  {
    name: "Bo",
    side: "No",
    stake: 40,
    before: [3, 9],
    next: { side: "No", stake: 40 },
  },
  {
    name: "Cy",
    side: "Yes",
    stake: 15,
    before: [5, 7],
    next: { side: "Yes", stake: 15 },
  },
  {
    name: "Di",
    side: "No",
    stake: 10,
    before: [4, 9],
    next: { side: "No", stake: 10 },
  },
  {
    name: "Eli",
    side: "Yes",
    stake: 20,
    before: [5, 8],
    next: { side: "Yes", stake: 25 },
  },
];

function after(w: Wallet): [number, number] {
  const ok = w.side === RESULT;
  return [w.before[0] + (ok ? 1 : 0), w.before[1] + 1];
}
function score(w: Wallet) {
  const [r, t] = after(w);
  return Math.round((r / t) * 100);
}
/** bubble diameter in px (mobile scale, multiplied by --k on wide screens) */
function bubble(w: Wallet, grown: boolean) {
  return grown ? Math.round(20 + score(w) * 0.46) : 44;
}

export const CROWD = 60;
export const TRACK = 66;

/** Plays a timer once per key; true immediately with reduced motion. */
function useAfter(ms: number, key: unknown) {
  const reduce = useReducedMotion();
  const [state, setState] = useState<{ key: unknown; on: boolean }>({
    key,
    on: false,
  });
  useEffect(() => {
    const t = setTimeout(() => setState({ key, on: true }), reduce ? 0 : ms);
    return () => clearTimeout(t);
  }, [ms, key, reduce]);
  return state.on && state.key === key;
}

function useTween(from: number, to: number, delay: number, key: unknown) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(from);
  useEffect(() => {
    const c = animate(from, to, {
      delay: reduce ? 0 : delay,
      duration: reduce ? 0 : 1.8,
      ease: EASE,
      onUpdate: setV,
    });
    return () => c.stop();
  }, [from, to, delay, key, reduce]);
  return v;
}

/* ---------------- market card (top) ---------------- */

function MarketCard({ step }: { step: number }) {
  const crowd = useTween(50, CROWD, 0.5, step === 1 ? "s1" : "x");
  const ended = step === 2 || step === 3;
  return (
    <div className="border-line bg-ground flex min-h-[84px] items-center justify-between gap-3 rounded-2xl border px-4 py-3">
      <div className="min-w-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={step === 4 ? "m2" : "m1"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="truncate text-base font-semibold tracking-tight sm:text-lg"
          >
            {step === 4 ? "Will Ridge win?" : "Will Harbor win?"}
          </motion.p>
        </AnimatePresence>
        <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs opacity-70">
          {ended ? (
            "Ended"
          ) : (
            <>
              <span className="live-dot" aria-hidden="true" />
              Open
            </>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <AnimatePresence mode="wait" initial={false}>
          {step === 1 && (
            <motion.div
              key="crowd"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <p className="text-xs font-semibold opacity-70">Crowd</p>
              <p className="num text-3xl leading-none font-bold tracking-tight">
                {Math.round(crowd)}%
              </p>
            </motion.div>
          )}
          {ended && (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: EASE, delay: 0.1 }}
            >
              <p className="text-xs font-semibold opacity-70">Result</p>
              <p className="bg-navy text-fog mt-0.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold">
                <Check size={14} aria-hidden="true" />
                {RESULT}
              </p>
            </motion.div>
          )}
          {step === 4 && (
            <motion.p
              key="new"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="text-xs font-semibold opacity-70"
            >
              New market
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------- wallets row ---------------- */

function BetChip({
  side,
  stake,
  index,
  base,
}: {
  side: "Yes" | "No";
  stake: number;
  index: number;
  base: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={{ opacity: 0, y: -10, scale: 0.6 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.7, ease: EASE, delay: base + index * 0.28 }
      }
      className={`num inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-semibold ${
        side === "Yes" ? "bg-navy text-fog" : "border-ink text-ink border"
      }`}
    >
      {side} ${stake}
    </motion.span>
  );
}

function WalletColumn({
  w,
  index,
  step,
}: {
  w: Wallet;
  index: number;
  step: number;
}) {
  const reduce = useReducedMotion();
  const grown = step >= 3;
  const size = bubble(w, grown);
  const right = w.side === RESULT;
  const [rb, tb] = w.before;
  const [ra, ta] = after(w);
  const ticked = useAfter(1100 + index * 260, step === 2 ? "s2" : "x");
  const showAfter = step >= 3 || (step === 2 && ticked);
  const marked = step === 2 && ticked;
  const bet = step === 4 ? w.next : { side: w.side, stake: w.stake };

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className="flex h-[76px] w-full items-center justify-center sm:h-[96px]">
        <motion.div
          className="relative shrink-0 [--k:1] sm:[--k:1.3]"
          animate={{
            width: `calc(${size}px * var(--k))`,
            height: `calc(${size}px * var(--k))`,
          }}
          transition={{
            duration: reduce ? 0 : 0.9,
            ease: EASE,
            delay: grown && !reduce ? index * 0.08 : 0,
          }}
        >
          <span
            className={`bg-ice text-navy grid size-full place-items-center rounded-full text-sm font-bold transition-colors duration-500 ${
              grown ? "ring-teal ring-2" : "ring-line-strong ring-1"
            }`}
          >
            {w.name.slice(0, 1)}
          </span>
          <AnimatePresence>
            {(step === 2 || step === 3) && showAfter && (
              <motion.span
                key="mark"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 22 }}
                aria-label={right ? "Right" : "Wrong"}
                className={`absolute -top-1 -right-1 grid size-5 place-items-center rounded-full ${
                  right
                    ? "bg-navy text-fog"
                    : "bg-ground border-ink text-ink border"
                }`}
              >
                {right ? <Check size={12} /> : <X size={12} />}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
      <p className="mt-1 text-xs font-semibold">{w.name}</p>
      <div className="mt-1 flex h-[22px] items-center">
        <BetChip
          key={step === 4 ? "b2" : "b1"}
          side={bet.side}
          stake={bet.stake}
          index={index}
          base={step === 4 ? 0.35 : 0.3}
        />
      </div>
      <div className="mt-1 flex h-5 items-center text-[11px]">
        <AnimatePresence mode="wait" initial={false}>
          {step === 2 && (
            <motion.span
              key={showAfter ? "after" : "before"}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.3, ease: EASE }}
              className={`num ${marked ? "font-bold" : "opacity-70"}`}
            >
              {showAfter ? `${ra} of ${ta}` : `${rb} of ${tb}`}
            </motion.span>
          )}
          {step >= 3 && (
            <motion.span
              key="score"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                ease: EASE,
                delay: 0.3 + index * 0.08,
              }}
              className="num text-teal font-bold"
            >
              {score(w)}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------- bottom region ---------------- */

function CrowdBar({ step }: { step: number }) {
  const v = useTween(50, CROWD, 0.5, step === 1 ? "s1" : "x");
  return (
    <div>
      <div className="bg-line h-3 overflow-hidden rounded-full">
        <div
          className="bg-ink h-full rounded-full"
          style={{ width: `${v}%` }}
        />
      </div>
      <div className="num mt-2 flex justify-between text-xs font-semibold">
        <span>Yes {Math.round(v)}%</span>
        <span className="opacity-70">No {100 - Math.round(v)}%</span>
      </div>
    </div>
  );
}

function Gauge() {
  const lo = 40;
  const hi = 80;
  const pos = (n: number) => ((n - lo) / (hi - lo)) * 100;
  const reduce = useReducedMotion();
  const t = (delay: number) => ({
    duration: reduce ? 0 : 1.1,
    ease: EASE,
    delay: reduce ? 0 : delay,
  });
  return (
    <div
      className="relative h-[132px]"
      role="img"
      aria-label={`Crowd ${CROWD} percent, Track record ${TRACK} percent, a gap of plus ${TRACK - CROWD} points`}
    >
      <div className="bg-line-strong absolute inset-x-0 top-[62px] h-1 rounded-full" />
      <motion.div
        className="bg-teal absolute top-[62px] h-1 rounded-full"
        initial={{ left: `${pos(CROWD)}%`, width: 0 }}
        animate={{
          left: `${pos(CROWD)}%`,
          width: `${pos(TRACK) - pos(CROWD)}%`,
        }}
        transition={t(1.4)}
      />
      {/* track record marker, label above */}
      <motion.div
        className="absolute top-0 h-full"
        initial={{ left: `${pos(CROWD)}%` }}
        animate={{ left: `${pos(TRACK)}%` }}
        transition={t(1.2)}
      >
        <span className="bg-teal border-ground absolute top-[56px] -left-2 size-4 rounded-full border-2" />
        <span className="bg-teal absolute top-[34px] left-[-0.5px] h-[22px] w-px" />
        <span className="text-teal num absolute top-[8px] left-[-8px] text-xs font-bold whitespace-nowrap">
          Track record {TRACK}%
        </span>
      </motion.div>
      {/* crowd marker, label below, grows leftwards */}
      <div className="absolute top-0 h-full" style={{ left: `${pos(CROWD)}%` }}>
        <span className="bg-ink border-ground absolute top-[56px] -left-2 size-4 rounded-full border-2" />
        <span className="bg-ink absolute top-[72px] left-[-0.5px] h-[16px] w-px" />
        <span className="num absolute top-[90px] right-[-8px] text-xs font-bold whitespace-nowrap">
          Crowd {CROWD}%
        </span>
      </div>
      {/* gap label */}
      <motion.span
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduce ? 0 : 0.6,
          ease: EASE,
          delay: reduce ? 0 : 2.3,
        }}
        className="num bg-ice text-navy absolute top-[90px] rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap"
        style={{ left: `calc(${pos(TRACK)}% - 8px)` }}
      >
        +{TRACK - CROWD} pts
      </motion.span>
      <span className="num absolute top-[118px] left-0 text-[10px] opacity-60">
        {lo}%
      </span>
      <span className="num absolute top-[118px] right-0 text-[10px] opacity-60">
        {hi}%
      </span>
    </div>
  );
}

function Bottom({ step }: { step: number }) {
  const ada = WALLETS[0];
  const bo = WALLETS[1];
  return (
    <div className="min-h-[132px]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {step === 1 && (
            <div className="pt-6">
              <CrowdBar step={step} />
            </div>
          )}
          {step === 2 && (
            <div className="flex flex-wrap gap-2 pt-6 text-sm font-semibold">
              <span className="bg-navy text-fog inline-flex items-center gap-1.5 rounded-full px-3 py-1.5">
                <Check size={14} aria-hidden="true" /> 3 right
              </span>
              <span className="border-ink inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5">
                <X size={14} aria-hidden="true" /> 2 wrong
              </span>
            </div>
          )}
          {step === 3 && (
            <ul className="space-y-2 pt-4 text-sm">
              <li className="flex items-center gap-2">
                <ArrowUp
                  size={16}
                  className="text-teal shrink-0"
                  aria-hidden="true"
                />
                <span>
                  <b>{ada.name}</b> grows,{" "}
                  <span className="num">
                    {after(ada)[0]} of {after(ada)[1]}
                  </span>{" "}
                  right
                </span>
              </li>
              <li className="flex items-center gap-2">
                <ArrowDown size={16} className="shrink-0" aria-hidden="true" />
                <span>
                  <b>{bo.name}</b> shrinks,{" "}
                  <span className="num">
                    {after(bo)[0]} of {after(bo)[1]}
                  </span>{" "}
                  right
                </span>
              </li>
              <li className="text-teal pt-1 text-xs font-semibold">
                Teal number = Track record
              </li>
            </ul>
          )}
          {step === 4 && <Gauge />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ---------------- step 5: agent buys the report ---------------- */

function AgentScene() {
  const reduce = useReducedMotion();
  const card = useAfter(1500, "agent");
  return (
    <div className="flex min-h-[320px] flex-col gap-10 pt-3">
      <div className="flex items-start gap-2">
        <div className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          <span className="border-ink bg-ground grid size-14 place-items-center rounded-2xl border">
            <Bot size={26} aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold">Agent</span>
        </div>
        <div className="relative mt-[26px] h-1 min-w-0 flex-1">
          <span className="bg-line-strong absolute inset-0 rounded-full" />
          <span className="num absolute -top-9 left-1/2 -translate-x-1/2 text-xs font-bold whitespace-nowrap">
            0.01 USDC
          </span>
          <motion.span
            aria-hidden="true"
            className="bg-ice text-navy border-ink absolute -top-[10px] -ml-3 grid size-6 place-items-center rounded-full border text-[11px] font-bold"
            initial={{ left: "0%", opacity: 0 }}
            animate={
              reduce
                ? { left: "50%", opacity: 1 }
                : { left: ["0%", "100%", "100%"], opacity: [0, 1, 0] }
            }
            transition={
              reduce
                ? { duration: 0 }
                : {
                    duration: 2.4,
                    ease: "easeInOut",
                    repeat: Infinity,
                    repeatDelay: 1.6,
                    times: [0, 0.85, 1],
                  }
            }
          >
            $
          </motion.span>
        </div>
        <div className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          <span className="bg-navy text-fog grid size-14 place-items-center rounded-2xl">
            <FileText size={26} aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold whitespace-nowrap">
            TRUTH-402
          </span>
        </div>
      </div>
      <AnimatePresence>
        {card && (
          <motion.div
            key="report"
            initial={{ opacity: 0, y: -18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.8, ease: EASE }}
            className="border-line bg-ground rounded-2xl border p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Report card</p>
              <span className="sticker">Will Ridge win?</span>
            </div>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <dt>Crowd</dt>
                <dd className="num font-bold">{CROWD}%</dd>
              </div>
              <div className="text-teal flex items-center justify-between">
                <dt>Track record</dt>
                <dd className="num font-bold">{TRACK}%</dd>
              </div>
              <div className="border-line flex items-center justify-between border-t pt-2.5">
                <dt className="opacity-70">Gap</dt>
                <dd className="num font-bold">+{TRACK - CROWD} pts</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
      {!card && <div className="h-[160px]" aria-hidden="true" />}
    </div>
  );
}

/* ---------------- the stage ---------------- */

export function HowStage({ step }: { step: number }) {
  return (
    <div className="border-line bg-panel rounded-3xl border p-4 shadow-[var(--shadow-soft)] sm:p-5">
      {step === 5 ? (
        <AgentScene />
      ) : (
        <div className="space-y-3">
          <MarketCard step={step} />
          <div className="grid grid-cols-5 gap-1 sm:gap-2">
            {WALLETS.map((w, i) => (
              <WalletColumn key={w.name} w={w} index={i} step={step} />
            ))}
          </div>
          <Bottom step={step} />
        </div>
      )}
    </div>
  );
}
