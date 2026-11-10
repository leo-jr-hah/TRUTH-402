import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as signal } from "@/app/api/oracle/markets/[id]/signal/route";
import { POST as sandbox } from "@/app/api/oracle/markets/[id]/sandbox/route";
import { POST as tradeRoute } from "@/app/api/markets/[id]/trade/route";
import {
  requiresOperator,
  SUI_NATIVE_COIN_TYPE,
  SUI_USDC_COIN_TYPE,
} from "@/lib/config";
import { clearRateLimitState } from "@/lib/request-guards";
import { invalidateInsightsCache } from "@/lib/services/insights";
import { readDatabase, resetStoreForTests } from "@/lib/store";
import { getOracleRevenueLedger, verifySuiPaymentDigest } from "@/lib/tatum";
import {
  authorizeOracleCommit,
  createPaymentChallenge,
  redeemOraclePayment,
} from "@/lib/x402";
import type { OracleInvoice } from "@/types/oracle";

const recipient = `0x${"a".repeat(64)}`;
const digest = "A".repeat(44);
const timestamp = Date.parse("2026-10-25T12:00:00.000Z");
const binding = {
  reference: "a".repeat(64),
  issuedAt: new Date(timestamp).toISOString(),
  expiresAt: new Date(timestamp + 300000).toISOString(),
};
const marketId = "mkt-sports-final";
const preview = {
  participantCount: 3,
  memoryCount: 62,
  preCommitCheckpoint: null,
  topProfitVsTrustDivergencePreview: [],
};
const context = { params: Promise.resolve({ id: marketId }) };
const base = `http://localhost/api/oracle/markets/${marketId}`;
const rpcResult = (result: unknown) =>
  Response.json({ jsonrpc: "2.0", id: "truth402", result });
const fetchMock = vi.fn<typeof fetch>();
function tx(
  offset = 0,
  reference?: string,
  coinType = SUI_USDC_COIN_TYPE,
  amount = "10000",
) {
  return {
    digest,
    checkpoint: "200",
    timestampMs: String(timestamp + offset),
    effects: { status: { status: "success" } },
    balanceChanges: [{ owner: { AddressOwner: recipient }, coinType, amount }],
    ...(reference
      ? {
          transaction: {
            data: {
              sender: recipient,
              transaction: {
                inputs: [
                  { type: "pure", valueType: "string", value: reference },
                ],
              },
            },
          },
        }
      : {}),
  };
}
function live() {
  vi.stubEnv("TRUTH402_TATUM_MODE", "live");
  vi.stubEnv("TATUM_API_KEY", "test-tatum-key");
  vi.stubEnv("TATUM_SUI_RPC_URL", "https://sui-mainnet.gateway.tatum.io");
  vi.stubEnv("SUI_ORACLE_ADDRESS", recipient);
}

