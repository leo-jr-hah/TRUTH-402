import { describe, expect, it } from "vitest";
import {
  MARKET_CATEGORIES,
  marketCategory,
  marketCategoryBadge,
} from "@/lib/market-category";
import { createSeedDatabase } from "@/lib/seed";

describe("market display metadata", () => {
  it("partitions the registry with honest category and liquidity badges", () => {
    const markets = createSeedDatabase().markets;
    expect(
      MARKET_CATEGORIES.map((category) =>
        category === "All"
          ? markets.length
          : markets.filter((market) => marketCategory(market) === category)
              .length,
      ),
    ).toEqual([22, 7, 6, 4, 5]);
    expect(
      marketCategoryBadge(
        markets.find((market) => market.id === "mkt-sports-final")!,
      ),
    ).toBe("SPORTS · b=500");
    expect(marketCategory({ tags: ["Governance"] })).toBe("Macro & Governance");
    expect(marketCategory({ tags: [] })).toBe("Strategy");
  });
  it("retains all 17 new market identities with crisp display copy and synthetic provenance", () => {
    const markets = createSeedDatabase().markets.slice(5);
    expect(markets).toHaveLength(17);
    for (const market of markets) {
      expect(market.tags).toContain("synthetic-demo");
      for (const text of [
        market.title,
        market.description,
        market.sponsor,
        ...market.trades.map((trade) => trade.displayName),
      ])
        expect(text).not.toMatch(
          /\((?:open |resolved )?demo\)|synthetic teaching|sandbox/iu,
        );
    }
    expect(new Set(markets.map((market) => market.id)).size).toBe(17);
  });
});
