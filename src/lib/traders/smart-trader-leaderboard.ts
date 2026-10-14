import {
  getSignaturesForAddress,
  getTransactions,
  getTxRpcUrl,
  type SignatureInfo,
} from "@/lib/api/solana-rpc";
import { getSnapshotStore } from "@/lib/store/snapshot-store";

import { fetchTokenPrices } from "./dexscreener";
import {
  buildLedgers,
  scoreTrader,
  summarizeWallet,
  valueLedger,
  type TokenLedgerValued,
  type TraderWallet,
} from "./pnl";
import { getSolPriceSeries, type SolPriceSeries } from "./prices";
import { extractSwaps, WSOL_MINT, type SwapEvent } from "./swaps";
import { discoverTokens, type TrackedToken } from "./token-discovery";
import { priceTokens, scanWallet, summarizeSwaps } from "./wallet-trades";

/**
 * Smart Traders leaderboard, built purely from on-chain swaps:
 *
 * 1. pick active meme tokens (Meteora discovery + DexScreener launch feed),
 * 2. pull every transaction of their busiest pairs (incrementally: only what
 *    is newer than the last run),
 * 3. turn each transaction into buy/sell events for the signer,
 * 4. FIFO PnL per wallet per token, aggregate per wallet, score.
 *
 * The swaps themselves are kept in the snapshot store so the next run only
 * fetches what changed.
 */

export const SNAPSHOT_KIND = "smart-traders";
const WINDOW_DAYS = 14;
const MIN_TOKENS = 2;
const CACHE_TTL_MS = 60 * 60_000;
const MAX_TRACKED_TOKENS = 60;
const SIG_PAGE = 1000;

export interface BuildBudget {
  tokens: number;
  pairsPerToken: number;
  sigsPerPair: number;
  maxTx: number;
  /** Wallets whose own history is read in full per run. */
  wallets: number;
  /** Transactions read per expanded wallet. */
  walletTx: number;
}

export function readBudget(overrides: Partial<BuildBudget> = {}): BuildBudget {
  const env = (name: string, fallback: number) => {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  };
  return {
    tokens: overrides.tokens ?? env("TRADER_TOKENS", 16),
    pairsPerToken: overrides.pairsPerToken ?? env("TRADER_PAIRS_PER_TOKEN", 2),
    sigsPerPair: overrides.sigsPerPair ?? env("TRADER_SIGS_PER_PAIR", 1500),
    maxTx: overrides.maxTx ?? env("TRADER_MAX_TX", 25_000),
    wallets: overrides.wallets ?? env("TRADER_WALLETS", 80),
    walletTx: overrides.walletTx ?? env("TRADER_WALLET_TX", 400),
  };
}

interface PairCursor {
  /** Newest signature already processed. */
  newest: string;
  /** Unix seconds of that signature. */
  newestAt: number;
}

export interface TrackedTokenState extends TrackedToken {
  scannedAt: string;
  swaps: number;
}

export interface ExpandedWallet {
  summary: TraderWallet;
  scannedAt: string;
  txScanned: number;
  truncated: boolean;
}

/** Full snapshot (stored). */
export interface TraderSnapshot {
  generatedAt: string;
  windowDays: number;
  tokens: TrackedTokenState[];
  swaps: SwapEvent[];
  cursors: Record<string, PairCursor>;
  /** Wallets expanded from their own history, keyed by owner. */
  walletScans: Record<string, ExpandedWallet>;
  stats: BuildStats;
  warnings: string[];
}

export interface BuildStats {
  tokensRequested: number;
  tokensScanned: number;
  tokensFailed: number;
  walletsExpanded: number;
  pairsScanned: number;
  txFetched: number;
  swapsTotal: number;
  durationMs: number;
  rpc: string;
}

export interface BoardToken {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  createdAt: number | null;
  traders: number;
  swaps: number;
  source: string[];
  scannedAt: string;
}

/** What the API serves (no raw swaps). */
export interface TraderBoard {
  generatedAt: string;
  windowDays: number;
  stats: BuildStats;
  tokens: BoardToken[];
  walletsSeen: number;
  wallets: TraderWallet[];
  warnings: string[];
  store: "file" | "postgres";
}

const windowStart = (now = Date.now()) =>
  Math.floor(now / 1000) - WINDOW_DAYS * 86_400;

