import { deriveCredibility } from "@/lib/memory/credibility";
import { createMemoryRecordId } from "@/lib/memory/record-id";
import type { ParticipantPerformanceMemory } from "@/types/domain";
import type {
  PredictionCalibrationSnapshot,
  PredictionClosedPosition,
  PredictionTrader,
} from "@/types/oracle";

/** Closed positions are an explicitly separate comparison corpus, never Walrus evidence. */
export function buildPredictionCalibration(
  traders: PredictionTrader[],
  positions: PredictionClosedPosition[],
): PredictionCalibrationSnapshot {
  const byWallet = new Map(traders.map((trader) => [trader.wallet, trader]));
  const unique = new Map<string, PredictionClosedPosition>();
  for (const position of positions) {
    if (!byWallet.has(position.wallet)) continue;
    unique.set(
      `${position.wallet}:${position.marketId}:${position.asset}`,
      position,
    );
  }
  // One observation per wallet/market; no inflated n from both outcome tokens.
  const strongest = new Map<string, PredictionClosedPosition>();
  for (const position of unique.values()) {
    const key = `${position.wallet}:${position.marketId}`;
    const previous = strongest.get(key);
    if (
      !previous ||
      position.conviction > previous.conviction ||
      (position.conviction === previous.conviction &&
        position.asset < previous.asset)
    )
      strongest.set(key, position);
  }
  const records: ParticipantPerformanceMemory[] = [...strongest.values()].map(
    (position) => ({
      schema: "verdicto.memory",
      version: 1,
      kind: "participant_performance",
      recordId: createMemoryRecordId({
        version: 1,
        kind: "participant_performance",
        marketId: position.marketId,
        subjectId: position.wallet,
      }),
      marketId: position.marketId,
      marketType: "simple",
      marketTitle: position.marketTitle,
      occurredAt: position.occurredAt,
      summary:
        "External resolved-position comparison, not a published Walrus memory.",
      participantId: position.wallet,
      displayName: byWallet.get(position.wallet)!.displayName,
      role: "trader",
      predictedOutcomeId: position.asset,
      predictedOutcomeLabel: position.outcome,
      winningOutcomeId: position.resolution === 1 ? position.asset : "opposite",
      winningOutcomeLabel:
        position.resolution === 1 ? position.outcome : "Opposite outcome",
      correct: position.resolution === 1,
      confidence: 1,
      conviction: position.conviction,
      closingPrice: position.resolution,
      entryPrice: position.entryPrice,
      entryPriceSource: "trade-vwap",
      realizedEdge: position.realizedEdge,
    }),
  );
  const scores = deriveCredibility(records);
  return {
    provider: traders[0]?.provider ?? "demo",
    scope:
      traders[0]?.provider === "tatum"
        ? "Top six CRYPTO traders, MONTH PnL (realized + unrealized). Skill uses at most 50 recent closed positions per wallet across categories. Different windows, relative cohort ranks, not lifetime or out-of-sample skill."
        : "Six synthetic wallets across Sports, Crypto, Macro and Politics. The whale nets $142,000 from one longshot win and one loss; Maya has 42 observations. This benchmark is not local Walrus evidence or a live performance claim.",
    entries: scores
      .map((score) => {
        const trader = byWallet.get(score.participantId)!;
        return {
          ...score,
          wallet: trader.wallet,
          profitRank: trader.profitRank,
          rankDelta: trader.profitRank - score.trustRank,
          classification:
            score.totalCount < 10 && trader.profitRank < score.trustRank
              ? ("lucky_whale" as const)
              : score.classification,
          leaderboardPnlUsd: trader.pnlUsd,
          sampleRealizedPnlUsd: [...unique.values()]
            .filter((position) => position.wallet === trader.wallet)
            .reduce((sum, position) => sum + position.realizedPnlUsd, 0),
        };
      })
      .sort((a, b) => a.trustRank - b.trustRank),
    positionCount: unique.size,
    truncated: traders.some(
      (trader) =>
        positions.filter((position) => position.wallet === trader.wallet)
          .length >= 50,
    ),
  };
}
