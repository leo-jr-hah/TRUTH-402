import { beforeEach, describe, expect, it } from "vitest";

import { GET as signal } from "@/app/api/oracle/markets/[id]/signal/route";
import { verifyForecastHash } from "@/lib/forecast-integrity";
import {
  computeIncentiveEconomics,
  informationMetrics,
  incentiveEconomicsSchema,
} from "@/lib/oracle-economics";
import { clearRateLimitState } from "@/lib/request-guards";
import { createSeedDatabase } from "@/lib/seed";
import {
  getInsightsSnapshot,
  invalidateInsightsCache,
} from "@/lib/services/insights";
import {
  buildOracleSnapshot,
  commitOracleForecast,
  getOracleSignal,
} from "@/lib/services/oracle";
import { readDatabase, resetStoreForTests, updateMarket } from "@/lib/store";
import { getOracleRevenueLedger } from "@/lib/tatum";
import type {
  Credibility,
  MemoryCalibratedProbability,
  OracleForecastMemory,
  Trade,
} from "@/types/domain";

const probabilities = (
  p: number[],
  q: number[],
): MemoryCalibratedProbability[] =>
  p.map((oracleProbability, i) => ({
    outcomeId: String(i),
    label: String(i),
    oracleProbability,
    marketProbability: q[i],
    edgeDivergence: 0,
    trustedConviction: 0,
  }));
const backer = (id: string, rank = 1, weight = 1) =>
  ({
    participantId: id,
    displayName: id,
    trustRank: rank,
    profitRank: rank,
    shrinkageSkillScore: weight,
    totalConviction: 999,
  }) as Credibility;
const trade = (id: string, amount = 100) =>
  ({ participantId: id, amount }) as Trade;

