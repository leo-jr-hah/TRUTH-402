import type { Metadata } from "next";

import { IntegrationDashboard } from "@/components/integration-dashboard";
import { getHealthSnapshot } from "@/lib/services/health";
import { getMarkets } from "@/lib/services/markets";
import { requiresOperator, judgeSandboxEnabled } from "@/lib/config";

export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [health, markets] = await Promise.all([
    getHealthSnapshot(),
    getMarkets(),
  ]);
  const options = markets
    .filter((m) => m.status === "open")
    .map((m) => ({ id: m.id, title: m.title }));

  return (
    <div className="text-ink min-w-0 pt-4 font-sans sm:pt-8">
      <IntegrationDashboard
        initialHealth={health}
        markets={options}
        operatorRequired={requiresOperator()}
        sandboxEnabled={judgeSandboxEnabled()}
      />
    </div>
  );
}
