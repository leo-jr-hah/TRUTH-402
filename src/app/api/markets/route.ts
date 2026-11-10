import { publicJson } from "@/lib/sanitize";
import { authorizeOracleCommit } from "@/lib/x402";
import { errorResponse, readJson } from "@/lib/errors";
import { guardMutationRequest, MUTATION_POLICIES } from "@/lib/request-guards";
import { createMarket, getMarkets } from "@/lib/services/markets";
import {
  createMarketSchema,
  emptyQuerySchema,
  marketListQuerySchema,
} from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = marketListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const markets = await getMarkets(query);
    return publicJson({ markets });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    emptyQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const policy = MUTATION_POLICIES.createMarket;
    guardMutationRequest(request, "markets:create", policy);
    authorizeOracleCommit(request);
    const input = createMarketSchema.parse(
      await readJson(request, policy.maxBytes),
    );
    const market = await createMarket(input);
    return publicJson({ market }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
