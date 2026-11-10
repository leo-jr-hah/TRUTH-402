import { z } from "zod";

import { sanitizeUserText } from "@/lib/sanitize";

function userText(minimum: number, maximum: number) {
  return z
    .string()
    .transform(sanitizeUserText)
    .pipe(z.string().min(minimum).max(maximum));
}

const optionalUserText = (maximum: number) =>
  z
    .string()
    .transform(sanitizeUserText)
    .pipe(z.string().max(maximum))
    .optional();

export const entityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9_-]+$/u,
    "IDs may contain letters, numbers, _ and - only.",
  );

const outcomeInputSchema = z
  .object({
    label: userText(2, 80),
    description: optionalUserText(280),
    submitter: optionalUserText(80),
  })
  .strict();

export const createMarketSchema = z
  .object({
    type: z.enum(["simple", "opportunity"]),
    title: userText(8, 140),
    description: userText(20, 1_500),
    sponsor: userText(2, 100),
    outcomes: z.array(outcomeInputSchema).min(2).max(12),
    liquidity: z.coerce.number().finite().min(50).max(100_000).default(250),
    tags: z.array(userText(1, 24)).max(5).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const expected = value.type === "simple" ? [2, 5] : [3, 12];
    if (
      value.outcomes.length < expected[0] ||
      value.outcomes.length > expected[1]
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["outcomes"],
        message:
          value.type === "simple"
            ? "Simple Choice markets need 2–5 outcomes."
            : "Opportunity markets need 3–12 submissions.",
      });
    }

    const normalized = value.outcomes.map((outcome) =>
      outcome.label.toLocaleLowerCase(),
    );
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: "custom",
        path: ["outcomes"],
        message: "Outcome labels must be unique.",
      });
    }

    if (value.type === "opportunity") {
      value.outcomes.forEach((outcome, index) => {
        if (!outcome.submitter || outcome.submitter.length < 2) {
          ctx.addIssue({
            code: "custom",
            path: ["outcomes", index, "submitter"],
            message: "Each opportunity needs a named submitter.",
          });
        }
      });
    }
  });

export const tradeSchema = z
  .object({
    outcomeId: entityIdSchema,
    amount: z.coerce.number().finite().min(1).max(10_000),
    displayName: userText(2, 80),
    participantId: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-zA-Z0-9_-]+$/u)
      .optional(),
    role: z.enum(["trader", "market_maker"]).default("trader"),
  })
  .strict();

export const resolveMarketSchema = z
  .object({
    winningOutcomeId: entityIdSchema,
    resolutionNote: userText(5, 1_000),
  })
  .strict();

export const marketListQuerySchema = z
  .object({
    status: z.enum(["open", "resolved"]).optional(),
    type: z.enum(["simple", "opportunity"]).optional(),
  })
  .strict();

export const marketIdParamsSchema = z.object({ id: entityIdSchema }).strict();

export const emptyQuerySchema = z.object({}).strict();

export const suiAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/u)
  .transform(
    (address) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`,
  );
export const suiDigestSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/u);
export const demoSuiDigestSchema = z
  .string()
  .regex(/^demo-sui-tx-[a-zA-Z0-9_-]{6,64}$/u);
export const paymentDigestSchema = z.union([
  suiDigestSchema,
  demoSuiDigestSchema,
]);
export const oracleInvoiceTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u);
export const oracleCommitSchema = z
  .object({
    identifier: z
      .union([suiDigestSchema, z.string().regex(/^0x[0-9a-fA-F]{64}$/u)])
      .optional(),
  })
  .strict();
export const predictionWalletSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((wallet) => wallet.toLowerCase());

export const insightsQuerySchema = z
  .object({
    query: userText(3, 300).default(
      "TRUTH402 market resolution participant performance credibility decision signal",
    ),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const generateInsightsSchema = z
  .object({
    marketId: entityIdSchema.optional(),
    query: userText(3, 300).optional(),
  })
  .strict();

export type CreateMarketInput = z.infer<typeof createMarketSchema>;
export type TradeInput = z.infer<typeof tradeSchema>;
export type ResolveMarketInput = z.infer<typeof resolveMarketSchema>;
