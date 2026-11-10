# Total Recall Submission Checklist

The event pages were not reliably machine-readable while this repository was built. Reconfirm the current deadline, form fields, track wording, and required IDs on the official submission page before submitting.

## Track confirmation

- [ ] Confirm the official form still names the selected track **Markets & Sports Prediction** (or update every repository reference to the exact current wording).
- [ ] Confirm a memory-calibrated oracle with simulated markets is eligible for that track.
- [ ] Record the final track exactly as submitted: `________________`.

## Product and repository

- [x] Complete Next.js application implemented in this repository.
- [x] Separate Simple Choice and Opportunity / Ranking creation flows.
- [x] Simulated LMSR trading/ranking with no wallet or real funds.
- [x] Sponsor-controlled resolution and rationale.
- [x] Walrus write, recall, health, and inventory adapters.
- [x] Credibility derived from recalled structured memories.
- [x] On-demand Agent Router integration with caching.
- [x] Tatum checkpoint, receipt verification, revenue and Prediction REST adapters (live calls still require validation).
- [x] Custom HTTP 402 challenge, paid unlock and single-use replay protection.
- [ ] Exercise live payment construction with a compatible external wallet; do not claim standard x402/MPP certification.
- [x] More than 10 meaningful records prepared (62 in dry run).
- [x] Unit tests, type checking, linting, production build command, and docs.
- [ ] Push to a public GitHub repository.
- [ ] Add final public repository URL here: `________________`.

## Live service evidence

- [ ] Create/authorize a Walrus Memory Mainnet account and delegate key externally.
- [ ] Record required Walrus agent/account ID: `________________`.
- [ ] Publish records with `npm run memories:publish -- --execute`.
- [ ] Inventory Mainnet namespace with `npm run memories:verify -- --execute`.
- [ ] Confirm verified count is at least 10: `________`.
- [ ] Store safe evidence/receipt location: `________________`.
- [ ] Create Tatum account/Mainnet API key.
- [ ] Confirm `/integrations` displays a latest Sui checkpoint.
- [ ] Record Tatum account detail required by the current form: `________________`.
- [ ] Configure Agent Router if live AI is part of the final demo.

## Deployment

- [ ] Create deployment project (Vercel for offline demo only; single durable process for live payments).
- [ ] Configure server-side environment variables.
- [ ] Run deployed `/integrations` checks.
- [ ] Test one end-to-end market loop on the deployed URL.
- [ ] Confirm no secret appears in browser source/network payloads.
- [ ] Add deployed URL here: `________________`.

## Submission media

- [x] Judge script prepared in `docs/DEMO.md`.
- [ ] Record a 2–3 minute demo video.
- [ ] Show the product name and confirmed track.
- [ ] Show simulated credits/no-wallet language and sponsor authority.
- [ ] Show one complete trade → sponsor resolution → confirmed memory-receipt loop.
- [ ] Show a Mainnet receipt/blob identifier and the read-only inventory count ≥10.
- [ ] Show raw structured memory and the credibility score with its 90% posterior interval and evidence count.
- [ ] Search for **Maya Chen** in the memory demo.
- [ ] Show `/integrations` with all four Tatum duties and the attributed payment ledger.
- [ ] Show on-demand AI provenance only if AI is claimed in the submission.
- [ ] Review every frame/network panel for secrets, private manifests, wallet data, or `.env.local`.
- [ ] Upload video and add URL: `________________`.
- [x] Blog draft prepared in `docs/BLOG_POST.md`.
- [ ] Publish blog post and add URL: `________________`.
- [ ] Capture cover image / product screenshots.

## Final copy checks

- [ ] State clearly that credits are simulated and non-financial.
- [ ] State clearly that sponsors retain final authority.
- [ ] Explain the memory-calibrated forecast, synthetic provenance and custom payment protocol.
- [ ] Explain the memory loop: signal → resolution → memory → credibility → next decision.
- [ ] Name Walrus Memory Mainnet usage and Tatum Sui RPC usage.
- [ ] Disclose MVP limitations: asserted identities and single-instance storage requirements.
- [ ] Reconfirm hackathon eligibility, deadline, track, and all required form fields.

## Final technical gate

```bash
npm ci
npm run check
npm run test:coverage
npm run build
npm run smoke:production # starts an already-built isolated demo server
npm audit
```

### Defined smoke test

The smoke test is `scripts/smoke-demo.ts`, invoked by `npm run smoke`. It is not an undefined manual reference. Run a production server in explicit demo/memory mode, then execute the runner from another terminal:

```bash
TRUTH402_MEMORY_MODE=demo \
TRUTH402_TATUM_MODE=demo \
TRUTH402_AI_MODE=demo \
TRUTH402_STORAGE_MODE=memory \
TRUTH402_ENABLE_MAINNET_WRITES=false \
NEXT_TELEMETRY_DISABLED=1 \
npm run start

SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke
```

Pass criteria: primary pages and security headers return correctly; all integrations report demo mode; invalid input is rejected; create, trade, resolve, granular memory publication, conflict rejection, recall/credibility, deterministic insight generation/cache, and final receipt persistence all succeed; final output is `Smoke workflow passed. No live provider was contacted.`

- [ ] All commands pass on the final checkout; commit only when explicitly requested.
- [ ] The defined production smoke test passes from a clean, demo-mode store.
- [ ] `git diff --check` is clean.
- [ ] `git status` contains no secrets, `.env.local`, or `.data` manifests.
- [ ] Live keys are rotated if they appeared anywhere unintended.
