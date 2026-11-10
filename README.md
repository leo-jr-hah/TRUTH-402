# TRUTH-402

**Profit rank is luck. Memory rank is skill.**

A memory-calibrated prediction oracle and custom Sui HTTP-402 alpha exchange, evolved from Verdicto for the **Markets & Sports Prediction** track of the Tatum × Walrus Total Recall hackathon. The headline is a product thesis, not a statistical guarantee: both luck and skill contribute to profit, and learned rankings can be wrong.

## What works

- Fixed-prior shrinkage of realized per-share edge, with transparent profit-versus-trust ranks, sample counts, Beta accuracy intervals, and a conviction-concentration calibration chart.
- A neutral/cobalt, responsive interface: interactive rank comparison, category-filtered signals, dual probability bars, LMSR impact previews, and an embedded payment terminal.
- **22 deterministic demo markets and 62 learning records**. Sports, crypto, macro, and governance scenarios are explicitly synthetic. The original 20 Verdicto records retain their exact bytes and IDs.
- A separate six-wallet benchmark: Lucky Whale nets $142,000 from a $0.06 longshot win and a second loss, ranking profit #1 but trust #6. Maya ranks trust #1 across 42 observations, with +18.4 percentage points mean edge. The figures are computed, not hard-coded rankings. This benchmark is not Walrus evidence.
- Walrus Memory `@mysten-incubation/memwal@0.1.9` write/recall adapters, granular resolution receipts, and content-bound pre-resolution snapshots with browser SHA-256 verification.
- Explicit wallet-backfill baseline metadata and post-resolution before/after skill/rank transitions tied to the prior evidence record IDs.
- Tatum's documented Prediction v4 leaderboard, settled history, open positions, trades, and market-holder reads. This external comparison corpus is deliberately separate from local Walrus-backed forecasts.
- Sui checkpoint observations, native-USDC transaction verification, and a ledger separating wallet credits from attributed oracle revenue.
- HTTP 402 challenge → demo or verified live receipt → unlocked signal → atomic single-use replay rejection.
- `npm run agent:x402`: a runnable buyer that discovers the oracle, screens evidence, parses Payment challenges, redeems an invoice and prints the alpha report.
- On-demand Agent Router synthesis. No model is called on page load.
- Native Sui Wallet Standard connection, account-change handling and wallet-approved 0.01-USDC PTBs. No wallet connector library or buyer private keys. Typed addresses are watch-only, not verified zkLogin identities.
- KL divergence, probability-shift VoI heuristics, and deterministic 80/20 integer royalty allocation, recorded atomically with paid receipts. Allocations are not executed payouts or guaranteed profit.
- Read-only Mainnet preflight and an explicitly enabled public judge sandbox, separate from real payment settlement.

## Quick start: safe offline demo

Node.js **22.12+**, npm 10+. No wallet or API keys are needed for the demo.

