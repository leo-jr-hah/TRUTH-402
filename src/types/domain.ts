import type { OracleSnapshot, SuiVerificationStamp } from "@/types/oracle";

export type MarketType = "simple" | "opportunity";

export type MarketStatus = "open" | "resolved";

export type PredictionCategory = "SPORTS" | "CRYPTO" | "MACRO" | "POLITICS";

export type SkillClassification =
  "calibrated_sharp" | "lucky_whale" | "emerging" | "overconfident";

export interface ShrinkageSkillScore {
  meanEdge: number;
  /** Sample standard deviation after applying the configured floor. */
  stdEdge: number;
  tStat: number;
  shrinkageFactor: number;
  skillScore: number;
  trustWeight: number;
}

export interface ProfitTrustParticipant {
  participantId: string;
  rawPnl: number;
  edges: number[];
}

export interface LearningRankSnapshot {
  totalCount: number;
  meanRealizedEdge: number;
  shrinkageSkillScore: number;
  rawPnl: number;
  profitRank: number;
  trustRank: number;
  rankDelta: number;
}

export interface ResolutionLearningUpdate {
  episode: "post_resolution_update";
  computedAt: string;
  provider: "demo" | "walrus";
  priorRecordIds: string[];
  changes: Array<{
    participantId: string;
    displayName: string;
    before: LearningRankSnapshot | null;
    after: LearningRankSnapshot;
  }>;
}

export type ParticipantRole = "trader" | "market_maker";

export type MemoryPublishStatus =
  "not_started" | "pending" | "confirmed" | "failed";

export interface Outcome {
  id: string;
  label: string;
  description?: string;
  submitter?: string;
  /** Aggregate LMSR quantity bought for this outcome. */
  shares: number;
  /** Current implied probability in the range 0–1. */
  price: number;
  /** Total conviction credits spent backing this outcome. */
  volume: number;
}

export interface Trade {
  id: string;
  marketId: string;
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  outcomeId: string;
  amount: number;
  shares: number;
  priceBefore: number;
  priceAfter: number;
  createdAt: string;
}

export interface MemoryReceipt {
  recordId: string;
  kind: VerdictoMemoryKind;
  status: Exclude<MemoryPublishStatus, "not_started">;
  provider: "demo" | "walrus";
  blobId?: string;
  jobId?: string;
  confirmedAt?: string;
  error?: string;
}

