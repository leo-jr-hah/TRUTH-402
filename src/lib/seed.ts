import liveMarkets from "@/lib/live-markets.json";
import { applyBuy } from "@/lib/market-maker";
import {
  buildResolutionMemories,
  enrichPerformanceRecords,
  parseMemory,
  serializeMemory,
} from "@/lib/memory/codec";
import { deriveCredibility } from "@/lib/memory/credibility";
import { learningRankSnapshot } from "@/lib/memory/rank-update";
import type {
  Market,
  MarketType,
  Outcome,
  ParticipantRole,
  RecalledMemory,
  Trade,
  TRUTH402MemoryKind,
} from "@/types/domain";
import type {
  OraclePaymentRecord,
  OracleInvoiceRecord,
  OracleCommitment,
  PredictionClosedPosition,
  PredictionTrader,
} from "@/types/oracle";

export interface TRUTH402Database {
  version: 1;
  markets: Market[];
  demoMemories: RecalledMemory[];
  insightCache: Record<string, { content: string; createdAt: string }>;
  oraclePaymentReceipts?: OraclePaymentRecord[];
  oracleInvoices?: OracleInvoiceRecord[];
  oracleCommitments?: OracleCommitment[];
}

interface SeedOutcome {
  label: string;
  description?: string;
  submitter?: string;
}

interface SeedTrade {
  participantId: string;
  displayName: string;
  outcome: number;
  amount: number;
  role?: ParticipantRole;
  at: string;
}

function outcomes(marketId: string, values: SeedOutcome[]): Outcome[] {
  const initialPrice = 1 / values.length;
  return values.map((value, index) => ({
    id: `${marketId}-o${index + 1}`,
    label: value.label,
    description: value.description,
    submitter: value.submitter,
    shares: 0,
    price: initialPrice,
    volume: 0,
  }));
}

function makeMarket(input: {
  id: string;
  type: MarketType;
  title: string;
  description: string;
  sponsor: string;
  outcomes: SeedOutcome[];
  tags: string[];
  createdAt: string;
  liquidity?: number;
}): Market {
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    description: input.description,
    sponsor: input.sponsor,
    status: "open",
    outcomes: outcomes(input.id, input.outcomes),
    liquidity: input.liquidity ?? 250,
    totalVolume: 0,
    trades: [],
    tags: input.tags,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    memoryStatus: "not_started",
    memoryReceipts: [],
  };
}

function addTrades(market: Market, values: SeedTrade[]): Market {
  let next = structuredClone(market);
  for (const [index, value] of values.entries()) {
    const outcome = next.outcomes[value.outcome];
    const purchase = applyBuy(
      next.outcomes,
      outcome.id,
      value.amount,
      next.liquidity,
    );
    const trade: Trade = {
      id: `${market.id}-t${index + 1}`,
      marketId: market.id,
      participantId: value.participantId,
      displayName: value.displayName,
      role: value.role ?? "trader",
      outcomeId: outcome.id,
      amount: value.amount,
      shares: purchase.shares,
      priceBefore: purchase.priceBefore,
      priceAfter: purchase.priceAfter,
      createdAt: value.at,
    };
    next = {
      ...next,
      outcomes: purchase.outcomes,
      trades: [...next.trades, trade],
      totalVolume: next.totalVolume + value.amount,
      updatedAt: value.at,
    };
  }
  return next;
}

function resolveSeed(
  market: Market,
  winnerIndex: number,
  resolutionNote: string,
  resolvedAt: string,
): Market {
  return {
    ...market,
    status: "resolved",
    winningOutcomeId: market.outcomes[winnerIndex].id,
    resolutionNote,
    resolvedAt,
    updatedAt: resolvedAt,
    memoryStatus: "confirmed",
  };
}

