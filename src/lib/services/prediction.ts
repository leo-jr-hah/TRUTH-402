import "server-only";

import { getPublicRuntimeConfig } from "@/lib/config";
import { buildPredictionCalibration } from "@/lib/memory/prediction";
import { syncTatumPredictionData } from "@/lib/tatum";
import type { PredictionCalibrationSnapshot } from "@/types/oracle";

let cache:
  | { mode: string; expiresAt: number; value: PredictionCalibrationSnapshot }
  | undefined;
let flight:
  { mode: string; promise: Promise<PredictionCalibrationSnapshot> } | undefined;

export async function getPredictionCalibration(): Promise<PredictionCalibrationSnapshot> {
  const mode = getPublicRuntimeConfig().tatumMode;
  if (cache?.mode === mode && cache.expiresAt > Date.now()) return cache.value;
  if (flight?.mode === mode) return flight.promise;
  const promise = (async () => {
    const source = await syncTatumPredictionData();
    const value = buildPredictionCalibration(
      source.traders,
      source.closedPositions,
    );
    value.ingestion = {
      closedPositions: source.closedPositions.length,
      openPositions: source.openPositions.length,
      tradeFills: source.trades.length,
      holderGroups: source.topHolders.length,
      scope:
        "At most six wallets, 50 rows per wallet endpoint, and top holders for three open markets. Open positions and trades are context, not resolved evidence.",
    };
    cache = { mode, value, expiresAt: Date.now() + 5 * 60_000 };
    return value;
  })();
  flight = { mode, promise };
  try {
    return await promise;
  } finally {
    if (flight?.promise === promise) flight = undefined;
  }
}
