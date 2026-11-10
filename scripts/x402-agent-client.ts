import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { incentiveEconomicsSchema } from "../src/lib/oracle-economics";

import {
  parsePaymentAuthorization,
  paymentAuthorization,
} from "../src/lib/payment-auth";
import { writePrivateFileAtomic } from "../src/lib/private-file";
import { stripUnsafeControls } from "../src/lib/sanitize";

const nativeUsdc =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
const manifestSchema = z.object({
  name: z.literal("TRUTH-402"),
  protocol: z.literal("x402-sui-mpp"),
  mode: z.enum(["demo", "live"]),
  compatibility: z.object({ profile: z.literal("custom-sui-digest-v1") }),
  payment: z.object({
    network: z.literal("sui:mainnet"),
    currency: z.literal("USDC"),
    coinType: z.literal(nativeUsdc),
    amountBaseUnits: z.literal("10000"),
    recipient: z.string().regex(/^0x[0-9a-f]{64}$/u),
  }),
});
const invoiceSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  invoiceToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/u),
  marketId: z.string(),
  mode: z.enum(["demo", "live"]),
  recipient: z.string().regex(/^0x[0-9a-f]{64}$/u),
  network: z.literal("sui:mainnet"),
  coinType: z.literal(nativeUsdc),
  amountBaseUnits: z.literal("10000"),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  preview: z.object({
    participantCount: z.number().int().nonnegative(),
    trackedBackers: z.number().int().nonnegative().optional(),
    memoryCount: z.number().int().nonnegative(),
    klDivergencePreview: z
      .number()
      .finite()
      .nonnegative()
      .nullable()
      .optional(),
    klDivergenceInfinite: z.boolean().optional(),
    estimatedAgentEvBps: z.number().int().min(0).max(10000).optional(),
  }),
});
const reportSchema = z.object({
  marketId: z.string(),
  signalSource: z.enum(["current-estimate", "committed-snapshot"]),
  incentiveEconomics: incentiveEconomicsSchema.optional(),
  memoryCalibratedProbabilities: z
    .array(
      z.object({
        outcomeId: z.string(),
        label: z.string(),
        marketProbability: z.number().min(0).max(1),
        oracleProbability: z.number().min(0).max(1),
        edgeDivergence: z.number().min(-1).max(1),
      }),
    )
    .min(2),
  walrusEvidenceBlobs: z.array(
    z.object({
      provider: z.enum(["demo", "walrus"]),
      blobId: z.string().min(1),
      recordId: z.string().min(1),
    }),
  ),
  paymentReceipt: z.object({
    provider: z.enum(["demo", "tatum"]),
    digest: z.string(),
    recipient: z.string(),
    amountBaseUnits: z.string().regex(/^\d+$/u),
    coinType: z.literal(nativeUsdc),
    latencyMs: z.number().nonnegative(),
    network: z.literal("sui:mainnet"),
    checkpoint: z.string(),
  }),
});

type AgentInvoice = z.infer<typeof invoiceSchema>;
type AgentManifest = z.infer<typeof manifestSchema>;
export interface AgentOptions {
  baseUrl: string;
  marketId: string;
  liveDigest?: string;
  invoiceFile?: string;
  saveInvoice?: string;
}
interface AgentIO {
  fetch: typeof fetch;
  log: (message: string) => void;
  table: (rows: Array<Record<string, string | number>>) => void;
}

function plainOrigin(value: string): string {
  const url = new URL(value);
  const loopback = loopbackHosts.includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use a plain HTTPS oracle origin, or HTTP on loopback only.",
    );
  return url.origin;
}

/** Header parameters and JSON must agree; neither can silently override the other. */
export function parseAgentChallenge(
  header: string | null,
  body: unknown,
  marketId: string,
): AgentInvoice {
  const fields = header === null ? {} : parsePaymentAuthorization(header);
  const json = z.record(z.string(), z.unknown()).parse(body);
  const field = (name: string, value: unknown) => {
    if (
      fields[name] !== undefined &&
      value !== undefined &&
      fields[name] !== value
    )
      throw new Error(
        `Payment challenge ${name} differs between headers and JSON.`,
      );
    return fields[name] ?? value;
  };
  if (
    header &&
    (fields.method !== "sui" ||
      fields.intent !== "charge" ||
      fields.currency !== "USDC")
  )
    throw new Error(
      "Unsupported Payment challenge method, intent or currency.",
    );
  if (json.protocol !== undefined && json.protocol !== "x402-sui-mpp")
    throw new Error("Unsupported payment protocol.");
  const invoiceToken = field(
    "invoice",
    field("invoicetoken", json.invoiceToken),
  );
  return invoiceSchema.parse({
    id: field("id", json.id),
    invoiceToken,
    marketId: json.marketId ?? marketId,
    mode: field("mode", json.mode),
    recipient: field("recipient", json.recipient),
    network: field("network", json.network),
    coinType: field("cointype", json.coinType),
    amountBaseUnits: field("amount", json.amountBaseUnits),
    issuedAt: field("issued", json.issuedAt),
    expiresAt: field("expires", json.expiresAt),
    preview: json.preview,
  });
}

