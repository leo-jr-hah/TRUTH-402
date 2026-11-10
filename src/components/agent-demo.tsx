"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  Circle,
  LoaderCircle,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Select } from "@/components/ui/select";
import { ReportFeeSplit } from "@/components/oracle-panel";
import { useSuiWallet } from "@/components/wallet-connect";
import { paymentAuthorization } from "@/lib/payment-auth";
import { removeEmDashes } from "@/lib/sanitize";
import type {
  OracleInvoice,
  OracleSandboxPayload,
  OracleUnlockedPayload,
} from "@/types/oracle";

export interface DemoMarket {
  id: string;
  title: string;
}

interface Outcome {
  label: string;
  marketProbability: number;
  oracleProbability: number;
}

type Status = "idle" | "running" | "done" | "error";

interface Step {
  title: string;
  request: string;
  response: string;
  status: Status;
}

const ease = [0.16, 1, 0.3, 1] as const;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function blankSteps(path: string): Step[] {
  return [
    {
      title: "Ask for the report",
      request: `GET ${path}`,
      response: "",
      status: "idle",
    },
    {
      title: "Pay the invoice",
      request: "Select invoice settlement",
      response: "",
      status: "idle",
    },
    {
      title: "Ask again with proof",
      request: `GET ${path}`,
      response: "",
      status: "idle",
    },
  ];
}

const pct = (n: number) => Math.round(n * 100);

function StepIcon({ status }: { status: Status }) {
  const cls = "grid size-7 shrink-0 place-items-center rounded-full border";
  if (status === "running")
    return (
      <span className={`${cls} border-teal text-teal`}>
        <LoaderCircle size={14} className="animate-spin" />
      </span>
    );
  if (status === "done")
    return (
      <span className={`${cls} border-teal bg-teal text-fog`}>
        <Check size={14} />
      </span>
    );
  if (status === "error")
    return (
      <span className={`${cls} border-ink text-ink`}>
        <TriangleAlert size={14} />
      </span>
    );
  return (
    <span className={`${cls} border-line-strong text-ink/55`}>
      <Circle size={8} />
    </span>
  );
}

