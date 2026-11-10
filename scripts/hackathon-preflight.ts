import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MemWal } from "@mysten-incubation/memwal";
import { loadEnvConfig } from "@next/env";
import { z } from "zod";

import { stripUnsafeControls } from "../src/lib/sanitize";

const RELAYER = "https://relayer.memory.walrus.xyz";
const RPC = "https://sui-mainnet.gateway.tatum.io";
const PREDICTION = "https://api.tatum.io/v4/data/prediction";
type Environment = Record<string, string | undefined>;
interface ReadinessCheck {
  name: string;
  status: "PASS" | "MISSING" | "FAIL" | "WARN";
  details: string[];
}
interface InventoryMemory {
  memoryId: string;
  blobId: string;
  namespace: string;
  status: string;
}
interface PreflightIO {
  fetch: typeof fetch;
  readFile: (file: string) => Promise<string>;
  createMemoryClient: (
    options: Parameters<typeof MemWal.create>[0],
  ) => Pick<MemWal, "health" | "listMemories" | "destroy">;
  log: (message: string) => void;
}
const defaultIO: PreflightIO = {
  fetch: (...args) => fetch(...args),
  readFile: (file) => readFile(file, "utf8"),
  createMemoryClient: (options) => MemWal.create(options),
  log: console.log,
};

export function redactPreflight(value: string, env: Environment): string {
  let result = value;
  for (const [name, secret] of Object.entries(env)) {
    if (secret && /KEY|TOKEN|SECRET|PASSWORD|ACCOUNT_ID/iu.test(name))
      result = result.replaceAll(secret, "[redacted]");
  }
  return stripUnsafeControls(
    result
      .replace(/(Bearer\s+)\S+/giu, "$1[redacted]")
      .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/giu, "https://[redacted]@"),
  ).slice(0, 2000);
}
function endpoint(value: string | undefined, expected: string) {
  if ((value || expected).replace(/\/+$/u, "") !== expected)
    throw new Error("Refusing a noncanonical Mainnet provider endpoint.");
}
async function json(io: PreflightIO, url: string, init: RequestInit = {}) {
  const response = await io.fetch(url, {
    ...init,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function failureReason(error: unknown): string {
  if (error instanceof z.ZodError) return "invalid response schema";
  if (
    error instanceof Error &&
    /^(HTTP \d{3}|RPC error -?\d+)$/u.test(error.message)
  )
    return error.message;
  if (
    error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
  )
    return "request timed out";
  return "network/provider request failed";
}

async function tatum(
  env: Environment,
  io: PreflightIO,
): Promise<ReadinessCheck> {
  const check: ReadinessCheck = {
    name: "1. Tatum Mainnet RPC + Polymarket traders",
    status: "PASS",
    details: [],
  };
  if (!env.TATUM_API_KEY)
    return {
      ...check,
      status: "MISSING",
      details: ["TATUM_API_KEY is not configured; no request sent."],
    };
  try {
    endpoint(env.TATUM_SUI_RPC_URL, RPC);
    endpoint(env.TATUM_DATA_API_URL, PREDICTION);
  } catch {
    return {
      ...check,
      status: "FAIL",
      details: [
        "Noncanonical Tatum endpoint rejected before sending credentials.",
      ],
    };
  }
  const headers = {
    "x-api-key": env.TATUM_API_KEY,
    "content-type": "application/json",
  };
  const started = performance.now();
  const [checkpoint, traders] = await Promise.allSettled([
    json(io, RPC, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "preflight",
        method: "sui_getLatestCheckpointSequenceNumber",
        params: [],
      }),
    }).then((value) => {
      const error = z
        .object({ error: z.object({ code: z.number().int() }) })
        .safeParse(value);
      if (error.success) throw new Error(`RPC error ${error.data.error.code}`);
      return z
        .object({
          jsonrpc: z.literal("2.0"),
          id: z.literal("preflight"),
          result: z.string().regex(/^\d+$/u),
        })
        .parse(value).result;
    }),
    json(
      io,
      `${PREDICTION}/top-traders?category=CRYPTO&timePeriod=MONTH&orderBy=PNL&limit=3`,
      { headers },
    ).then(
      (value) =>
        z
          .object({
            data: z
              .array(
                z.object({
                  proxyWallet: z.string().regex(/^0x[\da-f]{40}$/iu),
                  rank: z.coerce.number().int().positive(),
                  pnl: z.coerce.number().finite(),
                  userName: z.string().nullable().optional(),
                }),
              )
              .min(1)
              .max(3),
          })
          .parse(value).data,
    ),
  ]);
  check.details.push(
    checkpoint.status === "fulfilled"
      ? `Latest Mainnet checkpoint ${checkpoint.value}; ${Math.round(performance.now() - started)} ms combined read latency.`
      : `Latest checkpoint RPC: ${failureReason(checkpoint.reason)}.`,
  );
  check.details.push(
    traders.status === "fulfilled"
      ? `Prediction API verified ${traders.value.length} CRYPTO / MONTH traders, ordered by PNL.`
      : `Top-traders endpoint: ${failureReason(traders.reason)}.`,
  );
  if (checkpoint.status === "rejected" || traders.status === "rejected")
    check.status = "FAIL";
  return check;
}

