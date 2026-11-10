import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/oracle/markets/[id]/wallet-payment/route";
import { SUI_USDC_COIN_TYPE } from "@/lib/config";
import { clearRateLimitState } from "@/lib/request-guards";
import { readDatabase, resetStoreForTests } from "@/lib/store";
import {
  buildWalletPayment,
  executeWalletPayment,
  invoicePaymentTransaction,
} from "@/lib/sui-wallet-payment";
import { createPaymentChallenge } from "@/lib/x402";
import type { OracleInvoice } from "@/types/oracle";

const marketId = "mkt-sports-final",
  sender = `0x${"b".repeat(64)}`,
  recipient = `0x${"a".repeat(64)}`;
const preview = {
  participantCount: 3,
  memoryCount: 62,
  preCommitCheckpoint: null,
  topProfitVsTrustDivergencePreview: [],
};
describe("buyer-funded native USDC invoice PTBs", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "truth402-wallet-ptb-"));
    vi.stubEnv("TRUTH402_TATUM_MODE", "live");
    vi.stubEnv("SUI_ORACLE_ADDRESS", recipient);
    vi.stubEnv("TATUM_API_KEY", "test-tatum-key");
    vi.stubEnv("TATUM_SUI_RPC_URL", "https://sui-mainnet.gateway.tatum.io");
    vi.stubEnv("TRUTH402_STORAGE_MODE", "file");
    vi.stubEnv("TRUTH402_DATA_FILE", path.join(directory, "state.json"));
    vi.stubEnv("TRUTH402_ORACLE_SINGLE_INSTANCE", "true");
    vi.stubEnv("VERCEL", "");
    await resetStoreForTests();
    clearRateLimitState();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { force: true, recursive: true });
  });
  const invoice = async () =>
    (await (
      await createPaymentChallenge(marketId, preview)
    ).json()) as OracleInvoice;
  it("transfers exactly 10000 micro-USDC and binds the public invoice reference without its private token", async () => {
    const bill = await invoice();
    const tx = invoicePaymentTransaction(bill, sender, [
      `0x${"1".repeat(64)}`,
      `0x${"2".repeat(64)}`,
    ]);
    const data = tx.getData();
    expect(data.sender).toBe(sender);
    expect(data.gasData.budget).toBe("10000000");
    const serialized = JSON.stringify(data);
    expect(data.commands.map((command) => command.$kind)).toEqual([
      "MergeCoins",
      "SplitCoins",
      "MoveCall",
      "TransferObjects",
    ]);
    const pureInputs = data.inputs.flatMap((input) =>
      input.$kind === "Pure" ? [Buffer.from(input.Pure.bytes, "base64")] : [],
    );
    expect(
      pureInputs.some(
        (bytes) => bytes.subarray(1).toString("utf8") === bill.id,
      ),
    ).toBe(true);
    expect(
      pureInputs.some(
        (bytes) =>
          bytes.length === 8 && bytes.readBigUInt64LE() === BigInt(10000),
      ),
    ).toBe(true);
    expect(serialized).not.toContain(bill.invoiceToken);
    expect(serialized).not.toContain("privateKey");
  });
  it("builds from the buyer's native-USDC coins, stores only a bytes hash, and executes only those exact signed bytes", async () => {
    const bill = await invoice();
    const getCoins = vi
      .spyOn(SuiJsonRpcClient.prototype, "getCoins")
      .mockResolvedValue({
        data: [
          {
            coinType: SUI_USDC_COIN_TYPE,
            coinObjectId: `0x${"1".repeat(64)}`,
            version: "1",
            digest: "A".repeat(44),
            balance: "10000",
            previousTransaction: "A".repeat(44),
          },
        ],
        hasNextPage: false,
        nextCursor: null,
      });
    vi.spyOn(Transaction.prototype, "build").mockResolvedValue(
      new Uint8Array([1, 2, 3]),
    );
    const prepared = await buildWalletPayment(
      marketId,
      bill.invoiceToken,
      sender,
    );
    expect(getCoins).toHaveBeenCalledWith(
      expect.objectContaining({ owner: sender, coinType: SUI_USDC_COIN_TYPE }),
    );
    expect(
      (await readDatabase()).oracleInvoices?.[0].walletTransaction,
    ).toEqual({
      sender,
      bytesHash: createHash("sha256")
        .update(new Uint8Array([1, 2, 3]))
        .digest("hex"),
    });
    const execute = vi
      .spyOn(SuiJsonRpcClient.prototype, "executeTransactionBlock")
      .mockResolvedValue({
        digest: "A".repeat(44),
        effects: { status: { status: "success" } },
      } as Awaited<ReturnType<SuiJsonRpcClient["executeTransactionBlock"]>>);
    await expect(
      executeWalletPayment(marketId, bill.invoiceToken, "AAAA", "BBBB"),
    ).rejects.toMatchObject({ code: "WALLET_TRANSACTION_MISMATCH" });
    expect(execute).not.toHaveBeenCalled();
    expect(
      await executeWalletPayment(
        marketId,
        bill.invoiceToken,
        prepared.bytes,
        "BBBB",
      ),
    ).toEqual({ digest: "A".repeat(44) });
    expect((await readDatabase()).oraclePaymentReceipts).toHaveLength(0);
  });
  it("fails safely for missing funds, expired invoices and cross-origin submissions", async () => {
    const bill = await invoice();
    vi.spyOn(SuiJsonRpcClient.prototype, "getCoins").mockResolvedValue({
      data: [],
      nextCursor: null,
      hasNextPage: false,
    });
    await expect(
      buildWalletPayment(marketId, bill.invoiceToken, sender),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_USDC" });
    await expect(
      buildWalletPayment(marketId, "x".repeat(43), sender),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT_INVOICE" });
    await expect(
      buildWalletPayment(marketId, bill.invoiceToken, recipient),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT_SENDER" });
    const response = await POST(
      new Request(
        `http://localhost/api/oracle/markets/${marketId}/wallet-payment`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://other.example",
          },
          body: JSON.stringify({
            action: "build",
            sender,
            invoiceToken: bill.invoiceToken,
          }),
        },
      ),
      { params: Promise.resolve({ id: marketId }) },
    );
    expect(response.status).toBe(403);
  });
});
