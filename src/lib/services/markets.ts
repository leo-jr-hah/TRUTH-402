import "server-only";

import { AppError } from "@/lib/errors";
import { slugifyParticipant } from "@/lib/identifiers";
import { applyBuy } from "@/lib/market-maker";
import {
  buildResolutionMemories,
  enrichPerformanceRecords,
} from "@/lib/memory/codec";
import { deriveCredibility } from "@/lib/memory/credibility";
import { resolutionRankChanges } from "@/lib/memory/rank-update";
import { getMemoryProvider, type MemoryProvider } from "@/lib/memory/provider";
import { publicProviderError } from "@/lib/server-secrets";
import {
  getInsightsSnapshot,
  invalidateInsightsCache,
} from "@/lib/services/insights";
import {
  findMarket,
  insertMarket,
  listMarkets,
  updateMarket,
} from "@/lib/store";
import type {
  CreateMarketInput,
  ResolveMarketInput,
  TradeInput,
} from "@/lib/validation";
import type { Market, MemoryReceipt, Outcome, Trade } from "@/types/domain";

function marketId(title: string): string {
  const slug = slugifyParticipant(title).slice(0, 40) || "decision";
  return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function getMarkets(filters?: {
  status?: "open" | "resolved";
  type?: "simple" | "opportunity";
}): Promise<Market[]> {
  const markets = await listMarkets();
  return markets.filter(
    (market) =>
      (!filters?.status || market.status === filters.status) &&
      (!filters?.type || market.type === filters.type),
  );
}

export async function getMarket(id: string): Promise<Market> {
  const market = await findMarket(id);
  if (!market) throw new AppError("MARKET_NOT_FOUND", "Market not found.", 404);
  return market;
}

export async function createMarket(input: CreateMarketInput): Promise<Market> {
  const now = new Date().toISOString();
  const id = marketId(input.title);
  const price = 1 / input.outcomes.length;
  const outcomes: Outcome[] = input.outcomes.map((outcome, index) => ({
    id: `${id}-o${index + 1}`,
    label: outcome.label,
    description: outcome.description || undefined,
    submitter:
      input.type === "opportunity" ? outcome.submitter || undefined : undefined,
    shares: 0,
    price,
    volume: 0,
  }));

  return insertMarket({
    id,
    type: input.type,
    title: input.title,
    description: input.description,
    sponsor: input.sponsor,
    status: "open",
    outcomes,
    liquidity: input.liquidity,
    totalVolume: 0,
    trades: [],
    tags: [...new Set(input.tags.map((tag) => tag.toLocaleLowerCase()))],
    createdAt: now,
    updatedAt: now,
    memoryStatus: "not_started",
    memoryReceipts: [],
  });
}

export async function tradeMarket(
  id: string,
  input: TradeInput,
): Promise<{ market: Market; trade: Trade }> {
  let executedTrade: Trade | undefined;
  const market = await updateMarket(id, (current) => {
    if (current.status !== "open") {
      throw new AppError(
        "MARKET_CLOSED",
        "Resolved markets no longer accept positions.",
        409,
      );
    }

    const purchase = applyBuy(
      current.outcomes,
      input.outcomeId,
      input.amount,
      current.liquidity,
    );
    const createdAt = new Date().toISOString();
    executedTrade = {
      id: crypto.randomUUID(),
      marketId: current.id,
      participantId:
        input.participantId || slugifyParticipant(input.displayName),
      displayName: input.displayName,
      role: input.role,
      outcomeId: input.outcomeId,
      amount: input.amount,
      shares: purchase.shares,
      priceBefore: purchase.priceBefore,
      priceAfter: purchase.priceAfter,
      createdAt,
    };

    return {
      ...current,
      outcomes: purchase.outcomes,
      trades: [...current.trades, executedTrade],
      totalVolume: current.totalVolume + input.amount,
      updatedAt: createdAt,
    };
  });

  if (!executedTrade) {
    throw new AppError("TRADE_FAILED", "The position was not recorded.", 500);
  }
  return { market, trade: executedTrade };
}

function mergeReceipts(
  existing: MemoryReceipt[],
  next: MemoryReceipt[],
): MemoryReceipt[] {
  const receiptKey = (receipt: MemoryReceipt) =>
    `${receipt.provider}:${receipt.recordId}`;
  const merged = new Map(
    existing.map((receipt) => [receiptKey(receipt), receipt]),
  );
  for (const receipt of next) merged.set(receiptKey(receipt), receipt);
  return [...merged.values()];
}

async function publishResolutionMemories(
  market: Market,
  provider: MemoryProvider,
): Promise<Market> {
  const targetProvider = provider.mode === "live" ? "walrus" : "demo";
  const records = buildResolutionMemories(market);
  const confirmed = new Set(
    market.memoryReceipts
      .filter(
        (receipt) =>
          receipt.status === "confirmed" && receipt.provider === targetProvider,
      )
      .map((receipt) => receipt.recordId),
  );
  const receipts: MemoryReceipt[] = [];

  for (const record of records) {
    if (confirmed.has(record.recordId)) continue;
    try {
      receipts.push(await provider.remember(record));
    } catch (error) {
      receipts.push({
        recordId: record.recordId,
        kind: record.kind,
        status: "failed",
        provider: provider.mode === "live" ? "walrus" : "demo",
        error: publicProviderError(error, "Memory write failed."),
      });
    }
  }

  const updated = await updateMarket(market.id, (current) => {
    const memoryReceipts = mergeReceipts(current.memoryReceipts, receipts);
    const expected = new Set(records.map((record) => record.recordId));
    const confirmedCount = memoryReceipts.filter(
      (receipt) =>
        expected.has(receipt.recordId) &&
        receipt.status === "confirmed" &&
        receipt.provider === targetProvider,
    ).length;

    return {
      ...current,
      memoryReceipts,
      memoryStatus:
        confirmedCount === expected.size
          ? "confirmed"
          : receipts.some((receipt) => receipt.status === "failed")
            ? "failed"
            : "pending",
      updatedAt: new Date().toISOString(),
    };
  });
  invalidateInsightsCache();
  return updated;
}

export async function resolveMarket(
  id: string,
  input: ResolveMarketInput,
  options: { memoryProvider?: MemoryProvider } = {},
): Promise<Market> {
  const provider = options.memoryProvider ?? getMemoryProvider();
  const targetProvider = provider.mode === "live" ? "walrus" : "demo";
  const initial = await getMarket(id);
  // Load the published corpus before locking the transition. New performance is
  // compared with this explicit record set, not an opaque mutable score cache.
  const corpus = initial.status === "open" ? await getInsightsSnapshot() : null;
  const history = corpus
    ? enrichPerformanceRecords(
        corpus.records.filter((record) => record.marketId !== id),
        await listMarkets(),
      )
    : [];
  const previousRanks = deriveCredibility(history);
  const resolved = await updateMarket(id, (current) => {
    if (current.status === "resolved") {
      if (current.winningOutcomeId !== input.winningOutcomeId) {
        throw new AppError(
          "RESOLUTION_CONFLICT",
          "This market was already resolved to a different outcome.",
          409,
        );
      }
      const expected = buildResolutionMemories(current);
      const confirmedForTarget = expected.every((record) =>
        current.memoryReceipts.some(
          (receipt) =>
            receipt.recordId === record.recordId &&
            receipt.status === "confirmed" &&
            receipt.provider === targetProvider,
        ),
      );
      if (confirmedForTarget) {
        return { ...current, memoryStatus: "confirmed" };
      }
      return { ...current, memoryStatus: "pending" };
    }

    if (
      !current.outcomes.some((outcome) => outcome.id === input.winningOutcomeId)
    ) {
      throw new AppError(
        "OUTCOME_NOT_FOUND",
        "The selected winning outcome does not belong to this market.",
        422,
      );
    }

    const now = new Date().toISOString();
    const next: Market = {
      ...current,
      status: "resolved",
      winningOutcomeId: input.winningOutcomeId,
      resolutionNote: input.resolutionNote,
      resolvedAt: now,
      updatedAt: now,
      memoryStatus: "pending",
    };
    const after = deriveCredibility([
      ...history,
      ...buildResolutionMemories(next),
    ]);
    next.learningUpdate = {
      episode: "post_resolution_update",
      computedAt: now,
      provider: targetProvider,
      priorRecordIds: history
        .filter((record) => record.kind === "participant_performance")
        .map((record) => record.recordId)
        .sort(),
      changes: resolutionRankChanges(previousRanks, after),
    };
    return next;
  });
  // The sponsor decision is durably committed before any external write. Cache
  // invalidation cannot roll it back, and every publication failure is recorded
  // afterward as a retryable receipt.
  invalidateInsightsCache();

  const targetIsComplete = buildResolutionMemories(resolved).every((record) =>
    resolved.memoryReceipts.some(
      (receipt) =>
        receipt.recordId === record.recordId &&
        receipt.status === "confirmed" &&
        receipt.provider === targetProvider,
    ),
  );
  if (targetIsComplete) {
    return resolved;
  }
  return publishResolutionMemories(resolved, provider);
}
