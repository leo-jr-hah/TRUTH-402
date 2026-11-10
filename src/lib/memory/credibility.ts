import type {
  CalibrationBucket,
  Credibility,
  CredibilityBreakdown,
  LearningMetrics,
  Market,
  MemoryCalibratedProbability,
  MarketType,
  ParticipantPerformanceMemory,
  RecalledMemory,
  TRUTH402MemoryRecord,
  ProfitTrustParticipant,
  ShrinkageSkillScore,
  SkillClassification,
} from "@/types/domain";

import { percentage, round } from "@/lib/identifiers";
import { parseMemory } from "@/lib/memory/codec";
import { removeEmDashes } from "@/lib/sanitize";

export const RECENCY_HALF_LIFE_DAYS = 180;
export const CREDIBILITY_INTERVAL_LEVEL = 0.9;
export const SKILL_PRIOR_OBSERVATIONS = 10;
export const SKILL_STANDARD_DEVIATION_FLOOR = 0.05;
export const ORACLE_MEMORY_STRENGTH = 0.18;

/** Entry price is the YES probability. NO therefore uses p - y, not y - p. */
export function computeRealizedEdge(
  side: "YES" | "NO",
  entryPrice: number,
  outcomeWon: 0 | 1,
): number {
  if (
    !Number.isFinite(entryPrice) ||
    entryPrice < 0 ||
    entryPrice > 1 ||
    (outcomeWon !== 0 && outcomeWon !== 1) ||
    (side !== "YES" && side !== "NO")
  ) {
    throw new RangeError(
      "Realized edge requires a valid side, probability and binary YES outcome.",
    );
  }
  return side === "YES" ? outcomeWon - entryPrice : entryPrice - outcomeWon;
}

export function realizedEdge(correct: boolean, entryPrice: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    throw new RangeError("Entry price must be strictly between zero and one.");
  }
  return computeRealizedEdge("YES", entryPrice, correct ? 1 : 0);
}

export function observationEdge(record: ParticipantPerformanceMemory): number {
  const price =
    record.entryPrice ??
    (record.closingPrice > 0 && record.closingPrice < 1
      ? 1 - record.closingPrice
      : 0.5);
  // Recompute rather than trusting a caller-supplied derived score.
  return realizedEdge(record.correct, price);
}

export function computeShrinkageSkillScore(
  edges: number[],
  k0 = SKILL_PRIOR_OBSERVATIONS,
  sigmaMin = SKILL_STANDARD_DEVIATION_FLOOR,
): ShrinkageSkillScore {
  if (
    edges.some((edge) => !Number.isFinite(edge) || Math.abs(edge) > 1) ||
    !Number.isFinite(k0) ||
    k0 < 0 ||
    !Number.isFinite(sigmaMin) ||
    sigmaMin <= 0
  ) {
    throw new RangeError(
      "Realized edges must be finite and between minus one and one.",
    );
  }
  const n = edges.length;
  if (!n)
    return {
      meanEdge: 0,
      stdEdge: sigmaMin,
      tStat: 0,
      shrinkageFactor: 0,
      skillScore: 0,
      trustWeight: 0,
    };
  const mean = edges.reduce((sum, edge) => sum + edge, 0) / n;
  const variance =
    n > 1
      ? edges.reduce((sum, edge) => sum + (edge - mean) ** 2, 0) / (n - 1)
      : 0;
  const stdEdge = Math.max(Math.sqrt(variance), sigmaMin);
  const tStat = mean / (stdEdge / Math.sqrt(n));
  const shrinkageFactor = n / (n + k0);
  const skillScore = shrinkageFactor * tStat;
  return {
    meanEdge: mean,
    stdEdge,
    tStat,
    shrinkageFactor,
    skillScore,
    trustWeight: Math.max(0, skillScore),
  };
}

