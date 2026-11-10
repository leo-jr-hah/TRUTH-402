import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as create } from "@/app/api/markets/route";
import { POST as trade } from "@/app/api/markets/[id]/trade/route";
import { POST as resolve } from "@/app/api/markets/[id]/resolve/route";
import { POST as generate } from "@/app/api/insights/generate/route";
import { clearRateLimitState } from "@/lib/request-guards";
import { resetStoreForTests } from "@/lib/store";

describe("live evidence mutation authorization", () => {
  beforeEach(async () => {
    await resetStoreForTests();
    clearRateLimitState();
  });
  afterEach(() => vi.unstubAllEnvs());
  it("protects every legacy mutation when any provider is live, without contacting providers", async () => {
    vi.stubEnv("TRUTH402_AI_MODE", "live");
    vi.stubEnv(
      "TRUTH402_ORACLE_ADMIN_TOKEN",
      "test-operator-token-with-at-least-32-characters",
    );
    const context = { params: Promise.resolve({ id: "mkt-sports-final" }) };
    const request = () =>
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    for (const response of await Promise.all([
      create(request()),
      trade(request(), context),
      resolve(request(), context),
      generate(request()),
    ])) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "ORACLE_COMMIT_FORBIDDEN" },
      });
    }
  });
  it("never echoes arbitrary validation input in error details", async () => {
    const dash = String.fromCodePoint(0x2014);
    const response = await create(
      new Request("http://localhost/api/markets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [`untrusted${dash}field`]: "private-value" }),
      }),
    );
    const text = await response.text();
    expect(text).not.toContain(dash);
    expect(text).not.toContain("private-value");
    expect(text).not.toContain("untrusted");
  });
});
