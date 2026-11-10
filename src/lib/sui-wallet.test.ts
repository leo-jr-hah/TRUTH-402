import { describe, expect, it, vi } from "vitest";

import {
  DISCONNECTED_WALLET,
  formatWalletAddress,
  normalizeWalletAddress,
  restoreWallet,
  SUI_MAINNET,
  SuiWalletStore,
  type SuiStandardWallet,
  type SuiWalletAccount,
  WALLET_STORAGE_KEY,
} from "@/lib/sui-wallet";

const account = (suffix = "1"): SuiWalletAccount => ({
  address: `0x${suffix.repeat(64)}`,
  publicKey: new Uint8Array(32),
  chains: [SUI_MAINNET],
  features: ["sui:signTransaction"],
});
function walletFixture() {
  let onChange: (change: {
    accounts?: readonly SuiWalletAccount[];
    chains?: readonly string[];
  }) => void = () => {};
  const off = vi.fn();
  const wallet: SuiStandardWallet = {
    name: "Test Sui Wallet",
    chains: [SUI_MAINNET],
    accounts: [account()],
    features: {
      "standard:connect": {
        connect: vi.fn(async () => ({ accounts: wallet.accounts })),
      },
      "standard:disconnect": { disconnect: vi.fn(async () => {}) },
      "standard:events": {
        on: (_event, callback) => {
          onChange = callback;
          return off;
        },
      },
      "sui:signTransaction": {
        signTransaction: vi.fn(async () => ({
          bytes: "AAAA",
          signature: "BBBB",
        })),
      },
    },
  };
  return {
    wallet,
    change: (change: Parameters<typeof onChange>[0]) => onChange(change),
    off,
  };
}
function browser() {
  const target = new EventTarget() as Window;
  Object.defineProperty(target, "navigator", { value: { wallets: [] } });
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  return { target, storage, data };
}
describe("zero-dependency Sui Wallet Standard connector", () => {
  it("silently reauthorizes persisted wallets across effect remounts and handles cross-tab clearing", async () => {
    const { target, storage } = browser();
    const { wallet } = walletFixture();
    const store = new SuiWalletStore();
    storage.setItem(
      WALLET_STORAGE_KEY,
      JSON.stringify({
        kind: "wallet",
        walletName: wallet.name,
        address: account().address,
      }),
    );
    target.addEventListener("wallet-standard:app-ready", (event) =>
      (event as CustomEvent).detail.register(wallet),
    );
    let stop = store.start(target, storage);
    await vi.waitFor(() => expect(store.getSnapshot().canSign).toBe(true));
    expect(wallet.features["standard:connect"].connect).toHaveBeenCalledWith({
      silent: true,
    });
    stop();
    expect(store.getSnapshot().canSign).toBe(false);
    stop = store.start(target, storage);
    await vi.waitFor(() => expect(store.getSnapshot().canSign).toBe(true));
    const event = new Event("storage");
    Object.assign(event, { key: WALLET_STORAGE_KEY, newValue: null });
    target.dispatchEvent(event);
    expect(store.getSnapshot().connected).toBeNull();
    expect(store.getSnapshot().canSign).toBe(false);
    stop();
  });
  it("negotiates modern and legacy execution without exposing a private key", async () => {
    const { wallet } = walletFixture();
    const execution = vi.fn(async () => ({
      digest: "A".repeat(44),
      bytes: "AAAA",
      signature: "BBBB",
    }));
    const legacy = vi.fn(async () => ({
      transactionBlockBytes: "CCCC",
      signature: "DDDD",
    }));
    wallet.accounts = [
      { ...account(), features: ["sui:signAndExecuteTransaction"] },
    ];
    wallet.features["sui:signAndExecuteTransaction"] = {
      signAndExecuteTransaction: execution,
    };
    const store = new SuiWalletStore();
    await store.connect(wallet);
    const transaction = { toJSON: async () => "{}" };
    expect(await store.signOrExecute(transaction)).toHaveProperty(
      "digest",
      "A".repeat(44),
    );
    expect(execution).toHaveBeenCalledWith(
      expect.objectContaining({ chain: SUI_MAINNET, transaction }),
    );
    wallet.accounts = [
      { ...account(), features: ["sui:signTransactionBlock"] },
    ];
    wallet.features["sui:signTransactionBlock"] = {
      signTransactionBlock: legacy,
    };
    await store.connect(wallet);
    expect(await store.signOrExecute(transaction)).toEqual({
      bytes: "CCCC",
      signature: "DDDD",
    });
    expect(legacy).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: SUI_MAINNET,
        transactionBlock: transaction,
      }),
    );
    await store.disconnect();
  });
  it("normalizes addresses, rejects malformed storage, and never restores signing authority", () => {
    expect(normalizeWalletAddress("0xA")).toBe(`0x${"0".repeat(63)}a`);
    expect(formatWalletAddress(account().address)).toBe("0x1111...1111");
    expect(() => normalizeWalletAddress("0x0")).toThrow();
    expect(() => normalizeWalletAddress("not-a-wallet")).toThrow();
    expect(restoreWallet("broken")).toBeNull();
    expect(
      restoreWallet(
        JSON.stringify({
          address: account().address,
          walletName: "Test",
          kind: "wallet",
        }),
      )?.kind,
    ).toBe("watch-only");
  });
  it("handles early and late event registration, signing, account switches, disconnect and cleanup", async () => {
    const { target, storage } = browser();
    const { wallet, change, off } = walletFixture();
    const store = new SuiWalletStore();
    let unregister = () => {};
    target.addEventListener("wallet-standard:app-ready", (event) => {
      unregister = (event as CustomEvent).detail.register(wallet);
    });
    const stop = store.start(target, storage);
    expect(store.getSnapshot().wallets).toEqual([wallet]);
    await store.connect(wallet);
    expect(store.getSnapshot()).toMatchObject({
      canSign: true,
      connected: { address: account().address, kind: "wallet" },
    });
    const tx = { toJSON: async () => "{}" };
    expect(await store.signOrExecute(tx)).toEqual({
      bytes: "AAAA",
      signature: "BBBB",
    });
    expect(
      wallet.features["sui:signTransaction"]!.signTransaction,
    ).toHaveBeenCalledWith({
      transaction: tx,
      account: account(),
      chain: SUI_MAINNET,
    });
    change({ accounts: [account("2")] });
    expect(store.getSnapshot().connected?.address).toBe(account("2").address);
    change({ chains: ["sui:testnet"] });
    expect(store.getSnapshot().connected).toBeNull();
    expect(off).toHaveBeenCalled();
    await expect(store.signOrExecute(tx)).rejects.toThrow(/watch-only/iu);
    unregister();
    expect(store.getSnapshot().wallets).toEqual([]);
    target.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", {
        detail: (api: { register: (...wallets: unknown[]) => void }) =>
          api.register(wallet),
      }),
    );
    expect(store.getSnapshot().wallets).toEqual([wallet]);
    await store.connect(wallet);
    await store.disconnect();
    expect(storage.getItem(WALLET_STORAGE_KEY)).toBeNull();
    stop();
  });
  it("supports navigator callbacks, ignores non-Sui wallets, and stores only public watch metadata", async () => {
    const { target, storage, data } = browser();
    const { wallet } = walletFixture();
    (target.navigator as Navigator & { wallets: unknown[] }).wallets.push(
      (api: { register: (...wallets: unknown[]) => void }) =>
        api.register(wallet, { ...wallet, chains: ["sui:testnet"] }),
    );
    const store = new SuiWalletStore();
    const stop = store.start(target, storage);
    expect(store.getSnapshot().wallets).toHaveLength(1);
    store.watch(account().address);
    expect(store.getSnapshot().canSign).toBe(false);
    expect(
      Object.keys(JSON.parse(data.get(WALLET_STORAGE_KEY)!)).sort(),
    ).toEqual(["address", "kind", "walletName"]);
    await expect(
      store.signOrExecute({ toJSON: async () => "{}" }),
    ).rejects.toThrow();
    stop();
  });
  it("rejects canceled/no-mainnet connections and does not resurrect a disconnected pending request", async () => {
    const { wallet } = walletFixture();
    const store = new SuiWalletStore();
    vi.mocked(
      wallet.features["standard:connect"].connect,
    ).mockRejectedValueOnce(new Error("private extension error"));
    await store.connect(wallet);
    expect(store.getSnapshot().canSign).toBe(false);
    expect(store.getSnapshot().error).not.toContain("private");
    vi.mocked(
      wallet.features["standard:connect"].connect,
    ).mockResolvedValueOnce({
      accounts: [{ ...account(), chains: ["sui:testnet"] }],
    });
    await store.connect(wallet);
    expect(store.getSnapshot().connected).toBeNull();
    let resolve!: (result: { accounts: SuiWalletAccount[] }) => void;
    vi.mocked(
      wallet.features["standard:connect"].connect,
    ).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = store.connect(wallet);
    await store.disconnect();
    resolve({ accounts: [account()] });
    await pending;
    expect(store.getSnapshot().connected).toEqual(
      DISCONNECTED_WALLET.connected,
    );
  });
});
