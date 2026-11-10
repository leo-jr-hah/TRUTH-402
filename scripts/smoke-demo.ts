import assert from "node:assert/strict";
import { verifyForecastHash } from "../src/lib/forecast-integrity";
import {
  parsePaymentAuthorization,
  paymentAuthorization,
} from "../src/lib/payment-auth";

import type {
  HealthSnapshot,
  InsightsSnapshot,
  Market,
  Trade,
} from "../src/types/domain";
import type {
  OracleInvoice,
  OracleUnlockedPayload,
  PredictionCalibrationSnapshot,
  PreCommitmentProof,
} from "../src/types/oracle";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const emDash = String.fromCodePoint(0x2014);
const parsedBase = new URL(baseUrl);
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(parsedBase.hostname),
  "Smoke runs are restricted to a local demo server.",
);
assert.ok(
  !parsedBase.username && !parsedBase.password && parsedBase.pathname === "/",
  "Smoke URL must be a plain loopback origin.",
);

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface GeneratedInsight {
  content: string;
  provider: "demo" | "agent-router";
  cached: boolean;
}

async function json<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as T;
  assert.ok(
    !JSON.stringify(body).includes(emDash),
    `${path} returned an em dash`,
  );
  return { status: response.status, body };
}

async function main(): Promise<void> {
  console.log(`Smoke testing ${baseUrl} in expected demo mode.`);

  // Discovery reads configuration only. Check modes before pages or health can
  // contact a provider, and refuse file storage so the smoke cannot reset data.
  const discovery = await json<{
    runtime: {
      memoryMode: string;
      tatumMode: string;
      aiMode: string;
      storageMode: string;
      mainnetWrites: boolean;
    };
  }>("/api/oracle/manifest");
  assert.equal(discovery.status, 200);
  assert.deepEqual(discovery.body.runtime, {
    memoryMode: "demo",
    tatumMode: "demo",
    aiMode: "demo",
    storageMode: "memory",
    mainnetWrites: false,
  });
  console.log(
    "  discovery: demo-only modes, memory storage and disabled Mainnet writes verified",
  );

  const pages = [
    "/",
    "/markets",
    "/markets/new",
    "/markets/new/simple",
    "/markets/new/opportunity",
    "/markets/mkt-climate-grant",
    "/markets/mkt-sports-final",
    "/insights",
    "/integrations",
    "/about",
    "/manifest.webmanifest",
    "/icon.svg",
  ];
  for (const path of pages) {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
    assert.ok(body.length > 50, `${path} returned an empty body`);
    assert.ok(!body.includes(emDash), `${path} rendered an em dash`);
    console.log(`  page ${path}: 200 (${body.length} bytes)`);
  }

  const root = await fetch(`${baseUrl}/`, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(root.headers.get("x-content-type-options"), "nosniff");
  assert.equal(root.headers.get("x-frame-options"), "DENY");
  assert.equal(
    root.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assert.match(root.headers.get("permissions-policy") || "", /payment=\(\)/);
  console.log("  security headers: present");

  const health = await json<HealthSnapshot>("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.status, "healthy");
  assert.equal(health.body.integrations.length, 3);
  for (const integration of health.body.integrations) {
    assert.equal(
      integration.mode,
      "demo",
      `${integration.name} unexpectedly entered live mode`,
    );
  }
  console.log("  health: all three integrations explicitly in demo mode");

  const oraclePath = "/api/oracle/markets/mkt-climate-grant";
  const committed = await json<{ preCommitmentProof: PreCommitmentProof }>(
    `${oraclePath}/commit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(committed.status, 200);
  assert.equal(committed.body.preCommitmentProof.provider, "demo");
  assert.equal(committed.body.preCommitmentProof.sui.provider, "demo");
  assert.equal(committed.body.preCommitmentProof.sui.contentBound, false);
  assert.equal(committed.body.preCommitmentProof.contentBound, true);
  assert.equal(committed.body.preCommitmentProof.bindingScope, "memory-record");
  const challenge = await fetch(`${baseUrl}${oraclePath}/signal`, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(challenge.status, 402);
  assert.match(
    challenge.headers.get("www-authenticate") ?? "",
    /Payment method="sui"/u,
  );
  assert.equal(challenge.headers.get("x-payment-required"), "true");
  const invoice = (await challenge.json()) as OracleInvoice;
  const parameters = parsePaymentAuthorization(
    challenge.headers.get("www-authenticate")!,
  );
  assert.equal(parameters.id, invoice.id);
  assert.equal(parameters.invoicetoken, invoice.invoiceToken);
  assert.equal(parameters.invoice, invoice.invoiceToken);
  assert.equal(
    invoice.preview.preCommitCheckpoint,
    committed.body.preCommitmentProof.sui.checkpoint,
  );
  assert.equal(invoice.amountBaseUnits, "10000");
  assert.ok(!JSON.stringify(invoice).includes(emDash));
  const digest = `demo-sui-tx-smoke-${crypto.randomUUID()}`;
  const paid = await json<OracleUnlockedPayload>(`${oraclePath}/signal`, {
    headers: {
      authorization: paymentAuthorization({
        method: "sui",
        digest,
        invoice: invoice.invoiceToken,
        id: invoice.id,
        network: "sui:mainnet",
      }),
    },
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.paymentReceipt.provider, "demo");
  assert.equal(paid.body.signalSource, "committed-snapshot");
  assert.ok(paid.body.forecastRecord && paid.body.preCommitmentProof);
  assert.equal(
    (
      await verifyForecastHash(
        paid.body.forecastRecord,
        paid.body.preCommitmentProof,
        paid.body,
      )
    ).matches,
    true,
  );
  assert.ok(paid.body.walrusEvidenceBlobs.length > 0);
  assert.ok(
    paid.body.memoryCalibratedProbabilities.some(
      (row) => Math.abs(row.edgeDivergence) > 0.001,
    ),
  );
  assert.ok(
    Math.abs(
      paid.body.memoryCalibratedProbabilities.reduce(
        (sum, row) => sum + row.oracleProbability,
        0,
      ) - 1,
    ) < 1e-12,
  );
  assert.equal(
    (
      await json(`${oraclePath}/signal`, {
        headers: { "x-payment-digest": digest },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await json(`${oraclePath}/signal`, {
        headers: { "x-payment-digest": "invalid" },
      })
    ).status,
    400,
  );
  const repeatedCommit = await json<{ preCommitmentProof: PreCommitmentProof }>(
    `${oraclePath}/commit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(
    repeatedCommit.body.preCommitmentProof.contentHash,
    committed.body.preCommitmentProof.contentHash,
  );
  const calibration = await json<PredictionCalibrationSnapshot>(
    "/api/oracle/calibration",
  );
  assert.equal(calibration.status, 200);
  const whale = calibration.body.entries.find((entry) =>
    entry.displayName.startsWith("Lucky"),
  );
  assert.ok(whale && whale.profitRank < whale.trustRank);
  const revenue = await json<{ attributedRevenueMicroUsdc: string }>(
    "/api/oracle/revenue",
  );
  assert.equal(revenue.status, 200);
  assert.ok(BigInt(revenue.body.attributedRevenueMicroUsdc) >= BigInt(10000));
  console.log(
    "  oracle: commitment, 402 challenge, paid unlock, evidence, replay and rank divergence passed",
  );

  const before = await json<{ markets: Market[] }>("/api/markets");
  assert.equal(before.status, 200);
  assert.equal(before.body.markets.length, 22);
  console.log(
    `  market registry: ${before.body.markets.length} seeded markets`,
  );

  const invalid = await json<ErrorEnvelope>("/api/markets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "simple" }),
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
  console.log("  invalid market payload: rejected with 422");

  const created = await json<{ market: Market }>("/api/markets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "simple",
      title: "Which launch narrative should TRUTH402 test first?",
      description:
        "The demo council will select one launch narrative after collecting an explicit conviction signal.",
      sponsor: "TRUTH402 Demo Council",
      outcomes: [
        {
          label: "Decisions that learn",
          description: "Lead with persistent organizational learning.",
        },
        {
          label: "Markets for teams",
          description: "Lead with collaborative signal aggregation.",
        },
        {
          label: "Evidence-backed credibility",
          description: "Lead with transparent participant accuracy.",
        },
      ],
      liquidity: 250,
      tags: ["demo", "launch"],
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.market.status, "open");
  const market = created.body.market;
  const winner = market.outcomes[0];
  const conflictingWinner = market.outcomes[1];
  console.log(`  create: ${market.id}`);

  const traded = await json<{ market: Market; trade: Trade }>(
    `/api/markets/${market.id}/trade`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        outcomeId: winner.id,
        amount: 125,
        displayName: "Smoke Tester",
        role: "trader",
      }),
    },
  );
  assert.equal(traded.status, 201);
  assert.equal(traded.body.market.totalVolume, 125);
  assert.ok(traded.body.trade.priceAfter > traded.body.trade.priceBefore);
  assert.ok(
    Math.abs(
      traded.body.market.outcomes.reduce(
        (total, outcome) => total + outcome.price,
        0,
      ) - 1,
    ) < 1e-10,
  );
  console.log(
    `  trade: ${(traded.body.trade.priceBefore * 100).toFixed(1)}% → ${(traded.body.trade.priceAfter * 100).toFixed(1)}%`,
  );

  const resolved = await json<{
    market: Market;
    memory: { status: string; confirmed: number };
  }>(`/api/markets/${market.id}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      winningOutcomeId: winner.id,
      resolutionNote:
        "The learning narrative best communicates the persistent-memory differentiation.",
    }),
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.market.status, "resolved");
  assert.equal(resolved.body.memory.status, "confirmed");
  assert.equal(resolved.body.memory.confirmed, 3);
  assert.equal(
    resolved.body.market.learningUpdate?.episode,
    "post_resolution_update",
  );
  assert.ok(
    resolved.body.market.learningUpdate?.changes.some(
      (change) =>
        change.displayName === "Smoke Tester" && change.after.totalCount >= 1,
    ),
  );
  assert.ok(
    resolved.body.market.memoryReceipts.every(
      (receipt) => receipt.provider === "demo",
    ),
  );
  console.log("  resolution: 3 granular demo memories confirmed");

  const conflict = await json<ErrorEnvelope>(
    `/api/markets/${market.id}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        winningOutcomeId: conflictingWinner.id,
        resolutionNote: "This conflicting resolution must be rejected.",
      }),
    },
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "RESOLUTION_CONFLICT");
  console.log("  resolution conflict: rejected with 409");

  const insights = await json<InsightsSnapshot>(
    "/api/insights?query=TRUTH402%20participant%20performance%20credibility%20market%20resolution&limit=100",
  );
  assert.equal(insights.status, 200);
  assert.equal(insights.body.provider, "demo");
  assert.ok(!JSON.stringify(insights.body).includes(emDash));
  assert.ok(insights.body.metrics.memoryCount >= 23);
  assert.ok(
    insights.body.records.some((record) =>
      record.marketTitle.includes("launch narrative"),
    ),
  );
  const smokeParticipant = insights.body.leaderboard.find(
    (participant) => participant.displayName === "Smoke Tester",
  );
  assert.ok(smokeParticipant);
  assert.ok(
    insights.body.records.some(
      (record) =>
        record.kind === "market_resolution" &&
        record.marketId === market.id &&
        record.learningUpdate?.episode === "post_resolution_update",
    ),
  );
  assert.ok((smokeParticipant.byMarketType.simple?.totalCount ?? 0) >= 1);
  assert.equal(smokeParticipant.credibleInterval.level, 90);
  assert.ok(
    smokeParticipant.credibleInterval.lowerBound <
      smokeParticipant.credibilityScore,
  );
  assert.ok(
    smokeParticipant.credibleInterval.upperBound >
      smokeParticipant.credibilityScore,
  );
  assert.equal(insights.body.calibration.length, 5);
  assert.equal(
    insights.body.calibration.reduce(
      (total, bucket) => total + bucket.totalCount,
      0,
    ),
    insights.body.metrics.participantObservationCount,
  );
  assert.equal(insights.body.recencyWeighted.halfLifeDays, 180);
  assert.ok(insights.body.recencyWeighted.anchorAt);
  console.log(
    `  recall: ${insights.body.memories.length} memories, ${insights.body.leaderboard.length} credibility entries`,
  );

  const generated = await json<GeneratedInsight>("/api/insights/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.provider, "demo");
  assert.ok(generated.body.content.length > 40);
  assert.match(generated.body.content, /posterior interval/iu);
  assert.ok(!generated.body.content.includes(emDash));
  const cached = await json<GeneratedInsight>("/api/insights/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(cached.status, 200);
  assert.equal(cached.body.cached, true);
  console.log("  insight: deterministic demo generation and cache passed");

  const finalMarket = await json<{ market: Market }>(
    `/api/markets/${market.id}`,
  );
  assert.equal(finalMarket.status, 200);
  assert.equal(finalMarket.body.market.memoryReceipts.length, 3);
  console.log("Smoke workflow passed. No live provider was contacted.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
