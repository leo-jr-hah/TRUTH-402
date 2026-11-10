import { publicJson } from "@/lib/sanitize";
import { errorResponse } from "@/lib/errors";
import { getMarket } from "@/lib/services/markets";
import { emptyQuerySchema, marketIdParamsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = marketIdParamsSchema.parse(await context.params);
    emptyQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return publicJson({ market: await getMarket(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
