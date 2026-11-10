import type { OracleForecastMemory } from "@/types/domain";
import type {
  CanonicalForecastPayload,
  OracleSnapshot,
  PreCommitmentProof,
  SuiVerificationStamp,
} from "@/types/oracle";

export const FORECAST_HASH_VERSION = "sha256-canonical-json-v1" as const;

/** UTF-8 JSON, sorted object keys, finite numbers, no whitespace. No locale dependence. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    const entries = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => compareIds(a, b));
    return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(",")}}`;
  }
  throw new Error("Forecast commitments require finite, plain JSON values.");
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function forecastPayload(
  snapshot: OracleSnapshot,
  checkpoint: SuiVerificationStamp,
): CanonicalForecastPayload {
  const evidenceBlobs = [...snapshot.walrusEvidenceBlobs].sort(
    (a, b) =>
      compareIds(a.recordId, b.recordId) || compareIds(a.blobId, b.blobId),
  );
  return {
    schema: "truth402.forecast",
    version: 1,
    marketId: snapshot.marketId,
    marketUpdatedAt: snapshot.marketUpdatedAt,
    capturedAt: snapshot.createdAt,
    suiCheckpoint: checkpoint.checkpoint,
    suiTimestamp:
      checkpoint.timestampMs ?? String(Date.parse(checkpoint.timestamp)),
    probabilities: [...snapshot.memoryCalibratedProbabilities].sort((a, b) =>
      compareIds(a.outcomeId, b.outcomeId),
    ),
    trustedBackers: [...snapshot.trustedBackers].sort((a, b) =>
      compareIds(a.participantId, b.participantId),
    ),
    evidenceRecordIds: evidenceBlobs.map((entry) => entry.recordId),
    evidenceBlobs,
    ...(snapshot.incentiveEconomics
      ? { incentiveEconomics: snapshot.incentiveEconomics }
      : {}),
  };
}

/** Validate the duplicated receipt fields as well as the canonical content hash. */
export function hasForecastBinding(
  record: OracleForecastMemory,
  computedHash: string,
): boolean {
  return (
    record.episode === "pre_event_pick" &&
    record.hashVersion === FORECAST_HASH_VERSION &&
    record.contentBound === true &&
    record.forecastHash === computedHash &&
    record.contentHash === computedHash &&
    record.marketId === record.snapshot.marketId &&
    record.occurredAt === record.snapshot.createdAt &&
    record.suiCheckpoint === record.checkpointObservation.checkpoint &&
    record.suiTimestamp === record.checkpointObservation.timestampMs &&
    typeof record.suiTimestamp === "string" &&
    /^\d+$/u.test(record.suiTimestamp) &&
    Number(record.suiTimestamp) ===
      Date.parse(record.checkpointObservation.timestamp)
  );
}

async function browserSha256(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Uses Web Crypto in the browser; it does not claim independent Walrus/Sui inclusion verification. */
export async function verifyForecastHash(
  record: OracleForecastMemory,
  proof: PreCommitmentProof,
  displayedSnapshot: OracleSnapshot = record.snapshot,
): Promise<{
  matches: boolean;
  computedHash: string;
  expectedHash: string;
  canonicalPayload: string;
}> {
  const canonicalPayload = canonicalJson(
    forecastPayload(
      // Legacy hashes predate economics. A new report may append accounting,
      // but cannot retroactively bind it to the legacy forecast.
      record.snapshot.incentiveEconomics
        ? displayedSnapshot
        : { ...displayedSnapshot, incentiveEconomics: undefined },
      record.checkpointObservation,
    ),
  );
  const computedHash = await browserSha256(canonicalPayload);
  const expectedRecordId = await browserSha256(
    JSON.stringify([
      record.kind,
      record.marketId,
      record.contentHash,
      record.version,
    ]),
  );
  return {
    matches:
      hasForecastBinding(record, computedHash) &&
      canonicalPayload ===
        canonicalJson(
          forecastPayload(record.snapshot, record.checkpointObservation),
        ) &&
      proof.contentBound &&
      proof.bindingScope === "memory-record" &&
      proof.hashVersion === FORECAST_HASH_VERSION &&
      proof.forecastHash === computedHash &&
      proof.contentHash === computedHash &&
      proof.recordId === expectedRecordId &&
      record.recordId === expectedRecordId &&
      proof.capturedAt === record.snapshot.createdAt &&
      proof.sui.checkpoint === record.suiCheckpoint &&
      proof.sui.timestampMs === record.suiTimestamp,
    computedHash,
    expectedHash: record.forecastHash ?? record.contentHash,
    canonicalPayload,
  };
}
