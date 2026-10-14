import { getSignaturesForAddress, getTransactions } from "@/lib/api/solana-rpc";

import { fetchTokenPrices } from "./dexscreener";
import {
  buildLedgers,
  scoreTrader,
  summarizeWallet,
  valueLedger,
  type TraderWallet,
} from "./pnl";
import { getSolPriceSeries } from "./prices";
import { extractSwaps, type SwapEvent } from "./swaps";

/**
 * On-demand trading history of one wallet: its recent transactions, turned
 * into swaps, into per-token FIFO PnL, marked to market with DexScreener
 * prices. Any Solana wallet, no indexer, no key.
 */

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 64;
const WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 600;
const MAX_LIMIT = 1000;
const MAX_PRICED_MINTS = 90;

export interface WalletTradesResult {
  owner: string;
  generatedAt: string;
  windowDays: number;
  /** Transactions inspected. */
  txScanned: number;
  /** True when the wallet has more history than the limit covered. */
  truncated: boolean;
  oldestScannedAt: string | null;
  summary: TraderWallet;
  recent: SwapEvent[];
}

const cache = new Map<
  string,
  { value: WalletTradesResult; expiresAt: number }
>();
const inflight = new Map<string, Promise<WalletTradesResult>>();

async function build(
  owner: string,
  limit: number,
): Promise<WalletTradesResult> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - WINDOW_DAYS * 86_400;

  // `limit` counts transactions inspected (failed ones included); the wallet
  // is "truncated" when the window holds more than that.
  const signatures: string[] = [];
  let before: string | undefined;
  let inspected = 0;
  let truncated = false;
  let oldest: number | null = null;
  for (;;) {
    const want = Math.min(1000, limit - inspected);
    if (want <= 0) {
      truncated = true;
      break;
    }
    const page = await getSignaturesForAddress(owner, { limit: want, before });
    inspected += page.length;
    let stop = false;
    for (const info of page) {
      if (info.blockTime != null && info.blockTime < since) {
        stop = true;
        break;
      }
      if (info.blockTime != null) oldest = info.blockTime;
      if (!info.err) signatures.push(info.signature);
    }
    if (stop || page.length < want) break;
    before = page[page.length - 1].signature;
  }

  const series = await getSolPriceSeries(oldest ?? since, now);
  const txs = await getTransactions(signatures);
  const swaps: SwapEvent[] = [];
  for (const tx of txs) {
    if (!tx || tx.blockTime == null) continue;
    const events = extractSwaps(tx, { solPriceUsd: series.at(tx.blockTime) });
    swaps.push(...events.filter((e) => e.wallet === owner));
  }

  const mints = Array.from(new Set(swaps.map((s) => s.mint)));
  const priced = await fetchTokenPrices(mints.slice(0, MAX_PRICED_MINTS)).catch(
    () =>
      new Map<
        string,
        {
          priceUsd: number;
          pair: {
            baseToken: { symbol: string; name: string };
            info?: { imageUrl?: string };
            pairCreatedAt?: number;
          };
        }
      >(),
  );
  const created: Record<string, number | null> = {};
  for (const mint of mints) {
    const pair = priced.get(mint)?.pair;
    created[mint] = pair?.pairCreatedAt
      ? Math.floor(pair.pairCreatedAt / 1000)
      : null;
  }
  const ledgers = buildLedgers(swaps, { pairCreatedAt: created }).map(
    (ledger) => valueLedger(ledger, priced.get(ledger.mint)?.priceUsd ?? null),
  );
  const summary = summarizeWallet(owner, ledgers, (mint) => {
    const pair = priced.get(mint)?.pair;
    return {
      symbol: pair?.baseToken.symbol?.trim() || mint.slice(0, 4),
      name: pair?.baseToken.name?.trim() || mint,
      logo: pair?.info?.imageUrl ?? null,
    };
  });
  summary.score = scoreTrader(summary, Math.max(1e-9, summary.totalPnlUsd));

  return {
    owner,
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    txScanned: txs.length,
    truncated,
    oldestScannedAt: oldest ? new Date(oldest * 1000).toISOString() : null,
    summary,
    recent: [...swaps].sort((a, b) => b.blockTime - a.blockTime).slice(0, 60),
  };
}

export async function getWalletTrades(
  owner: string,
  options: { limit?: number; force?: boolean } = {},
): Promise<WalletTradesResult> {
  const limit = Math.max(
    50,
    Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT),
  );
  const key = `${owner}:${limit}`;
  const cached = cache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now())
    return cached.value;
  const running = inflight.get(key);
  if (running) return running;

  const task = build(owner, limit)
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      if (cache.size > CACHE_MAX) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
