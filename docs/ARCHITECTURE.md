# TRUTH-402 Architecture

## 1. Separate the sources of truth

```text
Simulated markets → positions → sponsor resolution → granular memory records
                                                       ↓
                 Walrus / demo recall → parse → deduplicate → realized edge
                                                       ↓
                       shrinkage skill → trusted conviction → oracle estimate
                                                       ↓
                    frozen forecast → Walrus receipt + checkpoint observation
                                                       ↓
                  HTTP 402 invoice → Sui receipt verification → paid report

Tatum Prediction → bounded external comparison (never silently local evidence)
Agent Router    → optional evidence summary (never a scoring or settlement input)
```

Next.js App Router uses Server Components for initial data and client components for explicit actions. All provider credentials stay in server-only modules. The current checkout lives at `/Users/leo/Documents/WALRUS/walrus`; paths below identify modules under that root.

| Responsibility                              | Module                                                             |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Market state and publication retries        | `/Users/leo/Documents/WALRUS/walrus/src/lib/services/markets.ts`   |
| Resolved corpus, deduplication, cache       | `/Users/leo/Documents/WALRUS/walrus/src/lib/services/insights.ts`  |
| Shrinkage, ranking, forecast math           | `/Users/leo/Documents/WALRUS/walrus/src/lib/memory/credibility.ts` |
| Frozen snapshots and evidence proofs        | `/Users/leo/Documents/WALRUS/walrus/src/lib/services/oracle.ts`    |
| HTTP 402 invoice and operator authorization | `/Users/leo/Documents/WALRUS/walrus/src/lib/x402.ts`               |
| Tatum RPC and Prediction adapters           | `/Users/leo/Documents/WALRUS/walrus/src/lib/tatum.ts`              |
| Atomic repository operations                | `/Users/leo/Documents/WALRUS/walrus/src/lib/store.ts`              |

## 2. Market mechanics and resolution

Markets retain the TRUTH402 `simple` and `opportunity` types. Their prices are simulated LMSR probabilities, not an imported orderbook or tradable asset:

```text
C(q) = b × ln(Σ exp(q_i / b))
p_i  = exp(q_i / b) / Σ exp(q_j / b)
```

The implementation subtracts the largest quantity before exponentiation. A bounded binary search solves the shares purchased with a credit amount. The same pure function powers the client impact preview. A sponsor selects the winning outcome with a rationale; `sponsorFollowedSignal` is true only for a strictly highest closing price. A tie never counts as followed.

The decision is persisted before external memory writes. Resolution publishes one `market_resolution`, one `market_signal`, and one `participant_performance` per participant. The selected participant outcome is greatest aggregate conviction, then earliest trade time, outcome order, and outcome ID. Repeated trades do not inflate observation counts. Publication retries reuse the record ID and skip confirmed receipts for the active provider.

New resolutions also freeze a `learningUpdate` inside the resolution record: the exact prior performance-record IDs, provider context, and before/after mean edge, sample count, `T`, profit rank, trust rank and delta for the comparison cohort. Retries reuse the saved transition rather than recalculating it against a changed corpus. This is a transition relative to a specific recalled snapshot, not a claim that concurrent market resolutions form a globally serialized analytics history.

## 3. Realized edge and shrinkage skill

The pure API exports:

- `computeRealizedEdge(side, entryPrice, outcomeWon)`
- `computeShrinkageSkillScore(edges, k0=10, sigmaMin=0.05)`
- `computeProfitVsTrustRanking(participants)`
- `computeOracleForecast(marketPrice, positions, lambda=0.18)`

For YES entry probability `p` and YES settlement `y`:

```text
e(YES) = y - p
e(NO)  = p - y
```

`computeRealizedEdge` always takes the YES price and YES outcome. Provider closed-position records instead quote the **held outcome token**. For those records the equivalent edge is `heldTokenSettlement - heldTokenEntryPrice`, regardless of the label YES or NO. Do not apply the NO transformation twice.

The result is **per-share payout edge**, not profit per dollar risked. A fully settled long-token position's ROI is `edge / entryPrice`. Legacy local `rawPnl` remains a labeled conviction-weighted edge proxy, not cash PnL. Tatum's supplied PnL is USD and can include unrealized PnL on the leaderboard. Neither stake nor dollar profit influences the skill statistic.

For `n > 0`:

```text
meanEdge        = Σ e_i / n
sampleVariance  = Σ (e_i - meanEdge)^2 / (n - 1)  when n > 1, otherwise 0
stdEdge         = max(sqrt(sampleVariance), 0.05)
tStat           = meanEdge / (stdEdge / sqrt(n))
shrinkageFactor = n / (n + 10)
T = skillScore  = shrinkageFactor × tStat
trustWeight     = max(0, T)
```

