import { publicJson } from "@/lib/sanitize";
import { authorizeOracleCommit } from "@/lib/x402";
import { getPublicRuntimeConfig } from "@/lib/config";
import { errorResponse, readJson } from "@/lib/errors";
import { guardMutationRequest, MUTATION_POLICIES } from "@/lib/request-guards";
import { resolveMarket } from "@/lib/services/markets";
import {
  emptyQuerySchema,
  marketIdParamsSchema,
  resolveMarketSchema,
} from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = marketIdParamsSchema.parse(await context.params);
    emptyQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const policy = MUTATION_POLICIES.resolve;
    guardMutationRequest(request, "markets:resolve", policy);
    authorizeOracleCommit(request);
    const input = resolveMarketSchema.parse(
      await readJson(request, policy.maxBytes),
    );
    const market = await resolveMarket(id, input);
    const targetProvider =
      getPublicRuntimeConfig().memoryMode === "live" ? "walrus" : "demo";
    const targetReceipts = market.memoryReceipts.filter(
      (receipt) => receipt.provider === targetProvider,
    );
    return publicJson({
      market,
      memory: {
        status: market.memoryStatus,
        provider: targetProvider,
        confirmed: targetReceipts.filter(
          (receipt) => receipt.status === "confirmed",
        ).length,
        failed: targetReceipts.filter((receipt) => receipt.status === "failed")
          .length,
        receipts: targetReceipts,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
