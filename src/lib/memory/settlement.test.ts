import { describe, expect, it } from "vitest";

import {
  closingSignal,
  sponsorFollowedStrictHighest,
} from "@/lib/memory/settlement";
import type { Outcome } from "@/types/domain";

function outcome(id: string, price: number): Outcome {
  return { id, label: id.toUpperCase(), shares: 0, price, volume: 0 };
}

describe("closing signal settlement semantics", () => {
  it("is true only when the winner has the strictly highest closing price", () => {
    const outcomes = [outcome("a", 0.6), outcome("b", 0.3), outcome("c", 0.1)];

    expect(sponsorFollowedStrictHighest(outcomes, "a")).toBe(true);
    expect(sponsorFollowedStrictHighest(outcomes, "b")).toBe(false);
    expect(sponsorFollowedStrictHighest(outcomes, "missing")).toBe(false);
  });

  it("treats every top-price tie as not followed and represents it by outcome order", () => {
    const outcomes = [
      outcome("a", 0.45),
      outcome("b", 0.45),
      outcome("c", 0.1),
    ];

    expect(sponsorFollowedStrictHighest(outcomes, "a")).toBe(false);
    expect(sponsorFollowedStrictHighest(outcomes, "b")).toBe(false);
    expect(closingSignal(outcomes)).toEqual({
      leader: outcomes[0],
      tiedLeaders: outcomes.slice(0, 2),
    });
  });
});
