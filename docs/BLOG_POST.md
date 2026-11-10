# TRUTH-402: A Prediction Oracle That Remembers Why It Trusts You

A profitable trade is an observation. It is not a complete account of forecasting skill.

That distinction motivated TRUTH-402, our evolution of TRUTH402 for the Tatum × Walrus Total Recall hackathon. Rather than making another retail betting interface, we built a memory-calibrated oracle: resolved evidence changes trust, trust changes the next estimate, and an AI agent can request the resulting report through a custom Sui HTTP-402 payment flow.

## Price is not a private belief

It is tempting to score a trader's entry price as if it were their forecast. That confuses a market quote with a personal probability.

TRUTH-402 instead measures realized payout edge per share. A YES token bought at `p` and resolved at `y` has edge `y-p`. In YES coordinates, NO has edge `p-y`. This is not profit per dollar risked: for a fully settled long token, ROI would divide edge by its entry cost.

We then apply the specified fixed-prior shrinkage rule:

```text
T = n/(n+10) × meanEdge / (max(sampleStdEdge, 0.05)/sqrt(n))
```

It is an empirical-Bayes-style heuristic, not an empirically fitted posterior. The small-sample penalty, deviation floor and observation count are all visible. Accuracy has its own Beta posterior and 90% interval rather than being confused with the edge statistic.

In the synthetic six-wallet benchmark, a whale's $0.06 longshot win followed by a loss nets $142,000. Profit rank is #1, but trust rank is #6. Maya's 42-observation record has about +18.4 percentage points mean edge and trust rank #1. These are intentionally labeled teaching fixtures, not live trader-performance claims or published Walrus history.

## Memory must change the product

A memory layer is useful only if recalling it changes a decision.

When a simulated market resolves, the application writes a resolution record, a closing-signal record and a performance record per participant. Walrus recall supplies the evidence for future skill estimates. A participant's current backing is weighted by positive shrinkage skill and logarithmic position size; the oracle shifts away from raw market odds toward that cohort's directional conviction.

The interface can show exactly which record and blob IDs supported the adjustment. The original 20 TRUTH402 records remain byte-for-byte intact. New sports, crypto, macro and governance scenarios are additive, bringing demo state to 62 learning records across 22 markets. A first-load store upgrade appends missing seed IDs without replacing any existing market, memory, payment or commitment. Existing provider files are never reset to make the demonstration look better.

Synthetic leaderboard examples remain separate from the actual recalled corpus. Imported Tatum comparison rows are likewise not silently laundered into local memory evidence.

## Freeze the prediction, not the story

An oracle should not be able to rewrite a pick after learning the result.

TRUTH-402 reserves one pre-resolution snapshot for a market/provider context. It contains the estimate, weights, exact evidence references and a content hash. Retrying a failed publication writes the same snapshot; later trades and resolutions do not replace it. Forecast memories never count as resolved learning evidence.

The system first reads a Sui checkpoint through Tatum, then hashes a canonical payload containing the market/timing fields, probabilities, trusted backers and exact evidence references. Both `forecastHash` and the checkpoint/timestamp are embedded in the record sent through Walrus Memory `rememberAndWait`. Confirmed receipts expose `contentBound=true` with `bindingScope=memory-record`. After unlocking, a browser inspector recomputes SHA-256 with Web Crypto and checks the displayed snapshot against that record and receipt.

The boundary matters: **a checkpoint observation is not an on-chain content binding**. The nested Sui observation retains `contentBound=false`. Browser verification checks server-returned content consistency, not independent provider retrieval or a Walrus-to-Sui certificate. Local capture/publication times and whether publication preceded the application's resolution remain visible. Cryptographic precedence over a real-world event would need authenticated event timing and stronger on-chain content anchoring.

## An agent requests a report

The terminal begins with a real HTTP 402 challenge. A client receives a five-minute invoice priced at 10,000 micro-USDC, then retries with a payment credential. The challenge is available in `WWW-Authenticate: Payment` parameters and JSON; multi-parameter `Authorization: Payment method="sui", digest="...", invoice="..."` works alongside the custom digest/invoice headers. Duplicate or inconsistent parameters fail closed.

Demo mode accepts labeled synthetic digests and moves no funds. Live mode requires an external native-Sui-USDC transaction with the exact recipient, successful effects, checkpoint, settlement window and invoice reference. The private invoice token is kept off-chain. Invoice consumption and digest insertion are atomic, with durable single-use replay protection.

This is a custom `x402-sui-mpp` / `custom-sui-digest-v1` profile, not a claim of standard x402 v2 or MPP interoperability. The application never constructs or signs a payment. Live users need an external client that can build the required programmable transaction, and a deployment with single-instance durable storage. Those are substantive integration requirements, not details to hide in a footnote.

The runnable `npm run agent:x402` buyer completes discovery, 402 parsing, an evidence-availability screen, demo settlement and report formatting autonomously. It prints tracked backers, memory counts, probabilities, alpha shifts, verification latency and blob IDs without logging the private token. The screen is a deterministic EVI heuristic, not an LLM call or a forecast of monetary return. Live mode resumes a saved private invoice with an externally funded digest; an unrelated old transfer cannot redeem a new challenge.

## Tatum does four specific jobs

Tatum supplies checkpoint observations, transaction receipt verification, wallet/revenue reads and Prediction REST ingestion. The current documented REST paths use wallet `history` for closed positions and market `positions` for top holders. A monthly CRYPTO leaderboard uses `timePeriod=MONTH`.

Ingestion reads bounded closed history, open positions, trade fills and holder groups. The comparison exposes sample/window limitations and never assumes that a profitable monthly leaderboard proves out-of-sample skill. Live gateway availability and wallet construction still require separate operator validation.

## A precise instrument, not a theatrical dashboard

We replaced the old green template with warm neutral surfaces, thin borders, monospace measurements and a cobalt signal color. All six profiles connect across the profit and skill boards on hover, click and keyboard focus. Counted category pills narrow the registry, while market cards put raw price and memory forecast side by side. Motion communicates state: edge and T-score bars fill, paired ranks highlight, and an unlocked report appears. Reduced-motion preferences are respected. Concise provenance stays visible while full methodology lives one click away.

The demonstration runs without provider credentials, system fonts eliminate build-time font downloads, unmocked test requests fail by default, and the production smoke runs with explicit demo modes, ephemeral storage and a TCP guard. None of this proves a live integration; it makes the offline result reproducible without risking funds or provider data.

## What remains uncertain

Historical edge is not guaranteed alpha. Sponsor outcomes and participant identities are asserted, not independently verified. Position samples can be correlated or selected. Recency-weighted accuracy is a different statistic from shrinkage skill. Public source and evidence also mean the paywall sells delivered reports and receipts, not provable information exclusivity.

The important loop is concrete: resolve, remember, recompute, change the next estimate, and keep the pre-event snapshot honest. TRUTH-402 demonstrates that loop while making its assumptions inspectable.
