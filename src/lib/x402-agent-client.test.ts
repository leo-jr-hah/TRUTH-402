import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buyOracleSignal,
  parseAgentChallenge,
} from "../../scripts/x402-agent-client";
import { DEMO_ORACLE_ADDRESS, SUI_USDC_COIN_TYPE } from "@/lib/config";
import { computeIncentiveEconomics } from "@/lib/oracle-economics";
import type { MemoryCalibratedProbability } from "@/types/domain";
import {
  parsePaymentAuthorization,
  paymentAuthorization,
} from "@/lib/payment-auth";

const marketId = "mkt-sports-final";
const token = "a".repeat(43);
const invoice = {
  id: createHash("sha256").update(token).digest("hex"),
  invoiceToken: token,
  marketId,
  mode: "demo" as "demo" | "live",
  recipient: DEMO_ORACLE_ADDRESS,
  network: "sui:mainnet",
  coinType: SUI_USDC_COIN_TYPE,
  amountBaseUnits: "10000",
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  preview: { participantCount: 3, trackedBackers: 2, memoryCount: 62 },
};
const manifest = {
  name: "TRUTH-402",
  protocol: "x402-sui-mpp",
  mode: "demo",
  compatibility: { profile: "custom-sui-digest-v1" },
  payment: {
    network: "sui:mainnet",
    currency: "USDC",
    coinType: SUI_USDC_COIN_TYPE,
    amountBaseUnits: "10000",
    recipient: DEMO_ORACLE_ADDRESS,
  },
};
function challengeHeader(value = invoice) {
  return paymentAuthorization({
    method: "sui",
    intent: "charge",
    currency: "USDC",
    network: value.network,
    amount: value.amountBaseUnits,
    recipient: value.recipient,
    id: value.id,
    invoiceToken: value.invoiceToken,
    coinType: value.coinType,
    mode: value.mode,
    issued: value.issuedAt,
    expires: value.expiresAt,
  });
}
function report(digest: string, provider: "demo" | "tatum" = "demo") {
  return {
    marketId,
    signalSource: "current-estimate",
    memoryCalibratedProbabilities: [
      {
        outcomeId: "yes",
        label: "YES",
        marketProbability: 0.5,
        oracleProbability: 0.584,
        edgeDivergence: 0.084,
      },
      {
        outcomeId: "no",
        label: "NO",
        marketProbability: 0.5,
        oracleProbability: 0.416,
        edgeDivergence: -0.084,
      },
    ],
    walrusEvidenceBlobs: [
      { provider: "demo", blobId: "demo-evidence", recordId: "evidence" },
    ],
    paymentReceipt: {
      provider,
      digest,
      recipient: invoice.recipient,
      amountBaseUnits: "10000",
      coinType: invoice.coinType,
      latencyMs: 0,
      network: "sui:mainnet",
      checkpoint: "402",
    },
  };
}

