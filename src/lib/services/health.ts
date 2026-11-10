import "server-only";

import { getAgentRouterConfig } from "@/lib/config";
import { getMemoryProvider } from "@/lib/memory/provider";
import { removeEmDashes } from "@/lib/sanitize";
import { publicProviderError } from "@/lib/server-secrets";
import { checkTatumSui } from "@/lib/tatum";
import type { HealthSnapshot, IntegrationCheck } from "@/types/domain";

function agentCheck(): IntegrationCheck {
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
    return {
      name: "Agent Router",
      mode: "live",
      status: "configured",
      message:
        `OpenAI-compatible model “${removeEmDashes(config.model)}” ` +
        "is configured for on-demand calls.",
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
  const [memory, tatum] = await Promise.all([
    getMemoryProvider().check(),
    checkTatumSui(),
  ]);
  const integrations = [memory, tatum, agentCheck()].map((integration) => ({
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
