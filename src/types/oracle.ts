import type {
  Credibility,
  MemoryCalibratedProbability,
  MemoryReceipt,
  OracleForecastMemory,
  PredictionCategory,
} from "@/types/domain";

export interface SuiVerificationStamp {
  provider: "demo" | "tatum";
  network: "sui:mainnet";
  checkpoint: string;
  timestamp: string;
  /** Exact RPC timestamp in milliseconds; optional only for older receipts. */
  timestampMs?: string;
  identifier: string;
  identifierVerified: boolean;
  verification:
    "checkpoint-observation" | "transaction-inclusion" | "object-observation";
  /** RPC observation alone cannot bind forecast content to an on-chain event. */
  contentBound: false;
  epoch?: string;
  verifiedAt?: string;
  rpcEndpoint?: string;
}

export interface SuiPaymentReceipt {
  provider: "demo" | "tatum";
  network: "sui:mainnet";
  digest: string;
  recipient: string;
  amountBaseUnits: string;
  coinType: string;
  checkpoint: string;
  timestamp: string;
  verifiedAt: string;
  latencyMs: number;
  bindingVerified?: "ptb-reference" | "time-window-and-single-use-digest";
  /** Invoice value, not the coin's base-unit credit or an exchange-rate claim. */
  invoiceAmountMicroUsdc?: string;
}

export interface OraclePaymentRecord extends SuiPaymentReceipt {
  marketId: string;
  invoiceId?: string;
  incentiveEconomics?: OracleIncentiveEconomics;
}

export interface OracleRevenueLedger {
  provider: "demo" | "tatum";
  recipient: string;
  balanceMicroUsdc: string;
  attributedRevenueMicroUsdc: string;
  entries: Array<{
    digest: string;
    amountBaseUnits: string;
    timestamp: string;
    attributed: boolean;
    incentiveEconomics?: OracleIncentiveEconomics;
  }>;
  royaltyAccounting?: {
    status: "accrual-only";
    protocolFeeMicroUsdc: string;
    backerPoolMicroUsdc: string;
    allocatedRoyaltiesMicroUsdc: string;
    unallocatedBackerPoolMicroUsdc: string;
    paidOutMicroUsdc: "0";
  };
  /** Native-SUI fallback credits are never counted as USDC revenue. */
  attributedSuiMist?: string;
  partial: boolean;
}

export interface PredictionTrader {
  provider: "demo" | "tatum";
  wallet: string;
  displayName: string;
  profitRank: number;
  volumeUsd: number;
  pnlUsd: number;
}

export interface PredictionClosedPosition {
  provider: "demo" | "tatum";
  wallet: string;
  marketId: string;
  asset: string;
  marketTitle: string;
  outcome: string;
  entryPrice: number;
  resolution: 0 | 1;
  realizedEdge: number;
  conviction: number;
  realizedPnlUsd: number;
  occurredAt: string;
  category?: PredictionCategory;
}

export interface PredictionCalibrationSnapshot {
  provider: "demo" | "tatum";
  scope: string;
  entries: Array<
    Credibility & {
      wallet: string;
      leaderboardPnlUsd: number;
      sampleRealizedPnlUsd: number;
    }
  >;
  positionCount: number;
  truncated: boolean;
  ingestion?: {
    closedPositions: number;
    openPositions: number;
    tradeFills: number;
    holderGroups: number;
    scope: string;
  };
}

export interface PredictionOpenPosition {
  provider: "demo" | "tatum";
  wallet: string;
  marketId: string;
  asset: string;
  outcome: string;
  size: number;
  price: number;
  redeemable: boolean;
}

export interface PredictionTradeFill {
  provider: "demo" | "tatum";
  wallet: string;
  marketId: string;
  asset: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  occurredAt: string;
}

export interface PredictionHolderGroup {
  marketId: string;
  asset: string;
  holders: Array<{ wallet: string; size: number; outcome: string }>;
}

export interface ForecasterRoyaltyShare {
  participantId: string;
  displayName: string;
  trustRank: number;
  profitRank: number;
  influenceWeight: number;
  sharePercent: number;
  royaltyMicroUsdc: string;
  backingRecordIds: string[];
  backingBlobIds: string[];
}