async function walrus(
  env: Environment,
  io: PreflightIO,
): Promise<{ check: ReadinessCheck; inventory: InventoryMemory[] | null }> {
  const check: ReadinessCheck = {
    name: "2. Walrus Mainnet health + namespace inventory",
    status: "PASS",
    details: [],
  };
  if (!env.MEMWAL_PRIVATE_KEY || !env.MEMWAL_ACCOUNT_ID)
    return {
      check: {
        ...check,
        status: "MISSING",
        details: [
          "MEMWAL_PRIVATE_KEY / MEMWAL_ACCOUNT_ID missing; no authenticated request sent.",
        ],
      },
      inventory: null,
    };
  let client: ReturnType<PreflightIO["createMemoryClient"]> | undefined;
  try {
    endpoint(env.MEMWAL_SERVER_URL, RELAYER);
    const namespace = env.MEMWAL_NAMESPACE?.trim() || "truth402";
    client = io.createMemoryClient({
      key: env.MEMWAL_PRIVATE_KEY,
      accountId: env.MEMWAL_ACCOUNT_ID,
      serverUrl: RELAYER,
      namespace,
      requestTimeoutMs: 10000,
      preflightTimeoutMs: 7500,
    });
    const memoryClient = client;
    const [health, inventory] = await Promise.allSettled([
      memoryClient.health(),
      (async () => {
        const memories = new Map<string, InventoryMemory>();
        const cursors = new Set<string>();
        let cursor: string | undefined;
        let snapshotVersion: number | undefined;
        const deadline = Date.now() + 60000;
        for (let pageNo = 0; pageNo < 1000; pageNo++) {
          if (Date.now() > deadline)
            throw new Error("Inventory timeout; exact count not verified.");
          const page = await memoryClient.listMemories({
            namespace,
            cursor,
            limit: 500,
          });
          if (
            page.must_resync ||
            (snapshotVersion !== undefined &&
              page.snapshot_version !== snapshotVersion)
          )
            throw new Error(
              "Inventory changed while paginating; exact count not verified.",
            );
          snapshotVersion = page.snapshot_version;
          for (const memory of page.memories) {
            if (memory.namespace_id !== namespace)
              throw new Error("Namespace mismatch in inventory.");
            memories.set(memory.memory_id, {
              memoryId: memory.memory_id,
              blobId: memory.blob_id,
              namespace,
              status: memory.status,
            });
          }
          for (const deleted of page.deleted)
            memories.delete(deleted.memory_id);
          if (!page.has_more) return [...memories.values()];
          if (!page.next_cursor || cursors.has(page.next_cursor))
            throw new Error("Inventory pagination did not advance.");
          cursors.add(page.next_cursor);
          cursor = page.next_cursor;
        }
        throw new Error(
          "Inventory safety limit reached; exact count not verified.",
        );
      })(),
    ]);
    if (
      health.status !== "fulfilled" ||
      !["ok", "healthy"].includes(health.value.status.toLowerCase())
    ) {
      check.status = "FAIL";
      check.details.push("Relayer health failed; no healthy status claimed.");
    } else
      check.details.push(
        `Canonical Mainnet relayer health: ${health.value.status}.`,
      );
    if (inventory.status !== "fulfilled") {
      check.status = "FAIL";
      check.details.push(
        "Namespace inventory failed or was incomplete; exact count unavailable.",
      );
      return { check, inventory: null };
    }
    check.details.push(
      `Namespace ${namespace}: exact inventory count ${inventory.value.length}.`,
    );
    if (inventory.value.length < 10) {
      if (check.status === "PASS") check.status = "WARN";
      check.details.push(
        "Fewer than 10 memories: hackathon memory requirement not met.",
      );
    }
    return { check, inventory: inventory.value };
  } catch {
    return {
      check: {
        ...check,
        status: "FAIL",
        details: [
          "Walrus configuration or authenticated Mainnet read failed. Credentials withheld.",
        ],
      },
      inventory: null,
    };
  } finally {
    client?.destroy();
  }
}

