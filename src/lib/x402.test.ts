import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as manifest } from "@/app/api/oracle/manifest/route";
import { POST as commit } from "@/app/api/oracle/markets/[id]/commit/route";
import { GET as signal } from "@/app/api/oracle/markets/[id]/signal/route";
import { GET as revenue } from "@/app/api/oracle/revenue/route";
import { SUI_USDC_COIN_TYPE } from "@/lib/config";
import {
  canonicalJson,
  forecastPayload,
  verifyForecastHash,
} from "@/lib/forecast-integrity";
import {
  parsePaymentAuthorization,
  paymentAuthorization,
} from "@/lib/payment-auth";
import { parseMemory, serializeMemory } from "@/lib/memory/codec";
import { expectedMemoryRecordId } from "@/lib/memory/record-id";
import { clearRateLimitState } from "@/lib/request-guards";
import { createSeedDatabase } from "@/lib/seed";
import {
  getInsightsSnapshot,
  invalidateInsightsCache,
} from "@/lib/services/insights";
import { commitOracleForecast, getOracleSignal } from "@/lib/services/oracle";
import {
  consumeOraclePayment,
  putOracleInvoice,
  readDatabase,
  resetStoreForTests,
  updateMarket,
} from "@/lib/store";
import {
  authorizeOracleCommit,
  createPaymentChallenge,
  invoiceTokenHash,
  paymentDigestFromRequest,
  redeemOraclePayment,
} from "@/lib/x402";
import type { OracleInvoice, OracleUnlockedPayload } from "@/types/oracle";

const marketId = "mkt-climate-grant";
const context = { params: Promise.resolve({ id: marketId }) };
const base = `http://localhost/api/oracle/markets/${marketId}`;
const fetchMock = vi.fn<typeof fetch>();
let temporary: string | undefined;

