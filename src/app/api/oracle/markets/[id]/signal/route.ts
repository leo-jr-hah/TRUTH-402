import { publicJson } from "@/lib/sanitize";
import { errorResponse } from "@/lib/errors";
import { guardOracleRequest } from "@/lib/oracle-http";
import { getOracleSignal } from "@/lib/services/oracle";
import { marketIdParamsSchema } from "@/lib/validation";
import {
  createPaymentChallenge,
  paymentDigestFromRequest,
  redeemOraclePayment,
} from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardOracleRequest(request, "oracle:signal");
    const { id } = marketIdParamsSchema.parse(await context.params);
    const digest = paymentDigestFromRequest(request);
    const signal = await getOracleSignal(id);
    if (!digest) return await createPaymentChallenge(id, signal.preview);
    // Compute all fallible report work before consuming a payment.
    const paymentReceipt = await redeemOraclePayment(
      request,
      id,
      digest,
      signal.incentiveEconomics,
    );
    return publicJson(
      {
        ...signal.snapshot,
        incentiveEconomics: signal.incentiveEconomics,
        signalSource: signal.signalSource,
        preCommitmentProof: signal.preCommitmentProof,
        forecastRecord: signal.forecastRecord,
        marketPrice:
          signal.snapshot.memoryCalibratedProbabilities[0]?.marketProbability,
        oracleProbability:
          signal.snapshot.memoryCalibratedProbabilities[0]?.oracleProbability,
        shiftDelta:
          signal.snapshot.memoryCalibratedProbabilities[0]?.edgeDivergence,
        walletBreakdown: signal.snapshot.trustedBackers,
        walrusMemoryProofs: signal.snapshot.walrusEvidenceBlobs,
        suiPreCommitmentProof: signal.preCommitmentProof?.sui ?? null,
        paymentReceipt,
      },
      {
        headers: {
          "cache-control": "no-store, private",
          vary: "x-payment-digest, authorization, x-payment-invoice",
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