/** Compatibility view for the original TRUTH402 display API. */
export function computeShrinkageSkill(edges: number[]) {
  const score = computeShrinkageSkillScore(edges);
  return {
    meanRealizedEdge: score.meanEdge,
    shrinkageSkillScore: score.skillScore,
    // Smooth, monotone and symmetric. A bounded display index, not a probability.
    skillScore: 50 + (100 / Math.PI) * Math.atan(score.skillScore / 2),
  };
}

/** Ranks are deterministic within the supplied cohort, not global wallet ranks. */
export function computeProfitVsTrustRanking<T extends ProfitTrustParticipant>(
  participants: T[],
) {
  if (
    new Set(participants.map((entry) => entry.participantId)).size !==
      participants.length ||
    participants.some(
      (entry) => !entry.participantId || !Number.isFinite(entry.rawPnl),
    )
  ) {
    throw new RangeError(
      "Ranking requires unique participants and finite PnL.",
    );
  }
  const rows = participants.map((entry) => ({
    ...entry,
    ...computeShrinkageSkillScore(entry.edges),
    profitRank: 0,
    trustRank: 0,
    rankDelta: 0,
    classification: "emerging" as SkillClassification,
  }));
  [...rows]
    .sort(
      (a, b) =>
        b.rawPnl - a.rawPnl || a.participantId.localeCompare(b.participantId),
    )
    .forEach((entry, index) => {
      entry.profitRank = index + 1;
    });
  rows.sort(
    (a, b) =>
      b.skillScore - a.skillScore ||
      b.edges.length - a.edges.length ||
      a.participantId.localeCompare(b.participantId),
  );
  rows.forEach((entry, index) => {
    entry.trustRank = index + 1;
    entry.rankDelta = entry.profitRank - entry.trustRank;
    entry.classification =
      entry.skillScore < 0
        ? "overconfident"
        : entry.edges.length < 10 && entry.rawPnl > 0 && entry.rankDelta < 0
          ? "lucky_whale"
          : entry.edges.length >= 10 && entry.skillScore > 0
            ? "calibrated_sharp"
            : "emerging";
  });
  return rows;
}

/** Confidence is directional agreement [0,1], not a calibrated accuracy probability. */
export function computeOracleForecast(
  marketPrice: number,
  positions: Array<{ trustWeight: number; side: 1 | -1; size: number }>,
  lambda = ORACLE_MEMORY_STRENGTH,
) {
  if (
    !Number.isFinite(marketPrice) ||
    marketPrice < 0 ||
    marketPrice > 1 ||
    !Number.isFinite(lambda) ||
    lambda < 0 ||
    lambda > 1 ||
    positions.some(
      (position) =>
        !Number.isFinite(position.trustWeight) ||
        position.trustWeight < 0 ||
        !Number.isFinite(position.size) ||
        position.size < 0 ||
        (position.side !== 1 && position.side !== -1),
    )
  ) {
    throw new RangeError(
      "Oracle inputs must be finite probabilities and nonnegative position weights.",
    );
  }
  const weighted = positions.map((position) => ({
    side: position.side,
    weight: position.trustWeight * Math.log1p(position.size),
  }));
  // Scale before summing to avoid overflow without changing the ratio.
  const scale = Math.max(1, ...weighted.map((position) => position.weight));
  if (!Number.isFinite(scale))
    throw new RangeError("Oracle position weight overflow.");
  const denominator = weighted.reduce(
    (sum, position) => sum + position.weight / scale,
    0,
  );
  const direction = denominator
    ? weighted.reduce(
        (sum, position) => sum + (position.side * position.weight) / scale,
        0,
      ) / denominator
    : 0;
  const oracleProbability = Math.max(
    0.01,
    Math.min(0.99, marketPrice + lambda * direction),
  );
  return {
    oracleProbability,
    marketPrice,
    shiftDelta: oracleProbability - marketPrice,
    confidenceLevel: Math.abs(direction),
  };
}

export function participantTrustWeight(entry: Credibility): number {
  return Number.isFinite(entry.shrinkageSkillScore)
    ? Math.max(0, entry.shrinkageSkillScore)
    : 0;
}