describe("information metrics and exact forecaster royalty accounting", () => {
  beforeEach(async () => {
    await resetStoreForTests();
    invalidateInsightsCache();
    clearRateLimitState();
  });
  it("computes shifts from probabilities, not a stale delta; handles KL support boundaries", () => {
    const metrics = informationMetrics(probabilities([0.75, 0.25], [0.5, 0.5]));
    expect(metrics.maxAbsShift).toBe(0.25);
    expect(metrics.estimatedAgentEvBps).toBe(2500);
    expect(metrics.klDivergenceBits).toBeCloseTo(
      0.75 * Math.log2(1.5) + 0.25 * Math.log2(0.5),
      14,
    );
    expect(informationMetrics(probabilities([0, 1], [0, 1]))).toMatchObject({
      klDivergenceBits: 0,
      klDivergenceInfinite: false,
      maxAbsShift: 0,
    });
    expect(
      informationMetrics(probabilities([0, 1], [0.5, 0.5])).klDivergenceBits,
    ).toBe(1);
    expect(informationMetrics(probabilities([0.2, 0.8], [0, 1]))).toMatchObject(
      { klDivergenceBits: null, klDivergenceInfinite: true },
    );
    expect(informationMetrics([]).klDivergenceBits).toBe(0);
    expect(() =>
      informationMetrics(probabilities([NaN, 1], [0.5, 0.5])),
    ).toThrow();
    expect(() =>
      informationMetrics(probabilities([0.8, 0.8], [0.5, 0.5])),
    ).toThrow();
    expect(() =>
      informationMetrics(probabilities([-1, 2], [0.5, 0.5])),
    ).toThrow();
  });
  it("deterministically allocates integer micros with a stable ID tie break and an exact 80/20 total", () => {
    const p = probabilities([0.5, 0.5], [0.5, 0.5]);
    const market = { trades: [trade("c"), trade("b"), trade("a")] };
    const result = computeIncentiveEconomics(
      market,
      p,
      [backer("c"), backer("b"), backer("a")],
      [],
    );
    expect(
      result.forecasterRoyalties.map((r) => [
        r.participantId,
        r.royaltyMicroUsdc,
      ]),
    ).toEqual([
      ["a", "2667"],
      ["b", "2667"],
      ["c", "2666"],
    ]);
    expect(result).toEqual(
      computeIncentiveEconomics(
        { trades: [...market.trades].reverse() },
        p,
        [backer("a"), backer("b"), backer("c")],
        [],
      ),
    );
    expect(
      result.forecasterRoyalties.reduce(
        (sum, r) => sum + Number(r.royaltyMicroUsdc),
        Number(result.protocolFeeMicroUsdc),
      ),
    ).toBe(10000);
    expect(incentiveEconomicsSchema.safeParse(result).success).toBe(true);
    expect(
      incentiveEconomicsSchema.safeParse({
        ...result,
        unallocatedBackerPoolMicroUsdc: "1",
      }).success,
    ).toBe(false);
  });
  it("uses W * log1p(aggregate conviction), not trade count or historical conviction", () => {
    const p = probabilities([0.5, 0.5], [0.5, 0.5]);
    const board = [backer("a", 1, 2), backer("b", 2, 1)];
    const result = computeIncentiveEconomics(
      { trades: [trade("a", 99), trade("b", 9)] },
      p,
      board,
      [],
    );
    expect(result.forecasterRoyalties.map((r) => r.royaltyMicroUsdc)).toEqual([
      "6400",
      "1600",
    ]);
    expect(result).toEqual(
      computeIncentiveEconomics(
        { trades: [trade("a", 40), trade("a", 59), trade("b", 9)] },
        p,
        board,
        [],
      ),
    );
    for (const trades of [[], [trade("a", 0)]]) {
      const empty = computeIncentiveEconomics({ trades }, p, board, []);
      expect(empty.forecasterRoyalties).toEqual([]);
      expect(empty.unallocatedBackerPoolMicroUsdc).toBe("8000");
    }
    const zero = computeIncentiveEconomics(
      { trades: [trade("a")] },
      p,
      [backer("a", 1, 0)],
      [],
    );
    expect(zero.forecasterRoyalties).toEqual([]);
    expect(() =>
      computeIncentiveEconomics({ trades: [trade("a", -1)] }, p, board, []),
    ).toThrow();
  });
  it("keeps exact pool totals over varied weights and does not reward zero-weight entries", () => {
    const p = probabilities([0.5, 0.5], [0.5, 0.5]);
    for (let count = 1; count <= 60; count++) {
      const board = Array.from({ length: count }, (_, i) =>
        backer(`p${i}`, i + 1, i === 0 && count > 1 ? 0 : (i + 1) * 0.13),
      );
      const market = {
        trades: board.map((entry, i) =>
          trade(entry.participantId, (i + 1) ** 2),
        ),
      };
      const result = computeIncentiveEconomics(market, p, board, []);
      expect(
        result.forecasterRoyalties.reduce(
          (total, royalty) => total + Number(royalty.royaltyMicroUsdc),
          0,
        ),
      ).toBe(8000);
      expect(incentiveEconomicsSchema.safeParse(result).success).toBe(true);
      if (count > 1)
        expect(
          result.forecasterRoyalties.some((r) => r.participantId === "p0"),
        ).toBe(false);
    }
  });
  it("includes actual backing blob IDs and freezes economics into new forecast commitments", async () => {
    const market = createSeedDatabase().markets.find(
      (m) => m.id === "mkt-sports-final",
    )!;
    const snapshot = buildOracleSnapshot(market, await getInsightsSnapshot());
    expect(
      snapshot.incentiveEconomics?.forecasterRoyalties.length,
    ).toBeGreaterThan(0);
    for (const royalty of snapshot.incentiveEconomics!.forecasterRoyalties) {
      expect(royalty.backingBlobIds.length).toBeGreaterThan(0);
      expect(
        royalty.backingBlobIds.every((id) =>
          snapshot.walrusEvidenceBlobs.some((blob) => blob.blobId === id),
        ),
      ).toBe(true);
    }
    const frozen = await commitOracleForecast(market.id);
    await updateMarket(market.id, (m) => ({ ...m, trades: [] }));
    const report = await getOracleSignal(market.id);
    expect(report.incentiveEconomics).toEqual(
      frozen.snapshot.incentiveEconomics,
    );
    const record = report.forecastRecord as OracleForecastMemory;
    const tampered = structuredClone(report.snapshot);
    tampered.incentiveEconomics!.forecasterRoyalties[0].royaltyMicroUsdc = "0";
    expect(
      (await verifyForecastHash(record, frozen.preCommitmentProof, tampered))
        .matches,
    ).toBe(false);
  });
  it("persists one allocation atomically with redemption and never double-accrues a replay", async () => {
    const id = "mkt-sports-final";
    const request = () =>
      new Request(`http://localhost/api/oracle/markets/${id}/signal`, {
        headers: { "x-payment-digest": "demo-sui-tx-royalties" },
      });
    const results = await Promise.all([
      signal(request(), { params: Promise.resolve({ id }) }),
      signal(request(), { params: Promise.resolve({ id }) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const ledger = await getOracleRevenueLedger();
    expect(ledger.royaltyAccounting).toMatchObject({
      status: "accrual-only",
      protocolFeeMicroUsdc: "2000",
      backerPoolMicroUsdc: "8000",
      allocatedRoyaltiesMicroUsdc: "8000",
      paidOutMicroUsdc: "0",
    });
    expect((await readDatabase()).oraclePaymentReceipts).toHaveLength(1);
    expect(ledger.entries[0].incentiveEconomics).toBeDefined();
  });
});