function seedMarkets(): Market[] {
  if (process.env.VITEST === undefined && liveMarkets.markets.length > 0) {
    const createdAt = new Date().toISOString();
    return liveMarkets.markets.map((liveMarket) => {
      const market = makeMarket({
        id: liveMarket.id,
        type: "simple",
        title: liveMarket.title,
        description: liveMarket.description,
        sponsor: "Live markets",
        outcomes: [{ label: "Yes" }, { label: "No" }],
        tags: [liveMarket.category],
        createdAt,
      });
      return {
        ...market,
        closesAt: liveMarket.closesAt,
        outcomes: market.outcomes.map((outcome, index) => ({
          ...outcome,
          price: index === 0 ? liveMarket.yesPrice : 1 - liveMarket.yesPrice,
        })),
      };
    });
  }

  const feature = resolveSeed(
    addTrades(
      makeMarket({
        id: "mkt-feature-q4",
        type: "simple",
        title: "Which capability should ship in the Q4 workspace?",
        description:
          "The product council is choosing the single capability that should receive the final Q4 engineering slot.",
        sponsor: "Northstar Product Council",
        outcomes: [
          {
            label: "Team analytics",
            description: "Shared adoption and activation reporting.",
          },
          {
            label: "Offline mode",
            description: "Read and edit priority records without connectivity.",
          },
          {
            label: "Audit exports",
            description: "Signed, regulator-ready activity exports.",
          },
        ],
        tags: ["product", "roadmap"],
        createdAt: "2026-09-28T09:00:00.000Z",
      }),
      [
        {
          participantId: "maya",
          displayName: "Maya Chen",
          outcome: 0,
          amount: 180,
          at: "2026-09-29T10:00:00.000Z",
        },
        {
          participantId: "jon",
          displayName: "Jon Bell",
          outcome: 2,
          amount: 90,
          at: "2026-09-30T12:00:00.000Z",
        },
        {
          participantId: "amina",
          displayName: "Amina Yusuf",
          outcome: 0,
          amount: 260,
          role: "market_maker",
          at: "2026-10-01T08:30:00.000Z",
        },
        {
          participantId: "leo",
          displayName: "Leo Park",
          outcome: 1,
          amount: 120,
          at: "2026-10-02T14:00:00.000Z",
        },
        {
          participantId: "jon",
          displayName: "Jon Bell",
          outcome: 0,
          amount: 75,
          at: "2026-10-03T11:00:00.000Z",
        },
      ],
    ),
    0,
    "Team analytics had the strongest validated customer pull and fit the available delivery window.",
    "2026-10-04T16:00:00.000Z",
  );

  const vendor = resolveSeed(
    addTrades(
      makeMarket({
        id: "mkt-support-vendor",
        type: "opportunity",
        title: "Select our customer-support automation partner",
        description:
          "Operations invited shortlisted vendors to compete on deployment speed, security posture, and total cost of ownership.",
        sponsor: "Atlas Operations",
        outcomes: [
          {
            label: "HelioDesk",
            submitter: "HelioDesk",
            description: "Fast deployment with native CRM workflows.",
          },
          {
            label: "Relay AI",
            submitter: "Relay AI",
            description: "Strong multilingual models and analytics.",
          },
          {
            label: "Kindred Support",
            submitter: "Kindred Support",
            description: "Enterprise controls and human escalation.",
          },
          {
            label: "In-house build",
            submitter: "Atlas Platform",
            description: "Build on the existing internal stack.",
          },
        ],
        tags: ["vendor", "operations"],
        createdAt: "2026-10-01T09:00:00.000Z",
        liquidity: 300,
      }),
      [
        {
          participantId: "amina",
          displayName: "Amina Yusuf",
          outcome: 2,
          amount: 210,
          at: "2026-10-02T09:00:00.000Z",
        },
        {
          participantId: "sora",
          displayName: "Sora Malik",
          outcome: 1,
          amount: 175,
          at: "2026-10-03T10:00:00.000Z",
        },
        {
          participantId: "maya",
          displayName: "Maya Chen",
          outcome: 2,
          amount: 160,
          at: "2026-10-04T13:00:00.000Z",
        },
        {
          participantId: "jon",
          displayName: "Jon Bell",
          outcome: 0,
          amount: 95,
          at: "2026-10-05T08:00:00.000Z",
        },
        {
          participantId: "leo",
          displayName: "Leo Park",
          outcome: 2,
          amount: 240,
          role: "market_maker",
          at: "2026-10-06T15:00:00.000Z",
        },
      ],
    ),
    2,
    "Kindred Support passed the security review and offered the best escalation workflow during the pilot.",
    "2026-10-08T17:00:00.000Z",
  );

  const expansion = resolveSeed(
    addTrades(
      makeMarket({
        id: "mkt-expansion-2027",
        type: "simple",
        title: "Where should the field team open its 2027 hub?",
        description:
          "Leadership is deciding which region gets the next customer-success hub based on pipeline quality and hiring access.",
        sponsor: "Verdant Growth Team",
        outcomes: [
          { label: "Singapore" },
          { label: "Toronto" },
          { label: "Lisbon" },
        ],
        tags: ["strategy", "expansion"],
        createdAt: "2026-10-06T09:00:00.000Z",
      }),
      [
        {
          participantId: "maya",
          displayName: "Maya Chen",
          outcome: 0,
          amount: 140,
          at: "2026-10-07T10:00:00.000Z",
        },
        {
          participantId: "sora",
          displayName: "Sora Malik",
          outcome: 2,
          amount: 220,
          at: "2026-10-08T12:00:00.000Z",
        },
        {
          participantId: "amina",
          displayName: "Amina Yusuf",
          outcome: 2,
          amount: 190,
          at: "2026-10-09T14:00:00.000Z",
        },
        {
          participantId: "jon",
          displayName: "Jon Bell",
          outcome: 1,
          amount: 125,
          at: "2026-10-10T09:00:00.000Z",
        },
        {
          participantId: "leo",
          displayName: "Leo Park",
          outcome: 2,
          amount: 80,
          at: "2026-10-11T16:00:00.000Z",
        },
      ],
    ),
    2,
    "Lisbon offered the best balance of multilingual talent, operating cost, and overlap with both customer regions.",
    "2026-10-12T17:30:00.000Z",
  );

  const openGrant = addTrades(
    makeMarket({
      id: "mkt-climate-grant",
      type: "opportunity",
      title: "Which climate pilot should receive the €100k grant?",
      description:
        "The foundation will choose one measurable, twelve-month pilot. Markets reveal informed conviction; the grant committee retains the final decision.",
      sponsor: "Common Ground Foundation",
      outcomes: [
        {
          label: "Cool Roof Commons",
          submitter: "CivicShade",
          description: "Reflective roofs for 300 heat-vulnerable homes.",
        },
        {
          label: "Harbor Carbon Lab",
          submitter: "BlueMesh",
          description: "Open measurement for restored coastal wetlands.",
        },
        {
          label: "Circular Kitchens",
          submitter: "LoopLocal",
          description: "Food-waste logistics for independent restaurants.",
        },
        {
          label: "School Air Map",
          submitter: "OpenBreath",
          description: "Neighborhood air sensors operated by students.",
        },
      ],
      tags: ["grant", "climate"],
      createdAt: "2026-10-18T09:00:00.000Z",
      liquidity: 300,
    }),
    [
      {
        participantId: "maya",
        displayName: "Maya Chen",
        outcome: 1,
        amount: 130,
        at: "2026-10-20T10:00:00.000Z",
      },
      {
        participantId: "sora",
        displayName: "Sora Malik",
        outcome: 0,
        amount: 170,
        at: "2026-10-21T14:00:00.000Z",
      },
      {
        participantId: "amina",
        displayName: "Amina Yusuf",
        outcome: 1,
        amount: 95,
        at: "2026-10-22T11:30:00.000Z",
      },
    ],
  );

  const openChoice = addTrades(
    makeMarket({
      id: "mkt-pricing-experiment",
      type: "simple",
      title: "Which pricing experiment should we run next?",
      description:
        "The revenue team has one clean experimentation window and wants a calibrated signal before committing traffic.",
      sponsor: "Orbit Revenue Lab",
      outcomes: [
        { label: "Usage-based teams" },
        { label: "Annual starter plan" },
        { label: "Paid collaboration add-on" },
      ],
      tags: ["pricing", "growth"],
      createdAt: "2026-10-22T08:00:00.000Z",
    }),
    [
      {
        participantId: "jon",
        displayName: "Jon Bell",
        outcome: 0,
        amount: 85,
        at: "2026-10-23T10:00:00.000Z",
      },
      {
        participantId: "leo",
        displayName: "Leo Park",
        outcome: 2,
        amount: 115,
        at: "2026-10-24T12:00:00.000Z",
      },
    ],
  );

  const openSports = addTrades(
    makeMarket({
      id: "mkt-sports-final",
      type: "simple",
      title: "Harbor vs. Summit: Championship Final",
      description:
        "Match-winner market, including extra time. Compare Harbor's evidence-backed support with the larger position on Summit.",
      sponsor: "TRUTH-402 Sports Desk",
      outcomes: [{ label: "Harbor wins" }, { label: "Summit wins" }],
      tags: ["sports", "synthetic-demo"],
      createdAt: "2026-10-24T12:00:00.000Z",
      liquidity: 500,
    }),
    [
      {
        participantId: "maya",
        displayName: "Maya Chen",
        outcome: 0,
        amount: 75,
        at: "2026-10-24T13:00:00.000Z",
      },
      {
        participantId: "amina",
        displayName: "Amina Yusuf",
        outcome: 0,
        amount: 60,
        at: "2026-10-24T14:00:00.000Z",
      },
      {
        participantId: "demo-whale",
        displayName: "Whale 0x7bC1",
        outcome: 1,
        amount: 1000,
        at: "2026-10-24T15:00:00.000Z",
      },
    ],
  );

  return [
    openGrant,
    openChoice,
    feature,
    vendor,
    expansion,
    openSports,
    ...predictionMarkets(),
  ];
}