Empty samples return zero mean/statistic/weight. Inputs must be finite and within their domains. Tiny samples are shrunk, but the floor can still produce a positive one-win score; the formula does not guarantee every multi-market wallet outranks every lucky wallet. This is an **empirical-Bayes-style fixed-prior heuristic**, not a fitted empirical Bayes posterior or a significance test. Correlated positions, selection bias and regime changes remain limitations.

The compatibility wrapper retains `meanRealizedEdge`, `shrinkageSkillScore=T` and `skillScore=50 + 100/π × atan(T/2)` for existing consumers. That bounded index is not a probability.

Profit ranks sort by raw PnL with participant ID as a tie-break. Trust ranks sort by `T`, sample count, then participant ID. `rankDelta = profitRank - trustRank`. Negative `T` is `overconfident`; a profitable, downgraded sample with fewer than ten observations is `lucky_whale`; positive `T` with at least ten observations is `calibrated_sharp`; otherwise `emerging`. These are explanatory UI classifications, not verified identities or recommendations.

## 4. Memory-shifted probabilities

Binary forecast:

```text
a_w = max(0,T_w) × ln(1 + size_w)
direction = Σ a_w d_w / Σ a_w              d_w ∈ {+1,-1}
P = clip(pMarket + 0.18 × direction, 0.01, 0.99)
```

The numerator is zero when there is no trusted position. `confidenceLevel = abs(direction)` measures directional agreement, not forecast accuracy. We aggregate each participant/outcome's conviction before applying `log1p`; splitting a trade cannot amplify the signal.

For `K` outcomes, the application centers each outcome's trusted support against the other `K-1` outcomes:

```text
rawP_j = p_j + lambda × (K × support_j / totalSupport - 1) / (K - 1)
```

It clips to `[0.01,0.99]` and redistributes clipping residual among unsaturated outcomes to remain on the probability simplex. At `K=2`, this is the binary formula exactly. With no trusted support, prices are retained except at the safety clip boundaries. Up to 12 outcomes are supported.

Only currently backing participants with positive `T` and a complete recalled set of their scoring record IDs contribute. The paid snapshot enumerates exactly those `recordId`/`blobId`/provider references. If the requested recalled window is incomplete, the affected backer's trust is excluded rather than supported by missing citations.

## 5. Memory compatibility and provenance

The existing schema stays `verdicto.memory`, version 1, with terminal marker `VERDICTO_DATA_V1:`. IDs are:

```text
sha256(UTF8(JSON.stringify([kind, marketId, subjectId, schemaVersion])))
```

Subjects are the winning outcome, closing leader, participant, or forecast content hash. Human-readable memory serialization remains byte-compatible. The SHA-256 of `JSON.stringify(originalFirst20Memories)` remains:

```text
a731366e8be6f597d3ad0852d099e44b979f2366a96c54f7a625aea1fb4dcd55
```

The fresh seed adds 42 records across eight synthetic resolved scenarios, for **62 records**. It includes 22 markets: 11 resolved and 11 open. New sports/crypto/macro/governance records carry synthetic provenance and category labels. Existing file-backed databases are not reseeded. Namespace `truth402` is the new default; old `truth402` namespaces must remain explicitly configured to recall those records.

Additive synthetic performance records include `episode: wallet_backfill` and a baseline score/rank snapshot. Baselines are derived from the complete deterministic fixture; they are not claimed to have existed before those scenarios resolved. Scoring always recomputes from observations, never trusts a stored baseline or rank field.

Old performance records without entries are enriched in a **scoring copy** using matching trades: amount/shares VWAP first, weighted price-before second, then a labeled legacy complement estimate, or neutral 0.5. Provider bytes and IDs never change. Derived edge is recomputed, not trusted from an arbitrary record field. Browser/API text normalizes em dashes; storage and hashing do not.

The separate six-wallet benchmark is not merged into Walrus evidence. It demonstrates Maya #1, Amina #2 and Lucky Whale #6 trust, while the whale leads USD PnL. Local recalled records have their own cohort and ranks. Tatum's live comparison uses at most six CRYPTO monthly leaderboard wallets and 50 recent closed rows per wallet, potentially across categories. Differences between leaderboard and sampled-history windows are disclosed.

## 6. Accuracy, uncertainty and recency

Accuracy remains separate from per-share edge:

```text
Beta posterior = Beta(correct + 1, total - correct + 1)
mean           = (correct + 1) / (total + 2)
90% interval   = [BetaQuantile(.05), BetaQuantile(.95)]
```

The interval uses deterministic incomplete-Beta evaluation and bisection. Overall, simple and opportunity scopes are independent. No evidence displays as missing, not a fabricated score. Recency mode uses `2^(-ageDays/180)` anchored to the newest record, not the current wall clock, and shows fractional effective evidence counts. It changes Beta accuracy and calibration, **not** the equal-weight shrinkage statistic.

