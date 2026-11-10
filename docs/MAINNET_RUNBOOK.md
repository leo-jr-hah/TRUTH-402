# Walrus Mainnet and Tatum Runbook

This runbook deliberately separates external account setup, read configuration, and persistent writes. **No Mainnet operation is part of install, test, build, or deploy.**

## 1. External setup

### Walrus Memory

Use the official Walrus Memory dashboard to create or select a Mainnet account and authorize a delegate key:

- Dashboard: <https://memory.walrus.xyz>
- Relayer: `https://relayer.memory.walrus.xyz`

This external setup may involve a wallet. TRUTH-402 does not initiate it. No live integration has been certified by offline tests. Record:

- `MEMWAL_PRIVATE_KEY` - delegate private key, never a seed phrase;
- `MEMWAL_ACCOUNT_ID` - Walrus Memory account **object ID**, not a wallet address;
- any hackathon-required agent/account identifier shown by the dashboard.

Do not commit these values or paste them into issue trackers, videos, screenshots, or client-side variables.

### Tatum

Create a Mainnet API key in <https://dashboard.tatum.io/chains/sui>. Verdicto uses:

- endpoint `https://sui-mainnet.gateway.tatum.io`;
- header `x-api-key`;
- checkpoint reads `sui_getLatestCheckpointSequenceNumber` and `sui_getCheckpoint`;
- optional object/transaction observation, native-USDC transaction verification, and read-only wallet revenue queries;
- Prediction v4 REST ingestion, separately from local Walrus evidence.

These are custom adapter duties, not proof that a forecast hash is anchored on-chain. Validate current gateway support and account entitlements before a live demo.

## 2. Configure local secrets

```bash
cp .env.example .env.local
chmod 600 .env.local
```

The following are the canonical environment names used by code, `.env.example`, and this runbook. Do not introduce aliases:

```dotenv
VERDICTO_MEMORY_MODE=live
VERDICTO_TATUM_MODE=live
VERDICTO_AI_MODE=demo
VERDICTO_STORAGE_MODE=file
NEXT_PUBLIC_APP_URL=http://localhost:3000

MEMWAL_PRIVATE_KEY=<delegate-private-key>
MEMWAL_ACCOUNT_ID=<account-object-id>
MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz
MEMWAL_NAMESPACE=truth402
# Keep verdicto instead if that namespace contains your existing records.
VERDICTO_ENABLE_MAINNET_WRITES=false

TATUM_API_KEY=<mainnet-api-key>
TATUM_SUI_RPC_URL=https://sui-mainnet.gateway.tatum.io
TATUM_DATA_API_URL=https://api.tatum.io/v4/data/prediction
SUI_ORACLE_ADDRESS=<your-64-hex-Sui-recipient>
VERDICTO_ORACLE_SINGLE_INSTANCE=true
VERDICTO_ORACLE_ADMIN_TOKEN=<at-least-32-random-characters>

# Required only with VERDICTO_AI_MODE=live
AGENT_ROUTER_API_KEY=
AGENT_ROUTER_BASE_URL=http://127.0.0.1:8318/v1
AGENT_ROUTER_MODEL=

# Optional local-only absolute path; Vercel always uses process memory
# VERDICTO_DATA_FILE=/absolute/path/to/verdicto.json
```

Leave `VERDICTO_ENABLE_MAINNET_WRITES=false` initially. With live memory mode and writes locked, recall/health can run but any application write is rejected with `MAINNET_WRITES_LOCKED`.

Only `NEXT_PUBLIC_APP_URL` is client-visible, and it is metadata - not a credential. Every key remains server-only.

## 3. Preview records offline

```bash
npm run memories:preview
```

Expected result for version 1.0:

- 62 distinct records (the original 20 plus 42 additive synthetic-scenario records);
- eleven market-resolution records;
- eleven closing-signal records;
- forty participant-performance records;
- final line: `Dry run only. No Walrus request was made.`

Review titles, participant display names, and summaries before publication. The script generates deterministic SHA-256 record IDs from `[kind, marketId, subjectId, schemaVersion]`, so retries deduplicate in the same namespace.

> **ID migration note:** builds before this hardening change used readable colon-delimited IDs. Those old keys and the SHA-256 keys are different. Before publishing from an upgraded checkout, inventory the namespace and review prior receipts. Do not assume an old-key record will deduplicate with its new-key equivalent; use a fresh namespace or deliberately accept/document the migration set.

## 4. Check read-only health

Start TRUTH-402 and visit `/integrations`:

```bash
npm run dev
```

Verify:

- Walrus mode is `live` and the relayer responds;
- Tatum mode is `live` and returns a latest checkpoint;
- no secret appears in browser network responses.

The Tatum check consumes RPC credits but does not mutate chain state.

## 5. Publish the seed records

Only after review:

```bash
export VERDICTO_ENABLE_MAINNET_WRITES=true
npm run memories:publish -- --execute
```

The command:

1. loads the 62 deterministic seed payloads, submitting original text rather than reserialization;
2. calls `rememberAndWait` sequentially;
3. supplies `recordId` as the idempotency key;
4. prints each confirmed blob ID;
5. writes `.data/mainnet-memory-receipts.json` with mode `0600`.

