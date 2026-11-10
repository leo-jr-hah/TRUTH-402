import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeOraclePayment,
  clearStoreCacheForTests,
  readDatabase,
  resetStoreForTests,
  updateMarket,
} from "@/lib/store";
import { DEMO_ORACLE_ADDRESS, SUI_USDC_COIN_TYPE } from "@/lib/config";
import * as privateFile from "@/lib/private-file";
import { createSeedDatabase } from "@/lib/seed";

describe("durable single-use oracle receipts", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "truth402-ledger-"));
    await clearStoreCacheForTests();
    vi.stubEnv("TRUTH402_STORAGE_MODE", "file");
    vi.stubEnv("TRUTH402_DATA_FILE", path.join(directory, "state.json"));
    vi.stubEnv("VERCEL", "");
    await resetStoreForTests();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearStoreCacheForTests();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("atomically appends missing seeds without rewriting any existing entry", async () => {
    const seed = createSeedDatabase();
    const existing = {
      ...seed,
      markets: seed.markets.slice(0, 5),
      demoMemories: seed.demoMemories.slice(0, 20),
      insightCache: {
        retained: { content: "Operator note", createdAt: "2026-10-25" },
      },
      oracleInvoices: [],
      oracleCommitments: [],
      oraclePaymentReceipts: [],
    };
    existing.markets[0].title = "Operator-edited market";
    existing.markets[0].status = "resolved";
    existing.markets.push({ ...seed.markets[0], id: "operator-only-market" });
    existing.demoMemories[0].text += "\nPreserve original provider bytes.";
    const file = path.join(directory, "state.json");
    await clearStoreCacheForTests();
    await writeFile(file, JSON.stringify(existing));
    const writer = vi.spyOn(privateFile, "writePrivateFileAtomic");
    const databases = await Promise.all(
      Array.from({ length: 8 }, () => readDatabase()),
    );
    const healed = databases[0];
    expect(writer).toHaveBeenCalledTimes(1);
    expect(healed.markets).toHaveLength(23);
    expect(healed.demoMemories).toHaveLength(62);
    expect(healed.markets.slice(0, 6)).toEqual(existing.markets);
    expect(healed.demoMemories.slice(0, 20)).toEqual(existing.demoMemories);
    expect(healed.insightCache).toEqual(existing.insightCache);
    for (const database of databases) expect(database).toEqual(healed);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(
      JSON.parse(JSON.stringify(healed)),
    );
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await clearStoreCacheForTests();
    expect(await readDatabase()).toEqual(healed);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it("never lets a concurrent first read overwrite a market mutation", async () => {
    const seed = createSeedDatabase();
    await clearStoreCacheForTests();
    await writeFile(
      path.join(directory, "state.json"),
      JSON.stringify({
        ...seed,
        markets: seed.markets.slice(0, 5),
        demoMemories: seed.demoMemories.slice(0, 20),
      }),
    );
    await Promise.all([
      readDatabase(),
      updateMarket(seed.markets[0].id, (market) => ({
        ...market,
        title: "Concurrent update retained",
      })),
      readDatabase(),
    ]);
    await clearStoreCacheForTests();
    const database = await readDatabase();
    expect(database.markets).toHaveLength(22);
    expect(database.markets[0].title).toBe("Concurrent update retained");
  });

  it("fails closed on a failed seed write and retries without caching unpersisted data", async () => {
    const seed = createSeedDatabase();
    const raw = JSON.stringify({
      ...seed,
      markets: seed.markets.slice(0, 5),
      demoMemories: seed.demoMemories.slice(0, 20),
    });
    const file = path.join(directory, "state.json");
    await clearStoreCacheForTests();
    await writeFile(file, raw);
    vi.spyOn(privateFile, "writePrivateFileAtomic").mockRejectedValueOnce(
      new Error("Disk unavailable"),
    );
    await expect(readDatabase()).rejects.toMatchObject({
      code: "STORE_WRITE_FAILED",
    });
    expect(await readFile(file, "utf8")).toBe(raw);
    expect((await readDatabase()).demoMemories).toHaveLength(62);
  });

  it("does not replace a corrupt store with seeds", async () => {
    const file = path.join(directory, "state.json");
    await clearStoreCacheForTests();
    await writeFile(file, '{"version":1,"markets":[]}');
    await expect(readDatabase()).rejects.toMatchObject({
      code: "STORE_READ_FAILED",
    });
    expect(await readFile(file, "utf8")).toBe('{"version":1,"markets":[]}');
  });
  it("rejects replay after cache loss and disk reload", async () => {
    const receipt = {
      provider: "demo" as const,
      network: "sui:mainnet" as const,
      digest: "demo-sui-tx-durable001",
      recipient: DEMO_ORACLE_ADDRESS,
      amountBaseUnits: "10000",
      coinType: SUI_USDC_COIN_TYPE,
      checkpoint: "1",
      timestamp: "2026-10-25T12:00:00.000Z",
      verifiedAt: "2026-10-25T12:00:00.000Z",
      latencyMs: 0,
      marketId: "mkt-sports-final",
    };
    await consumeOraclePayment(receipt);
    await clearStoreCacheForTests();
    expect((await readDatabase()).oraclePaymentReceipts).toEqual([receipt]);
    await expect(consumeOraclePayment(receipt)).rejects.toMatchObject({
      code: "PAYMENT_REPLAY",
    });
    expect(
      JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"))
        .oraclePaymentReceipts,
    ).toHaveLength(1);
  });
});
