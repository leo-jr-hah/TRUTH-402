import type {
  Credibility,
  LearningRankSnapshot,
  ResolutionLearningUpdate,
} from "@/types/domain";

export function learningRankSnapshot(entry: Credibility): LearningRankSnapshot {
  return {
    totalCount: entry.totalCount,
    meanRealizedEdge: entry.meanRealizedEdge,
    shrinkageSkillScore: entry.shrinkageSkillScore,
    rawPnl: entry.rawPnl,
    profitRank: entry.profitRank,
    trustRank: entry.trustRank,
    rankDelta: entry.rankDelta,
  };
}

export function resolutionRankChanges(
  before: Credibility[],
  after: Credibility[],
): ResolutionLearningUpdate["changes"] {
  const previous = new Map(before.map((entry) => [entry.participantId, entry]));
  return [...after]
    .sort((a, b) => a.trustRank - b.trustRank)
    .map((entry) => ({
      participantId: entry.participantId,
      displayName: entry.displayName,
      before: previous.has(entry.participantId)
        ? learningRankSnapshot(previous.get(entry.participantId)!)
        : null,
      after: learningRankSnapshot(entry),
    }));
}
