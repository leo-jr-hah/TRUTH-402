import { z } from "zod";

import { judgeSandboxEnabled } from "@/lib/config";
import { AppError, errorResponse, readJson } from "@/lib/errors";
import { guardOracleRequest } from "@/lib/oracle-http";
import { publicJson } from "@/lib/sanitize";
import { getOracleSignal } from "@/lib/services/oracle";
import { activeWalletInvoice } from "@/lib/sui-wallet-payment";
import { consumeOracleSandboxInvoice } from "@/lib/store";
import { checkTatumSui } from "@/lib/tatum";
import {
  marketIdParamsSchema,
  oracleInvoiceTokenSchema,
} from "@/lib/validation";
import type { OracleSandboxPayload } from "@/types/oracle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardOracleRequest(request, "oracle:judge-sandbox");
    if (
      !judgeSandboxEnabled() ||
      request.headers.get("x-oracle-ui-relayer") !== "sponsored"
    )
      throw new AppError(
        "JUDGE_SANDBOX_DISABLED",
        "Public judge sandbox access is not enabled. A client header alone cannot authorize settlement.",
        403,
      );
    const { id } = marketIdParamsSchema.parse(await context.params);
    const { invoiceToken } = z
      .object({ invoiceToken: oracleInvoiceTokenSchema })
      .strict()
      .parse(await readJson(request, 2048));
    const invoice = await activeWalletInvoice(id, invoiceToken);
    const [signal, checkpoint] = await Promise.all([
      getOracleSignal(id),
      checkTatumSui(),
    ]);
    if (checkpoint.mode === "live" && checkpoint.status !== "healthy")
      throw new AppError(
        "SANDBOX_CHECKPOINT_FAILED",
        "Tatum Mainnet checkpoint observation failed. No payment was attempted.",
        502,
      );
    const payload: OracleSandboxPayload = {
      ...signal.snapshot,
      incentiveEconomics: signal.incentiveEconomics,
      signalSource: signal.signalSource,
      preCommitmentProof: signal.preCommitmentProof,
      forecastRecord: signal.forecastRecord,
      paymentReceipt: null,
      sandbox: {
        mode: "sponsored-sandbox",
        fundsMoved: false,
        paymentVerified: false,
        checkpoint:
          checkpoint.mode === "live"
            ? String(checkpoint.details?.latestCheckpoint)
            : "402000000",
        provider: checkpoint.mode === "live" ? "tatum" : "demo",
        latencyMs: checkpoint.latencyMs ?? 0,
      },
    };
    await consumeOracleSandboxInvoice(invoice.id, id);
    return publicJson(payload, {
      headers: {
        "cache-control": "no-store, private",
        "x-oracle-access": "sponsored-sandbox-not-a-payment",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
