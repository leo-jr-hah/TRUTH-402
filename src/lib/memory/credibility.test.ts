import { describe, expect, it } from "vitest";

import {
  betaCredibleInterval,
  betaCredibility,
  computeMemoryCalibratedSignal,
  computeShrinkageSkill,
  computeRealizedEdge,
  computeShrinkageSkillScore,
  computeProfitVsTrustRanking,
  computeOracleForecast,
  deriveCalibration,
  deriveCredibility,
  deriveLearningMetrics,
  RECENCY_HALF_LIFE_DAYS,
  recencyAnchorAt,
  realizedEdge,
  observationEdge,
  uniqueRecords,
} from "@/lib/memory/credibility";
import { createSeedDatabase } from "@/lib/seed";
import type { MarketType, ParticipantPerformanceMemory } from "@/types/domain";

function observation(
  recordId: string,
  participantId: string,
  correct: boolean,
  overrides: Partial<
    Pick<
      ParticipantPerformanceMemory,
      "confidence" | "marketType" | "occurredAt"
    >
  > = {},
): ParticipantPerformanceMemory {
  return {
    schema: "verdicto.memory",
    version: 1,
    recordId,
    kind: "participant_performance",
    marketId: `market-${recordId}`,
    marketType: overrides.marketType ?? "simple",
    marketTitle: "Test decision",
    occurredAt: overrides.occurredAt ?? "2026-10-25T00:00:00.000Z",
    summary: "Test observation.",
    participantId,
    displayName: participantId === "a" ? "Avery" : "Blair",
    role: "trader",
    predictedOutcomeId: "one",
    predictedOutcomeLabel: "One",
    winningOutcomeId: correct ? "one" : "two",
    winningOutcomeLabel: correct ? "One" : "Two",
    correct,
    confidence: overrides.confidence ?? 0.8,
    conviction: 100,
    closingPrice: 0.6,
  };
}

