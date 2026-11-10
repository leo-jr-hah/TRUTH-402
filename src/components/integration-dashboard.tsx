"use client";

import { Coins, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { AgentCode } from "@/components/agent-code";
import { AgentDemo, type DemoMarket } from "@/components/agent-demo";
import { AgentScene } from "@/components/agent-scene";
import { CopyHash } from "@/components/copy-hash";
import { Disclosure } from "@/components/ui/disclosure";
import { formatDateTime, humanize } from "@/lib/format";
import { removeEmDashes } from "@/lib/sanitize";
import type { HealthSnapshot, IntegrationCheck } from "@/types/domain";
import type { OracleRevenueLedger } from "@/types/oracle";

/** Honest state: a demo that works is not styled as a live success. */
function describeState(check: IntegrationCheck): string {
  if (check.status === "error") return "Needs attention";
  if (check.status === "unconfigured") return "Not set up";
  if (check.status === "configured") return "Set up, not checked";
  return check.mode === "live" ? "Live and checked" : "Demo, working";
}

function SystemStatus({
  initialHealth,
  operatorRequired,
}: {
  initialHealth: HealthSnapshot;
  operatorRequired: boolean;
}) {
  const [health, setHealth] = useState(initialHealth);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<OracleRevenueLedger | null>(null);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [operatorToken, setOperatorToken] = useState("");
  const needsOperator = operatorRequired;
  const liveCount = health.integrations.filter((i) => i.mode === "live").length;
  const blend =
    liveCount === 0
      ? "All demo"
      : liveCount === health.integrations.length
        ? "All live"
        : "Mixed";
  const healthy = health.status === "healthy";

  async function loadLedger() {
    setLedgerBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/oracle/revenue", {
        cache: "no-store",
        headers: operatorToken
          ? { authorization: `Bearer ${operatorToken}` }
          : {},
      });
      const payload = (await response.json()) as OracleRevenueLedger & {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message || "Revenue ledger failed.");
      setLedger(payload);
    } catch (caught) {
      setError(
        removeEmDashes(
          caught instanceof Error ? caught.message : "Revenue ledger failed.",
        ),
      );
    } finally {
      setLedgerBusy(false);
      setOperatorToken("");
    }
  }

  async function refresh() {
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = (await response.json()) as HealthSnapshot & {
        error?: { message?: string; details?: HealthSnapshot };
      };
      const snapshot = Array.isArray(payload.integrations)
        ? payload
        : payload.error?.details;
      if (!snapshot || !Array.isArray(snapshot.integrations)) {
        throw new Error(payload.error?.message || "Checks failed.");
      }
      setHealth(snapshot);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? removeEmDashes(caught.message)
          : "Checks failed.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <Disclosure
      summary={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>System status</span>
          <span className="text-ink/70 text-xs font-medium">
            {healthy ? "Ready" : "Needs attention"} · {blend}
          </span>
        </span>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-ink/70 text-sm">
            Checked {formatDateTime(health.checkedAt)}.
          </p>
          <button
            type="button"
            className="button-secondary group"
            disabled={checking}
            onClick={() => void refresh()}
          >
            {checking ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <RefreshCw
                size={16}
                className="transition-transform duration-500 group-hover:rotate-180"
              />
            )}
            {checking ? "Checking..." : "Run checks"}
          </button>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="border-ink overflow-hidden rounded-xl border px-4 py-3 text-sm"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <ul
          className={`divide-line border-line divide-y border-y transition-opacity ${checking ? "opacity-60" : ""}`}
        >
          {health.integrations.map((integration) => (
            <li key={integration.name} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{integration.name}</p>
                <p className="flex items-center gap-2 text-sm">
                  <span className="border-line-strong rounded-full border px-2.5 py-0.5 text-xs font-semibold">
                    {integration.mode === "live" ? "Live" : "Demo"}
                  </span>
                  <span className="text-ink/80">
                    {describeState(integration)}
                  </span>
                </p>
              </div>
              <p className="text-ink/70 mt-1 text-sm">
                {removeEmDashes(integration.message)}
                {integration.latencyMs !== undefined && (
                  <span className="num"> · {integration.latencyMs} ms</span>
                )}
              </p>
              {integration.details &&
                Object.keys(integration.details).length > 0 && (
                  <Disclosure className="mt-3" summary="Details">
                    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                      {Object.entries(integration.details).map(
                        ([key, value]) => (
                          <div key={key} className="flex justify-between gap-3">
                            <dt className="text-ink/70">{humanize(key)}</dt>
                            <dd className="num max-w-[60%] truncate text-right">
                              {value === null
                                ? "Not available"
                                : removeEmDashes(String(value))}
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                  </Disclosure>
                )}
            </li>
          ))}
        </ul>

        <div className="space-y-3">
          <h3 className="font-semibold">Revenue from reports</h3>
          <div className="flex flex-wrap items-end gap-3">
            {needsOperator && (
              <label className="min-w-60 flex-1 sm:max-w-xs">
                <span className="field-label">Operator token</span>
                <input
                  type="password"
                  className="field"
                  value={operatorToken}
                  onChange={(event) => setOperatorToken(event.target.value)}
                  maxLength={200}
                  autoComplete="off"
                />
              </label>
            )}
            <button
              type="button"
              className="button-primary"
              onClick={() => void loadLedger()}
              disabled={ledgerBusy || (needsOperator && !operatorToken)}
            >
              {ledgerBusy ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Coins size={16} />
              )}
              {ledgerBusy ? "Reading..." : "Show revenue"}
            </button>
            <a
              href="/api/oracle/manifest"
              className="button-ghost group"
              target="_blank"
              rel="noreferrer"
            >
              Agent manifest
              <ExternalLink size={14} />
            </a>
          </div>

          <AnimatePresence>
            {ledger && (
              <motion.div
                role="status"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="border-line-strong space-y-4 rounded-2xl border p-4"
              >
                <p className="text-sm font-semibold">
                  {ledger.provider === "demo"
                    ? "Demo revenue, no real funds"
                    : "Live revenue, read only"}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="num text-2xl font-bold">
                      {ledger.attributedRevenueMicroUsdc}
                    </p>
                    <p className="text-ink/70 text-xs">earned, micro-USDC</p>
                  </div>
                  <div>
                    <p className="num text-ink/80 text-2xl font-bold">
                      {ledger.balanceMicroUsdc}
                    </p>
                    <p className="text-ink/70 text-xs">
                      wallet balance, micro-USDC
                    </p>
                  </div>
                </div>
                {ledger.royaltyAccounting && (
                  <p className="text-ink/70 text-xs">
                    Accrual only:{" "}
                    {ledger.royaltyAccounting.allocatedRoyaltiesMicroUsdc}{" "}
                    micro-USDC allocated to backers,{" "}
                    {ledger.royaltyAccounting.protocolFeeMicroUsdc} to the
                    protocol;{" "}
                    {ledger.royaltyAccounting.unallocatedBackerPoolMicroUsdc}{" "}
                    unallocated. Paid out:{" "}
                    {ledger.royaltyAccounting.paidOutMicroUsdc}. Native-SUI
                    alternative credits: {ledger.attributedSuiMist ?? "0"} MIST,
                    excluded from USDC revenue.
                  </p>
                )}
                <Disclosure
                  summary={`Receipts (${ledger.entries.length} shown)`}
                >
                  {ledger.entries.length === 0 ? (
                    <p className="text-ink/70 text-sm">
                      No receipts yet. The first paid report will appear here.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {ledger.entries.map((entry) => (
                        <li key={entry.digest} className="space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <CopyHash
                              value={entry.digest}
                              label="receipt digest"
                            />
                            <span className="border-line-strong rounded-full border px-2.5 py-0.5 text-xs font-semibold">
                              {entry.attributed ? "Earned" : "Wallet credit"}
                            </span>
                          </div>
                          <p className="num text-ink/70 text-xs">
                            {entry.amountBaseUnits} base units,{" "}
                            {formatDateTime(entry.timestamp)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Disclosure>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Disclosure>
  );
}

export function IntegrationDashboard({
  initialHealth,
  markets,
  operatorRequired = initialHealth.integrations.some((i) => i.mode === "live"),
  sandboxEnabled = false,
}: {
  initialHealth: HealthSnapshot;
  markets: DemoMarket[];
  operatorRequired?: boolean;
  sandboxEnabled?: boolean;
}) {
  const paymentMode =
    initialHealth.integrations.find((i) => i.name === "Tatum Sui RPC")?.mode ===
    "live"
      ? "live"
      : "demo";
  return (
    <div className="space-y-14 sm:space-y-20">
      <section aria-labelledby="hero-title" className="space-y-6">
        <header className="max-w-2xl">
          <h1
            id="hero-title"
            className="font-display text-4xl leading-[1.05] font-bold tracking-[-0.035em] sm:text-5xl"
          >
            Agents can buy the report
          </h1>
          <p className="text-ink/70 mt-4 text-base sm:text-lg">
            Let your AI agent buy the track-record report for{" "}
            <span className="num text-ink font-semibold">0.01</span> USDC.
          </p>
        </header>
        <AgentScene />
      </section>

      <section aria-labelledby="try-title" className="space-y-5">
        <h2
          id="try-title"
          className="font-display text-3xl font-bold tracking-[-0.03em]"
        >
          Try it now
        </h2>
        <AgentDemo
          markets={markets}
          paymentMode={paymentMode}
          sandboxEnabled={sandboxEnabled}
        />
      </section>

      <section aria-labelledby="code-title" className="space-y-5">
        <h2
          id="code-title"
          className="font-display text-3xl font-bold tracking-[-0.03em]"
        >
          Use it from code
        </h2>
        <AgentCode />
      </section>

      <section aria-labelledby="status-title" className="space-y-4">
        <h2 id="status-title" className="sr-only">
          System status
        </h2>
        <SystemStatus
          initialHealth={initialHealth}
          operatorRequired={operatorRequired}
        />
      </section>
    </div>
  );
}