```bash
cd /Users/leo/Documents/WALRUS/walrus
npm ci
export VERDICTO_MEMORY_MODE=demo
export VERDICTO_TATUM_MODE=demo
export VERDICTO_AI_MODE=demo
export VERDICTO_STORAGE_MODE=memory
export VERDICTO_ENABLE_MAINNET_WRITES=false
export NEXT_TELEMETRY_DISABLED=1
NODE_OPTIONS="--import=/Users/leo/Documents/WALRUS/walrus/scripts/demo-network-guard.mjs" \
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open <http://127.0.0.1:3000>. The homepage comparison and sports terminal are the fastest demo path. In-memory state resets on server restart. Persistent `file` mode now heals old stores on first load: missing seeded markets are appended by `market.id`, and missing demo memories by `blobId`, with one private atomic write. **Existing markets, trades, resolutions, memory text, invoices, commitments and receipts are never replaced.** The original five-market store becomes 22 markets / 62 learning records without a reset. An unchanged store is not rewritten, and malformed files fail closed. Stop the old server before starting a new single-instance process.

Configuration names retain the `VERDICTO_` prefix for compatibility. New installations default to namespace `truth402`; **keep an existing `MEMWAL_NAMESPACE=verdicto` if that is where your records were published**. Changing a namespace is not a migration. See `/Users/leo/Documents/WALRUS/walrus/.env.example` for all settings.

## Verification

From the project directory, with the demo environment above:

```bash
npm run format
git diff --check
npm run check
npm run test:coverage
npm run test:network-guard
NODE_OPTIONS="--import=/Users/leo/Documents/WALRUS/walrus/scripts/demo-network-guard.mjs" npm run build
npm run smoke:production
npm run memories:preview
npm audit --omit=dev
```

`check` runs formatting, TypeScript, ESLint and Vitest. Coverage enforces 85% statements/lines/functions and 75% branches for the configured domain targets, not the entire application. Tests deny unmocked `fetch` by default.

`smoke:production` **does not build**. It starts an already-built Next server on an ephemeral loopback port with demo integrations, memory storage, Mainnet writes disabled and an outbound-TCP guard, runs the smoke workflow, then tears the server down. `npm run smoke` is the same workflow against an existing server; it checks the manifest before loading pages and refuses live providers or file storage.

```bash
# Separate terminal, only while an explicitly all-demo, memory-mode server runs:
SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke
```

Builds use system fonts. No Google font fetch or live provider request is needed. The TCP preload is a QA aid, not an operating-system network sandbox.

Optional browser interaction QA uses the installed Chrome executable, with no downloaded browser library: `npm run smoke:browser`. Set `CHROME_EXECUTABLE` when Chrome is not at the platform default. It starts the same isolated production server, runs API smoke, then exercises desktop/mobile layout, category and ranking controls, evidence links, payment unlock and commitment interactions through the Chrome DevTools Protocol. Screenshots are saved to the OS temporary directory. Live browser requests are blocked by interception.

## Methodology in brief

For YES probability `p` and YES resolution `y ∈ {0,1}`:

```text
eYES = y - p                  eNO = p - y
T    = n/(n+10) × mean(e) / (max(sampleStd(e), 0.05)/sqrt(n))
W    = max(0, T)
P    = clip(pMarket + 0.18 × Σ W·direction·ln(1+size) / Σ W·ln(1+size), .01, .99)
```

An empty or zero-trust cohort produces no directional shift. Wallet conviction is aggregated before logarithmic weighting to prevent trade-splitting amplification. Multi-outcome markets use a centered extension with bounded-simplex normalization.

**Important:** `y-p` is a per-share payout edge, not profit per dollar risked. The corresponding fully settled long-token ROI is `(y-p)/p`. Entry price is not a private probability forecast, so it is not used as a trader Brier score. The requested shrinkage rule is an empirical-Bayes-style **fixed-pseudocount heuristic**; this implementation does not fit a prior to the population. The confidence field is directional agreement, not predicted accuracy. The legacy `skillScore` field is a bounded display index; `shrinkageSkillScore` is the unbounded `T` statistic.

## Payment and commitment contract

`GET /api/oracle/manifest` describes `x402-sui-mpp` / `custom-sui-digest-v1`. **This is not certified standard x402 v2 or MPP interoperability.** Generic clients require a custom adapter.

Unauthenticated signal requests receive `402`, `X-Payment-Required: true`, and:

```http
WWW-Authenticate: Payment method="sui", intent="charge", network="sui:mainnet", currency="USDC", amount="10000", recipient="<configured address>", id="<invoice hash>", invoice="<private token>", invoiceToken="<private token>"
Cache-Control: no-store, private
```

The five-minute invoice has a private bearer `invoiceToken` and its public SHA-256 `paymentReference`. In **live** mode a wallet must transfer at least 10,000 micro-USDC of Circle's native Sui USDC to the exact recipient and include the reference as a pure string input in the same programmable transaction. Retry with `Authorization: Payment method="sui", digest="...", invoice="..."` or both `x-payment-digest` and `x-payment-invoice`. Optional `id` and `network` parameters are validated; duplicate or conflicting credentials fail closed. Header challenges also carry coin type, mode, issue time and expiry. Never put the private token on-chain, in logs or in a URL. A digest alone cannot redeem a live invoice. The browser can request a prepared PTB and ask a connected Wallet Standard wallet to sign/execute it. Sign-only wallets submit the exact prepared bytes through the server's Tatum RPC. The server never owns a buyer key or signs for the buyer. Both paths still redeem through the same strict verifier.

Verification checks successful effects, checkpoint inclusion, exact native coin type, net recipient credit, invoice reference and settlement time window. Invoice consumption and digest insertion share an atomic store transaction. Replays are single-use, not idempotent report retrieval. Save the successful response; recovery after a lost HTTP response requires operator handling.

Live payment prerequisites:

- `VERDICTO_TATUM_MODE=live`, Tatum key, explicit non-demo `SUI_ORACLE_ADDRESS`;
- `VERDICTO_STORAGE_MODE=file` on a durable private volume;
- `VERDICTO_ORACLE_SINGLE_INSTANCE=true`, exactly one process, no serverless payment workers;
- HTTPS, authenticated/trusted operator access and edge-level abuse controls.

Live forecast commitments also require durable single-instance storage so a restart cannot forget an official pick.

Any live provider enables operator authorization for market mutations, commits, comparison/revenue reads and AI generation by default. Set `VERDICTO_ORACLE_ADMIN_TOKEN` to at least 32 random characters. `VERDICTO_PUBLIC_JUDGE_MODE=true` explicitly opens those routes and removes UI password prompts; use a separate judging deployment with edge quotas and a dedicated evidence namespace. `VERDICTO_REQUIRE_OPERATOR_TOKEN=true` overrides public judging and forces authentication. Walrus writes still require `VERDICTO_ENABLE_MAINNET_WRITES=true` and valid Mainnet delegate credentials; public mode never bypasses that lock or durable payment storage.

### Wallets, judge sandbox and Mainnet readiness

The header discovers Sui Wallet Standard providers (including a genuinely registered Enoki provider). Wallet metadata in `truth402.wallet` is restored as watch-only until the extension reauthorizes it. Entering any address, including the supplied Walrus address, does not prove ownership. Enoki requires its own API key, OAuth client/callback and authenticated wallet registration; those credentials are not bundled or invented. The off-chain credit market still uses self-reported participant IDs, not signed trade authentication.

The live browser runner stays enabled. It can prepare an invoice for a connected signing wallet or accept a digest for that invoice. With public judge mode enabled it also offers **Instant sponsored sandbox access**: a separate POST endpoint checks the configured Tatum checkpoint and returns `paymentReceipt: null`, `paymentVerified: false`, and `fundsMoved: false`. This is a public report grant, not a sponsored USDC transfer. It consumes the grant invoice but never creates payment revenue or royalty accrual. Sending a sponsored header to the paid endpoint never makes a fake digest valid.

`VERDICTO_REQUIRE_STRICT_PTB_BINDING=false` explicitly enables weaker settlement-time binding in `[issuedAt - 60 seconds, expiresAt]`; strict reference binding remains the default. This compatibility mode cannot establish payer ownership and must not be used where transaction appropriation is unacceptable. `SUI_ALLOW_ANY_COIN_FALLBACK=true` accepts only native SUI of at least 1,000,000 MIST as a separately labeled alternative, not arbitrary coins or USDC-equivalent revenue.

```bash
cd /Users/leo/Documents/WALRUS/walrus
npm run preflight:mainnet
```

Preflight loads local environment files and performs read-only Tatum checkpoint/trader, Walrus health/paginated inventory, Agent Router, and Mainnet receipt-manifest checks. It redacts credentials, verifies the first ten blob IDs against both manifests and current namespace inventory, and exits nonzero for missing, failed or incomplete readiness. It never publishes memories, signs a payment, invokes generation or writes the store. Run it separately from guarded offline QA.

A commit captures Sui checkpoint metadata first, then freezes a canonical snapshot per market/provider/namespace context. SHA-256 binds market/timing fields, probabilities, trusted backers and evidence IDs/blob references. New v2 `oracle_forecast` records carry `episode=pre_event_pick`, `forecastHash`, `suiCheckpoint`, `suiTimestamp` and `contentBound=true`; the same record is submitted through Walrus `rememberAndWait`. The receipt reports `bindingScope=memory-record`. Paid reports include the structured record for the **Verify Forecast Hash** browser inspector. Legacy snapshots retain their original format and are never rewritten.

**A checkpoint observation is not an on-chain content binding or proof that a forecast preceded a real-world event.** The nested Sui observation retains `contentBound=false`. Browser verification checks the server-returned content against the receipt, not independent Walrus retrieval/certification. Capture/publication times and sponsor resolution are server asserted. Forecast records never feed resolved-evidence scoring or free insights.

## Run the autonomous buyer

The buyer is a client, not a server launcher. Use **two terminals**. The temporary server used by `smoke:production` is stopped when that command finishes.

**Terminal 1:** start the safe demo server and leave it running. These overrides keep local credentials inactive and do not modify the saved file store.

```bash
cd /Users/leo/Documents/WALRUS/walrus
VERDICTO_MEMORY_MODE=demo \
VERDICTO_TATUM_MODE=demo \
VERDICTO_AI_MODE=demo \
VERDICTO_STORAGE_MODE=memory \
VERDICTO_ENABLE_MAINNET_WRITES=false \
NEXT_TELEMETRY_DISABLED=1 \
NODE_OPTIONS="--import=/Users/leo/Documents/WALRUS/walrus/scripts/demo-network-guard.mjs" \
npm run dev -- --hostname 127.0.0.1 --port 3000
```

With an existing production build, use `npm run start -- --hostname 127.0.0.1 --port 3000` instead of the last line, keeping the same environment overrides.

**Terminal 2:** after the server prints `Ready`, run the buyer:

```bash
cd /Users/leo/Documents/WALRUS/walrus
npm run agent:x402 -- --base-url http://127.0.0.1:3000 --market mkt-sports-final
```

If discovery reports a connection failure, check `curl --fail --silent --show-error http://127.0.0.1:3000/api/oracle/manifest`. Keep Terminal 1 running and match `--base-url` to the server's actual host and port. No payment redemption is attempted when discovery fails.

