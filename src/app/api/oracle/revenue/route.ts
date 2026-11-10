import { publicJson } from "@/lib/sanitize";
import { errorResponse } from "@/lib/errors";
import { guardOracleRequest } from "@/lib/oracle-http";
import { getOracleRevenueLedger } from "@/lib/tatum";
import { authorizeOracleCommit } from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    guardOracleRequest(request, "oracle:revenue");
    authorizeOracleCommit(request);
    return publicJson(await getOracleRevenueLedger(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
