import type { SwapEvent } from "./swaps";

/**
 * FIFO profit and loss per (wallet, token) from swap events, plus the
 * per-wallet aggregate and score used by the Smart Traders leaderboard.
 */

export interface TokenLedger {
  wallet: string;
  mint: string;
  buys: number;
  sells: number;
  boughtTokens: number;
  soldTokens: number;
  /** USD spent on buys. */
  costUsd: number;
  /** USD received on sells (matched lots only). */
  proceedsUsd: number;
  /** Realized PnL on lots whose cost is known. */
  realizedPnlUsd: number;
  /** Tokens sold without a matching buy in the sample; excluded from PnL. */
  untrackedSoldTokens: number;
  remainingTokens: number;
  remainingCostUsd: number;
  /** Unix seconds. */
  firstBuyAt: number | null;
  lastTradeAt: number;
  /** Token-weighted holding time between buy and sell, in minutes. */
  avgHoldMinutes: number | null;
  /** Average entry price in USD. */
  avgBuyPriceUsd: number | null;
  /** Rank of this wallet's first buy among sampled buyers (1 = earliest). */
  earlyRank: number | null;
  /** Seconds between pool creation and the first buy. */
  entryDelaySec: number | null;
}

export interface TokenLedgerValued extends TokenLedger {
  currentPriceUsd: number | null;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  /** Fully exited (≤ 1 % of bought tokens left). */
  closed: boolean;
}

interface Lot {
  tokens: number;
  costPerToken: number;
  at: number;
}

const EPS = 1e-12;

/** Builds one ledger per (wallet, mint) from events in any order. */
export function buildLedgers(
  events: SwapEvent[],
  options: { pairCreatedAt?: Record<string, number | null> } = {},
): TokenLedger[] {
  const sorted = [...events].sort(
    (a, b) => a.blockTime - b.blockTime || a.slot - b.slot,
  );
  const ledgers = new Map<string, TokenLedger>();
  const lots = new Map<string, Lot[]>();
  const holdWeighted = new Map<string, { minutes: number; tokens: number }>();
  const buyerRank = new Map<string, number>();

  for (const event of sorted) {
    const key = `${event.wallet}:${event.mint}`;
    let ledger = ledgers.get(key);
    if (!ledger) {
      ledger = {
        wallet: event.wallet,
        mint: event.mint,
        buys: 0,
        sells: 0,
        boughtTokens: 0,
        soldTokens: 0,
        costUsd: 0,
        proceedsUsd: 0,
        realizedPnlUsd: 0,
        untrackedSoldTokens: 0,
        remainingTokens: 0,
        remainingCostUsd: 0,
        firstBuyAt: null,
        lastTradeAt: event.blockTime,
        avgHoldMinutes: null,
        avgBuyPriceUsd: null,
        earlyRank: null,
        entryDelaySec: null,
      };
      ledgers.set(key, ledger);
      lots.set(key, []);
    }
    ledger.lastTradeAt = Math.max(ledger.lastTradeAt, event.blockTime);
    const queue = lots.get(key) as Lot[];

    if (event.side === "buy") {
      ledger.buys += 1;
      ledger.boughtTokens += event.tokenAmount;
      ledger.costUsd += event.quoteUsd;
      queue.push({
        tokens: event.tokenAmount,
        costPerToken: event.priceUsd,
        at: event.blockTime,
      });
      if (ledger.firstBuyAt == null) {
        ledger.firstBuyAt = event.blockTime;
        const rank = (buyerRank.get(event.mint) ?? 0) + 1;
        buyerRank.set(event.mint, rank);
        ledger.earlyRank = rank;
        const created = options.pairCreatedAt?.[event.mint];
        if (created != null) {
          ledger.entryDelaySec = Math.max(0, event.blockTime - created);
        }
      }
      continue;
    }

    ledger.sells += 1;
    ledger.soldTokens += event.tokenAmount;
    let remaining = event.tokenAmount;
    let matched = 0;
    while (remaining > EPS && queue.length > 0) {
      const lot = queue[0];
      const take = Math.min(lot.tokens, remaining);
      const cost = take * lot.costPerToken;
      const proceeds = take * event.priceUsd;
      ledger.proceedsUsd += proceeds;
      ledger.realizedPnlUsd += proceeds - cost;
      const hold = holdWeighted.get(key) ?? { minutes: 0, tokens: 0 };
      hold.minutes += ((event.blockTime - lot.at) / 60) * take;
      hold.tokens += take;
      holdWeighted.set(key, hold);
      lot.tokens -= take;
      remaining -= take;
      matched += take;
      if (lot.tokens <= EPS) queue.shift();
    }
    if (remaining > EPS) ledger.untrackedSoldTokens += remaining;
    void matched;
  }

  for (const [key, ledger] of ledgers) {
    const queue = lots.get(key) ?? [];
    ledger.remainingTokens = queue.reduce((sum, lot) => sum + lot.tokens, 0);
    ledger.remainingCostUsd = queue.reduce(
      (sum, lot) => sum + lot.tokens * lot.costPerToken,
      0,
    );
    const hold = holdWeighted.get(key);
    ledger.avgHoldMinutes =
      hold && hold.tokens > 0 ? hold.minutes / hold.tokens : null;
    ledger.avgBuyPriceUsd =
      ledger.boughtTokens > 0 ? ledger.costUsd / ledger.boughtTokens : null;
  }

  return Array.from(ledgers.values());
}

