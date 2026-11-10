import { afterEach, describe, expect, it, vi } from "vitest";

import { publicProviderError } from "@/lib/server-secrets";

describe("provider error redaction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("removes configured secrets and bearer values", () => {
    const dash = String.fromCodePoint(0x2014);
    vi.stubEnv("TATUM_API_KEY", "super-secret-provider-key");
    const message = publicProviderError(
      new Error(
        `TATUM${dash}super-secret-provider-key authorization: Bearer another-token`,
      ),
    );

    expect(message).not.toContain("super-secret-provider-key");
    expect(message).not.toContain("another-token");
    expect(message).not.toContain(dash);
    expect(message).toContain("[redacted]");
  });
});
