"use client";

import { Check, Copy, LogOut, Wallet, X } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { removeEmDashes } from "@/lib/sanitize";
import {
  DISCONNECTED_WALLET,
  formatWalletAddress,
  SuiWalletStore,
  WALRUS_WATCH_ADDRESS,
} from "@/lib/sui-wallet";
import type { OracleInvoice } from "@/types/oracle";

const WalletContext = createContext<SuiWalletStore | null>(null);
const noopSubscribe = () => () => {};
const emptySnapshot = () => DISCONNECTED_WALLET;

export function SuiWalletProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => new SuiWalletStore());
  useEffect(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* Storage can be disabled. */
    }
    return store.start(window, storage);
  }, [store]);
  return (
    <WalletContext.Provider value={store}>{children}</WalletContext.Provider>
  );
}

export function requestWalletConnect() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("truth402:connect-wallet"));
}

export function useSuiWallet() {
  const store = useContext(WalletContext);
  const state = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  async function payInvoice(
    invoice: OracleInvoice,
    onSubmitted?: (digest: string) => void,
  ): Promise<string> {
    if (!store || !state.canSign || !state.connected)
      throw new Error("Connect a signing Sui Mainnet wallet first.");
    const endpoint = `/api/oracle/markets/${encodeURIComponent(invoice.marketId)}/wallet-payment`;
    const post = async (body: Record<string, unknown>) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, invoiceToken: invoice.invoiceToken }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error?.message ?? "Wallet payment request failed.",
        );
      return payload as { bytes: string; digest: string };
    };
    const prepared = await post({
      action: "build",
      sender: state.connected.address,
    });
    // The SDK already ships with MemWal. It is loaded only when a wallet pays.
    const { Transaction } = await import("@mysten/sui/transactions");
    const transaction = Transaction.from(prepared.bytes);
    if (store.getSnapshot().connected?.address !== state.connected.address)
      throw new Error("Wallet changed. Request a new invoice before paying.");
    const signed = await store.signOrExecute(transaction);
    // Preserve the deterministic digest before a network submission can lose
    // its response. Retrying verification is safer than signing a second transfer.
    const candidateDigest =
      "digest" in signed
        ? signed.digest
        : await Transaction.from(signed.bytes).getDigest();
    onSubmitted?.(candidateDigest);
    const executed =
      "digest" in signed
        ? signed
        : await post({
            action: "execute",
            bytes: signed.bytes,
            signature: signed.signature,
          });
    // Keep the submitted digest even if RPC indexing is slow. Redemption can be
    // retried with this same digest; never ask the wallet to pay a second time.
    await post({ action: "confirm", digest: executed.digest }).catch(
      () => undefined,
    );
    return executed.digest;
  }
  return { ...state, store, payInvoice };
}