function ReportView({ outcomes }: { outcomes: Outcome[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="border-line-strong bg-panel rounded-2xl border p-4 sm:p-5"
      role="status"
    >
      <p className="text-lg font-bold">Report received</p>
      <p className="text-ink/70 text-sm">
        Crowd is the market price. Track record weighs each trader by their past
        accuracy.
      </p>
      <ul className="mt-4 divide-y divide-[var(--color-line)]">
        {outcomes.map((o) => {
          const crowd = pct(o.marketProbability);
          const track = pct(o.oracleProbability);
          const diff = track - crowd;
          return (
            <li key={o.label} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 font-semibold break-words">
                  {o.label}
                </span>
                <span className="num text-sm font-semibold">
                  {diff === 0 ? (
                    "same"
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      {diff > 0 ? (
                        <ArrowUp size={14} />
                      ) : (
                        <ArrowDown size={14} />
                      )}
                      {diff > 0 ? "+" : "-"}
                      {Math.abs(diff)} pp
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {[
                  {
                    name: "Crowd",
                    value: crowd,
                    bar: "bg-ink",
                    text: "text-ink",
                  },
                  {
                    name: "Track record",
                    value: track,
                    bar: "bg-teal",
                    text: "text-teal",
                  },
                ].map((row) => (
                  <div
                    key={row.name}
                    className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm"
                  >
                    <span className={`${row.text} font-medium`}>
                      {row.name}
                    </span>
                    <span className="bg-line block h-2 overflow-hidden rounded-full">
                      <motion.span
                        className={`${row.bar} block h-full rounded-full`}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(2, row.value)}%` }}
                        transition={{ duration: 0.8, ease }}
                      />
                    </span>
                    <span className={`num text-right font-bold ${row.text}`}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

export function AgentDemo({
  markets,
  paymentMode,
  sandboxEnabled = false,
}: {
  markets: DemoMarket[];
  paymentMode: "demo" | "live";
  sandboxEnabled?: boolean;
}) {
  const [marketId, setMarketId] = useState(markets[0]?.id ?? "");
  const [plan, setPlan] = useState<"single" | "pack" | "day">("single");
  const [steps, setSteps] = useState<Step[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<OracleInvoice | null>(null);
  const [digest, setDigest] = useState("");
  const [report, setReport] = useState<
    OracleUnlockedPayload | OracleSandboxPayload | null
  >(null);
  const [method, setMethod] = useState<"wallet" | "digest" | "sandbox">(
    "wallet",
  );
  const wallet = useSuiWallet();
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const alive = useRef(true);
  const runId = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const live = paymentMode === "live";

  async function run(selectedMethod = method) {
    if (running) return;
    const id = ++runId.current;
    const current = () => alive.current && runId.current === id;
    const path = `/api/oracle/markets/${encodeURIComponent(marketId)}/signal`;
    const local = blankSteps(path);
    const patch = (i: number, p: Partial<Step>) => {
      local[i] = { ...local[i], ...p };
      if (current()) setSteps([...local]);
    };
    setRunning(true);
    setRunKey(id);
    setRan(true);
    setError(null);
    setOutcomes(null);
    setReport(null);
    setSteps(local);
    let at = 0;
    try {
      patch(0, { status: "running" });
      await pause(450);
      if (!current()) return;
      let activeInvoice = invoice;
      if (
        digest &&
        activeInvoice &&
        Date.parse(activeInvoice.expiresAt) <= Date.now()
      )
        throw new Error(
          "The invoice expired with a pending digest. Inspect that transaction before starting another payment.",
        );
      if (
        !activeInvoice ||
        activeInvoice.marketId !== marketId ||
        Date.parse(activeInvoice.expiresAt) <= Date.now()
      ) {
        const first = await fetch(path, { cache: "no-store" });
        const payload = (await first.json()) as OracleInvoice & {
          error?: { message?: string };
        };
        if (first.status !== 402 || payload.protocol !== "x402-sui-mpp")
          throw new Error(
            payload.error?.message ||
              `Expected 402 Payment required, got ${first.status}.`,
          );
        activeInvoice = payload;
        if (current()) setInvoice(payload);
      }
      patch(0, {
        status: "done",
        response: `402 Payment required, ${activeInvoice.amountUsdc} USDC. ${activeInvoice.preview.trackedBackers ?? activeInvoice.preview.participantCount} tracked backers; KL ${activeInvoice.preview.klDivergencePreview ?? "unavailable"} bits (disagreement, not profit).`,
      });

      at = 1;
      patch(1, { status: "running" });
      await pause(700);
      if (!current()) return;
      let paymentDigest: string | undefined;
      const useSandbox =
        selectedMethod === "sandbox" &&
        sandboxEnabled &&
        activeInvoice.sandboxAvailable;
      if (useSandbox) {
        patch(1, {
          request: "Public sponsored grant",
          response: "No funds move. This is not payment settlement.",
        });
      } else if (activeInvoice.mode === "demo" && !live) {
        paymentDigest = `demo-sui-tx-${crypto.randomUUID()}`;
      } else if (digest.trim()) {
        paymentDigest = digest.trim();
      } else if (selectedMethod === "wallet" && wallet.canSign) {
        patch(1, {
          request: "Approve 0.01 native USDC plus gas in your Sui wallet",
        });
        paymentDigest = await wallet.payInvoice(activeInvoice, (value) => {
          if (current()) setDigest(value);
        });
        if (current()) setDigest(paymentDigest);
      } else {
        patch(1, {
          status: "idle",
          response:
            "Invoice ready. Connect a signing wallet or settle this reference and paste its Mainnet digest below.",
        });
        return;
      }
      patch(1, {
        status: "done",
        response: useSandbox
          ? "Sponsored grant requested; payment verification is not bypassed."
          : activeInvoice.mode === "demo"
            ? "Settlement credential ready. No funds move."
            : `Submitted ${paymentDigest!.slice(0, 20)}... awaiting server verification.`,
      });

      at = 2;
      patch(2, { status: "running" });
      await pause(450);
      if (!current()) return;
      const second = useSandbox
        ? await fetch(path.replace(/\/signal$/u, "/sandbox"), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-oracle-ui-relayer": "sponsored",
            },
            body: JSON.stringify({ invoiceToken: activeInvoice.invoiceToken }),
            cache: "no-store",
          })
        : await fetch(path, {
            cache: "no-store",
            headers: {
              authorization: paymentAuthorization({
                method: "sui",
                digest: paymentDigest!,
                invoice: activeInvoice.invoiceToken,
                id: activeInvoice.id,
              }),
            },
          });
      const payload = (await second.json()) as (
        OracleUnlockedPayload | OracleSandboxPayload
      ) & {
        error?: { message?: string };
      };
      if (!second.ok || !payload.memoryCalibratedProbabilities)
        throw new Error(
          payload.error?.message || `Server answered ${second.status}.`,
        );
      patch(2, {
        status: "done",
        response: `${second.status} OK, report sent`,
      });
      await pause(250);
      if (current()) {
        setOutcomes(payload.memoryCalibratedProbabilities);
        setReport(payload);
        setInvoice(null);
        setDigest("");
      }
    } catch (caught) {
      const message = removeEmDashes(
        caught instanceof Error ? caught.message : "Something went wrong.",
      );
      patch(at, { status: "error", response: message });
      if (current()) setError(message);
    } finally {
      if (current()) setRunning(false);
    }
  }

  return (
    <div className="card p-5 sm:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="agent-market" className="field-label">
            Market
          </label>
          <Select
            id="agent-market"
            label="Market"
            value={marketId}
            onChange={(v) => {
              setMarketId(v);
              runId.current++;
              setSteps([]);
              setOutcomes(null);
              setReport(null);
              setInvoice(null);
              setDigest("");
              setError(null);
              setRan(false);
              setRunning(false);
            }}
            options={markets.map((m) => ({ value: m.id, label: m.title }))}
            disabled={running}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:shrink-0">
          <div
            role="group"
            aria-label="Report plan"
            className="grid grid-cols-3 gap-1.5"
          >
            {(
              [
                { value: "single", label: "Single report", price: "0.01 USDC" },
                { value: "pack", label: "10 reports", price: "0.05 USDC" },
                { value: "day", label: "Daily pass", price: "0.25 USDC" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={plan === option.value}
                onClick={() => setPlan(option.value)}
                className={`text-ink focus-visible:outline-teal rounded-lg border px-2 py-1.5 text-left text-xs leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  plan === option.value
                    ? "bg-ice border-teal"
                    : "bg-panel border-line hover:border-teal"
                }`}
              >
                <span className="block font-semibold">{option.label}</span>
                <span className="num text-ink/70 mt-0.5 block">
                  {option.price}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button-primary sm:shrink-0"
            disabled={running || !marketId}
            onClick={() => void run()}
          >
            {running ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : ran && !error ? (
              <RotateCcw size={16} />
            ) : (
              <Play size={16} />
            )}
            {running
              ? "Running..."
              : ran && !error
                ? invoice
                  ? "Pay and unlock"
                  : "Pay and unlock"
                : "Pay and unlock"}
          </button>
        </div>
      </div>

      {live || invoice?.mode === "live" ? (
        <div className="mt-4 space-y-3">
          <p className="text-ink/70 text-sm">
            Live Mainnet: your wallet approves the payment, or you supply a
            confirmed digest for this invoice. Never send the private invoice
            token on-chain.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="button-secondary"
              aria-pressed={method === "wallet"}
              disabled={running}
              onClick={() => setMethod("wallet")}
            >
              Connected wallet
            </button>
            <button
              type="button"
              className="button-secondary"
              aria-pressed={method === "digest"}
              disabled={running}
              onClick={() => setMethod("digest")}
            >
              Paste Mainnet digest
            </button>
            {sandboxEnabled && (
              <button
                type="button"
                className="button-secondary"
                disabled={running || !marketId}
                onClick={() => {
                  setMethod("sandbox");
                  void run("sandbox");
                }}
              >
                Request sponsored grant (no funds)
              </button>
            )}
          </div>
          {invoice && (
            <div className="border-line space-y-2 rounded-xl border p-3 text-xs">
              <p className="break-all">Recipient: {invoice.recipient}</p>
              <p className="break-all">Native USDC: {invoice.coinType}</p>
              <p className="break-all">
                Public PTB reference: {invoice.paymentReference}
              </p>
              <p>Expires {invoice.expiresAt}</p>
              <label className="block">
                <span className="field-label">Paste Mainnet Sui Digest</span>
                <input
                  className="field font-mono text-xs"
                  value={digest}
                  onChange={(event) => setDigest(event.target.value.trim())}
                  maxLength={100}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </div>
          )}
        </div>
      ) : (
        <p className="text-ink/70 mt-4 text-sm">
          Real requests to this app. Credit only; no funds move.
        </p>
      )}

      {steps.length > 0 && (
        <ol className="mt-6 space-y-3" aria-label="Agent steps">
          {steps.map((s, i) => (
            <motion.li
              key={`${runKey}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease, delay: i * 0.05 }}
              className="flex gap-3"
            >
              <StepIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="num text-ink/70 font-mono text-xs break-all">
                  {s.request}
                </p>
                {s.response && (
                  <p
                    className={`mt-0.5 text-sm break-words ${s.status === "error" ? "font-semibold" : "text-teal font-semibold"}`}
                  >
                    {s.response}
                  </p>
                )}
              </div>
            </motion.li>
          ))}
        </ol>
      )}

      <AnimatePresence>
        {error && !running && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="border-ink mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm"
          >
            <span className="min-w-0 break-words">
              Could not finish: {error}
            </span>
            <button
              type="button"
              className="button-secondary"
              onClick={() => void run()}
            >
              <RotateCcw size={16} />
              Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {outcomes && (
        <div className="mt-6">
          <ReportView outcomes={outcomes} />
          {report && "sandbox" in report && (
            <p className="mt-3 text-sm">
              Sponsored grant, not a payment. {report.sandbox.provider}{" "}
              checkpoint {report.sandbox.checkpoint}, {report.sandbox.latencyMs}{" "}
              ms. No revenue recorded.
            </p>
          )}
          {report && (
            <ReportFeeSplit incentiveEconomics={report.incentiveEconomics} />
          )}
        </div>
      )}
    </div>
  );
}
