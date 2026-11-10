# TRUTH-402 Security Policy

## Scope and threat model

TRUTH-402 is a hackathon oracle prototype. Market credits have no cash value, but an explicitly enabled live payment verifier handles **real Sui USDC transfers**. The browser prepares an invoice PTB and asks a Wallet Standard wallet to approve it. The server can submit only exact prepared, already-signed transaction bytes through Tatum; it never has a buyer key or signs transactions. This is a custom HTTP 402 adapter, not a certified x402 / MPP implementation or a financial security audit.

The application trusts the operator, configured Tatum responses, the Walrus delegate/account, the local filesystem and server clock. Participant names and sponsor assertions are not verified identities. There is no anti-sybil mechanism or independently authenticated event-resolution feed. A paid report is an advisory historical estimate, not guaranteed truth, financial advice or a high-impact decision score.

## Secrets and operator access

- Keep `.env.local` and `.data/` ignored, private and out of screenshots. Never use `NEXT_PUBLIC_` for credentials.
- Keep `MEMWAL_PRIVATE_KEY` (delegate key, not wallet seed), `TATUM_API_KEY`, `AGENT_ROUTER_API_KEY` and `VERDICTO_ORACLE_ADMIN_TOKEN` server-side.
- Live operator actions require a bearer token of at least 32 random characters. Comparison uses SHA-256 plus `crypto.timingSafeEqual`, not string equality.
- Market creation, trades, resolution, forecast commits, comparison/revenue reads and insight generation are protected whenever any live provider is enabled. Demo mutation access remains intentionally open.
- Exception: `VERDICTO_PUBLIC_JUDGE_MODE=true` explicitly makes these routes public. Anyone can mutate credit markets and consume configured provider quotas. It is not a production authentication mechanism. Use a dedicated judging namespace and deployment with edge rate limits; disable it after judging. `VERDICTO_REQUIRE_OPERATOR_TOKEN=true` takes precedence. Mainnet-write and durable-storage locks remain enforced.
- Wallet state in localStorage is public metadata only. Typed addresses are watch-only; restoring metadata cannot restore signing authority. Enoki ownership is never inferred from a pasted address. Off-chain credit trade IDs remain self-reported and unauthenticated, even if the client fills one from its connected wallet.
- Operator fields are password inputs, held only in React state and cleared after the action. Never expose an operator session to untrusted users. Deploy behind HTTPS and private/operator access control.
- Errors redact configured provider secrets. Unknown errors do not log full exception/request payloads. External text is escaped by React; user input neutralizes HTML delimiters, bidi controls and forged memory markers.
- Provider URLs are operator configuration, not request-controlled. Tatum and Walrus enforce canonical endpoints. Tatum/Agent Router fetches reject redirects. Use a trusted HTTPS Agent Router, or the loopback default with a local proxy.

## Payment safety

1. **Challenge ownership:** a random 256-bit private invoice token is returned with `Cache-Control: no-store, private`. Only its SHA-256 is stored. The hash is also the reference required inside the payment transaction. It is not enough to scrape someone else's public payment digest/reference.
2. **Resource binding:** invoices bind market, mode, recipient, amount and a five-minute validity window. The client must retain the private token. Never place it on-chain or in a URL.
3. **Settlement verification:** Tatum must return the requested digest, successful effects, a checkpoint and timestamp, and sufficient net `AddressOwner` credit in the exact native-USDC coin type. Amount arithmetic uses `BigInt`. Symbol-only/bridged tokens, object ownership and insufficient credits fail.
4. **Reference binding:** the same programmable transaction must include the exact public reference as a pure string input and settle inside the invoice window. This custom construction needs external wallet support; an ordinary transfer may not qualify.
   Strict binding is the default. Setting `VERDICTO_REQUIRE_STRICT_PTB_BINDING=false` accepts a transaction in `[issuedAt - 60s, expiresAt]` without the reference. This weaker mode plus atomic digest single-use prevents double redemption, but cannot establish who funded the transaction and is vulnerable to appropriation of an unredeemed public transfer. Prefer strict mode. `SUI_ALLOW_ANY_COIN_FALLBACK=true` accepts at least 1,000,000 MIST of native SUI only; MIST is kept out of USDC revenue and royalties.