export function WalletConnect() {
  const { store, wallets, connected, busy, error } = useSuiWallet();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    const opener = trigger.current;
    node?.showModal();
    return () => {
      store?.cancelPending();
      node?.close();
      opener?.focus();
    };
  }, [open, store]);
  function watch(value: string) {
    try {
      store?.watch(value);
      setMessage(null);
      setOpen(false);
    } catch {
      setMessage("Enter a valid nonzero Sui address.");
    }
  }
  useEffect(() => {
    const openDialog = () => {
      setMessage(null);
      setCopied(false);
      setOpen(true);
    };
    window.addEventListener("truth402:connect-wallet", openDialog);
    return () =>
      window.removeEventListener("truth402:connect-wallet", openDialog);
  }, []);
  const enoki = wallets.find((wallet) => /enoki|zklogin/iu.test(wallet.name));
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="button-secondary !min-h-10 !gap-2 !px-3 text-xs"
        onClick={() => {
          setMessage(null);
          setCopied(false);
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        {connected ? (
          <span
            className={
              connected.kind === "wallet"
                ? "bg-teal size-2 shrink-0 rounded-full"
                : "bg-ink/40 size-2 shrink-0 rounded-full"
            }
          />
        ) : (
          <Wallet size={15} aria-hidden />
        )}
        <span>
          {connected
            ? formatWalletAddress(connected.address)
            : "Connect wallet"}
        </span>
        {connected && (
          <span
            className={
              connected.kind === "wallet" ? "hidden 2xl:inline" : "text-[10px]"
            }
          >
            · {connected.kind === "wallet" ? "Sui Mainnet" : "Watch-only"}
          </span>
        )}
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-labelledby="wallet-title"
          className="border-line-strong bg-panel text-ink fixed inset-0 m-auto w-[min(92vw,28rem)] rounded-2xl border p-5 shadow-xl backdrop:bg-black/50"
          onCancel={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === dialog.current) {
              const rect = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
              )
                setOpen(false);
            }
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="wallet-title" className="text-lg font-bold">
              Sui Mainnet wallet
            </h2>
            <button
              type="button"
              aria-label="Close wallet dialog"
              className="button-secondary !min-h-10 !p-2"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          {connected && (
            <div className="border-line mt-4 space-y-3 rounded-xl border p-3">
              <p className="text-xs font-semibold">
                {connected.kind === "wallet"
                  ? `Authorized by ${removeEmDashes(connected.walletName)}`
                  : "Watch-only: ownership not verified"}
              </p>
              <p className="font-mono text-xs break-all">{connected.address}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(connected.address);
                      setCopied(true);
                    } catch {
                      setMessage(
                        "Copy is unavailable. Select the address above.",
                      );
                    }
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}Copy
                  address
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    void store?.disconnect();
                    setCopied(false);
                  }}
                >
                  <LogOut size={14} />
                  Disconnect
                </button>
              </div>
            </div>
          )}
          <div className="mt-4 space-y-2">
            {wallets.map((wallet, index) => (
              <button
                type="button"
                key={`${wallet.name}-${index}`}
                className="button-secondary w-full justify-start"
                disabled={busy}
                onClick={async () => {
                  await store?.connect(wallet);
                  if (store?.getSnapshot().connected?.kind === "wallet")
                    setOpen(false);
                }}
              >
                {busy ? "Connecting..." : removeEmDashes(wallet.name)}
              </button>
            ))}
            {wallets.length === 0 && (
              <p className="text-ink/70 text-sm">
                No Sui Wallet Standard provider detected. Open Slush, Suiet,
                Nightly, or a Sui-enabled Phantom wallet, then return here.
              </p>
            )}
            {enoki && (
              <button
                type="button"
                className="button-primary w-full"
                disabled={busy}
                onClick={async () => {
                  await store?.connect(enoki);
                  if (store?.getSnapshot().connected?.kind === "wallet")
                    setOpen(false);
                }}
              >
                Sign in with zkLogin
              </button>
            )}
          </div>
          <form
            className="border-line mt-4 space-y-2 border-t pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              watch(address);
            }}
          >
            <label className="field-label" htmlFor="watch-address">
              Explore any Sui address (watch-only)
            </label>
            <input
              id="watch-address"
              className="field font-mono text-xs"
              placeholder="0x..."
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={66}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="button-secondary w-full" type="submit">
              Use watch-only address
            </button>
            <button
              className="button-secondary w-full"
              type="button"
              onClick={() => watch(WALRUS_WATCH_ADDRESS)}
            >
              Watch Walrus address 0x2f7f...d834
            </button>
            <p className="text-ink/65 text-xs">
              Watch-only access cannot sign, transfer funds, or prove identity.
              Wallet connection alone does not authenticate off-chain credit
              trades.
            </p>
          </form>
          {(message || error) && (
            <p role="alert" className="mt-3 text-sm">
              {removeEmDashes(message ?? error ?? "")}
            </p>
          )}
        </dialog>
      )}
    </>
  );
}
