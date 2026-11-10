import path from "node:path";

import { MemWal } from "@mysten-incubation/memwal";
import { loadEnvConfig } from "@next/env";

import { writePrivateFileAtomic } from "../src/lib/private-file";

const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const execute = process.argv.includes("--execute");
  const namespace = process.env.MEMWAL_NAMESPACE || "truth402";

  if (!execute) {
    console.log("Read-only verification is prepared but was not executed.");
    console.log(
      "Run `npm run memories:verify -- --execute` with MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID to inventory the Mainnet namespace.",
    );
    return;
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
      `Refusing to verify: Mainnet inventory requires ${MAINNET_RELAYER}.`,
    );
  }

  const client = MemWal.create({
    key,
    accountId,
    serverUrl: relayer,
    namespace,
  });

  const memories = new Map<
    string,
    { memoryId: string; blobId: string; createdAt: string; status: string }
  >();
  let cursor: string | undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      const page = await client.listMemories({
        cursor,
        limit: 500,
        namespace,
      });
      for (const memory of page.memories) {
        memories.set(memory.memory_id, {
          memoryId: memory.memory_id,
          blobId: memory.blob_id,
          createdAt: memory.created_at,
          status: memory.status,
        });
      }
      cursor = page.next_cursor ?? undefined;
      hasMore = page.has_more;
    }
  } finally {
    client.destroy();
  }

  const verifiedAt = new Date().toISOString();
  const result = {
    network: "mainnet",
    accountId,
    namespace,
    verifiedAt,
    count: memories.size,
    requirementMet: memories.size >= 10,
    memories: [...memories.values()],
  };
  const output = path.join(process.cwd(), ".data", "mainnet-verification.json");
  await writePrivateFileAtomic(output, `${JSON.stringify(result, null, 2)}\n`);

  console.log(
    `Verified ${memories.size} memories in Mainnet namespace “${namespace}”.`,
  );
  console.log(
    `Hackathon ≥10 requirement: ${result.requirementMet ? "MET" : "NOT MET"}`,
  );
  console.log(`Private verification manifest written to ${output}`);

  if (!result.requirementMet) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  let message =
    error instanceof Error ? error.message : "Memory inventory failed.";
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