/** Adds mark-to-market on what is still held. */
export function valueLedger(
  ledger: TokenLedger,
  currentPriceUsd: number | null,
): TokenLedgerValued {
  const unrealized =
    currentPriceUsd != null && ledger.remainingTokens > 0
      ? ledger.remainingTokens * currentPriceUsd - ledger.remainingCostUsd
      : 0;
  return {
    ...ledger,
    currentPriceUsd,
    unrealizedPnlUsd: unrealized,
    totalPnlUsd: ledger.realizedPnlUsd + unrealized,
    closed:
      ledger.boughtTokens > 0 &&
      ledger.remainingTokens <= ledger.boughtTokens * 0.01,
  };
}

export interface TraderTokenSummary {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
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
  firstBuyAt: string | null;
  lastTradeAt: string;
}

export interface TraderWallet {
  owner: string;
  score: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  costUsd: number;
  volumeUsd: number;
  /** totalPnl / cost. */
  roi: number;
  tokensTraded: number;
  tokensProfitable: number;
  tokensClosed: number;
  winRate: number;
  trades: number;
  medianHoldMinutes: number | null;
  /** Tokens bought within 30 minutes of pool creation or in the first 10 buyers. */
  earlyEntries: number;
  flags: TraderFlag[];
  tokens: TraderTokenSummary[];
  firstTradeAt: string | null;
  lastTradeAt: string | null;
}

export type TraderFlag = "sniper" | "bot" | "single-token" | "holding";

export interface TokenInfoLite {
  symbol: string;
  name: string;
  logo: string | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

const EARLY_DELAY_SEC = 30 * 60;
const EARLY_RANK = 10;
const SNIPER_DELAY_SEC = 60;

/** Aggregates a wallet's valued ledgers into one leaderboard row. */
export function summarizeWallet(
  owner: string,
  ledgers: TokenLedgerValued[],
  tokenInfo: (mint: string) => TokenInfoLite,
): TraderWallet {
  const tokens: TraderTokenSummary[] = ledgers
    .map((ledger) => {
      const info = tokenInfo(ledger.mint);
      return {
        mint: ledger.mint,
        symbol: info.symbol,
        name: info.name,
        logo: info.logo,
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
        firstBuyAt:
          ledger.firstBuyAt != null
            ? new Date(ledger.firstBuyAt * 1000).toISOString()
            : null,
        lastTradeAt: new Date(ledger.lastTradeAt * 1000).toISOString(),
      };
    })
    .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);

