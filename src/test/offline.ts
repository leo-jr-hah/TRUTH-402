import { beforeEach, vi } from "vitest";

// Live adapter tests must explicitly install mocked fetch. Accidental provider
// requests in every other test fail instead of spending API credits.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error(
        "Unexpected network call in offline tests. Install an explicit provider mock.",
      );
    }),
  );
});
