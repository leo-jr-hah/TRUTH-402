import "server-only";

import { z } from "zod";

import {
  getOraclePaymentConfig,
  getTatumConfig,
  getTatumPredictionConfig,
  TATUM_SUI_MAINNET_URL,
  SUI_USDC_COIN_TYPE,
  SUI_NATIVE_COIN_TYPE,
} from "@/lib/config";
import { AppError } from "@/lib/errors";
import { grpcCall } from "@/lib/tatum-grpc";
import { removeEmDashes } from "@/lib/sanitize";
import { createPredictionFixture } from "@/lib/seed";
import { publicProviderError } from "@/lib/server-secrets";
import { readDatabase } from "@/lib/store";
import {
  demoSuiDigestSchema,
  predictionWalletSchema,
  suiAddressSchema,
  suiDigestSchema,
} from "@/lib/validation";
import type { IntegrationCheck } from "@/types/domain";
import type {
  OracleRevenueLedger,
  PredictionClosedPosition,
  PredictionTrader,
  PredictionOpenPosition,
  PredictionTradeFill,
  PredictionHolderGroup,
  SuiPaymentReceipt,
  SuiVerificationStamp,
} from "@/types/oracle";

const uintSchema = z.string().regex(/^(0|[1-9][0-9]{0,77})$/u);
const signedAmountSchema = z.string().regex(/^-?(0|[1-9][0-9]{0,77})$/u);
const timestampSchema = z
  .string()
  .regex(/^[0-9]{1,16}$/u)
  .refine(
    (value) => Number.isSafeInteger(Number(value)) && Number(value) <= 8.64e15,
  );
const balanceChangeSchema = z.object({
  owner: z.unknown(),
  coinType: z.string(),
  amount: signedAmountSchema,
});
const transactionSchema = z.object({
  digest: suiDigestSchema,
  effects: z.object({
    status: z.object({ status: z.enum(["success", "failure"]) }),
  }),
  checkpoint: uintSchema,
  timestampMs: timestampSchema,
  balanceChanges: z.array(balanceChangeSchema).max(1000).optional(),
  transaction: z
    .object({
      data: z
        .object({
          sender: suiAddressSchema,
          transaction: z
            .object({ inputs: z.array(z.unknown()).max(1000) })
            .passthrough(),
        })
        .passthrough(),
    })
    .optional(),
});

async function rpc<T>(
  method: string,
  params: unknown[],
  schema: z.ZodType<T>,
): Promise<T> {
  const config = getTatumConfig();
  if (config.mode !== "live")
    throw new AppError(
      "LIVE_RPC_DISABLED",
      "RPC is disabled in demo mode.",
      503,
    );
  try {
    return schema.parse(await grpcCall(method, params));
  } catch (error) {
    // No provider response body or Zod value is reflected to a client.
    throw new AppError(
      "TATUM_RPC_FAILED",
      publicProviderError(
        error instanceof z.ZodError
          ? new Error("Tatum RPC returned an invalid response.")
          : error,
        "Tatum RPC request failed.",
      ),
      502,
    );
  }
}

async function transaction(digest: string) {
  return rpc(
    "sui_getTransactionBlock",
    [
      suiDigestSchema.parse(digest),
      { showEffects: true, showBalanceChanges: true, showInput: true },
    ],
    transactionSchema,
  );
}