async function collectSignatures(
  pair: string,
  cursor: PairCursor | undefined,
  sigsPerPair: number,
  since: number,
): Promise<SignatureInfo[]> {
  const out: SignatureInfo[] = [];
  let before: string | undefined;
  while (out.length < sigsPerPair) {
    const page = await getSignaturesForAddress(pair, {
      limit: Math.min(SIG_PAGE, sigsPerPair - out.length),
      before,
      until: cursor?.newest,
    });
    if (page.length === 0) break;
    let stop = false;
    for (const info of page) {
      if (info.blockTime != null && info.blockTime < since) {
        stop = true;
        break;
      }
      if (!info.err) out.push(info);
    }
    if (stop || page.length < SIG_PAGE) break;
    before = page[page.length - 1].signature;
  }
  return out;
}

export interface ScanResult {
  swaps: SwapEvent[];
  cursors: Record<string, PairCursor>;
  txFetched: number;
  pairsScanned: number;
}

/** Fetches new swaps of one token across its tracked pairs. */
export async function scanToken(
  token: TrackedToken,
  series: SolPriceSeries,
  cursors: Record<string, PairCursor>,
  budget: { sigsPerPair: number; remainingTx: number },
  since: number,
): Promise<ScanResult> {
  const swaps: SwapEvent[] = [];
  const nextCursors: Record<string, PairCursor> = {};
  let txFetched = 0;
  let pairsScanned = 0;

  for (const pair of token.pairs) {
    if (budget.remainingTx - txFetched <= 0) break;
    const signatures = await collectSignatures(
      pair.address,
      cursors[pair.address],
      Math.min(budget.sigsPerPair, budget.remainingTx - txFetched),
      since,
    );
    pairsScanned += 1;
    if (signatures.length === 0) continue;
    const txs = await getTransactions(signatures.map((s) => s.signature));
    txFetched += txs.length;
    for (const tx of txs) {
      if (!tx || tx.blockTime == null) continue;
      swaps.push(
        ...extractSwaps(tx, {
          mint: token.mint,
          solPriceUsd: series.at(tx.blockTime),
        }),
      );
    }
    const newest = signatures[0];
    nextCursors[pair.address] = {
      newest: newest.signature,
      newestAt: newest.blockTime ?? Math.floor(Date.now() / 1000),
    };
  }

  return { swaps, cursors: nextCursors, txFetched, pairsScanned };
}

const WALLET_SCAN_MAX_AGE_MS = 7 * 86_400_000;
const WALLET_RESCAN_AFTER_MS = 2 * 86_400_000;
const CANDIDATES_PER_TOKEN = 12;

/**
 * Wallets worth reading in full: per token, the top realized-PnL wallets that
 * actually sold something, plus the biggest unrealized winners. Wallets
 * scanned recently are skipped; stale ones are refreshed first.
 */
function pickCandidates(
  grouped: Map<string, TokenLedgerValued[]>,
  scans: Record<string, ExpandedWallet>,
  limit: number,
): string[] {
  const byToken = new Map<
    string,
    Array<{ owner: string; pnl: number; sold: boolean }>
  >();
  for (const [owner, ledgers] of grouped) {
    for (const ledger of ledgers) {
      const list = byToken.get(ledger.mint) ?? [];
      list.push({ owner, pnl: ledger.totalPnlUsd, sold: ledger.sells > 0 });
      byToken.set(ledger.mint, list);
    }
  }
  const picked = new Map<string, number>();
  for (const list of byToken.values()) {
    const sorted = list
      .filter((l) => l.pnl > 5)
      .sort((a, b) => Number(b.sold) - Number(a.sold) || b.pnl - a.pnl)
      .slice(0, CANDIDATES_PER_TOKEN);
    for (const item of sorted) {
      picked.set(item.owner, (picked.get(item.owner) ?? 0) + item.pnl);
    }
  }
  const now = Date.now();
  const fresh = (owner: string) => {
    const scan = scans[owner];
    return scan
      ? now - Date.parse(scan.scannedAt) < WALLET_RESCAN_AFTER_MS
      : false;
  };
  const candidates = Array.from(picked.entries())
    .filter(([owner]) => !fresh(owner))
    .sort((a, b) => b[1] - a[1])
    .map(([owner]) => owner);
  return candidates.slice(0, limit);
}