/** Conviction is aggregated before log1p so splitting trades cannot amplify trust. */
export function computeMemoryCalibratedSignal(
  market: Market,
  leaderboard: Credibility[],
  lambda = ORACLE_MEMORY_STRENGTH,
): MemoryCalibratedProbability[] {
  const priceSum = market.outcomes.reduce(
    (sum, outcome) => sum + outcome.price,
    0,
  );
  if (
    market.status !== "open" ||
    !Number.isFinite(lambda) ||
    lambda < 0 ||
    lambda > 1 ||
    market.outcomes.length < 2 ||
    market.outcomes.length > 12 ||
    !Number.isFinite(priceSum) ||
    priceSum <= 0 ||
    market.outcomes.some((outcome) => outcome.price < 0 || outcome.price > 1)
  ) {
    throw new RangeError(
      "Oracle signals require an open market and valid probabilities.",
    );
  }
  const trust = new Map(
    leaderboard.map((entry) => [
      entry.participantId,
      participantTrustWeight(entry),
    ]),
  );
  const rows = market.outcomes.map((outcome) => {
    const conviction = new Map<string, number>();
    for (const trade of market.trades) {
      if (
        trade.outcomeId !== outcome.id ||
        !Number.isFinite(trade.amount) ||
        trade.amount <= 0
      )
        continue;
      conviction.set(
        trade.participantId,
        (conviction.get(trade.participantId) ?? 0) + trade.amount,
      );
    }
    const trustedConviction = [...conviction].reduce(
      (sum, [id, amount]) => sum + (trust.get(id) ?? 0) * Math.log1p(amount),
      0,
    );
    return {
      outcomeId: outcome.id,
      label: removeEmDashes(outcome.label),
      marketProbability: outcome.price / priceSum,
      trustedConviction,
    };
  });
  const totalTrust = rows.reduce((sum, row) => sum + row.trustedConviction, 0);
  // Binary markets use exactly p + lambda * net directional conviction.
  // For K outcomes, center the signal against the mean of the other K-1 sides.
  const probabilities = rows.map((row) =>
    Math.max(
      0.01,
      Math.min(
        0.99,
        row.marketProbability +
          (totalTrust
            ? (lambda *
                ((rows.length * row.trustedConviction) / totalTrust - 1)) /
              (rows.length - 1)
            : 0),
      ),
    ),
  );
  // Project clipping residual onto the bounded simplex. The sum remains one
  // without violating [0.01, 0.99] at either end of a multi-outcome market.
  for (let iteration = 0; iteration < rows.length; iteration += 1) {
    const residual = 1 - probabilities.reduce((sum, value) => sum + value, 0);
    if (Math.abs(residual) < 1e-14) break;
    const adjustable = probabilities.flatMap((value, index) =>
      (residual > 0 ? value < 0.99 : value > 0.01) ? [index] : [],
    );
    for (const index of adjustable)
      probabilities[index] = Math.max(
        0.01,
        Math.min(0.99, probabilities[index] + residual / adjustable.length),
      );
  }
  return rows.map((row, index) => {
    const oracleProbability = probabilities[index];
    return {
      ...row,
      oracleProbability,
      edgeDivergence: oracleProbability - row.marketProbability,
    };
  });
}

const MILLISECONDS_PER_DAY = 86_400_000;
const BETA_CONTINUED_FRACTION_EPSILON = 3e-14;
const BETA_CONTINUED_FRACTION_FLOOR = 1e-300;
const BETA_CONTINUED_FRACTION_ITERATIONS = 200;
const BETA_INVERSE_ITERATIONS = 80;
const LANCZOS_COEFFICIENTS = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012,
  9.984369578019572e-6, 1.5056327351493116e-7,
] as const;

export type CredibilityWeighting = "equal" | "recency";

interface DerivationOptions {
  weighting?: CredibilityWeighting;
  halfLifeDays?: number;
}

