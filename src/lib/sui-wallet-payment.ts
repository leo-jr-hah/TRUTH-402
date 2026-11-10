import "server-only";

import { createHash } from "node:crypto";
import { Transaction } from "@mysten/sui/transactions";

import { getOraclePaymentConfig, getTatumConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { tatumGrpcClient } from "@/lib/tatum-grpc";
import {
  assertOracleStorageSafety,
  bindOracleWalletTransaction,
  findOracleInvoice,
} from "@/lib/store";
import { invoiceTokenHash } from "@/lib/x402";
import { suiAddressSchema } from "@/lib/validation";
import type { OracleInvoiceRecord } from "@/types/oracle";

function client() {
  return tatumGrpcClient();
}

export async function activeWalletInvoice(
  marketId: string,
  token: string,
): Promise<OracleInvoiceRecord> {
  const config = getOraclePaymentConfig();
  assertOracleStorageSafety(config.mode);
  const invoice = await findOracleInvoice(invoiceTokenHash(token));
  if (
    !invoice ||
    invoice.marketId !== marketId ||
    invoice.recipient !== config.recipient ||
    invoice.mode !== config.mode ||
    invoice.amountBaseUnits !== "10000" ||
    Date.parse(invoice.expiresAt) <= Date.now()
  )
    throw new AppError(
      "INVALID_PAYMENT_INVOICE",
      "Request a fresh invoice for this market before paying.",
      402,
    );
  return invoice;
}

/** Only the public reference is on-chain. The private bearer token is never a PTB input. */
export function invoicePaymentTransaction(
  invoice: OracleInvoiceRecord,
  sender: string,
  coinIds: string[],
) {
  if (!coinIds.length)
    throw new AppError(
      "INSUFFICIENT_USDC",
      "This wallet needs 0.01 native USDC and SUI for gas.",
      422,
    );
  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasBudget(10_000_000);
  const coin = tx.object(coinIds[0]);
  if (coinIds.length > 1)
    tx.mergeCoins(
      coin,
      coinIds.slice(1).map((id) => tx.object(id)),
    );
  const [payment] = tx.splitCoins(coin, [tx.pure.u64(invoice.amountBaseUnits)]);
  // Using the String in a typed Move call makes the pure input auditable in JSON RPC.
  tx.moveCall({
    target: "0x1::string::length",
    arguments: [tx.pure.string(invoice.id)],
  });
  tx.transferObjects([payment], tx.pure.address(invoice.recipient));
  return tx;
}

export async function buildWalletPayment(
  marketId: string,
  token: string,
  rawSender: string,
) {
  const invoice = await activeWalletInvoice(marketId, token);
  const sender = suiAddressSchema.parse(rawSender);
  if (sender === invoice.recipient)
    throw new AppError(
      "INVALID_PAYMENT_SENDER",
      "A self-transfer cannot credit the oracle. Use a separate buyer wallet.",
      422,
    );
  const rpc = client();
  const config = getOraclePaymentConfig();
  const coins: string[] = [];
  let balance = BigInt(0);
  let cursor: string | null | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await rpc.core.listCoins({
      owner: sender,
      coinType: config.coinType,
      limit: 100,
      cursor,
    });
    for (const coin of batch.objects) {
      if (BigInt(coin.balance) <= BigInt(0)) continue;
      coins.push(coin.objectId);
      balance += BigInt(coin.balance);
      if (balance >= BigInt(10000)) break;
    }
    if (balance >= BigInt(10000) || !batch.hasNextPage) break;
    if (!batch.cursor || batch.cursor === cursor)
      throw new AppError(
        "COIN_PAGINATION_FAILED",
        "Wallet coin inventory did not advance.",
        502,
      );
    cursor = batch.cursor;
  }
  if (balance < BigInt(10000))
    throw new AppError(
      "INSUFFICIENT_USDC",
      `Your connected wallet ${sender.slice(0, 8)}...${sender.slice(-6)} holds ${(Number(balance) / 1e6).toFixed(2)} USDC on Sui Mainnet. Add at least 0.01 USDC and a little SUI for gas, then try again.`,
      422,
    );
  const bytes = await invoicePaymentTransaction(invoice, sender, coins).build({
    client: rpc,
  });
  const bytesHash = createHash("sha256").update(bytes).digest("hex");
  await bindOracleWalletTransaction(invoice.id, { sender, bytesHash });
  return {
    bytes: Buffer.from(bytes).toString("base64"),
    network: "sui:mainnet",
    amountBaseUnits: "10000",
    gasBudgetMist: "10000000",
  };
}

export async function executeWalletPayment(
  marketId: string,
  token: string,
  encoded: string,
  signature: string,
) {
  const invoice = await activeWalletInvoice(marketId, token);
  const bytes = Buffer.from(encoded, "base64");
  if (
    !invoice.walletTransaction ||
    createHash("sha256").update(bytes).digest("hex") !==
      invoice.walletTransaction.bytesHash
  )
    throw new AppError(
      "WALLET_TRANSACTION_MISMATCH",
      "Only the exact prepared invoice transaction can be submitted.",
      422,
    );
  // Tatum submits the already-signed bytes. This service never holds a buyer key.
  const outcome = await client().core.executeTransaction({
    transaction: bytes,
    signatures: [signature],
  });
  const result = outcome.Transaction;
  if (!result?.status.success)
    throw new AppError(
      "WALLET_PAYMENT_FAILED",
      "The signed Sui transaction failed. Gas may have been charged; inspect the wallet before retrying.",
      422,
    );
  return { digest: result.digest };
}

export async function confirmWalletPayment(
  marketId: string,
  token: string,
  digest: string,
) {
  await activeWalletInvoice(marketId, token);
  await client().core.waitForTransaction({ digest, timeout: 20000 });
  return { digest };
}
