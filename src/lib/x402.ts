import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  getOraclePaymentConfig,
  getPublicRuntimeConfig,
  requiresOperator,
  judgeSandboxEnabled,
} from "@/lib/config";
import { incentiveEconomicsSchema } from "@/lib/oracle-economics";
import { AppError } from "@/lib/errors";
import { FORECAST_HASH_VERSION } from "@/lib/forecast-integrity";
import {
  parsePaymentAuthorization,
  paymentAuthorization,
} from "@/lib/payment-auth";
import { removeEmDashes } from "@/lib/sanitize";
import {
  assertOracleStorageSafety,
  consumeOraclePayment,
  findOracleInvoice,
  putOracleInvoice,
  storageMode,
} from "@/lib/store";
import { verifySuiPaymentDigest } from "@/lib/tatum";
import {
  oracleInvoiceTokenSchema,
  paymentDigestSchema,
} from "@/lib/validation";
import type {
  OracleInvoice,
  OracleInvoiceRecord,
  OracleIncentiveEconomics,
  SuiPaymentReceipt,
} from "@/types/oracle";

export function invoiceTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function paymentCredentialsFromRequest(request: Request): {
  digest: string | null;
  invoice: string | null;
  id?: string;
} {
  const direct = request.headers.get("x-payment-digest");
  const authorization = request.headers.get("authorization");
  const directInvoice = request.headers.get("x-payment-invoice");
  let parameters: Record<string, string> = {};
  try {
    if (authorization !== null)
      parameters = parsePaymentAuthorization(authorization);
    if (
      (authorization !== null && !parameters.digest) ||
      (direct !== null &&
        parameters.digest !== undefined &&
        direct !== parameters.digest) ||
      (directInvoice !== null &&
        parameters.invoice !== undefined &&
        directInvoice !== parameters.invoice) ||
      (parameters.method !== undefined && parameters.method !== "sui") ||
      (parameters.network !== undefined &&
        parameters.network !== "sui:mainnet") ||
      (parameters.intent !== undefined && parameters.intent !== "charge")
    )
      throw new Error("Conflicting credentials.");
  } catch {
    throw new AppError(
      "INVALID_PAYMENT_HEADER",
      "Use one unambiguous x-payment-digest or Authorization: Payment credential for Sui Mainnet.",
      400,
    );
  }
  const invoice = directInvoice ?? parameters.invoice ?? null;
  if (invoice !== null && !oracleInvoiceTokenSchema.safeParse(invoice).success)
    throw new AppError(
      "INVALID_PAYMENT_INVOICE",
      "Payment invoice token is invalid.",
      400,
    );
  if (
    parameters.id !== undefined &&
    (!invoice || parameters.id !== invoiceTokenHash(invoice))
  )
    throw new AppError(
      "INVALID_PAYMENT_INVOICE",
      "Payment invoice ID does not match the credential.",
      400,
    );
  const rawDigest = direct ?? parameters.digest;
  if (rawDigest === undefined || rawDigest === null)
    return { digest: null, invoice };
  const parsed = paymentDigestSchema.safeParse(rawDigest);
  if (!parsed.success)
    throw new AppError(
      "INVALID_PAYMENT_DIGEST",
      "Payment digest is invalid.",
      400,
    );
  return {
    digest: parsed.data,
    invoice,
    ...(parameters.id ? { id: parameters.id } : {}),
  };
}

export function paymentDigestFromRequest(request: Request): string | null {
  return paymentCredentialsFromRequest(request).digest;
}