interface ScoreAccumulator {
  correctCount: number;
  totalCount: number;
  correctWeight: number;
  evidenceWeight: number;
}

interface WeightedObservation {
  record: ParticipantPerformanceMemory;
  weight: number;
}

const CALIBRATION_BUCKETS = [
  {
    id: "0-20",
    label: "0–19%",
    minimumConfidence: 0,
    maximumConfidence: 0.2,
  },
  {
    id: "20-40",
    label: "20–39%",
    minimumConfidence: 0.2,
    maximumConfidence: 0.4,
  },
  {
    id: "40-60",
    label: "40–59%",
    minimumConfidence: 0.4,
    maximumConfidence: 0.6,
  },
  {
    id: "60-80",
    label: "60–79%",
    minimumConfidence: 0.6,
    maximumConfidence: 0.8,
  },
  {
    id: "80-100",
    label: "80–100%",
    minimumConfidence: 0.8,
    maximumConfidence: 1,
  },
] as const;

export function betaCredibility(
  correct: number,
  total: number,
  alpha = 1,
  beta = 1,
): number {
  if (
    !Number.isInteger(correct) ||
    !Number.isInteger(total) ||
    correct < 0 ||
    total < correct ||
    !Number.isFinite(alpha) ||
    !Number.isFinite(beta) ||
    alpha <= 0 ||
    beta <= 0
  ) {
    throw new RangeError("Beta credibility inputs are outside their domain.");
  }
  return (correct + alpha) / (total + alpha + beta);
}

function logGamma(value: number): number {
  // Interval posteriors always have value >= 1, so the positive Lanczos
  // branch is sufficient and avoids a reflection path that cannot be reached.
  const shifted = value - 1;
  let series = LANCZOS_COEFFICIENTS[0];
  for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += LANCZOS_COEFFICIENTS[index] / (shifted + index);
  }
  const scale = shifted + LANCZOS_COEFFICIENTS.length - 1.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(scale) -
    scale +
    Math.log(series)
  );
}

function betaContinuedFraction(
  alpha: number,
  beta: number,
  value: number,
): number {
  const sum = alpha + beta;
  const alphaPlusOne = alpha + 1;
  const alphaMinusOne = alpha - 1;
  let c = 1;
  let d = 1 - (sum * value) / alphaPlusOne;
  if (Math.abs(d) < BETA_CONTINUED_FRACTION_FLOOR) {
    d = BETA_CONTINUED_FRACTION_FLOOR;
  }
  d = 1 / d;
  let result = d;

  for (
    let iteration = 1;
    iteration <= BETA_CONTINUED_FRACTION_ITERATIONS;
    iteration += 1
  ) {
    const doubled = 2 * iteration;
    let coefficient =
      (iteration * (beta - iteration) * value) /
      ((alphaMinusOne + doubled) * (alpha + doubled));
    d = 1 + coefficient * d;
    if (Math.abs(d) < BETA_CONTINUED_FRACTION_FLOOR) {
      d = BETA_CONTINUED_FRACTION_FLOOR;
    }
    c = 1 + coefficient / c;
    if (Math.abs(c) < BETA_CONTINUED_FRACTION_FLOOR) {
      c = BETA_CONTINUED_FRACTION_FLOOR;
    }
    d = 1 / d;
    result *= d * c;

    coefficient =
      (-(alpha + iteration) * (sum + iteration) * value) /
      ((alpha + doubled) * (alphaPlusOne + doubled));
    d = 1 + coefficient * d;
    if (Math.abs(d) < BETA_CONTINUED_FRACTION_FLOOR) {
      d = BETA_CONTINUED_FRACTION_FLOOR;
    }
    c = 1 + coefficient / c;
    if (Math.abs(c) < BETA_CONTINUED_FRACTION_FLOOR) {
      c = BETA_CONTINUED_FRACTION_FLOOR;
    }
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) <= BETA_CONTINUED_FRACTION_EPSILON) break;
  }

  return result;
}

