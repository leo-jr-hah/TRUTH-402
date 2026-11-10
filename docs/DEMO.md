# TRUTH-402 Judge Demo

## Before starting

Use a fresh, explicitly **all-demo, memory-mode** server. This avoids modifying an existing provider store. Follow the offline build commands in `/Users/leo/Documents/WALRUS/walrus/README.md`, then run `npm run smoke:production`. It exits after verifying cleanup; start your own demo server for the presentation.

Fresh state has 22 markets and 62 records. `npm run memories:preview` prints deterministic IDs without making a Walrus request. None of those local records is a Mainnet receipt. Real Mainnet demonstrations require the separate opt-in runbook and actual inventory output.

## 0:00 - 0:35: Why profit is not enough

Open `/` at 1440px width.

> “A large profitable position can be luck rather than repeatable skill. TRUTH-402 compares payout edge across resolved observations, shrinks tiny samples, and makes the evidence inspectable.”

Show the **Demo benchmark** tab. All six profiles appear on both boards. Hover, click or focus Lucky Whale: profit #1 at $142,000 connects to memory skill #6 after one longshot win and one loss. Select Maya to connect profit #6 to memory skill #1, with 42 observations and about +18.4 percentage points mean edge. The displayed `T` is computed, not a promotional constant.

Switch to **Recalled evidence** and click a blob link. The memory inspector opens the exact record. Explain that this local cohort is distinct from the synthetic benchmark; do not imply those benchmark USD returns are Walrus history.

## 0:35 - 1:00: Signal divergence

Return home. Click **Sports**, then **Crypto**, then **Macro & Governance**. The category/liquidity badge and Memory Edge pill show the forecast shift. On `/markets`, the counted filters partition 22 seeds into 7 Sports, 6 Crypto, 4 Macro & Governance and 5 Strategy markets. Open cards show raw market probability versus a blue memory-adjusted preview. These previews are enabled only in all-demo mode, and are not frozen paid snapshots.

Open the Harbor vs. Summit sports terminal. In the right-hand position panel, change credit size and outcome to show the LMSR impact preview. Credits are simulated and the preview is not an executed trade.

## 1:00 - 1:45: An agent buys a report

1. Click **1. Query Oracle as AI Agent (HTTP 402)**.
2. Show the amber console with the actual `WWW-Authenticate: Payment method="sui"` response and 0.01 USDC invoice.
3. Click **Settle Demo Invoice · No funds move**. No wallet or provider is contacted; the retry uses multi-parameter `Authorization: Payment` credentials.
4. Show `HTTP 200`, the **Memory-Calibrated Alpha Report**, probability bars, rank comparison and exact evidence links.
5. Expand the raw report if desired. Reusing the digest against the API is rejected; the automated smoke also verifies 409 replay handling.

> “This is a custom Sui HTTP-402 adapter. It is not certified standard x402 v2 or MPP interoperability. Demo verification is synthetic; live mode requires an external native-USDC transaction bound to a private invoice.”

For an autonomous terminal demonstration, leave the demo server running and open a second terminal. Run `npm run agent:x402 -- --base-url http://127.0.0.1:3000` from `/Users/leo/Documents/WALRUS/walrus`, matching the server's actual port. The CLI does not start a server; see the two-terminal setup in `/Users/leo/Documents/WALRUS/walrus/README.md`. It discovers the oracle, receives a 402, screens tracked backers/memory count, redeems a demo invoice and prints the 200 alpha table, latency and blob IDs without user input. Its EVI check is an evidence-availability heuristic, not an expected-profit claim. The production smoke also runs this CLI, then shuts its temporary server down.

Do not paste arbitrary real payment digests into a live demo. The private token, public reference, recipient, coin type and time window must all match. The app never signs or submits a payment.

## 1:45 - 2:10: Freeze before resolution

Click **Commit Pre-Resolution Pick**. The old paid current estimate is cleared so it cannot be mistaken for the frozen report. Inspect the snapshot receipt, forecast hash, record/blob IDs, capture/publication times and checkpoint observation. Request/pay again to retrieve the frozen report, then click **Verify Forecast Hash**. Web Crypto recomputes the full canonical snapshot and displays a SHA-256 match. Expand the canonical payload inspector to see the committed probabilities, evidence IDs and checkpoint.

> “One snapshot is frozen for this market and provider context. Its content hash and captured checkpoint are bound inside the memory record. This verifies content consistency, not an on-chain attestation that the blob preceded a real-world event.”

## 2:10 - 2:50: Memory changes the next call

For the strongest learning demonstration, use **Recalled evidence** to note a current participant score before resolving a market they backed.

1. In an open market, expand **Resolve as sponsor**.
2. Select the result, enter a rationale, tick confirmation and click **Confirm resolution**.
3. Show granular resolution, signal and participant receipts. The decision remains saved if a provider fails; retry publishes only missing records.
4. Revisit `/insights`: the participant sample/edge/rank updates from recalled evidence. Other open estimates change when those participants back them. The already-committed report does not change.
5. Switch **Shrinkage skill**, **Equal weight** and **Recency decay**. Recency changes Beta accuracy weighting, not the equal-weight `T` formula. The chart measures conviction concentration, not an elicited private belief.

## 2:50 - 3:20: Honest integrations

Open `/integrations` and click **Inspect oracle revenue**. In demo mode the attributed micro-USDC ledger contains synthetic successful query receipts, not money.

Name the four duties: checkpoint observations, USDC digest verification, revenue reads, and Prediction REST ingestion. The latter uses the documented history/open-position/trade/holder endpoints, but is a separate bounded comparison corpus, not automatically local Walrus evidence. Generate an insight only on explicit request; identify the deterministic demo model or configured Agent Router correctly.

## Evidence and disclosure checklist

- Capture the comparison and a traceable recalled record, not a manufactured Mainnet badge.
- Show the actual 402 header, 200 report, and replay test output.
- Show frozen snapshot semantics, `contentBound=true, bindingScope=memory-record`, the browser hash match, and the distinct `sui.contentBound=false` checkpoint observation.
- Demonstrate new resolved evidence changing a later score/estimate.
- Keep operator tokens, invoice tokens, API keys, `.env.local` and private manifests off-screen.
- State that live gateways, external wallet construction and Mainnet publishing require a separately exercised operator workflow.
- For a real Mainnet submission, retain safe Walrus receipt IDs and inventory output. Offline tests alone do not satisfy a Mainnet requirement.
