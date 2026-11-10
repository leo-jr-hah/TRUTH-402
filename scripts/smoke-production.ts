import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("No local smoke port available.");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  const env = {
    ...process.env,
    VERDICTO_MEMORY_MODE: "demo",
    VERDICTO_TATUM_MODE: "demo",
    VERDICTO_AI_MODE: "demo",
    VERDICTO_STORAGE_MODE: "memory",
    VERDICTO_ENABLE_MAINNET_WRITES: "false",
    VERDICTO_PUBLIC_JUDGE_MODE: "false",
    VERDICTO_REQUIRE_OPERATOR_TOKEN: "false",
    VERDICTO_REQUIRE_STRICT_PTB_BINDING: "true",
    SUI_ALLOW_ANY_COIN_FALLBACK: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${pathToFileURL(path.resolve("scripts/demo-network-guard.mjs")).href}`,
    SMOKE_BASE_URL: `http://127.0.0.1:${port}`,
  };
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { env, stdio: "inherit" },
  );
  const stopped = once(server, "exit");
  let failure: unknown;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (server.exitCode !== null || server.signalCode)
        throw new Error("Demo server exited before readiness.");
      try {
        const response = await fetch(
          `${env.SMOKE_BASE_URL}/api/oracle/manifest`,
          { signal: AbortSignal.timeout(1000), redirect: "error" },
        );
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* server still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error("Production demo server did not become ready.");
    const smoke = spawn("npm", ["run", "smoke"], { env, stdio: "inherit" });
    const [code] = await once(smoke, "exit");
    if (code !== 0)
      throw new Error(`Production smoke failed with exit ${code}.`);
    const agent = spawn(
      "npm",
      ["run", "agent:x402", "--", "--base-url", env.SMOKE_BASE_URL],
      { env, stdio: "inherit" },
    );
    const [agentCode] = await once(agent, "exit");
    if (agentCode !== 0)
      throw new Error(`Agent buyer failed with exit ${agentCode}.`);
    if (process.env.TRUTH402_BROWSER_SMOKE === "true") {
      const browser = spawn(process.execPath, ["scripts/browser-smoke.mjs"], {
        env,
        stdio: "inherit",
      });
      const [browserCode] = await once(browser, "exit");
      if (browserCode !== 0)
        throw new Error(`Browser smoke failed with exit ${browserCode}.`);
    }
  } catch (error) {
    failure = error;
  } finally {
    server.kill("SIGTERM");
    const killTimer = setTimeout(() => server.kill("SIGKILL"), 5000);
    await stopped;
    clearTimeout(killTimer);
  }
  try {
    await fetch(`${env.SMOKE_BASE_URL}/api/oracle/manifest`, {
      signal: AbortSignal.timeout(1000),
    });
    throw new Error("Smoke server port remained open after shutdown.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("remained open"))
      throw error;
  }
  if (failure) throw failure;
  console.log(
    "Production smoke passed; isolated memory store discarded and server port closed.",
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Production smoke failed.",
  );
  process.exitCode = 1;
});