function regularizedIncompleteBeta(
  value: number,
  alpha: number,
  beta: number,
): number {
  const factor = Math.exp(
    logGamma(alpha + beta) -
      logGamma(alpha) -
      logGamma(beta) +
      alpha * Math.log(value) +
      beta * Math.log1p(-value),
  );
  if (value < (alpha + 1) / (alpha + beta + 2)) {
    return (factor * betaContinuedFraction(alpha, beta, value)) / alpha;
  }
  return 1 - (factor * betaContinuedFraction(beta, alpha, 1 - value)) / beta;
}

function inverseRegularizedBeta(
  probability: number,
  alpha: number,
  beta: number,
): number {
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < BETA_INVERSE_ITERATIONS; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (regularizedIncompleteBeta(midpoint, alpha, beta) < probability) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }
  return (lower + upper) / 2;
}

export function betaCredibleInterval(
  correct: number,
  total: number,
  level = CREDIBILITY_INTERVAL_LEVEL,
): { lowerBound: number; upperBound: number } {
  if (
    !Number.isFinite(correct) ||
    !Number.isFinite(total) ||
    correct < 0 ||
    total < correct ||
    !Number.isFinite(level) ||
    level <= 0 ||
    level >= 1
  ) {
    throw new RangeError("Beta interval inputs are outside their domain.");
  }

  const tail = (1 - level) / 2;
  const alpha = correct + 1;
  const beta = total - correct + 1;
  return {
    lowerBound: inverseRegularizedBeta(tail, alpha, beta),
    upperBound: inverseRegularizedBeta(1 - tail, alpha, beta),
  };
}

export function uniqueRecords(
  memories: RecalledMemory[],
): TRUTH402MemoryRecord[] {
  const records = new Map<string, TRUTH402MemoryRecord>();
  for (const memory of memories) {
    const record = parseMemory(memory.text);
    if (record && !records.has(record.recordId)) {
      records.set(record.recordId, record);
    }
  }
  return [...records.values()];
}

function performanceRecords(
  records: TRUTH402MemoryRecord[],
): ParticipantPerformanceMemory[] {
  return records
    .filter(
      (record): record is ParticipantPerformanceMemory =>
        record.kind === "participant_performance",
    )
    .sort((a, b) => a.recordId.localeCompare(b.recordId));
}

function newestObservationTimestamp(
  observations: ParticipantPerformanceMemory[],
): number | null {
  let newest: number | null = null;
  for (const observation of observations) {
    const timestamp = Date.parse(observation.occurredAt);
    if (Number.isFinite(timestamp) && (newest === null || timestamp > newest)) {
      newest = timestamp;
    }
  }
  return newest;
}

export function recencyAnchorAt(
  records: TRUTH402MemoryRecord[],
): string | null {
  const timestamp = newestObservationTimestamp(performanceRecords(records));
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function weightedObservations(
  records: TRUTH402MemoryRecord[],
  options: DerivationOptions,
): WeightedObservation[] {
  const observations = performanceRecords(records);
  if (options.weighting !== "recency") {
    return observations.map((record) => ({ record, weight: 1 }));
  }

  const halfLifeDays = options.halfLifeDays ?? RECENCY_HALF_LIFE_DAYS;
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    throw new RangeError("Recency half-life must be a positive finite number.");
  }

  const anchor = newestObservationTimestamp(observations);
  if (anchor === null) return [];

  return observations.map((record) => {
    const timestamp = Date.parse(record.occurredAt);
    const ageDays = Number.isFinite(timestamp)
      ? Math.max(0, anchor - timestamp) / MILLISECONDS_PER_DAY
      : 0;
    return {
      record,
      weight: 2 ** (-ageDays / halfLifeDays),
    };
  });
}

function emptyScore(): ScoreAccumulator {
  return {
    correctCount: 0,
    totalCount: 0,
    correctWeight: 0,
    evidenceWeight: 0,
  };
}

