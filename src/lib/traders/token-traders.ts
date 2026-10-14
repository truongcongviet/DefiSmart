import { fetchTokenPairs } from "./dexscreener";
import type { TokenLedgerValued } from "./pnl";
import { getSolPriceSeries } from "./prices";
import {
  ledgersByWallet,
  loadTraderSnapshot,
  rankWallets,
  readBudget,
  scanToken,
  type BoardToken,
} from "./smart-trader-leaderboard";
import type { SwapEvent } from "./swaps";
import { tokensFromPairs, type TrackedToken } from "./token-discovery";

/**
 * Who traded a token and how they did. Served from the leaderboard snapshot
 * when the token is tracked; otherwise a one-off scan of its busiest pairs
 * (cached in memory only).
 */

const CACHE_TTL_MS = 3 * 60_000;
const ADHOC_SIGS_PER_PAIR = 800;
const ADHOC_MAX_TX = 1_600;
const WINDOW_DAYS = 14;

export interface TokenTraderRow {
  owner: string;
  score: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  costUsd: number;
  buys: number;
  sells: number;
  avgHoldMinutes: number | null;
  earlyRank: number | null;
  entryDelaySec: number | null;
  closed: boolean;
  remainingTokens: number;
  firstBuyAt: string | null;
  lastTradeAt: string;
  /** Tokens this wallet traded in the whole snapshot (0 when ad hoc). */
  tokensTraded: number;
  winRate: number | null;
  flags: string[];
}

export interface TokenTradersResult {
  token: BoardToken;
  tracked: boolean;
  generatedAt: string;
  windowDays: number;
  totals: {
    wallets: number;
    swaps: number;
    buys: number;
    sells: number;
    volumeUsd: number;
    profitable: number;
    losing: number;
  };
  traders: TokenTraderRow[];
  recent: SwapEvent[];
  warnings: string[];
}

const cache = new Map<
  string,
  { value: TokenTradersResult; expiresAt: number }
>();

function rowsFor(
  mint: string,
  grouped: Map<string, TokenLedgerValued[]>,
  rankedTokens: Map<
    string,
    { tokensTraded: number; winRate: number; flags: string[]; score: number }
  >,
): TokenTraderRow[] {
  const rows: TokenTraderRow[] = [];
  for (const [owner, ledgers] of grouped) {
    const ledger = ledgers.find((l) => l.mint === mint);
    if (!ledger) continue;
    const ranked = rankedTokens.get(owner);
    rows.push({
      owner,
      score: ranked?.score ?? 0,
      realizedPnlUsd: ledger.realizedPnlUsd,
      unrealizedPnlUsd: ledger.unrealizedPnlUsd,
      totalPnlUsd: ledger.totalPnlUsd,
      costUsd: ledger.costUsd,
      buys: ledger.buys,
      sells: ledger.sells,
      avgHoldMinutes: ledger.avgHoldMinutes,
      earlyRank: ledger.earlyRank,
      entryDelaySec: ledger.entryDelaySec,
      closed: ledger.closed,
      remainingTokens: ledger.remainingTokens,
      firstBuyAt: ledger.firstBuyAt
        ? new Date(ledger.firstBuyAt * 1000).toISOString()
        : null,
      lastTradeAt: new Date(ledger.lastTradeAt * 1000).toISOString(),
      tokensTraded: ranked?.tokensTraded ?? ledgers.length,
      winRate: ranked?.winRate ?? null,
      flags: ranked?.flags ?? [],
    });
  }
  return rows.sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);
}

function totalsFor(swaps: SwapEvent[], rows: TokenTraderRow[]) {
  return {
    wallets: rows.length,
    swaps: swaps.length,
    buys: swaps.filter((s) => s.side === "buy").length,
    sells: swaps.filter((s) => s.side === "sell").length,
    volumeUsd: swaps.reduce((s, e) => s + e.quoteUsd, 0),
    profitable: rows.filter((r) => r.totalPnlUsd > 0).length,
    losing: rows.filter((r) => r.totalPnlUsd < 0).length,
  };
}

