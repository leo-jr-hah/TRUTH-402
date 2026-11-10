import type {
  HealthResult,
  MemoriesResult,
  MemorySummary,
} from "@mysten-incubation/memwal";
import { describe, expect, it, vi } from "vitest";

import {
  confirmedManifestBlobIds,
  redactPreflight,
  runPreflight,
} from "../../scripts/hackathon-preflight";

const env = {
  TATUM_API_KEY: "private-tatum-key",
  MEMWAL_ACCOUNT_ID: "private-account-id",
  MEMWAL_PRIVATE_KEY: "private-memory-key",
  MEMWAL_NAMESPACE: "truth402",
  AGENT_ROUTER_BASE_URL: "http://127.0.0.1:8318/v1",
  AGENT_ROUTER_API_KEY: "private-router-key",
};
const memories = Array.from({ length: 11 }, (_, i): MemorySummary => ({
  memory_id: `m${i}`,
  blob_id: String(i).padStart(43, "a"),
  namespace_id: "truth402",
  status: "confirmed",
  created_at: "2026-10-25T00:00:00.000Z",
  updated_at: "2026-10-25T00:00:00.000Z",
  size: 20,
  agent_id: null,
  package_id: null,
  end_epoch: 123,
  expires_at: null,
  importance: null,
}));
const page = (
  items: MemorySummary[],
  next: string | null = null,
): MemoriesResult => ({
  memories: items,
  next_cursor: next,
  has_more: next !== null,
  snapshot_version: 1,
  deleted: [],
  must_resync: false,
});
const manifests = () => ({
  receipts: {
    network: "mainnet",
    accountId: env.MEMWAL_ACCOUNT_ID,
    namespace: "truth402",
    relayer: "https://relayer.memory.walrus.xyz",
    receipts: memories.map((m) => ({
      blobId: m.blob_id,
      recordId: m.memory_id,
      namespace: "truth402",
      confirmedAt: "2026-10-25T00:00:00.000Z",
    })),
  },
  verification: {
    network: "mainnet",
    accountId: env.MEMWAL_ACCOUNT_ID,
    namespace: "truth402",
    verifiedAt: "2026-10-25T00:00:00.000Z",
    count: 11,
    memories: memories.map((m) => ({
      blobId: m.blob_id,
      memoryId: m.memory_id,
      status: "confirmed",
    })),
  },
});
function ioFixture() {
  const documents = manifests();
  const client = {
    health: vi.fn(async (): Promise<HealthResult> => ({
      status: "ok",
      version: "test",
    })),
    listMemories: vi.fn(async (): Promise<MemoriesResult> => page(memories)),
    destroy: vi.fn(),
  };
  const io = {
    createMemoryClient: vi.fn(() => client),
    log: vi.fn(),
    readFile: vi.fn(async (file: string) =>
      JSON.stringify(
        file.endsWith("mainnet-memory-receipts.json")
          ? documents.receipts
          : documents.verification,
      ),
    ),
    fetch: vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("sui-mainnet"))
        return Response.json({
          jsonrpc: "2.0",
          id: "preflight",
          result: "123456",
        });
      if (String(url).includes("top-traders"))
        return Response.json({
          data: [{ rank: 1, proxyWallet: `0x${"a".repeat(40)}`, pnl: 10 }],
        });
      if (String(url).endsWith("/health"))
        return new Response("", { status: 404 });
      return Response.json({ data: [{ id: "router-model" }] });
    }),
  };
  return { io, client, documents };
}
describe("read-only Mainnet preflight", () => {
  it("separates missing configuration from successful verification without making network calls", async () => {
    const { io } = ioFixture();
    io.readFile.mockRejectedValue(new Error("missing"));
    const checks = await runPreflight({}, "/tmp/preflight", io);
    expect(checks.map((check) => check.status)).toEqual([
      "MISSING",
      "MISSING",
      "MISSING",
      "MISSING",
    ]);
    expect(io.fetch).not.toHaveBeenCalled();
    expect(io.createMemoryClient).not.toHaveBeenCalled();
  });
  it("uses exact endpoints, paginates through empty filtered pages, and prints only ten confirmed IDs", async () => {
    const { io, client } = ioFixture();
    client.listMemories
      .mockResolvedValueOnce(page(memories.slice(0, 5), "next-1"))
      .mockResolvedValueOnce(page([], "next-2"))
      .mockResolvedValueOnce(page(memories.slice(5)));
    const checks = await runPreflight(env, "/tmp/preflight", io);
    expect(checks.map((check) => check.status)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(client.listMemories).toHaveBeenNthCalledWith(2, {
      namespace: "truth402",
      limit: 500,
      cursor: "next-1",
    });
    expect(client.listMemories).toHaveBeenCalledTimes(3);
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(
      io.fetch.mock.calls.some(([url]) =>
        String(url).endsWith(
          "/top-traders?category=CRYPTO&timePeriod=MONTH&orderBy=PNL&limit=3",
        ),
      ),
    ).toBe(true);
    expect(
      io.fetch.mock.calls.some(
        ([url]) => String(url) === "http://127.0.0.1:8318/v1/models",
      ),
    ).toBe(true);
    for (const [, init] of io.fetch.mock.calls)
      expect(init?.redirect).toBe("error");
    const output = io.log.mock.calls.flat().join("\n");
    expect(output).toContain("exact inventory count 11");
    expect(output).toContain(memories[9].blob_id);
    expect(output).not.toContain(memories[10].blob_id);
    for (const secret of [
      env.TATUM_API_KEY,
      env.MEMWAL_PRIVATE_KEY,
      env.AGENT_ROUTER_API_KEY,
      env.MEMWAL_ACCOUNT_ID,
    ])
      expect(output).not.toContain(secret);
  });
  it("does not call untrusted endpoints or claim readiness for invalid responses", async () => {
    const { io } = ioFixture();
    const checks = await runPreflight(
      {
        ...env,
        TATUM_SUI_RPC_URL: "https://attacker.example",
        MEMWAL_SERVER_URL: "https://attacker.example",
        AGENT_ROUTER_BASE_URL: "https://name:secret@attacker.example",
      },
      "/tmp/preflight",
      io,
    );
    expect(checks.slice(0, 3).map((check) => check.status)).toEqual([
      "FAIL",
      "FAIL",
      "FAIL",
    ]);
    expect(io.fetch).not.toHaveBeenCalled();
    expect(io.createMemoryClient).not.toHaveBeenCalled();
    io.fetch.mockResolvedValue(Response.json({ wrong: env.TATUM_API_KEY }));
    expect((await runPreflight(env, "/tmp/preflight", io))[0].status).toBe(
      "FAIL",
    );
  });
  it("warns below ten and treats repeated cursors or resync as incomplete inventory", async () => {
    const { io, client } = ioFixture();
    client.listMemories.mockResolvedValue(page(memories.slice(0, 1)));
    expect((await runPreflight(env, "/tmp/preflight", io))[1].status).toBe(
      "WARN",
    );
    client.listMemories.mockResolvedValue(page([], "repeat"));
    expect((await runPreflight(env, "/tmp/preflight", io))[1].status).toBe(
      "FAIL",
    );
    client.listMemories.mockResolvedValue({
      ...page(memories),
      must_resync: true,
    });
    expect((await runPreflight(env, "/tmp/preflight", io))[1].status).toBe(
      "FAIL",
    );
  });
  it("requires matching Mainnet manifests and live inventory; pending and foreign blobs are not confirmed", () => {
    const docs = manifests();
    const inventory = memories.map((m) => ({
      memoryId: m.memory_id,
      blobId: m.blob_id,
      namespace: "truth402",
      status: "pending",
    }));
    expect(
      confirmedManifestBlobIds(
        docs.receipts,
        docs.verification,
        env.MEMWAL_ACCOUNT_ID,
        "truth402",
        inventory,
      ),
    ).toEqual([]);
    expect(
      confirmedManifestBlobIds(
        docs.receipts,
        docs.verification,
        env.MEMWAL_ACCOUNT_ID,
        "truth402",
        null,
      ),
    ).toEqual([]);
    expect(() =>
      confirmedManifestBlobIds(
        { ...docs.receipts, network: "testnet" },
        docs.verification,
        env.MEMWAL_ACCOUNT_ID,
        "truth402",
        inventory,
      ),
    ).toThrow();
    expect(() =>
      confirmedManifestBlobIds(
        docs.receipts,
        docs.verification,
        "another-account",
        "truth402",
        inventory,
      ),
    ).toThrow();
    expect(
      redactPreflight(
        `Bearer ${env.TATUM_API_KEY} ${env.MEMWAL_PRIVATE_KEY}`,
        env,
      ),
    ).not.toContain(env.MEMWAL_PRIVATE_KEY);
  });
});