describe("autonomous x402 buyer", () => {
  it("prints measured disagreement and validated royalty allocation without claiming payouts or signing", async () => {
    const economics = computeIncentiveEconomics(
      { trades: [] },
      report("test")
        .memoryCalibratedProbabilities as MemoryCalibratedProbability[],
      [],
      [],
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(manifest))
      .mockResolvedValueOnce(
        Response.json(
          {
            ...invoice,
            preview: {
              ...invoice.preview,
              klDivergencePreview: economics.klDivergenceBits,
              estimatedAgentEvBps: economics.estimatedAgentEvBps,
            },
          },
          { status: 402, headers: { "www-authenticate": challengeHeader() } },
        ),
      )
      .mockImplementationOnce(async (_url, init) => {
        const { digest } = parsePaymentAuthorization(
          new Headers(init?.headers).get("authorization")!,
        );
        return Response.json({
          ...report(digest),
          incentiveEconomics: economics,
        });
      });
    const log = vi.fn(),
      table = vi.fn();
    await buyOracleSignal(
      { baseUrl: "http://127.0.0.1:3000", marketId },
      { fetch, log, table },
    );
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain(
      "expectedValueOfInformation: klDivergencePreview=",
    );
    expect(output).toContain(
      "backers 80% / 8000 micro-USDC; protocol 20% / 2000",
    );
    expect(output).toContain("accrual only, no payouts");
    expect(output).toContain("external signing");
    expect(table).toHaveBeenCalledTimes(3);
    expect(output).not.toContain(token);
  });
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it.each([
    "http://127.0.0.1:3000",
    "http://localhost:4100",
    "http://[::1]:4100",
    "https://oracle.example",
  ])(
    "explains discovery connection failures at %s without retrying or leaking credentials",
    async (baseUrl) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockRejectedValue(new TypeError(`fetch failed: ${token}`));
      const io = { fetch, log: vi.fn(), table: vi.fn() };
      const guidance =
        baseUrl === "https://oracle.example"
          ? "Check --base-url, oracle server availability, DNS/TLS, and network access."
          : "The buyer does not start a web server. Start the local demo server in another terminal using the README's safe offline demo setup, wait for Ready, and match --base-url to its host and port.";
      await expect(
        buyOracleSignal({ baseUrl, marketId }, io),
      ).rejects.toMatchObject({
        message: `Could not fetch the oracle manifest at ${baseUrl}/api/oracle/manifest. ${guidance} No payment redemption was attempted.`,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe(`${baseUrl}/api/oracle/manifest`);
      expect(fetch.mock.calls[0][1]?.headers).toBeUndefined();
      expect(io.table).not.toHaveBeenCalled();
      expect(io.log.mock.calls.flat().join("\n")).not.toContain(token);
    },
  );

  it("preserves discovery HTTP errors rather than reporting a connection failure", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ error: "Unavailable" }, { status: 503 }),
      );
    await expect(
      buyOracleSignal(
        { baseUrl: "http://127.0.0.1:3000", marketId },
        { fetch, log: vi.fn(), table: vi.fn() },
      ),
    ).rejects.toThrow("Oracle discovery returned HTTP 503.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("discovers, screens evidence, redeems Payment credentials and prints the alpha table", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(manifest))
      .mockResolvedValueOnce(
        Response.json(invoice, {
          status: 402,
          headers: { "WWW-Authenticate": challengeHeader() },
        }),
      )
      .mockImplementationOnce(async (_url, init) => {
        const credential = parsePaymentAuthorization(
          new Headers(init?.headers).get("authorization")!,
        );
        expect(credential).toMatchObject({
          invoice: token,
          method: "sui",
          id: invoice.id,
          network: "sui:mainnet",
        });
        expect(credential.digest).toMatch(/^demo-sui-tx-agent-/u);
        return Response.json(report(credential.digest));
      });
    const log = vi.fn();
    const table = vi.fn();
    const result = await buyOracleSignal(
      { baseUrl: "http://127.0.0.1:3000", marketId },
      { fetch, log, table },
    );
    expect(result?.marketId).toBe(marketId);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(table).toHaveBeenCalledTimes(2);
    expect(table.mock.calls[0][0][0]["Alpha Shift"]).toBe("+8.4 pp");
    expect(log.mock.calls.flat().join("\n")).toContain(
      "trackedBackers=2, memoryCount=62",
    );
    expect(log.mock.calls.flat().join("\n")).not.toContain(token);
    for (const [, init] of fetch.mock.calls)
      expect(init?.redirect).toBe("error");
  });

  it("accepts challenge terms from headers or JSON and rejects inconsistent terms", () => {
    expect(
      parseAgentChallenge(
        challengeHeader(),
        { preview: invoice.preview },
        marketId,
      ),
    ).toEqual(invoice);
    expect(parseAgentChallenge(null, invoice, marketId)).toEqual(invoice);
    expect(() =>
      parseAgentChallenge(
        challengeHeader(),
        { ...invoice, amountBaseUnits: "20000" },
        marketId,
      ),
    ).toThrow(/differs/u);
    expect(() =>
      parseAgentChallenge(
        challengeHeader(),
        { ...invoice, invoiceToken: "b".repeat(43) },
        marketId,
      ),
    ).toThrow(/differs/u);
  });

  it("never redeems an invoice without evidence or at an unexpected origin", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(manifest))
      .mockResolvedValueOnce(
        Response.json(
          { ...invoice, preview: { ...invoice.preview, trackedBackers: 0 } },
          { status: 402 },
        ),
      );
    const io = { fetch, log: vi.fn(), table: vi.fn() };
    await expect(
      buyOracleSignal({ baseUrl: "http://127.0.0.1:3000", marketId }, io),
    ).rejects.toThrow(/EVI screen declined/u);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const baseUrl of [
      "http://oracle.example",
      "https://user:secret@oracle.example",
      "https://oracle.example/path",
      "https://oracle.example?token=x",
    ])
      await expect(buyOracleSignal({ baseUrl, marketId }, io)).rejects.toThrow(
        /plain HTTPS/u,
      );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("saves a private live challenge without sending funds and resumes its exact invoice", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "truth402-agent-"));
    const invoiceFile = path.join(directory, "invoice.json");
    const liveInvoice = { ...invoice, mode: "live" as const };
    const digest = "A".repeat(44);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ ...manifest, mode: "live" }))
      .mockResolvedValueOnce(
        Response.json(liveInvoice, {
          status: 402,
          headers: { "WWW-Authenticate": challengeHeader(liveInvoice) },
        }),
      );
    const io = { fetch, log: vi.fn(), table: vi.fn() };
    expect(
      await buyOracleSignal(
        {
          baseUrl: "https://oracle.example",
          marketId,
          saveInvoice: invoiceFile,
        },
        io,
      ),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await stat(invoiceFile)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(invoiceFile, "utf8")).invoice.id).toBe(
      invoice.id,
    );
    fetch
      .mockResolvedValueOnce(Response.json({ ...manifest, mode: "live" }))
      .mockImplementationOnce(async (_url, init) => {
        expect(
          parsePaymentAuthorization(
            new Headers(init?.headers).get("authorization")!,
          ),
        ).toMatchObject({ digest, invoice: token });
        return Response.json(report(digest, "tatum"));
      });
    expect(
      (
        await buyOracleSignal(
          {
            baseUrl: "https://oracle.example",
            marketId,
            liveDigest: digest,
            invoiceFile,
          },
          io,
        )
      )?.paymentReceipt.provider,
    ).toBe("tatum");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(io.log.mock.calls.flat().join("\n")).not.toContain(token);
  });

  it("rejects expired or cross-origin saved invoices before redemption", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "truth402-agent-"));
    const invoiceFile = path.join(directory, "invoice.json");
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        Response.json({ ...manifest, mode: "live" }),
      );
    const io = { fetch, log: vi.fn(), table: vi.fn() };
    await writeFile(
      invoiceFile,
      JSON.stringify({ origin: "https://other.example", invoice }),
    );
    await expect(
      buyOracleSignal(
        {
          baseUrl: "https://oracle.example",
          marketId,
          invoiceFile,
          liveDigest: "A".repeat(44),
        },
        io,
      ),
    ).rejects.toThrow(/different oracle origin/u);
    await writeFile(
      invoiceFile,
      JSON.stringify({
        origin: "https://oracle.example",
        invoice: {
          ...invoice,
          mode: "live",
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    );
    await expect(
      buyOracleSignal(
        {
          baseUrl: "https://oracle.example",
          marketId,
          invoiceFile,
          liveDigest: "A".repeat(44),
        },
        io,
      ),
    ).rejects.toThrow(/expired/u);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
