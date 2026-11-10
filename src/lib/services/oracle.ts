import "server-only";

import { createHash } from "node:crypto";

import { getPublicRuntimeConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import {
  canonicalJson,
  forecastPayload,
  FORECAST_HASH_VERSION,
  hasForecastBinding,
} from "@/lib/forecast-integrity";
import { computeIncentiveEconomics } from "@/lib/oracle-economics";
import { parseMemory } from "@/lib/memory/codec";
import {
  computeMemoryCalibratedSignal,
  participantTrustWeight,
} from "@/lib/memory/credibility";
import { getMemoryProvider } from "@/lib/memory/provider";
import {
  createMemoryRecordId,
  expectedMemoryRecordId,
} from "@/lib/memory/record-id";
import { removeEmDashes } from "@/lib/sanitize";
import { publicProviderError } from "@/lib/server-secrets";
import {
  getInsightsSnapshot,
  invalidateInsightsCache,
} from "@/lib/services/insights";
import { getMarket } from "@/lib/services/markets";
import {
  findOracleCommitment,
  finishOracleCommitment,
  reserveOracleCommitment,
  assertOracleStorageSafety,
} from "@/lib/store";
import { verifyPreCommitmentOnSui } from "@/lib/tatum";
import type {
  InsightsSnapshot,
  Market,
  OracleForecastMemory,
} from "@/types/domain";
import type {
  OracleCommitment,
  OracleIncentiveEconomics,
  OracleInvoice,
  OracleSnapshot,
  PreCommitmentProof,
} from "@/types/oracle";

const COMMIT_FLIGHTS = Symbol.for("verdicto.oracle-commit-flights");
const globalFlights = globalThis as typeof globalThis & {
  [COMMIT_FLIGHTS]?: Map<string, Promise<OracleCommitment>>;
};
const flights =
  globalFlights[COMMIT_FLIGHTS] ?? (globalFlights[COMMIT_FLIGHTS] = new Map());

function modeKey(): string {
  const modes = getPublicRuntimeConfig();
  return `${modes.memoryMode}:${modes.tatumMode}:${modes.memoryNamespace}`;
}

export { computeIncentiveEconomics } from "@/lib/oracle-economics";

export function buildOracleSnapshot(
  market: Market,
  insights: InsightsSnapshot,
): OracleSnapshot {
  const backers = new Set(market.trades.map((trade) => trade.participantId));
  const recalledIds = new Set(
    insights.memories.flatMap((memory) => {
      const record = parseMemory(memory.text);
      return record?.kind === "participant_performance"
        ? [record.recordId]
        : [];
    }),
  );
  const evidenceComplete = (participantId: string) =>
    insights.records
      .filter(
        (record) =>
          record.kind === "participant_performance" &&
          record.participantId === participantId,
      )
      .every((record) => recalledIds.has(record.recordId));
  const trustedBackers = insights.leaderboard
    .filter(
      (entry) =>
        backers.has(entry.participantId) &&
        participantTrustWeight(entry) > 0 &&
        evidenceComplete(entry.participantId),
    )
    .sort((a, b) => a.trustRank - b.trustRank)
    .map((entry) => ({
      ...entry,
      displayName: removeEmDashes(entry.displayName),
    }));
  const trustedIds = new Set(
    trustedBackers.map((entry) => entry.participantId),
  );
  const seen = new Set<string>();
  const walrusEvidenceBlobs = insights.memories
    .flatMap((memory) => {
      const record = parseMemory(memory.text);
      if (
        !record ||
        record.kind !== "participant_performance" ||
        !trustedIds.has(record.participantId) ||
        seen.has(record.recordId)
      )
        return [];
      seen.add(record.recordId);
      return [
        {
          blobId: memory.blobId,
          recordId: record.recordId,
          provider: memory.provider,
        },
      ];
    })
    .sort((a, b) => a.recordId.localeCompare(b.recordId));
  const memoryCalibratedProbabilities = computeMemoryCalibratedSignal(
    market,
    trustedBackers,
  );
  return {
    marketId: market.id,
    marketUpdatedAt: market.updatedAt,
    createdAt: new Date().toISOString(),
    memoryCalibratedProbabilities,
    edgeDivergence: memoryCalibratedProbabilities.map((row) => ({
      outcomeId: row.outcomeId,
      delta: row.edgeDivergence,
    })),
    trustedBackers,
    walrusEvidenceBlobs,
    incentiveEconomics: computeIncentiveEconomics(
      market,
      memoryCalibratedProbabilities,
      trustedBackers,
      insights.records,
      walrusEvidenceBlobs,
    ),
  };
}

function proofFor(
  commitment: OracleCommitment | null,
  market: Market,
): PreCommitmentProof | null {
  const receipt = commitment?.receipt;
  if (
    !commitment ||
    receipt?.status !== "confirmed" ||
    !receipt.blobId ||
    !receipt.confirmedAt
  )
    return null;
  const record = commitment.record;
  const contentBound =
    record.hashVersion === FORECAST_HASH_VERSION &&
    record.recordId === expectedMemoryRecordId(record) &&
    receipt.recordId === record.recordId &&
    hasForecastBinding(
      record,
      createHash("sha256")
        .update(
          canonicalJson(
            forecastPayload(record.snapshot, record.checkpointObservation),
          ),
        )
        .digest("hex"),
    );
  if (record.hashVersion === FORECAST_HASH_VERSION && !contentBound)
    throw new AppError(
      "FORECAST_INTEGRITY_FAILED",
      "The frozen forecast does not match its content commitment.",
      500,
    );
  return {
    contentHash: record.contentHash,
    ...(contentBound
      ? { forecastHash: record.forecastHash, hashVersion: record.hashVersion }
      : {}),
    contentBound,
    bindingScope: contentBound ? "memory-record" : "legacy-snapshot",
    recordId: commitment.record.recordId,
    blobId: receipt.blobId,
    provider: receipt.provider,
    capturedAt: commitment.record.snapshot.createdAt,
    publishedAt: receipt.confirmedAt,
    capturedWhileOpen: true,
    publicationBeforeResolution: market.resolvedAt
      ? Date.parse(receipt.confirmedAt) < Date.parse(market.resolvedAt)
      : null,
    sui: commitment.record.checkpointObservation,
    assurance: contentBound
      ? "SHA-256 binds the forecast and captured checkpoint metadata in the published memory record. Sui checkpoint observation is not an on-chain forecast attestation. Demo receipts are local; resolution timing is server asserted."
      : "Legacy frozen snapshot. Checkpoint metadata is an RPC observation, not an on-chain forecast attestation.",
  };
}

export async function getOracleSignal(marketId: string): Promise<{
  snapshot: OracleSnapshot;
  incentiveEconomics: OracleIncentiveEconomics;
  preCommitmentProof: PreCommitmentProof | null;
  signalSource: "current-estimate" | "committed-snapshot";
  forecastRecord: OracleForecastMemory | null;
  preview: OracleInvoice["preview"];
}> {
  const [market, insights, commitment] = await Promise.all([
    getMarket(marketId),
    getInsightsSnapshot(undefined, 100),
    findOracleCommitment(marketId, modeKey()),
  ]);
  if (!commitment && market.status !== "open")
    throw new AppError(
      "ORACLE_MARKET_CLOSED",
      "Resolved markets without an official pre-event snapshot have no oracle signal.",
      409,
    );
  const snapshot =
    commitment?.record.snapshot ?? buildOracleSnapshot(market, insights);
  const incentiveEconomics =
    snapshot.incentiveEconomics ??
    computeIncentiveEconomics(
      // Old commitments lack frozen convictions. Do not invent backer entitlements
      // from trades made after the snapshot: retain the legacy pool unallocated.
      commitment ? { trades: [] } : market,
      snapshot.memoryCalibratedProbabilities,
      snapshot.trustedBackers,
      insights.records,
      snapshot.walrusEvidenceBlobs,
    );
  const preCommitmentProof = proofFor(commitment, market);
  return {
    snapshot,
    incentiveEconomics,
    preCommitmentProof,
    signalSource: commitment ? "committed-snapshot" : "current-estimate",
    forecastRecord: preCommitmentProof ? commitment!.record : null,
    preview: {
      participantCount: new Set(
        market.trades.map((trade) => trade.participantId),
      ).size,
      trackedBackers: snapshot.trustedBackers.length,
      memoryCount: insights.metrics.parsedMemoryCount,
      preCommitCheckpoint: preCommitmentProof?.sui.checkpoint ?? null,
      marketPrice: snapshot.memoryCalibratedProbabilities[0]?.marketProbability,
      preCommittedBlobId: preCommitmentProof?.blobId ?? null,
      klDivergenceBits: incentiveEconomics.klDivergenceBits,
      klDivergencePreview: incentiveEconomics.klDivergenceBits,
      klDivergenceInfinite: incentiveEconomics.klDivergenceInfinite,
      estimatedAgentEvBps: incentiveEconomics.estimatedAgentEvBps,
      estimatedEdgeBps: incentiveEconomics.estimatedEdgeBps,
      topProfitVsTrustDivergencePreview: [...insights.leaderboard]
        .sort(
          (a, b) =>
            Math.abs(b.rankDelta) - Math.abs(a.rankDelta) ||
            a.trustRank - b.trustRank,
        )
        .slice(0, 2)
        .map((entry) => ({
          displayName: removeEmDashes(entry.displayName),
          profitRank: entry.profitRank,
          trustRank: entry.trustRank,
          rankDelta: entry.rankDelta,
        })),
    },
  };
}

async function publishCommit(
  marketId: string,
  identifier: string | undefined,
  key: string,
): Promise<OracleCommitment> {
  let commitment = await findOracleCommitment(marketId, key);
  if (commitment?.receipt?.status === "confirmed") return commitment;
  const market = await getMarket(marketId);
  if (!commitment && market.status !== "open")
    throw new AppError(
      "ORACLE_MARKET_CLOSED",
      "A new forecast cannot be committed after market resolution.",
      409,
    );
  if (!commitment) {
    // Capture checkpoint metadata before building and hashing the forecast.
    // Atomic reservation below rechecks the market is still open and unchanged.
    const checkpointObservation = await verifyPreCommitmentOnSui(
      identifier ?? "",
    );
    const insights = await getInsightsSnapshot(undefined, 100);
    const snapshot = buildOracleSnapshot(market, insights);
    const contentHash = createHash("sha256")
      .update(canonicalJson(forecastPayload(snapshot, checkpointObservation)))
      .digest("hex");
    const record: OracleForecastMemory = {
      schema: "verdicto.memory",
      version: 2,
      kind: "oracle_forecast",
      recordId: createMemoryRecordId({
        version: 2,
        kind: "oracle_forecast",
        marketId,
        subjectId: contentHash,
      }),
      marketId,
      marketType: market.type,
      marketTitle: removeEmDashes(market.title),
      occurredAt: snapshot.createdAt,
      summary:
        "TRUTH-402 pre-event pick. SHA-256 content-bound forecast with captured Sui checkpoint metadata.",
      contentHash,
      forecastHash: contentHash,
      hashVersion: FORECAST_HASH_VERSION,
      episode: "pre_event_pick",
      suiCheckpoint: checkpointObservation.checkpoint,
      suiTimestamp: checkpointObservation.timestampMs!,
      contentBound: true,
      snapshot,
      checkpointObservation,
    };
    commitment = await reserveOracleCommitment({ modeKey: key, record });
  }
  const provider = getMemoryProvider();
  try {
    const receipt = await provider.remember(commitment.record);
    commitment = await finishOracleCommitment({ ...commitment, receipt });
    if (receipt.status !== "confirmed" || !receipt.blobId)
      throw new AppError(
        "ORACLE_COMMIT_PENDING",
        "Forecast is frozen but memory publication is not confirmed. Retry publication of the same snapshot.",
        503,
      );
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = publicProviderError(error, "Forecast publication failed.");
    await finishOracleCommitment({
      ...commitment,
      receipt: {
        recordId: commitment.record.recordId,
        kind: "oracle_forecast",
        provider: provider.mode === "live" ? "walrus" : "demo",
        status: "failed",
        error: message,
      },
    });
    throw new AppError("ORACLE_COMMIT_FAILED", message, 503);
  }
  invalidateInsightsCache();
  return commitment;
}

export async function commitOracleForecast(
  marketId: string,
  identifier?: string,
): Promise<{
  preCommitmentProof: PreCommitmentProof;
  snapshot: OracleSnapshot;
}> {
  const modes = getPublicRuntimeConfig();
  assertOracleStorageSafety(
    modes.memoryMode === "live" || modes.tatumMode === "live" ? "live" : "demo",
  );
  const key = modeKey();
  const flightKey = `${key}:${marketId}`;
  let pending = flights.get(flightKey);
  if (!pending) {
    pending = publishCommit(marketId, identifier, key).finally(() => {
      flights.delete(flightKey);
    });
    flights.set(flightKey, pending);
  }
  const commitment = await pending;
  const proof = proofFor(commitment, await getMarket(marketId));
  if (!proof)
    throw new AppError(
      "ORACLE_COMMIT_PENDING",
      "Forecast publication is not confirmed.",
      503,
    );
  return { preCommitmentProof: proof, snapshot: commitment.record.snapshot };
}