The legacy `confidence` field is the share of a participant's conviction assigned to the chosen outcome. The calibration curve compares that concentration to observed correctness. It is not a reliability diagram of elicited private beliefs, and no trader-entry Brier score is claimed.

## 7. Forecast snapshots

The first commit reads Sui checkpoint sequence and exact `timestampMs`, then captures current market state and freezes a versioned canonical payload:

```text
{ schema: "truth402.forecast", version: 1,
  marketId, marketUpdatedAt, capturedAt, suiCheckpoint, suiTimestamp,
  probabilities, trustedBackers, evidenceRecordIds, evidenceBlobs }
```

`suiTimestamp` is the decimal millisecond string, not a locale-dependent date. UTF-8 JSON has recursively sorted object keys, finite numbers and no whitespace. Probability/backer/evidence collections are ordered by stable IDs. SHA-256 produces `forecastHash`; `contentHash` retains the same value for compatibility. The v2 `oracle_forecast` record embeds the hash, checkpoint, timestamp, `episode=pre_event_pick` and `contentBound=true`. It remains a distinct memory kind so pre-event picks cannot become resolved scoring inputs. Walrus `rememberAndWait` receives this exact structured record inside the memory envelope with the record ID as its idempotency key.

A store transaction verifies the market is still open and unchanged before reserving it. Process-local single-flight avoids concurrent duplicate publication; subsequent calls return or retry the same record. A confirmed legacy snapshot is not upgraded or replaced. Its original hash format and false content-bound flag remain inspectable.

The confirmed receipt exposes `contentBound=true, bindingScope=memory-record` for the new format. This is content binding **inside the memory record**, not an on-chain timestamp attestation. A Walrus blob ID is a content address, not a literal container for the hash/checkpoint strings. The provider receipt associates that blob with the submitted record. Demo receipt IDs represent local storage only.

Paid responses include the structured `forecastRecord`. The browser's Verify Forecast Hash action uses Web Crypto to rebuild the canonical payload, compare displayed probabilities with the record, validate the content hash and canonical record ID, and match receipt metadata. This verifies consistency of the server-returned record; it does not independently fetch/decrypt the provider blob or verify a Walrus storage certificate.

Sui reads can observe a checkpoint, an object, or transaction inclusion when supplied an identifier. **None bind the forecast hash to Sui.** The nested `sui.contentBound=false` remains mandatory. Capture/publication times are server assertions and the fixed demo checkpoint is synthetic. There is no proof of precedence over a real event without authenticated event timing and on-chain content binding. Publication may finish after resolution; `publicationBeforeResolution` exposes this honestly.

`oracle_forecast` records are excluded from public recall/insights and resolved scoring. A paid query uses the frozen snapshot once reserved, even after subsequent trading or resolution. A resolved market with no pre-event reservation is rejected, preventing hindsight forecast creation. Pending publication remains frozen and exposes no confirmed proof.

## 8. Payment protocol and ledger

The manifest labels `x402-sui-mpp` / `custom-sui-digest-v1`. Its OpenAPI outline is discovery, not facilitator or wallet interoperability certification.

Challenges use `WWW-Authenticate: Payment` with method, intent, network, currency, amount, recipient, invoice ID, private `invoice`/`invoiceToken`, coin type, mode and validity times. Both JSON and header terms can be parsed independently. Credential parsing accepts `x-payment-digest` and `x-payment-invoice`, or multi-parameter `Authorization: Payment method="sui", digest="...", invoice="..."`. Auth scheme and parameter names are case-insensitive; quoted-pair and token grammar is accepted. Duplicate keys, conflicting header values, wrong method/network, invalid tokens and mismatched invoice IDs are rejected before redemption. The Authorization cap is 2048 bytes; custom headers retain 256-byte caps. This is HTTP auth-param compatibility, not standard x402-v2 payment payload or MPP credential certification.

Unpaid queries issue private five-minute invoices. Live redemption verifies successful Tatum transaction effects, exact native-USDC net recipient credit, checkpoint, timestamp window and the invoice reference in a pure string PTB input. The private token is never placed on-chain. Digest-only live claims fail. Invoice consumption and receipt insertion share the repository's exclusive queue and atomic file replacement.

No multi-process lock exists. Real live redemption fails unless durable file mode and explicit single-instance acknowledgment are configured. Used digests persist across process cache resets. The ledger never evicts them to regain capacity. Wallet balance, recent incoming transactions and **attributed redeemed queries** are different metrics. A recent page is not complete lifetime history.

