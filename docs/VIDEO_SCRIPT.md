# TRUTH402 demo video script (about 2:30)

Record with macOS: press Cmd+Shift+5, choose "Record Selected Portion", pick the browser window, turn the microphone on. Use http://127.0.0.1:3100.

## Before you press record (5 minutes)

1. Slush wallet installed and unlocked, holding about 0.1 USDC and 0.1 SUI on Sui mainnet.
2. Server running with `npm run dev` (or the 3100 build). Open `/api/health` once and confirm all three integrations say live and healthy.
3. Open the agents page, Markets, one market page and Traders in separate tabs.
4. Hide `.env.local`, your terminal history and wallet balances if they show secrets. Browser only, full screen.
5. Do one practice payment first so you know it works, and keep that Suiscan link.

## Script (read the quoted lines, do the action in brackets)

**0:00 Home page**
"Prediction markets tell you what the crowd believes. TRUTH402 tells you whose belief has been right."
[Show the home page, scroll to the rank flip, then the stack strip.]

**0:20 Markets**
"These are 25 live markets from Tatum's Prediction API: crypto, politics, sports and macro."
[Open Markets, click one market.]

**0:35 Crowd vs Track record**
"On every market there are two numbers. Crowd is the market price. Track record weights each trader by how accurate they have been before. The gap between them is the signal."
[Point at the two numbers on the market page.]

**0:55 Connect wallet and trade**
"To trade I connect my Sui wallet."
[Click Connect wallet, approve in Slush. Enter 5 dollars, click Buy, sign the message in the wallet.]
"The wallet signs the trade, so the trade belongs to my address, nothing is anonymous."

**1:20 Traders**
"Every outcome is stored as a memory record on Walrus. Traders are ranked by track record, not profit, and I can ask the memory a question."
[Open Traders, click a trader, use Recall or Generate insight if the operator token is set.]

**1:40 Agents pay per report**
"Agents buy these reports over HTTP 402. The server answers 402 Payment Required with a price of 0.01 USDC."
[Open Agents, pick a market, click Pay and unlock. Approve the payment in Slush.]
"My wallet pays 0.01 USDC on Sui. The server checks the transaction through Tatum, then unlocks the report."

**2:05 Proof**
"Here is the transaction on Suiscan, and the report is stored on Walrus."
[Click the Suiscan link on the receipt row, then back to the report.]

**2:20 Close**
"Walrus remembers who was right. Tatum supplies the markets and verifies the chain. Agents pay per answer. TRUTH402."
[End on the home page.]

## If something fails while recording
- Payment error mentioning balance: fund the wallet, retry. Do not fake it.
- Operator token field showing: paste `TRUTH402_ORACLE_ADMIN_TOKEN` off camera.
- Cut the failing part and record only what works. Say only what you show.

---

# Submission pack

I could not read the official Total Recall page by machine (it renders blank). Open https://tatum.io/hackathon/total-recall yourself and check the deadline, track names and form fields before submitting. The list below is what these hackathons normally ask for, and what the project already has.

| Item | Where it is |
| --- | --- |
| Public GitHub repo | https://github.com/leo-jr-hah/TRUTH-402 |
| Demo video (2 to 3 min) | record with the script above, upload to YouTube unlisted or Loom |
| Live or runnable demo | local instructions in the README, or a Vercel link (see note) |
| Track | choose in the form; the repo says Markets and Sports Prediction |
| Walrus proof | your MemWal account ID and a few Walrus record IDs; run `npm run memories:verify -- --execute` for the count |
| Tatum proof | the `/api/health` output showing a live Sui checkpoint, plus the Prediction API markets |
| Short description | "Prediction markets show what the crowd believes. TRUTH402 adds a track-record view built from Walrus memory, and sells it to agents over Sui HTTP 402." |
| Screenshots | home, a market page, Traders, a paid report with the Suiscan link |

## Before you submit
- `docs/SUBMISSION_CHECKLIST.md` and the README still describe simulated credits and demo settlement. That is out of date. Do not copy those sentences into the form.
- Do not claim anything you did not show working, such as real USDC per trade. Trades are signed by the wallet and recorded. Reports are paid in USDC.
- Rotate every key you pasted anywhere after submitting.
- The Vercel link has no environment variables, so it cannot do live payments. Submit the video and the repo as the main proof.
