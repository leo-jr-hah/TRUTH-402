import "server-only";

import { AppError } from "@/lib/errors";
import { enforceRateLimit, guardMutationRequest } from "@/lib/request-guards";
import { emptyQuerySchema } from "@/lib/validation";

export const ORACLE_REQUEST_POLICY = {
  maxBytes: 2048,
  requests: 30,
  windowMs: 60_000,
} as const;

export function guardOracleRequest(request: Request, scope: string): void {
  emptyQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  for (const name of [
    "authorization",
    "x-payment-digest",
    "x-payment-invoice",
  ]) {
    if (
      (request.headers.get(name)?.length ?? 0) >
      (name === "authorization" ? 2048 : 256)
    )
      throw new AppError(
        "PAYMENT_HEADER_TOO_LARGE",
        "Payment headers exceed the allowed length.",
        400,
      );
  }
  if (request.method === "POST") {
    guardMutationRequest(request, scope, ORACLE_REQUEST_POLICY);
  } else {
    if (
      request.body ||
      (request.headers.has("content-length") &&
        request.headers.get("content-length") !== "0")
    )
      throw new AppError(
        "UNEXPECTED_REQUEST_BODY",
        "Oracle GET requests must not contain a body.",
        400,
      );
    enforceRateLimit(request, scope, ORACLE_REQUEST_POLICY);
  }
}
