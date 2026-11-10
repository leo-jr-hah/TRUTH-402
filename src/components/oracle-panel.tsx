"use client";

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Fingerprint,
  LoaderCircle,
  Lock,
  LockOpen,
  Receipt,
  Send,
  ShieldCheck,
  Snowflake,
  TriangleAlert,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Link from "next/link";

import { burst } from "@/components/ui/burst";
import { CountUp } from "@/components/ui/count-up";
import { Disclosure } from "@/components/ui/disclosure";
import { useSuiWallet } from "@/components/wallet-connect";
import { verifyForecastHash } from "@/lib/forecast-integrity";
import { paymentAuthorization } from "@/lib/payment-auth";
import { removeEmDashes } from "@/lib/sanitize";
import type { Market } from "@/types/domain";
import type {
  OracleInvoice,
  OracleUnlockedPayload,
  OracleSandboxPayload,
  PreCommitmentProof,
} from "@/types/oracle";

const STEPS = [
  { label: "Request", icon: Send },
  { label: "Pay", icon: Receipt },
  { label: "Unlock", icon: LockOpen },
] as const;

function DrawnCheck({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden>
      <motion.circle
        cx="28"
        cy="28"
        r="25"
        stroke="var(--teal)"
        strokeWidth="3"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.path
        d="M17 29.5l7.5 7.5L39.5 20"
        stroke="var(--teal)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}

function Stepper({ done, busy }: { done: number; busy: boolean }) {
  return (
    <ol className="relative grid grid-cols-3" aria-label="Report steps">
      <div
        aria-hidden
        className="bg-line-strong absolute top-5 right-[16.66%] left-[16.66%] h-0.5 rounded-full"
      >
        <motion.div
          className="bg-teal h-full rounded-full"
          initial={false}
          animate={{ width: `${(Math.min(done, 2) / 2) * 100}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
      {STEPS.map((step, i) => {
        const finished = i < done || (i === 2 && done === 3);
        const current = i === done;
        const Icon = step.icon;
        return (
          <li
            key={step.label}
            className="relative flex flex-col items-center gap-2 text-center"
            aria-current={current ? "step" : undefined}
          >
            <motion.span
              animate={{ scale: finished ? [1, 1.2, 1] : 1 }}
              transition={{ duration: 0.45 }}
              className={`relative grid size-10 place-items-center rounded-full border-2 transition-colors duration-300 ${
                finished
                  ? "border-teal bg-teal text-fog"
                  : current
                    ? "border-ink bg-ground text-ink"
                    : "border-line-strong bg-ground text-ink/55"
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={finished ? "done" : current && busy ? "busy" : "icon"}
                  initial={{ scale: 0.3, rotate: -90, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0.3, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  className="grid place-items-center"
                >
                  {finished ? (
                    <ShieldCheck size={17} />
                  ) : current && busy ? (
                    <LoaderCircle size={17} className="animate-spin" />
                  ) : (
                    <Icon size={17} />
                  )}
                </motion.span>
              </AnimatePresence>
            </motion.span>
            <span
              className={`text-sm font-semibold ${finished || current ? "text-ink" : "text-ink/60"}`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Per outcome: crowd, then track record (locked until the report is paid). */
function ReportRows({
  market,
  report,
}: {
  market: Market;
  report: OracleUnlockedPayload | OracleSandboxPayload | null;
}) {
  const rows = [...market.outcomes].sort((a, b) => b.price - a.price);
  return (
    <ul className="divide-line divide-y">
      {rows.map((outcome) => {
        const row = report?.memoryCalibratedProbabilities.find(
          (entry) => entry.outcomeId === outcome.id,
        );
        const crowd = Math.round(
          (row?.marketProbability ?? outcome.price) * 100,
        );
        const record = row ? Math.round(row.oracleProbability * 100) : null;
        const gap = record === null ? 0 : record - crowd;
        return (
          <li
            key={outcome.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
          >
            <p className="min-w-0 text-base font-bold [overflow-wrap:anywhere]">
              {removeEmDashes(outcome.label)}
            </p>
            <p className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                <span className="text-ink/70 text-xs">Crowd </span>
                <span className="font-semibold">{crowd}%</span>
              </span>
              {record === null ? (
                <span className="border-line-strong text-ink/75 inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-0.5 text-xs font-semibold">
                  <Lock size={12} aria-hidden /> Locked
                </span>
              ) : (
                <>
                  <span>
                    <span className="text-ink/70 text-xs">Track record </span>
                    <span className="text-accent font-semibold">
                      <CountUp value={record} suffix="%" />
                    </span>
                  </span>
                  <span className="text-accent inline-flex items-center gap-0.5 font-semibold">
                    {gap >= 0 ? (
                      <ArrowUpRight size={14} aria-hidden />
                    ) : (
                      <ArrowDownRight size={14} aria-hidden />
                    )}
                    <CountUp
                      value={Math.abs(gap)}
                      prefix={gap >= 0 ? "+" : "-"}
                      suffix=" pts"
                    />
                  </span>
                </>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportFeeSplit({
  incentiveEconomics,
}: {
  incentiveEconomics?: OracleUnlockedPayload["incentiveEconomics"];
}) {
  // The server allocates exact integer micros. Never recompute payouts from rounded UI weights.
  const topContributors = [...(incentiveEconomics?.forecasterRoyalties ?? [])]
    .sort((a, b) => b.influenceWeight - a.influenceWeight)
    .slice(0, 4);

  return (
    <section
      aria-labelledby="report-fee-h"
      className="border-line bg-panel text-ink mt-3 space-y-2 rounded-xl border p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="report-fee-h" className="text-sm font-semibold">
          Where the 0.01 USDC goes
        </h3>
        {incentiveEconomics && (
          <span className="num text-ink/70 font-mono text-[11px]">
            KL {incentiveEconomics.klDivergenceBits?.toFixed(3) ?? "infinite"}{" "}
            bits · {incentiveEconomics.estimatedAgentEvBps} bps shift
          </span>
        )}
      </div>

      <div aria-hidden className="bg-ice flex h-2 overflow-hidden rounded-full">
        <motion.div
          className="bg-teal h-full shrink-0"
          initial={{ width: "0%" }}
          animate={{ width: "80%" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.div
          className="bg-navy h-full shrink-0"
          initial={{ width: "0%" }}
          animate={{ width: "20%" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <p className="text-ink/75 text-xs leading-4">
        <span className="text-teal font-semibold">80% (8,000 micro-USDC)</span>{" "}
        allocated to the traders whose track record shaped this signal;{" "}
        <span className="text-ink font-semibold">20% (2,000 micro-USDC)</span>{" "}
        allocated to the protocol. Accounting only; no royalty payouts have been
        executed.
      </p>

      {topContributors.length > 0 && (
        <div>
          <p className="text-ink/65 text-xs font-semibold">
            Top contributors · weighted share
          </p>
          <ul aria-label="Top contributing traders" className="mt-1">
            {topContributors.map((backer) => (
              <li
                key={backer.participantId}
                className="border-line flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t py-1.5 text-xs last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {removeEmDashes(backer.displayName)}
                  </p>
                  {Number.isFinite(backer.profitRank) &&
                    Number.isFinite(backer.trustRank) && (
                      <p className="text-ink/65 mt-0.5 tabular-nums">
                        Profit #{backer.profitRank} to Accuracy #
                        {backer.trustRank}
                      </p>
                    )}
                </div>
                <p className="text-teal shrink-0 font-semibold whitespace-nowrap tabular-nums">
                  {Number(backer.royaltyMicroUsdc).toLocaleString("en-US")}{" "}
                  micro-USDC
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-ink/65 text-xs">
        KL and probability shifts measure disagreement, not guaranteed accuracy
        or trading profit. Unallocated pool:{" "}
        {incentiveEconomics?.unallocatedBackerPoolMicroUsdc ?? "8000"}{" "}
        micro-USDC.
      </p>
    </section>
  );
}

export function OraclePanel({
  market,
  paymentMode,
  commitMode,
  operatorRequired = commitMode === "live",
  sandboxEnabled = false,
}: {
  market: Market;
  paymentMode: "demo" | "live";
  commitMode: "demo" | "live";
  operatorRequired?: boolean;
  sandboxEnabled?: boolean;
}) {
  const [invoice, setInvoice] = useState<OracleInvoice | null>(null);
  const [challengeHeaders, setChallengeHeaders] = useState("");
  const [digest, setDigest] = useState("");
  const [report, setReport] = useState<
    OracleUnlockedPayload | OracleSandboxPayload | null
  >(null);
  const wallet = useSuiWallet();
  const [proof, setProof] = useState<PreCommitmentProof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState("");
  const [hashVerification, setHashVerification] = useState<Awaited<
    ReturnType<typeof verifyForecastHash>
  > | null>(null);
  const endpoint = `/api/oracle/markets/${encodeURIComponent(market.id)}`;
  const done = report ? 3 : invoice ? 1 : 0;

  async function query(paymentDigest?: string) {
    setBusy(true);
    setError(null);
    setHashVerification(null);
    try {
      const headers: Record<string, string> = {};
      if (paymentDigest) {
        headers.authorization = paymentAuthorization({
          method: "sui",
          digest: paymentDigest,
          ...(invoice ? { invoice: invoice.invoiceToken, id: invoice.id } : {}),
        });
      }
      const response = await fetch(`${endpoint}/signal`, {
        headers,
        cache: "no-store",
      });
      const payload = (await response.json()) as OracleUnlockedPayload &
        OracleInvoice & { error?: { message?: string } };
      if (response.status === 402 && payload.protocol === "x402-sui-mpp") {
        setInvoice(payload);
        setReport(null);
        const visibleChallenge = (
          response.headers.get("www-authenticate") ?? ""
        ).replace(/(invoice(?:Token)?=")[^"]+/giu, "$1[private]");
        setChallengeHeaders(
          `HTTP 402 Payment Required\nWWW-Authenticate: ${visibleChallenge}\nX-Payment-Required: ${response.headers.get("x-payment-required")}`,
        );
      } else if (response.ok) {
        setReport(payload);
        setProof(payload.preCommitmentProof);
        setInvoice(null);
        setDigest("");
        setChallengeHeaders("");
      } else throw new Error(payload.error?.message || "The request failed.");
    } catch (caught) {
      setError(
        removeEmDashes(
          caught instanceof Error ? caught.message : "The request failed.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    setHashVerification(null);
    try {
      const response = await fetch(`${endpoint}/commit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: "{}",
      });
      const payload = (await response.json()) as {
        preCommitmentProof?: PreCommitmentProof;
        error?: { message?: string };
      };
      if (!response.ok || !payload.preCommitmentProof)
        throw new Error(
          payload.error?.message || "The forecast was not saved.",
        );
      setProof(payload.preCommitmentProof);
      // A paid current estimate must not masquerade as the newly frozen snapshot.
      setReport(null);
      setInvoice(null);
      setChallengeHeaders("");
    } catch (caught) {
      setError(
        removeEmDashes(
          caught instanceof Error
            ? caught.message
            : "The forecast was not saved.",
        ),
      );
    } finally {
      setBusy(false);
      setAdminToken("");
    }
  }

  async function payWithWallet() {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      const value = await wallet.payInvoice(invoice, setDigest);
      setDigest(value);
      await query(value);
    } catch (caught) {
      setError(
        removeEmDashes(
          caught instanceof Error
            ? caught.message
            : "Wallet payment failed. Check your wallet before retrying.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function sandbox() {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}/sandbox`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-oracle-ui-relayer": "sponsored",
        },
        body: JSON.stringify({ invoiceToken: invoice.invoiceToken }),
        cache: "no-store",
      });
      const payload = (await response.json()) as OracleSandboxPayload & {
        error?: { message?: string };
      };
      if (!response.ok || !payload.sandbox || payload.paymentReceipt !== null)
        throw new Error(payload.error?.message ?? "Sandbox access failed.");
      setReport(payload);
      setProof(payload.preCommitmentProof);
      setInvoice(null);
      setDigest("");
      setChallengeHeaders("");
    } catch (caught) {
      setError(
        removeEmDashes(
          caught instanceof Error ? caught.message : "Sandbox access failed.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyHash(origin?: HTMLElement) {
    if (!proof || !report?.forecastRecord) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyForecastHash(
        report.forecastRecord,
        proof,
        report,
      );
      setHashVerification(result);
      if (!result.matches)
        setError("The fingerprints do not match. Do not rely on this report.");
      else if (origin) burst(origin, "lime", 30);
    } catch {
      setError(
        "The check could not finish. Use a secure browser context and a complete receipt.",
      );
    } finally {
      setBusy(false);
    }
  }

  const digestField = (
    <label className="block">
      <span className="field-label">
        {invoice?.mode === "live"
          ? "Paste Mainnet Sui Digest"
          : "Sui transaction digest"}
      </span>
      <input
        className="field font-mono text-sm"
        value={digest}
        onChange={(event) => setDigest(event.target.value.trim())}
        maxLength={100}
        autoComplete="off"
        spellCheck={false}
        placeholder={
          paymentMode === "demo" ? "demo-sui-tx-..." : "Confirmed Sui digest"
        }
      />
    </label>
  );
  const verifyPayment = (
    <button
      type="button"
      className={paymentMode === "live" ? "button-primary" : "button-secondary"}
      disabled={busy || !digest}
      onClick={() => query(digest)}
    >
      {busy ? (
        <>
          <LoaderCircle size={15} className="animate-spin" /> Checking payment
        </>
      ) : (
        <>
          Check payment
          <span className="sr-only"> Verify 0.01 USDC Sui Payment</span>
        </>
      )}
    </button>
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="report-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-[52ch]">
            <h2
              id="report-h"
              className="text-xl font-bold tracking-[-0.02em] sm:text-2xl"
            >
              Get the track-record report
            </h2>
            <p className="text-ink/75 mt-1.5 text-sm">
              See the same bets, weighted by each trader&apos;s past accuracy.
              It costs 0.01 USDC.
            </p>
          </div>
          <span className="border-line-strong inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold">
            <span
              className={
                paymentMode === "demo"
                  ? "bg-ink/60 size-2 rounded-full"
                  : "live-dot"
              }
            />
            {paymentMode === "demo"
              ? "Simulated, no funds move"
              : "Live Sui USDC"}
          </span>
        </div>

        <div className="mt-6">
          <Stepper done={done} busy={busy} />
        </div>

        <div className="border-line bg-panel-2/60 mt-6 rounded-2xl border p-4 sm:p-5">
          <ReportRows market={market} report={report} />
        </div>

        <div className="border-line mt-5 rounded-2xl border p-4 sm:p-5">
          <AnimatePresence mode="wait" initial={false}>
            {!invoice && !report && (
              <motion.div
                key="request"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <p className="text-ink/80 text-sm">
                  Step 1. Ask for the report. You get a price quote first.
                </p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <button
                    type="button"
                    onClick={() => query()}
                    disabled={busy}
                    className="button-primary group"
                  >
                    {busy ? (
                      <LoaderCircle size={15} className="animate-spin" />
                    ) : (
                      <Lock size={15} />
                    )}
                    Request report
                    <span className="sr-only">
                      {" "}
                      Query Oracle as AI Agent (HTTP 402)
                    </span>
                  </button>
                  <a
                    href="/api/oracle/manifest"
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink/75 hover:text-ink inline-flex min-h-11 items-center gap-1.5 text-sm underline"
                  >
                    For AI agents
                    <ExternalLink size={13} aria-hidden />
                  </a>
                </div>
              </motion.div>
            )}

            {invoice && !report && (
              <motion.div
                key="pay"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-ink/80 text-sm">
                      Step 2. Pay to unlock the report.
                    </p>
                    <p className="num mt-1 text-4xl font-bold tracking-[-0.03em]">
                      0.01 <span className="text-xl">USDC</span>
                    </p>
                  </div>
                  <p className="num text-ink/75 text-sm">
                    {invoice.preview.trackedBackers ??
                      invoice.preview.participantCount}{" "}
                    tracked traders
                  </p>
                </div>
                {(invoice.mode === "live" || paymentMode === "live") && (
                  <div className="space-y-3">
                    <button
                      type="button"
                      className="button-primary"
                      disabled={busy || !wallet.canSign || Boolean(digest)}
                      onClick={() => void payWithWallet()}
                    >
                      Pay 0.01 USDC with Sui wallet
                    </button>
                    <p className="text-ink/70 text-xs">
                      Approve in your wallet. You fund 0.01 native USDC plus SUI
                      gas. Watch-only addresses cannot sign.
                    </p>
                    {digestField}
                    <div className="flex flex-wrap gap-3">{verifyPayment}</div>
                  </div>
                )}
                {invoice.mode === "demo" && paymentMode === "demo" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="button-primary"
                      disabled={busy}
                      onClick={() => {
                        const value = `demo-sui-tx-${crypto.randomUUID()}`;
                        setDigest(value);
                        void query(value);
                      }}
                    >
                      {busy ? (
                        <LoaderCircle size={15} className="animate-spin" />
                      ) : (
                        <Receipt size={15} />
                      )}
                      Pay 0.01 USDC
                      <span className="sr-only">
                        {" "}
                        Settle Demo Invoice, no funds move
                      </span>
                    </button>
                    <span className="text-ink/70 text-xs">
                      Sandbox credit. No funds move.
                    </span>
                  </div>
                )}
                {sandboxEnabled && invoice.sandboxAvailable && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => void sandbox()}
                    >
                      Instant sponsored sandbox access
                    </button>
                    <p className="text-ink/70 text-xs">
                      Public judge grant, not a USDC payment. Checks the
                      configured Tatum checkpoint; no funds or royalties move.
                    </p>
                  </div>
                )}
                <Disclosure summary="Details">
                  <div className="space-y-4 text-xs">
                    <p className="text-ink/80 text-sm">
                      {removeEmDashes(invoice.instructions)}
                    </p>
                    {challengeHeaders && (
                      <pre
                        aria-label="Payment challenge headers"
                        className="border-line bg-panel-2 overflow-x-auto rounded-lg border p-3 font-mono text-xs leading-5 whitespace-pre-wrap"
                      >
                        {removeEmDashes(challengeHeaders)}
                      </pre>
                    )}
                    {invoice.mode === "live" && (
                      <div className="space-y-2">
                        <p>
                          Recipient:{" "}
                          <code className="break-all">{invoice.recipient}</code>
                        </p>
                        <p>
                          Coin:{" "}
                          <code className="break-all">{invoice.coinType}</code>
                        </p>
                        <p>
                          Reference:{" "}
                          <code className="break-all">
                            {invoice.paymentReference}
                          </code>
                        </p>
                        <p className="text-ink/70">
                          Expires {invoice.expiresAt}. Pay from your own wallet.
                          Your wallet signs; only its signed transaction can be
                          submitted through Tatum. Keep the invoice token
                          private.
                        </p>
                      </div>
                    )}
                    {paymentMode === "demo" && (
                      <div className="space-y-3">
                        {digestField}
                        {verifyPayment}
                      </div>
                    )}
                  </div>
                </Disclosure>
              </motion.div>
            )}

            {report && (
              <motion.div
                key="report"
                role="status"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-5"
              >
                {"sandbox" in report && (
                  <p className="border-line rounded-lg border p-3 text-xs">
                    Sponsored sandbox access. No payment verified and no funds
                    moved.{" "}
                    {report.sandbox.provider === "tatum"
                      ? "Live Tatum"
                      : "Local"}{" "}
                    checkpoint {report.sandbox.checkpoint},{" "}
                    {report.sandbox.latencyMs} ms.
                  </p>
                )}
                <div className="flex items-center gap-4">
                  <DrawnCheck />
                  <div>
                    <p className="text-lg font-bold">Step 3. Report unlocked</p>
                    <p className="text-ink/75 flex flex-wrap items-center gap-x-2 text-sm">
                      {report.signalSource === "committed-snapshot" ? (
                        <>
                          <Snowflake size={14} aria-hidden /> Saved forecast
                        </>
                      ) : (
                        <>Current estimate</>
                      )}
                      <span>
                        from {report.trustedBackers.length} trusted traders
                      </span>
                    </p>
                  </div>
                </div>

                {report.trustedBackers.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-bold">Who is backing it</h3>
                    <ul className="divide-line mt-1 divide-y">
                      {report.trustedBackers.map((backer, i) => (
                        <motion.li
                          key={backer.participantId}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 + i * 0.05 }}
                          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm"
                        >
                          <span className="font-semibold">
                            {removeEmDashes(backer.displayName)}
                          </span>
                          <span className="num text-ink/75 flex items-center gap-2 text-xs">
                            Profit rank #{backer.profitRank}
                            <ArrowRight size={11} aria-hidden />
                            <span className="text-accent font-semibold">
                              Accuracy rank #{backer.trustRank}
                            </span>
                          </span>
                        </motion.li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-ink/75 text-sm">
                    No trader here has a track record yet, so it matches the
                    crowd.
                  </p>
                )}

                <Disclosure summary="Details">
                  <div className="space-y-4">
                    <p className="num text-ink/75 text-xs">
                      HTTP 200 -{" "}
                      {report.paymentReceipt
                        ? report.paymentReceipt.provider === "demo"
                          ? "local sandbox verification"
                          : "Tatum Sui payment verification"
                        : "Sandbox checkpoint observation, not payment verification"}{" "}
                      -{" "}
                      {report.paymentReceipt?.latencyMs ??
                        ("sandbox" in report
                          ? report.sandbox.latencyMs
                          : 0)}{" "}
                      ms
                    </p>
                    <ul className="space-y-1.5">
                      {report.trustedBackers.map((backer) => (
                        <li
                          key={backer.participantId}
                          className="num text-ink/75 text-xs"
                        >
                          {removeEmDashes(backer.displayName)}: skill score{" "}
                          {backer.shrinkageSkillScore.toFixed(2)} over{" "}
                          {backer.totalCount} calls
                        </li>
                      ))}
                      {report.walrusEvidenceBlobs.map((memory) => (
                        <li key={memory.recordId}>
                          <Link
                            href={`/insights?record=${encodeURIComponent(memory.recordId)}`}
                            className="block font-mono text-xs break-all underline"
                          >
                            {memory.provider === "demo" ? "Demo" : "Walrus"}:{" "}
                            {memory.blobId}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <pre className="bg-panel-2 max-h-72 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
                      {removeEmDashes(JSON.stringify(report, null, 2))}
                    </pre>
                  </div>
                </Disclosure>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {report && (
          <ReportFeeSplit incentiveEconomics={report.incentiveEconomics} />
        )}
      </section>

      <section aria-labelledby="save-h" className="border-line border-t pt-6">
        <h2
          id="save-h"
          className="text-xl font-bold tracking-[-0.02em] sm:text-2xl"
        >
          Save my forecast
        </h2>
        <p className="text-ink/75 mt-1.5 max-w-[56ch] text-sm">
          Lock today&apos;s numbers before the result. No one can change them
          later.{" "}
          <Link
            href="/about#forecast-integrity"
            className="hover:text-accent underline"
          >
            How it works
          </Link>
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <button
            type="button"
            className="button-secondary"
            disabled={
              busy ||
              market.status !== "open" ||
              (operatorRequired && !adminToken)
            }
            onClick={commit}
          >
            <ShieldCheck size={15} aria-hidden />
            {busy ? "Working" : "Save now"}
            <span className="sr-only"> Commit Pre-Resolution Pick</span>
          </button>
          {operatorRequired && (
            <label className="block min-w-56 flex-1 sm:max-w-xs">
              <span className="field-label">
                Operator token for live publication
              </span>
              <input
                type="password"
                className="field"
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
                autoComplete="off"
                maxLength={200}
              />
            </label>
          )}
        </div>
        {market.status !== "open" && (
          <p className="text-ink/70 mt-2 text-xs">
            Forecasts can only be saved while the market is open.
          </p>
        )}

        <AnimatePresence initial={false}>
          {proof && (
            <motion.div
              key="proof"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="border-teal/50 bg-ice/40 mt-5 space-y-4 rounded-2xl border p-4 sm:p-5">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <Snowflake size={16} aria-hidden /> Forecast saved
                </p>
                <p className="text-ink/80 text-sm">
                  {proof.contentBound
                    ? "Its fingerprint is below. Anyone can check it."
                    : "This is an older save. Its content is not tied to the fingerprint."}
                </p>
                <p className="font-mono text-xs break-all">
                  {proof.forecastHash ?? proof.contentHash}
                </p>

                {proof.contentBound && (
                  <div>
                    <button
                      type="button"
                      className="button-primary"
                      disabled={busy || !report?.forecastRecord}
                      onClick={(e) => void verifyHash(e.currentTarget)}
                    >
                      <Fingerprint size={15} aria-hidden />
                      Check the fingerprint
                      <span className="sr-only"> Verify Forecast Hash</span>
                    </button>
                    {!report?.forecastRecord && (
                      <p className="text-ink/70 mt-2 text-xs">
                        Get the report above first. The check runs in your
                        browser.
                      </p>
                    )}
                  </div>
                )}

                <AnimatePresence>
                  {hashVerification && (
                    <motion.div
                      key={hashVerification.matches ? "ok" : "bad"}
                      role="status"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="border-line-strong bg-panel flex items-center gap-4 rounded-xl border p-4"
                    >
                      {hashVerification.matches ? (
                        <DrawnCheck size={44} />
                      ) : (
                        <TriangleAlert className="shrink-0" size={32} />
                      )}
                      <div>
                        <p className="text-base font-bold">
                          {hashVerification.matches
                            ? "Verified. The fingerprints match."
                            : "The fingerprints do not match"}
                        </p>
                        <p className="text-ink/75 text-sm">
                          Worked out in your browser from the full snapshot.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <Disclosure summary="Details">
                  <div className="space-y-4">
                    <dl className="space-y-2 text-xs">
                      <div>
                        <dt className="text-ink/70">Checkpoint</dt>
                        <dd className="font-mono">
                          {proof.sui.checkpoint} ({proof.sui.provider})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink/70">Record</dt>
                        <dd className="font-mono break-all">
                          {proof.recordId}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink/70">Blob</dt>
                        <dd className="font-mono break-all">{proof.blobId}</dd>
                      </div>
                      <div>
                        <dt className="text-ink/70">Captured</dt>
                        <dd className="font-mono">{proof.capturedAt}</dd>
                      </div>
                      <div>
                        <dt className="text-ink/70">Published</dt>
                        <dd className="font-mono">{proof.publishedAt}</dd>
                      </div>
                      <div>
                        <dt className="text-ink/70">Checkpoint time</dt>
                        <dd className="font-mono">{proof.sui.timestamp}</dd>
                      </div>
                    </dl>
                    {hashVerification && (
                      <div>
                        <p className="text-ink/70 mb-1 text-xs">
                          Payload that was hashed
                        </p>
                        <pre className="bg-panel-2 max-h-64 overflow-auto rounded-md p-3 font-mono text-xs break-all whitespace-pre-wrap">
                          {hashVerification.canonicalPayload}
                        </pre>
                      </div>
                    )}
                  </div>
                </Disclosure>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key={error}
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-ink bg-panel flex gap-2 overflow-hidden rounded-xl border p-3 text-sm"
          >
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
