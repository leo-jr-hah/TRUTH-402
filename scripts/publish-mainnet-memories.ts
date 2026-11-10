import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { MemWal } from "@mysten-incubation/memwal";
import { loadEnvConfig } from "@next/env";

import { parseMemory } from "../src/lib/memory/codec";
import { createSeedDatabase } from "../src/lib/seed";
import { writePrivateFileAtomic } from "../src/lib/private-file";

const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";

interface ReceiptItem {
  recordId: string;
  blobId: string;
  jobId: string;
  owner: string;
  namespace: string;
  confirmedAt: string;
}

async function loadExistingReceipts(
  filePath: string,
  accountId: string,
  namespace: string,
): Promise<Map<string, ReceiptItem>> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as {
      accountId?: string;
      namespace?: string;
      receipts?: ReceiptItem[];
    };
    if (
      raw.accountId === accountId &&
      raw.namespace === namespace &&
      Array.isArray(raw.receipts)
    ) {
      return new Map(
        raw.receipts
          .filter((item) => Boolean(item.recordId && item.blobId))
          .map((item) => [item.recordId, item]),
      );
    }
  } catch {
    // No existing receipt manifest or different namespace/account.
  }
  return new Map();
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { values } = parseArgs({
    options: {
      execute: { type: "boolean" },
      force: { type: "boolean" },
      limit: { type: "string" },
    },
    strict: false,
  });
  const execute = Boolean(values.execute);
  const force = Boolean(values.force);
  // Publish the immutable seed payloads, not newly enriched scoring copies.
  const allSeedMemories = createSeedDatabase().demoMemories;
  const requestedLimit = values.limit
    ? Math.max(12, Math.min(allSeedMemories.length, Number(values.limit)))
    : allSeedMemories.length;
  const seedMemories = allSeedMemories.slice(0, requestedLimit);
  const records = seedMemories.map((memory) => {
    const record = parseMemory(memory.text);
    if (!record)
      throw new Error("An original seed memory could not be parsed.");
    return record;
  });

  console.log(`Prepared ${records.length} distinct Verdicto learning records.`);
  console.log(
    records
      .map(
        (record, index) =>
          `${String(index + 1).padStart(2, "0")}. ${record.recordId}`,
      )
      .join("\n"),
  );

  if (!execute) {
    console.log("\nDry run only. No Walrus request was made.");
    console.log(
      "After reviewing the records, run `npm run memories:publish -- --execute` with Mainnet credentials and the write safety flag.",
    );
    return;
  }

  if (process.env.VERDICTO_ENABLE_MAINNET_WRITES !== "true") {
    throw new Error(
      "Refusing to publish: set VERDICTO_ENABLE_MAINNET_WRITES=true as an explicit safety acknowledgement.",
    );
  }

  const key = process.env.MEMWAL_PRIVATE_KEY;
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  if (!key || !accountId) {
    throw new Error("MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID are required.");
  }

  const relayer = (process.env.MEMWAL_SERVER_URL || MAINNET_RELAYER).replace(
    /\/+$/,
    "",
  );
  if (relayer !== MAINNET_RELAYER) {
    throw new Error(
      `Refusing to publish: Mainnet records require ${MAINNET_RELAYER}.`,
    );
  }

  const namespace = process.env.MEMWAL_NAMESPACE || "truth402";
  const output = path.join(
    process.cwd(),
    ".data",
    "mainnet-memory-receipts.json",
  );
  const existing = force
    ? new Map<string, ReceiptItem>()
    : await loadExistingReceipts(output, accountId, namespace);

  const client = MemWal.create({
    key,
    accountId,
    serverUrl: relayer,
    namespace,
    requestTimeoutMs: 30_000,
    recallTimeoutMs: 20_000,
    preflightTimeoutMs: 7_500,
  });

  const receipts: ReceiptItem[] = [...existing.values()];
  const saveManifest = async () => {
    await writePrivateFileAtomic(
      output,
      `${JSON.stringify(
        {
          network: "mainnet",
          relayer,
          namespace,
          accountId,
          count: receipts.length,
          receipts,
        },
        null,
        2,
      )}\n`,
    );
  };

  try {
    for (const [index, record] of records.entries()) {
      const prior = existing.get(record.recordId);
      if (prior) {
        console.log(
          `[${index + 1}/${records.length}] Skipping already confirmed ${record.recordId} (${prior.blobId})`,
        );
        continue;
      }
      console.log(
        `[${index + 1}/${records.length}] Publishing ${record.recordId}…`,
      );
      const result = await client.rememberAndWait(
        seedMemories[index].text,
        { idempotencyKey: record.recordId },
        { timeoutMs: 120_000, pollIntervalMs: 1_500 },
      );
      const item: ReceiptItem = {
        recordId: record.recordId,
        blobId: result.blob_id,
        jobId: result.job_id ?? result.id,
        owner: result.owner,
        namespace: result.namespace,
        confirmedAt: new Date().toISOString(),
      };
      receipts.push(item);
      existing.set(record.recordId, item);
      await saveManifest();
      console.log(`  Confirmed blob ${result.blob_id}`);
    }
  } finally {
    client.destroy();
  }

  await saveManifest();

  console.log(`\nPublished ${receipts.length} Mainnet memories.`);
  console.log(`Private receipt manifest written to ${output}`);
}

void main().catch((error: unknown) => {
  let message =
    error instanceof Error ? error.message : "Memory publication failed.";
  for (const name of [
    "MEMWAL_PRIVATE_KEY",
    "TATUM_API_KEY",
    "AGENT_ROUTER_API_KEY",
    "VERDICTO_ORACLE_ADMIN_TOKEN",
  ]) {
    const secret = process.env[name];
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  console.error(message);
  process.exitCode = 1;
});
