# Trader data sources

The copy-trading dashboard separates trader discovery from independent
on-chain verification. A provider leaderboard is useful for finding candidates,
but it is not trusted as final performance data.

## Current integration

### FOMO API (optional discovery provider)

- Provider: `https://fomoapi.io`
- Endpoint: `GET /v2/leaderboard/{window}`
- Windows: `24h`, `7d`, `30d`, `all`
- Authentication: server-side Bearer API key
- Important: this is an independent, unofficial API. It is not operated or
  endorsed by fomo.family.

Add the key to `.env`:

```bash
FOMO_API_KEY=your_server_side_key
```

The key must never use a `NEXT_PUBLIC_` prefix. The browser calls the local
`/api/traders/leaderboard` route, and only the server calls FOMO API.

If the key is missing or the provider fails, the dashboard returns an explicit
preview dataset. Preview values are synthetic and must not be used for trading.

### GMGN

GMGN currently documents a Trading API, but its official Q&A says there is no
public Data API. Data crawling may be allowlisted for partners who bring trading
volume or users. Therefore, GMGN ranking endpoints must not be scraped or used
as a production dependency without a commercial agreement and IP whitelist.

Official references:

- https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-solana-trading-api
- https://docs.gmgn.ai/index/q-a

## Required verification layer

Before a trader can receive `onchain-verified` status, the backend should:

1. Resolve and store the trader's wallet address and source identity.
2. Backfill the complete wallet and token-account history with Helius
   `getTransactionsForAddress`.
3. Normalize swaps, transfers, deposits, withdrawals, fees, and failed
   transactions into an internal ledger.
4. Price every trade at execution time with a trusted price/liquidity source.
5. Recalculate realized and unrealized PnL instead of trusting provider PnL.
6. Compute win rate, profit factor, max drawdown, holding time, liquidity, and
   expected follower slippage.
7. Flag transfers, concentrated wins, suspected insider/sniper activity, and
   wallets whose performance cannot be reproduced by a follower.

Suggested sources:

- Helius historical transactions and streams: https://www.helius.dev/historical-data
- Helius Solana data APIs: https://www.helius.dev/docs/getting-data
- Birdeye wallet PnL/net worth API: https://docs.birdeye.so/reference/get-wallet-v2-net-worth-details
- DEX Screener token and pair API: https://docs.dexscreener.com/api/reference

## Copy score

Do not rank wallets only by absolute PnL. The production score should include:

- realized PnL and ROI over 7/30/90 days;
- win rate with a minimum sample size;
- profit factor and return consistency;
- max drawdown and losing streak;
- median holding time and signal latency;
- traded-pair liquidity and follower slippage;
- position concentration and wallet balance;
- deposit/withdrawal-adjusted returns;
- manipulation, insider, sniper, and transfer flags.

The UI intentionally leaves copy score and derived risk metrics blank for live
FOMO rows until this verification pipeline exists. A source-level verification
badge is not equivalent to an on-chain-verified badge.

## Execution safety

The current dashboard creates only an in-memory draft. It does not sign or send
transactions. Enabling execution later should require explicit user consent,
position sizing, slippage limits, daily loss limits, idempotency, retry policy,
and a kill switch.
