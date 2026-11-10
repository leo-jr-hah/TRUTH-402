import type { Metadata } from "next";

import { MarketForm } from "@/components/market-form";
import { PageHeading } from "@/components/page-heading";
import { requiresOperator } from "@/lib/config";

export const metadata: Metadata = { title: "New simple choice" };
export const dynamic = "force-dynamic";

export default function NewSimpleMarketPage() {
  return (
    <div className="space-y-8">
      <PageHeading
        title="New simple choice"
        description="One question, a few options."
      />
      <MarketForm type="simple" operatorRequired={requiresOperator()} />
    </div>
  );
}
