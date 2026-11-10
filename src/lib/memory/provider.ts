import "server-only";

import { MemWal } from "@mysten-incubation/memwal";

import { getMemWalConfig, getPublicRuntimeConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { serializeMemory } from "@/lib/memory/codec";
import { listDemoMemories, putDemoMemory } from "@/lib/store";
import { publicProviderError } from "@/lib/server-secrets";
import type {
  IntegrationCheck,
  MemoryReceipt,
  RecalledMemory,
  TRUTH402MemoryRecord,
} from "@/types/domain";

export interface MemoryProvider {
  readonly mode: "demo" | "live";
  remember(record: TRUTH402MemoryRecord): Promise<MemoryReceipt>;
  recall(query: string, limit: number): Promise<RecalledMemory[]>;
  listMemories(limit: number): Promise<RecalledMemory[]>;
  check(): Promise<IntegrationCheck>;
}

function messageOf(error: unknown): string {
  return publicProviderError(error, "Unknown provider failure");
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}

class DemoMemoryProvider implements MemoryProvider {
  readonly mode = "demo" as const;

  async remember(record: TRUTH402MemoryRecord): Promise<MemoryReceipt> {
    const now = new Date().toISOString();
    const blobId = `demo-${record.recordId}`;
    await putDemoMemory(
      {
        blobId,
        text: serializeMemory(record),
        distance: 0,
        createdAt: now,
        provider: "demo",
      },
      record.recordId,
    );

    return {
      recordId: record.recordId,
      kind: record.kind,
      status: "confirmed",
      provider: "demo",
      blobId,
      confirmedAt: now,
    };
  }

  async recall(query: string, limit: number): Promise<RecalledMemory[]> {
    const memories = await listDemoMemories();
    const queryTokens = tokens(query);

    return memories
      .map((memory) => {
        const memoryTokens = tokens(memory.text);
        const overlap = [...queryTokens].filter((token) =>
          memoryTokens.has(token),
        ).length;
        const relevance = queryTokens.size ? overlap / queryTokens.size : 0;
        return {
          ...memory,
          distance: Math.max(0.02, Math.min(0.98, 0.75 - relevance * 0.65)),
        };
      })
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          Date.parse(b.createdAt ?? "0") - Date.parse(a.createdAt ?? "0"),
      )
      .slice(0, limit);
  }

  async listMemories(limit: number): Promise<RecalledMemory[]> {
    return (await listDemoMemories())
      .sort(
        (a, b) =>
          Date.parse(b.createdAt ?? "0") - Date.parse(a.createdAt ?? "0") ||
          a.blobId.localeCompare(b.blobId),
      )
      .slice(0, limit);
  }

  async check(): Promise<IntegrationCheck> {
    const count = (await listDemoMemories()).length;
    return {
      name: "Walrus Memory",
      mode: "demo",
      status: "healthy",
      message: `${count} local demo memories available. Mainnet is not being contacted.`,
      details: { memories: count, mainnetWrites: false },
    };
  }
}

class WalrusMemoryProvider implements MemoryProvider {
  readonly mode = "live" as const;

  private client(requireWrites = false): MemWal {
    const config = getMemWalConfig({ requireWrites });
    if (config.mode !== "live") {
      throw new AppError(
        "MEMORY_MODE_MISMATCH",
        "Walrus Memory live provider is not configured.",
        503,
      );
    }
    return MemWal.create({
      key: config.key,
      accountId: config.accountId,
      serverUrl: config.serverUrl,
      namespace: config.namespace,
      requestTimeoutMs: 30_000,
      recallTimeoutMs: 20_000,
      preflightTimeoutMs: 7_500,
    });
  }

  async remember(record: TRUTH402MemoryRecord): Promise<MemoryReceipt> {
    const client = this.client(true);
    try {
      const result = await client.rememberAndWait(
        serializeMemory(record),
        { idempotencyKey: record.recordId },
        { timeoutMs: 120_000, pollIntervalMs: 1_500 },
      );
      return {
        recordId: record.recordId,
        kind: record.kind,
        status: "confirmed",
        provider: "walrus",
        blobId: result.blob_id,
        jobId: result.job_id ?? result.id,
        confirmedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        recordId: record.recordId,
        kind: record.kind,
        status: "failed",
        provider: "walrus",
        error: messageOf(error),
      };
    } finally {
      client.destroy();
    }
  }

  async recall(query: string, limit: number): Promise<RecalledMemory[]> {
    const client = this.client();
    try {
      const result = await client.recall({
        query,
        limit,
        sort: "recent",
        maxTokens: 16_000,
        timeoutMs: 20_000,
      });
      return result.results.map((memory) => ({
        blobId: memory.blob_id,
        text: memory.text,
        distance: memory.distance,
        createdAt: memory.created_at,
        provider: "walrus",
      }));
    } finally {
      client.destroy();
    }
  }

  async listMemories(limit: number): Promise<RecalledMemory[]> {
    // memwal 0.1.9 listMemories() exposes inventory metadata but no plaintext;
    // there is no per-blob plaintext getter. Use one broad recall (never one
    // recall per record) until the SDK exposes a decrypting namespace iterator.
    // The relayer caps recall at 100, so this is a documented live-mode limit.
    // TODO(memwal-upgrade): replace this with a plaintext inventory iterator
    // when the pinned SDK exposes one; manual decryption would add wallet/SEAL
    // dependencies and is intentionally rejected for the demo-safe boundary.
    const client = this.client();
    try {
      const result = await client.recall({
        query:
          "TRUTH402 memory market resolution signal participant performance credibility",
        limit: Math.min(limit, 100),
        sort: "recent",
        timeoutMs: 20_000,
      });
      return result.results.map((memory) => ({
        blobId: memory.blob_id,
        text: memory.text,
        distance: memory.distance,
        createdAt: memory.created_at,
        provider: "walrus",
      }));
    } finally {
      client.destroy();
    }
  }

  async check(): Promise<IntegrationCheck> {
    const started = performance.now();
    let client: MemWal | undefined;
    try {
      client = this.client();
      const health = await client.health();
      return {
        name: "Walrus Memory",
        mode: "live",
        status:
          health.status === "ok" || health.status === "healthy"
            ? "healthy"
            : "configured",
        message: `Mainnet relayer responded with “${health.status}”.`,
        latencyMs: Math.round(performance.now() - started),
        details: {
          relayerVersion: health.relayerVersion ?? health.version,
          writeReady: health.write_ready ?? null,
        },
      };
    } catch (error) {
      return {
        name: "Walrus Memory",
        mode: "live",
        status: "error",
        message: messageOf(error),
        latencyMs: Math.round(performance.now() - started),
      };
    } finally {
      client?.destroy();
    }
  }
}

export function getMemoryProvider(): MemoryProvider {
  return getPublicRuntimeConfig().memoryMode === "live"
    ? new WalrusMemoryProvider()
    : new DemoMemoryProvider();
}