The buyer discovers the manifest, requests a 402 challenge, checks `trackedBackers` and `memoryCount`, generates a unique demo digest, redeems via `Authorization: Payment`, and prints probabilities, alpha shifts, verification latency and evidence blob IDs. This deterministic evidence-availability screen is not a modeled monetary EVI or an LLM invocation. Demo mode moves no funds.

Live mode never fabricates a settlement or accepts an unrelated pre-existing transfer. Prepare a challenge with `--save-invoice /absolute/private/invoice.json` (0600), fund that exact public PTB reference externally within five minutes, then resume the same origin/market with `--invoice-file /absolute/private/invoice.json` and `SUI_TX_DIGEST` supplied securely in the environment. The private invoice remains local; only its public reference goes on-chain. No auto-retry follows a potentially consumed payment. See `npm run agent:x402 -- --help`.

## Endpoints

| Method   | Endpoint                          | Purpose                                                         |
| -------- | --------------------------------- | --------------------------------------------------------------- |
| GET      | `/api/oracle/manifest`            | Runtime modes, custom payment discovery and OpenAPI outline     |
| GET      | `/api/oracle/markets/{id}/signal` | 402 invoice or paid report with exact evidence references       |
| POST     | `/api/oracle/markets/{id}/commit` | Freeze/publish one pre-resolution snapshot; public receipt only |
| GET      | `/api/oracle/calibration`         | Bounded external trader comparison and ingestion counts         |
| GET      | `/api/oracle/revenue`             | Wallet balance and locally attributed receipts                  |
| GET/POST | `/api/markets`                    | List/create simulated markets                                   |
| GET      | `/api/markets/{id}`               | Market state                                                    |
| POST     | `/api/markets/{id}/trade`         | Simulated conviction position                                   |
| POST     | `/api/markets/{id}/resolve`       | Resolution and granular memory publication                      |
| GET      | `/api/insights`                   | Recalled resolved evidence and scoring                          |
| POST     | `/api/insights/generate`          | On-demand evidence-bound synthesis                              |
| GET      | `/api/health`                     | Walrus health, Tatum checkpoint health, AI configuration        |

