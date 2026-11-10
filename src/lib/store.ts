import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/lib/errors";
import { SUI_NATIVE_COIN_TYPE, SUI_USDC_COIN_TYPE } from "@/lib/config";
import { writePrivateFileAtomic } from "@/lib/private-file";
import { createSeedDatabase, type TRUTH402Database } from "@/lib/seed";
import type { Market, RecalledMemory } from "@/types/domain";
import type {
  OracleCommitment,
  OracleInvoiceRecord,
  OraclePaymentRecord,
} from "@/types/oracle";

const STORE_SYMBOL = Symbol.for("truth402.store");

interface StoreState {
  database?: TRUTH402Database;
  loading?: Promise<TRUTH402Database>;
  queue: Promise<void>;
}

const globalStore = globalThis as typeof globalThis & {
  [STORE_SYMBOL]?: StoreState;
};

const state =
  globalStore[STORE_SYMBOL] ??
  (globalStore[STORE_SYMBOL] = { queue: Promise.resolve() });

export function storageMode(): "file" | "memory" {
  // Vercel's filesystem is ephemeral/read-only outside /tmp. Always fall back
  // to process memory there so missing durable storage cannot break the demo.
  // Local file mode is single-instance only: its lock is process-local.
  if (process.env.VERCEL) return "memory";
  const configured = process.env.TRUTH402_STORAGE_MODE;
  if (configured === "file" || configured === "memory") return configured;
  return "file";
}

function dataFile(): string {
  return (
    process.env.TRUTH402_DATA_FILE ||
    path.join(process.cwd(), ".data", "truth402.json")
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function load(): Promise<TRUTH402Database> {
  // The process cache means the O(S) JSON parse happens once per process, not on
  // every request. S is the serialized store size. Mutations currently rewrite
  // O(S), appropriate only for the documented single-instance demo store.
  if (state.database) return state.database;
  // Reads can arrive together before exclusive() has acquired the mutation
  // queue. Share initialization so a late seed merge cannot overwrite a trade.
  if (!state.loading) {
    state.loading = initialize().finally(() => {
      state.loading = undefined;
    });
  }
  return state.loading;
}

async function initialize(): Promise<TRUTH402Database> {
  if (storageMode() === "memory") {
    state.database = createSeedDatabase();
    return state.database;
  }

  let database: TRUTH402Database;
  let changed = false;
  try {
    // Runtime demo state is created after deployment and must not be traced as
    // a build input. Vercel uses memory mode; local file mode supplies the path.
    const raw = await readFile(/* turbopackIgnore: true */ dataFile(), "utf8");
    const parsed = JSON.parse(raw) as TRUTH402Database;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.markets) ||
      !Array.isArray(parsed.demoMemories)
    ) {
      throw new Error("Unsupported database shape.");
    }
    database = parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new AppError(
        "STORE_READ_FAILED",
        "TRUTH402 could not read its local data store.",
        500,
      );
    }
    database = createSeedDatabase();
    changed = true;
  }

  // Append-only seed upgrades: existing records, receipts, user trades,
  // resolutions and serialized memory text always win identity collisions.
  const seeded = createSeedDatabase();
  const marketIds = new Set(database.markets.map((market) => market.id));
  const blobIds = new Set(database.demoMemories.map((memory) => memory.blobId));
  const markets = seeded.markets.filter((market) => !marketIds.has(market.id));
  const memories = seeded.demoMemories.filter(
    (memory) => !blobIds.has(memory.blobId),
  );
  if (markets.length || memories.length) {
    database.markets.push(...markets);
    database.demoMemories.push(...memories);
    changed = true;
  }
  if (changed) {
    try {
      await persist(database);
    } catch {
      throw new AppError(
        "STORE_WRITE_FAILED",
        "TRUTH402 could not persist its seed upgrade. The existing store was not replaced.",
        503,
      );
    }
  }
  // Do not expose a healed process cache unless the atomic write succeeded.
  state.database = database;
  return state.database;
}

async function persist(database: TRUTH402Database): Promise<void> {
  if (storageMode() === "memory") return;
  const file = dataFile();
  await writePrivateFileAtomic(file, `${JSON.stringify(database, null, 2)}\n`);
}

async function exclusive<T>(
  operation: (database: TRUTH402Database) => Promise<T> | T,
): Promise<T> {
  const previous = state.queue;
  let release!: () => void;
  state.queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    const database = clone(await load());
    const result = await operation(database);
    try {
      await persist(database);
    } catch {
      throw new AppError(
        "STORE_WRITE_FAILED",
        "TRUTH402 could not persist its local data store. No state change was accepted.",
        503,
      );
    }
    state.database = database;
    return result;
  } finally {
    release();
  }
}

export async function readDatabase(): Promise<TRUTH402Database> {
  await state.queue;
  return clone(await load());
}