function validateInvoice(
  invoice: AgentInvoice,
  manifest: AgentManifest,
  marketId: string,
): void {
  if (
    invoice.id !==
      createHash("sha256").update(invoice.invoiceToken).digest("hex") ||
    invoice.marketId !== marketId ||
    invoice.mode !== manifest.mode ||
    invoice.recipient !== manifest.payment.recipient ||
    invoice.amountBaseUnits !== manifest.payment.amountBaseUnits ||
    Date.parse(invoice.expiresAt) <= Date.now() ||
    Date.parse(invoice.issuedAt) > Date.now() + 5000 ||
    Date.parse(invoice.expiresAt) <= Date.parse(invoice.issuedAt)
  )
    throw new Error(
      "Invoice is expired or does not match the discovered oracle, resource and charge.",
    );
}

export async function buyOracleSignal(
  options: AgentOptions,
  io: AgentIO = {
    fetch: globalThis.fetch,
    log: console.log,
    table: console.table,
  },
) {
  const origin = plainOrigin(options.baseUrl);
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(options.marketId))
    throw new Error("Invalid market ID.");
  const get = (route: string, headers?: HeadersInit) =>
    io.fetch(`${origin}${route}`, {
      headers,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  io.log("TRUTH-402 / Oracle Buyer (external signing for live payments)");
  const discovered = await get("/api/oracle/manifest").catch(() => {
    const guidance = loopbackHosts.includes(new URL(origin).hostname)
      ? "The buyer does not start a web server. Start the local demo server in another terminal using the README's safe offline demo setup, wait for Ready, and match --base-url to its host and port."
      : "Check --base-url, oracle server availability, DNS/TLS, and network access.";
    throw new Error(
      `Could not fetch the oracle manifest at ${origin}/api/oracle/manifest. ${guidance} No payment redemption was attempted.`,
    );
  });
  if (!discovered.ok)
    throw new Error(`Oracle discovery returned HTTP ${discovered.status}.`);
  const manifest = manifestSchema.parse(await discovered.json());
  io.log(
    `1. Discovered ${manifest.name} · ${manifest.mode === "demo" ? "Demo Mode" : "Mainnet Mode"} · ${manifest.compatibility.profile}`,
  );
  const endpoint = `/api/oracle/markets/${encodeURIComponent(options.marketId)}/signal`;
  let invoice: AgentInvoice;
  if (options.invoiceFile) {
    const saved = z
      .object({ origin: z.string(), invoice: invoiceSchema })
      .parse(
        JSON.parse(await readFile(path.resolve(options.invoiceFile), "utf8")),
      );
    if (saved.origin !== origin)
      throw new Error("Saved invoice belongs to a different oracle origin.");
    invoice = saved.invoice;
    io.log("2. Resuming a private, invoice-bound payment challenge.");
  } else {
    const challenge = await get(endpoint);
    if (challenge.status !== 402)
      throw new Error(
        `Expected HTTP 402 Payment Required, received ${challenge.status}.`,
      );
    invoice = parseAgentChallenge(
      challenge.headers.get("www-authenticate"),
      await challenge.json(),
      options.marketId,
    );
    io.log(
      `2. HTTP 402 Payment Required · method=sui · amount=10000 · invoice id=${invoice.id}`,
    );
  }
  validateInvoice(invoice, manifest, options.marketId);
  const trackedBackers =
    invoice.preview.trackedBackers ?? invoice.preview.participantCount;
  io.log(
    `3. Expected Value of Information check: trackedBackers=${trackedBackers}, memoryCount=${invoice.preview.memoryCount}, cost=0.01 USDC`,
  );
  io.log(
    `   expectedValueOfInformation: klDivergencePreview=${invoice.preview.klDivergenceInfinite ? "infinite" : (invoice.preview.klDivergencePreview ?? "unavailable")}, trackedBackers=${trackedBackers}, estimatedAgentEvBps=${invoice.preview.estimatedAgentEvBps ?? "unavailable"}. Disagreement metrics, not expected profit.`,
  );
  if (trackedBackers === 0 || invoice.preview.memoryCount === 0)
    throw new Error(
      "EVI screen declined: no tracked evidence. No payment was redeemed.",
    );
  io.log(
    "   BUY · Evidence-availability heuristic, not an expected-return estimate.",
  );
  if (options.saveInvoice) {
    const file = path.resolve(options.saveInvoice);
    await writePrivateFileAtomic(
      file,
      `${JSON.stringify({ origin, invoice }, null, 2)}\n`,
    );
    io.log(`   Private invoice saved to ${file} (0600).`);
  }
  let digest: string;
  if (manifest.mode === "demo") {
    digest = `demo-sui-tx-agent-${randomUUID()}`;
    io.log("4. Demo settlement · No funds move.");
  } else {
    if (!options.invoiceFile || !options.liveDigest) {
      io.log(
        `   Recipient: ${invoice.recipient}\n   Native USDC: ${invoice.coinType}\n   PTB paymentReference: ${invoice.id}\n   Expires: ${invoice.expiresAt}`,
      );
      if (options.saveInvoice && !options.liveDigest) {
        io.log(
          "Live challenge prepared. Fund this exact reference externally, then resume with --invoice-file and SUI_TX_DIGEST. No funds sent or digest redeemed.",
        );
        return null;
      }
      throw new Error(
        "Live settlement needs an externally funded, saved invoice. Use --save-invoice /absolute/path/invoice.json, fund that exact reference, then run --invoice-file /absolute/path/invoice.json with SUI_TX_DIGEST. The agent never signs or sends funds.",
      );
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/u.test(options.liveDigest))
      throw new Error("SUI_TX_DIGEST is not a Sui transaction digest.");
    digest = options.liveDigest;
    io.log(
      "4. Redeeming the supplied Mainnet digest for its original invoice.",
    );
  }
  const unlocked = await get(endpoint, {
    authorization: paymentAuthorization({
      method: "sui",
      digest,
      invoice: invoice.invoiceToken,
      id: invoice.id,
      network: "sui:mainnet",
    }),
  });
  if (!unlocked.ok)
    throw new Error(
      `Payment redemption returned HTTP ${unlocked.status}. Not retrying a possibly consumed payment.`,
    );
  const report = reportSchema.parse(await unlocked.json());
  if (
    report.marketId !== options.marketId ||
    report.paymentReceipt.digest !== digest ||
    report.paymentReceipt.recipient !== invoice.recipient ||
    report.paymentReceipt.provider !==
      (manifest.mode === "demo" ? "demo" : "tatum") ||
    BigInt(report.paymentReceipt.amountBaseUnits) <
      BigInt(invoice.amountBaseUnits)
  )
    throw new Error(
      "Unlocked report receipt does not match the requested payment.",
    );
  io.log(
    `5. HTTP 200 · Memory-Calibrated Alpha Report · ${report.signalSource}`,
  );
  io.table(
    report.memoryCalibratedProbabilities.map((row) => ({
      Outcome: stripUnsafeControls(row.label),
      "Raw Market": `${(row.marketProbability * 100).toFixed(1)}%`,
      "Memory Forecast": `${(row.oracleProbability * 100).toFixed(1)}%`,
      "Alpha Shift": `${row.edgeDivergence >= 0 ? "+" : ""}${(row.edgeDivergence * 100).toFixed(1)} pp`,
    })),
  );
  io.log(
    `Sui verification latency: ${report.paymentReceipt.latencyMs} ms · ${report.paymentReceipt.provider} · checkpoint ${stripUnsafeControls(report.paymentReceipt.checkpoint)}`,
  );
  io.log("Walrus evidence receipts:");
  io.table(
    report.walrusEvidenceBlobs.map((entry) => ({
      Provider: entry.provider === "demo" ? "Local demo" : "Walrus",
      blobId: stripUnsafeControls(entry.blobId),
      recordId: stripUnsafeControls(entry.recordId),
    })),
  );
  if (report.incentiveEconomics) {
    const economics = report.incentiveEconomics;
    io.log(
      `Royalty allocation (accrual only, no payouts): backers 80% / ${economics.backerPoolMicroUsdc} micro-USDC; protocol 20% / ${economics.protocolFeeMicroUsdc} micro-USDC; unallocated=${economics.unallocatedBackerPoolMicroUsdc}.`,
    );
    io.table(
      economics.forecasterRoyalties.map((royalty) => ({
        Participant: stripUnsafeControls(royalty.displayName),
        trustRank: royalty.trustRank,
        sharePercent: royalty.sharePercent,
        royaltyMicroUsdc: royalty.royaltyMicroUsdc,
        backingBlobCount: royalty.backingBlobIds.length,
      })),
    );
  }
  return report;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "base-url": { type: "string" },
      market: { type: "string" },
      "invoice-file": { type: "string" },
      "save-invoice": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "npm run agent:x402 -- [--base-url http://127.0.0.1:3000] [--market mkt-sports-final]\nRequires a running web server. Start it in a separate terminal using the README's safe offline demo setup, wait for Ready, and match --base-url to its host and port. The buyer does not start a server.\nLive: --save-invoice /absolute/path/invoice.json, externally settle the exact PTB reference, then --invoice-file /absolute/path/invoice.json with SUI_TX_DIGEST. No wallet signing. Invoice tokens stay private.",
    );
    return;
  }
  await buyOracleSignal({
    baseUrl:
      values["base-url"] ??
      process.env.ORACLE_BASE_URL ??
      "http://127.0.0.1:3000",
    marketId: values.market ?? "mkt-sports-final",
    liveDigest: process.env.SUI_TX_DIGEST,
    invoiceFile: values["invoice-file"],
    saveInvoice: values["save-invoice"],
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  void main().catch((error: unknown) => {
    // Schema errors can contain supplied credentials; never dump raw payloads.
    console.error(
      error instanceof z.ZodError
        ? "Agent stopped: invalid oracle response schema."
        : `Agent stopped: ${stripUnsafeControls(error instanceof Error ? error.message : "Request failed.")}`,
    );
    process.exitCode = 1;
  });
}
