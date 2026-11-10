import "server-only";

import { getAgentRouterConfig } from "@/lib/config";
import { getMemoryProvider } from "@/lib/memory/provider";
import { removeEmDashes } from "@/lib/sanitize";
import { publicProviderError } from "@/lib/server-secrets";
import { checkTatumSui } from "@/lib/tatum";
import type { HealthSnapshot, IntegrationCheck } from "@/types/domain";

async function agentCheck(): Promise<IntegrationCheck> {
  try {
    const config = getAgentRouterConfig();
    if (config.mode === "demo") {
      return {
        name: "Agent Router",
        mode: "demo",
        status: "unconfigured",
        message: "Built-in insights are active; no model is being called.",
      };
    }
    const started = performance.now();
    if (process.env.VITEST)
      return {
        name: "Agent Router",
        mode: "live",
        status: "configured",
        message:
          `OpenAI-compatible model “${removeEmDashes(config.model)}” ` +
          "is configured for on-demand calls.",
      };
    const response = await fetch(
      `${config.baseUrl.replace(/\/$/u, "")}/models`,
      {
        headers: { authorization: `Bearer ${config.apiKey}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      name: "Agent Router",
      mode: "live",
      status: "healthy",
      message: `Model “${removeEmDashes(config.model)}” is reachable.`,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      name: "Agent Router",
      mode: "live",
      status: "error",
      message: publicProviderError(
        error,
        "Invalid Agent Router configuration.",
      ),
    };
  }
}

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  const [memory, tatum, agent] = await Promise.all([
    getMemoryProvider().check(),
    checkTatumSui(),
    agentCheck(),
  ]);
  const integrations = [memory, tatum, agent].map((integration) => ({
    ...integration,
    message: removeEmDashes(integration.message),
    details: integration.details
      ? Object.fromEntries(
          Object.entries(integration.details).map(([key, value]) => [
            key,
            typeof value === "string" ? removeEmDashes(value) : value,
          ]),
        )
      : undefined,
  }));
  return {
    status: integrations.some((integration) => integration.status === "error")
      ? "degraded"
      : "healthy",
    checkedAt: new Date().toISOString(),
    integrations,
  };
}