/** New simulated events are additive. They never replace the original three resolutions. */
function predictionMarkets(): Market[] {
  const events = [
    [
      "champions",
      "UEFA Champions League Quarterfinal: Home Side Advances",
      "sports",
      "UEFA Champions League knockout tie. Compare high-variance whale size against Walrus Memory track records. Resolves YES if the home side advances on aggregate, including extra time and penalties.",
      "TRUTH-402 Football Desk",
    ],
    [
      "nba",
      "NBA Eastern Finals Game 6: Home Side Covers -4.5",
      "sports",
      "Resolves YES if the home side wins by five or more points. The final score includes overtime; a four-point win settles NO.",
      "TRUTH-402 Basketball Desk",
    ],
    [
      "f1",
      "Formula 1 Monaco GP: Pole Sitter Finishes on Podium",
      "sports",
      "Resolves YES if the pole sitter is classified in the top three after post-race penalties. Grid position and final classification define the outcome.",
      "TRUTH-402 Motorsport Desk",
    ],
    [
      "sui",
      "Sui Mainnet (SUI): Monthly Close Above $4.00",
      "crypto",
      "Resolves YES when the reference SUI/USD spot close at 23:59 UTC on the final day of the month is strictly above $4.00.",
      "TRUTH-402 Digital Assets",
    ],
    [
      "btc",
      "Bitcoin (BTC): Monthly Close Above $100,000",
      "crypto",
      "Resolves YES when the reference BTC/USD spot close at 23:59 UTC on the final day of the month is strictly above $100,000.",
      "TRUTH-402 Digital Assets",
    ],
    [
      "eth",
      "Ethereum (ETH): Monthly Close Above $4,000",
      "crypto",
      "Resolves YES when the reference ETH/USD spot close at 23:59 UTC on the final day of the month is strictly above $4,000.",
      "TRUTH-402 Digital Assets",
    ],
    [
      "governance",
      "DAO Treasury: Diversification Proposal Passes",
      "politics",
      "Resolves YES if the treasury diversification proposal reaches quorum and receives a majority of eligible votes at the voting deadline.",
      "TRUTH-402 Governance Research",
    ],
    [
      "rates",
      "Federal Reserve: Policy Rate Held at Next Decision",
      "macro",
      "Resolves YES if the next scheduled FOMC decision leaves both bounds of the federal funds target range unchanged.",
      "TRUTH-402 Macro Research",
    ],
  ];
  return events.flatMap(
    ([slug, title, category, description, sponsor], eventIndex) => {
      const make = (resolved: boolean) => {
        const market = addTrades(
          makeMarket({
            id: `mkt-${slug}-${resolved ? "resolved" : "forecast"}`,
            type: "simple",
            title,
            description,
            sponsor,
            outcomes: [{ label: "YES" }, { label: "NO" }],
            tags: [category, "synthetic-demo"],
            createdAt: resolved
              ? "2026-10-15T09:00:00.000Z"
              : "2026-10-24T09:00:00.000Z",
            liquidity: 1000,
          }),
          [
            {
              participantId: "maya",
              displayName: "Maya Chen",
              outcome: resolved && eventIndex === 2 ? 1 : 0,
              amount: 90,
              at: "2026-10-24T10:00:00.000Z",
            },
            {
              participantId: "amina",
              displayName: "Amina Yusuf",
              outcome: resolved && eventIndex === 4 ? 1 : 0,
              amount: 75,
              at: "2026-10-24T11:00:00.000Z",
            },
            {
              participantId: "sora",
              displayName: "Sora Malik",
              outcome: eventIndex % 2,
              amount: 110,
              at: "2026-10-24T12:00:00.000Z",
            },
            ...(!resolved || eventIndex < 2
              ? [
                  {
                    participantId: "whale-0x9fa2",
                    displayName: "Whale 0x9fA2",
                    outcome: eventIndex === 0 ? 0 : 1,
                    amount: 1200,
                    at: "2026-10-24T13:00:00.000Z",
                  },
                ]
              : []),
          ],
        );
        return resolved
          ? resolveSeed(
              market,
              0,
              "Synthetic fixture resolution only. No claim about a real sports result, asset price or governance vote.",
              "2026-10-25T17:00:00.000Z",
            )
          : market;
      };
      return [make(true), make(false)];
    },
  );
}

