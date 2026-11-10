import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { MarketRail, type RailMarket } from "@/components/landing/market-rail";
import { OrbitScene } from "@/components/landing/orbit-scene";
import { RankComparison } from "@/components/rank-comparison";
import { StackStrip } from "@/components/landing/stack-strip";
import { TrustDial } from "@/components/landing/trust-dial";
import { Reveal } from "@/components/ui/reveal";
import { getPublicRuntimeConfig } from "@/lib/config";
import { parseMemory } from "@/lib/memory/codec";
import { buildPredictionCalibration } from "@/lib/memory/prediction";
import { removeEmDashes } from "@/lib/sanitize";
import { createPredictionFixture } from "@/lib/seed";
import { getInsightsSnapshot } from "@/lib/services/insights";
import { getMarkets } from "@/lib/services/markets";
import { buildOracleSnapshot } from "@/lib/services/oracle";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [markets, insights] = await Promise.all([
    getMarkets(),
    getInsightsSnapshot(undefined, 100),
  ]);
  const open = markets.filter((m) => m.status === "open");
  const sports = [...open].sort(
    (a, b) =>
      Number(b.tags.includes("sports")) - Number(a.tags.includes("sports")),
  );
  const hero = open.find((m) => m.id === "mkt-sports-final") ?? open[0];
  const fixture = createPredictionFixture();
  const benchmark =
    getPublicRuntimeConfig().memoryMode === "live"
      ? { entries: insights.leaderboard }
      : buildPredictionCalibration(fixture.traders, fixture.positions);
  const blobByParticipant = new Map<string, string>();
  for (const memory of insights.memories) {
    const parsed = parseMemory(memory.text);
    if (
      parsed?.kind === "participant_performance" &&
      !blobByParticipant.has(parsed.displayName.toLocaleLowerCase())
    ) {
      blobByParticipant.set(
        parsed.displayName.toLocaleLowerCase(),
        parsed.recordId,
      );
    }
  }
  const traders = benchmark.entries.map((e) => {
    const cleanName = removeEmDashes(e.displayName);
    const matchedRecordId = blobByParticipant.get(
      cleanName.toLocaleLowerCase(),
    );
    return {
      id: e.participantId,
      name: cleanName,
      profitRank: e.profitRank,
      trustRank: e.trustRank,
      profit:
        "leaderboardPnlUsd" in e && typeof e.leaderboardPnlUsd === "number"
          ? e.leaderboardPnlUsd
          : e.rawPnl,
      skill: e.shrinkageSkillScore,
      samples: e.totalCount,
      ...(matchedRecordId ? { blobId: matchedRecordId } : {}),
    };
  });

  const rail: RailMarket[] = sports.slice(0, 8).map((m) => {
    const lead = [...m.outcomes].sort((a, b) => b.price - a.price)[0];
    const sig = buildOracleSnapshot(
      m,
      insights,
    ).memoryCalibratedProbabilities.find((s) => s.outcomeId === lead.id);
    return {
      id: m.id,
      title: removeEmDashes(m.title),
      lead: removeEmDashes(lead.label),
      crowd: Math.round(lead.price * 100),
      record: sig ? Math.round(sig.oracleProbability * 100) : undefined,
      traders: new Set(m.trades.map((t) => t.participantId)).size,
      category: m.tags.includes("sports")
        ? "sports"
        : m.tags.includes("crypto")
          ? "crypto"
          : m.tags.includes("macro") || m.tags.includes("strategy")
            ? "macro"
            : undefined,
    };
  });
  const heroRail =
    rail.find((r) => r.id === hero?.id && r.record !== undefined) ??
    rail.find((r) => r.record !== undefined);
  const crowd = heroRail?.crowd ?? 60;
  const record = heroRail?.record ?? 66;

  return (
    <div className="space-y-24 sm:space-y-32">
      <section
        data-theme="dark"
        className="relative isolate -mt-1 h-[min(calc(100svh-6.5rem),52rem)] min-h-[560px] overflow-hidden rounded-[2rem]"
      >
        <OrbitScene
          traders={traders}
          crowd={crowd}
          record={record}
          marketTitle={heroRail?.title ?? "Featured market"}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-6 p-6 sm:p-10">
          <div className="max-w-[34rem]">
            <h1 className="display text-fog text-[clamp(2.2rem,5.2vw,4.4rem)]">
              Odds, weighted by who has been right.
            </h1>
            <Link
              href={hero ? `/markets/${hero.id}` : "/markets"}
              className="button-primary !bg-fog !text-navy pointer-events-auto mt-6"
            >
              Enter a market <ArrowRight size={18} />
            </Link>
          </div>
          <p className="text-fog/70 max-w-[15rem] text-xs leading-relaxed">
            Close to the core: trusted track record. Big bubble: big profit.{" "}
            Walrus Mainnet Memory · Tatum Sui RPC · HTTP 402.
          </p>
        </div>
      </section>

      <Reveal>
        <StackStrip />
      </Reveal>

      <Reveal>
        <section aria-label="Weight track record">
          <h2 className="display max-w-2xl text-[clamp(2rem,4.5vw,3.6rem)]">
            Same market. Two answers.
          </h2>
          <div className="mt-10">
            <TrustDial
              crowd={crowd}
              record={record}
              title={heroRail?.title ?? "Featured market"}
            />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <RankComparison rows={traders} />
      </Reveal>

      <section aria-label="Open markets">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="display text-[clamp(2rem,4.5vw,3.6rem)]">
            Open markets
          </h2>
          <Link href="/markets" className="button-secondary">
            All markets <ArrowRight size={16} />
          </Link>
        </div>
        <MarketRail markets={rail} />
      </section>
    </div>
  );
}