function addObservation(
  score: ScoreAccumulator,
  correct: boolean,
  weight: number,
): void {
  score.correctCount += correct ? 1 : 0;
  score.totalCount += 1;
  score.correctWeight += correct ? weight : 0;
  score.evidenceWeight += weight;
}

function weightedBetaCredibility(correct: number, total: number): number {
  if (
    !Number.isFinite(correct) ||
    !Number.isFinite(total) ||
    correct < 0 ||
    total < correct
  ) {
    throw new RangeError(
      "Weighted credibility inputs are outside their domain.",
    );
  }
  return (correct + 1) / (total + 2);
}

function scoreBreakdown(score: ScoreAccumulator): CredibilityBreakdown | null {
  if (!score.totalCount || !score.evidenceWeight) return null;
  const interval = betaCredibleInterval(
    score.correctWeight,
    score.evidenceWeight,
  );
  return {
    correctCount: score.correctCount,
    totalCount: score.totalCount,
    accuracy: percentage(score.correctWeight / score.evidenceWeight),
    credibilityScore: percentage(
      weightedBetaCredibility(score.correctWeight, score.evidenceWeight),
    ),
    credibleInterval: {
      level: percentage(CREDIBILITY_INTERVAL_LEVEL),
      lowerBound: percentage(interval.lowerBound),
      upperBound: percentage(interval.upperBound),
    },
    evidenceWeight: round(score.evidenceWeight, 3),
  };
}

export function deriveCredibility(
  records: TRUTH402MemoryRecord[],
  options: DerivationOptions = {},
): Credibility[] {
  const observations = weightedObservations(records, options);
  const aggregate = new Map<
    string,
    {
      displayName: string;
      overall: ScoreAccumulator;
      byMarketType: Record<MarketType, ScoreAccumulator>;
      confidenceWeight: number;
      conviction: number;
      lastActiveAt: string;
      edges: number[];
      rawPnl: number;
      inferredEntryCount: number;
    }
  >();

  for (const { record, weight } of observations) {
    const current = aggregate.get(record.participantId) ?? {
      displayName: record.displayName,
      overall: emptyScore(),
      byMarketType: {
        simple: emptyScore(),
        opportunity: emptyScore(),
      },
      confidenceWeight: 0,
      conviction: 0,
      lastActiveAt: record.occurredAt,
      edges: [],
      rawPnl: 0,
      inferredEntryCount: 0,
    };
    if (
      record.occurredAt > current.lastActiveAt ||
      (record.occurredAt === current.lastActiveAt &&
        record.displayName.localeCompare(current.displayName) < 0)
    ) {
      current.displayName = record.displayName;
    }
    addObservation(current.overall, record.correct, weight);
    addObservation(
      current.byMarketType[record.marketType],
      record.correct,
      weight,
    );
    current.confidenceWeight += record.confidence * weight;
    current.conviction += record.conviction;
    const edge = observationEdge(record);
    current.edges.push(edge);
    current.rawPnl += record.conviction * edge;
    if (
      record.entryPrice === undefined ||
      record.entryPriceSource === "legacy-complement" ||
      record.entryPriceSource === "neutral"
    )
      current.inferredEntryCount += 1;
    if (record.occurredAt > current.lastActiveAt) {
      current.lastActiveAt = record.occurredAt;
    }
    aggregate.set(record.participantId, current);
  }

  const leaderboard = [...aggregate.entries()]
    .map(([participantId, value]) => {
      const overall = scoreBreakdown(value.overall);
      if (!overall) return null;
      const simple = scoreBreakdown(value.byMarketType.simple);
      const opportunity = scoreBreakdown(value.byMarketType.opportunity);
      return {
        participantId,
        displayName: value.displayName,
        ...overall,
        averageConfidence: percentage(
          value.confidenceWeight / value.overall.evidenceWeight,
        ),
        totalConviction: round(value.conviction, 2),
        marketTypes: [
          ...(opportunity ? (["opportunity"] as const) : []),
          ...(simple ? (["simple"] as const) : []),
        ] satisfies MarketType[],
        byMarketType: { simple, opportunity },
        lastActiveAt: value.lastActiveAt,
        ...computeShrinkageSkill(value.edges),
        rawPnl: value.rawPnl,
        profitRank: 0,
        trustRank: 0,
        rankDelta: 0,
        inferredEntryCount: value.inferredEntryCount,
      };
    })
    .filter((entry): entry is Credibility => entry !== null)
    .sort(
      (a, b) =>
        b.credibilityScore - a.credibilityScore ||
        b.totalCount - a.totalCount ||
        b.totalConviction - a.totalConviction ||
        a.participantId.localeCompare(b.participantId),
    );
  const ranks = new Map(
    computeProfitVsTrustRanking(
      leaderboard.map((entry) => ({
        participantId: entry.participantId,
        rawPnl: entry.rawPnl,
        edges: aggregate.get(entry.participantId)!.edges,
      })),
    ).map((entry) => [entry.participantId, entry]),
  );
  return leaderboard.map((entry) => {
    const rank = ranks.get(entry.participantId)!;
    return {
      ...entry,
      profitRank: rank.profitRank,
      trustRank: rank.trustRank,
      rankDelta: rank.rankDelta,
      classification: rank.classification,
    };
  });
}

