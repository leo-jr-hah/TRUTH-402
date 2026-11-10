import { describe, expect, it } from "vitest";

import {
  applyBuy,
  lmsrCost,
  lmsrPrices,
  sharesForBudget,
} from "@/lib/market-maker";
import type { Outcome } from "@/types/domain";

const outcomes: Outcome[] = [
  { id: "a", label: "A", shares: 0, price: 0.5, volume: 0 },
  { id: "b", label: "B", shares: 0, price: 0.5, volume: 0 },
];

describe("LMSR market maker", () => {
  it("starts equal and always normalizes prices", () => {
    expect(lmsrPrices([0, 0, 0], 250)).toEqual([1 / 3, 1 / 3, 1 / 3]);

    const prices = lmsrPrices([900, -200, 45], 120);
    expect(prices.reduce((sum, price) => sum + price, 0)).toBeCloseTo(1, 12);
    expect(prices.every((price) => price >= 0 && price <= 1)).toBe(true);

    const extreme = lmsrPrices([Number.MAX_VALUE / 4, 0], 100);
    expect(extreme).toEqual([1, 0]);
    expect(Number.isFinite(lmsrCost([Number.MAX_VALUE / 4, 0], 100))).toBe(
      true,
    );
  });

  it("solves shares for the exact conviction-credit budget", () => {
    const quantities = [25, 80, 10];
    const liquidity = 250;
    const budget = 137;
    const shares = sharesForBudget(quantities, 1, budget, liquidity);
    const next = [...quantities];
    next[1] += shares;

    expect(
      lmsrCost(next, liquidity) - lmsrCost(quantities, liquidity),
    ).toBeCloseTo(budget, 8);
  });

  it("increases only the selected outcome quantity, price, and volume", () => {
    const result = applyBuy(outcomes, "a", 100, 250);

    expect(result.shares).toBeGreaterThan(0);
    expect(result.priceBefore).toBe(0.5);
    expect(result.priceAfter).toBeGreaterThan(0.5);
    expect(result.outcomes[0].volume).toBe(100);
    expect(result.outcomes[1].volume).toBe(0);
    expect(result.outcomes[0].price + result.outcomes[1].price).toBeCloseTo(
      1,
      12,
    );
  });

  it("rejects invalid liquidity, budgets, and outcome indexes", () => {
    expect(() => lmsrPrices([0, 0], 0)).toThrow(/liquidity/i);
    expect(() => sharesForBudget([0, 0], 0, -1, 100)).toThrow(/amount/i);
    expect(() => sharesForBudget([0, 0], 3, 10, 100)).toThrow(/index/i);
    expect(() => applyBuy(outcomes, "missing", 10, 100)).toThrow(
      /does not exist/i,
    );
  });
});
