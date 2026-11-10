# TRUTH402 demo video script (2:50, product plus the core ideas)

Limit is 3 minutes, so this is about 410 spoken words. Read it at a calm pace. Record with Cmd+Shift+5, microphone on.

## Setup
- Browse on **https://truth402.vercel.app** (markets, Traders, Agents, Walrus and Tatum status).
- Do the payment scene on **http://127.0.0.1:3100** (Vercel cannot take live payments). Easiest: record the Vercel parts first, then switch tabs for the payment. Or skip the live payment and show the confirmed transaction on Suiscan: https://suiscan.xyz/mainnet/tx/6Gmpvg9sndYDghs7YrczVnzwQUBp6WaqEBWHZSF9KYEf
- Slush wallet unlocked with a little USDC and SUI. Close other tabs. No terminal or `.env.local` on screen.

## Script

**0:00 The problem (home page)**
"Every prediction market shows one number: the crowd's price. But the crowd includes lucky guessers, one-time whales and fresh wallets. A price tells you what people believe, not whose belief has been right."
[Home page, scroll to the rank flip.]

**0:20 The idea (market page)**
"TRUTH402 shows two numbers on every market. Crowd is the market price. Track record is the same market, re-weighted by each trader's history. When they disagree, that gap is the signal."
[Open a market, point at Crowd and Track record.]

**0:40 How the track record is built (Traders page)**
"Here is how we compute it. Every trade and every resolution is stored as a structured memory record on Walrus. For each trader we recall their records and measure realized edge: what they paid against what the outcome settled at."
[Open Traders, click a trader.]
"A hot streak on a few markets proves little. So we shrink: the score is the edge's t-statistic multiplied by n over n plus ten. With few markets it stays near zero, and it only grows as evidence accumulates. A lucky wallet or a swarm of fresh sybil wallets cannot dominate."
[Point at the score and evidence count.]
"Accuracy gets a Beta posterior with a 90 percent interval, so you see how sure we are, not just a number. Old records decay with a 180-day half-life."

**1:25 From traders to a price**
"The Track-record price starts from the market price and moves toward the outcome that trusted traders back, weighted by their score. Only traders with positive skill count, and we cap the shift so no group can push a market to an extreme. We also measure the KL divergence between crowd and track record, how much the two disagree, in bits."
[Back to the market, show the Crowd vs Track record gap.]

**1:50 Why you can trust the evidence**
"Each record's ID is a SHA-256 of what it contains, so history cannot be quietly edited. Records live on Walrus, and Tatum stamps them against a Sui checkpoint, so the order and time of events are anchored on-chain."
[Show the Walrus and Tatum status on the Agents page or health.]

**2:10 Agents pay per answer**
"Agents consume this over HTTP 402. The server answers 402 Payment Required with a price of one cent in USDC."
[Agents page, click Pay and unlock, approve in Slush.]
"The wallet signs one Sui transaction. Tatum verifies it on-chain, the invoice can be used only once, and the report unlocks. Every payment is split: eighty percent is allocated to the traders whose records produced the signal, twenty percent to the protocol. Those traders earn when their track record is used."
[Show the receipt with the Suiscan link.]

**2:40 Close**
"Walrus remembers who was right. Tatum supplies the markets and verifies the chain. Agents pay per answer. TRUTH402."
[End on the home page.]

## Do not say
- Do not say "Byzantine fault tolerant" or "consensus". The repo does not implement that. The honest claim is robustness against luck and sybil wallets through shrinkage, evidence weighting and a shift cap.
- Do not say trades move real money. Reports are paid in USDC. Trades are signed by the wallet and recorded.
- Do not call the 80/20 split paid out on-chain. Royalties are allocated and recorded in each report. Payout transfers are not automated.

## If something fails while recording
- Payment error mentioning balance: fund the wallet and retry. Do not fake it.
- Operator token showing: paste `TRUTH402_ORACLE_ADMIN_TOKEN` off camera.
- Cut a failing scene. Say only what you show.

---

# Submission pack

I could not read the official Total Recall page by machine. Check the deadline and form yourself.

| Item | Value |
| --- | --- |
| GitHub | https://github.com/leo-jr-hah/TRUTH-402 |
| Live site | https://truth402.vercel.app (reads live Walrus and Tatum; payments run locally) |
| Example mainnet payment | https://suiscan.xyz/mainnet/tx/6Gmpvg9sndYDghs7YrczVnzwQUBp6WaqEBWHZSF9KYEf |
| Walrus | 62 records on mainnet, account ID in `.env.local` as `MEMWAL_ACCOUNT_ID` |
| Tatum | Prediction API (25 live markets) and Sui gRPC gateway |

Rotate every key you pasted anywhere after submitting.
