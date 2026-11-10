import { publicJson } from "@/lib/sanitize";
import { authorizeOracleCommit } from "@/lib/x402";
import { generateInsight } from "@/lib/ai";
import { errorResponse, readJson } from "@/lib/errors";
import { guardMutationRequest, MUTATION_POLICIES } from "@/lib/request-guards";
import { getInsightsSnapshot } from "@/lib/services/insights";
import { getMarket } from "@/lib/services/markets";
import { emptyQuerySchema, generateInsightsSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    emptyQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const policy = MUTATION_POLICIES.generateInsight;
    guardMutationRequest(request, "insights:generate", policy);
    authorizeOracleCommit(request);
    const input = generateInsightsSchema.parse(
      await readJson(request, policy.maxBytes),
    );
    const [snapshot, market] = await Promise.all([
      getInsightsSnapshot(input.query),
      input.marketId ? getMarket(input.marketId) : Promise.resolve(undefined),
    ]);
    return publicJson(await generateInsight(snapshot, market));
  } catch (error) {
    return errorResponse(error);
  }
}