describe("credibility derivation", () => {
  it("computes per-share edge, not Brier loss or stake-dependent skill", () => {
    expect(realizedEdge(true, 0.2)).toBe(0.8);
    expect(realizedEdge(false, 0.2)).toBe(-0.2);
    expect(
      observationEdge({
        ...observation("edge", "a", true),
        entryPrice: 0.8,
        realizedEdge: 999,
      }),
    ).toBeCloseTo(0.2);
    expect(observationEdge(observation("legacy", "a", false))).toBeCloseTo(
      -0.4,
    );
    expect(
      observationEdge({
        ...observation("neutral", "a", true),
        closingPrice: 0,
      }),
    ).toBe(0.5);
    for (const price of [0, 1, -1, Number.NaN, Infinity])
      expect(() => realizedEdge(true, price)).toThrow(RangeError);
  });

  it("implements sample deviation, prior shrinkage and a bounded monotone index", () => {
    const result = computeShrinkageSkill([0.1, 0.2, 0.3]);
    expect(result.meanRealizedEdge).toBeCloseTo(0.2);
    expect(result.shrinkageSkillScore).toBeCloseTo(
      (3 / 13) * (0.2 / (0.1 / Math.sqrt(3))),
    );
    expect(computeShrinkageSkill([]).skillScore).toBe(50);
    expect(computeShrinkageSkill([0, 0]).shrinkageSkillScore).toBe(0);
    expect(computeShrinkageSkill([0.5]).shrinkageSkillScore).toBeCloseTo(
      (1 / 11) * 10,
    );
    expect(
      computeShrinkageSkill([0.5, 0.5, 0.5]).shrinkageSkillScore,
    ).toBeGreaterThan(computeShrinkageSkill([0.5]).shrinkageSkillScore);
    expect(computeShrinkageSkill([-0.5]).skillScore).toBeLessThan(50);
    expect(
      computeShrinkageSkill(Array(1000).fill(0.9)).skillScore,
    ).toBeLessThan(100);
    for (const edges of [[NaN], [Infinity], [1.01]])
      expect(() => computeShrinkageSkill(edges)).toThrow(RangeError);
  });

  it("separates a lucky whale's profit rank from a consistent trader's trust rank", () => {
    const whale = {
      ...observation("whale", "whale", true),
      entryPrice: 0.5,
      conviction: 100_000,
    };
    const grinder = Array.from({ length: 12 }, (_, index) => ({
      ...observation(`grinder-${index}`, "grinder", true),
      entryPrice: 0.5 + (index % 3) * 0.01,
      conviction: 10,
    }));
    const rows = deriveCredibility([whale, ...grinder]);
    const lucky = rows.find((row) => row.participantId === "whale")!;
    const consistent = rows.find((row) => row.participantId === "grinder")!;
    expect(lucky.profitRank).toBe(1);
    expect(lucky.trustRank).toBe(2);
    expect(lucky.rankDelta).toBe(-1);
    expect(consistent.rankDelta).toBe(1);
    expect(lucky.skillScore).toBeLessThan(consistent.skillScore);
    expect(lucky.rawPnl).toBe(50_000);
    expect(
      deriveCredibility([...grinder, whale]).map((row) => [
        row.participantId,
        row.trustRank,
      ]),
    ).toEqual(rows.map((row) => [row.participantId, row.trustRank]));
  });

  it("normalizes oracle forecasts and resists trade-splitting amplification", () => {
    const market = createSeedDatabase().markets.find(
      (entry) => entry.id === "mkt-climate-grant",
    )!;
    const leaderboard = deriveCredibility(
      Array.from({ length: 8 }, (_, index) => ({
        ...observation(`maya-${index}`, "maya", true),
        entryPrice: 0.5,
      })),
    );
    const signal = computeMemoryCalibratedSignal(market, leaderboard);
    expect(
      signal.reduce((sum, row) => sum + row.oracleProbability, 0),
    ).toBeCloseTo(1, 14);
    expect(
      signal.every(
        (row) => row.oracleProbability >= 0 && row.oracleProbability <= 1,
      ),
    ).toBe(true);
    expect(signal[1].edgeDivergence).toBeGreaterThan(0);
    expect(
      computeMemoryCalibratedSignal(market, []).every(
        (row) => Math.abs(row.edgeDivergence) < 1e-12,
      ),
    ).toBe(true);
    const split = {
      ...market,
      trades: market.trades.flatMap((trade) => [
        { ...trade, amount: trade.amount / 2 },
        { ...trade, amount: trade.amount / 2 },
      ]),
    };
    expect(computeMemoryCalibratedSignal(split, leaderboard)).toEqual(signal);
    expect(
      computeMemoryCalibratedSignal(market, leaderboard, 0).every(
        (row) => Math.abs(row.edgeDivergence) < 1e-12,
      ),
    ).toBe(true);
    expect(() =>
      computeMemoryCalibratedSignal(
        { ...market, status: "resolved" },
        leaderboard,
      ),
    ).toThrow(RangeError);
    expect(() =>
      computeMemoryCalibratedSignal(market, leaderboard, -1),
    ).toThrow(RangeError);
    expect(() =>
      computeMemoryCalibratedSignal({ ...market, outcomes: [] }, leaderboard),
    ).toThrow(RangeError);
    expect(() =>
      computeMemoryCalibratedSignal(
        { ...market, outcomes: [{ ...market.outcomes[0], price: NaN }] },
        leaderboard,
      ),
    ).toThrow(RangeError);
  });
  it("uses transparent Beta smoothing and preserves evidence counts", () => {
    const leaderboard = deriveCredibility([
      observation("1", "a", true),
      observation("2", "a", true),
      observation("3", "a", false),
      observation("4", "b", true),
    ]);
    const avery = leaderboard.find((entry) => entry.participantId === "a")!;
    const blair = leaderboard.find((entry) => entry.participantId === "b")!;

    expect(avery.accuracy).toBe(66.7);
    expect(avery.credibilityScore).toBe(60);
    expect(avery.credibleInterval).toEqual({
      level: 90,
      lowerBound: 24.9,
      upperBound: 90.2,
    });
    expect(avery.correctCount).toBe(2);
    expect(avery.totalCount).toBe(3);
    expect(avery.evidenceWeight).toBe(3);
    expect(blair.accuracy).toBe(100);
    expect(blair.credibilityScore).toBe(66.7);
    expect(blair.credibleInterval).toEqual({
      level: 90,
      lowerBound: 22.4,
      upperBound: 97.5,
    });
    expect(blair.byMarketType.opportunity).toBeNull();
  });

  it("derives independent Simple Choice and Opportunity / Ranking scores", () => {
    const avery = deriveCredibility([
      observation("simple-correct", "a", true),
      observation("simple-incorrect", "a", false),
      observation("opportunity-correct", "a", true, {
        marketType: "opportunity",
      }),
    ])[0];

    expect(avery.accuracy).toBe(66.7);
    expect(avery.credibilityScore).toBe(60);
    expect(avery.byMarketType.simple).toMatchObject({
      correctCount: 1,
      totalCount: 2,
      accuracy: 50,
      credibilityScore: 50,
    });
    expect(avery.byMarketType.opportunity).toMatchObject({
      correctCount: 1,
      totalCount: 1,
      accuracy: 100,
      credibilityScore: 66.7,
    });
    expect(avery.marketTypes).toEqual([
      "opportunity",
      "simple",
    ] satisfies MarketType[]);
  });

  it("groups confidence into stable calibration buckets", () => {
    const calibration = deriveCalibration([
      observation("low", "a", true, { confidence: 0.19 }),
      observation("boundary", "a", false, { confidence: 0.2 }),
      observation("high", "a", true, { confidence: 0.8 }),
      observation("certain", "a", false, { confidence: 1 }),
    ]);

    expect(calibration.map((bucket) => bucket.label)).toEqual([
      "0–19%",
      "20–39%",
      "40–59%",
      "60–79%",
      "80–100%",
    ]);
    expect(calibration[0]).toMatchObject({
      correctCount: 1,
      totalCount: 1,
      averageConfidence: 19,
      actualAccuracy: 100,
      calibrationGap: 81,
    });
    expect(calibration[1]).toMatchObject({
      correctCount: 0,
      totalCount: 1,
      averageConfidence: 20,
      actualAccuracy: 0,
      calibrationGap: -20,
    });
    expect(calibration[2]).toMatchObject({
      totalCount: 0,
      averageConfidence: null,
      actualAccuracy: null,
      calibrationGap: null,
    });
    expect(calibration[4]).toMatchObject({
      correctCount: 1,
      totalCount: 2,
      averageConfidence: 90,
      actualAccuracy: 50,
      calibrationGap: -40,
    });
  });

  it("applies deterministic 180-day half-life weighting to scores and calibration", () => {
    const newest = "2026-10-25T00:00:00.000Z";
    const older = new Date(
      Date.parse(newest) - RECENCY_HALF_LIFE_DAYS * 86_400_000,
    ).toISOString();
    const records = [
      observation("older-incorrect", "a", false, {
        confidence: 0.8,
        occurredAt: older,
      }),
      observation("newer-correct", "a", true, {
        confidence: 0.8,
        occurredAt: newest,
      }),
    ];

    const equal = deriveCredibility(records)[0];
    const recent = deriveCredibility(records, { weighting: "recency" })[0];
    const calibration = deriveCalibration(records, { weighting: "recency" });

    expect(equal.accuracy).toBe(50);
    expect(equal.credibilityScore).toBe(50);
    expect(recent.correctCount).toBe(1);
    expect(recent.totalCount).toBe(2);
    expect(recent.evidenceWeight).toBe(1.5);
    expect(recent.accuracy).toBe(66.7);
    expect(recent.credibilityScore).toBe(57.1);
    expect(recent.credibleInterval.level).toBe(90);
    expect(recent.credibleInterval.lowerBound).toBeLessThan(
      recent.credibilityScore,
    );
    expect(recent.credibleInterval.upperBound).toBeGreaterThan(
      recent.credibilityScore,
    );
    expect(calibration[4]).toMatchObject({
      totalCount: 2,
      evidenceWeight: 1.5,
      actualAccuracy: 66.7,
    });
    expect(recencyAnchorAt(records)).toBe(newest);
  });

  it("rejects an invalid recency half-life", () => {
    expect(() =>
      deriveCredibility([observation("1", "a", true)], {
        weighting: "recency",
        halfLifeDays: 0,
      }),
    ).toThrow(/half-life/i);
  });

  it("keeps empty credibility and calibration states explicit", () => {
    expect(deriveCredibility([])).toEqual([]);
    expect(recencyAnchorAt([])).toBeNull();
    expect(deriveCalibration([])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "0-20",
          totalCount: 0,
          averageConfidence: null,
          actualAccuracy: null,
          calibrationGap: null,
        }),
      ]),
    );
  });

  it("handles Beta prior edge cases and rejects impossible evidence", () => {
    expect(betaCredibility(0, 0)).toBe(0.5);
    expect(betaCredibility(0, 1)).toBeCloseTo(1 / 3);
    expect(betaCredibility(1, 1)).toBeCloseTo(2 / 3);
    expect(betaCredibility(0, 0, 2, 3)).toBe(0.4);
    expect(() => betaCredibility(2, 1)).toThrow(/outside their domain/i);
    expect(() => betaCredibility(-1, 0)).toThrow(/outside their domain/i);
    expect(() => betaCredibility(0.5, 1)).toThrow(/outside their domain/i);
    expect(() => betaCredibility(0, 0.5)).toThrow(/outside their domain/i);
    expect(() => betaCredibility(0, 0, 0, 1)).toThrow(/outside their domain/i);
    expect(() => betaCredibility(0, 0, 1, Number.POSITIVE_INFINITY)).toThrow(
      /outside their domain/i,
    );
  });

  it("derives deterministic equal-tail Beta intervals", () => {
    const uniform = betaCredibleInterval(0, 0);
    expect(uniform.lowerBound).toBeCloseTo(0.05, 12);
    expect(uniform.upperBound).toBeCloseTo(0.95, 12);

    const oneSuccess = betaCredibleInterval(1, 1);
    expect(oneSuccess.lowerBound).toBeCloseTo(0.22360679775, 10);
    expect(oneSuccess.upperBound).toBeCloseTo(0.97467943448, 10);

    const symmetric = betaCredibleInterval(5, 10);
    expect(symmetric.lowerBound).toBeCloseTo(0.27124991408, 10);
    expect(symmetric.upperBound).toBeCloseTo(0.72875008592, 10);
    expect(symmetric.lowerBound + symmetric.upperBound).toBeCloseTo(1, 12);

    const concentrated = betaCredibleInterval(50, 100);
    expect(concentrated.upperBound - concentrated.lowerBound).toBeLessThan(
      symmetric.upperBound - symmetric.lowerBound,
    );
  });

  it("rejects impossible Beta interval evidence and levels", () => {
    expect(() => betaCredibleInterval(-1, 1)).toThrow(/outside their domain/i);
    expect(() => betaCredibleInterval(2, 1)).toThrow(/outside their domain/i);
    expect(() => betaCredibleInterval(Number.NaN, 0)).toThrow(
      /outside their domain/i,
    );
    expect(() => betaCredibleInterval(0, Number.NaN)).toThrow(
      /outside their domain/i,
    );
    expect(() => betaCredibleInterval(0, 0, Number.NaN)).toThrow(
      /outside their domain/i,
    );
    expect(() => betaCredibleInterval(0, 0, 0)).toThrow(
      /outside their domain/i,
    );
    expect(() => betaCredibleInterval(0, 0, 1)).toThrow(
      /outside their domain/i,
    );
  });

  it("deduplicates records before metrics and scoring", () => {
    const database = createSeedDatabase();
    const duplicate = database.demoMemories[0];
    const memories = [...database.demoMemories, duplicate];
    const records = uniqueRecords(memories);
    const metrics = deriveLearningMetrics(memories, records);

    expect(records.length).toBe(database.demoMemories.length);
    expect(metrics.memoryCount).toBe(memories.length);
    expect(metrics.parsedMemoryCount).toBe(records.length);
    const resolvedCount = database.markets.filter(
      (market) => market.status === "resolved",
    ).length;
    expect(metrics.resolvedMarketCount).toBe(resolvedCount);
    expect(metrics.signalObservationCount).toBe(resolvedCount);
  });

  it("implements YES/NO realized edge without confusing market price with a belief", () => {
    expect(computeRealizedEdge("YES", 0.2, 1)).toBeCloseTo(0.8);
    expect(computeRealizedEdge("NO", 0.2, 1)).toBeCloseTo(-0.8);
    expect(computeRealizedEdge("NO", 0.7, 0)).toBe(0.7);
    expect(computeRealizedEdge("YES", 0, 0)).toBe(0);
    expect(() => computeRealizedEdge("YES", NaN, 1)).toThrow(RangeError);
    const edges = Array.from({ length: 40 }, (_, index) =>
      index % 5 === 0 ? -0.15 : 0.3,
    );
    expect(computeShrinkageSkillScore(edges).skillScore).toBeGreaterThan(
      computeShrinkageSkillScore([0.95]).skillScore,
    );
    expect(computeShrinkageSkillScore([0.1, 0.2, 0.3])).toMatchObject({
      shrinkageFactor: 3 / 13,
    });
    expect(computeShrinkageSkillScore([-0.4, -0.3]).trustWeight).toBe(0);
    for (const [k, sigma] of [
      [-1, 0.05],
      [10, 0],
      [Infinity, 0.05],
      [10, NaN],
    ])
      expect(() => computeShrinkageSkillScore(edges, k, sigma)).toThrow(
        RangeError,
      );
  });

  it("ranks cohorts deterministically and reports their classifications", () => {
    const participants = [
      { participantId: "whale", rawPnl: 142000, edges: [0.94, -0.52] },
      { participantId: "sharp", rawPnl: 4000, edges: Array(40).fill(0.2) },
      { participantId: "negative", rawPnl: -100, edges: [-0.1, -0.3] },
    ];
    const ranks = computeProfitVsTrustRanking(participants);
    expect(ranks[0]).toMatchObject({
      participantId: "sharp",
      profitRank: 2,
      trustRank: 1,
      rankDelta: 1,
      classification: "calibrated_sharp",
    });
    expect(ranks[1].classification).toBe("lucky_whale");
    expect(ranks[2].classification).toBe("overconfident");
    expect(computeProfitVsTrustRanking([...participants].reverse())).toEqual(
      ranks,
    );
    expect(() =>
      computeProfitVsTrustRanking([participants[0], participants[0]]),
    ).toThrow(RangeError);
    expect(computeProfitVsTrustRanking([])).toEqual([]);
  });

  it("uses the exact binary directional formula, clipping and finite input guards", () => {
    const positions = [
      { trustWeight: 3, side: 1 as const, size: 10 },
      { trustWeight: 1, side: -1 as const, size: 10 },
    ];
    expect(computeOracleForecast(0.5, positions)).toMatchObject({
      oracleProbability: 0.59,
      marketPrice: 0.5,
    });
    expect(computeOracleForecast(0.5, positions).confidenceLevel).toBeCloseTo(
      0.5,
    );
    expect(computeOracleForecast(0.99, [positions[0]]).oracleProbability).toBe(
      0.99,
    );
    expect(computeOracleForecast(0.01, [positions[1]]).oracleProbability).toBe(
      0.01,
    );
    expect(computeOracleForecast(0.4, []).shiftDelta).toBe(0);
    expect(
      computeOracleForecast(0.4, [{ trustWeight: 0, side: 1, size: 0 }])
        .confidenceLevel,
    ).toBe(0);
    expect(() => computeOracleForecast(NaN, positions)).toThrow(RangeError);
    expect(() =>
      computeOracleForecast(0.5, [{ trustWeight: 1, side: 1, size: -1 }]),
    ).toThrow(RangeError);
    expect(() => computeOracleForecast(0.5, positions, Infinity)).toThrow(
      RangeError,
    );
  });
});
