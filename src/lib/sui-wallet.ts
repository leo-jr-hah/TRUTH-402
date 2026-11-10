/** Minimal Wallet Standard adapter. No wallet library, private keys, or OAuth impersonation. */
export const SUI_MAINNET = "sui:mainnet";
export const WALLET_STORAGE_KEY = "truth402.wallet";
export const WALRUS_WATCH_ADDRESS =
  "0x2f7f8b1946ad3483bb93336b80713b1cfefba0b23370416979bb4c7bb823d834";

export interface SuiWalletAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
  label?: string;
}
export interface WalletTransaction {
  toJSON(): Promise<string>;
}
interface SignInput {
  transaction: WalletTransaction;
  account: SuiWalletAccount;
  chain: string;
}
interface SignedTransaction {
  bytes: string;
  signature: string;
}
export interface SuiStandardWallet {
  name: string;
  chains: readonly string[];
  accounts: readonly SuiWalletAccount[];
  features: {
    "standard:connect": {
      connect(input?: {
        silent?: boolean;
      }): Promise<{ accounts: readonly SuiWalletAccount[] }>;
    };
    "standard:disconnect"?: { disconnect(): Promise<void> };
    "standard:events"?: {
      on(
        event: "change",
        listener: (change: {
          accounts?: readonly SuiWalletAccount[];
          chains?: readonly string[];
        }) => void,
      ): () => void;
    };
    "sui:signTransaction"?: {
      signTransaction(input: SignInput): Promise<SignedTransaction>;
    };
    "sui:signAndExecuteTransaction"?: {
      signAndExecuteTransaction(
        input: SignInput,
      ): Promise<SignedTransaction & { digest: string }>;
    };
    "sui:signTransactionBlock"?: {
      signTransactionBlock(
        input: Omit<SignInput, "transaction"> & {
          transactionBlock: WalletTransaction;
        },
      ): Promise<{ transactionBlockBytes: string; signature: string }>;
    };
    "sui:signAndExecuteTransactionBlock"?: {
      signAndExecuteTransactionBlock(
        input: Omit<SignInput, "transaction"> & {
          transactionBlock: WalletTransaction;
        },
      ): Promise<{ digest: string }>;
    };
  };
}
export interface ConnectedSuiAddress {
  address: string;
  walletName: string;
  kind: "wallet" | "watch-only";
}
export interface WalletState {
  wallets: readonly SuiStandardWallet[];
  connected: ConnectedSuiAddress | null;
  busy: boolean;
  canSign: boolean;
  error: string | null;
}
export const DISCONNECTED_WALLET: WalletState = {
  wallets: [],
  connected: null,
  busy: false,
  canSign: false,
  error: null,
};

export function normalizeWalletAddress(value: string): string {
  if (
    !/^0x[0-9a-fA-F]{1,64}$/u.test(value.trim()) ||
    /^0x0+$/iu.test(value.trim())
  )
    throw new Error("Enter a nonzero Sui 0x address.");
  return `0x${value.trim().slice(2).toLowerCase().padStart(64, "0")}`;
}
export function formatWalletAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
function standardWallet(value: unknown): value is SuiStandardWallet {
  if (!value || typeof value !== "object") return false;
  const wallet = value as SuiStandardWallet;
  return (
    typeof wallet.name === "string" &&
    Array.isArray(wallet.chains) &&
    wallet.chains.includes(SUI_MAINNET) &&
    Array.isArray(wallet.accounts) &&
    typeof wallet.features?.["standard:connect"]?.connect === "function"
  );
}
function mainnetAccount(
  accounts: readonly SuiWalletAccount[],
): SuiWalletAccount | undefined {
  return accounts.find((account) => {
    try {
      normalizeWalletAddress(account.address);
      return account.chains.includes(SUI_MAINNET);
    } catch {
      return false;
    }
  });
}

/** Restored metadata is watch-only until the extension reauthorizes the account. */
export function restoreWallet(raw: string | null): ConnectedSuiAddress | null {
  try {
    if (!raw || raw.length > 1000) return null;
    const value = JSON.parse(raw) as ConnectedSuiAddress;
    if (
      typeof value.walletName !== "string" ||
      value.walletName.length > 100 ||
      !["wallet", "watch-only"].includes(value.kind)
    )
      return null;
    return {
      address: normalizeWalletAddress(value.address),
      walletName: value.walletName,
      kind: "watch-only",
    };
  } catch {
    return null;
  }
}

