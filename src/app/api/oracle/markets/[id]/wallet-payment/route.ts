import { z } from "zod";

import { errorResponse, readJson } from "@/lib/errors";
import { guardMutationRequest } from "@/lib/request-guards";
import { publicJson } from "@/lib/sanitize";
import {
  buildWalletPayment,
  confirmWalletPayment,
  executeWalletPayment,
} from "@/lib/sui-wallet-payment";
import {
  marketIdParamsSchema,
  oracleInvoiceTokenSchema,
  suiAddressSchema,
  suiDigestSchema,
} from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const base64 = z
  .string()
  .min(4)
  .max(24000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("build"),
      sender: suiAddressSchema,
      invoiceToken: oracleInvoiceTokenSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("execute"),
      bytes: base64,
      signature: base64,
      invoiceToken: oracleInvoiceTokenSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm"),
      digest: suiDigestSchema,
      invoiceToken: oracleInvoiceTokenSchema,
    })
    .strict(),
]);
const policy = { requests: 15, windowMs: 60000, maxBytes: 50000 };

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardMutationRequest(request, "oracle:wallet-payment", policy);
    const { id } = marketIdParamsSchema.parse(await context.params);
    const input = schema.parse(await readJson(request, policy.maxBytes));
    const result =
      input.action === "build"
        ? await buildWalletPayment(id, input.invoiceToken, input.sender)
        : input.action === "execute"
          ? await executeWalletPayment(
              id,
              input.invoiceToken,
              input.bytes,
              input.signature,
            )
          : await confirmWalletPayment(id, input.invoiceToken, input.digest);
    return publicJson(result, {
      headers: { "cache-control": "no-store, private" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
