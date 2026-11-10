import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { buildResolutionMemories } from "@/lib/memory/codec";
import {
  createMemoryRecordId,
  expectedMemoryRecordId,
} from "@/lib/memory/record-id";
import { createSeedDatabase } from "@/lib/seed";

describe("memory record IDs", () => {
  it("preserves the original twenty v1 memory strings byte for byte", () => {
    expect(
      createHash("sha256")
        .update(
          JSON.stringify(
            createSeedDatabase()
              .demoMemories.slice(0, 20)
              .map((memory) => memory.text),
          ),
        )
        .digest("hex"),
    ).toBe("f064c2de5ddb42cb6be09a776d47ebce11a59c893da783d9e40edf286487bf90");
  });
  it("matches the documented canonical SHA-256 vector", () => {
    // sha256('["participant_performance","market-123","participant-abc",1]')
    expect(
      createMemoryRecordId({
        version: 1,
        kind: "participant_performance",
        marketId: "market-123",
        subjectId: "participant-abc",
      }),
    ).toBe("defd164e648f433a911a914a11bdcc0ffc0c01b8d9b0b36a25a0721dd84a9af7");
  });

  it("is stable across reconstruction and changes for every tuple component", () => {
    const input = {
      version: 1,
      kind: "participant_performance" as const,
      marketId: "market-123",
      subjectId: "participant-abc",
    };
    const stable = createMemoryRecordId(input);

    expect(createMemoryRecordId({ ...input })).toBe(stable);
    expect(createMemoryRecordId({ ...input, version: 2 })).not.toBe(stable);
    expect(
      createMemoryRecordId({ ...input, kind: "market_resolution" }),
    ).not.toBe(stable);
    expect(createMemoryRecordId({ ...input, marketId: "market-124" })).not.toBe(
      stable,
    );
    expect(
      createMemoryRecordId({ ...input, subjectId: "participant-abd" }),
    ).not.toBe(stable);
  });

  it("uses canonical IDs for every deterministic demo record", () => {
    const build = () =>
      createSeedDatabase()
        .markets.filter((market) => market.status === "resolved")
        .flatMap(buildResolutionMemories);
    const first = build();
    const second = build();

    expect(first.map((record) => record.recordId)).toEqual(
      second.map((record) => record.recordId),
    );
    expect(first.every((record) => record.recordId.length === 64)).toBe(true);
    expect(
      first.every(
        (record) => record.recordId === expectedMemoryRecordId(record),
      ),
    ).toBe(true);
  });
});
