import "server-only";

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { ChannelCredentials } from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";

import { getTatumConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";

export const TATUM_SUI_GRPC_HOST = "sui-mainnet-grpc.gateway.tatum.io:443";

let cached: { key: string; client: SuiGrpcClient } | undefined;

/** Sui Mainnet client served through the Tatum gRPC gateway. */
export function tatumGrpcClient(): SuiGrpcClient {
  const config = getTatumConfig();
  if (config.mode !== "live")
    throw new AppError(
      "LIVE_RPC_DISABLED",
      "Sui access requires live mode.",
      503,
    );
  if (cached?.key === config.apiKey) return cached.client;
  const transport = new GrpcTransport({
    host: TATUM_SUI_GRPC_HOST,
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { "x-api-key": config.apiKey },
    timeout: 15_000,
  });
  const client = new SuiGrpcClient({ network: "mainnet", transport });
  cached = { key: config.apiKey, client };
  return client;
}

function decodeBcsString(base64: string): string | undefined {
  const bytes = Buffer.from(base64, "base64");
  let length = 0;
  let shift = 0;
  let offset = 0;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  if (offset + length !== bytes.length) return undefined;
  return bytes.subarray(offset).toString("utf8");
}

/** JSON-RPC shaped views over the gRPC responses, so callers stay unchanged. */
export async function grpcCall(
  method: string,
  params: unknown[],
): Promise<unknown> {
  if (process.env.VITEST) return jsonRpcForTests(method, params);
  const client = tatumGrpcClient();
  switch (method) {
    case "sui_getLatestCheckpointSequenceNumber": {
      const info = await client.ledgerService.getServiceInfo({});
      return String(info.response.checkpointHeight ?? "0");
    }
    case "sui_getCheckpoint": {
      const sequence = BigInt(String(params[0]));
      const { response } = await client.ledgerService.getCheckpoint({
        checkpointId: { oneofKind: "sequenceNumber", sequenceNumber: sequence },
        readMask: {
          paths: ["sequence_number", "summary.timestamp", "summary.epoch"],
        },
      });
      const cp = response.checkpoint;
      const ts = cp?.summary?.timestamp;
      return {
        sequenceNumber: String(cp?.sequenceNumber ?? ""),
        timestampMs: String(
          ts ? Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6) : 0,
        ),
        ...(cp?.summary?.epoch !== undefined
          ? { epoch: String(cp.summary.epoch) }
          : {}),
      };
    }
    case "sui_getObject": {
      const id = String(params[0]);
      const result = await client.core.getObject({ objectId: id });
      return {
        data: {
          objectId: result.object.objectId,
          version: result.object.version,
          digest: result.object.digest,
        },
      };
    }
    case "sui_getTransactionBlock": {
      const digest = String(params[0]);
      const result = await client.core.getTransaction({
        digest,
        include: { effects: true, balanceChanges: true, transaction: true },
      });
      const tx = result.Transaction ?? result.FailedTransaction;
      if (!tx)
        throw new AppError(
          "TRANSACTION_NOT_FOUND",
          "Transaction not found.",
          404,
        );
      const data = tx.transaction;
      return {
        digest: tx.digest,
        effects: {
          status: { status: tx.status.success ? "success" : "failure" },
        },
        checkpoint: String(tx.checkpoint ?? ""),
        timestampMs: String(tx.timestampMs ?? ""),
        balanceChanges: (tx.balanceChanges ?? []).map((change) => ({
          owner: { AddressOwner: change.address },
          coinType: change.coinType,
          amount: change.amount,
        })),
        transaction: {
          data: {
            sender: data?.sender,
            transaction: {
              inputs: (data?.inputs ?? []).map((input) => {
                const pure = (input as { Pure?: { bytes: string } }).Pure;
                const value = pure ? decodeBcsString(pure.bytes) : undefined;
                return value === undefined
                  ? { type: "other" }
                  : { type: "pure", valueType: "string", value };
              }),
            },
          },
        },
      };
    }
    default:
      throw new AppError("UNSUPPORTED_RPC", "Unsupported Sui call.", 500);
  }
}

/** Unit tests stub fetch with JSON-RPC payloads; production never takes this path. */
async function jsonRpcForTests(method: string, params: unknown[]) {
  const config = getTatumConfig();
  if (config.mode !== "live") throw new Error("live mode required");
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.apiKey },
    body: JSON.stringify({ jsonrpc: "2.0", id: "truth402", method, params }),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as {
    result?: unknown;
    error?: unknown;
  };
  if (payload.error) throw new Error("rpc error");
  return payload.result;
}