export async function listMarkets(): Promise<Market[]> {
  await state.queue;
  const markets = clone((await load()).markets);
  return markets.sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export async function findMarket(id: string): Promise<Market | null> {
  await state.queue;
  const market = (await load()).markets.find(
    (candidate) => candidate.id === id,
  );
  return market ? clone(market) : null;
}

export async function insertMarket(market: Market): Promise<Market> {
  return exclusive((database) => {
    if (database.markets.some((candidate) => candidate.id === market.id)) {
      throw new AppError("MARKET_EXISTS", "This market already exists.", 409);
    }
    database.markets.unshift(clone(market));
    return clone(market);
  });
}

export async function updateMarket(
  id: string,
  updater: (market: Market) => Market,
): Promise<Market> {
  return exclusive((database) => {
    const index = database.markets.findIndex((market) => market.id === id);
    if (index === -1) {
      throw new AppError("MARKET_NOT_FOUND", "Market not found.", 404);
    }
    const updated = updater(clone(database.markets[index]));
    database.markets[index] = clone(updated);
    return clone(updated);
  });
}

export async function listDemoMemories(): Promise<RecalledMemory[]> {
  await state.queue;
  return clone((await load()).demoMemories);
}

export async function putDemoMemory(
  memory: RecalledMemory,
  recordId: string,
): Promise<RecalledMemory> {
  return exclusive((database) => {
    const existing = database.demoMemories.find(
      (candidate) => candidate.blobId === `demo-${recordId}`,
    );
    if (existing) return clone(existing);
    database.demoMemories.push(clone(memory));
    return clone(memory);
  });
}

export async function getCachedInsight(
  key: string,
): Promise<{ content: string; createdAt: string } | null> {
  await state.queue;
  const value = (await load()).insightCache[key];
  return value ? clone(value) : null;
}

export async function putCachedInsight(
  key: string,
  value: { content: string; createdAt: string },
): Promise<void> {
  await exclusive((database) => {
    database.insightCache[key] = clone(value);
    const keys = Object.keys(database.insightCache);
    if (keys.length > 100) {
      keys
        .sort((a, b) =>
          database.insightCache[a].createdAt.localeCompare(
            database.insightCache[b].createdAt,
          ),
        )
        .slice(0, keys.length - 100)
        .forEach((oldest) => delete database.insightCache[oldest]);
    }
  });
}

export async function resetStoreForTests(): Promise<void> {
  if (process.env.VITEST !== "true")
    throw new Error("Store resets are test-only.");
  await exclusive((database) => {
    const seeded = createSeedDatabase();
    database.version = seeded.version;
    database.markets = seeded.markets;
    database.demoMemories = seeded.demoMemories;
    database.insightCache = {};
    database.oraclePaymentReceipts = [];
    database.oracleInvoices = [];
    database.oracleCommitments = [];
  });
}

/** Clear only the process cache to test disk restart behavior without deleting data. */
export async function clearStoreCacheForTests(): Promise<void> {
  if (process.env.VITEST !== "true")
    throw new Error("Store cache resets are test-only.");
  await state.queue;
  await state.loading;
  state.database = undefined;
}

export function assertOracleStorageSafety(mode: "demo" | "live"): void {
  if (
    mode === "live" &&
    (storageMode() !== "file" ||
      process.env.TRUTH402_ORACLE_SINGLE_INSTANCE !== "true")
  ) {
    throw new AppError(
      "ORACLE_DURABLE_STORAGE_REQUIRED",
      "Live payments require durable file storage and TRUTH402_ORACLE_SINGLE_INSTANCE=true. Serverless payments are disabled.",
      503,
    );
  }
}

export async function putOracleInvoice(
  invoice: OracleInvoiceRecord,
): Promise<void> {
  assertOracleStorageSafety(invoice.mode);
  await exclusive((database) => {
    const invoices = (database.oracleInvoices ?? []).filter(
      (entry) => Date.parse(entry.expiresAt) > Date.now(),
    );
    if (invoices.length >= 1000)
      throw new AppError(
        "INVOICE_CAPACITY",
        "The invoice queue is full. Retry after pending invoices expire.",
        503,
      );
    invoices.push(clone(invoice));
    database.oracleInvoices = invoices;
  });
}

export async function findOracleInvoice(
  id: string,
): Promise<OracleInvoiceRecord | null> {
  await state.queue;
  return clone(
    (await load()).oracleInvoices?.find((invoice) => invoice.id === id) ?? null,
  );
}

/** Persist only the hash of a prepared buyer-funded transaction, not a private token. */
export async function bindOracleWalletTransaction(
  id: string,
  transaction: NonNullable<OracleInvoiceRecord["walletTransaction"]>,
): Promise<void> {
  assertOracleStorageSafety("live");
  await exclusive((database) => {
    const invoice = database.oracleInvoices?.find(
      (entry) => entry.id === id && entry.mode === "live",
    );
    if (!invoice || Date.parse(invoice.expiresAt) <= Date.now())
      throw new AppError(
        "INVALID_PAYMENT_INVOICE",
        "The invoice expired before wallet signing.",
        402,
      );
    invoice.walletTransaction = clone(transaction);
  });
}

/** Consume a public playground grant without inventing a payment or ledger entry. */
export async function consumeOracleSandboxInvoice(
  id: string,
  marketId: string,
): Promise<void> {
  await exclusive((database) => {
    const invoice = database.oracleInvoices?.find(
      (entry) => entry.id === id && entry.marketId === marketId,
    );
    if (!invoice || Date.parse(invoice.expiresAt) <= Date.now())
      throw new AppError(
        "INVALID_PAYMENT_INVOICE",
        "Sandbox invoice expired or was already used.",
        402,
      );
    database.oracleInvoices = database.oracleInvoices?.filter(
      (entry) => entry.id !== id,
    );
  });
}

/** The replay check and receipt insertion share the same persistence transaction. */
export async function consumeOraclePayment(
  receipt: OraclePaymentRecord,
): Promise<void> {
  assertOracleStorageSafety(receipt.provider === "tatum" ? "live" : "demo");
  await exclusive((database) => {
    const receipts = database.oraclePaymentReceipts ?? [];
    if (
      receipts.some(
        (entry) =>
          entry.digest === receipt.digest &&
          entry.provider === receipt.provider,
      )
    )
      throw new AppError(
        "PAYMENT_REPLAY",
        "This payment digest has already been redeemed.",
        409,
      );
    if (receipt.invoiceId) {
      const invoice = database.oracleInvoices?.find(
        (entry) => entry.id === receipt.invoiceId,
      );
      if (
        !invoice ||
        invoice.marketId !== receipt.marketId ||
        invoice.recipient !== receipt.recipient ||
        (invoice.mode === "live") !== (receipt.provider === "tatum") ||
        !(receipt.coinType === SUI_USDC_COIN_TYPE
          ? BigInt(receipt.amountBaseUnits) >= BigInt(invoice.amountBaseUnits)
          : receipt.provider === "tatum" &&
            receipt.coinType === SUI_NATIVE_COIN_TYPE &&
            process.env.SUI_ALLOW_ANY_COIN_FALLBACK === "true" &&
            BigInt(receipt.amountBaseUnits) >= BigInt(1000000) &&
            receipt.invoiceAmountMicroUsdc === invoice.amountBaseUnits) ||
        Date.parse(invoice.expiresAt) <= Date.now()
      )
        throw new AppError(
          "INVALID_PAYMENT_INVOICE",
          "Payment invoice is missing, expired or does not match this charge.",
          402,
        );
      database.oracleInvoices = database.oracleInvoices?.filter(
        (entry) => entry.id !== receipt.invoiceId,
      );
    } else if (receipt.provider === "tatum") {
      throw new AppError(
        "PAYMENT_INVOICE_REQUIRED",
        "Live redemption requires a bound invoice.",
        402,
      );
    }
    // Never evict used digests to make room, which would reopen replay attacks.
    if (receipts.length >= 10_000)
      throw new AppError(
        "PAYMENT_LEDGER_FULL",
        "Payment storage has reached its safe capacity. Contact the operator.",
        503,
      );
    receipts.push(clone(receipt));
    database.oraclePaymentReceipts = receipts;
  });
}

export async function findOracleCommitment(
  marketId: string,
  modeKey: string,
): Promise<OracleCommitment | null> {
  await state.queue;
  return clone(
    (await load()).oracleCommitments?.find(
      (entry) =>
        entry.record.marketId === marketId && entry.modeKey === modeKey,
    ) ?? null,
  );
}

export async function reserveOracleCommitment(
  candidate: OracleCommitment,
): Promise<OracleCommitment> {
  return exclusive((database) => {
    const commitments = database.oracleCommitments ?? [];
    const existing = commitments.find(
      (entry) =>
        entry.record.marketId === candidate.record.marketId &&
        entry.modeKey === candidate.modeKey,
    );
    if (existing) return clone(existing);
    const market = database.markets.find(
      (entry) => entry.id === candidate.record.marketId,
    );
    if (
      !market ||
      market.status !== "open" ||
      market.updatedAt !== candidate.record.snapshot.marketUpdatedAt
    )
      throw new AppError(
        "COMMIT_MARKET_CHANGED",
        "The market changed or resolved before the snapshot could be locked. Retry on an open market.",
        409,
      );
    if (commitments.length >= 1000)
      throw new AppError(
        "COMMIT_CAPACITY",
        "Forecast storage is full. Contact the operator.",
        503,
      );
    commitments.push(clone(candidate));
    database.oracleCommitments = commitments;
    return clone(candidate);
  });
}

export async function finishOracleCommitment(
  commitment: OracleCommitment,
): Promise<OracleCommitment> {
  return exclusive((database) => {
    const existing = database.oracleCommitments?.find(
      (entry) =>
        entry.record.recordId === commitment.record.recordId &&
        entry.modeKey === commitment.modeKey,
    );
    if (!existing)
      throw new AppError(
        "COMMIT_NOT_FOUND",
        "The forecast reservation was not found.",
        409,
      );
    if (existing.receipt?.status !== "confirmed")
      existing.receipt = clone(commitment.receipt);
    return clone(existing);
  });
}