function repriceSwap(swap: SwapEvent, series: SolPriceSeries): SwapEvent {
  if (swap.quoteMint !== WSOL_MINT || swap.tokenAmount <= 0) return swap;
  const quoteUsd = swap.quoteAmount * series.at(swap.blockTime);
  return { ...swap, quoteUsd, priceUsd: quoteUsd / swap.tokenAmount };
}

function dedupe(swaps: SwapEvent[]): SwapEvent[] {
  const seen = new Set<string>();
  const out: SwapEvent[] = [];
  for (const swap of swaps) {
    const key = `${swap.signature}:${swap.wallet}:${swap.mint}:${swap.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(swap);
  }
  return out;
}

/** Ledgers per wallet for a set of swaps, valued at current prices. */
export function ledgersByWallet(
  swaps: SwapEvent[],
  tokens: Map<string, { priceUsd: number | null; createdAt: number | null }>,
): Map<string, TokenLedgerValued[]> {
  const created: Record<string, number | null> = {};
  for (const [mint, token] of tokens) created[mint] = token.createdAt;
  const grouped = new Map<string, TokenLedgerValued[]>();
  for (const ledger of buildLedgers(swaps, { pairCreatedAt: created })) {
    const valued = valueLedger(
      ledger,
      tokens.get(ledger.mint)?.priceUsd ?? null,
    );
    const list = grouped.get(ledger.wallet) ?? [];
    list.push(valued);
    grouped.set(ledger.wallet, list);
  }
  return grouped;
}

export function rankWallets(
  grouped: Map<string, TokenLedgerValued[]>,
  info: (mint: string) => { symbol: string; name: string; logo: string | null },
  minTokens = MIN_TOKENS,
  expanded: Record<string, ExpandedWallet> = {},
): { wallets: TraderWallet[]; seen: number } {
  const rows: TraderWallet[] = [];
  const owners = new Set<string>(grouped.keys());
  for (const owner of Object.keys(expanded)) owners.add(owner);
  for (const owner of owners) {
    const full = expanded[owner];
    const row = full
      ? { ...full.summary, coverage: "full" as const }
      : {
          ...summarizeWallet(owner, grouped.get(owner) ?? [], info),
          coverage: "pools" as const,
        };
    if (row.tokensTraded < minTokens) continue;
    rows.push(row);
  }
  const maxPnl = Math.max(1e-9, ...rows.map((r) => r.totalPnlUsd));
  for (const row of rows) row.score = scoreTrader(row, maxPnl);
  rows.sort((a, b) => b.score - a.score || b.totalPnlUsd - a.totalPnlUsd);
  return { wallets: rows, seen: owners.size };
}

export function toBoard(snapshot: TraderSnapshot): TraderBoard {
  const tokenMap = new Map(
    snapshot.tokens.map((t) => [
      t.mint,
      { priceUsd: t.priceUsd, createdAt: t.createdAt },
    ]),
  );
  const grouped = ledgersByWallet(snapshot.swaps, tokenMap);
  const infoByMint = new Map(snapshot.tokens.map((t) => [t.mint, t]));
  const info = (mint: string) => {
    const token = infoByMint.get(mint);
    return {
      symbol: token?.symbol ?? mint.slice(0, 4),
      name: token?.name ?? mint,
      logo: token?.logo ?? null,
    };
  };
  const { wallets, seen } = rankWallets(
    grouped,
    info,
    MIN_TOKENS,
    snapshot.walletScans ?? {},
  );

  const tradersPerToken = new Map<string, number>();
  for (const ledgers of grouped.values()) {
    for (const ledger of ledgers) {
      tradersPerToken.set(
        ledger.mint,
        (tradersPerToken.get(ledger.mint) ?? 0) + 1,
      );
    }
  }
  const tokens: BoardToken[] = snapshot.tokens
    .map((token) => ({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      logo: token.logo,
      priceUsd: token.priceUsd,
      marketCapUsd: token.marketCapUsd,
      liquidityUsd: token.liquidityUsd,
      volume24hUsd: token.volume24hUsd,
      createdAt: token.createdAt,
      traders: tradersPerToken.get(token.mint) ?? 0,
      swaps: token.swaps,
      source: token.source,
      scannedAt: token.scannedAt,
    }))
    .sort((a, b) => b.swaps - a.swaps);

  return {
    generatedAt: snapshot.generatedAt,
    windowDays: snapshot.windowDays,
    stats: snapshot.stats,
    tokens,
    walletsSeen: seen,
    wallets,
    warnings: snapshot.warnings,
    store: getSnapshotStore().backend,
  };
}

export interface BuildOptions {
  budget?: Partial<BuildBudget>;
  include?: string[];
  onProgress?: (message: string) => void;
}

export async function buildTraderSnapshot(
  previous: TraderSnapshot | null,
  options: BuildOptions = {},
): Promise<TraderSnapshot> {
  const startedAt = Date.now();
  const budget = readBudget(options.budget);
  const since = windowStart(startedAt);
  const warnings: string[] = [];
  const log = options.onProgress ?? (() => undefined);

  const discovered = await discoverTokens({
    tokens: budget.tokens,
    pairsPerToken: budget.pairsPerToken,
    include: options.include,
  });
  log(`discovered ${discovered.length} tokens`);

  const series = await getSolPriceSeries(since, Math.floor(startedAt / 1000));
  const cursors = { ...(previous?.cursors ?? {}) };
  // Re-price carried swaps so a better SOL price history applies to old rows too.
  const carried = (previous?.swaps ?? [])
    .filter((s) => s.blockTime >= since)
    .map((s) => repriceSwap(s, series));
  const tokens = new Map<string, TrackedTokenState>();
  for (const token of previous?.tokens ?? []) {
    if (carried.some((s) => s.mint === token.mint))
      tokens.set(token.mint, token);
  }

  let txFetched = 0;
  let pairsScanned = 0;
  let tokensFailed = 0;
  let tokensScanned = 0;
  const fresh: SwapEvent[] = [];

  for (const token of discovered) {
    const remainingTx = budget.maxTx - txFetched;
    if (remainingTx <= 0) {
      warnings.push(
        `tx budget (${budget.maxTx}) exhausted before ${token.symbol}`,
      );
      break;
    }
    try {
      const result = await scanToken(
        token,
        series,
        cursors,
        { sigsPerPair: budget.sigsPerPair, remainingTx },
        since,
      );
      Object.assign(cursors, result.cursors);
      txFetched += result.txFetched;
      pairsScanned += result.pairsScanned;
      fresh.push(...result.swaps);
      tokensScanned += 1;
      const previousState = tokens.get(token.mint);
      tokens.set(token.mint, {
        ...token,
        scannedAt: new Date().toISOString(),
        swaps: (previousState?.swaps ?? 0) + result.swaps.length,
      });
      log(
        `${token.symbol}: ${result.txFetched} tx → ${result.swaps.length} swaps (total tx ${txFetched})`,
      );
    } catch (error) {
      tokensFailed += 1;
      warnings.push(
        `${token.symbol}: ${error instanceof Error ? error.message : "scan failed"}`,
      );
    }
  }

  const swaps = dedupe([...carried, ...fresh]);

  // Refresh prices for everything we still track (carried tokens included).
  try {
    const prices = await fetchTokenPrices(Array.from(tokens.keys()));
    for (const [mint, token] of tokens) {
      const quote = prices.get(mint);
      if (quote) {
        token.priceUsd = quote.priceUsd;
        token.liquidityUsd = quote.pair.liquidity?.usd ?? token.liquidityUsd;
        token.volume24hUsd = quote.pair.volume?.h24 ?? token.volume24hUsd;
        token.marketCapUsd =
          quote.pair.marketCap ?? quote.pair.fdv ?? token.marketCapUsd;
      }
    }
  } catch (error) {
    warnings.push(
      `price refresh: ${error instanceof Error ? error.message : "failed"}`,
    );
  }

  // Wallet expansion: the best wallets of each token get their own history
  // read in full, so their PnL covers every token they traded, not just the
  // ones we track.
  const walletScans: Record<string, ExpandedWallet> = {};
  for (const [owner, scan] of Object.entries(previous?.walletScans ?? {})) {
    if (Date.now() - Date.parse(scan.scannedAt) < WALLET_SCAN_MAX_AGE_MS) {
      walletScans[owner] = scan;
    }
  }
  let walletsExpanded = 0;
  if (budget.wallets > 0) {
    const grouped = ledgersByWallet(
      swaps,
      new Map(
        Array.from(tokens.values()).map((t) => [
          t.mint,
          { priceUsd: t.priceUsd, createdAt: t.createdAt },
        ]),
      ),
    );
    const candidates = pickCandidates(grouped, walletScans, budget.wallets);
    log(`expanding ${candidates.length} wallets (${budget.walletTx} tx each)`);
    for (const owner of candidates) {
      try {
        const scan = await scanWallet(owner, budget.walletTx);
        txFetched += scan.txScanned;
        const prices = await priceTokens(scan.swaps.map((s) => s.mint));
        const summary = summarizeSwaps(owner, scan.swaps, prices);
        walletScans[owner] = {
          summary,
          scannedAt: new Date().toISOString(),
          txScanned: scan.txScanned,
          truncated: scan.truncated,
        };
        walletsExpanded += 1;
        if (walletsExpanded % 10 === 0) {
          log(
            `  ${walletsExpanded}/${candidates.length} wallets expanded (total tx ${txFetched})`,
          );
        }
      } catch (error) {
        warnings.push(
          `${owner.slice(0, 8)}: ${error instanceof Error ? error.message : "wallet scan failed"}`,
        );
      }
    }
  }

  // Recount swaps per token and drop tokens that no longer have any.
  const perToken = new Map<string, number>();
  for (const swap of swaps)
    perToken.set(swap.mint, (perToken.get(swap.mint) ?? 0) + 1);
  const tokenList = Array.from(tokens.values())
    .map((token) => ({ ...token, swaps: perToken.get(token.mint) ?? 0 }))
    .filter((token) => token.swaps > 0)
    .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt))
    .slice(0, MAX_TRACKED_TOKENS);
  const keep = new Set(tokenList.map((t) => t.mint));
  const trackedPairs = new Set(
    tokenList.flatMap((t) => t.pairs.map((p) => p.address)),
  );
  for (const pair of Object.keys(cursors)) {
    if (!trackedPairs.has(pair)) delete cursors[pair];
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    tokens: tokenList,
    swaps: swaps.filter((s) => keep.has(s.mint)),
    cursors,
    walletScans,
    stats: {
      tokensRequested: discovered.length,
      tokensScanned,
      tokensFailed,
      walletsExpanded,
      pairsScanned,
      txFetched,
      swapsTotal: swaps.length,
      durationMs: Date.now() - startedAt,
      rpc: getTxRpcUrl(),
    },
    warnings: warnings.slice(0, 12),
  };
}

// ---------------------------------------------------------------------------
// Cache + store
// ---------------------------------------------------------------------------

let memory: {
  snapshot: TraderSnapshot;
  board: TraderBoard;
  expiresAt: number;
} | null = null;
let inflight: Promise<TraderSnapshot> | null = null;

function isSnapshot(value: unknown): value is TraderSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as TraderSnapshot).swaps) &&
    Array.isArray((value as TraderSnapshot).tokens)
  );
}

export async function loadTraderSnapshot(): Promise<TraderSnapshot | null> {
  if (memory) return memory.snapshot;
  const stored = await getSnapshotStore().load<TraderSnapshot>(SNAPSHOT_KIND);
  if (!stored || !isSnapshot(stored.payload)) return null;
  memory = {
    snapshot: stored.payload,
    board: toBoard(stored.payload),
    expiresAt: Date.parse(stored.payload.generatedAt) + CACHE_TTL_MS,
  };
  return stored.payload;
}

/** Rebuilds (incrementally) and persists the snapshot. */
export async function refreshTraderSnapshot(
  options: BuildOptions = {},
): Promise<TraderSnapshot> {
  if (inflight) return inflight;
  inflight = (async () => {
    const previous = await loadTraderSnapshot();
    const snapshot = await buildTraderSnapshot(previous, options);
    memory = {
      snapshot,
      board: toBoard(snapshot),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    await getSnapshotStore().save(
      SNAPSHOT_KIND,
      snapshot,
      snapshot.generatedAt,
    );
    return snapshot;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Board for the API. Serves the stored snapshot; with `force` it waits for a
 * rebuild, otherwise a stale snapshot is served while one runs in the
 * background.
 */
export async function getSmartTraderBoard(
  options: { force?: boolean; budget?: Partial<BuildBudget> } = {},
): Promise<TraderBoard | null> {
  if (options.force) {
    await refreshTraderSnapshot({ budget: options.budget });
    return memory?.board ?? null;
  }
  await loadTraderSnapshot();
  if (memory && memory.expiresAt <= Date.now() && !inflight) {
    void refreshTraderSnapshot({ budget: options.budget }).catch(
      () => undefined,
    );
  }
  return memory?.board ?? null;
}

export function isBuildRunning() {
  return inflight !== null;
}