export interface Market {
  id: string;
  type: MarketType;
  title: string;
  description: string;
  sponsor: string;
  status: MarketStatus;
  outcomes: Outcome[];
  /** Liquidity parameter (b) for the LMSR market maker. */
  liquidity: number;
  totalVolume: number;
  trades: Trade[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  winningOutcomeId?: string;
  resolutionNote?: string;
  memoryStatus: MemoryPublishStatus;
  memoryReceipts: MemoryReceipt[];
  /** Frozen at resolution, so publication retries retain the same rank transition. */
  learningUpdate?: ResolutionLearningUpdate;
}

export type VerdictoMemoryKind =
  | "market_resolution"
  | "market_signal"
  | "participant_performance"
  | "oracle_forecast";

interface MemoryBase {
  schema: "verdicto.memory";
  /** Positive schema version; parsers accept additive future versions. */
  version: number;
  recordId: string;
  kind: VerdictoMemoryKind;
  marketId: string;
  marketType: MarketType;
  marketTitle: string;
  occurredAt: string;
  summary: string;
  category?: PredictionCategory;
  provenance?: "synthetic-demo";
}

export interface MarketResolutionMemory extends MemoryBase {
  kind: "market_resolution";
  sponsor: string;
  winningOutcomeId: string;
  winningOutcomeLabel: string;
  resolutionNote?: string;
  participantCount: number;
  totalVolume: number;
  learningUpdate?: ResolutionLearningUpdate;
}

export interface MarketSignalMemory extends MemoryBase {
  kind: "market_signal";
  signalLeaderOutcomeId: string;
  signalLeaderLabel: string;
  signalLeaderPrice: number;
  winningOutcomeId: string;
  sponsorFollowedSignal: boolean;
  preCommitSuiDigest?: string;
  closingPrices: Array<{
    outcomeId: string;
    label: string;
    price: number;
  }>;
}

export interface ParticipantPerformanceMemory extends MemoryBase {
  kind: "participant_performance";
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  predictedOutcomeId: string;
  predictedOutcomeLabel: string;
  winningOutcomeId: string;
  winningOutcomeLabel: string;
  correct: boolean;
  confidence: number;
  conviction: number;
  closingPrice: number;
  /** Probability paid for the backed outcome, not a personal forecast. */
  entryPrice?: number;
  entryPriceSource?:
    "trade-vwap" | "trade-price-before" | "legacy-complement" | "neutral";
  /** Per-share edge y - entryPrice; not ROI or a Brier score. */
  realizedEdge?: number;
  shrinkageSkillScore?: number;
  profitRank?: number;
  trustRank?: number;
  preCommitSuiDigest?: string;
  episode?: "wallet_backfill";
  baseline?: LearningRankSnapshot;
}

export type VerdictoMemoryRecord =
  | MarketResolutionMemory
  | MarketSignalMemory
  | ParticipantPerformanceMemory
  | OracleForecastMemory;

export interface OracleForecastMemory extends MemoryBase {
  kind: "oracle_forecast";
  contentHash: string;
  snapshot: OracleSnapshot;
  checkpointObservation: SuiVerificationStamp;
  /** Additive v2 fields. Confirmed legacy records are never rewritten or upgraded. */
  episode?: "pre_event_pick";
  hashVersion?: "sha256-canonical-json-v1";
  forecastHash?: string;
  suiCheckpoint?: string;
  suiTimestamp?: string;
  contentBound?: true;
}

export interface RecalledMemory {
  blobId: string;
  text: string;
  distance: number;
  createdAt?: string;
  provider: "demo" | "walrus";
}

export interface CredibilityBreakdown {
  /** Raw, unweighted evidence counts remain visible in every scoring mode. */
  correctCount: number;
  totalCount: number;
  /** Accuracy under the selected equal or recency weighting. */
  accuracy: number;
  /** Beta(1,1) posterior mean under the selected weighting. */
  credibilityScore: number;
  /** Equal-tail posterior interval, expressed on the same 0–100 scale. */
  credibleInterval: {
    level: number;
    lowerBound: number;
    upperBound: number;
  };
  /** Sum of observation weights used by accuracy and credibilityScore. */
  evidenceWeight: number;
}

export interface Credibility extends CredibilityBreakdown {
  participantId: string;
  displayName: string;
  averageConfidence: number;
  totalConviction: number;
  marketTypes: MarketType[];
  byMarketType: Record<MarketType, CredibilityBreakdown | null>;
  lastActiveAt: string;
  meanRealizedEdge: number;
  shrinkageSkillScore: number;
  /** Legacy bounded display index. Use shrinkageSkillScore for the unbounded T statistic. */
  skillScore: number;
  classification?: SkillClassification;
  /** Conviction-weighted edge proxy, not cash settlement PnL. */
  rawPnl: number;
  profitRank: number;
  trustRank: number;
  rankDelta: number;
  inferredEntryCount: number;
}

export interface MemoryCalibratedProbability {
  outcomeId: string;
  label: string;
  marketProbability: number;
  oracleProbability: number;
  edgeDivergence: number;
  trustedConviction: number;
}

export interface CalibrationBucket {
  id: string;
  label: string;
  minimumConfidence: number;
  maximumConfidence: number;
  correctCount: number;
  totalCount: number;
  evidenceWeight: number;
  averageConfidence: number | null;
  actualAccuracy: number | null;
  calibrationGap: number | null;
}

export interface RecencyWeightedCredibility {
  leaderboard: Credibility[];
  calibration: CalibrationBucket[];
  halfLifeDays: number;
  /** Newest observation in the corpus; weights are relative to this timestamp. */
  anchorAt: string | null;
}

export interface LearningMetrics {
  memoryCount: number;
  parsedMemoryCount: number;
  resolvedMarketCount: number;
  participantObservationCount: number;
  signalFollowedCount: number;
  signalObservationCount: number;
  signalAlignmentRate: number | null;
}

export interface InsightsSnapshot {
  memories: RecalledMemory[];
  records: VerdictoMemoryRecord[];
  /** Equal-weight leaderboard retained as the default and compatibility path. */
  leaderboard: Credibility[];
  calibration: CalibrationBucket[];
  recencyWeighted: RecencyWeightedCredibility;
  metrics: LearningMetrics;
  provider: "demo" | "walrus";
  generatedAt: string;
}

export interface IntegrationCheck {
  name: "Walrus Memory" | "Tatum Sui RPC" | "Agent Router";
  mode: "demo" | "live";
  status: "healthy" | "configured" | "unconfigured" | "error";
  message: string;
  latencyMs?: number;
  details?: Record<string, string | number | boolean | null>;
}

export interface HealthSnapshot {
  status: "healthy" | "degraded";
  checkedAt: string;
  integrations: IntegrationCheck[];
}