Tatum v4's actual paths are `/wallets/{address}/history` for closed positions and `/markets/{id}/positions` for top holders. The leaderboard uses `category=CRYPTO&timePeriod=MONTH`, not `period=30d`. Queries use `x-api-key`, bounded pages and no credential-bearing redirects. Live JSON-RPC availability and account entitlements still require operator validation.

## Boundaries and operations

Demo and live modes never silently substitute for one another. Public demo previews are current estimates, not the paid frozen snapshot. Public source/evidence makes this an auditable service, not a guarantee of exclusive information. Tatum comparison rows are not automatically published to Walrus or mapped into local simulated positions. No claim of live backtesting, autonomous event resolution, verified trader identity, profitable alpha or Mainnet publication is made by offline tests.

Publishing is separate and opt-in: `npm run memories:publish -- --execute` requires the write lock and credentials. Previewing alone publishes nothing. Read-only inventory verifies namespace counts, not forecast-content anchoring.

Documentation in this checkout:

- `/Users/leo/Documents/WALRUS/walrus/docs/ARCHITECTURE.md`: formulas, evidence semantics and data flow.
- `/Users/leo/Documents/WALRUS/walrus/docs/DEMO.md`: judge walkthrough.
- `/Users/leo/Documents/WALRUS/walrus/docs/MAINNET_RUNBOOK.md`: opt-in live operations.
- `/Users/leo/Documents/WALRUS/walrus/SECURITY.md`: threat model and live deployment requirements.
- `/Users/leo/Documents/WALRUS/walrus/docs/BLOG_POST.md`: accurate product narrative.

MIT licensed. No funds, provider data resets or Mainnet writes are part of QA.
