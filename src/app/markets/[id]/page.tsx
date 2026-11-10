import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarketWorkspace } from "@/components/market-workspace";
import {
  getPublicRuntimeConfig,
  requiresOperator,
  judgeSandboxEnabled,
} from "@/lib/config";
import { AppError } from "@/lib/errors";
import { removeEmDashes } from "@/lib/sanitize";
import { participantTrustWeight } from "@/lib/memory/credibility";
import { getMarket } from "@/lib/services/markets";
import { getInsightsSnapshot } from "@/lib/services/insights";
import { buildOracleSnapshot } from "@/lib/services/oracle";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const market = await getMarket((await params).id);
    return {
      title: removeEmDashes(market.title),
      description: removeEmDashes(market.description),
    };
  } catch {
    return { title: "Market not found" };
  }
}

export default async function MarketPage({ params }: Props) {
  const modes = getPublicRuntimeConfig();
  let market;
  try {
    market = await getMarket((await params).id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  // Public current estimates use the configured memory provider in either mode.
  let trustWeights: Record<string, number> | null = null;
  if (market.status === "open") {
    try {
      const insights = await getInsightsSnapshot();
      trustWeights = Object.fromEntries(
        buildOracleSnapshot(market, insights).trustedBackers.map((entry) => [
          entry.participantId,
          participantTrustWeight(entry),
        ]),
      );
    } catch {
      trustWeights = null;
    }
  }

  return (
    <div className="text-ink min-w-0 space-y-4">
      <Link
        href="/markets"
        className="group text-ink/75 hover:text-ink inline-flex min-h-11 items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft
          size={15}
          aria-hidden
          className="shrink-0 transition-transform duration-200 ease-[var(--ease-out-expo)] motion-safe:group-hover:-translate-x-0.5"
        />
        All markets
      </Link>
      <MarketWorkspace
        initialMarket={market}
        paymentMode={modes.tatumMode}
        trustWeights={trustWeights}
        operatorRequired={requiresOperator()}
        sandboxEnabled={judgeSandboxEnabled()}
        commitMode={
          modes.memoryMode === "live" ||
          modes.tatumMode === "live" ||
          modes.aiMode === "live"
            ? "live"
            : "demo"
        }
      />
    </div>
  );
}
