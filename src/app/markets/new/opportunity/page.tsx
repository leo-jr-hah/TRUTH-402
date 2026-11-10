import type { Metadata } from "next";

import { MarketForm } from "@/components/market-form";
import { PageHeading } from "@/components/page-heading";
import { requiresOperator } from "@/lib/config";

export const metadata: Metadata = { title: "New opportunity" };
export const dynamic = "force-dynamic";

export default function NewOpportunityMarketPage() {
  return (
    <div className="space-y-8">
      <PageHeading
        title="New opportunity"
        description="One question, several proposals to rank."
      />
      <MarketForm type="opportunity" operatorRequired={requiresOperator()} />
    </div>
  );
}
