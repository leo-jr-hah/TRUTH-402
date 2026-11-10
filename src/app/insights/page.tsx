import type { Metadata } from "next";

import { InsightsDashboard } from "@/components/insights-dashboard";
import { getPublicRuntimeConfig, requiresOperator } from "@/lib/config";
import { buildPredictionCalibration } from "@/lib/memory/prediction";
import { createPredictionFixture } from "@/lib/seed";
import { getInsightsSnapshot } from "@/lib/services/insights";

export const metadata: Metadata = { title: "Traders" };
export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string }>;
}) {
  const snapshot = await getInsightsSnapshot();
  const requested = (await searchParams).record;
  const selectedRecordId =
    typeof requested === "string" && /^[a-f0-9]{64}$/u.test(requested)
      ? requested
      : undefined;
  const mode = getPublicRuntimeConfig().tatumMode;
  const fixture = createPredictionFixture();

  return (
    <div className="text-ink min-w-0 space-y-8 pb-8 sm:space-y-10">
      <header className="max-w-3xl pt-4 sm:pt-8">
        <h1 className="font-display text-4xl leading-[1.04] font-bold tracking-[-0.035em] sm:text-5xl">
          Traders
        </h1>
        <p className="text-ink/75 mt-3 max-w-xl text-base sm:text-lg">
          Who has the best track record.
        </p>
      </header>
      <InsightsDashboard
        initialSnapshot={snapshot}
        selectedRecordId={selectedRecordId}
        operatorRequired={requiresOperator()}
        calibrationMode={mode}
        initialCalibration={
          mode === "demo"
            ? buildPredictionCalibration(fixture.traders, fixture.positions)
            : null
        }
      />
    </div>
  );
}