export function createSeedDatabase(): TRUTH402Database {
  const markets = seedMarkets();
  const demoMemories: RecalledMemory[] = markets
    .filter((market) => market.status === "resolved")
    .flatMap((market) => buildResolutionMemories(market))
    .map((record) => {
      // The original twenty published v1 seed payloads are immutable.
      // Runtime scoring derives entry evidence from trades without rewriting them.
      if (
        record.kind !== "participant_performance" ||
        ![
          "mkt-feature-q4",
          "mkt-support-vendor",
          "mkt-expansion-2027",
        ].includes(record.marketId)
      )
        return record;
      const legacy = { ...record };
      delete legacy.entryPrice;
      delete legacy.entryPriceSource;
      delete legacy.realizedEdge;
      return legacy;
    })
    .map((record, index) => ({
      blobId: `demo-${record.recordId}`,
      text: serializeMemory(record),
      distance: 0.05 + (index % 10) / 100,
      createdAt: record.occurredAt,
      provider: "demo" as const,
    }));

  const baseline = new Map(
    deriveCredibility(
      enrichPerformanceRecords(
        demoMemories.map((memory) => parseMemory(memory.text)!),
        markets,
      ),
    ).map((entry) => [entry.participantId, learningRankSnapshot(entry)]),
  );
  for (const memory of demoMemories.slice(20)) {
    const record = parseMemory(memory.text)!;
    if (record.kind === "participant_performance") {
      // Additive synthetic backfill only. Original provider text is never rewritten.
      memory.text = serializeMemory({
        ...record,
        episode: "wallet_backfill",
        baseline: baseline.get(record.participantId),
      });
    }
  }

  const receiptsByMarket = new Map<string, Market["memoryReceipts"]>();
  for (const memory of demoMemories) {
    const record = buildRecordReference(memory.text);
    if (!record) continue;
    const receipts = receiptsByMarket.get(record.marketId) ?? [];
    receipts.push({
      recordId: record.recordId,
      kind: record.kind,
      status: "confirmed",
      provider: "demo",
      blobId: memory.blobId,
      confirmedAt: record.occurredAt,
    });
    receiptsByMarket.set(record.marketId, receipts);
  }

  for (const market of markets) {
    market.memoryReceipts = receiptsByMarket.get(market.id) ?? [];
  }

  return { version: 1, markets, demoMemories, insightCache: {} };
}

