import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildResolutionMemories,
  deriveEntryEvidence,
  enrichPerformanceRecords,
  parseMemory,
  serializeMemory,
} from "@/lib/memory/codec";
import { createSeedDatabase } from "@/lib/seed";
import type { Market, Trade } from "@/types/domain";

describe("TRUTH402 memory codec", () => {
  const database = createSeedDatabase();
  const resolved = database.markets.filter(
    (market) => market.status === "resolved",
  );
  const records = resolved.flatMap(buildResolutionMemories);

  it("preserves every original seed byte and canonical digest", () => {
    expect(database.demoMemories.length).toBeGreaterThan(20);
    expect(
      createHash("sha256")
        .update(JSON.stringify(database.demoMemories.slice(0, 20)))
        .digest("hex"),
    ).toBe("a731366e8be6f597d3ad0852d099e44b979f2366a96c54f7a625aea1fb4dcd55");
  });

  it("derives volume-weighted entries with explicit fallback provenance", () => {
    const trade = resolved[0].trades[0];
    const trades = [
      { ...trade, amount: 10, shares: 50, priceBefore: 0.1 },
      { ...trade, amount: 30, shares: 50, priceBefore: 0.3 },
    ];
    expect(deriveEntryEvidence(trades, trade.outcomeId, true, 0.7)).toEqual({
      entryPrice: 0.4,
      realizedEdge: 0.6,
      entryPriceSource: "trade-vwap",
    });
    expect(
      deriveEntryEvidence(
        trades.map((entry) => ({ ...entry, shares: 0 })),
        trade.outcomeId,
        false,
        0.7,
      ),
    ).toMatchObject({
      entryPrice: 0.25,
      realizedEdge: -0.25,
      entryPriceSource: "trade-price-before",
    });
    expect(
      deriveEntryEvidence([], trade.outcomeId, true, 0.7).entryPrice,
    ).toBeCloseTo(0.3);
    expect(deriveEntryEvidence([], trade.outcomeId, false, 1)).toEqual({
      entryPrice: 0.5,
      realizedEdge: -0.5,
      entryPriceSource: "neutral",
    });
  });

  it("enriches copies and validates optional additions without changing IDs", () => {
    const legacy = database.demoMemories.map((memory) =>
      parseMemory(memory.text)!,
    );
    const before = JSON.stringify(legacy);
    const enriched = enrichPerformanceRecords(legacy, database.markets);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(enriched.map((record) => record.recordId)).toEqual(
      legacy.map((record) => record.recordId),
    );
    const record = enriched.find(
      (entry) => entry.kind === "participant_performance",
    )!;
    expect(parseMemory(serializeMemory(record))).toEqual(record);
    expect(
      parseMemory(
        `VERDICTO_DATA_V1:${JSON.stringify({ ...record, entryPrice: 1 })}`,
      ),
    ).toBeNull();
    expect(enrichPerformanceRecords([record], [])[0]).toEqual(record);
    expect(
      enrichPerformanceRecords(legacy, []).find(
        (entry) => entry.kind === "participant_performance",
      ),
    ).toMatchObject({ entryPriceSource: "legacy-complement" });
  });

  it("prepares more than the ten required distinct records", () => {
    expect(records.length).toBeGreaterThanOrEqual(10);
    expect(new Set(records.map((record) => record.recordId)).size).toBe(
      records.length,
    );
  });

  it("writes human-readable context and round-trips structured data", () => {
    for (const record of records) {
      const serialized = serializeMemory(record);
      expect(serialized).toContain("Verdicto Memory v1");
      expect(serialized).toContain(String.fromCodePoint(0x2014));
      expect(serialized).toContain(record.marketTitle);
      expect(parseMemory(serialized)).toEqual(record);
    }
  });

  it("creates one resolution and one signal record per resolved market", () => {
    for (const market of resolved) {
      const marketRecords = buildResolutionMemories(market);
      expect(
        marketRecords.filter((record) => record.kind === "market_resolution"),
      ).toHaveLength(1);
      expect(
        marketRecords.filter((record) => record.kind === "market_signal"),
      ).toHaveLength(1);
      expect(
        marketRecords.filter(
          (record) => record.kind === "participant_performance",
        ),
      ).toHaveLength(
        new Set(market.trades.map((trade) => trade.participantId)).size,
      );
    }
  });

  it("rejects unrelated or malformed memory text", () => {
    expect(parseMemory("ordinary text")).toBeNull();
    expect(parseMemory("VERDICTO_DATA_V1:{not-json}")).toBeNull();
    expect(() =>
      buildResolutionMemories(
        database.markets.find((market) => market.status === "open")!,
      ),
    ).toThrow(/resolved market/i);
  });

  it("recognizes only a line-framed marker, not marker text inside JSON", () => {
    const record = records[0];
    const withMarkerText = {
      ...record,
      futureText: "untrusted VERDICTO_DATA_V1: text",
    };

    expect(
      parseMemory(
        `Readable context\nVERDICTO_DATA_V1:${JSON.stringify(withMarkerText)}`,
      ),
    ).toEqual(withMarkerText);
  });

  it("parses additive fields from future schema versions", () => {
    const signal = records.find((record) => record.kind === "market_signal");
    if (!signal || signal.kind !== "market_signal") {
      throw new Error("Expected a seeded signal memory.");
    }
    const future = {
      ...signal,
      version: 2,
      futurePolicy: { calibration: "v2" },
      closingPrices: signal.closingPrices.map((price) => ({
        ...price,
        futureWeight: 0.75,
      })),
    };
    const parsed = parseMemory(
      `future envelope\nVERDICTO_DATA_V1:${JSON.stringify(future)}`,
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(2);
    expect(
      (parsed as unknown as { futurePolicy: { calibration: string } })
        .futurePolicy.calibration,
    ).toBe("v2");
    expect(parsed?.kind).toBe("market_signal");
    if (!parsed || parsed.kind !== "market_signal") {
      throw new Error("Expected a parsed signal memory.");
    }
    expect(
      (
        parsed.closingPrices[0] as unknown as {
          futureWeight: number;
        }
      ).futureWeight,
    ).toBe(0.75);
  });

  it("breaks strongest-conviction ties by earliest trade, then outcome order", () => {
    const baseTrade = {
      marketId: "mkt-tie",
      displayName: "Tie Tester",
      role: "trader" as const,
      shares: 1,
      priceBefore: 1 / 3,
      priceAfter: 1 / 3,
    };
    const trades: Trade[] = [
      {
        ...baseTrade,
        id: "late-a",
        participantId: "earliest-wins",
        outcomeId: "a",
        amount: 50,
        createdAt: "2026-10-25T12:00:00.000Z",
      },
      {
        ...baseTrade,
        id: "early-b",
        participantId: "earliest-wins",
        outcomeId: "b",
        amount: 50,
        createdAt: "2026-10-25T11:00:00.000Z",
      },
      {
        ...baseTrade,
        id: "same-b",
        participantId: "order-wins",
        outcomeId: "b",
        amount: 25,
        createdAt: "2026-10-25T10:00:00.000Z",
      },
      {
        ...baseTrade,
        id: "same-a",
        participantId: "order-wins",
        outcomeId: "a",
        amount: 25,
        createdAt: "2026-10-25T10:00:00.000Z",
      },
    ];
    const market: Market = {
      id: "mkt-tie",
      type: "simple",
      title: "Deterministic tie-break test market",
      description: "A resolved fixture for deterministic prediction selection.",
      sponsor: "Test Sponsor",
      status: "resolved",
      outcomes: [
        { id: "a", label: "A", shares: 0, price: 0.3, volume: 75 },
        { id: "b", label: "B", shares: 0, price: 0.5, volume: 75 },
        { id: "c", label: "C", shares: 0, price: 0.2, volume: 0 },
      ],
      liquidity: 250,
      totalVolume: 150,
      trades,
      tags: [],
      createdAt: "2026-10-25T09:00:00.000Z",
      updatedAt: "2026-10-25T13:00:00.000Z",
      resolvedAt: "2026-10-25T13:00:00.000Z",
      winningOutcomeId: "b",
      resolutionNote: "Resolved for deterministic testing.",
      memoryStatus: "pending",
      memoryReceipts: [],
    };
    const performance = buildResolutionMemories(market).filter(
      (record) => record.kind === "participant_performance",
    );

    expect(
      performance.find((record) => record.participantId === "earliest-wins")
        ?.predictedOutcomeId,
    ).toBe("b");
    expect(
      performance.find((record) => record.participantId === "order-wins")
        ?.predictedOutcomeId,
    ).toBe("a");
  });
});