  const traded = ledgers.filter((l) => l.buys > 0);
  const realized = ledgers.reduce((s, l) => s + l.realizedPnlUsd, 0);
  const unrealized = ledgers.reduce((s, l) => s + l.unrealizedPnlUsd, 0);
  const cost = ledgers.reduce((s, l) => s + l.costUsd, 0);
  const proceeds = ledgers.reduce((s, l) => s + l.proceedsUsd, 0);
  const trades = ledgers.reduce((s, l) => s + l.buys + l.sells, 0);
  const profitable = traded.filter((l) => l.totalPnlUsd > 0).length;
  const closed = traded.filter((l) => l.closed).length;
  const holds = traded
    .map((l) => l.avgHoldMinutes)
    .filter((v): v is number => v != null);
  const early = traded.filter(
    (l) =>
      (l.entryDelaySec != null && l.entryDelaySec <= EARLY_DELAY_SEC) ||
      (l.earlyRank != null && l.earlyRank <= EARLY_RANK),
  ).length;
  const snipes = traded.filter(
    (l) => l.entryDelaySec != null && l.entryDelaySec <= SNIPER_DELAY_SEC,
  ).length;
  const medianHold = median(holds);

  const flags: TraderFlag[] = [];
  if (traded.length > 0 && snipes / traded.length >= 0.5 && snipes >= 2)
    flags.push("sniper");
  if (trades >= 300 || (medianHold != null && medianHold < 2 && trades >= 40))
    flags.push("bot");
  if (traded.length === 1) flags.push("single-token");
  if (traded.length > 0 && closed === 0) flags.push("holding");

  const times = ledgers.map((l) => l.firstBuyAt ?? l.lastTradeAt);

  const row: TraderWallet = {
    owner,
    score: 0,
    realizedPnlUsd: realized,
    unrealizedPnlUsd: unrealized,
    totalPnlUsd: realized + unrealized,
    costUsd: cost,
    volumeUsd: cost + proceeds,
    roi: cost > 0 ? (realized + unrealized) / cost : 0,
    tokensTraded: traded.length,
    tokensProfitable: profitable,
    tokensClosed: closed,
    winRate: traded.length > 0 ? profitable / traded.length : 0,
    trades,
    medianHoldMinutes: medianHold,
    earlyEntries: early,
    flags,
    tokens,
    firstTradeAt:
      times.length > 0
        ? new Date(Math.min(...times) * 1000).toISOString()
        : null,
    lastTradeAt:
      ledgers.length > 0
        ? new Date(
            Math.max(...ledgers.map((l) => l.lastTradeAt)) * 1000,
          ).toISOString()
        : null,
  };
  return row;
}

/**
 * 0–100. Win rate (confidence-weighted by sample size), PnL relative to the
 * best wallet in the set, ROI, breadth across tokens and early entries.
 * Snipers and bots are penalised: they are not copyable by a human.
 */
export function scoreTrader(wallet: TraderWallet, maxPnlUsd: number): number {
  const confidence = clamp01(wallet.tokensTraded / 6);
  const pnl =
    wallet.totalPnlUsd > 0 ? clamp01(wallet.totalPnlUsd / maxPnlUsd) : 0;
  const roi = clamp01(Math.max(0, wallet.roi) / 2);
  const breadth = clamp01(wallet.tokensTraded / 6);
  const early =
    wallet.tokensTraded > 0
      ? clamp01(wallet.earlyEntries / wallet.tokensTraded)
      : 0;
  let raw =
    0.35 * wallet.winRate * (0.5 + 0.5 * confidence) +
    0.3 * Math.sqrt(pnl) +
    0.15 * roi +
    0.1 * breadth +
    0.1 * early;
  if (wallet.flags.includes("sniper")) raw -= 0.15;
  if (wallet.flags.includes("bot")) raw -= 0.2;
  return Math.round(clamp01(raw) * 100);
}