function request(headers: Record<string, string> = {}): Request {
  return new Request(`${base}/signal`, { headers });
}
function commitRequest(
  body = "{}",
  headers: Record<string, string> = {},
): Request {
  return new Request(`${base}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("HTTP 402 oracle and immutable pre-event snapshots", () => {
  beforeEach(async () => {
    await resetStoreForTests();
    invalidateInsightsCache();
    clearRateLimitState();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (temporary) await rm(temporary, { recursive: true, force: true });
    temporary = undefined;
  });

  it("advertises a truthful agent manifest and exact 402 challenge headers", async () => {
    const discovery = await manifest(
      new Request("http://localhost/api/oracle/manifest"),
    );
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({
      compatibility: { standardX402V2: false, standardMppCredential: false },
    });
    const response = await signal(request(), context);
    expect(response.status).toBe(402);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'Payment method="sui", intent="charge", network="sui:mainnet", currency="USDC", amount="10000"',
    );
    expect(response.headers.get("X-Payment-Required")).toBe("true");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const invoice = (await response.json()) as OracleInvoice;
    expect(
      parsePaymentAuthorization(response.headers.get("WWW-Authenticate")!),
    ).toMatchObject({
      id: invoice.id,
      invoice: invoice.invoiceToken,
      invoicetoken: invoice.invoiceToken,
      amount: invoice.amountBaseUnits,
      recipient: invoice.recipient,
      mode: "demo",
    });
    expect(invoice).toMatchObject({
      protocol: "x402-sui-mpp",
      amountUsdc: "0.01",
      amountBaseUnits: "10000",
      network: "sui:mainnet",
      preview: {
        participantCount: 3,
        memoryCount: createSeedDatabase().demoMemories.length,
        preCommitCheckpoint: null,
      },
    });
    expect(invoice.paymentReference).toBe(
      invoiceTokenHash(invoice.invoiceToken),
    );
    expect(JSON.stringify(await readDatabase())).not.toContain(
      invoice.invoiceToken,
    );
    expect(JSON.stringify(invoice)).not.toContain(
      "memoryCalibratedProbabilities",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unlocks accurate Walrus-backed probabilities and records demo revenue", async () => {
    const expected = await getOracleSignal(marketId);
    const response = await signal(
      request({ "x-payment-digest": "demo-sui-tx-unlocked1" }),
      context,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as OracleUnlockedPayload;
    expect(payload.memoryCalibratedProbabilities).toEqual(
      expected.snapshot.memoryCalibratedProbabilities,
    );
    expect(
      payload.memoryCalibratedProbabilities.reduce(
        (sum, row) => sum + row.oracleProbability,
        0,
      ),
    ).toBeCloseTo(1, 12);
    expect(payload.walrusEvidenceBlobs.length).toBeGreaterThan(0);
    expect(payload.paymentReceipt.provider).toBe("demo");
    expect(payload.preCommitmentProof).toBeNull();
    expect(JSON.stringify(payload)).not.toContain(String.fromCodePoint(0x2014));
    const ledger = await revenue(
      new Request("http://localhost/api/oracle/revenue"),
    );
    expect(await ledger.json()).toMatchObject({
      attributedRevenueMicroUsdc: "10000",
      entries: [{ digest: "demo-sui-tx-unlocked1", attributed: true }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects simultaneous and cross-market replay atomically", async () => {
    const headers = { "x-payment-digest": "demo-sui-tx-concurrent" };
    const results = await Promise.all([
      signal(request(headers), context),
      signal(request(headers), context),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const other = await signal(
      new Request(
        "http://localhost/api/oracle/markets/mkt-pricing-experiment/signal",
        { headers },
      ),
      { params: Promise.resolve({ id: "mkt-pricing-experiment" }) },
    );
    expect(other.status).toBe(409);
    expect((await readDatabase()).oraclePaymentReceipts).toHaveLength(1);
  });

  it("validates digest formats, conflicting credentials and the alternate Authorization header", async () => {
    expect(
      (await signal(request({ "x-payment-digest": "bad" }), context)).status,
    ).toBe(400);
    expect(
      (
        await signal(
          request({ authorization: 'Payment digest="demo-sui-tx-auth001"' }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(() =>
      paymentDigestFromRequest(
        request({
          "x-payment-digest": "demo-sui-tx-header1",
          authorization: 'Payment digest="demo-sui-tx-header2"',
        }),
      ),
    ).toThrow(/unambiguous/u);
    expect(() =>
      paymentDigestFromRequest(
        request({ authorization: "Payment something-else" }),
      ),
    ).toThrow();
    expect(
      (await signal(request({ "x-payment-digest": "A".repeat(44) }), context))
        .status,
    ).toBe(400);
  });

  it("binds invoices to resources, expires them and consumes each invoice once", async () => {
    const challenge = await signal(request(), context);
    const invoice = (await challenge.json()) as OracleInvoice;
    const headers = {
      "x-payment-digest": "demo-sui-tx-bound001",
      "x-payment-invoice": invoice.invoiceToken,
    };
    expect(
      (
        await signal(request(headers), {
          params: Promise.resolve({ id: "mkt-pricing-experiment" }),
        })
      ).status,
    ).toBe(402);
    expect((await signal(request(headers), context)).status).toBe(200);
    expect(
      (
        await signal(
          request({ ...headers, "x-payment-digest": "demo-sui-tx-bound002" }),
          context,
        )
      ).status,
    ).toBe(402);
    const next = (await (
      await signal(request(), context)
    ).json()) as OracleInvoice;
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(next.expiresAt) + 1);
    expect(
      (
        await signal(
          request({
            "x-payment-digest": "demo-sui-tx-expired1",
            "x-payment-invoice": next.invoiceToken,
          }),
          context,
        )
      ).status,
    ).toBe(402);
  });

  it("redeems multi-parameter Payment credentials without custom headers", async () => {
    const invoice = (await (
      await signal(request(), context)
    ).json()) as OracleInvoice;
    const authorization = paymentAuthorization({
      network: "sui:mainnet",
      invoice: invoice.invoiceToken,
      method: "sui",
      digest: "demo-sui-tx-multiparam",
      id: invoice.id,
    });
    const response = await signal(request({ authorization }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).paymentReceipt.digest).toBe(
      "demo-sui-tx-multiparam",
    );
    expect((await readDatabase()).oracleInvoices).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate, mismatched and malformed Payment parameters before redemption", async () => {
    const token = "x".repeat(43);
    for (const authorization of [
      'Payment digest="demo-sui-tx-repeat01", Digest="demo-sui-tx-repeat01"',
      'Payment digest="demo-sui-tx-wrongchain", network="eip155:1"',
      'Payment method="evm", digest="demo-sui-tx-wrongmethod"',
      'Payment digest="demo-sui-tx-trailing",',
      'Payment digest="demo-sui-tx-malformed" garbage',
      `Payment digest="demo-sui-tx-badid001", invoice="${token}", id="bad"`,
    ])
      expect((await signal(request({ authorization }), context)).status).toBe(
        400,
      );
    expect(
      (
        await signal(
          request({
            authorization: `Payment digest="demo-sui-tx-conflict", invoice="${token}"`,
            "x-payment-invoice": "y".repeat(43),
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect((await readDatabase()).oraclePaymentReceipts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks one snapshot, round-trips its new memory kind, and never leaks it through free insights", async () => {
    const [first, concurrent] = await Promise.all([
      commitOracleForecast(marketId),
      commitOracleForecast(marketId),
    ]);
    expect(concurrent).toEqual(first);
    const database = await readDatabase();
    expect(database.demoMemories).toHaveLength(
      createSeedDatabase().demoMemories.length + 1,
    );
    const memory = database.oracleCommitments![0].record;
    expect(memory.recordId).toBe(expectedMemoryRecordId(memory));
    expect(parseMemory(serializeMemory(memory))).toEqual(memory);
    expect(memory.contentHash).toBe(
      createHash("sha256")
        .update(
          canonicalJson(
            forecastPayload(memory.snapshot, memory.checkpointObservation),
          ),
        )
        .digest("hex"),
    );
    expect(memory).toMatchObject({
      episode: "pre_event_pick",
      contentBound: true,
      forecastHash: memory.contentHash,
      suiCheckpoint: memory.checkpointObservation.checkpoint,
      suiTimestamp: memory.checkpointObservation.timestampMs,
    });
    expect(first.preCommitmentProof.contentBound).toBe(true);
    expect(first.preCommitmentProof.sui.contentBound).toBe(false);
    expect(
      (await verifyForecastHash(memory, first.preCommitmentProof)).matches,
    ).toBe(true);
    const storedText = database.demoMemories.find(
      (entry) => entry.blobId === first.preCommitmentProof.blobId,
    )!.text;
    expect(storedText).toContain(`"forecastHash":"${memory.forecastHash}"`);
    expect(storedText).toContain(`"suiCheckpoint":"${memory.suiCheckpoint}"`);
    await updateMarket(marketId, (market) => ({
      ...market,
      updatedAt: new Date(Date.now() + 100).toISOString(),
      outcomes: market.outcomes.map((outcome) => ({ ...outcome, price: 0.25 })),
    }));
    expect(await commitOracleForecast(marketId)).toEqual(first);
    expect((await getOracleSignal(marketId)).snapshot).toEqual(first.snapshot);
    const publicInsights = await getInsightsSnapshot();
    expect(
      publicInsights.records.some(
        (record) => record.kind === "oracle_forecast",
      ),
    ).toBe(false);
    expect(publicInsights.metrics.parsedMemoryCount).toBe(
      createSeedDatabase().demoMemories.length,
    );
    const response = await commit(commitRequest(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("snapshot");
  });

  it("refuses retrospective picks and preserves committed forecasts after resolution", async () => {
    const frozen = await commitOracleForecast(marketId);
    await updateMarket(marketId, (market) => ({
      ...market,
      status: "resolved",
      resolvedAt: new Date(Date.now() + 1000).toISOString(),
    }));
    const report = await getOracleSignal(marketId);
    expect(report.snapshot).toEqual(frozen.snapshot);
    expect(report.preCommitmentProof?.publicationBeforeResolution).toBe(true);
    expect(
      (
        await commit(commitRequest(), {
          params: Promise.resolve({ id: "mkt-feature-q4" }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await signal(request({ "x-payment-digest": "demo-sui-tx-closed01" }), {
          params: Promise.resolve({ id: "mkt-feature-q4" }),
        })
      ).status,
    ).toBe(409);
  });

  it("guards all routes, limits streaming bodies and rejects cross-origin mutations", async () => {
    expect(
      (
        await manifest(
          new Request("http://localhost/api/oracle/manifest?unknown=1"),
        )
      ).status,
    ).toBe(422);
    expect(
      (await signal(request(), { params: Promise.resolve({ id: "../bad" }) }))
        .status,
    ).toBe(422);
    expect(
      (await signal(request({ "x-payment-digest": "x".repeat(257) }), context))
        .status,
    ).toBe(400);
    expect((await commit(commitRequest('{"unknown":1}'), context)).status).toBe(
      422,
    );
    expect((await commit(commitRequest("{bad"), context)).status).toBe(400);
    expect(
      (
        await commit(
          commitRequest("{}", { "content-type": "text/plain" }),
          context,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await commit(
          commitRequest(JSON.stringify({ identifier: "x".repeat(2500) })),
          context,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await commit(
          commitRequest("{}", { origin: "https://attacker.example" }),
          context,
        )
      ).status,
    ).toBe(403);
    clearRateLimitState();
    for (let i = 0; i < 30; i += 1)
      expect(
        (await manifest(new Request("http://localhost/api/oracle/manifest")))
          .status,
      ).toBe(200);
    expect(
      (await manifest(new Request("http://localhost/api/oracle/manifest")))
        .status,
    ).toBe(429);
  });

  it("fails closed for live ephemeral storage and requires constant-time operator authorization", async () => {
    vi.stubEnv("VERDICTO_TATUM_MODE", "live");
    vi.stubEnv("SUI_ORACLE_ADDRESS", `0x${"a".repeat(64)}`);
    await expect(commitOracleForecast(marketId)).rejects.toMatchObject({
      code: "ORACLE_DURABLE_STORAGE_REQUIRED",
    });
    await expect(
      createPaymentChallenge(marketId, {
        participantCount: 0,
        memoryCount: 0,
        preCommitCheckpoint: null,
        topProfitVsTrustDivergencePreview: [],
      }),
    ).rejects.toMatchObject({ code: "ORACLE_DURABLE_STORAGE_REQUIRED" });
    vi.stubEnv("VERDICTO_ORACLE_ADMIN_TOKEN", "a".repeat(32));
    expect(() =>
      authorizeOracleCommit(request({ authorization: "a".repeat(32) })),
    ).toThrow();
    expect(() =>
      authorizeOracleCommit(
        request({ authorization: `Bearer ${"b".repeat(32)}` }),
      ),
    ).toThrow();
    expect(() =>
      authorizeOracleCommit(
        request({ authorization: `Bearer ${"a".repeat(32)}` }),
      ),
    ).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies a live invoice-bound transfer using only mocked RPC and isolated temporary storage", async () => {
    temporary = await mkdtemp(path.join(tmpdir(), "verdicto-oracle-"));
    const recipient = `0x${"a".repeat(64)}`;
    vi.stubEnv("VERDICTO_TATUM_MODE", "live");
    vi.stubEnv("SUI_ORACLE_ADDRESS", recipient);
    vi.stubEnv("TATUM_API_KEY", "test-tatum-key");
    vi.stubEnv("TATUM_SUI_RPC_URL", "https://sui-mainnet.gateway.tatum.io");
    vi.stubEnv("VERDICTO_STORAGE_MODE", "file");
    vi.stubEnv("VERDICTO_DATA_FILE", path.join(temporary, "state.json"));
    vi.stubEnv("VERDICTO_ORACLE_SINGLE_INSTANCE", "true");
    vi.stubEnv("VERCEL", "");
    const invoice = (await (
      await createPaymentChallenge(marketId, {
        participantCount: 0,
        memoryCount: 0,
        preCommitCheckpoint: null,
        topProfitVsTrustDivergencePreview: [],
      })
    ).json()) as OracleInvoice;
    const digest = "A".repeat(44);
    await expect(
      redeemOraclePayment(request(), marketId, digest),
    ).rejects.toMatchObject({ code: "PAYMENT_INVOICE_REQUIRED" });
    fetchMock.mockImplementation(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "verdicto",
        result: {
          digest,
          checkpoint: "1",
          timestampMs: String(Date.now()),
          effects: { status: { status: "success" } },
          balanceChanges: [
            {
              owner: { AddressOwner: recipient },
              coinType: SUI_USDC_COIN_TYPE,
              amount: "10000",
            },
          ],
          transaction: {
            data: {
              sender: recipient,
              transaction: {
                inputs: [
                  {
                    type: "pure",
                    valueType: "string",
                    value: invoice.paymentReference,
                  },
                ],
              },
            },
          },
        },
      }),
    );
    const paidRequest = request({
      authorization: paymentAuthorization({
        method: "sui",
        digest,
        invoice: invoice.invoiceToken,
        id: invoice.id,
        network: "sui:mainnet",
      }),
    });
    const receipt = await redeemOraclePayment(paidRequest, marketId, digest);
    expect(receipt.provider).toBe("tatum");
    await expect(
      consumeOraclePayment({ ...receipt, marketId }),
    ).rejects.toMatchObject({ code: "PAYMENT_REPLAY" });
    await putOracleInvoice({
      id: "another",
      marketId,
      recipient,
      amountBaseUnits: "10000",
      mode: "live",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    await expect(
      consumeOraclePayment({
        ...receipt,
        digest: "B".repeat(44),
        marketId: "wrong",
        invoiceId: "another",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT_INVOICE" });
  });
});
