import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";
import MarketsPage from "@/app/markets/page";
import MarketPage from "@/app/markets/[id]/page";
import { requiresOperator } from "@/lib/config";
import * as insights from "@/lib/services/insights";
import { resetStoreForTests } from "@/lib/store";

describe("public live-mode signal previews", () => {
  beforeEach(async () => {
    await resetStoreForTests();
    insights.invalidateInsightsCache();
    const snapshot = await insights.getInsightsSnapshot();
    vi.spyOn(insights, "getInsightsSnapshot").mockResolvedValue(snapshot);
    vi.stubEnv("VERDICTO_MEMORY_MODE", "live");
    vi.stubEnv("VERDICTO_TATUM_MODE", "live");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it("shows home previews and recalled ranks even when mutations require an operator", async () => {
    expect(requiresOperator()).toBe(true);
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Track record");
    expect(html).toContain("Walrus Mainnet Memory");
    expect(html).not.toContain("Simulated demo data");
    expect(html).not.toContain("Lucky Whale");
    expect(insights.getInsightsSnapshot).toHaveBeenCalled();
  });
  it("supplies market registry previews in live mode", async () => {
    const html = renderToStaticMarkup(await MarketsPage());
    expect(html).toContain("Memory-Calibrated Forecast");
    expect(html).toContain("Alpha Shift");
  });
  it("supplies evidence-complete trust weights and removes prompts only in explicit judge mode", async () => {
    vi.stubEnv("VERDICTO_PUBLIC_JUDGE_MODE", "true");
    const html = renderToStaticMarkup(
      await MarketPage({ params: Promise.resolve({ id: "mkt-sports-final" }) }),
    );
    expect(html).not.toContain("Operator token");
    expect(html).toContain("Calibrated Trader");
    expect(html).not.toContain("Demo trader");
    expect(html).toContain("Track record");
    expect(insights.getInsightsSnapshot).toHaveBeenCalled();
  });
});
