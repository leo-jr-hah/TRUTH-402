import { describe, expect, it } from "vitest";

import {
  createMarketSchema,
  resolveMarketSchema,
  tradeSchema,
} from "@/lib/validation";

const base = {
  title: "Which roadmap outcome should receive the next sprint?",
  description:
    "A sufficiently detailed decision context for all informed participants.",
  sponsor: "Product Council",
  liquidity: 250,
  tags: ["roadmap"],
};

describe("request validation", () => {
  it("accepts valid Simple Choice and Opportunity inputs", () => {
    expect(
      createMarketSchema.parse({
        ...base,
        type: "simple",
        outcomes: [{ label: "Choice one" }, { label: "Choice two" }],
      }).outcomes,
    ).toHaveLength(2);

    expect(
      createMarketSchema.parse({
        ...base,
        type: "opportunity",
        outcomes: [
          { label: "Proposal one", submitter: "Team A" },
          { label: "Proposal two", submitter: "Team B" },
          { label: "Proposal three", submitter: "Team C" },
        ],
      }).outcomes,
    ).toHaveLength(3);
  });

  it("enforces format counts and unique outcome labels", () => {
    const tooFew = createMarketSchema.safeParse({
      ...base,
      type: "opportunity",
      outcomes: [{ label: "One" }, { label: "Two" }],
    });
    const duplicate = createMarketSchema.safeParse({
      ...base,
      type: "simple",
      outcomes: [{ label: "Same" }, { label: "same" }],
    });

    expect(tooFew.success).toBe(false);
    expect(duplicate.success).toBe(false);
  });

  it("requires a named submitter for every ranked opportunity", () => {
    const result = createMarketSchema.safeParse({
      ...base,
      type: "opportunity",
      outcomes: [
        { label: "One", submitter: "Team A" },
        { label: "Two" },
        { label: "Three", submitter: "Team C" },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("bounds simulated trades and requires a resolution rationale", () => {
    expect(
      tradeSchema.parse({
        outcomeId: "outcome-1",
        amount: 100,
        displayName: "Avery Stone",
      }).role,
    ).toBe("trader");
    expect(
      tradeSchema.safeParse({
        outcomeId: "outcome-1",
        amount: 10001,
        displayName: "Avery Stone",
      }).success,
    ).toBe(false);
    expect(
      resolveMarketSchema.safeParse({
        winningOutcomeId: "outcome-1",
        resolutionNote: "no",
      }).success,
    ).toBe(false);
  });

  it("sanitizes stored/displayed text and rejects unknown body fields", () => {
    const dash = String.fromCodePoint(0x2014);
    const parsed = createMarketSchema.parse({
      ...base,
      title: `  <b>Which roadmap outcome${dash}should ship?</b>\u202E  `,
      type: "simple",
      sponsor: "VERDICTO_DATA_V1: <Council>",
      outcomes: [{ label: "<One>" }, { label: "Two" }],
    });

    expect(parsed.title).toBe("‹b›Which roadmap outcome - should ship?‹/b›");
    expect(parsed.title).not.toContain(dash);
    expect(parsed.sponsor).not.toContain("VERDICTO_DATA_V1:");
    expect(parsed.outcomes[0].label).toBe("‹One›");
    expect(
      tradeSchema.safeParse({
        outcomeId: "outcome-1",
        amount: 100,
        displayName: "Avery Stone",
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
