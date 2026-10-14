import { getSignaturesForAddress, getTransactions } from "@/lib/api/solana-rpc";

import { fetchTokenPrices, type DexPair } from "./dexscreener";
import {
  buildLedgers,
  scoreTrader,
  summarizeWallet,
  valueLedger,
  type TokenInfoLite,
  type TraderWallet,
} from "./pnl";
import { getSolPriceSeries } from "./prices";
import { extractSwaps, type SwapEvent } from "./swaps";

/**
 * Trading history of one wallet from its own transactions: swaps, per-token
 * FIFO PnL, marked to market with DexScreener prices. Any Solana wallet, no
 * indexer, no key. Used by the analysis page and by the leaderboard's
 * wallet-expansion step.
 */

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 64;
export const WALLET_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 600;
const MAX_LIMIT = 1000;
const MAX_PRICED_MINTS = 90;

export interface WalletScan {
  owner: string;
  swaps: SwapEvent[];
  /** Transactions inspected (failed ones included). */
  txScanned: number;
  /** True when the window holds more transactions than `limit`. */
  truncated: boolean;
  oldestScannedAt: string | null;
}

export interface WalletTradesResult extends Omit<WalletScan, "swaps"> {
  generatedAt: string;
  windowDays: number;
  summary: TraderWallet;
  recent: SwapEvent[];
}

const cache = new Map<
  string,
  { value: WalletTradesResult; expiresAt: number }
>();
const inflight = new Map<string, Promise<WalletTradesResult>>();

/** Reads up to `limit` transactions of the wallet and turns them into swaps. */
export async function scanWallet(
  owner: string,
  limit: number,
): Promise<WalletScan> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - WALLET_WINDOW_DAYS * 86_400;

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

  return {
    owner,
    swaps,
    txScanned: txs.length,
    truncated,
    oldestScannedAt: oldest ? new Date(oldest * 1000).toISOString() : null,
  };
}

export interface PricedTokens {
  priceUsd: (mint: string) => number | null;
  createdAt: (mint: string) => number | null;
  info: (mint: string) => TokenInfoLite;
}

/** Current prices and metadata for a set of mints (DexScreener). */
export async function priceTokens(mints: string[]): Promise<PricedTokens> {
  const unique = Array.from(new Set(mints)).slice(0, MAX_PRICED_MINTS);
  const priced = await fetchTokenPrices(unique).catch(
    () => new Map<string, { priceUsd: number; pair: DexPair }>(),
  );
  return {
    priceUsd: (mint) => priced.get(mint)?.priceUsd ?? null,
    createdAt: (mint) => {
      const created = priced.get(mint)?.pair.pairCreatedAt;
      return created ? Math.floor(created / 1000) : null;
    },
    info: (mint) => {
      const pair = priced.get(mint)?.pair;
      return {
        symbol: pair?.baseToken.symbol?.trim() || mint.slice(0, 4),
        name: pair?.baseToken.name?.trim() || mint,
        logo: pair?.info?.imageUrl ?? null,
      };
    },
  };
}

/** Per-wallet summary from its swaps, valued at current prices. */
export function summarizeSwaps(
  owner: string,
  swaps: SwapEvent[],
  prices: PricedTokens,
): TraderWallet {
  const mints = Array.from(new Set(swaps.map((s) => s.mint)));
  const created: Record<string, number | null> = {};
  for (const mint of mints) created[mint] = prices.createdAt(mint);
  const ledgers = buildLedgers(swaps, { pairCreatedAt: created }).map(
    (ledger) => valueLedger(ledger, prices.priceUsd(ledger.mint)),
  );
  const summary = summarizeWallet(owner, ledgers, prices.info);
  summary.score = scoreTrader(summary, Math.max(1e-9, summary.totalPnlUsd));
  return summary;
}

async function build(
  owner: string,
  limit: number,
): Promise<WalletTradesResult> {
  const scan = await scanWallet(owner, limit);
  const prices = await priceTokens(scan.swaps.map((s) => s.mint));
  const summary = summarizeSwaps(owner, scan.swaps, prices);
  return {
    owner,
    generatedAt: new Date().toISOString(),
    windowDays: WALLET_WINDOW_DAYS,
    txScanned: scan.txScanned,
    truncated: scan.truncated,
    oldestScannedAt: scan.oldestScannedAt,
    summary,
    recent: [...scan.swaps]
      .sort((a, b) => b.blockTime - a.blockTime)
      .slice(0, 60),
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
