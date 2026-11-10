import "server-only";

import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

import { AppError } from "@/lib/errors";
import { suiAddressSchema } from "@/lib/validation";

const MAX_AGE_MS = 5 * 60_000;

export function tradeAuthMessage(
  marketId: string,
  address: string,
  issuedAt: string,
) {
  return `TRUTH402 trade authorization\nmarket:${marketId}\nwallet:${address}\nissued:${issuedAt}`;
}

/** Returns the verified wallet address when the request carries a fresh signature. */
export async function verifyWalletTradeAuth(
  request: Request,
  marketId: string,
): Promise<string | null> {
  const address = request.headers.get("x-wallet-address");
  const issuedAt = request.headers.get("x-wallet-issued");
  const signature = request.headers.get("x-wallet-signature");
  if (!address || !issuedAt || !signature) return null;
  const wallet = suiAddressSchema.parse(address);
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > MAX_AGE_MS)
    throw new AppError(
      "WALLET_AUTH_EXPIRED",
      "Wallet signature expired. Try again.",
      401,
    );
  try {
    await verifyPersonalMessageSignature(
      new TextEncoder().encode(tradeAuthMessage(marketId, wallet, issuedAt)),
      signature,
      { address: wallet },
    );
  } catch {
    throw new AppError(
      "WALLET_AUTH_INVALID",
      "Wallet signature could not be verified.",
      401,
    );
  }
  return wallet;
}
