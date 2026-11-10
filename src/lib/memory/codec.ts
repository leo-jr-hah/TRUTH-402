import { z } from "zod";
import { createHash } from "node:crypto";

import { round } from "@/lib/identifiers";
import { incentiveEconomicsSchema } from "@/lib/oracle-economics";
import {
  canonicalJson,
  forecastPayload,
  FORECAST_HASH_VERSION,
  hasForecastBinding,
} from "@/lib/forecast-integrity";
import {
  assertCanonicalMemoryRecordId,
  createMemoryRecordId,
  MEMORY_SCHEMA_NAME,
  MEMORY_SCHEMA_VERSION,
} from "@/lib/memory/record-id";
import {
  closingSignal,
  sponsorFollowedStrictHighest,
} from "@/lib/memory/settlement";
import type {
  Market,
  OracleForecastMemory,
  MarketSignalMemory,
  ParticipantPerformanceMemory,
  Trade,
  TRUTH402MemoryRecord,
} from "@/types/domain";

const DATA_MARKER = "VERDICTO_DATA_V1:";
const MEMORY_HEADER_SEPARATOR = String.fromCodePoint(0x2014);

const memoryBase = z
  .object({
    schema: z.literal(MEMORY_SCHEMA_NAME),
    // Additive future versions remain readable when they retain the v1 fields.
    version: z.number().int().positive(),
    recordId: z.string().min(1).max(200),
    marketId: z.string().min(1),
    marketType: z.enum(["simple", "opportunity"]),
    marketTitle: z.string().min(1),
    occurredAt: z.string().datetime(),
    summary: z.string().min(1),
    category: z.enum(["SPORTS", "CRYPTO", "MACRO", "POLITICS"]).optional(),
    provenance: z.literal("synthetic-demo").optional(),
  })
  .passthrough();

const learningRankSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  meanRealizedEdge: z.number().min(-1).max(1),
  shrinkageSkillScore: z.number(),
  rawPnl: z.number(),
  profitRank: z.number().int().positive(),
  trustRank: z.number().int().positive(),
  rankDelta: z.number().int(),
});

const resolutionMemorySchema = memoryBase
  .extend({
    kind: z.literal("market_resolution"),
    sponsor: z.string(),
    winningOutcomeId: z.string(),
    winningOutcomeLabel: z.string(),
    resolutionNote: z.string().optional(),
    participantCount: z.number().int().nonnegative(),
    totalVolume: z.number().nonnegative(),
    learningUpdate: z
      .object({
        episode: z.literal("post_resolution_update"),
        computedAt: z.string().datetime(),
        provider: z.enum(["demo", "walrus"]),
        priorRecordIds: z.array(z.string().min(1)).max(500),
        changes: z
          .array(
            z.object({
              participantId: z.string(),
              displayName: z.string(),
              before: learningRankSchema.nullable(),
              after: learningRankSchema,
            }),
          )
          .max(500),
      })
      .optional(),
  })
  .passthrough();

