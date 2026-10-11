# Copy Engine Core

This module is the protocol-independent core for wallet copy automation. It intentionally separates observing a leader from executing with a follower wallet.

## Safety boundary

The engine never replays a leader's serialized transaction. A protocol adapter must decode the leader's economic intent and build a fresh follower plan. The executor must then construct, simulate, sign and submit a new transaction for the follower.

The first milestone runs in observe-only/dry-run mode:

1. Subscribe to confirmed Solana logs for configured leader wallets.
2. Fetch the complete parsed transaction over JSON-RPC.
3. Reject notifications where the leader address was only mentioned but did not sign.
4. Normalize program IDs and leader-owned SOL/SPL balance deltas.
5. Deduplicate observations, intents and follower jobs.
6. Serialize jobs per follower wallet.
7. Persist an auditable state machine to a local JSON file.

No LP, swap or farming transaction is signed in this milestone.

## Architecture

```text
SolanaLogsWatcher
      |
      v
SolanaRpcClient -> normalizeSolanaTransaction
      |
      v
CopyEngine
  |- CopyAdapter.decode()
  |- CopyGuard.evaluate()
  |- CopyAdapter.plan()
  |- CopyExecutor.execute()
  `- CopyStore + per-follower serial queue
```

Protocol-specific functionality is added as an adapter. A future Jupiter adapter, for example, will decode a swap, calculate proportional sizing, request a fresh quote and return an unsigned follower plan. A Meteora adapter will map leader positions to follower positions and produce open/add/remove/close plans.

## Run the observer

Add these variables to `.env`:

```bash
SOLANA_RPC_URL=https://your-solana-rpc.example
SOLANA_WS_URL=wss://your-solana-rpc.example
COPY_LEADER_WALLETS=wallet1,wallet2

# Optional. Jobs remain observe-only until an actionable adapter is installed.
COPY_FOLLOWER_WALLET=followerWallet
COPY_STATE_FILE=data/copy-engine/state.json
SOLANA_MAX_TRANSACTION_VERSION=1
```

Then run:

```bash
yarn copy:watch
```

The worker deliberately uses `confirmed` commitment for the safe baseline. A low-latency Yellowstone/Geyser source can later implement the same observation port without changing the engine.

## Core invariants

- Observation ID: `chain + leader + source signature`.
- Intent ID: `observation + adapter + adapter version + source index + kind`.
- Job ID: `intent + subscription`.
- One follower wallet executes at most one job at a time.
- Mentioning a leader address is insufficient; the leader must be a required signer.
- Observable/unknown intents can be stored, but never executed.
- Every status change is appended to the job history.
- Execution is denied unless an adapter explicitly marks an intent actionable and returns a fresh follower plan.

## Production upgrades

Before real funds are enabled:

- Replace the JSON store with Postgres and transactional unique constraints.
- Replace the local serial queue with a durable queue partitioned by `chain:followerWallet`.
- Add confirmed/finalized reconciliation and rollback handling.
- Add a protocol allowlist, amount/slippage limits, stale-intent limits and daily loss protection.
- Add a restricted signer policy; direct transfers and authority changes must remain blocked.
- Simulate every follower transaction before signing.
- Store signing and broadcast attempts separately from business jobs.
- Add adapter fixtures from real mainnet transactions and replay them in CI.
