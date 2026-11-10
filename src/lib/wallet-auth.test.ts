import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { describe, expect, it } from "vitest";

import { tradeAuthMessage, verifyWalletTradeAuth } from "@/lib/wallet-auth";

async function signed(
  marketId: string,
  issuedAt: string,
  forMarket = marketId,
) {
  const key = new Ed25519Keypair();
  const address = key.toSuiAddress();
  const { signature } = await key.signPersonalMessage(
    new TextEncoder().encode(tradeAuthMessage(forMarket, address, issuedAt)),
  );
  const headers = new Headers({
    "x-wallet-address": address,
    "x-wallet-issued": issuedAt,
    "x-wallet-signature": signature,
  });
  return { address, request: new Request("http://localhost/t", { headers }) };
}

describe("wallet trade authorization", () => {
  it("accepts a fresh signature from the wallet", async () => {
    const { address, request } = await signed("m1", new Date().toISOString());
    expect(await verifyWalletTradeAuth(request, "m1")).toBe(address);
  });
  it("rejects another market, stale and missing signatures", async () => {
    const other = await signed("m1", new Date().toISOString(), "m2");
    await expect(
      verifyWalletTradeAuth(other.request, "m1"),
    ).rejects.toMatchObject({ code: "WALLET_AUTH_INVALID" });
    const stale = await signed(
      "m1",
      new Date(Date.now() - 3_600_000).toISOString(),
    );
    await expect(
      verifyWalletTradeAuth(stale.request, "m1"),
    ).rejects.toMatchObject({ code: "WALLET_AUTH_EXPIRED" });
    expect(
      await verifyWalletTradeAuth(new Request("http://localhost/t"), "m1"),
    ).toBeNull();
  });
});
