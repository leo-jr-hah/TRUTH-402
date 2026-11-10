import { describe, expect, it } from "vitest";

import { buildPredictionCalibration } from "@/lib/memory/prediction";
import { createPredictionFixture, createSeedDatabase } from "@/lib/seed";

describe("prediction comparison corpus", () => {
  it("demonstrates the lucky whale versus calibrated grinders without rewriting memories", () => {
    const fixture = createPredictionFixture();
    const before = JSON.stringify(createSeedDatabase().demoMemories);
    const snapshot = buildPredictionCalibration(
      fixture.traders,
      fixture.positions,
    );
    const whale = snapshot.entries.find((entry) =>
      entry.displayName.startsWith("Lucky"),
    )!;
    const maya = snapshot.entries.find((entry) =>
      entry.displayName.startsWith("Maya"),
    )!;
    expect(whale).toMatchObject({
      totalCount: 2,
      profitRank: 1,
      trustRank: 6,
      rankDelta: -5,
    });
    expect(maya.trustRank).toBe(1);
    expect(whale.skillScore).toBeLessThan(maya.skillScore);
    expect(JSON.stringify(createSeedDatabase().demoMemories)).toBe(before);
  });

  it("counts only one observation per wallet/market and excludes unknown wallets", () => {
    const fixture = createPredictionFixture();
    const original = buildPredictionCalibration(
      fixture.traders,
      fixture.positions,
    );
    const augmented = buildPredictionCalibration(fixture.traders, [
      ...fixture.positions,
      fixture.positions[0],
      { ...fixture.positions[0], asset: "other", conviction: 1, resolution: 0 },
      { ...fixture.positions[0], wallet: "unknown" },
    ]);
    expect(augmented.entries.map((entry) => entry.totalCount)).toEqual(
      original.entries.map((entry) => entry.totalCount),
    );
    expect(buildPredictionCalibration([], []).entries).toEqual([]);
  });
});
