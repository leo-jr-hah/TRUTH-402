import { publicJson } from "@/lib/sanitize";
import { AppError, errorResponse } from "@/lib/errors";
import { getHealthSnapshot } from "@/lib/services/health";
import { emptyQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    emptyQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const snapshot = await getHealthSnapshot();
    if (snapshot.status === "degraded") {
      return errorResponse(
        new AppError(
          "HEALTH_DEGRADED",
          "One or more integrations need attention.",
          503,
          snapshot,
        ),
      );
    }
    return publicJson(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