export async function createPaymentChallenge(
  marketId: string,
  preview: OracleInvoice["preview"],
): Promise<Response> {
  const config = getOraclePaymentConfig();
  assertOracleStorageSafety(config.mode);
  const token = randomBytes(32).toString("base64url");
  const id = invoiceTokenHash(token);
  const now = Date.now();
  const record: OracleInvoiceRecord = {
    id,
    marketId,
    recipient: config.recipient,
    amountBaseUnits: config.amountBaseUnits,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5 * 60_000).toISOString(),
    mode: config.mode,
  };
  await putOracleInvoice(record);
  const invoice: OracleInvoice = {
    ...record,
    protocol: "x402-sui-mpp",
    protocolCompatibility: "custom-sui-digest-v1",
    amountUsdc: "0.01",
    network: "sui:mainnet",
    coinType: config.coinType,
    invoiceToken: token,
    paymentReference: id,
    instructions: removeEmDashes(
      config.mode === "demo"
        ? "Retry with a unique demo-sui-tx- digest and this invoice token. Demo settlement moves no funds."
        : 'Transfer native Sui USDC to the recipient with paymentReference as a pure string input in the same programmable transaction. Retry with Authorization: Payment method="sui", digest="...", invoice="..." or the x-payment-digest / x-payment-invoice headers. Keep invoiceToken private and off-chain. A connected wallet must approve signing; the server only prepares and submits already-signed invoice transactions.',
    ),
    sandboxAvailable: judgeSandboxEnabled(),
    preview,
  };
  return Response.json(invoice, {
    status: 402,
    headers: {
      "WWW-Authenticate": paymentAuthorization({
        method: "sui",
        intent: "charge",
        network: "sui:mainnet",
        currency: "USDC",
        amount: config.amountBaseUnits,
        recipient: config.recipient,
        id,
        invoice: token,
        invoiceToken: token,
        coinType: config.coinType,
        mode: config.mode,
        issued: record.issuedAt,
        expires: record.expiresAt,
      }),
      "X-Payment-Required": "true",
      "cache-control": "no-store, private",
      vary: "x-payment-digest, authorization, x-payment-invoice",
    },
  });
}

export async function redeemOraclePayment(
  request: Request,
  marketId: string,
  digest: string,
  incentiveEconomics?: OracleIncentiveEconomics,
): Promise<SuiPaymentReceipt> {
  const config = getOraclePaymentConfig();
  assertOracleStorageSafety(config.mode);
  if (incentiveEconomics) incentiveEconomicsSchema.parse(incentiveEconomics);
  const credentials = paymentCredentialsFromRequest(request);
  if (credentials.digest !== null && credentials.digest !== digest)
    throw new AppError(
      "INVALID_PAYMENT_HEADER",
      "Payment digest does not match the credential.",
      400,
    );
  const rawToken = credentials.invoice;
  let invoice: OracleInvoiceRecord | null = null;
  if (rawToken !== null) {
    const token = oracleInvoiceTokenSchema.safeParse(rawToken);
    if (!token.success)
      throw new AppError(
        "INVALID_PAYMENT_INVOICE",
        "Payment invoice token is invalid.",
        400,
      );
    invoice = await findOracleInvoice(invoiceTokenHash(token.data));
    if (
      !invoice ||
      invoice.marketId !== marketId ||
      invoice.recipient !== config.recipient ||
      invoice.amountBaseUnits !== config.amountBaseUnits ||
      invoice.mode !== config.mode ||
      Date.parse(invoice.expiresAt) <= Date.now()
    )
      throw new AppError(
        "INVALID_PAYMENT_INVOICE",
        "Payment invoice is missing, expired or belongs to a different resource.",
        402,
      );
  }
  if (config.mode === "live" && !invoice)
    throw new AppError(
      "PAYMENT_INVOICE_REQUIRED",
      "Request a challenge first and supply its private invoice token in Payment credentials or x-payment-invoice.",
      402,
    );
  const receipt = await verifySuiPaymentDigest(
    digest,
    config.recipient,
    config.amountBaseUnits,
    invoice
      ? {
          reference: invoice.id,
          issuedAt: invoice.issuedAt,
          expiresAt: invoice.expiresAt,
        }
      : undefined,
  );
  await consumeOraclePayment({
    ...receipt,
    marketId,
    ...(invoice ? { invoiceId: invoice.id } : {}),
    ...(incentiveEconomics ? { incentiveEconomics } : {}),
  });
  return receipt;
}

export function authorizeOracleCommit(request: Request): void {
  if (!requiresOperator()) return;
  const secret = process.env.TRUTH402_ORACLE_ADMIN_TOKEN;
  if (!secret || secret.length < 32)
    throw new AppError(
      "ORACLE_ADMIN_NOT_CONFIGURED",
      "Live operator actions require a server-side admin token of at least 32 characters.",
      503,
    );
  const supplied =
    /^Bearer (.+)$/u.exec(request.headers.get("authorization") ?? "")?.[1] ??
    "";
  const expectedHash = createHash("sha256").update(secret).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(expectedHash, suppliedHash))
    throw new AppError(
      "ORACLE_COMMIT_FORBIDDEN",
      "Only the operator can mutate live evidence or invoke protected providers.",
      403,
    );
}