async function router(
  env: Environment,
  io: PreflightIO,
): Promise<ReadinessCheck> {
  const check: ReadinessCheck = {
    name: "3. Agent Router",
    status: "PASS",
    details: [],
  };
  if (!env.AGENT_ROUTER_BASE_URL || !env.AGENT_ROUTER_API_KEY)
    return {
      ...check,
      status: "MISSING",
      details: [
        "AGENT_ROUTER_BASE_URL / AGENT_ROUTER_API_KEY missing; no request sent.",
      ],
    };
  try {
    const base = new URL(env.AGENT_ROUTER_BASE_URL);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (base.protocol !== "https:" &&
        !(
          base.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
        ))
    )
      throw new Error("Unsafe router origin.");
    const stem = base.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "");
    const health = `${base.origin}${stem}/health`,
      models = `${base.origin}${stem}/v1/models`;
    const headers = { authorization: `Bearer ${env.AGENT_ROUTER_API_KEY}` };
    try {
      const status = z
        .object({ status: z.enum(["ok", "healthy"]) })
        .parse(await json(io, health, { headers }));
      return {
        ...check,
        details: [
          `Router health verified: ${status.status}. No model generation was invoked.`,
        ],
      };
    } catch {
      /* A router may expose only the OpenAI-compatible models endpoint. */
    }
    const result = z
      .object({ data: z.array(z.object({ id: z.string().min(1) })).min(1) })
      .parse(await json(io, models, { headers }));
    return {
      ...check,
      details: [
        `Authenticated /v1/models verified (${result.data.length} models). No generation or token charge requested.`,
      ],
    };
  } catch {
    return {
      ...check,
      status: "FAIL",
      details: [
        "Router health and model availability could not be verified. Credentials withheld.",
      ],
    };
  }
}

const blobId = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const sharedManifest = z.object({
  network: z.literal("mainnet"),
  accountId: z.string(),
  namespace: z.string(),
});
export function confirmedManifestBlobIds(
  receipts: unknown,
  verification: unknown,
  accountId: string,
  namespace: string,
  inventory: InventoryMemory[] | null,
): string[] {
  const published = sharedManifest
    .extend({
      relayer: z.literal(RELAYER),
      receipts: z.array(
        z.object({
          recordId: z.string().min(1),
          blobId,
          confirmedAt: z.string().datetime(),
          namespace: z.string(),
        }),
      ),
    })
    .parse(receipts);
  const verified = sharedManifest
    .extend({
      verifiedAt: z.string().datetime(),
      count: z.number().int().nonnegative(),
      memories: z.array(
        z.object({ memoryId: z.string().min(1), blobId, status: z.string() }),
      ),
    })
    .parse(verification);
  if (
    [published, verified].some(
      (manifest) =>
        manifest.accountId !== accountId || manifest.namespace !== namespace,
    ) ||
    verified.count !==
      new Set(verified.memories.map((memory) => memory.memoryId)).size
  )
    throw new Error(
      "Receipt manifests have a mismatched account, namespace or count.",
    );
  if (!inventory) return [];
  const confirmed = (status: string) =>
    ["confirmed", "done", "completed", "active"].includes(status.toLowerCase());
  const onRelayer = new Set(
    inventory
      .filter(
        (memory) => memory.namespace === namespace && confirmed(memory.status),
      )
      .map((memory) => memory.blobId),
  );
  const listed = new Set(
    verified.memories
      .filter((memory) => confirmed(memory.status))
      .map((memory) => memory.blobId),
  );
  return [
    ...new Set(
      published.receipts
        .filter(
          (receipt) =>
            receipt.namespace === namespace &&
            listed.has(receipt.blobId) &&
            onRelayer.has(receipt.blobId),
        )
        .map((receipt) => receipt.blobId),
    ),
  ];
}