const signalMemorySchema = memoryBase
  .extend({
    kind: z.literal("market_signal"),
    signalLeaderOutcomeId: z.string(),
    signalLeaderLabel: z.string(),
    signalLeaderPrice: z.number().min(0).max(1),
    winningOutcomeId: z.string(),
    sponsorFollowedSignal: z.boolean(),
    preCommitSuiDigest: z.string().max(100).optional(),
    closingPrices: z.array(
      z
        .object({
          outcomeId: z.string(),
          label: z.string(),
          price: z.number().min(0).max(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const performanceMemorySchema = memoryBase
  .extend({
    kind: z.literal("participant_performance"),
    participantId: z.string(),
    displayName: z.string(),
    role: z.enum(["trader", "market_maker"]),
    predictedOutcomeId: z.string(),
    predictedOutcomeLabel: z.string(),
    winningOutcomeId: z.string(),
    winningOutcomeLabel: z.string(),
    correct: z.boolean(),
    confidence: z.number().min(0).max(1),
    conviction: z.number().nonnegative(),
    closingPrice: z.number().min(0).max(1),
    entryPrice: z.number().gt(0).lt(1).optional(),
    entryPriceSource: z
      .enum([
        "trade-vwap",
        "trade-price-before",
        "legacy-complement",
        "neutral",
      ])
      .optional(),
    realizedEdge: z.number().min(-1).max(1).optional(),
    shrinkageSkillScore: z.number().optional(),
    profitRank: z.number().int().positive().optional(),
    trustRank: z.number().int().positive().optional(),
    preCommitSuiDigest: z.string().max(100).optional(),
    episode: z.literal("wallet_backfill").optional(),
    baseline: learningRankSchema.optional(),
  })
  .passthrough();

const scoreSchema = z.object({
  correctCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(100),
  credibilityScore: z.number().min(0).max(100),
  credibleInterval: z.object({
    level: z.number().min(0).max(100),
    lowerBound: z.number().min(0).max(100),
    upperBound: z.number().min(0).max(100),
  }),
  evidenceWeight: z.number().nonnegative(),
});
const oracleForecastSchema = memoryBase
  .extend({
    kind: z.literal("oracle_forecast"),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    episode: z.literal("pre_event_pick").optional(),
    hashVersion: z.literal("sha256-canonical-json-v1").optional(),
    forecastHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    suiCheckpoint: z.string().regex(/^\d+$/u).optional(),
    suiTimestamp: z.string().regex(/^\d+$/u).optional(),
    contentBound: z.literal(true).optional(),
    snapshot: z.object({
      incentiveEconomics: incentiveEconomicsSchema.optional(),
      marketId: z.string().min(1),
      marketUpdatedAt: z.string().datetime(),
      createdAt: z.string().datetime(),
      memoryCalibratedProbabilities: z
        .array(
          z.object({
            outcomeId: z.string(),
            label: z.string(),
            marketProbability: z.number().min(0).max(1),
            oracleProbability: z.number().min(0).max(1),
            edgeDivergence: z.number().min(-1).max(1),
            trustedConviction: z.number().nonnegative(),
          }),
        )
        .min(2)
        .max(12),
      edgeDivergence: z
        .array(
          z.object({ outcomeId: z.string(), delta: z.number().min(-1).max(1) }),
        )
        .max(12),
      trustedBackers: z
        .array(
          scoreSchema.extend({
            participantId: z.string(),
            displayName: z.string(),
            averageConfidence: z.number(),
            totalConviction: z.number().nonnegative(),
            marketTypes: z.array(z.enum(["simple", "opportunity"])),
            byMarketType: z.object({
              simple: scoreSchema.nullable(),
              opportunity: scoreSchema.nullable(),
            }),
            lastActiveAt: z.string().datetime(),
            meanRealizedEdge: z.number().min(-1).max(1),
            shrinkageSkillScore: z.number(),
            skillScore: z.number().min(0).max(100),
            classification: z
              .enum([
                "calibrated_sharp",
                "lucky_whale",
                "emerging",
                "overconfident",
              ])
              .optional(),
            rawPnl: z.number(),
            profitRank: z.number().int().positive(),
            trustRank: z.number().int().positive(),
            rankDelta: z.number().int(),
            inferredEntryCount: z.number().int().nonnegative(),
          }),
        )
        .max(500),
      walrusEvidenceBlobs: z
        .array(
          z.object({
            blobId: z.string().min(1),
            recordId: z.string().min(1),
            provider: z.enum(["demo", "walrus"]),
          }),
        )
        .max(500),
    }),
    checkpointObservation: z.object({
      provider: z.enum(["demo", "tatum"]),
      network: z.literal("sui:mainnet"),
      checkpoint: z.string().regex(/^\d+$/u),
      timestamp: z.string().datetime(),
      timestampMs: z.string().regex(/^\d+$/u).optional(),
      identifier: z.string(),
      identifierVerified: z.boolean(),
      verification: z.enum([
        "checkpoint-observation",
        "transaction-inclusion",
        "object-observation",
      ]),
      contentBound: z.literal(false),
      epoch: z.string().regex(/^\d+$/u).optional(),
      verifiedAt: z.string().datetime().optional(),
      rpcEndpoint: z.string().optional(),
    }),
  })
  .superRefine((record, context) => {
    if (
      record.hashVersion === undefined &&
      record.forecastHash === undefined &&
      record.contentBound === undefined &&
      record.episode === undefined &&
      record.suiCheckpoint === undefined &&
      record.suiTimestamp === undefined
    )
      return;
    if (
      record.hashVersion !== FORECAST_HASH_VERSION ||
      !hasForecastBinding(
        record as OracleForecastMemory,
        createHash("sha256")
          .update(
            canonicalJson(
              forecastPayload(record.snapshot, record.checkpointObservation),
            ),
          )
          .digest("hex"),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Forecast content binding is incomplete or invalid.",
      });
    }
  })
  .passthrough();

export const truth402MemorySchema = z.discriminatedUnion("kind", [
  resolutionMemorySchema,
  signalMemorySchema,
  performanceMemorySchema,
  oracleForecastSchema,
]);

function groupTrades(trades: Trade[]): Map<string, Trade[]> {
  const grouped = new Map<string, Trade[]>();
  for (const trade of trades) {
    const current = grouped.get(trade.participantId) ?? [];
    current.push(trade);
    grouped.set(trade.participantId, current);
  }
  return grouped;
}

export function deriveEntryEvidence(
  trades: Trade[],
  outcomeId: string,
  correct: boolean,
  closingPrice: number,
): Pick<
  ParticipantPerformanceMemory,
  "entryPrice" | "entryPriceSource" | "realizedEdge"
> {
  const backed = trades.filter(
    (trade) =>
      trade.outcomeId === outcomeId &&
      Number.isFinite(trade.amount) &&
      trade.amount > 0,
  );
  const amount = backed.reduce((sum, trade) => sum + trade.amount, 0);
  const shares = backed.reduce((sum, trade) => sum + trade.shares, 0);
  const vwap = amount / shares;
  let entryPrice: number;
  let entryPriceSource: ParticipantPerformanceMemory["entryPriceSource"];
  if (
    backed.length &&
    backed.every(
      (trade) => Number.isFinite(trade.shares) && trade.shares > 0,
    ) &&
    vwap > 0 &&
    vwap < 1
  ) {
    entryPrice = vwap;
    entryPriceSource = "trade-vwap";
  } else if (
    backed.length &&
    backed.every((trade) => trade.priceBefore > 0 && trade.priceBefore < 1)
  ) {
    entryPrice =
      backed.reduce((sum, trade) => sum + trade.amount * trade.priceBefore, 0) /
      amount;
    entryPriceSource = "trade-price-before";
  } else if (closingPrice > 0 && closingPrice < 1) {
    // A compatibility estimate only, not observed entry evidence.
    entryPrice = 1 - closingPrice;
    entryPriceSource = "legacy-complement";
  } else {
    entryPrice = 0.5;
    entryPriceSource = "neutral";
  }
  return {
    entryPrice,
    entryPriceSource,
    realizedEdge: Number(correct) - entryPrice,
  };
}

/** Enrich scoring copies only. Never rewrite historical provider payloads. */
export function enrichPerformanceRecords(
  records: TRUTH402MemoryRecord[],
  markets: Market[],
): TRUTH402MemoryRecord[] {
  const byId = new Map(markets.map((market) => [market.id, market]));
  return records.map((record) => {
    if (
      record.kind !== "participant_performance" ||
      record.entryPrice !== undefined
    )
      return record;
    const trades =
      byId
        .get(record.marketId)
        ?.trades.filter(
          (trade) => trade.participantId === record.participantId,
        ) ?? [];
    return {
      ...record,
      ...deriveEntryEvidence(
        trades,
        record.predictedOutcomeId,
        record.correct,
        record.closingPrice,
      ),
    };
  });
}

function strongestConviction(
  trades: Trade[],
  outcomes: Market["outcomes"],
): { outcomeId: string; conviction: number } | null {
  const aggregates = new Map<
    string,
    { conviction: number; earliestAt: string; outcomeOrder: number }
  >();
  const outcomeOrder = new Map(
    outcomes.map((outcome, index) => [outcome.id, index]),
  );

  for (const trade of trades) {
    const current = aggregates.get(trade.outcomeId);
    aggregates.set(trade.outcomeId, {
      conviction: (current?.conviction ?? 0) + trade.amount,
      earliestAt:
        !current || trade.createdAt < current.earliestAt
          ? trade.createdAt
          : current.earliestAt,
      outcomeOrder:
        outcomeOrder.get(trade.outcomeId) ?? Number.MAX_SAFE_INTEGER,
    });
  }

  const selected = [...aggregates.entries()].sort(
    ([outcomeA, a], [outcomeB, b]) =>
      b.conviction - a.conviction ||
      a.earliestAt.localeCompare(b.earliestAt) ||
      a.outcomeOrder - b.outcomeOrder ||
      outcomeA.localeCompare(outcomeB),
  )[0];
  return selected
    ? { outcomeId: selected[0], conviction: selected[1].conviction }
    : null;
}

export function buildResolutionMemories(
  market: Market,
): TRUTH402MemoryRecord[] {
  if (
    market.status !== "resolved" ||
    !market.winningOutcomeId ||
    !market.resolvedAt
  ) {
    throw new Error("Resolution memories require a resolved market.");
  }

  const winner = market.outcomes.find(
    (outcome) => outcome.id === market.winningOutcomeId,
  );
  if (!winner) throw new Error("The winning outcome is missing.");

  const participants = groupTrades(market.trades);
  // Array iteration preserves market outcome order, which is also the documented
  // representative-leader tie-break. It does not make a tie "followed".
  const { leader, tiedLeaders } = closingSignal(market.outcomes);
  const sponsorFollowedSignal = sponsorFollowedStrictHighest(
    market.outcomes,
    winner.id,
  );
  const base = {
    schema: MEMORY_SCHEMA_NAME,
    version: MEMORY_SCHEMA_VERSION,
    marketId: market.id,
    marketType: market.type,
    marketTitle: market.title,
    occurredAt: market.resolvedAt,
    ...(market.tags.includes("synthetic-demo")
      ? {
          provenance: "synthetic-demo" as const,
          category: market.tags.includes("sports")
            ? ("SPORTS" as const)
            : market.tags.includes("crypto")
              ? ("CRYPTO" as const)
              : market.tags.includes("politics")
                ? ("POLITICS" as const)
                : ("MACRO" as const),
        }
      : {}),
  };

  const resolution: TRUTH402MemoryRecord = {
    ...base,
    recordId: createMemoryRecordId({
      version: MEMORY_SCHEMA_VERSION,
      kind: "market_resolution",
      marketId: market.id,
      subjectId: winner.id,
    }),
    kind: "market_resolution",
    sponsor: market.sponsor,
    winningOutcomeId: winner.id,
    winningOutcomeLabel: winner.label,
    resolutionNote: market.resolutionNote,
    participantCount: participants.size,
    totalVolume: round(market.totalVolume, 2),
    ...(market.learningUpdate ? { learningUpdate: market.learningUpdate } : {}),
    summary: `${market.sponsor} selected “${winner.label}” after ${participants.size} participants committed ${round(market.totalVolume, 2)} conviction credits.`,
  };

  const signal: MarketSignalMemory = {
    ...base,
    recordId: createMemoryRecordId({
      version: MEMORY_SCHEMA_VERSION,
      kind: "market_signal",
      marketId: market.id,
      subjectId: leader.id,
    }),
    kind: "market_signal",
    signalLeaderOutcomeId: leader.id,
    signalLeaderLabel: leader.label,
    signalLeaderPrice: round(leader.price),
    winningOutcomeId: winner.id,
    sponsorFollowedSignal,
    closingPrices: market.outcomes.map((outcome) => ({
      outcomeId: outcome.id,
      label: outcome.label,
      price: round(outcome.price),
    })),
    summary:
      tiedLeaders.length > 1
        ? `The closing signal tied at ${round(leader.price * 100, 1)}% across ${tiedLeaders.length} outcomes; “${leader.label}” is the outcome-order representative, and the sponsor did not follow a strictly highest signal.`
        : `The closing signal favored “${leader.label}” at ${round(leader.price * 100, 1)}%; the sponsor ${sponsorFollowedSignal ? "followed" : "did not follow"} that strictly highest signal.`,
  };

  const performance: ParticipantPerformanceMemory[] = [];
  for (const [participantId, trades] of participants) {
    const strongest = strongestConviction(trades, market.outcomes);
    if (!strongest) continue;
    const { outcomeId: predictedOutcomeId, conviction: predictedConviction } =
      strongest;
    const predicted = market.outcomes.find(
      (outcome) => outcome.id === predictedOutcomeId,
    );
    if (!predicted) continue;

    const totalConviction = trades.reduce(
      (sum, trade) => sum + trade.amount,
      0,
    );
    const correct = predicted.id === winner.id;
    const displayName =
      [...trades].sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          a.displayName.localeCompare(b.displayName),
      )[0]?.displayName ?? participantId;
    const role = trades.some((trade) => trade.role === "market_maker")
      ? "market_maker"
      : "trader";

    performance.push({
      ...base,
      recordId: createMemoryRecordId({
        version: MEMORY_SCHEMA_VERSION,
        kind: "participant_performance",
        marketId: market.id,
        subjectId: participantId,
      }),
      kind: "participant_performance",
      participantId,
      displayName,
      role,
      predictedOutcomeId: predicted.id,
      predictedOutcomeLabel: predicted.label,
      winningOutcomeId: winner.id,
      winningOutcomeLabel: winner.label,
      correct,
      confidence: round(predictedConviction / totalConviction),
      conviction: round(totalConviction, 2),
      closingPrice: round(predicted.price),
      summary: `${displayName} backed “${predicted.label}” with ${round(totalConviction, 2)} credits and was ${correct ? "correct" : "incorrect"}.`,
      ...deriveEntryEvidence(trades, predicted.id, correct, predicted.price),
    });
  }

  return [resolution, signal, ...performance];
}

export function serializeMemory(record: TRUTH402MemoryRecord): string {
  assertCanonicalMemoryRecordId(record);
  const label = record.kind
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

  return [
    `Verdicto Memory v${record.version} ${MEMORY_HEADER_SEPARATOR} ${label}`,
    `Market: ${record.marketTitle} [${record.marketId}]`,
    record.summary,
    `${DATA_MARKER}${JSON.stringify(record)}`,
  ].join("\n");
}

export function parseMemory(text: string): TRUTH402MemoryRecord | null {
  const framedMarker = `\n${DATA_MARKER}`;
  const markerIndex = text.lastIndexOf(framedMarker);
  const payloadStart =
    markerIndex >= 0
      ? markerIndex + framedMarker.length
      : text.startsWith(DATA_MARKER)
        ? DATA_MARKER.length
        : -1;
  if (payloadStart === -1) return null;

  try {
    const payload = text.slice(payloadStart).trim();
    return truth402MemorySchema.parse(
      JSON.parse(payload),
    ) as TRUTH402MemoryRecord;
  } catch {
    return null;
  }
}