export function oracleManifest() {
  const config = getOraclePaymentConfig();
  const modes = getPublicRuntimeConfig();
  return {
    name: "TRUTH-402",
    version: "1.0.0",
    protocol: "x402-sui-mpp",
    mode: config.mode,
    runtime: {
      memoryMode: modes.memoryMode,
      tatumMode: modes.tatumMode,
      aiMode: modes.aiMode,
      storageMode: storageMode(),
      mainnetWrites: process.env.TRUTH402_ENABLE_MAINNET_WRITES === "true",
    },
    compatibility: {
      profile: "custom-sui-digest-v1",
      standardX402V2: false,
      standardMppCredential: false,
      automaticClientSupport:
        "Requires a custom adapter. No suimpp, t2000 or facilitator interoperability has been certified.",
    },
    payment: {
      network: "sui:mainnet",
      currency: "USDC",
      coinType: config.coinType,
      amountBaseUnits: config.amountBaseUnits,
      recipient: config.recipient,
      digestHeader: "x-payment-digest",
      alternateAuthorization:
        'Payment method="sui", digest="<digest>", invoice="<invoiceToken>"',
      challengeHeader: "WWW-Authenticate",
      credentialParameters: ["digest", "invoice", "method", "id", "network"],
      invoiceHeader: "x-payment-invoice",
      liveBinding:
        process.env.TRUTH402_REQUIRE_STRICT_PTB_BINDING === "false"
          ? "Secret invoice token, settlement within issuedAt minus 60 seconds to expiresAt, single-use digest; PTB reference preferred"
          : "Secret invoice token plus its SHA-256 reference in a pure string PTB input",
      replayPolicy:
        "Single use, no idempotent replay. All successful redemptions consume the digest.",
      storage:
        "Live requires explicit single-instance durable file storage. Serverless live redemption is disabled.",
    },
    forecast: {
      methodology: "Fixed-pseudocount shrinkage of per-share realized edge",
      k0: 10,
      sigmaMin: 0.05,
      lambda: 0.18,
      contentBinding: true,
      bindingScope: "memory-record",
      hashVersion: FORECAST_HASH_VERSION,
      onChainContentBinding: false,
      publicPreview:
        "Public pages expose current estimates in either provider mode. Payment unlocks the detailed report and proof bundle, not exclusive access to public probabilities.",
    },
    endpoints: {
      signal: "/api/oracle/markets/{id}/signal",
      commit: "/api/oracle/markets/{id}/commit",
      calibration: "/api/oracle/calibration",
      revenue: "/api/oracle/revenue",
    },
    openapi: {
      openapi: "3.1.0",
      info: { title: "TRUTH402 TRUTH-402 Oracle", version: "1.0.0" },
      paths: {
        "/api/oracle/markets/{id}/signal": {
          get: {
            operationId: "queryOracleSignal",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "x-payment-digest",
                in: "header",
                schema: { type: "string" },
              },
              {
                name: "x-payment-invoice",
                in: "header",
                schema: { type: "string" },
              },
              {
                name: "Authorization",
                in: "header",
                schema: { type: "string" },
                description:
                  'Payment method="sui", digest="...", invoice="..."',
              },
            ],
            responses: {
              "200": { description: "Unlocked snapshot and verified receipt" },
              "402": {
                description: "Invoice challenge or failed payment verification",
              },
              "409": { description: "Digest already redeemed" },
            },
          },
        },
        "/api/oracle/markets/{id}/commit": {
          post: {
            operationId: "commitOracleSnapshot",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { identifier: { type: "string" } },
                    additionalProperties: false,
                  },
                },
              },
            },
            responses: {
              "200": {
                description:
                  "Frozen snapshot receipt; checkpoint observation is not an on-chain content proof",
              },
              "403": { description: "Live operator authentication required" },
            },
          },
        },
      },
    },
  };
}
