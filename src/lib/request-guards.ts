import "server-only";

import { createHash } from "node:crypto";

import { AppError } from "@/lib/errors";

const RATE_LIMIT_SYMBOL = Symbol.for("verdicto.rate-limit");
const MAX_RATE_LIMIT_BUCKETS = 10_000;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitState {
  buckets: Map<string, RateLimitBucket>;
  requestsSinceCleanup: number;
}

const globalRateLimits = globalThis as typeof globalThis & {
  [RATE_LIMIT_SYMBOL]?: RateLimitState;
};

const state =
  globalRateLimits[RATE_LIMIT_SYMBOL] ??
  (globalRateLimits[RATE_LIMIT_SYMBOL] = {
    buckets: new Map(),
    requestsSinceCleanup: 0,
  });

export interface MutationGuardPolicy {
  maxBytes: number;
  requests: number;
  windowMs: number;
}

export const MUTATION_POLICIES = {
  createMarket: { maxBytes: 32 * 1_024, requests: 20, windowMs: 60_000 },
  trade: { maxBytes: 8 * 1_024, requests: 60, windowMs: 60_000 },
  resolve: { maxBytes: 8 * 1_024, requests: 20, windowMs: 60_000 },
  generateInsight: { maxBytes: 4 * 1_024, requests: 10, windowMs: 60_000 },
} as const satisfies Record<string, MutationGuardPolicy>;

function clientFingerprint(request: Request): string {
  // This is best-effort abuse control, not identity or authentication. Forwarded
  // headers are useful behind Vercel but can be asserted by a direct client.
  const raw =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "anonymous";
  return createHash("sha256")
    .update(raw.slice(0, 200), "utf8")
    .digest("hex")
    .slice(0, 24);
}

function pruneExpiredBuckets(now: number): void {
  for (const [key, bucket] of state.buckets) {
    if (bucket.resetAt <= now) state.buckets.delete(key);
  }

  // Keep memory bounded even if spoofed client identifiers create many buckets.
  while (state.buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldest = state.buckets.keys().next().value as string | undefined;
    if (!oldest) break;
    state.buckets.delete(oldest);
  }
}

export function enforceRateLimit(
  request: Request,
  scope: string,
  policy: MutationGuardPolicy,
): void {
  const now = Date.now();
  state.requestsSinceCleanup += 1;
  if (
    state.requestsSinceCleanup >= 100 ||
    state.buckets.size >= MAX_RATE_LIMIT_BUCKETS
  ) {
    pruneExpiredBuckets(now);
    state.requestsSinceCleanup = 0;
  }

  const key = `${scope}:${clientFingerprint(request)}`;
  const current = state.buckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + policy.windowMs }
      : current;

  if (bucket.count >= policy.requests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1_000),
    );
    throw new AppError(
      "RATE_LIMITED",
      "Too many mutation requests. Please retry shortly.",
      429,
      { retryAfterSeconds },
      { "retry-after": String(retryAfterSeconds) },
    );
  }

  bucket.count += 1;
  // Refresh insertion order so emergency size pruning removes least-recent keys.
  state.buckets.delete(key);
  state.buckets.set(key, bucket);
}

export function guardSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // Non-browser agents still need live operator credentials.
  const internalUrl = new URL(request.url);
  // Next may construct request.url with its listener hostname, not the browser
  // hostname. Host is browser-controlled only by the destination, unlike an
  // arbitrary forwarded header. An explicit deployment URL handles TLS proxies.
  const host = request.headers.get("host");
  const browserOrigin =
    host && /^[a-zA-Z0-9.:[\]-]+$/u.test(host)
      ? `${internalUrl.protocol}//${host}`
      : internalUrl.origin;
  let configuredOrigin: string | undefined;
  try {
    if (process.env.NEXT_PUBLIC_APP_URL)
      configuredOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
  } catch {
    /* Invalid metadata URL is not an allowed origin. */
  }
  if (origin !== browserOrigin && origin !== configuredOrigin) {
    throw new AppError(
      "CROSS_ORIGIN_MUTATION",
      "Cross-origin mutations are not allowed.",
      403,
    );
  }
}

/** Apply content type, declared-size, origin and process-local rate guards. */
export function guardMutationRequest(
  request: Request,
  scope: string,
  policy: MutationGuardPolicy,
): void {
  guardSameOrigin(request);
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Mutation requests must use application/json.",
      415,
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      throw new AppError(
        "INVALID_CONTENT_LENGTH",
        "The Content-Length header is invalid.",
        400,
      );
    }
    if (Number(declaredLength) > policy.maxBytes) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `The request body exceeds the ${policy.maxBytes}-byte limit.`,
        413,
      );
    }
  }

  enforceRateLimit(request, scope, policy);
}

/** Explicit cache cleanup for tests, hot reloads, and graceful teardown hooks. */
export function clearRateLimitState(): void {
  state.buckets.clear();
  state.requestsSinceCleanup = 0;
}