The 62 writes are intentionally **sequential**. This is slower than bulk publication but gives clear per-record confirmation, avoids a burst against the relayer, and makes the hackathon seed easy to audit. Typical latency depends on relayer/Walrus load; budget seconds to tens of seconds per record, with a hard client wait of 120 seconds each. In the worst timeout case, 62 records can therefore take about 124 minutes.

### Resume a partial seed

If interrupted, rerun the exact same command with the same namespace and unchanged seed text. The CLI may submit earlier records again because its final manifest is written only after the loop, but the relayer receives the same stable `recordId` idempotency keys and deduplicates them. Watch the numbered terminal output to identify where the prior run stopped, then run inventory afterward. Never edit text while reusing an existing key; the relayer may correctly return `409 Conflict`.

## 6. Verify inventory

```bash
npm run memories:verify -- --execute
```

This uses `listMemories` pagination rather than semantic recall. It inventories only `MEMWAL_NAMESPACE`, writes `.data/mainnet-verification.json`, and exits non-zero if fewer than 10 records are present.

Check:

```bash
node -e 'const x=require("./.data/mainnet-verification.json"); console.log({count:x.count, requirementMet:x.requirementMet})'
```

Keep private manifests out of Git. For submission evidence, expose only what the event requires: count, account/agent identifier, namespace, and safe blob IDs. Redact delegate keys and API keys.

## 7. Promote the deployed app

In the hosting dashboard, configure the same secrets and provider modes. Set `VERDICTO_ENABLE_MAINNET_WRITES=true` only if the deployed sponsor-resolution flow should publish. If the demo should be read-only after seeding, leave it false and use existing Mainnet memories for recall.

Visit `/integrations` after deployment. A green page does not by itself prove the ≥10 requirement; retain the inventory result.

## 8. Failure response

### `401 Unauthorized`

Check that:

- the private key is a registered delegate key;
- account ID is a Walrus Memory account object ID;
- credentials and relayer are both Mainnet;
- no whitespace was copied into environment variables.

### Timeout

The app waits up to 120 seconds per write. The write may have been accepted before the client timed out. Retry with the same record ID; do not generate a new ID.

### Partial batch

The application records each receipt separately and retries only missing target-provider receipts. The CLI seed is intentionally sequential and safe to resume as described above; its terminal output still shows prior confirmations if interrupted.

### Tatum error

Confirm the API key is Mainnet-enabled and the endpoint is exact. Verdicto does not fall back to another public RPC because sponsor usage must remain auditable.

## 9. Key hygiene after submission

- Rotate or revoke any delegate/API key exposed during a recording.
- Restrict Tatum API-key origins/IPs where deployment supports stable restrictions.
- Keep `.env.local` and `.data/` permissions private.
- Never use a wallet seed phrase as `MEMWAL_PRIVATE_KEY`.

## 10. Live payment deployment

Use HTTPS, exactly one Node process, a durable private file volume, `VERDICTO_STORAGE_MODE=file`, `VERDICTO_ORACLE_SINGLE_INSTANCE=true`, and an explicit non-demo Sui recipient. Vercel/serverless live redemption is intentionally disabled. Protect operator tokens and retain a current ledger; never restore stale digests after charging.

A payment client must include the invoice public reference as a pure string PTB input and keep its private token off-chain. Retry with the digest and private token within five minutes. The browser now builds a buyer-funded 0.01-native-USDC PTB and requests Wallet Standard signing. Tatum submits the exact signed bytes for sign-only wallets; no server-held buyer key is used. The CLI retains its externally signed digest flow. An ordinary transfer or generic x402/MPP client may not support this custom profile. Do not claim payment interoperability until separately verified.

## 11. Read-only preflight and public judge access

Run `npm run preflight:mainnet` from `/Users/leo/Documents/WALRUS/walrus` after configuring the environment. It loads `.env.local` and `.env` with `@next/env`, redacts credentials, and checks four independent readiness areas. Walrus inventory is fully paginated; a stalled cursor, resync or incomplete inventory cannot be reported as an exact count. The receipt check requires Mainnet metadata, matching account and namespace, confirmed publication timestamps, and IDs present in both manifests and the current namespace inventory. It prints at most ten IDs. Nonzero exit means readiness is missing, failed or incomplete, not that publishing was attempted.

For a dedicated judge deployment, set `VERDICTO_PUBLIC_JUDGE_MODE=true`. This removes operator prompts and opens protected actions to all visitors. Set `VERDICTO_REQUIRE_OPERATOR_TOKEN=true` to force auth regardless. Keep provider quotas, a separate corpus and deployment-level limits. Public mode cannot unlock Mainnet writes or ephemeral payment storage.

Judge sandbox access is a separate no-funds report grant with a checkpoint observation, not a Mainnet payment. There is no funded sponsored relayer configured by default. The hardcoded Walrus watch address is not an authenticated Enoki session. Real Enoki access requires OAuth and a registered wallet provider; the connector never fabricates it.

The exact native USDC type, storage assumptions, replay semantics and response-loss limitations are documented in `/Users/leo/Documents/WALRUS/walrus/SECURITY.md`. Never run the smoke workflow against a live or file-backed server.
