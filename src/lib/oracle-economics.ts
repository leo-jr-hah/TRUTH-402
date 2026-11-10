import { z } from "zod";

import { removeEmDashes } from "@/lib/sanitize";
import type {
  Credibility,
  Market,
  MemoryCalibratedProbability,
  VerdictoMemoryRecord,
} from "@/types/domain";
import type { OracleIncentiveEconomics, OracleSnapshot } from "@/types/oracle";

const micros = z.string().regex(/^(0|[1-9][0-9]*)$/u);
export const incentiveEconomicsSchema = z
  .object({
    klDivergenceBits: z.number().finite().nonnegative().nullable(),
    klDivergenceInfinite: z.boolean(),
    maxAbsShift: z.number().min(0).max(1),
    estimatedEdgeBps: z.number().int().min(0).max(10000),
    estimatedAgentEvBps: z.number().int().min(0).max(10000),
    queryCostMicroUsdc: z.literal("10000"),
    protocolTreasuryMicroUsdc: z.literal("2000"),
    forecasterPoolMicroUsdc: z.literal("8000"),
    protocolFeeMicroUsdc: z.literal("2000"),
    backerPoolMicroUsdc: z.literal("8000"),
    unallocatedBackerPoolMicroUsdc: micros,
    allocationStatus: z.literal("accrual-only"),
    forecasterRoyalties: z
      .array(
        z.object({
          participantId: z.string(),
          displayName: z.string(),
          trustRank: z.number().int().positive(),
          profitRank: z.number().int().positive(),
          influenceWeight: z.number().finite().nonnegative(),
          sharePercent: z.number().min(0).max(100),
          royaltyMicroUsdc: micros,
          backingRecordIds: z.array(z.string()),
          backingBlobIds: z.array(z.string()),
        }),
      )
      .max(500),
  })
  .superRefine((value, ctx) => {
    const allocated = value.forecasterRoyalties.reduce(
      (sum, item) => sum + BigInt(item.royaltyMicroUsdc),
      BigInt(0),
    );
    if (
      allocated + BigInt(value.unallocatedBackerPoolMicroUsdc) !==
        BigInt(8000) ||
      value.klDivergenceInfinite !== (value.klDivergenceBits === null) ||
      value.estimatedAgentEvBps !== Math.round(value.maxAbsShift * 10000) ||
      value.estimatedEdgeBps !== value.estimatedAgentEvBps ||
      new Set(value.forecasterRoyalties.map((r) => r.participantId)).size !==
        value.forecasterRoyalties.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent incentive economics.",
      });
    }
  });

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** KL and shifts measure disagreement, not accuracy or guaranteed economic value. */
export function informationMetrics(
  probabilities: MemoryCalibratedProbability[],
) {
  if (
    probabilities.some((row) =>
      [row.oracleProbability, row.marketProbability].some(
        (p) => !Number.isFinite(p) || p < 0 || p > 1,
      ),
    ) ||
    (probabilities.length > 0 &&
      ["oracleProbability", "marketProbability"].some(
        (key) =>
          Math.abs(
            probabilities.reduce(
              (sum, row) =>
                sum + row[key as "oracleProbability" | "marketProbability"],
              0,
            ) - 1,
          ) > 1e-8,
      ))
  ) {
    throw new RangeError(
      "Information metrics require normalized probability distributions.",
    );
  }
  const maxAbsShift = probabilities.reduce(
    (max, row) =>
      Math.max(max, Math.abs(row.oracleProbability - row.marketProbability)),
    0,
  );
  const klDivergenceInfinite = probabilities.some(
    (row) => row.oracleProbability > 0 && row.marketProbability === 0,
  );
  const klDivergenceBits = klDivergenceInfinite
    ? null
    : Math.max(
        0,
        probabilities.reduce((sum, row) => {
          const p = row.oracleProbability;
          // 0 * log(0 / q) is defined as zero, including q = 0.
          return p === 0
            ? sum
            : sum + p * (Math.log2(p) - Math.log2(row.marketProbability));
        }, 0),
      );
  return {
    maxAbsShift,
    klDivergenceBits,
    klDivergenceInfinite,
    estimatedAgentEvBps: Math.round(maxAbsShift * 10000),
  };
}

