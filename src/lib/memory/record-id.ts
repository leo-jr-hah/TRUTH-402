import { createHash } from "node:crypto";

import type { VerdictoMemoryKind, VerdictoMemoryRecord } from "@/types/domain";

export const MEMORY_SCHEMA_NAME = "verdicto.memory" as const;
export const MEMORY_SCHEMA_VERSION = 1 as const;

/**
 * A record's subject is the entity that makes this kind unique within a market:
 * the selected outcome for a resolution, the representative price leader for a
 * signal, or the participant for a performance observation.
 */
export function memoryRecordSubject(record: VerdictoMemoryRecord): string {
  switch (record.kind) {
    case "market_resolution":
      return record.winningOutcomeId;
    case "market_signal":
      return record.signalLeaderOutcomeId;
    case "participant_performance":
      return record.participantId;
    case "oracle_forecast":
      return record.contentHash;
  }
}

/**
 * Canonical recordId algorithm.
 *
 * 1. JSON-encode this exact array, in this exact order:
 *    [kind, marketId, subjectId, schemaVersion]
 * 2. UTF-8 encode the JSON string.
 * 3. Return the lowercase SHA-256 hex digest (64 characters, no prefix).
 *
 * JSON array encoding avoids delimiter ambiguity. Callers must pass IDs exactly
 * as stored; this function performs no trimming or case normalization.
 */
export function createMemoryRecordId(input: {
  version: number;
  kind: VerdictoMemoryKind;
  marketId: string;
  subjectId: string;
}): string {
  const canonical = JSON.stringify([
    input.kind,
    input.marketId,
    input.subjectId,
    input.version,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function expectedMemoryRecordId(record: VerdictoMemoryRecord): string {
  return createMemoryRecordId({
    version: record.version,
    kind: record.kind,
    marketId: record.marketId,
    subjectId: memoryRecordSubject(record),
  });
}

export function assertCanonicalMemoryRecordId(
  record: VerdictoMemoryRecord,
): void {
  if (record.recordId !== expectedMemoryRecordId(record)) {
    throw new Error(`Memory record ${record.recordId} has a non-canonical ID.`);
  }
}