describe("live payment modes and explicit judge grants", () => {
  let directory: string | undefined;
  beforeEach(async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await resetStoreForTests();
    invalidateInsightsCache();
    clearRateLimitState();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });
  async function durable() {
    directory = await mkdtemp(path.join(tmpdir(), "truth402-payment-modes-"));
    vi.stubEnv("TRUTH402_STORAGE_MODE", "file");
    vi.stubEnv("TRUTH402_DATA_FILE", path.join(directory, "state.json"));
    vi.stubEnv("TRUTH402_ORACLE_SINGLE_INSTANCE", "true");
    vi.stubEnv("VERCEL", "");
  }
  it.each([
    [-60001, false],
    [-60000, true],
    [0, true],
    [300000, true],
    [300001, false],
  ])(
    "checks relaxed settlement offset %i and does not require a PTB reference",
    async (offset, accepted) => {
      live();
      vi.stubEnv("TRUTH402_REQUIRE_STRICT_PTB_BINDING", "false");
      fetchMock.mockResolvedValue(rpcResult(tx(offset)));
      const result = verifySuiPaymentDigest(
        digest,
        recipient,
        "10000",
        binding,
      );
      if (accepted)
        expect(await result).toMatchObject({
          bindingVerified: "time-window-and-single-use-digest",
          coinType: SUI_USDC_COIN_TYPE,
        });
      else
        await expect(result).rejects.toMatchObject({
          code: "PAYMENT_BINDING_FAILED",
        });
    },
  );
  it.each([
    [-1, false],
    [0, true],
    [300000, true],
    [300001, false],
  ])("preserves strict PTB timestamp boundary %i", async (offset, accepted) => {
    live();
    vi.stubEnv("TRUTH402_REQUIRE_STRICT_PTB_BINDING", "true");
    fetchMock.mockResolvedValue(rpcResult(tx(offset, binding.reference)));
    const result = verifySuiPaymentDigest(digest, recipient, "10000", binding);
    if (accepted)
      expect(await result).toMatchObject({ bindingVerified: "ptb-reference" });
    else
      await expect(result).rejects.toMatchObject({
        code: "PAYMENT_BINDING_FAILED",
      });
  });
  it("prefers the PTB label in relaxed mode and rejects wrong references in strict mode", async () => {
    live();
    vi.stubEnv("TRUTH402_REQUIRE_STRICT_PTB_BINDING", "false");
    fetchMock.mockResolvedValue(rpcResult(tx(0, binding.reference)));
    expect(
      (await verifySuiPaymentDigest(digest, recipient, "10000", binding))
        .bindingVerified,
    ).toBe("ptb-reference");
    vi.stubEnv("TRUTH402_REQUIRE_STRICT_PTB_BINDING", "true");
    fetchMock.mockImplementation(async () => rpcResult(tx(0, "b".repeat(64))));
    await expect(
      verifySuiPaymentDigest(digest, recipient, "10000", binding),
    ).rejects.toMatchObject({ code: "PAYMENT_BINDING_FAILED" });
    await expect(
      verifySuiPaymentDigest(digest, recipient, "10000", {
        ...binding,
        issuedAt: "invalid",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_BINDING_FAILED" });
  });
  it("accepts typed Move Strings and fails closed when strict configuration is unset or misspelled", async () => {
    live();
    const typed = tx(0, binding.reference);
    typed.transaction!.data.transaction.inputs[0].valueType =
      "0x1::string::String";
    fetchMock.mockImplementation(async () => rpcResult(typed));
    expect(
      (await verifySuiPaymentDigest(digest, recipient, "10000", binding))
        .bindingVerified,
    ).toBe("ptb-reference");
    for (const value of ["", "FALSE", "typo"]) {
      vi.stubEnv("TRUTH402_REQUIRE_STRICT_PTB_BINDING", value);
      fetchMock.mockImplementation(async () => rpcResult(tx()));
      await expect(
        verifySuiPaymentDigest(digest, recipient, "10000", binding),
      ).rejects.toMatchObject({ code: "PAYMENT_BINDING_FAILED" });
    }
  });
  it("permits only explicitly enabled native SUI credit of at least 1,000,000 MIST", async () => {
    live();
    fetchMock.mockImplementation(async () =>
      rpcResult(tx(0, binding.reference, SUI_NATIVE_COIN_TYPE, "1000000")),
    );
    await expect(
      verifySuiPaymentDigest(digest, recipient, "10000", binding),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_VERIFIED" });
    vi.stubEnv("SUI_ALLOW_ANY_COIN_FALLBACK", "true");
    expect(
      await verifySuiPaymentDigest(digest, recipient, "10000", binding),
    ).toMatchObject({
      coinType: SUI_NATIVE_COIN_TYPE,
      amountBaseUnits: "1000000",
      invoiceAmountMicroUsdc: "10000",
    });
    for (const value of [
      tx(0, binding.reference, SUI_NATIVE_COIN_TYPE, "999999"),
      tx(0, binding.reference, "0x2::fake::USDC", "999999999"),
      {
        ...tx(0, binding.reference, SUI_NATIVE_COIN_TYPE, "1000000"),
        effects: { status: { status: "failure" } },
      },
      {
        ...tx(0, binding.reference, SUI_NATIVE_COIN_TYPE, "1000000"),
        balanceChanges: [
          {
            owner: { AddressOwner: `0x${"b".repeat(64)}` },
            coinType: SUI_NATIVE_COIN_TYPE,
            amount: "1000000",
          },
        ],
      },
    ]) {
      fetchMock.mockResolvedValue(rpcResult(value));
      await expect(
        verifySuiPaymentDigest(digest, recipient, "10000", binding),
      ).rejects.toMatchObject({ code: "PAYMENT_NOT_VERIFIED" });
    }
  });
  it("atomically rejects a replay in relaxed mode and keeps MIST out of USDC revenue", async () => {
    live();
    await durable();
    vi.stubEnv("TRUTH402_REQUIRE_STRICT_PTB_BINDING", "false");
    vi.stubEnv("SUI_ALLOW_ANY_COIN_FALLBACK", "true");
    const invoice = (await (
      await createPaymentChallenge(marketId, preview)
    ).json()) as OracleInvoice;
    fetchMock.mockImplementation(async () =>
      rpcResult({
        ...tx(0, undefined, SUI_NATIVE_COIN_TYPE, "1000000"),
        timestampMs: String(Date.now()),
      }),
    );
    const request = () =>
      new Request(`${base}/signal`, {
        headers: {
          "x-payment-digest": digest,
          "x-payment-invoice": invoice.invoiceToken,
        },
      });
    const results = await Promise.allSettled([
      redeemOraclePayment(request(), marketId, digest),
      redeemOraclePayment(request(), marketId, digest),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "PAYMENT_REPLAY" },
    });
    fetchMock.mockImplementation(async (_url, init) =>
      rpcResult(
        JSON.parse(init!.body as string).method === "suix_getAllBalances"
          ? []
          : { data: [], hasNextPage: false },
      ),
    );
    expect(await getOracleRevenueLedger()).toMatchObject({
      attributedRevenueMicroUsdc: "0",
      attributedSuiMist: "1000000",
    });
  });
  it("does not let a client-supplied sponsored header turn a fake digest into live payment", async () => {
    live();
    await durable();
    vi.stubEnv("TRUTH402_PUBLIC_JUDGE_MODE", "true");
    const invoice = (await (
      await createPaymentChallenge(marketId, preview)
    ).json()) as OracleInvoice;
    const response = await signal(
      new Request(`${base}/signal`, {
        headers: {
          "x-payment-digest": "demo-sui-tx-fakepayment",
          "x-payment-invoice": invoice.invoiceToken,
          "x-oracle-ui-relayer": "sponsored",
          "x-sponsored-sandbox": "true",
        },
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect((await readDatabase()).oraclePaymentReceipts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("grants an explicit public sandbox with a real checkpoint observation and no payment or royalty ledger entry", async () => {
    live();
    await durable();
    vi.stubEnv("TRUTH402_PUBLIC_JUDGE_MODE", "true");
    const invoice = (await (
      await createPaymentChallenge(marketId, preview)
    ).json()) as OracleInvoice;
    fetchMock.mockResolvedValue(rpcResult("777"));
    const request = (origin = "http://localhost") =>
      new Request(`${base}/sandbox`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          "x-oracle-ui-relayer": "sponsored",
        },
        body: JSON.stringify({ invoiceToken: invoice.invoiceToken }),
      });
    expect(
      (await sandbox(request("https://other.example"), context)).status,
    ).toBe(403);
    const result = await sandbox(request(), context);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      paymentReceipt: null,
      sandbox: {
        provider: "tatum",
        checkpoint: "777",
        paymentVerified: false,
        fundsMoved: false,
      },
    });
    expect((await readDatabase()).oraclePaymentReceipts).toHaveLength(0);
    expect((await sandbox(request(), context)).status).toBe(402);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).method).toBe(
      "sui_getLatestCheckpointSequenceNumber",
    );
    vi.stubEnv("TRUTH402_PUBLIC_JUDGE_MODE", "false");
    expect((await sandbox(request(), context)).status).toBe(403);
  });
  it("makes public judge authorization explicit while an operator lock overrides it", async () => {
    vi.stubEnv("TRUTH402_AI_MODE", "live");
    vi.stubEnv("TRUTH402_PUBLIC_JUDGE_MODE", "true");
    expect(requiresOperator()).toBe(false);
    expect(() => authorizeOracleCommit(new Request(base))).not.toThrow();
    const market = (await readDatabase()).markets.find(
      (m) => m.id === marketId,
    )!;
    const response = await tradeRoute(
      new Request(`http://localhost/api/markets/${marketId}/trade`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          outcomeId: market.outcomes[0].id,
          amount: 5,
          displayName: "Calibrated Trader",
          role: "trader",
        }),
      }),
      context,
    );
    expect(response.status).toBe(201);
    vi.stubEnv("TRUTH402_REQUIRE_OPERATOR_TOKEN", "true");
    expect(requiresOperator()).toBe(true);
    expect(() => authorizeOracleCommit(new Request(base))).toThrow();
    vi.stubEnv("TRUTH402_REQUIRE_OPERATOR_TOKEN", "");
    vi.stubEnv("TRUTH402_PUBLIC_JUDGE_MODE", "false");
    expect(requiresOperator()).toBe(true);
  });
  it("keeps a judge invoice available when the live checkpoint read fails", async () => {
    live();
    await durable();
    vi.stubEnv("TRUTH402_PUBLIC_JUDGE_MODE", "true");
    const invoice = (await (
      await createPaymentChallenge(marketId, preview)
    ).json()) as OracleInvoice;
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    const response = await sandbox(
      new Request(`${base}/sandbox`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-oracle-ui-relayer": "sponsored",
        },
        body: JSON.stringify({ invoiceToken: invoice.invoiceToken }),
      }),
      context,
    );
    expect(response.status).toBe(502);
    const database = await readDatabase();
    expect(
      database.oracleInvoices?.some((entry) => entry.id === invoice.id),
    ).toBe(true);
    expect(database.oraclePaymentReceipts).toHaveLength(0);
  });
});