The CLI at `/Users/leo/Documents/WALRUS/walrus/scripts/x402-agent-client.ts` discovers the manifest, cross-checks challenge terms, screens evidence availability and redeems the report via Payment credentials. Demo mode generates one synthetic digest; live mode requires a saved private invoice and externally funded `SUI_TX_DIGEST` matching that original reference. A generic pre-existing transfer cannot settle a newly issued invoice in the default strict mode. Saved invoice files use 0600 atomic writes. HTTPS is mandatory outside loopback; redirects and automatic redemption retries are disabled. The deterministic EVI screen and KL divergence are not predicted profit calculations. The CLI does not sign payments.

The browser has a zero-dependency Wallet Standard connector. It uses the Sui SDK already supplied with MemWal only when building/serializing transactions, with an explicit pinned dependency. Native-USDC coin selection is bounded and done through Tatum. The public invoice hash is a typed String input to `0x1::string::length`, and a split coin transfers exactly 10000 micro-USDC. Wallet approval is required; sign-only wallets submit only the exact prepared bytes whose hash is saved with the invoice. Both paths still use receipt verification and atomic redemption. LocalStorage metadata never grants signing authority. Entered addresses remain watch-only, and Enoki requires a real authenticated registered provider.

Every new snapshot carries information metrics and largest-remainder integer royalty allocation. The fixed 8000-micro-USDC backer pool uses `W * log1p(conviction)`; 2000 micro-USDC is protocol allocation. Empty/zero-weight pools stay unallocated. New canonical hashes bind economics; legacy hashes and stored snapshots remain unchanged. KL with positive mass over zero market probability is represented as `null` plus `klDivergenceInfinite=true`, not a silently clamped finite estimate. Paid USDC receipts store allocation once; sandbox grants and native-SUI fallback payments do not accrue USDC royalties. No payouts execute.

Explicit `TRUTH402_PUBLIC_JUDGE_MODE=true` removes operator authorization but not write locks, request limits or durable storage requirements. A separate sponsored-sandbox POST consumes a grant invoice and checks the configured checkpoint without issuing a payment receipt or changing revenue. Header-only fake payments remain rejected. Strict PTB binding is default; only an explicit `TRUTH402_REQUIRE_STRICT_PTB_BINDING=false` enables the weaker time-window alternative documented in the security policy.

## 9. Tatum duties and operational boundaries

1. `sui_getLatestCheckpointSequenceNumber`, `sui_getCheckpoint`, optional `sui_getObject` / `sui_getTransactionBlock`: observation metadata, not cryptographic content binding.
2. `sui_getTransactionBlock`: payment verification; a separate wallet endpoint prepares native-USDC PTBs and submits only wallet-signed bytes with `sui_executeTransactionBlock`.
3. `suix_getAllBalances`, `suix_queryTransactionBlocks`: wallet observation and revenue attribution.
4. Prediction REST: `/top-traders`, `/wallets/{address}/history`, `/wallets/{address}/positions`, `/wallets/{address}/trades`, `/markets/{id}/positions`. The official API uses `timePeriod=MONTH` and calls top holders `positions`.

All requests have explicit modes, fixed canonical hosts, bounded rows and deadlines. Live failures never fall back to synthetic success. Current JSON-RPC support and account entitlements must be exercised separately before a Mainnet demonstration. Reads were documented and mocked, not live-certified, during offline QA.

## 10. Caching, cost and safety

Resolved corpus caching is 15 seconds with single-flight and invalidation after resolution. Up to 500 local records are parsed; memwal 0.1.9 broad recall is limited to 100 live records because inventory lacks plaintext. Query recall changes the displayed subset, not the underlying cohort scores. Prediction comparison caches for five minutes. AI accepts at most 40 recent evidence records and caches by evidence/model/context.

File operations are `O(S)` writes for store size `S`, suitable only for the documented single-instance prototype. First load appends seeded markets missing by ID and demo memories missing by blob ID, preserving all existing entries and non-seed collections. Concurrent readers share initialization; the upgraded cache is not exposed before private atomic persistence succeeds. Already complete files are not rewritten. Invalid stores and failed writes fail closed, never reset the ledger. The process still requires a restart to load a newly deployed seed version.

The UI keeps synthetic benchmark ranks distinct from recalled evidence. Live memory mode uses the recalled leaderboard on the home page, not the local benchmark. Category counts respond to registry search/status/type filters. Market cards expose current-estimate forecasts in both provider modes, only for open markets, avoiding retrospective forecast previews. Synthetic event metadata stays in tags and the methodology page rather than repetitive title suffixes. No database or wallet connector library was added. Bundled fonts keep builds offline; reduced-motion preferences disable animated effects. Public source and evidence mean a paywall is a delivery boundary, not information secrecy.

For threat assumptions, key handling, request guards and production prerequisites, read `/Users/leo/Documents/WALRUS/walrus/SECURITY.md`.
