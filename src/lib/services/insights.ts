import "server-only";

import { getPublicRuntimeConfig } from "@/lib/config";
import { enrichPerformanceRecords, parseMemory } from "@/lib/memory/codec";
import {
  deriveCalibration,
  deriveCredibility,
  deriveLearningMetrics,
  RECENCY_HALF_LIFE_DAYS,
  recencyAnchorAt,
  uniqueRecords,
} from "@/lib/memory/credibility";
import { getMemoryProvider } from "@/lib/memory/provider";
import { removeEmDashes } from "@/lib/sanitize";
import { listMarkets } from "@/lib/store";
import type {
  Credibility,
  LearningMetrics,
  RecalledMemory,
  TRUTH402MemoryRecord,
  InsightsSnapshot,
} from "@/types/domain";

export const DEFAULT_MEMORY_QUERY =
  "TRUTH402 market resolution participant performance credibility decision signal";

const CREDIBILITY_CACHE_TTL_MS = 15_000;
const MAX_CORPUS_RECORDS = 500;
const CACHE_SYMBOL = Symbol.for("truth402.insights-cache");

interface DerivedCorpus {
  key: string;
  expiresAt: number;
  memories: RecalledMemory[];
  records: TRUTH402MemoryRecord[];
  leaderboard: Credibility[];
  calibration: InsightsSnapshot["calibration"];
  recencyWeighted: InsightsSnapshot["recencyWeighted"];
  metrics: LearningMetrics;
}

interface InsightsCacheState {
  corpus?: DerivedCorpus;
  inFlight?: Promise<DerivedCorpus>;
  inFlightGeneration?: number;
  inFlightKey?: string;
  generation: number;
}

const globalCache = globalThis as typeof globalThis & {
  [CACHE_SYMBOL]?: InsightsCacheState;
};

const cache =
  globalCache[CACHE_SYMBOL] ?? (globalCache[CACHE_SYMBOL] = { generation: 0 });
cache.generation ??= 0;

function cacheKey(): string {
  const config = getPublicRuntimeConfig();
  return `${config.memoryMode}:${config.memoryNamespace}`;
}

async function loadCorpus(): Promise<DerivedCorpus> {
  const provider = getMemoryProvider();
  const key = cacheKey();
  // Forecasts are paid snapshots, not new resolved evidence. Do not expose them
  // via the public learning explorer or feed the oracle its own predictions.
  const memories = (await provider.listMemories(MAX_CORPUS_RECORDS)).filter(
    (memory) => parseMemory(memory.text)?.kind !== "oracle_forecast",
  );
  const records = uniqueRecords(memories);
  const scoringRecords = enrichPerformanceRecords(records, await listMarkets());
  const recencyOptions = {
    weighting: "recency" as const,
    halfLifeDays: RECENCY_HALF_LIFE_DAYS,
  };
  return {
    key,
    expiresAt: Date.now() + CREDIBILITY_CACHE_TTL_MS,
    memories,
    records,
    leaderboard: deriveCredibility(scoringRecords),
    calibration: deriveCalibration(records),
    recencyWeighted: {
      leaderboard: deriveCredibility(scoringRecords, recencyOptions),
      calibration: deriveCalibration(records, recencyOptions),
      halfLifeDays: RECENCY_HALF_LIFE_DAYS,
      anchorAt: recencyAnchorAt(records),
    },
    metrics: deriveLearningMetrics(memories, records),
  };
}

async function getCorpus(): Promise<DerivedCorpus> {
  const key = cacheKey();
  if (cache.corpus?.key === key && cache.corpus.expiresAt > Date.now()) {
    return cache.corpus;
  }

  if (
    !cache.inFlight ||
    cache.inFlightGeneration !== cache.generation ||
    cache.inFlightKey !== key
  ) {
    const generation = cache.generation;
    const promise = loadCorpus()
      .then((corpus) => {
        if (cache.generation === generation) cache.corpus = corpus;
        return corpus;
      })
      .finally(() => {
        if (cache.inFlight === promise) {
          cache.inFlight = undefined;
          cache.inFlightGeneration = undefined;
          cache.inFlightKey = undefined;
        }
      });
    cache.inFlight = promise;
    cache.inFlightGeneration = generation;
    cache.inFlightKey = key;
  }
  const inFlight = cache.inFlight;
  if (!inFlight) {
    throw new Error("Insights corpus cache failed to start.");
  }
  return inFlight;
}

/** Invalidate after a resolution so the next request sees new memories. */
export function invalidateInsightsCache(): void {
  cache.generation += 1;
  cache.corpus = undefined;
  // Detach (but do not attempt to cancel) an old read. Its callers may finish;
  // the next caller starts a fresh generation and the old result cannot cache.
  cache.inFlight = undefined;
  cache.inFlightGeneration = undefined;
  cache.inFlightKey = undefined;
}

export async function getInsightsSnapshot(
  query = DEFAULT_MEMORY_QUERY,
  limit = 100,
): Promise<InsightsSnapshot> {
  const corpus = await getCorpus();
  const provider = getMemoryProvider();
  const memories =
    query === DEFAULT_MEMORY_QUERY
      ? corpus.memories.slice(0, limit)
      : (await provider.recall(query, limit)).filter(
          (memory) => parseMemory(memory.text)?.kind !== "oracle_forecast",
        );
  const records =
    query === DEFAULT_MEMORY_QUERY ? corpus.records : uniqueRecords(memories);

  return {
    // Browser/API copies normalize typography only. Provider storage and the
    // parsed records used for IDs and scoring remain unchanged.
    memories: memories.map((memory) => ({
      ...memory,
      text: removeEmDashes(memory.text),
    })),
    // All score, calibration, and metric views use the locally parsed corpus,
    // not repeated participant-by-participant semantic recalls. Parse and
    // derivation cost is O(R) per cache fill, then O(1) until TTL expiry or
    // explicit invalidation.
    records,
    leaderboard: corpus.leaderboard,
    calibration: corpus.calibration,
    recencyWeighted: corpus.recencyWeighted,
    metrics: corpus.metrics,
    provider: provider.mode === "live" ? "walrus" : "demo",
    generatedAt: new Date().toISOString(),
  };
}