/** Largest-remainder integer apportionment. A pool without eligible backers stays unallocated. */
export function computeIncentiveEconomics(
  market: Pick<Market, "trades">,
  probabilities: MemoryCalibratedProbability[],
  trustedBackers: Credibility[],
  records: VerdictoMemoryRecord[],
  evidence: OracleSnapshot["walrusEvidenceBlobs"] = [],
): OracleIncentiveEconomics {
  const metrics = informationMetrics(probabilities);
  const conviction = new Map<string, number>();
  for (const trade of market.trades) {
    if (!Number.isFinite(trade.amount) || trade.amount < 0)
      throw new RangeError("Conviction must be finite and nonnegative.");
    conviction.set(
      trade.participantId,
      (conviction.get(trade.participantId) ?? 0) + trade.amount,
    );
  }
  const unique = new Map(
    trustedBackers.map((backer) => [backer.participantId, backer]),
  );
  if (unique.size !== trustedBackers.length)
    throw new RangeError("Backers must have unique participant IDs.");
  const weights = [...unique.values()]
    .map((backer) => {
      const amount = conviction.get(backer.participantId) ?? 0;
      const trustWeight = Number.isFinite(backer.shrinkageSkillScore)
        ? Math.max(0, backer.shrinkageSkillScore)
        : 0;
      const weight = trustWeight * Math.log1p(amount);
      if (!Number.isFinite(weight))
        throw new RangeError("Influence weight must be finite.");
      return { backer, weight };
    })
    .filter(({ weight }) => weight > 0)
    .sort(
      (a, b) =>
        a.backer.trustRank - b.backer.trustRank ||
        compareIds(a.backer.participantId, b.backer.participantId),
    );
  // Scale first so summing many very large (but finite) weights cannot overflow.
  const maximum = Math.max(0, ...weights.map(({ weight }) => weight));
  const total = weights.reduce((sum, { weight }) => sum + weight / maximum, 0);
  const shares = weights.map((item) => {
    const fraction = item.weight / maximum / total;
    const exact = fraction * 8000;
    return {
      ...item,
      fraction,
      micros: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  const remaining = 8000 - shares.reduce((sum, item) => sum + item.micros, 0);
  [...shares]
    .sort(
      (a, b) =>
        b.remainder - a.remainder ||
        a.backer.trustRank - b.backer.trustRank ||
        compareIds(a.backer.participantId, b.backer.participantId),
    )
    .forEach((item, index) => {
      if (index < remaining) item.micros += 1;
    });
  const forecasterRoyalties = shares.map(
    ({ backer, weight, fraction, micros }) => {
      const backingRecordIds = [
        ...new Set(
          records
            .filter(
              (r) =>
                r.kind === "participant_performance" &&
                r.participantId === backer.participantId,
            )
            .map((r) => r.recordId),
        ),
      ].sort(compareIds);
      const ids = new Set(backingRecordIds);
      return {
        participantId: backer.participantId,
        displayName: removeEmDashes(backer.displayName),
        trustRank: backer.trustRank,
        profitRank: backer.profitRank,
        influenceWeight: weight,
        sharePercent: Math.round(fraction * 10000) / 100,
        royaltyMicroUsdc: String(micros),
        backingRecordIds,
        backingBlobIds: [
          ...new Set(
            evidence
              .filter((blob) => ids.has(blob.recordId))
              .map((blob) => blob.blobId),
          ),
        ].sort(compareIds),
      };
    },
  );
  return {
    ...metrics,
    estimatedEdgeBps: metrics.estimatedAgentEvBps,
    queryCostMicroUsdc: "10000",
    protocolTreasuryMicroUsdc: "2000",
    forecasterPoolMicroUsdc: "8000",
    protocolFeeMicroUsdc: "2000",
    backerPoolMicroUsdc: "8000",
    unallocatedBackerPoolMicroUsdc: forecasterRoyalties.length ? "0" : "8000",
    allocationStatus: "accrual-only",
    forecasterRoyalties,
  };
}
