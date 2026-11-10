import type { Outcome } from "@/types/domain";

const BRACKET_ITERATIONS = 128;
const PRECISION_ITERATIONS = 80;

function assertLiquidity(liquidity: number): void {
  if (!Number.isFinite(liquidity) || liquidity <= 0) {
    throw new RangeError("Liquidity must be a positive finite number.");
  }
}

/** Cost of an LMSR state. The stable log-sum-exp form avoids overflow. */
export function lmsrCost(quantities: number[], liquidity: number): number {
  assertLiquidity(liquidity);
  if (
    quantities.length < 2 ||
    quantities.some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError(
      "At least two finite outcome quantities are required.",
    );
  }
  const maximum = Math.max(...quantities);
  return (
    maximum +
    liquidity *
      Math.log(
        quantities.reduce(
          (sum, value) => sum + Math.exp((value - maximum) / liquidity),
          0,
        ),
      )
  );
}

/** Implied probabilities for an LMSR state. Values sum to one. */
export function lmsrPrices(quantities: number[], liquidity: number): number[] {
  assertLiquidity(liquidity);
  if (
    quantities.length < 2 ||
    quantities.some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError(
      "At least two finite outcome quantities are required.",
    );
  }

  const maximum = Math.max(...quantities);
  const weights = quantities.map((value) =>
    Math.exp((value - maximum) / liquidity),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight) => weight / total);
}

/**
 * Solve the number of shares purchased for an exact conviction-credit budget.
 * Binary search is intentionally used instead of a fragile closed form and is
 * deterministic to sub-micro-credit precision. Bracketing is capped at 128
 * doublings, followed by 80 precision iterations: O(n log precision) time for
 * n outcomes and O(n) temporary space. Both loops are hard-bounded.
 */
export function sharesForBudget(
  quantities: number[],
  outcomeIndex: number,
  budget: number,
  liquidity: number,
): number {
  assertLiquidity(liquidity);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new RangeError("Trade amount must be a positive finite number.");
  }
  if (outcomeIndex < 0 || outcomeIndex >= quantities.length) {
    throw new RangeError("Outcome index is outside the market.");
  }

  // LMSR trade costs are invariant to subtracting one common quantity. Keeping
  // the largest state at zero prevents cancellation when a long-lived market's
  // absolute quantities grow while the next trade remains small.
  const offset = Math.max(...quantities);
  const normalized = quantities.map((quantity) => quantity - offset);
  const startingCost = lmsrCost(normalized, liquidity);
  const costFor = (shares: number) => {
    const next = [...normalized];
    next[outcomeIndex] += shares;
    return lmsrCost(next, liquidity) - startingCost;
  };

  let low = 0;
  let high = Math.max(budget * quantities.length, liquidity);
  let bracketed = costFor(high) >= budget;
  for (
    let iteration = 0;
    !bracketed && iteration < BRACKET_ITERATIONS;
    iteration += 1
  ) {
    high *= 2;
    if (!Number.isFinite(high)) break;
    bracketed = costFor(high) >= budget;
  }
  if (!bracketed) {
    throw new RangeError("Could not bracket a finite LMSR share solution.");
  }

  for (let iteration = 0; iteration < PRECISION_ITERATIONS; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (costFor(midpoint) < budget) low = midpoint;
    else high = midpoint;
  }

  return (low + high) / 2;
}

export function applyBuy(
  outcomes: Outcome[],
  outcomeId: string,
  amount: number,
  liquidity: number,
): {
  outcomes: Outcome[];
  shares: number;
  priceBefore: number;
  priceAfter: number;
} {
  const selectedIndex = outcomes.findIndex(
    (outcome) => outcome.id === outcomeId,
  );
  if (selectedIndex === -1)
    throw new RangeError("Selected outcome does not exist.");

  const quantities = outcomes.map((outcome) => outcome.shares);
  const before = lmsrPrices(quantities, liquidity);
  const shares = sharesForBudget(quantities, selectedIndex, amount, liquidity);
  const nextQuantities = [...quantities];
  nextQuantities[selectedIndex] += shares;
  const after = lmsrPrices(nextQuantities, liquidity);

  return {
    outcomes: outcomes.map((outcome, index) => ({
      ...outcome,
      shares: nextQuantities[index],
      price: after[index],
      volume:
        index === selectedIndex ? outcome.volume + amount : outcome.volume,
    })),
    shares,
    priceBefore: before[selectedIndex],
    priceAfter: after[selectedIndex],
  };
}