export function deriveCalibration(
  records: TRUTH402MemoryRecord[],
  options: DerivationOptions = {},
): CalibrationBucket[] {
  const buckets = CALIBRATION_BUCKETS.map((definition) => ({
    ...definition,
    correctCount: 0,
    totalCount: 0,
    correctWeight: 0,
    evidenceWeight: 0,
    confidenceWeight: 0,
  }));

  for (const { record, weight } of weightedObservations(records, options)) {
    const bucketIndex = Math.min(
      Math.floor(record.confidence * CALIBRATION_BUCKETS.length),
      CALIBRATION_BUCKETS.length - 1,
    );
    const bucket = buckets[bucketIndex];
    bucket.correctCount += record.correct ? 1 : 0;
    bucket.totalCount += 1;
    bucket.correctWeight += record.correct ? weight : 0;
    bucket.evidenceWeight += weight;
    bucket.confidenceWeight += record.confidence * weight;
  }

  return buckets.map(
    ({ correctWeight, confidenceWeight, ...bucket }): CalibrationBucket => {
      if (!bucket.totalCount || !bucket.evidenceWeight) {
        return {
          ...bucket,
          evidenceWeight: 0,
          averageConfidence: null,
          actualAccuracy: null,
          calibrationGap: null,
        };
      }
      const averageConfidenceRatio = confidenceWeight / bucket.evidenceWeight;
      const actualAccuracyRatio = correctWeight / bucket.evidenceWeight;
      const averageConfidence = percentage(averageConfidenceRatio);
      const actualAccuracy = percentage(actualAccuracyRatio);
      return {
        ...bucket,
        evidenceWeight: round(bucket.evidenceWeight, 3),
        averageConfidence,
        actualAccuracy,
        calibrationGap: percentage(
          actualAccuracyRatio - averageConfidenceRatio,
        ),
      };
    },
  );
}

export function deriveLearningMetrics(
  memories: RecalledMemory[],
  records: TRUTH402MemoryRecord[],
): LearningMetrics {
  const resolutions = records.filter(
    (record) => record.kind === "market_resolution",
  );
  const signals = records.filter((record) => record.kind === "market_signal");
  const observations = records.filter(
    (record) => record.kind === "participant_performance",
  );
  const followed = signals.filter(
    (record) => record.sponsorFollowedSignal,
  ).length;

  return {
    memoryCount: memories.length,
    parsedMemoryCount: records.length,
    resolvedMarketCount: new Set(resolutions.map((record) => record.marketId))
      .size,
    participantObservationCount: observations.length,
    signalFollowedCount: followed,
    signalObservationCount: signals.length,
    signalAlignmentRate: signals.length
      ? percentage(followed / signals.length)
      : null,
  };
}
