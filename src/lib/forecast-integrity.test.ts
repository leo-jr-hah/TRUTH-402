import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalJson,
  forecastPayload,
  verifyForecastHash,
} from "@/lib/forecast-integrity";
import { parseMemory, serializeMemory } from "@/lib/memory/codec";
import * as memoryProviders from "@/lib/memory/provider";
import { expectedMemoryRecordId } from "@/lib/memory/record-id";
import { publicJson } from "@/lib/sanitize";
import { invalidateInsightsCache } from "@/lib/services/insights";
import { commitOracleForecast, getOracleSignal } from "@/lib/services/oracle";
import {
  finishOracleCommitment,
  readDatabase,
  reserveOracleCommitment,
  resetStoreForTests,
  updateMarket,
} from "@/lib/store";
import * as store from "@/lib/store";
import * as tatum from "@/lib/tatum";

describe("versioned forecast content binding", () => {
  beforeEach(async () => {
    await resetStoreForTests();
    invalidateInsightsCache();
  });
  afterEach(() => vi.restoreAllMocks());

  it("canonicalizes keys without mutating payloads and rejects non-JSON numbers", () => {
    expect(
      canonicalJson({ z: 1, a: { y: 2, x: 3 }, optional: undefined }),
    ).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(canonicalJson({ a: [true, null, "SUI"], b: -0 })).toBe(
      '{"a":[true,null,"SUI"],"b":0}',
    );
    for (const value of [NaN, Infinity, BigInt(1), new Date(), [undefined]])
      expect(() => canonicalJson(value)).toThrow();
  });

  it("round-trips the Walrus payload and verifies public JSON using Web Crypto", async () => {
    const { preCommitmentProof } =
      await commitOracleForecast("mkt-sports-final");
    const { forecastRecord } = await getOracleSignal("mkt-sports-final");
    const record = forecastRecord!;
    expect(parseMemory(serializeMemory(record))).toEqual(record);
    const transported = await publicJson({
      record,
      proof: preCommitmentProof,
    }).json();
    expect(
      await verifyForecastHash(transported.record, transported.proof),
    ).toMatchObject({ matches: true, expectedHash: record.forecastHash });
    const canonical = canonicalJson(
      forecastPayload(record.snapshot, record.checkpointObservation),
    );
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(
      record.forecastHash,
    );
    const reordered = structuredClone(record);
    reordered.snapshot.memoryCalibratedProbabilities.reverse();
    reordered.snapshot.trustedBackers.reverse();
    reordered.snapshot.walrusEvidenceBlobs.reverse();
    expect(
      (await verifyForecastHash(reordered, preCommitmentProof)).matches,
    ).toBe(true);
    expect(
      (await readDatabase()).demoMemories
        .slice(0, 20)
        .map((memory) => memory.blobId),
    ).toHaveLength(20);
  });

  it("detects probability, checkpoint, time, backer, evidence and receipt tampering", async () => {
    const { preCommitmentProof } =
      await commitOracleForecast("mkt-sports-final");
    const { forecastRecord } = await getOracleSignal("mkt-sports-final");
    const record = forecastRecord!;
    const mutations = [
      (copy: typeof record) => {
        copy.snapshot.memoryCalibratedProbabilities[0].oracleProbability += 0.01;
      },
      (copy: typeof record) => {
        copy.snapshot.trustedBackers[0].totalCount += 1;
      },
      (copy: typeof record) => {
        copy.snapshot.walrusEvidenceBlobs[0].blobId += "altered";
      },
      (copy: typeof record) => {
        copy.snapshot.walrusEvidenceBlobs[0].recordId += "altered";
      },
      (copy: typeof record) => {
        copy.snapshot.createdAt = "2026-10-01T00:00:00.000Z";
      },
      (copy: typeof record) => {
        copy.checkpointObservation.checkpoint = "999";
      },
      (copy: typeof record) => {
        copy.suiCheckpoint = "999";
      },
      (copy: typeof record) => {
        copy.suiTimestamp = "invalid";
      },
      (copy: typeof record) => {
        copy.forecastHash = "0".repeat(64);
      },
      (copy: typeof record) => {
        copy.recordId = "0".repeat(64);
      },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(record);
      mutate(copy);
      expect((await verifyForecastHash(copy, preCommitmentProof)).matches).toBe(
        false,
      );
      if (copy.recordId === record.recordId)
        expect(
          parseMemory(`VERDICTO_DATA_V1:${JSON.stringify(copy)}`),
        ).toBeNull();
    }
    expect(
      (
        await verifyForecastHash(record, {
          ...preCommitmentProof,
          forecastHash: "1".repeat(64),
        })
      ).matches,
    ).toBe(false);
    const displayed = structuredClone(record.snapshot);
    displayed.memoryCalibratedProbabilities[0].marketProbability += 0.02;
    expect(
      (await verifyForecastHash(record, preCommitmentProof, displayed)).matches,
    ).toBe(false);
  });

  it("retries the identical reserved record after a publication failure and resolution", async () => {
    const provider = memoryProviders.getMemoryProvider();
    const remember = vi
      .spyOn(provider, "remember")
      .mockImplementationOnce(async (record) => ({
        recordId: record.recordId,
        kind: record.kind,
        provider: "demo",
        status: "pending",
      }));
    vi.spyOn(memoryProviders, "getMemoryProvider").mockReturnValue(provider);
    await expect(
      commitOracleForecast("mkt-sports-final"),
    ).rejects.toMatchObject({ code: "ORACLE_COMMIT_PENDING" });
    const frozen = (await readDatabase()).oracleCommitments![0].record;
    await updateMarket("mkt-sports-final", (market) => ({
      ...market,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    }));
    const published = await commitOracleForecast("mkt-sports-final");
    expect(remember).toHaveBeenCalledTimes(2);
    expect(remember.mock.calls[0][0]).toEqual(remember.mock.calls[1][0]);
    expect(published.snapshot).toEqual(frozen.snapshot);
    expect(published.preCommitmentProof.contentBound).toBe(true);
    expect(published.preCommitmentProof.publicationBeforeResolution).toBe(
      false,
    );
  });

  it("refuses a reservation when a trade arrives during checkpoint capture", async () => {
    const checkpoint = await tatum.verifyPreCommitmentOnSui("");
    vi.spyOn(tatum, "verifyPreCommitmentOnSui").mockImplementationOnce(
      async () => {
        await updateMarket("mkt-sports-final", (market) => ({
          ...market,
          updatedAt: "2026-11-09T12:00:00.000Z",
        }));
        return checkpoint;
      },
    );
    await expect(
      commitOracleForecast("mkt-sports-final"),
    ).rejects.toMatchObject({ code: "COMMIT_MARKET_CHANGED" });
    expect((await readDatabase()).oracleCommitments).toHaveLength(0);
  });

  it("keeps confirmed legacy forecasts frozen rather than silently upgrading their hashes", async () => {
    await commitOracleForecast("mkt-sports-final");
    const original = (await readDatabase()).oracleCommitments![0];
    const { snapshot, checkpointObservation } = original.record;
    const contentHash = createHash("sha256")
      .update(JSON.stringify({ snapshot, checkpointObservation }))
      .digest("hex");
    const legacy = {
      schema: "verdicto.memory" as const,
      version: 1,
      kind: "oracle_forecast" as const,
      recordId: "",
      marketId: original.record.marketId,
      marketType: original.record.marketType,
      marketTitle: original.record.marketTitle,
      occurredAt: snapshot.createdAt,
      summary: "Legacy frozen forecast.",
      contentHash,
      snapshot,
      checkpointObservation,
    };
    legacy.recordId = expectedMemoryRecordId(legacy);
    await resetStoreForTests();
    invalidateInsightsCache();
    const reserved = await reserveOracleCommitment({
      modeKey: original.modeKey,
      record: legacy,
    });
    const receipt = await memoryProviders.getMemoryProvider().remember(legacy);
    await finishOracleCommitment({ ...reserved, receipt });
    expect(
      (await commitOracleForecast("mkt-sports-final")).preCommitmentProof,
    ).toMatchObject({
      contentHash,
      contentBound: false,
      bindingScope: "legacy-snapshot",
    });
    expect((await readDatabase()).oracleCommitments![0].record).toEqual(legacy);
  });

  it("fails closed on corrupt stored forecast content before charging a buyer", async () => {
    await commitOracleForecast("mkt-sports-final");
    const corrupted = structuredClone(
      (await readDatabase()).oracleCommitments![0],
    );
    corrupted.record.snapshot.memoryCalibratedProbabilities[0].oracleProbability += 0.01;
    vi.spyOn(store, "findOracleCommitment").mockResolvedValueOnce(corrupted);
    await expect(getOracleSignal("mkt-sports-final")).rejects.toMatchObject({
      code: "FORECAST_INTEGRITY_FAILED",
    });
    expect((await readDatabase()).oraclePaymentReceipts).toHaveLength(0);
  });
});