export interface OracleIncentiveEconomics {
  /** null denotes infinite KL when positive oracle mass has zero market mass. */
  klDivergenceBits: number | null;
  klDivergenceInfinite: boolean;
  maxAbsShift: number;
  estimatedEdgeBps: number;
  /** Disagreement-based heuristic, not an expected trading return. */
  estimatedAgentEvBps: number;
  queryCostMicroUsdc: "10000";
  protocolTreasuryMicroUsdc: "2000";
  forecasterPoolMicroUsdc: "8000";
  protocolFeeMicroUsdc: "2000";
  backerPoolMicroUsdc: "8000";
  unallocatedBackerPoolMicroUsdc: string;
  allocationStatus: "accrual-only";
  forecasterRoyalties: ForecasterRoyaltyShare[];
}

export interface OracleSnapshot {
  marketId: string;
  marketUpdatedAt: string;
  createdAt: string;
  memoryCalibratedProbabilities: MemoryCalibratedProbability[];
  edgeDivergence: Array<{ outcomeId: string; delta: number }>;
  trustedBackers: Credibility[];
  walrusEvidenceBlobs: Array<{
    blobId: string;
    recordId: string;
    provider: "demo" | "walrus";
  }>;
  incentiveEconomics?: OracleIncentiveEconomics;
}

export interface CanonicalForecastPayload {
  schema: "truth402.forecast";
  version: 1;
  marketId: string;
  marketUpdatedAt: string;
  capturedAt: string;
  suiCheckpoint: string;
  suiTimestamp: string;
  probabilities: MemoryCalibratedProbability[];
  trustedBackers: Credibility[];
  evidenceRecordIds: string[];
  evidenceBlobs: OracleSnapshot["walrusEvidenceBlobs"];
  /** Additive: legacy commitments without economics keep their original hash. */
  incentiveEconomics?: OracleIncentiveEconomics;
}

export interface OracleCommitment {
  modeKey: string;
  record: OracleForecastMemory;
  receipt?: MemoryReceipt;
}

export interface PreCommitmentProof {
  contentHash: string;
  forecastHash?: string;
  hashVersion?: "sha256-canonical-json-v1";
  /** Binds the snapshot and checkpoint metadata in the memory record, not on Sui. */
  contentBound: boolean;
  bindingScope: "memory-record" | "legacy-snapshot";
  recordId: string;
  blobId: string;
  provider: "demo" | "walrus";
  capturedAt: string;
  publishedAt: string;
  capturedWhileOpen: true;
  publicationBeforeResolution: boolean | null;
  sui: SuiVerificationStamp;
  assurance: string;
}

export interface OracleUnlockedPayload extends OracleSnapshot {
  signalSource: "current-estimate" | "committed-snapshot";
  preCommitmentProof: PreCommitmentProof | null;
  /** Exact structured record submitted to the memory provider; only unlocked after payment. */
  forecastRecord: OracleForecastMemory | null;
  paymentReceipt: SuiPaymentReceipt;
}

/** Public judge access is not a Sui payment and never creates a revenue receipt. */
export interface OracleSandboxPayload extends Omit<
  OracleUnlockedPayload,
  "paymentReceipt"
> {
  paymentReceipt: null;
  sandbox: {
    mode: "sponsored-sandbox";
    fundsMoved: false;
    paymentVerified: false;
    checkpoint: string;
    provider: "demo" | "tatum";
    latencyMs: number;
  };
}

/** Only the token's hash is persisted. Raw invoice tokens are private bearer secrets. */
export interface OracleInvoiceRecord {
  id: string;
  marketId: string;
  recipient: string;
  amountBaseUnits: string;
  issuedAt: string;
  expiresAt: string;
  mode: "demo" | "live";
  walletTransaction?: { sender: string; bytesHash: string };
}

export interface OracleInvoice extends OracleInvoiceRecord {
  protocol: "x402-sui-mpp";
  protocolCompatibility: "custom-sui-digest-v1";
  amountUsdc: "0.01";
  network: "sui:mainnet";
  coinType: string;
  invoiceToken: string;
  paymentReference: string;
  instructions: string;
  sandboxAvailable?: boolean;
  preview: {
    participantCount: number;
    trackedBackers?: number;
    memoryCount: number;
    preCommitCheckpoint: string | null;
    marketPrice?: number;
    preCommittedBlobId?: string | null;
    klDivergenceBits?: number | null;
    klDivergencePreview?: number | null;
    klDivergenceInfinite?: boolean;
    estimatedEdgeBps?: number;
    estimatedAgentEvBps?: number;
    topProfitVsTrustDivergencePreview: Array<{
      displayName: string;
      profitRank: number;
      trustRank: number;
      rankDelta: number;
    }>;
  };
}
