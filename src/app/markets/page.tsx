import type { Metadata } from "next";

import { MarketRegistry } from "@/components/market-registry";
import { getMarkets } from "@/lib/services/markets";
import { getInsightsSnapshot } from "@/lib/services/insights";
import { buildOracleSnapshot } from "@/lib/services/oracle";

export const metadata: Metadata = { title: "Markets" };
export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const [markets, insights] = await Promise.all([
    getMarkets(),
    getInsightsSnapshot(),
  ]);
  const previews = Object.fromEntries(
    markets
      .filter((market) => market.status === "open")
      .map((market) => [
        market.id,
        buildOracleSnapshot(market, insights).memoryCalibratedProbabilities,
      ]),
  );

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <header className="flex items-center gap-2 py-4">
        <h1 className="text-ink text-xl font-semibold">Markets</h1>
        <span className="text-ink/60 text-sm tabular-nums">
          ({markets.length})
        </span>
      </header>
      <MarketRegistry markets={markets} previews={previews} />
    </div>
  );
}
