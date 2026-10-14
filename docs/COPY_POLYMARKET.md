# Copy trading on Polymarket (prediction markets)

Follows a Polymarket wallet and mirrors its fills from a server-side agent
wallet on Polygon. Perps are not covered: Polymarket has no public order API
for them yet.

## Pieces

| Piece                                                                          | File                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Watcher: CLOB websocket trigger + activity polling per leader                  | `src/lib/copy-engine/polymarket/watcher.ts`                   |
| Normalizer: Data API `TRADE` row → `ObservedTransaction`                       | `src/lib/copy-engine/polymarket/normalize.ts`                 |
| Adapter: intent + sizing (ratio, caps, sell fraction)                          | `src/lib/copy-engine/polymarket/adapter.ts`                   |
| Guards: freshness, rolling daily cap, categories                               | `src/lib/copy-engine/polymarket/guards.ts`                    |
| Executor: CLOB FOK market orders from the agent EOA, dry-run switch, approvals | `src/lib/copy-engine/polymarket/executor.ts`                  |
| Agent key custody (AES-256-GCM, `COPY_KEY_SECRET`)                             | `src/lib/copy-engine/polymarket/agent-wallet.ts`              |
| Postgres store (observations, intents, subscriptions, jobs, agents)            | `src/lib/copy-engine/pg-store.ts`                             |
| Web API: agent, subscriptions, jobs (needs a server session)                   | `src/app/api/copy/*`                                          |
| UI: "Copy this trader" panel on `/predict/[address]`                           | `src/components/copy-panel.tsx`                               |
| Worker                                                                         | `scripts/copy-polymarket-worker.ts` (`pnpm copy:polymarket`)  |
| Approvals                                                                      | `scripts/copy-agent-approve.ts` (`pnpm copy:approve <agent>`) |

## Latency

Polymarket exposes no per-wallet stream. The watcher subscribes to the CLOB
market websocket for every market the leaders hold; a `last_trade_price`
event there triggers an immediate activity poll for the leaders in that
market. Independently, every leader is polled every `COPY_POLL_MS` (4 s).
Expect 2–5 s from the leader's fill to the copied order; fills older than
90 s are never copied.

## Sizing

- BUY: `min(leaderUsdc × ratio, maxPerTradeUsd)`, skipped above `maxBuyPrice`
  (default 95¢) or below $1. The rolling 24 h sum of planned orders must stay
  under `dailyCapUsd` (dry-run jobs count too, so caps can be tested).
- SELL: the leader sold `size` out of `size + remaining`; the same fraction of
  the follower's holding is sold. Nothing happens if the follower holds none.
- Orders are fill-or-kill market orders signed by the agent EOA
  (`SignatureType.EOA`, the agent funds itself). No Safe proxy, no relayer.

## Setup

1. `DATABASE_URL` (Postgres), `COPY_KEY_SECRET` (16+ chars),
   `PRIVY_VERIFICATION_KEY` + `SESSION_SECRET` (so the web app knows the user),
   optionally `POLYGON_RPC_URL`. Keep `COPY_FORCE_DRY_RUN=1` until you have
   verified a few dry runs.
2. Sign in, open a trader on `/predict/<address>`, click **Create agent
   wallet**. Send USDC.e (Polygon, `0x2791…4174`) and ~0.5 POL to it.
3. `pnpm copy:approve <agent address>` once (USDC.e + outcome-token approvals
   for the CTF Exchange, NegRisk Exchange and NegRisk Adapter).
4. Set ratio / caps, keep **Dry run**, click **Enable copy**.
5. Run the worker on a server outside Polymarket's geoblock (not the US;
   Vietnamese ISPs block polymarket.com by DNS, so not from home either):
   `pnpm copy:polymarket`. Watch the jobs list fill with `DRY_RUN` entries.
6. Switch the subscription to **Live** and unset `COPY_FORCE_DRY_RUN`.

## Not done yet

- Redeeming resolved positions and closing when the leader closes to zero are
  handled only through copied SELL fills; add a periodic redeem pass.
- Perps: watch-only until Polymarket publishes an order API.
- The worker is a single process; run one instance per database.
