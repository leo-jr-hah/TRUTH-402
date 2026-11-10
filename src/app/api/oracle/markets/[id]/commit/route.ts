import { publicJson } from "@/lib/sanitize";
import { errorResponse, readJsonBodyWithLimit } from "@/lib/errors";
import { guardOracleRequest, ORACLE_REQUEST_POLICY } from "@/lib/oracle-http";
import { commitOracleForecast } from "@/lib/services/oracle";
import { marketIdParamsSchema, oracleCommitSchema } from "@/lib/validation";
import { authorizeOracleCommit } from "@/lib/x402";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardOracleRequest(request, "oracle:commit");
    authorizeOracleCommit(request);
    const { id } = marketIdParamsSchema.parse(await context.params);
    const input = oracleCommitSchema.parse(
      await readJsonBodyWithLimit(request, ORACLE_REQUEST_POLICY.maxBytes),
    );
    const result = await commitOracleForecast(id, input.identifier);
    // The free commitment endpoint exposes receipts, not the paid report.
    return publicJson(
      { preCommitmentProof: result.preCommitmentProof },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
