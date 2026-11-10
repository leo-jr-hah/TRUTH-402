import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEMO_ORACLE_ADDRESS,
  getOraclePaymentConfig,
  SUI_USDC_COIN_TYPE,
  TATUM_SUI_MAINNET_URL,
} from "@/lib/config";
import { resetStoreForTests } from "@/lib/store";
import {
  checkTatumSui,
  fetchTatumPredictionLeaderboard,
  fetchTatumWalletClosedPositions,
  getOracleRevenueLedger,
  verifyPreCommitmentOnSui,
  verifySuiPaymentDigest,
  fetchTatumWalletPositions,
  fetchTatumWalletTrades,
  fetchTatumMarketTopHolders,
  syncTatumPredictionData,
} from "@/lib/tatum";

const digest = "A".repeat(44);
const recipient = `0x${"a".repeat(64)}`;
const wallet = `0x${"a".repeat(40)}`;
const secret = "test-tatum-key-not-a-real-secret";
const timestampMs = "1792929600000";
const fetchMock = vi.fn<typeof fetch>();

function live() {
  vi.stubEnv("VERDICTO_TATUM_MODE", "live");
  vi.stubEnv("TATUM_API_KEY", secret);
  vi.stubEnv("TATUM_SUI_RPC_URL", TATUM_SUI_MAINNET_URL);
  vi.stubEnv("SUI_ORACLE_ADDRESS", recipient);
}

function rpcResult(result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: "verdicto", result });
}

function tx(overrides: Record<string, unknown> = {}) {
  return {
    digest,
    effects: { status: { status: "success" } },
    checkpoint: "100",
    timestampMs,
    balanceChanges: [
      {
        owner: { AddressOwner: recipient },
        coinType: SUI_USDC_COIN_TYPE,
        amount: "10000",
      },
    ],
    ...overrides,
  };
}

