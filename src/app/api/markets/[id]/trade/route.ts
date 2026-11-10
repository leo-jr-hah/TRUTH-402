import { publicJson } from "@/lib/sanitize";
import { authorizeOracleCommit } from "@/lib/x402";
import { verifyWalletTradeAuth } from "@/lib/wallet-auth";
import { AppError, errorResponse, readJson } from "@/lib/errors";
import { guardMutationRequest, MUTATION_POLICIES } from "@/lib/request-guards";
import { tradeMarket } from "@/lib/services/markets";
import {
  emptyQuerySchema,
  marketIdParamsSchema,
  tradeSchema,
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
    const policy = MUTATION_POLICIES.trade;
    guardMutationRequest(request, "markets:trade", policy);
    const wallet = await verifyWalletTradeAuth(request, id);
    if (!wallet) authorizeOracleCommit(request);
    const input = tradeSchema.parse(await readJson(request, policy.maxBytes));
    if (wallet && input.participantId !== wallet)
      throw new AppError(
        "WALLET_MISMATCH",
        "The trade must be placed by the signing wallet.",
        403,
      );
    return publicJson(await tradeMarket(id, input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
