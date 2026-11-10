import type { Metadata } from "next";

import { FormatChooser } from "@/components/format-chooser";
import { PageHeading } from "@/components/page-heading";

export const metadata: Metadata = { title: "New market" };

export default function NewMarketPage() {
  return (
    <div className="space-y-8">
      <PageHeading
        title="New market"
        description="Pick a format. Simulated credits only."
      />
      <FormatChooser />
    </div>
  );
}
