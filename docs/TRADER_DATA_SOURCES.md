# Trader data sources

Smart Traders runs entirely on free, keyless sources. There is no ranking
provider: every number is derived from the wallets' own transactions.

## Pipeline

1. **Candidate tokens** — Meteora pool discovery (`trending`, `new`, `top`,
   24h) and DexScreener's launch feed (`/token-profiles/latest/v1`,
   `/token-boosts/top/v1`). Each mint is resolved with
   `/tokens/v1/solana/{mints}` and kept when liquidity ≥ $15k, 24h volume ≥
   $30k and age ≤ 45 days. The busiest `TRADER_PAIRS_PER_TOKEN` SOL/USDC pairs
   per token are scanned (`src/lib/traders/token-discovery.ts`).
2. **Transactions** — `getSignaturesForAddress` on each pair, newest first,
   stopping at the previous run's cursor or at the 14-day window, then
   `getTransaction` (json encoding, 8 in flight). Default endpoint
   `https://solana-rpc.publicnode.com`; override with `SOLANA_TX_RPC_URL`.
   The default Solana public RPC rejects nearly every `getTransaction`.
3. **Swap extraction** (`src/lib/traders/swaps.ts`) — for each signer, the net
   change of the target mint from pre/post token balances, and the net change
   of SOL (lamports + wSOL), USDC and USDT. Token in and quote out is a buy,
   the reverse a sell. Dust, rent-only moves, transfers, LP operations and bot
   transactions where the signer never touches the token are dropped.
4. **Pricing** — SOL/USD at trade time from hourly candles of Meteora's main
   SOL-USDC DLMM pool (`/pools/{pool}/ohlcv?timeframe=1h`); stables at $1;
   current token prices from DexScreener for the unrealized part.
5. **PnL** (`src/lib/traders/pnl.ts`) — FIFO lots per wallet per token.
   Realized PnL only on lots with a known cost; sells beyond the visible
   inventory are counted in `untrackedSoldTokens` and excluded. Holding time is
   token-weighted between buy and sell. `earlyRank` is the wallet's position
   among sampled buyers; `entryDelaySec` is measured from the pair's creation.
6. **Scoring** — per wallet: `0.35·winRate·(0.5+0.5·confidence) + 0.30·√pnl +
0.15·roi + 0.10·breadth + 0.10·early`, ×100, minus 15 for `sniper` (≥ 50 %
   of tokens bought within 60 s of launch) and 20 for `bot` (≥ 300 trades or
   median hold < 2 min). Wallets need ≥ 2 tokens to be ranked.

## Storage and refresh

The snapshot (`smart-traders`) keeps tokens, swaps and per-pair cursors in the
snapshot store (`data/smart-traders.json` or Postgres via `DATABASE_URL`).
`pnpm traders:build` and the daily cron run incrementally; a token that drops
out of discovery keeps its swaps until they age out of the window.

## Rate limits observed (Oct 2026)

- publicnode RPC: 300 `getTransaction` in 9.5 s at concurrency 8, no 429;
  `getProgramAccounts` disabled (HTTP 410).
- Solana public RPC: ~5 `getTransaction` per window, then
  "Too many requests for a specific RPC call".
- DexScreener: ~300 req/min (pair endpoints), 60 req/min (profiles/boosts).
- Jupiter `lite-api.jup.ag/price/v3`: 0.5 RPS keyless.
- Meteora data APIs: 300 req/10 s.

## Not used, and why

- **FOMO API / GMGN** rankings: paid or no public data API; replaced by the
  on-chain pipeline above.
- **Helius Enhanced Transactions**: would cut the transaction parsing cost
  (100 parsed swaps per call) but needs an account; the pipeline works
  without it. Setting `SOLANA_TX_RPC_URL` to a Helius RPC URL also works.