describe("Tatum four-pillar adapters", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await resetStoreForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps all demo adapters deterministic and entirely offline", async () => {
    const stamp = await verifyPreCommitmentOnSui("forecast:abc");
    expect(stamp).toEqual(await verifyPreCommitmentOnSui("forecast:abc"));
    expect(stamp).toMatchObject({ provider: "demo", contentBound: false });
    expect(await checkTatumSui()).toMatchObject({ mode: "demo" });
    const receipt = await verifySuiPaymentDigest(
      "demo-sui-tx-abcdef",
      DEMO_ORACLE_ADDRESS,
      "10000",
    );
    expect(receipt).toEqual(
      await verifySuiPaymentDigest(
        "demo-sui-tx-abcdef",
        DEMO_ORACLE_ADDRESS,
        "10000",
      ),
    );
    expect(await getOracleRevenueLedger()).toMatchObject({
      provider: "demo",
      balanceMicroUsdc: "0",
      entries: [],
    });
    const traders = await fetchTatumPredictionLeaderboard();
    expect(traders).toHaveLength(6);
    expect(
      await fetchTatumWalletClosedPositions(traders[0].wallet),
    ).toHaveLength(2);
    expect(
      await fetchTatumWalletClosedPositions(traders[1].wallet),
    ).toHaveLength(42);
    const source = await syncTatumPredictionData();
    expect(source.openPositions).toHaveLength(6);
    expect(source.topHolders).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads checkpoint timestamps and does not falsely claim content anchoring", async () => {
    live();
    fetchMock
      .mockResolvedValueOnce(rpcResult("101"))
      .mockResolvedValueOnce(rpcResult({ sequenceNumber: "101", timestampMs }));
    expect(await verifyPreCommitmentOnSui("forecast:abc")).toMatchObject({
      provider: "tatum",
      checkpoint: "101",
      timestamp: new Date(Number(timestampMs)).toISOString(),
      verification: "checkpoint-observation",
      contentBound: false,
    });
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(TATUM_SUI_MAINNET_URL);
    expect(call[1]).toMatchObject({
      redirect: "error",
      headers: { "x-api-key": secret },
    });
    expect(JSON.parse(call[1]!.body as string).method).toBe(
      "sui_getLatestCheckpointSequenceNumber",
    );
  });

  it("verifies transaction inclusion and observes objects without confusing them with forecast proof", async () => {
    live();
    fetchMock
      .mockResolvedValueOnce(rpcResult("101"))
      .mockResolvedValueOnce(rpcResult({ sequenceNumber: "101", timestampMs }))
      .mockResolvedValueOnce(rpcResult(tx()));
    expect(await verifyPreCommitmentOnSui(digest)).toMatchObject({
      checkpoint: "100",
      identifierVerified: true,
      verification: "transaction-inclusion",
      contentBound: false,
    });
    fetchMock
      .mockResolvedValueOnce(rpcResult("101"))
      .mockResolvedValueOnce(rpcResult({ sequenceNumber: "101", timestampMs }))
      .mockResolvedValueOnce(
        rpcResult({ data: { objectId: recipient, version: "1", digest } }),
      );
    expect(await verifyPreCommitmentOnSui(recipient)).toMatchObject({
      verification: "object-observation",
      identifierVerified: true,
      contentBound: false,
    });
  });

  it("verifies native USDC using BigInt and exact recipient ownership", async () => {
    live();
    fetchMock.mockResolvedValue(rpcResult(tx()));
    expect(
      await verifySuiPaymentDigest(
        digest,
        recipient.toUpperCase().replace("0X", "0x"),
        "10000",
      ),
    ).toMatchObject({ provider: "tatum", amountBaseUnits: "10000", digest });
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]!.body as string).params,
    ).toEqual([
      digest,
      { showEffects: true, showBalanceChanges: true, showInput: true },
    ]);
    const huge = "900719925474099312345";
    fetchMock.mockResolvedValue(
      rpcResult(
        tx({
          balanceChanges: [
            {
              owner: { AddressOwner: recipient },
              coinType: SUI_USDC_COIN_TYPE,
              amount: huge,
            },
          ],
        }),
      ),
    );
    expect(
      (await verifySuiPaymentDigest(digest, recipient, huge)).amountBaseUnits,
    ).toBe(huge);
  });

  it.each([
    { effects: { status: { status: "failure" } } },
    { digest: "B".repeat(44) },
    { balanceChanges: [] },
    {
      balanceChanges: [
        {
          owner: { AddressOwner: recipient },
          coinType: "0x2::sui::SUI",
          amount: "1000000000",
        },
      ],
    },
    {
      balanceChanges: [
        {
          owner: { AddressOwner: `0x${"b".repeat(64)}` },
          coinType: SUI_USDC_COIN_TYPE,
          amount: "10000",
        },
      ],
    },
    {
      balanceChanges: [
        {
          owner: { ObjectOwner: recipient },
          coinType: SUI_USDC_COIN_TYPE,
          amount: "10000",
        },
      ],
    },
    {
      balanceChanges: [
        {
          owner: { AddressOwner: recipient },
          coinType: SUI_USDC_COIN_TYPE,
          amount: "9999",
        },
      ],
    },
    {
      balanceChanges: [
        {
          owner: { AddressOwner: recipient },
          coinType: SUI_USDC_COIN_TYPE,
          amount: "10000",
        },
        {
          owner: { AddressOwner: recipient },
          coinType: SUI_USDC_COIN_TYPE,
          amount: "-1",
        },
      ],
    },
  ])(
    "rejects insufficient, failed, unrelated or counterfeit payments %j",
    async (overrides) => {
      live();
      fetchMock.mockResolvedValue(rpcResult(tx(overrides)));
      await expect(
        verifySuiPaymentDigest(digest, recipient, "10000"),
      ).rejects.toMatchObject({ code: "PAYMENT_NOT_VERIFIED", status: 402 });
    },
  );

  it("checks an invoice reference and settlement time when required", async () => {
    live();
    const binding = {
      reference: "a".repeat(64),
      issuedAt: new Date(Number(timestampMs) - 1000).toISOString(),
      expiresAt: new Date(Number(timestampMs) + 1000).toISOString(),
    };
    fetchMock.mockResolvedValue(rpcResult(tx()));
    await expect(
      verifySuiPaymentDigest(digest, recipient, "10000", binding),
    ).rejects.toMatchObject({ code: "PAYMENT_BINDING_FAILED" });
    fetchMock.mockResolvedValue(
      rpcResult(
        tx({
          transaction: {
            data: {
              sender: recipient,
              transaction: {
                inputs: [
                  {
                    type: "pure",
                    valueType: "string",
                    value: binding.reference,
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    expect(
      (await verifySuiPaymentDigest(digest, recipient, "10000", binding))
        .provider,
    ).toBe("tatum");
    fetchMock.mockResolvedValueOnce(
      rpcResult(
        tx({
          transaction: {
            data: {
              sender: recipient,
              transaction: {
                inputs: [
                  {
                    type: "pure",
                    valueType: "string",
                    value: binding.reference,
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    await expect(
      verifySuiPaymentDigest(digest, recipient, "10000", {
        ...binding,
        issuedAt: binding.expiresAt,
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_BINDING_FAILED" });
  });

  it("rejects invalid digests and unsafe configuration before making network requests", async () => {
    await expect(
      verifySuiPaymentDigest(digest, recipient, "10000"),
    ).rejects.toMatchObject({ code: "INVALID_DEMO_DIGEST" });
    await expect(
      verifySuiPaymentDigest("demo-sui-tx-abcdef", recipient, "0"),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT_AMOUNT" });
    live();
    await expect(
      verifySuiPaymentDigest("demo-sui-tx-abcdef", recipient, "10000"),
    ).rejects.toMatchObject({ code: "INVALID_SUI_DIGEST" });
    vi.stubEnv("SUI_ORACLE_ADDRESS", "");
    expect(() => getOraclePaymentConfig()).toThrow(/SUI_ORACLE_ADDRESS/u);
    vi.stubEnv("TATUM_SUI_RPC_URL", "https://attacker.example");
    expect(await checkTatumSui()).toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles RPC errors, malformed schemas, HTTP failures and secret-bearing exceptions safely", async () => {
    live();
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          jsonrpc: "2.0",
          id: "verdicto",
          error: { code: -1, message: secret },
        }),
      )
      .mockResolvedValueOnce(rpcResult({ wrong: secret }))
      .mockResolvedValueOnce(new Response(secret, { status: 503 }))
      .mockRejectedValueOnce(new Error(`Bearer ${secret}`));
    for (let index = 0; index < 4; index += 1) {
      const health = await checkTatumSui();
      expect(health.status).toBe("error");
      expect(JSON.stringify(health)).not.toContain(secret);
    }
  });

  it("reads a ledger without counting unrelated credits as oracle revenue", async () => {
    live();
    fetchMock.mockImplementation(async (_url, options) => {
      const method = JSON.parse(options!.body as string).method;
      return method === "suix_getAllBalances"
        ? rpcResult([{ coinType: SUI_USDC_COIN_TYPE, totalBalance: "10000" }])
        : rpcResult({ data: [tx()], hasNextPage: true });
    });
    expect(await getOracleRevenueLedger()).toMatchObject({
      provider: "tatum",
      balanceMicroUsdc: "10000",
      attributedRevenueMicroUsdc: "0",
      partial: true,
      entries: [{ attributed: false }],
    });
  });

  it("maps the documented Prediction API and filters non-binary/unusable entries", async () => {
    live();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            rank: 1,
            proxyWallet: wallet,
            userName: `Trader${String.fromCodePoint(0x2014)}name`,
            vol: 100,
            pnl: 50,
          },
        ],
        pagination: { pageSize: 3 },
      }),
    );
    expect((await fetchTatumPredictionLeaderboard())[0].displayName).toBe(
      "Trader - name",
    );
    const position = {
      proxyWallet: wallet,
      conditionId: "market-1",
      asset: "asset",
      avgPrice: 0.4,
      curPrice: 1,
      totalBought: 40,
      realizedPnl: 60,
      timestamp: 1792929600,
      title: "Final",
      outcome: "Home",
    };
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [
          position,
          { ...position, avgPrice: 0 },
          { ...position, curPrice: 0.5 },
        ],
        pagination: { pageSize: 50 },
      }),
    );
    expect(await fetchTatumWalletClosedPositions(wallet)).toMatchObject([
      {
        realizedEdge: 0.6,
        resolution: 1,
        occurredAt: new Date(1792929600000).toISOString(),
      },
    ]);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `/wallets/${wallet}/history?`,
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ ...position, proxyWallet: `0x${"b".repeat(40)}` }],
        pagination: { pageSize: 50 },
      }),
    );
    await expect(fetchTatumWalletClosedPositions(wallet)).rejects.toMatchObject(
      { code: "PREDICTION_WALLET_MISMATCH" },
    );
    fetchMock.mockResolvedValueOnce(Response.json({ data: secret }));
    await expect(fetchTatumPredictionLeaderboard()).rejects.toThrow(
      "invalid response",
    );
    await expect(
      fetchTatumWalletClosedPositions("../secret"),
    ).rejects.toThrow();
  });

  it("ingests only bounded, well-formed open positions, trade fills and matching holder groups", async () => {
    live();
    const marketId = `0x${"b".repeat(64)}`;
    const position = {
      proxyWallet: wallet,
      conditionId: marketId,
      asset: "123",
      outcome: "YES",
      size: 40,
      curPrice: 0.6,
      redeemable: false,
    };
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [
          position,
          { ...position, redeemable: true },
          { ...position, curPrice: 1 },
        ],
        pagination: { pageSize: 50 },
      }),
    );
    expect(await fetchTatumWalletPositions(wallet)).toMatchObject([
      { wallet, marketId, size: 40, price: 0.6 },
    ]);
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ ...position, proxyWallet: `0x${"c".repeat(40)}` }],
        pagination: { pageSize: 50 },
      }),
    );
    await expect(fetchTatumWalletPositions(wallet)).rejects.toMatchObject({
      code: "PREDICTION_WALLET_MISMATCH",
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ ...position, side: "BUY", price: 0.5, timestamp: 1792929600 }],
        pagination: { pageSize: 50 },
      }),
    );
    expect(await fetchTatumWalletTrades(wallet)).toMatchObject([
      { side: "BUY", price: 0.5 },
    ]);
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            ...position,
            proxyWallet: `0x${"c".repeat(40)}`,
            side: "SELL",
            price: 0.5,
            timestamp: 1792929600,
          },
        ],
        pagination: { pageSize: 50 },
      }),
    );
    await expect(fetchTatumWalletTrades(wallet)).rejects.toMatchObject({
      code: "PREDICTION_WALLET_MISMATCH",
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ token: "123", positions: [position] }],
        pagination: { pageSize: 20 },
      }),
    );
    expect(await fetchTatumMarketTopHolders(marketId)).toMatchObject([
      { marketId, asset: "123", holders: [{ wallet, size: 40 }] },
    ]);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(
      `/markets/${marketId}/positions?`,
    );
    await expect(fetchTatumMarketTopHolders("../bad")).rejects.toThrow();
  });

  it("rejects untrusted Prediction endpoints, future checkpoint hints and unsafe amounts", async () => {
    live();
    vi.stubEnv("TATUM_DATA_API_URL", "https://attacker.example");
    await expect(fetchTatumPredictionLeaderboard()).rejects.toMatchObject({
      code: "TATUM_NOT_PREDICTION_API",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(rpcResult("101"));
    await expect(verifyPreCommitmentOnSui("", "102")).rejects.toMatchObject({
      code: "INVALID_CHECKPOINT_HINT",
    });
    await expect(
      verifySuiPaymentDigest(digest, recipient, 0.5),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT_AMOUNT" });
  });
});
