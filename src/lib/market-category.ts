import type { Market } from "@/types/domain";

export const MARKET_CATEGORIES = [
  "All",
  "Sports",
  "Crypto",
  "Macro & Governance",
  "Strategy",
] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export function marketCategory(
  market: Pick<Market, "tags">,
): Exclude<MarketCategory, "All"> {
  const tags = market.tags.map((tag) => tag.toLowerCase());
  if (tags.includes("sports")) return "Sports";
  if (tags.includes("crypto")) return "Crypto";
  if (tags.some((tag) => ["macro", "politics", "governance"].includes(tag)))
    return "Macro & Governance";
  return "Strategy";
}

export function marketCategoryBadge(
  market: Pick<Market, "tags" | "liquidity">,
): string {
  const category = marketCategory(market);
  return `${category === "Macro & Governance" ? "MACRO / GOV" : category.toUpperCase()} · b=${market.liquidity}`;
}
