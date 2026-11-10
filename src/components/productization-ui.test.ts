import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentDemo } from "@/components/agent-demo";
import { OraclePanel } from "@/components/oracle-panel";
import { WalletConnect } from "@/components/wallet-connect";
import { RankComparison } from "@/components/rank-comparison";
import { createSeedDatabase } from "@/lib/seed";

describe("live product UI without credential misrepresentation", () => {
  it("renders a locale-independent rank fallback instead of mismatched compact currencies during hydration", () => {
    const html = renderToStaticMarkup(
      createElement(RankComparison, {
        rows: [
          {
            id: "a",
            name: "Whale",
            profitRank: 1,
            trustRank: 2,
            profit: 142000,
          },
        ],
      }),
    );
    expect(html).toContain("Whale");
    expect(html).toContain("Track record #2");
    expect(html).not.toContain("$142");
  });
  it("keeps the live agent runner enabled and offers only explicitly configured sandbox access", () => {
    const html = renderToStaticMarkup(
      createElement(AgentDemo, {
        markets: [{ id: "mkt-sports-final", title: "Final" }],
        paymentMode: "live",
        sandboxEnabled: true,
      }),
    );
    expect(html).toMatch(/Pay and unlock|Connect wallet to pay/u);
    expect(
      html
        .match(/<button\b[^>]*>[\s\S]*?<\/button>/gu)
        ?.find((button) =>
          /Pay and unlock|Connect wallet to pay/u.test(button),
        ),
    ).not.toContain('disabled=""');
    expect(html).not.toContain("demo is off");
  });
  it("does not ask public judges for an operator token but retains secure default prompts", () => {
    const market = createSeedDatabase().markets.find(
      (m) => m.id === "mkt-sports-final",
    )!;
    const html = renderToStaticMarkup(
      createElement(OraclePanel, {
        market,
        paymentMode: "live",
        commitMode: "live",
        operatorRequired: false,
      }),
    );
    expect(html).not.toContain("Operator token");
    expect(html).toContain("Commit Pre-Resolution Pick");
    expect(
      renderToStaticMarkup(
        createElement(OraclePanel, {
          market,
          paymentMode: "live",
          commitMode: "live",
        }),
      ),
    ).toContain("Operator token");
  });
  it("does not manufacture a connected wallet on the server render", () => {
    const html = renderToStaticMarkup(createElement(WalletConnect));
    expect(html).toContain("Connect wallet");
    expect(html).not.toContain("0x2f7f");
  });
});
