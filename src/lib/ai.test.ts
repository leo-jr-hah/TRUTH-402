import { describe, expect, it } from "vitest";

import {
  AI_EVIDENCE_RECORD_LIMIT,
  buildInsightPrompt,
  createInsightCacheKey,
} from "@/lib/ai";
import { deriveCredibility } from "@/lib/memory/credibility";
import type {
  InsightsSnapshot,
  ParticipantPerformanceMemory,
} from "@/types/domain";

function snapshot(): InsightsSnapshot {
  const records: ParticipantPerformanceMemory[] = Array.from(
    { length: 45 },
    (_, index) => ({
      schema: "verdicto.memory",
      version: 1,
      recordId: `record-${String(index).padStart(2, "0")}`,
      kind: "participant_performance",
      marketId: `market-${index}`,
      marketType: "simple",
      marketTitle: `Market ${index}`,
      occurredAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      summary: `Evidence ${index}`,
      participantId: `participant-${index}`,
      displayName: `Participant ${index}`,
      role: "trader",
      predictedOutcomeId: "a",
      predictedOutcomeLabel: "A",
      winningOutcomeId: "a",
      winningOutcomeLabel: "A",
      correct: true,
      confidence: 0.75,
      conviction: 100,
      closingPrice: 0.6,
    }),
  );
  return {
    memories: [],
    records,
    leaderboard: deriveCredibility(records),
    calibration: [],
    recencyWeighted: {
      leaderboard: [],
      calibration: [],
      halfLifeDays: 180,
      anchorAt: null,
    },
    metrics: {
      memoryCount: 45,
      parsedMemoryCount: 45,
      resolvedMarketCount: 45,
      participantObservationCount: 45,
      signalFollowedCount: 0,
      signalObservationCount: 0,
      signalAlignmentRate: null,
    },
    provider: "demo",
    generatedAt: "2026-10-25T00:00:00.000Z",
  };
}

describe("AI evidence bounds and cache identity", () => {
  it("caps evidence at 40 newest deterministic records", () => {
    const prompt = buildInsightPrompt(snapshot());

    expect(prompt.match(/"occurredAt"/gu)).toHaveLength(
      AI_EVIDENCE_RECORD_LIMIT,
    );
    expect(prompt).toContain("Evidence 44");
    expect(prompt).not.toContain('Evidence 0"');
    expect(prompt).toContain(
      '"credibleInterval":{"level":90,"lowerBound":22.4,"upperBound":97.5}',
    );
  });

  it("produces the same key regardless of input record order", () => {
    const original = snapshot();
    const reversed = { ...original, records: [...original.records].reverse() };

    expect(createInsightCacheKey(original, "demo:v2")).toBe(
      createInsightCacheKey(reversed, "demo:v2"),
    );
  });

  it("includes posterior uncertainty in cache identity", () => {
    const original = snapshot();
    const changed = {
      ...original,
      leaderboard: original.leaderboard.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              credibleInterval: {
                ...entry.credibleInterval,
                lowerBound: entry.credibleInterval.lowerBound + 0.1,
              },
            }
          : entry,
      ),
    };

    expect(createInsightCacheKey(original, "demo:v2")).not.toBe(
      createInsightCacheKey(changed, "demo:v2"),
    );
  });
});