export async function runPreflight(
  env: Environment,
  root: string,
  io: PreflightIO = defaultIO,
): Promise<ReadinessCheck[]> {
  const [tatumCheck, memory, routerCheck, artifacts] = await Promise.all([
    tatum(env, io),
    walrus(env, io),
    router(env, io),
    Promise.allSettled(
      ["mainnet-memory-receipts.json", "mainnet-verification.json"].map(
        async (name) =>
          JSON.parse(
            await io.readFile(path.join(root, ".data", name)),
          ) as Promise<unknown>,
      ),
    ),
  ]);
  const receiptCheck: ReadinessCheck = {
    name: "4. Confirmed Mainnet receipt manifests",
    status: "PASS",
    details: [],
  };
  if (artifacts.some((artifact) => artifact.status !== "fulfilled")) {
    receiptCheck.status = "MISSING";
    receiptCheck.details.push(
      "Missing or unreadable .data/mainnet-memory-receipts.json / .data/mainnet-verification.json. No confirmed IDs claimed.",
    );
  } else {
    try {
      const values = artifacts.map((artifact) =>
        artifact.status === "fulfilled" ? artifact.value : null,
      );
      const ids = confirmedManifestBlobIds(
        values[0],
        values[1],
        env.MEMWAL_ACCOUNT_ID ?? "",
        env.MEMWAL_NAMESPACE?.trim() || "truth402",
        memory.inventory,
      );
      receiptCheck.details.push(
        `${ids.length} blob IDs match both manifests and the current Mainnet namespace inventory.`,
      );
      receiptCheck.details.push(
        ...ids.slice(0, 10).map((id, index) => `${index + 1}. ${id}`),
      );
      receiptCheck.details.push(
        "Relayer-confirmed inventory, not independent proof of Walrus blob availability.",
      );
      if (ids.length < 10) {
        receiptCheck.status = "WARN";
        receiptCheck.details.push(
          "Fewer than 10 confirmed Mainnet blob IDs verified.",
        );
      }
    } catch {
      receiptCheck.status = "FAIL";
      receiptCheck.details.push(
        "Manifest validation failed; no confirmed IDs claimed.",
      );
    }
  }
  const checks = [tatumCheck, memory.check, routerCheck, receiptCheck];
  io.log(
    "TRUTH-402 Mainnet preflight: read-only. No publication, payment, signing or generation.",
  );
  for (const check of checks) {
    io.log(`[${check.status}] ${check.name}`);
    check.details.forEach((detail) =>
      io.log(`  ${redactPreflight(detail, env)}`),
    );
  }
  io.log(
    "Wallet OAuth, funded transactions, and royalty payouts are not verified by this preflight.",
  );
  return checks;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "npm run preflight:mainnet\nLoads .env.local / .env. Performs four read-only Mainnet readiness checks; exits 1 for missing, failed or incomplete readiness. No writes or payments.",
    );
    return;
  }
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const checks = await runPreflight(process.env, process.cwd());
  if (checks.some((check) => check.status !== "PASS")) process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  void main().catch(() => {
    console.error(
      "Mainnet preflight failed. Provider payloads and credentials withheld.",
    );
    process.exitCode = 1;
  });