async function adHocToken(mint: string): Promise<TrackedToken> {
  const pairs = await fetchTokenPairs(mint);
  const [token] = tokensFromPairs(
    pairs,
    new Map([[mint, ["adhoc"]]]),
    readBudget().pairsPerToken,
  );
  if (!token)
    throw new Error("DexScreener has no SOL/USDC pair for this token.");
  return token;
}

export async function getTokenTraders(
  mint: string,
  options: { force?: boolean } = {},
): Promise<TokenTradersResult> {
  const cached = cache.get(mint);
  if (!options.force && cached && cached.expiresAt > Date.now())
    return cached.value;

  const snapshot = await loadTraderSnapshot();
  const tracked = snapshot?.tokens.find((t) => t.mint === mint) ?? null;
  const warnings: string[] = [];
  let swaps: SwapEvent[];
  let token: TrackedToken & { scannedAt: string; swaps: number };

  if (tracked && snapshot) {
    swaps = snapshot.swaps.filter((s) => s.mint === mint);
    token = tracked;
  } else {
    const now = Math.floor(Date.now() / 1000);
    const since = now - WINDOW_DAYS * 86_400;
    const discovered = await adHocToken(mint);
    const series = await getSolPriceSeries(since, now);
    const result = await scanToken(
      discovered,
      series,
      {},
      { sigsPerPair: ADHOC_SIGS_PER_PAIR, remainingTx: ADHOC_MAX_TX },
      since,
    );
    swaps = result.swaps;
    token = {
      ...discovered,
      scannedAt: new Date().toISOString(),
      swaps: swaps.length,
    };
    if (result.txFetched >= ADHOC_MAX_TX) {
      warnings.push(
        `Only the latest ${ADHOC_MAX_TX} transactions were scanned.`,
      );
    }
  }

  const tokenMap = new Map([
    [mint, { priceUsd: token.priceUsd, createdAt: token.createdAt }],
  ]);
  const grouped = ledgersByWallet(swaps, tokenMap);

  // Context from the full snapshot: how each wallet does across all tokens.
  const context = new Map<
    string,
    { tokensTraded: number; winRate: number; flags: string[]; score: number }
  >();
  if (snapshot) {
    const all = ledgersByWallet(
      snapshot.swaps,
      new Map(
        snapshot.tokens.map((t) => [
          t.mint,
          { priceUsd: t.priceUsd, createdAt: t.createdAt },
        ]),
      ),
    );
    const { wallets } = rankWallets(
      all,
      (m) => {
        const t = snapshot.tokens.find((x) => x.mint === m);
        return {
          symbol: t?.symbol ?? m.slice(0, 4),
          name: t?.name ?? m,
          logo: t?.logo ?? null,
        };
      },
      1,
      snapshot.walletScans ?? {},
    );
    for (const w of wallets) {
      context.set(w.owner, {
        tokensTraded: w.tokensTraded,
        winRate: w.winRate,
        flags: w.flags,
        score: w.score,
      });
    }
  }

  const traders = rowsFor(mint, grouped, context);
  const value: TokenTradersResult = {
    token: {
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      logo: token.logo,
      priceUsd: token.priceUsd,
      marketCapUsd: token.marketCapUsd,
      liquidityUsd: token.liquidityUsd,
      volume24hUsd: token.volume24hUsd,
      createdAt: token.createdAt,
      traders: traders.length,
      swaps: swaps.length,
      source: token.source,
      scannedAt: token.scannedAt,
    },
    tracked: Boolean(tracked),
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    totals: totalsFor(swaps, traders),
    traders,
    recent: [...swaps].sort((a, b) => b.blockTime - a.blockTime).slice(0, 50),
    warnings,
  };
  cache.set(mint, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
