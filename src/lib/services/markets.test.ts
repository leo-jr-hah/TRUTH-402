import { beforeEach, describe, expect, it } from "vitest";

import { buildResolutionMemories } from "@/lib/memory/codec";
import {
  getInsightsSnapshot,
  invalidateInsightsCache,
} from "@/lib/services/insights";
import { commitOracleForecast, getOracleSignal } from "@/lib/services/oracle";
import type { MemoryProvider } from "@/lib/memory/provider";
import { getMarket, resolveMarket } from "@/lib/services/markets";
import { resetStoreForTests } from "@/lib/store";
import type {
  IntegrationCheck,
  MemoryReceipt,
  RecalledMemory,
  VerdictoMemoryRecord,
} from "@/types/domain";

class FlakyDemoProvider implements MemoryProvider {
  readonly mode = "demo" as const;
  readonly attempts = new Map<string, number>();

  async remember(record: VerdictoMemoryRecord): Promise<MemoryReceipt> {
    const attempt = (this.attempts.get(record.recordId) ?? 0) + 1;
    this.attempts.set(record.recordId, attempt);
    if (record.kind !== "market_resolution" && attempt === 1) {
      throw new Error("Injected memory outage");
    }
    return {
      recordId: record.recordId,
      kind: record.kind,
      status: "confirmed",
      provider: "demo",
      blobId: `demo-${record.recordId}`,
      confirmedAt: "2026-10-25T14:00:00.000Z",
    };
  }

  async recall(): Promise<RecalledMemory[]> {
    return [];
  }

  async listMemories(): Promise<RecalledMemory[]> {
    return [];
  }

  async check(): Promise<IntegrationCheck> {
    return {
      name: "Walrus Memory",
      mode: "demo",
      status: "healthy",
      message: "Test provider",
    };
  }
}

describe("market resolution publication", () => {
  beforeEach(async () => {
    await resetStoreForTests();
    invalidateInsightsCache();
  });

  it("commits the sponsor decision before writes and retries only missing record IDs", async () => {
    const provider = new FlakyDemoProvider();
    const open = await getMarket("mkt-climate-grant");
    const input = {
      winningOutcomeId: open.outcomes[1].id,
      resolutionNote: "The selected pilot had the strongest measurable plan.",
    };

    const first = await resolveMarket(open.id, input, {
      memoryProvider: provider,
    });
    const expected = buildResolutionMemories(first);
    const resolutionRecord = expected.find(
      (record) => record.kind === "market_resolution",
    )!;

    expect(first.status).toBe("resolved");
    expect(first.winningOutcomeId).toBe(input.winningOutcomeId);
    expect(first.resolutionNote).toBe(input.resolutionNote);
    expect(first.memoryStatus).toBe("failed");
    expect(first.memoryReceipts).toHaveLength(expected.length);
    expect(
      first.memoryReceipts.filter((receipt) => receipt.status === "confirmed"),
    ).toHaveLength(1);

    const committed = await getMarket(open.id);
    expect(committed.status).toBe("resolved");
    expect(committed.winningOutcomeId).toBe(input.winningOutcomeId);
    expect(committed.resolvedAt).toBe(first.resolvedAt);

    const retried = await resolveMarket(open.id, input, {
      memoryProvider: provider,
    });
    expect(retried.memoryStatus).toBe("confirmed");
    expect(retried.resolvedAt).toBe(first.resolvedAt);
    expect(retried.memoryReceipts).toHaveLength(expected.length);
    expect(
      retried.memoryReceipts.every((receipt) => receipt.status === "confirmed"),
    ).toBe(true);
    expect(provider.attempts.get(resolutionRecord.recordId)).toBe(1);
    for (const record of expected) {
      expect(provider.attempts.get(record.recordId)).toBe(
        record.recordId === resolutionRecord.recordId ? 1 : 2,
      );
    }

    await resolveMarket(open.id, input, { memoryProvider: provider });
    expect(
      [...provider.attempts.values()].reduce((sum, count) => sum + count, 0),
    ).toBe(expected.length * 2 - 1);
  });

  it("persists exact rank transitions and changes later estimates without rewriting frozen picks", async () => {
    const before = await getInsightsSnapshot();
    const oldEstimate = await getOracleSignal("mkt-climate-grant");
    const frozen = await commitOracleForecast("mkt-pricing-experiment");
    const sports = await getMarket("mkt-sports-final");
    const resolved = await resolveMarket(sports.id, {
      winningOutcomeId: sports.outcomes[1].id,
      resolutionNote:
        "Synthetic away win to demonstrate a negative update for the trusted cohort.",
    });
    const after = await getInsightsSnapshot();
    const mayaBefore = before.leaderboard.find(
      (entry) => entry.participantId === "maya",
    )!;
    const mayaAfter = after.leaderboard.find(
      (entry) => entry.participantId === "maya",
    )!;
    const transition = resolved.learningUpdate!.changes.find(
      (entry) => entry.participantId === "maya",
    )!;
    expect(transition.before?.shrinkageSkillScore).toBe(
      mayaBefore.shrinkageSkillScore,
    );
    expect(transition.after.shrinkageSkillScore).toBe(
      mayaAfter.shrinkageSkillScore,
    );
    expect(transition.after.totalCount).toBe(mayaBefore.totalCount + 1);
    expect(mayaAfter.shrinkageSkillScore).toBeLessThan(
      mayaBefore.shrinkageSkillScore,
    );
    expect(
      after.records.find(
        (record) =>
          record.kind === "market_resolution" && record.marketId === sports.id,
      ),
    ).toMatchObject({ learningUpdate: resolved.learningUpdate });
    expect(
      (await getOracleSignal("mkt-climate-grant")).snapshot
        .memoryCalibratedProbabilities,
    ).not.toEqual(oldEstimate.snapshot.memoryCalibratedProbabilities);
    expect((await getOracleSignal("mkt-pricing-experiment")).snapshot).toEqual(
      frozen.snapshot,
    );
    const retry = await resolveMarket(sports.id, {
      winningOutcomeId: sports.outcomes[1].id,
      resolutionNote: "Same outcome retry keeps original snapshot.",
    });
    expect(retry.learningUpdate).toEqual(resolved.learningUpdate);
  });
});
