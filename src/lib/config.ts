import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";

const providerModeSchema = z.enum(["demo", "live"]);

function providerMode(value: string | undefined): "demo" | "live" {
  return providerModeSchema.catch("demo").parse(value);
}

export const MAINNET_RELAYER_URL = "https://relayer.memory.walrus.xyz";
export const TATUM_SUI_MAINNET_URL = "https://sui-mainnet.gateway.tatum.io";
export const TATUM_PREDICTION_URL = "https://api.tatum.io/v4/data/prediction";
// Circle-issued native Sui USDC. Never accept symbol-only or bridged lookalikes.
export const SUI_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const SUI_NATIVE_COIN_TYPE = "0x2::sui::SUI";
export const DEMO_ORACLE_ADDRESS = `0x${"0".repeat(60)}0402`;
export const MEMORY_NAMESPACE = "truth402";

function canonicalUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getPublicRuntimeConfig() {
  return {
    memoryMode: providerMode(process.env.VERDICTO_MEMORY_MODE),
    tatumMode: providerMode(process.env.VERDICTO_TATUM_MODE),
    aiMode: providerMode(process.env.VERDICTO_AI_MODE),
    memoryNamespace: process.env.MEMWAL_NAMESPACE?.trim() || MEMORY_NAMESPACE,
  } as const;
}

export function requiresOperator(): boolean {
  if (process.env.VERDICTO_REQUIRE_OPERATOR_TOKEN === "true") return true;
  if (process.env.VERDICTO_PUBLIC_JUDGE_MODE === "true") return false;
  const modes = getPublicRuntimeConfig();
  return (
    modes.memoryMode === "live" ||
    modes.tatumMode === "live" ||
    modes.aiMode === "live"
  );
}

/** A public playground grant, never authorization to fabricate a paid receipt. */
export function judgeSandboxEnabled(): boolean {
  return (
    process.env.VERDICTO_PUBLIC_JUDGE_MODE === "true" && !requiresOperator()
  );
}

export function getMemWalConfig(options: { requireWrites?: boolean } = {}) {
  const mode = providerMode(process.env.VERDICTO_MEMORY_MODE);
  if (mode !== "live") return { mode } as const;

  if (
    options.requireWrites &&
    process.env.VERDICTO_ENABLE_MAINNET_WRITES !== "true"
  ) {
    throw new AppError(
      "MAINNET_WRITES_LOCKED",
      "Walrus live mode also requires VERDICTO_ENABLE_MAINNET_WRITES=true.",
      503,
    );
  }

  const parsed = z
    .object({
      key: z.string().min(16),
      accountId: z.string().min(3),
      serverUrl: z.string().url(),
      namespace: z.string().min(1).max(120),
    })
    .safeParse({
      key: process.env.MEMWAL_PRIVATE_KEY,
      accountId: process.env.MEMWAL_ACCOUNT_ID,
      serverUrl: process.env.MEMWAL_SERVER_URL || MAINNET_RELAYER_URL,
      namespace: process.env.MEMWAL_NAMESPACE || MEMORY_NAMESPACE,
    });

  if (!parsed.success) {
    throw new AppError(
      "MEMWAL_NOT_CONFIGURED",
      "Walrus Memory live mode is missing valid server credentials.",
      503,
      parsed.error.flatten().fieldErrors,
    );
  }

  if (canonicalUrl(parsed.data.serverUrl) !== MAINNET_RELAYER_URL) {
    throw new AppError(
      "MEMWAL_NOT_MAINNET",
      `Verdicto live mode requires the canonical Mainnet relayer ${MAINNET_RELAYER_URL}.`,
      503,
    );
  }

  return {
    mode,
    ...parsed.data,
    serverUrl: canonicalUrl(parsed.data.serverUrl),
  } as const;
}

export function getTatumConfig() {
  const mode = providerMode(process.env.VERDICTO_TATUM_MODE);
  if (mode !== "live") return { mode } as const;

  const parsed = z
    .object({
      apiKey: z.string().min(8),
      rpcUrl: z.string().url(),
    })
    .safeParse({
      apiKey: process.env.TATUM_API_KEY,
      rpcUrl: process.env.TATUM_SUI_RPC_URL || TATUM_SUI_MAINNET_URL,
    });

  if (!parsed.success) {
    throw new AppError(
      "TATUM_NOT_CONFIGURED",
      "Tatum live mode is missing a valid API key or RPC URL.",
      503,
      parsed.error.flatten().fieldErrors,
    );
  }

  if (canonicalUrl(parsed.data.rpcUrl) !== TATUM_SUI_MAINNET_URL) {
    throw new AppError(
      "TATUM_NOT_SUI_MAINNET",
      `Verdicto requires the canonical Tatum Sui Mainnet gateway ${TATUM_SUI_MAINNET_URL}.`,
      503,
    );
  }

  return {
    mode,
    ...parsed.data,
    rpcUrl: canonicalUrl(parsed.data.rpcUrl),
  } as const;
}

export function getOraclePaymentConfig() {
  const mode = providerMode(process.env.VERDICTO_TATUM_MODE);
  if (mode === "demo")
    return {
      mode,
      recipient: DEMO_ORACLE_ADDRESS,
      amountBaseUnits: "10000",
      coinType: SUI_USDC_COIN_TYPE,
    } as const;
  const recipient = z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/u)
    .safeParse(process.env.SUI_ORACLE_ADDRESS);
  if (
    !recipient.success ||
    /^0x0+$/u.test(recipient.data) ||
    recipient.data.toLowerCase() === DEMO_ORACLE_ADDRESS
  ) {
    throw new AppError(
      "ORACLE_NOT_CONFIGURED",
      "Live oracle payments require an explicit SUI_ORACLE_ADDRESS.",
      503,
    );
  }
  return {
    mode,
    recipient: recipient.data.toLowerCase(),
    amountBaseUnits: "10000",
    coinType: SUI_USDC_COIN_TYPE,
  } as const;
}

export function getTatumPredictionConfig() {
  const config = getTatumConfig();
  if (config.mode !== "live") return config;
  const dataUrl = canonicalUrl(
    process.env.TATUM_DATA_API_URL || TATUM_PREDICTION_URL,
  );
  if (dataUrl !== TATUM_PREDICTION_URL) {
    throw new AppError(
      "TATUM_NOT_PREDICTION_API",
      "Prediction reads require the canonical Tatum v4 Prediction API.",
      503,
    );
  }
  return { ...config, dataUrl };
}

export function getAgentRouterConfig() {
  const mode = providerMode(process.env.VERDICTO_AI_MODE);
  if (mode !== "live") return { mode } as const;

  const parsed = z
    .object({
      apiKey: z.string().min(8),
      baseUrl: z.string().url(),
      model: z.string().min(1).max(200),
    })
    .safeParse({
      apiKey: process.env.AGENT_ROUTER_API_KEY,
      baseUrl: process.env.AGENT_ROUTER_BASE_URL || "http://127.0.0.1:8318/v1",
      model: process.env.AGENT_ROUTER_MODEL,
    });

  if (!parsed.success) {
    throw new AppError(
      "AI_NOT_CONFIGURED",
      "Agent Router live mode requires an API key, base URL, and model.",
      503,
      parsed.error.flatten().fieldErrors,
    );
  }

  return { mode, ...parsed.data } as const;
}