5. **Single use:** digest replay detection, invoice validation/deletion and receipt insertion occur in one serialized persistence transaction. Used digests are never evicted to make room. A full ledger fails closed.
6. **Durability:** live redemption requires file storage and `VERDICTO_ORACLE_SINGLE_INSTANCE=true`. File storage uses private atomic replacement, not a distributed lock. Run exactly one process on a durable volume. Vercel falls back to memory, so live payments fail closed there.
7. **Header consistency:** `Authorization: Payment` accepts bounded auth parameters, but duplicate keys, conflicting digest/invoice headers and mismatched method/network/ID fail closed. Challenge headers now contain private bearer tokens; redact them in proxy/access logs and screenshots just like JSON invoice bodies. Supporting this grammar is not certified x402/MPP interoperability.
8. **Agent buyer:** the CLI generates synthetic digests only for demo invoices. Live mode resumes a saved 0600 invoice and supplied digest after external settlement of that exact reference. It never signs, sends funds or retries a potentially consumed payment. It rejects non-HTTPS origins outside loopback and all redirects. Keep invoice files in a private ignored location.
9. **Public judge sandbox:** a separate, server-enabled POST route consumes an invoice grant after checkpoint observation and returns `paymentReceipt: null`. Its explicit no-funds/no-payment fields must remain visible. It creates no revenue and does not bypass paid verification. A header supplied by a client is never sufficient to turn `demo-sui-tx-*` into a Mainnet payment.
10. **Royalty accounting:** the exact 8,000-micro-USDC pool is deterministically apportioned by trust times `log1p` of conviction. Empty pools remain unallocated. Accruals are persisted with successful USDC redemptions, not with sandbox grants. No royalty payout implementation or payee wallet authentication is claimed. KL divergence and shifts measure model disagreement, not true expected return.

Do not restore a stale ledger backup after payments: doing so can reopen replay. Stop ingress during recovery and reconcile all successful digests. A response lost after successful consumption is not automatically replayable; there is no refund, payment retry reconciliation or idempotent response cache. This limitation must be resolved before commercial charging. Clock skew can invalidate a legitimate invoice. Tatum gateway authentication and TLS are trusted; the app is not a Sui light client.

## Forecast and memory integrity

- One pre-resolution snapshot is reserved atomically for each market/provider/namespace context. A concurrent trade or resolution invalidates a stale reservation.
- Live forecast commitments require the same durable, single-instance storage as payment redemptions. An ephemeral process cannot be trusted to remember which official pick was already published.
- Retries publish the same frozen record. A pending/failed publication cannot be replaced by a better hindsight forecast.
- New v2 forecast records embed a canonical SHA-256 `forecastHash`, the Sui checkpoint and exact millisecond timestamp. Confirmed proofs expose `contentBound=true` only at `bindingScope=memory-record`. The nested checkpoint/object/transaction observation remains `sui.contentBound=false`; no Move commitment binds the snapshot hash, and no Walrus-to-Sui blob certificate is independently verified. Browser verification checks server-returned record/receipt consistency, not independent provider retrieval or temporal attestation. Legacy records retain their original format.
- A snapshot captured while open can finish publication after resolution; the receipt exposes the times and the `publicationBeforeResolution` flag rather than claiming otherwise.
- Only resolved `participant_performance` evidence changes scoring. Forecast records are excluded from public insights and the learning corpus.
- Preserve the original 20 record bytes and IDs. First-load seed healing appends only missing market IDs and memory blob IDs via an atomic private write. Existing entries and payment/commitment collections always win collisions and are never reset; malformed stores fail closed. Namespace changes are not migrations. Do not restore old ledger backups to undo seed additions.
- Public recalled evidence and source permit reconstruction of current estimates. HTTP 402 sells a delivered report/receipt, not provable informational exclusivity.
- Synthetic benchmarks and demo receipts do not establish live performance or satisfy Mainnet publication requirements.

## Request guards and operational limits

Strict Zod bodies/query/path schemas, streaming byte caps, payment-header caps, same-origin mutation checks, bounded invoice/receipt/commitment queues and process-local rate limiting are enforced. Rates based on forwarded headers are only best-effort: a direct client can spoof them. A trusted proxy must strip untrusted forwarding headers and enforce distributed quotas. Origin validation is CSRF defense, not authentication.

Origin checks use the actual HTTP Host rather than Next's listener hostname and allow the explicitly configured `NEXT_PUBLIC_APP_URL` for TLS proxies. Set that URL to the exact public HTTPS origin in live deployments. Arbitrary `x-forwarded-host` values are not accepted as an origin allowlist.

Health/recall pages can still trigger read-only provider calls in live mode. Use edge limits and restrict a live installation; this is not an internet-scale public service. AI evidence is treated as data, never instructions, but prompt-injection cannot be eliminated by prompting alone. Generated output does not set ranks or settle events.

Security headers include `nosniff`, frame denial, a referrer policy and restricted browser permissions. A strict nonce-based CSP, per-user authentication, distributed persistence/locking, response recovery, provider quotas and infrastructure-level egress controls are deployment work beyond this MVP.

## Verification and reporting

The development-only TypeScript ESLint parser's `minimatch` dependency is narrowly overridden to 11.0.1 for GHSA-g3hv-75wg-m249. Its CommonJS `minimatch` API and supported Node range match this project's usage. Keep lint/type/test gates enabled when updating that dependency, and remove the override when the upstream range includes the fix.

The test suite uses default-deny fetch. Live adapters are validated with mocks, never real credentials. The production smoke runner uses loopback, ephemeral memory storage, demo modes and a TCP preload guard. The guard is not an OS sandbox and does not constrain arbitrary subprocesses or UDP. Do not treat offline QA as a live settlement certification.

Report vulnerabilities privately through GitHub Security Advisories or the repository owner. Include a minimal redacted reproduction, not keys, raw invoices, private data files or wallet material. Rotate any credential exposed during a demo.
