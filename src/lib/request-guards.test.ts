import { describe, expect, it } from "vitest";

import {
  clearRateLimitState,
  guardMutationRequest,
  guardSameOrigin,
} from "@/lib/request-guards";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

describe("mutation request guards", () => {
  it("uses the actual browser Host across Next listener aliases and ignores forwarded-host spoofing", () => {
    const alias = new Request("http://localhost:4100/api/commit", {
      headers: { host: "127.0.0.1:4100", origin: "http://127.0.0.1:4100" },
    });
    expect(() => guardSameOrigin(alias)).not.toThrow();
    const attack = new Request(alias.url, {
      headers: {
        host: "127.0.0.1:4100",
        origin: "https://attacker.example",
        "x-forwarded-host": "attacker.example",
      },
    });
    expect(() => guardSameOrigin(attack)).toThrow(/Cross-origin/u);
  });
  it("rejects cross-origin requests before any mutation", () => {
    expect(() =>
      guardMutationRequest(
        request({ origin: "https://attacker.example" }),
        "cross-origin",
        { maxBytes: 20, requests: 2, windowMs: 60000 },
      ),
    ).toThrow(/Cross-origin/u);
    expect(() =>
      guardMutationRequest(
        request({ origin: "http://localhost" }),
        "same-origin",
        { maxBytes: 20, requests: 2, windowMs: 60000 },
      ),
    ).not.toThrow();
  });
  it("rejects unsupported types and oversized declared bodies", () => {
    clearRateLimitState();
    expect(() =>
      guardMutationRequest(
        new Request("http://localhost/api/test", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
        "test",
        { maxBytes: 8, requests: 2, windowMs: 60_000 },
      ),
    ).toThrow(/application\/json/i);
    expect(() =>
      guardMutationRequest(request({ "content-length": "9" }), "test", {
        maxBytes: 8,
        requests: 2,
        windowMs: 60_000,
      }),
    ).toThrow(/exceeds/i);
  });

  it("enforces a process-local per-client request limit", () => {
    clearRateLimitState();
    const policy = { maxBytes: 8, requests: 1, windowMs: 60_000 };
    guardMutationRequest(
      request({ "x-forwarded-for": "203.0.113.8" }),
      "test",
      policy,
    );
    expect(() =>
      guardMutationRequest(
        request({ "x-forwarded-for": "203.0.113.8" }),
        "test",
        policy,
      ),
    ).toThrow(/too many/i);
  });
});
