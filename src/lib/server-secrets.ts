import "server-only";

import { removeEmDashes, stripUnsafeControls } from "@/lib/sanitize";

const SECRET_ENV_NAMES = [
  "MEMWAL_PRIVATE_KEY",
  "TATUM_API_KEY",
  "AGENT_ROUTER_API_KEY",
  "TRUTH402_ORACLE_ADMIN_TOKEN",
] as const;

/** Return a short provider-safe message that cannot echo configured secrets. */
export function publicProviderError(
  error: unknown,
  fallback = "External provider request failed.",
): string {
  let message = error instanceof Error ? error.message : fallback;
  for (const name of SECRET_ENV_NAMES) {
    const secret = process.env[name];
    if (secret && secret.length >= 4) {
      message = message.replaceAll(secret, "[redacted]");
    }
  }
  return removeEmDashes(
    stripUnsafeControls(
      message
        .replace(/\bBearer\s+\S+/giu, "Bearer [redacted]")
        .replace(/(authorization|x-api-key)\s*[:=]\s*\S+/giu, "$1: [redacted]"),
    ),
  ).slice(0, 500);
}