export async function checkTatumSui(): Promise<IntegrationCheck> {
  const started = performance.now();
  try {
    if (getTatumConfig().mode === "demo")
      return {
        name: "Tatum Sui RPC",
        mode: "demo",
        status: "unconfigured",
        message:
          "Deterministic checkpoint, payment, revenue and prediction fixtures. No Mainnet calls.",
        details: {
          walletCalls: false,
          transactions: false,
          preCommitVerification: "demo",
          paymentVerification: "demo",
          revenueLedger: "demo",
          predictionCalibration: "demo",
        },
      };
    const checkpoint = await rpc(
      "sui_getLatestCheckpointSequenceNumber",
      [],
      uintSchema,
    );
    return {
      name: "Tatum Sui RPC",
      mode: "live",
      status: "healthy",
      message:
        "Read-only Sui Mainnet checkpoint RPC is responding. Other capabilities are verified on demand.",
      latencyMs: Math.round(performance.now() - started),
      details: {
        latestCheckpoint: checkpoint,
        method: "sui_getLatestCheckpointSequenceNumber",
        walletCalls: false,
        signsTransactions: false,
      },
    };
  } catch (error) {
    return {
      name: "Tatum Sui RPC",
      mode: "live",
      status: "error",
      message: publicProviderError(error, "Tatum request failed."),
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

export async function verifyPreCommitmentOnSui(
  identifier: string,
  checkpointHint?: string,
): Promise<SuiVerificationStamp> {
  z.string()
    .max(100)
    .regex(/^[a-zA-Z0-9:_-]*$/u)
    .parse(identifier);
  if (checkpointHint !== undefined) uintSchema.parse(checkpointHint);
  if (getTatumConfig().mode === "demo")
    return {
      provider: "demo",
      network: "sui:mainnet",
      checkpoint: "402000000",
      timestamp: "2026-10-25T12:00:00.000Z",
      timestampMs: String(Date.parse("2026-10-25T12:00:00.000Z")),
      identifier,
      identifierVerified: false,
      verification: "checkpoint-observation",
      contentBound: false,
      epoch: "402",
      verifiedAt: "2026-10-25T12:00:00.000Z",
      rpcEndpoint: "demo:no-network",
    };
  const latest = await rpc(
    "sui_getLatestCheckpointSequenceNumber",
    [],
    uintSchema,
  );
  if (checkpointHint && BigInt(checkpointHint) > BigInt(latest))
    throw new AppError(
      "INVALID_CHECKPOINT_HINT",
      "Checkpoint hint cannot be in the future.",
      422,
    );
  const checkpointNumber = checkpointHint ?? latest;
  const checkpoint = await rpc(
    "sui_getCheckpoint",
    [checkpointNumber],
    z.object({
      sequenceNumber: uintSchema,
      timestampMs: timestampSchema,
      epoch: uintSchema.optional(),
    }),
  );
  if (checkpoint.sequenceNumber !== checkpointNumber)
    throw new AppError(
      "CHECKPOINT_MISMATCH",
      "Tatum returned a different checkpoint.",
      502,
    );
  let verification: SuiVerificationStamp["verification"] =
    "checkpoint-observation";
  let sequence = checkpoint.sequenceNumber;
  let timestamp = checkpoint.timestampMs;
  let identifierVerified = false;
  if (/^0x[0-9a-fA-F]{64}$/u.test(identifier)) {
    const object = await rpc(
      "sui_getObject",
      [identifier, { showContent: true }],
      z.object({
        data: z.object({
          objectId: suiAddressSchema,
          version: uintSchema,
          digest: z.string().min(1),
        }),
      }),
    );
    if (object.data.objectId !== identifier.toLowerCase())
      throw new AppError(
        "OBJECT_MISMATCH",
        "Sui object identifier did not match.",
        502,
      );
    verification = "object-observation";
    identifierVerified = true;
  } else if (suiDigestSchema.safeParse(identifier).success) {
    const tx = await transaction(identifier);
    if (
      tx.digest !== identifier ||
      tx.effects.status.status !== "success" ||
      BigInt(tx.checkpoint) > BigInt(latest)
    )
      throw new AppError(
        "COMMIT_NOT_VERIFIED",
        "Sui transaction inclusion could not be verified.",
        422,
      );
    sequence = tx.checkpoint;
    timestamp = tx.timestampMs;
    verification = "transaction-inclusion";
    identifierVerified = true;
  }
  return {
    provider: "tatum",
    network: "sui:mainnet",
    checkpoint: sequence,
    timestamp: new Date(Number(timestamp)).toISOString(),
    timestampMs: timestamp,
    identifier,
    identifierVerified,
    verification,
    contentBound: false,
    ...(checkpoint.epoch && sequence === checkpoint.sequenceNumber
      ? { epoch: checkpoint.epoch }
      : {}),
    verifiedAt: new Date().toISOString(),
    rpcEndpoint: TATUM_SUI_MAINNET_URL,
  };
}

function creditedAmount(
  changes: z.infer<typeof balanceChangeSchema>[],
  recipient: string,
  coinType = SUI_USDC_COIN_TYPE,
): bigint {
  return changes.reduce((sum, change) => {
    const owner = z
      .object({ AddressOwner: suiAddressSchema })
      .safeParse(change.owner);
    return owner.success &&
      owner.data.AddressOwner === recipient &&
      change.coinType === coinType
      ? sum + BigInt(change.amount)
      : sum;
  }, BigInt(0));
}

export interface PaymentBinding {
  /** SHA-256 of the secret invoice token, included as a pure string in the PTB. */
  reference: string;
  issuedAt: string;
  expiresAt: string;
}

export async function verifySuiPaymentDigest(
  digest: string,
  recipientAddress: string,
  amountMicroUsdc: string | number,
  binding?: PaymentBinding,
): Promise<SuiPaymentReceipt> {
  const recipient = suiAddressSchema.parse(recipientAddress);
  if (
    typeof amountMicroUsdc === "number" &&
    !Number.isSafeInteger(amountMicroUsdc)
  )
    throw new AppError(
      "INVALID_PAYMENT_AMOUNT",
      "Payment amount must be a safe integer in micro-USDC.",
      400,
    );
  const amount = uintSchema.parse(String(amountMicroUsdc));
  if (BigInt(amount) <= BigInt(0))
    throw new AppError(
      "INVALID_PAYMENT_AMOUNT",
      "Payment amount must be positive.",
      400,
    );
  const config = getTatumConfig();
  if (config.mode === "demo") {
    if (!demoSuiDigestSchema.safeParse(digest).success)
      throw new AppError(
        "INVALID_DEMO_DIGEST",
        "Demo mode requires a demo Sui transaction digest.",
        400,
      );
    return {
      provider: "demo",
      network: "sui:mainnet",
      digest,
      recipient,
      amountBaseUnits: amount,
      coinType: SUI_USDC_COIN_TYPE,
      checkpoint: "402000000",
      timestamp: "2026-10-25T12:00:00.000Z",
      verifiedAt: "2026-10-25T12:00:00.000Z",
      latencyMs: 0,
    };
  }
  if (!suiDigestSchema.safeParse(digest).success)
    throw new AppError(
      "INVALID_SUI_DIGEST",
      "Live mode requires a valid Sui Mainnet transaction digest.",
      400,
    );
  const started = performance.now();
  const tx = await transaction(digest);
  const usdcCredit = creditedAmount(tx.balanceChanges ?? [], recipient);
  const suiCredit = creditedAmount(
    tx.balanceChanges ?? [],
    recipient,
    SUI_NATIVE_COIN_TYPE,
  );
  const fallback =
    usdcCredit < BigInt(amount) &&
    process.env.SUI_ALLOW_ANY_COIN_FALLBACK === "true" &&
    suiCredit >= BigInt(1_000_000);
  const credited = fallback ? suiCredit : usdcCredit;
  if (
    tx.digest !== digest ||
    tx.effects.status.status !== "success" ||
    (!fallback && usdcCredit < BigInt(amount))
  )
    throw new AppError(
      "PAYMENT_NOT_VERIFIED",
      "Transaction must successfully credit native USDC to the recipient, or at least 1,000,000 MIST when the native-SUI fallback is explicitly enabled.",
      402,
    );
  let bindingVerified: SuiPaymentReceipt["bindingVerified"];
  if (binding) {
    const included = tx.transaction?.data.transaction.inputs.some((input) => {
      const pure = z
        .object({
          type: z.literal("pure"),
          valueType: z.string().regex(/^(string|0x0*1::string::String)$/u),
          value: z.literal(binding.reference),
        })
        .safeParse(input);
      return pure.success;
    });
    const paidAt = Number(tx.timestampMs);
    const strict = process.env.TRUTH402_REQUIRE_STRICT_PTB_BINDING !== "false";
    const issuedAt = Date.parse(binding.issuedAt);
    const expiresAt = Date.parse(binding.expiresAt);
    if (
      !/^[a-f0-9]{64}$/u.test(binding.reference) ||
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= issuedAt ||
      (!included && strict) ||
      paidAt < issuedAt - (strict ? 0 : 60_000) ||
      paidAt > expiresAt
    )
      throw new AppError(
        "PAYMENT_BINDING_FAILED",
        "The transaction must satisfy the configured invoice binding and settlement time window.",
        402,
      );
    bindingVerified = included
      ? "ptb-reference"
      : "time-window-and-single-use-digest";
  }
  return {
    provider: "tatum",
    network: "sui:mainnet",
    digest,
    recipient,
    amountBaseUnits: credited.toString(),
    coinType: fallback ? SUI_NATIVE_COIN_TYPE : SUI_USDC_COIN_TYPE,
    invoiceAmountMicroUsdc: amount,
    ...(bindingVerified ? { bindingVerified } : {}),
    checkpoint: tx.checkpoint,
    timestamp: new Date(Number(tx.timestampMs)).toISOString(),
    verifiedAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started),
  };
}

export async function getOracleRevenueLedger(): Promise<OracleRevenueLedger> {
  const config = getOraclePaymentConfig();
  const receipts = ((await readDatabase()).oraclePaymentReceipts ?? []).filter(
    (receipt) =>
      receipt.provider === (config.mode === "demo" ? "demo" : "tatum") &&
      receipt.recipient === config.recipient,
  );
  const usdcReceipts = receipts.filter(
    (receipt) => receipt.coinType === SUI_USDC_COIN_TYPE,
  );
  const attributed = usdcReceipts
    .reduce((sum, receipt) => sum + BigInt(receipt.amountBaseUnits), BigInt(0))
    .toString();
  const accounted = usdcReceipts.flatMap((receipt) =>
    receipt.incentiveEconomics ? [receipt.incentiveEconomics] : [],
  );
  const sum = (pick: (entry: (typeof accounted)[number]) => bigint) =>
    accounted
      .reduce((total, entry) => total + pick(entry), BigInt(0))
      .toString();
  const royaltyAccounting: OracleRevenueLedger["royaltyAccounting"] = {
    status: "accrual-only",
    protocolFeeMicroUsdc: sum((entry) => BigInt(entry.protocolFeeMicroUsdc)),
    backerPoolMicroUsdc: sum((entry) => BigInt(entry.backerPoolMicroUsdc)),
    allocatedRoyaltiesMicroUsdc: sum((entry) =>
      entry.forecasterRoyalties.reduce(
        (total, royalty) => total + BigInt(royalty.royaltyMicroUsdc),
        BigInt(0),
      ),
    ),
    unallocatedBackerPoolMicroUsdc: sum((entry) =>
      BigInt(entry.unallocatedBackerPoolMicroUsdc),
    ),
    paidOutMicroUsdc: "0",
  };
  const attributedSuiMist = receipts
    .filter((receipt) => receipt.coinType === SUI_NATIVE_COIN_TYPE)
    .reduce(
      (total, receipt) => total + BigInt(receipt.amountBaseUnits),
      BigInt(0),
    )
    .toString();
  if (config.mode === "demo")
    return {
      provider: "demo",
      recipient: config.recipient,
      balanceMicroUsdc: attributed,
      attributedRevenueMicroUsdc: attributed,
      royaltyAccounting,
      attributedSuiMist,
      entries: receipts.map((receipt) => ({
        digest: receipt.digest,
        amountBaseUnits: receipt.amountBaseUnits,
        timestamp: receipt.timestamp,
        attributed: true,
        ...(receipt.incentiveEconomics
          ? { incentiveEconomics: receipt.incentiveEconomics }
          : {}),
      })),
      partial: false,
    };
  const [balances, transactions] = await Promise.all([
    rpc(
      "suix_getAllBalances",
      [config.recipient],
      z.array(z.object({ coinType: z.string(), totalBalance: uintSchema })),
    ),
    rpc(
      "suix_queryTransactionBlocks",
      [
        {
          filter: { ToAddress: config.recipient },
          options: { showEffects: true, showBalanceChanges: true },
        },
        null,
        50,
        true,
      ],
      z.object({
        data: z.array(transactionSchema).max(50),
        hasNextPage: z.boolean(),
      }),
    ),
  ]);
  return {
    provider: "tatum",
    recipient: config.recipient,
    balanceMicroUsdc:
      balances.find((balance) => balance.coinType === SUI_USDC_COIN_TYPE)
        ?.totalBalance ?? "0",
    attributedRevenueMicroUsdc: attributed,
    royaltyAccounting,
    attributedSuiMist,
    entries: transactions.data
      .filter(
        (tx) =>
          tx.effects.status.status === "success" &&
          creditedAmount(tx.balanceChanges ?? [], config.recipient) > BigInt(0),
      )
      .map((tx) => ({
        digest: tx.digest,
        amountBaseUnits: creditedAmount(
          tx.balanceChanges ?? [],
          config.recipient,
        ).toString(),
        timestamp: new Date(Number(tx.timestampMs)).toISOString(),
        attributed: usdcReceipts.some(
          (receipt) => receipt.digest === tx.digest,
        ),
        incentiveEconomics: usdcReceipts.find(
          (receipt) => receipt.digest === tx.digest,
        )?.incentiveEconomics,
      })),
    partial: transactions.hasNextPage,
  };
}

async function prediction<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const config = getTatumPredictionConfig();
  if (config.mode !== "live")
    throw new AppError(
      "LIVE_PREDICTION_DISABLED",
      "Prediction network requests are disabled in demo mode.",
      503,
    );
  try {
    const response = await fetch(`${config.dataUrl}${path}`, {
      headers: { "x-api-key": config.apiKey },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`Tatum Prediction returned HTTP ${response.status}.`);
    return schema.parse(await response.json());
  } catch (error) {
    throw new AppError(
      "TATUM_PREDICTION_FAILED",
      publicProviderError(
        error instanceof z.ZodError
          ? new Error("Tatum Prediction returned an invalid response.")
          : error,
      ),
      502,
    );
  }
}

export async function fetchTatumPredictionLeaderboard(): Promise<
  PredictionTrader[]
> {
  if (getTatumConfig().mode === "demo")
    return createPredictionFixture().traders;
  const response = await prediction(
    "/top-traders?category=CRYPTO&timePeriod=MONTH&orderBy=PNL&limit=6&offset=0",
    z.object({
      data: z
        .array(
          z.object({
            rank: z.number().int().positive(),
            proxyWallet: predictionWalletSchema,
            userName: z.string().max(200).nullable(),
            vol: z.number().nonnegative(),
            pnl: z.number(),
          }),
        )
        .max(6),
      pagination: z.object({ pageSize: z.number().int() }),
    }),
  );
  return response.data.map((trader) => ({
    provider: "tatum",
    wallet: trader.proxyWallet,
    displayName: removeEmDashes(trader.userName || trader.proxyWallet),
    profitRank: trader.rank,
    volumeUsd: trader.vol,
    pnlUsd: trader.pnl,
  }));
}

export async function fetchTatumWalletClosedPositions(
  address: string,
): Promise<PredictionClosedPosition[]> {
  const wallet = predictionWalletSchema.parse(address);
  if (getTatumConfig().mode === "demo")
    return createPredictionFixture().positions.filter(
      (position) => position.wallet === wallet,
    );
  // Official Tatum v4 uses /history, not /closed-positions. One bounded page.
  const response = await prediction(
    `/wallets/${wallet}/history?limit=50&offset=0&sortBy=TIMESTAMP&sortDirection=DESC`,
    z.object({
      data: z
        .array(
          z.object({
            proxyWallet: predictionWalletSchema,
            conditionId: z.string().min(1).max(100),
            asset: z.string().min(1).max(100),
            avgPrice: z.number().min(0).max(1),
            curPrice: z.number().min(0).max(1),
            totalBought: z.number().nonnegative(),
            realizedPnl: z.number(),
            timestamp: z.number().int().nonnegative().max(8.64e12),
            title: z.string().max(1000).nullable(),
            outcome: z.string().max(300).nullable(),
          }),
        )
        .max(50),
      pagination: z.object({ pageSize: z.number().int() }),
    }),
  );
  if (response.data.some((position) => position.proxyWallet !== wallet))
    throw new AppError(
      "PREDICTION_WALLET_MISMATCH",
      "Tatum returned positions for a different wallet.",
      502,
    );
  return response.data
    .filter(
      (position) =>
        position.avgPrice > 0 &&
        position.avgPrice < 1 &&
        (position.curPrice === 0 || position.curPrice === 1),
    )
    .map((position) => ({
      provider: "tatum",
      wallet,
      marketId: position.conditionId,
      asset: position.asset,
      marketTitle: removeEmDashes(position.title || position.conditionId),
      outcome: removeEmDashes(position.outcome || "Resolved outcome"),
      entryPrice: position.avgPrice,
      resolution: position.curPrice as 0 | 1,
      realizedEdge: position.curPrice - position.avgPrice,
      conviction: position.totalBought,
      realizedPnlUsd: position.realizedPnl,
      occurredAt: new Date(position.timestamp * 1000).toISOString(),
    }));
}

const predictionMarketIdSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u)
  .transform((value) => value.toLowerCase());
const predictionAssetSchema = z.string().min(1).max(100);
const pageSchema = z.object({ pageSize: z.number().int().nonnegative() });

export async function fetchTatumWalletPositions(
  address: string,
): Promise<PredictionOpenPosition[]> {
  const wallet = predictionWalletSchema.parse(address);
  if (getTatumConfig().mode === "demo")
    return [
      {
        provider: "demo",
        wallet,
        marketId: `0x${"a".repeat(64)}`,
        asset:
          wallet === createPredictionFixture().traders[0].wallet
            ? "demo-no"
            : "demo-yes",
        outcome:
          wallet === createPredictionFixture().traders[0].wallet ? "NO" : "YES",
        size: 250,
        price: 0.55,
        redeemable: false,
      },
    ];
  const response = await prediction(
    `/wallets/${wallet}/positions?limit=50&offset=0&sortBy=TOKENS&sortDirection=DESC`,
    z.object({
      data: z
        .array(
          z.object({
            proxyWallet: predictionWalletSchema,
            conditionId: predictionMarketIdSchema,
            asset: predictionAssetSchema,
            outcome: z.string().max(300).nullable(),
            size: z.number().nonnegative(),
            curPrice: z.number().min(0).max(1),
            redeemable: z.boolean(),
          }),
        )
        .max(50),
      pagination: pageSchema,
    }),
  );
  if (response.data.some((row) => row.proxyWallet !== wallet))
    throw new AppError(
      "PREDICTION_WALLET_MISMATCH",
      "Tatum returned positions for a different wallet.",
      502,
    );
  return response.data
    .filter(
      (row) =>
        !row.redeemable && row.size > 0 && row.curPrice > 0 && row.curPrice < 1,
    )
    .map((row) => ({
      provider: "tatum",
      wallet,
      marketId: row.conditionId,
      asset: row.asset,
      outcome: removeEmDashes(row.outcome ?? "Unlabeled"),
      size: row.size,
      price: row.curPrice,
      redeemable: row.redeemable,
    }));
}

export async function fetchTatumWalletTrades(
  address: string,
): Promise<PredictionTradeFill[]> {
  const wallet = predictionWalletSchema.parse(address);
  if (getTatumConfig().mode === "demo")
    return (await fetchTatumWalletPositions(wallet)).map((position) => ({
      provider: "demo",
      wallet,
      marketId: position.marketId,
      asset: position.asset,
      side: "BUY",
      size: position.size,
      price: position.price,
      occurredAt: "2026-10-24T12:00:00.000Z",
    }));
  const response = await prediction(
    `/wallets/${wallet}/trades?limit=50&offset=0&takerOnly=false`,
    z.object({
      data: z
        .array(
          z.object({
            proxyWallet: predictionWalletSchema,
            conditionId: predictionMarketIdSchema,
            asset: predictionAssetSchema,
            side: z.enum(["BUY", "SELL"]),
            size: z.number().nonnegative(),
            price: z.number().min(0).max(1),
            timestamp: z.number().int().nonnegative().max(8.64e12),
          }),
        )
        .max(50),
      pagination: pageSchema,
    }),
  );
  if (response.data.some((row) => row.proxyWallet !== wallet))
    throw new AppError(
      "PREDICTION_WALLET_MISMATCH",
      "Tatum returned trades for a different wallet.",
      502,
    );
  return response.data.map((row) => ({
    provider: "tatum",
    wallet,
    marketId: row.conditionId,
    asset: row.asset,
    side: row.side,
    size: row.size,
    price: row.price,
    occurredAt: new Date(row.timestamp * 1000).toISOString(),
  }));
}

export async function fetchTatumMarketTopHolders(
  id: string,
): Promise<PredictionHolderGroup[]> {
  const marketId = predictionMarketIdSchema.parse(id);
  if (getTatumConfig().mode === "demo")
    return [
      {
        marketId,
        asset: "demo-yes",
        holders: createPredictionFixture()
          .traders.slice(1)
          .map((trader) => ({
            wallet: trader.wallet,
            size: 250,
            outcome: "YES",
          })),
      },
    ];
  // Official v4 calls this /positions, not /top-holders. Limit applies per group.
  const response = await prediction(
    `/markets/${marketId}/positions?limit=20&offset=0&status=OPEN&sortBy=TOKENS&sortDirection=DESC`,
    z.object({
      data: z
        .array(
          z.object({
            token: predictionAssetSchema,
            positions: z
              .array(
                z.object({
                  proxyWallet: predictionWalletSchema,
                  size: z.number().nonnegative(),
                  outcome: z.string().max(300).nullable(),
                }),
              )
              .max(20),
          }),
        )
        .max(12),
      pagination: pageSchema,
    }),
  );
  return response.data.map((group) => ({
    marketId,
    asset: group.token,
    holders: group.positions.map((row) => ({
      wallet: row.proxyWallet,
      size: row.size,
      outcome: removeEmDashes(row.outcome ?? "Unlabeled"),
    })),
  }));
}

/** Bounded, read-only ingestion. External rows are never silently promoted to Walrus evidence. */
export async function syncTatumPredictionData() {
  const traders = await fetchTatumPredictionLeaderboard();
  const wallets = await Promise.all(
    traders.map(async (trader) => {
      const [closed, open, trades] = await Promise.all([
        fetchTatumWalletClosedPositions(trader.wallet),
        fetchTatumWalletPositions(trader.wallet),
        fetchTatumWalletTrades(trader.wallet),
      ]);
      return { closed, open, trades };
    }),
  );
  const openPositions = wallets.flatMap((wallet) => wallet.open);
  const marketIds = [
    ...new Set(openPositions.map((position) => position.marketId)),
  ].slice(0, 3);
  const topHolders = (
    await Promise.all(marketIds.map(fetchTatumMarketTopHolders))
  ).flat();
  return {
    traders,
    closedPositions: wallets.flatMap((wallet) => wallet.closed),
    openPositions,
    trades: wallets.flatMap((wallet) => wallet.trades),
    topHolders,
  };
}
