import { publicJson } from "@/lib/sanitize";
import { errorResponse } from "@/lib/errors";
import { getInsightsSnapshot } from "@/lib/services/insights";
import { insightsQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = insightsQuerySchema.parse(
      Object.fromEntries(url.searchParams),
    );
    return publicJson(await getInsightsSnapshot(input.query, input.limit));
  } catch (error) {
    return errorResponse(error);
  }
}
