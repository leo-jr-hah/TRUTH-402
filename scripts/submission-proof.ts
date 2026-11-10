import { readFile } from "node:fs/promises";
import path from "node:path";

import { MemWal } from "@mysten-incubation/memwal";
import { loadEnvConfig } from "@next/env";

import { writePrivateFileAtomic } from "../src/lib/private-file";

const MAINNET_RELAYER = "https://relayer.memory.walrus.xyz";
const TATUM_RPC = "https://sui-mainnet.gateway.tatum.io";
const TATUM_PREDICTION = "https://api.tatum.io/v4/data/prediction";

async function checkTatumLive(apiKey: string) {
  const rpcStarted = performance.now();
  const rpcRes = await fetch(TATUM_RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "proof",
      method: "sui_getLatestCheckpointSequenceNumber",
      params: [],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const rpcJson = (await rpcRes.json()) as { result?: string; error?: unknown };
  const latencyMs = Math.round(performance.now() - rpcStarted);

  const predRes = await fetch(
    `${TATUM_PREDICTION}/top-traders?category=CRYPTO&timePeriod=MONTH&orderBy=PNL&limit=3&offset=0`,
    {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const predJson = (await predRes.json()) as {
    data?: Array<{
      rank: number;
      proxyWallet: string;
      userName: string | null;
      pnl: number;
      vol: number;
    }>;
  };

  return {
    checkpoint: String(rpcJson.result ?? "unavailable"),
    latencyMs,
    topTraders: predJson.data ?? [],
  };
}

async function checkWalrusLive(
  key: string,
  accountId: string,
  namespace: string,
) {
  const client = MemWal.create({
    key,
    accountId,
    serverUrl: MAINNET_RELAYER,
    namespace,
  });
  try {
    const health = await client.health();
    const list = await client.listMemories({ limit: 100, namespace });
    return {
      relayerStatus: health.status,
      relayerVersion: health.relayerVersion ?? health.version ?? "unknown",
      count: list.memories.length,
      memories: list.memories.slice(0, 15).map((m) => ({
        memoryId: m.memory_id,
        blobId: m.blob_id,
        createdAt: m.created_at,
        status: m.status,
      })),
    };
  } finally {
    client.destroy();
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const key = process.env.MEMWAL_PRIVATE_KEY;
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  const namespace = process.env.MEMWAL_NAMESPACE || "truth402";
  const tatumKey = process.env.TATUM_API_KEY;
  const oracleAddress = process.env.SUI_ORACLE_ADDRESS;

  if (!key || !accountId || !tatumKey) {
    throw new Error(
      "MEMWAL_PRIVATE_KEY, MEMWAL_ACCOUNT_ID, and TATUM_API_KEY must be set in .env.local.",
    );
  }

  console.log("Running TRUTH-402 Mainnet Submission Readiness Proof...\n");
  const [tatum, walrus] = await Promise.all([
    checkTatumLive(tatumKey),
    checkWalrusLive(key, accountId, namespace),
  ]);

  let localReceiptsCount = 0;
  try {
    const raw = JSON.parse(
      await readFile(
        path.join(process.cwd(), ".data", "mainnet-memory-receipts.json"),
        "utf8",
      ),
    ) as { count?: number };
    localReceiptsCount = raw.count ?? 0;
  } catch {
    localReceiptsCount = 0;
  }

  const summary = [
    "# TRUTH-402 - Official Hackathon Submission Cheat Sheet",
    "",
    "## 1. Form Fields to Copy-Paste",
    "- **Project Name:** TRUTH-402",
    "- **Primary Track:** 01 Markets & Sports Prediction",
    "- **Special Awards Targeted:** Best Walrus Memory + Best Use of Agent Payments (x402 / MPP on Sui)",
    "- **Tatum Dashboard Account Email:** `cryptomonkbro@gmail.com`",
    `- **Walrus MEMWAL_AGENT_ID (Delegate Public Key):** \`8a59f48711b8558690e6a5e03e9c17126783306ccc2bf497e57c6fe825f37c58\``,
    `- **Walrus MEMWAL_ACCOUNT_ID (Account Object ID):** \`${accountId}\``,
    `- **Walrus Namespace:** \`${namespace}\``,
    `- **Sui Oracle Recipient Address:** \`${oracleAddress}\``,
    "",
    "## 2. Live Mainnet Evidence Verified",
    `- **Tatum Sui Mainnet RPC Checkpoint:** \`${tatum.checkpoint}\` (${tatum.latencyMs} ms round-trip via \`https://sui-mainnet.gateway.tatum.io\`)`,
    `- **Tatum v4 Prediction API Top Traders Synced:** ${tatum.topTraders.length} live CRYPTO whales (${tatum.topTraders.map((t) => `${t.userName || t.proxyWallet.slice(0, 10)}: $${Math.round(t.pnl).toLocaleString()}`).join(", ")})`,
    `- **Walrus Mainnet Relayer Status:** \`${walrus.relayerStatus}\` (version \`${walrus.relayerVersion}\`)`,
    `- **Verified Mainnet Memories in Namespace \`${namespace}\`:** **${walrus.count}** (Local receipt manifest count: ${localReceiptsCount}) - **>= 10 Requirement: ${walrus.count >= 10 ? "MET" : "NEEDS PUBLISH"}**`,
    "",
    "## 3. Confirmed Mainnet Walrus Blob IDs (First 15)",
    ...walrus.memories.map(
      (m, idx) =>
        `${String(idx + 1).padStart(2, "0")}. Blob ID: \`${m.blobId}\` · Memory ID: \`${m.memoryId}\` · Created: \`${m.createdAt}\``,
    ),
    "",
  ].join("\n");

  const outFile = path.join(process.cwd(), ".data", "submission-summary.md");
  await writePrivateFileAtomic(outFile, `${summary}\n`);
  console.log(summary);
  console.log(`Saved full submission summary to ${outFile}`);
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Submission proof failed.",
  );
  process.exitCode = 1;
});
