import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CredibilityTable } from "@/components/credibility-table";
import { OraclePanel } from "@/components/oracle-panel";
import { PredictionCalibrationPanel } from "@/components/prediction-calibration-panel";
import { MarketCard } from "@/components/market-card";
import { MarketRegistry } from "@/components/market-registry";
import { computeMemoryCalibratedSignal } from "@/lib/memory/credibility";
import { deriveCredibility, uniqueRecords } from "@/lib/memory/credibility";
import { buildPredictionCalibration } from "@/lib/memory/prediction";
import { createPredictionFixture, createSeedDatabase } from "@/lib/seed";

describe("oracle judge-facing rendering", () => {
  it("shows the payment challenge action but no demo shortcut before receiving an invoice", () => {
    const market = createSeedDatabase().markets.find(
      (entry) => entry.id === "mkt-sports-final",
    )!;
    const html = renderToStaticMarkup(
      createElement(OraclePanel, {
        market,
        paymentMode: "demo",
        commitMode: "demo",
      }),
    );
    expect(html).toContain("Query Oracle as AI Agent (HTTP 402)");
    expect(html).toContain("Commit Pre-Resolution Pick");
    expect(html).toContain("Locked");
    expect(html).not.toContain("Settle Demo Invoice");
    const live = renderToStaticMarkup(
      createElement(OraclePanel, {
        market,
        paymentMode: "live",
        commitMode: "live",
      }),
    );
    expect(live).toContain("Operator token for live publication");
    expect(live).not.toContain("Demo payments");
  });

  it("shows demo forecast comparisons and counted category controls only when previews are supplied", () => {
    const seed = createSeedDatabase();
    const market = seed.markets.find(
      (entry) => entry.id === "mkt-sports-final",
    )!;
    const learned = deriveCredibility(uniqueRecords(seed.demoMemories));
    const preview = computeMemoryCalibratedSignal(market, learned);
    const html = renderToStaticMarkup(
      createElement(MarketCard, { market, preview }),
    );
    expect(html).toContain("Memory-Calibrated Forecast");
    expect(html).toContain("Raw Market Price");
    expect(html).toContain("Alpha Shift");
    expect(
      renderToStaticMarkup(createElement(MarketCard, { market })),
    ).not.toContain("Memory-Calibrated Forecast");
    const registry = renderToStaticMarkup(
      createElement(MarketRegistry, { markets: seed.markets }),
    );
    expect(registry).toContain("Registry market category");
    expect(registry).toContain("Macro &amp; Governance");
    expect(registry).toContain("Strategy");
    expect(registry.match(/data-category=/gu)).toHaveLength(22);
  });

  it("renders skill divergence and normalizes untrusted copy", () => {
    const fixture = createPredictionFixture();
    const snapshot = buildPredictionCalibration(
      fixture.traders,
      fixture.positions,
    );
    snapshot.entries[0].displayName = `Maya${String.fromCodePoint(0x2014)}Chen`;
    const html = renderToStaticMarkup(
      createElement(PredictionCalibrationPanel, {
        initial: snapshot,
        mode: "demo",
      }),
    );
    expect(html).toContain("Synthetic cross-category benchmark");
    expect(html).toContain("Profit outruns evidence");
    expect(html).toContain("Maya - Chen");
    expect(html).not.toContain(String.fromCodePoint(0x2014));
    const table = renderToStaticMarkup(
      createElement(CredibilityTable, {
        entries: deriveCredibility(
          uniqueRecords(createSeedDatabase().demoMemories),
        ),
        showBreakdown: true,
      }),
    );
    expect(table).toContain("Skill vs. profit rank");
    expect(table).toContain("90% interval");
    expect(table).toContain("estimated legacy entries");
  });
});