function buildRecordReference(text: string): {
  marketId: string;
  recordId: string;
  kind: TRUTH402MemoryKind;
  occurredAt: string;
} | null {
  const record = parseMemory(text);
  if (!record) return null;
  return {
    marketId: record.marketId,
    recordId: record.recordId,
    kind: record.kind,
    occurredAt: record.occurredAt,
  };
}

/** A separate, explicitly synthetic cross-category benchmark. Not Walrus evidence. */
export function createPredictionFixture(): {
  traders: PredictionTrader[];
  positions: PredictionClosedPosition[];
} {
  const profiles = [
    { name: "Lucky Whale", n: 2, wins: 1, edge: 0.94, loss: 0.52, pnl: 142000 },
    { name: "Maya Chen", n: 42, wins: 34, edge: 0.286, loss: 0.25, pnl: 4800 },
    { name: "Amina Yusuf", n: 40, wins: 30, edge: 0.29, loss: 0.29, pnl: 6100 },
    { name: "Sora Malik", n: 16, wins: 12, edge: 0.32, loss: 0.5, pnl: 11000 },
    { name: "Leo Park", n: 12, wins: 9, edge: 0.24, loss: 0.45, pnl: 9500 },
    { name: "Jon Bell", n: 8, wins: 6, edge: 0.2, loss: 0.4, pnl: 7400 },
  ];
  const traders: PredictionTrader[] = profiles.map((profile, index) => ({
    provider: "demo",
    wallet: `0x${String(index + 1).repeat(40)}`,
    displayName: profile.name,
    profitRank: 1 + profiles.filter((row) => row.pnl > profile.pnl).length,
    volumeUsd: 0,
    pnlUsd: profile.pnl,
  }));
  const categories = [
    "SPORTS",
    "SPORTS",
    "SPORTS",
    "CRYPTO",
    "CRYPTO",
    "CRYPTO",
    "MACRO",
    "POLITICS",
  ] as const;
  const titles = [
    "Champions League advancement",
    "NBA spread",
    "F1 podium",
    "SUI monthly close",
    "BTC weekly range",
    "ETH adoption",
    "Policy rate decision",
    "Treasury governance",
  ];
  const positions = traders.flatMap((trader, traderIndex) => {
    const profile = profiles[traderIndex];
    const observations = Array.from({ length: profile.n }, (_, index) => {
      const resolution = index < profile.wins ? (1 as const) : (0 as const);
      const entryPrice = resolution
        ? 1 - profile.edge + (traderIndex ? ((index % 3) - 1) * 0.01 : 0)
        : profile.loss;
      return {
        resolution,
        entryPrice,
        roi: (resolution - entryPrice) / entryPrice,
      };
    });
    const stake =
      profile.pnl / observations.reduce((sum, row) => sum + row.roi, 0);
    const rows = observations.map(
      ({ resolution, entryPrice }, index): PredictionClosedPosition => {
        // The whale's profitable trade earns $142,250, then a $250 loss: net $142,000.
        const conviction =
          traderIndex === 0
            ? index === 0
              ? (142250 * 0.06) / 0.94
              : 250
            : stake;
        return {
          provider: "demo",
          wallet: trader.wallet,
          marketId: `benchmark-${index + 1}`,
          asset: `benchmark-${index + 1}-yes`,
          marketTitle: `${titles[index % titles.length]} (synthetic ${index + 1})`,
          outcome: "YES",
          entryPrice,
          resolution,
          realizedEdge: resolution - entryPrice,
          conviction,
          realizedPnlUsd: conviction * (resolution / entryPrice - 1),
          occurredAt: new Date(Date.UTC(2026, 8, index + 1, 17)).toISOString(),
          category: categories[index % categories.length],
        };
      },
    );
    trader.volumeUsd = rows.reduce((sum, row) => sum + row.conviction, 0);
    return rows;
  });
  return { traders, positions };
}