export class SuiWalletStore {
  private state: WalletState = DISCONNECTED_WALLET;
  private listeners = new Set<() => void>();
  private selected: SuiStandardWallet | null = null;
  private account: SuiWalletAccount | null = null;
  private offAccount?: () => void;
  private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private generation = 0;
  private restored: ConnectedSuiAddress | null = null;
  private restoredAttempt = new Set<SuiStandardWallet>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<WalletState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private persist(value: ConnectedSuiAddress | null) {
    try {
      if (value)
        this.storage?.setItem(WALLET_STORAGE_KEY, JSON.stringify(value));
      else this.storage?.removeItem(WALLET_STORAGE_KEY);
    } catch {
      /* Private browsing does not prevent connecting. */
    }
  }
  private clear() {
    this.generation++;
    this.offAccount?.();
    this.offAccount = undefined;
    this.selected = null;
    this.account = null;
    this.restored = null;
  }
  private select(wallet: SuiStandardWallet, account: SuiWalletAccount) {
    this.selected = wallet;
    this.account = account;
    const connected: ConnectedSuiAddress = {
      address: normalizeWalletAddress(account.address),
      walletName: wallet.name,
      kind: "wallet",
    };
    const canSign = [
      "sui:signTransaction",
      "sui:signAndExecuteTransaction",
      "sui:signTransactionBlock",
      "sui:signAndExecuteTransactionBlock",
    ].some(
      (key) =>
        account.features.includes(key) &&
        Boolean(wallet.features[key as keyof SuiStandardWallet["features"]]),
    );
    this.update({ connected, canSign, busy: false, error: null });
    this.persist(connected);
  }
  async connect(wallet: SuiStandardWallet, silent = false) {
    this.clear();
    const generation = this.generation;
    this.update({ busy: true, canSign: false, error: null, connected: null });
    try {
      if (!standardWallet(wallet))
        throw new Error("Choose a Sui Mainnet Wallet Standard wallet.");
      const result = await wallet.features["standard:connect"].connect({
        silent,
      });
      if (generation !== this.generation) return;
      const account = mainnetAccount(result.accounts);
      if (!account)
        throw new Error("Authorize a Sui Mainnet account in your wallet.");
      this.select(wallet, account);
      this.offAccount = wallet.features["standard:events"]?.on(
        "change",
        (change) => {
          if (this.selected !== wallet) return;
          const next = mainnetAccount(change.accounts ?? wallet.accounts);
          if (
            !next ||
            (change.chains && !change.chains.includes(SUI_MAINNET))
          ) {
            this.clear();
            this.persist(null);
            this.update({ connected: null, canSign: false, busy: false });
          } else this.select(wallet, next);
        },
      );
    } catch {
      if (generation !== this.generation) return;
      this.update({
        busy: false,
        connected: null,
        canSign: false,
        error: silent
          ? null
          : "Wallet connection was declined or no Sui Mainnet account was authorized.",
      });
      this.persist(null);
    }
  }
  watch(address: string) {
    const connected: ConnectedSuiAddress = {
      address: normalizeWalletAddress(address),
      walletName: "Watch-only address",
      kind: "watch-only",
    };
    this.clear();
    this.update({ connected, canSign: false, busy: false, error: null });
    this.persist(connected);
  }
  async disconnect() {
    const wallet = this.selected;
    this.clear();
    this.persist(null);
    this.update({ connected: null, canSign: false, busy: false, error: null });
    try {
      await wallet?.features["standard:disconnect"]?.disconnect();
    } catch {
      /* Local state is already disconnected. */
    }
  }
  async signOrExecute(
    transaction: WalletTransaction,
  ): Promise<{ digest: string } | SignedTransaction> {
    const wallet = this.selected,
      account = this.account;
    if (
      !wallet ||
      !account ||
      !this.state.canSign ||
      this.state.connected?.kind !== "wallet" ||
      !account.chains.includes(SUI_MAINNET)
    )
      throw new Error(
        "Connect a signing Sui Mainnet wallet. A watch-only address cannot pay.",
      );
    const input = { transaction, account, chain: SUI_MAINNET };
    const supports = (key: string) => account.features.includes(key);
    if (
      wallet.features["sui:signAndExecuteTransaction"] &&
      supports("sui:signAndExecuteTransaction")
    )
      return wallet.features[
        "sui:signAndExecuteTransaction"
      ].signAndExecuteTransaction(input);
    if (
      wallet.features["sui:signTransaction"] &&
      supports("sui:signTransaction")
    )
      return wallet.features["sui:signTransaction"].signTransaction(input);
    const legacy = {
      account,
      chain: SUI_MAINNET,
      transactionBlock: transaction,
    };
    if (
      wallet.features["sui:signAndExecuteTransactionBlock"] &&
      supports("sui:signAndExecuteTransactionBlock")
    )
      return wallet.features[
        "sui:signAndExecuteTransactionBlock"
      ].signAndExecuteTransactionBlock(legacy);
    if (
      wallet.features["sui:signTransactionBlock"] &&
      supports("sui:signTransactionBlock")
    ) {
      const signed =
        await wallet.features["sui:signTransactionBlock"].signTransactionBlock(
          legacy,
        );
      return {
        bytes: signed.transactionBlockBytes,
        signature: signed.signature,
      };
    }
    throw new Error("This wallet does not support transaction signing.");
  }
  start(
    target: Window,
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ) {
    this.storage = storage;
    this.restoredAttempt.clear();
    this.update({ ...DISCONNECTED_WALLET });
    try {
      this.restored = restoreWallet(
        storage?.getItem(WALLET_STORAGE_KEY) ?? null,
      );
    } catch {
      this.restored = null;
    }
    if (this.restored) this.update({ connected: this.restored });
    const registered = new Set<SuiStandardWallet>();
    let stopped = false;
    const publish = () => this.update({ wallets: [...registered] });
    const register = (...values: unknown[]) => {
      if (stopped) return () => {};
      const added = values
        .filter(standardWallet)
        .filter((wallet) => !registered.has(wallet));
      added.forEach((wallet) => registered.add(wallet));
      if (added.length) publish();
      for (const wallet of added)
        if (
          this.restored?.walletName === wallet.name &&
          !this.restoredAttempt.has(wallet)
        ) {
          this.restoredAttempt.add(wallet);
          void this.connect(wallet, true);
        }
      return () => {
        if (stopped) return;
        added.forEach((wallet) => {
          registered.delete(wallet);
          if (this.selected === wallet) void this.disconnect();
        });
        publish();
      };
    };
    const api = Object.freeze({ register });
    const onRegister = (event: Event) => {
      const callback = (event as CustomEvent<unknown>).detail;
      try {
        if (typeof callback === "function") callback(api);
      } catch {
        /* One broken extension cannot block another. */
      }
    };
    target.addEventListener("wallet-standard:register-wallet", onRegister);
    target.dispatchEvent(
      new CustomEvent("wallet-standard:app-ready", { detail: api }),
    );
    const inspect = () => {
      const win = target as unknown as Record<string, unknown>;
      const nested = (value: unknown) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>).sui
          : undefined;
      register(
        win.suiWallet,
        win.slush,
        win.suiet,
        win.nightly,
        nested(win.nightly),
        nested(win.phantom),
      );
      const legacy = (target.navigator as Navigator & { wallets?: unknown })
        .wallets;
      if (Array.isArray(legacy))
        for (const candidate of legacy) {
          try {
            if (typeof candidate === "function") candidate(api);
            else register(candidate);
          } catch {
            /* Unsupported legacy registration. */
          }
        }
    };
    inspect();
    target.addEventListener("focus", inspect);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WALLET_STORAGE_KEY && event.key !== null) return;
      this.clear();
      this.update({
        connected: restoreWallet(event.newValue),
        canSign: false,
        busy: false,
        error: null,
      });
    };
    target.addEventListener("storage", onStorage);
    return () => {
      stopped = true;
      this.clear();
      this.update({ ...DISCONNECTED_WALLET });
      target.removeEventListener("wallet-standard:register-wallet", onRegister);
      target.removeEventListener("focus", inspect);
      target.removeEventListener("storage", onStorage);
    };
  }
}
