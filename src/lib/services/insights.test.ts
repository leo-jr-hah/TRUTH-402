import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMemoryProvider, type MemoryProvider } from "@/lib/memory/provider";
import {
  getInsightsSnapshot,
  invalidateInsightsCache,
} from "@/lib/services/insights";
import type { RecalledMemory } from "@/types/domain";

vi.mock("@/lib/memory/provider", () => ({
  getMemoryProvider: vi.fn(),
}));

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function memory(
  blobId: string,
  text = `Unstructured test memory ${blobId}`,
): RecalledMemory {
  return {
    blobId,
    text,
    distance: 0.1,
    provider: "demo",
  };
}

function providerWith(
  listMemories: MemoryProvider["listMemories"],
): MemoryProvider {
  return {
    mode: "demo",
    async remember() {
      throw new Error("Not used by insights cache tests.");
    },
    async recall() {
      return [];
    },
    listMemories,
    async check() {
      return {
        name: "Walrus Memory",
        mode: "demo",
        status: "healthy",
        message: "Test provider",
      };
    },
  };
}

describe("insights corpus cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateInsightsCache();
  });

  it("shares one in-flight corpus load between concurrent callers", async () => {
    const pending = deferred<RecalledMemory[]>();
    const listMemories = vi.fn(() => pending.promise);
    vi.mocked(getMemoryProvider).mockReturnValue(providerWith(listMemories));

    const first = getInsightsSnapshot();
    const second = getInsightsSnapshot();

    expect(listMemories).toHaveBeenCalledTimes(1);
    expect(listMemories).toHaveBeenCalledWith(500);

    pending.resolve([memory("shared")]);
    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

    expect(firstSnapshot.memories.map(({ blobId }) => blobId)).toEqual([
      "shared",
    ]);
    expect(secondSnapshot.memories.map(({ blobId }) => blobId)).toEqual([
      "shared",
    ]);
    expect(firstSnapshot.calibration).toHaveLength(5);
    expect(firstSnapshot.recencyWeighted).toMatchObject({
      leaderboard: [],
      halfLifeDays: 180,
      anchorAt: null,
    });
    expect(listMemories).toHaveBeenCalledTimes(1);
  });

  it("normalizes recalled text in the response without mutating provider data", async () => {
    const dash = String.fromCodePoint(0x2014);
    const providerMemory = memory("legacy", `Legacy${dash}memory`);
    vi.mocked(getMemoryProvider).mockReturnValue(
      providerWith(async () => [providerMemory]),
    );

    const snapshot = await getInsightsSnapshot();

    expect(snapshot.memories[0].text).toBe("Legacy - memory");
    expect(providerMemory.text).toBe(`Legacy${dash}memory`);
  });

  it("does not let an invalidated load overwrite the replacement generation", async () => {
    const stale = deferred<RecalledMemory[]>();
    const fresh = deferred<RecalledMemory[]>();
    let loadCount = 0;
    const listMemories = vi.fn(() => {
      loadCount += 1;
      return loadCount === 1 ? stale.promise : fresh.promise;
    });
    vi.mocked(getMemoryProvider).mockReturnValue(providerWith(listMemories));

    const staleRequest = getInsightsSnapshot();
    expect(listMemories).toHaveBeenCalledTimes(1);

    invalidateInsightsCache();
    const freshRequest = getInsightsSnapshot();
    expect(listMemories).toHaveBeenCalledTimes(2);

    fresh.resolve([memory("fresh")]);
    expect((await freshRequest).memories.map(({ blobId }) => blobId)).toEqual([
      "fresh",
    ]);

    stale.resolve([memory("stale")]);
    expect((await staleRequest).memories.map(({ blobId }) => blobId)).toEqual([
      "stale",
    ]);

    const cached = await getInsightsSnapshot();
    expect(cached.memories.map(({ blobId }) => blobId)).toEqual(["fresh"]);
    expect(listMemories).toHaveBeenCalledTimes(2);
  });
});
