import type {
  ActivityItem,
  ClosedPosition,
  OpenPosition,
} from "./polymarket-api";

/**
 * Trader quality from Polymarket positions: every closed position is a bet
 * with a known cost (shares × average price) and a realized result, so win
 * rate, ROI, profit factor and concentration follow directly.
 */

export type MarketCategory =
  | "sports"
  | "politics"
  | "crypto"
  | "finance"
  | "culture"
  | "other";

export interface CategoryStat {
  category: MarketCategory;
  markets: number;
  wins: number;
  pnlUsd: number;
}

export interface PredictMetrics {
  /** Closed positions with a known cost. */
  markets: number;
  wins: number;
  losses: number;
  /** Closed positions in the last 30 days and the win rate there. */
  markets30d: number;
  winRate30d: number | null;
  winRate: number;
  realizedPnlUsd: number;
  costUsd: number;
  roi: number;
  /** Gross wins / gross losses. */
  profitFactor: number | null;
  avgStakeUsd: number;
  medianStakeUsd: number;
  /** Share of total profit coming from the single best market, 0–1. */
  topWinShare: number;
  /** Average entry price of winning positions (lower = bigger payoff odds). */
  avgWinEntryPrice: number | null;
  categories: CategoryStat[];
  openPositions: number;
  openExposureUsd: number;
  openValueUsd: number;
  unrealizedPnlUsd: number;
  firstClosedAt: string | null;
  lastClosedAt: string | null;
  lastTradeAt: string | null;
  flags: PredictFlag[];
}

export type PredictFlag =
  | "whale"
  | "concentrated"
  | "sports-only"
  | "inactive"
  | "small-sample"
  | "favorite-only";

// Hints are whole words or hyphen-joined phrases, matched on word boundaries
// so "eth" never matches "something".
const SPORTS_HINTS = [
  "nfl",
  "nba",
  "nhl",
  "mlb",
  "ufc",
  "mma",
  "ncaa",
  "ncaab",
  "ncaaf",
  "epl",
  "soccer",
  "tennis",
  "atp",
  "wta",
  "f1",
  "golf",
  "cricket",
  "spread",
  "vs",
  "laliga",
  "bundesliga",
  "serie a",
  "ligue 1",
  "champions league",
  "esports",
  "cs2",
  "lol",
  "dota",
  "valorant",
  "wnba",
  "boxing",
  "rugby",
  "hockey",
  "baseball",
  "football",
  "basketball",
  "match",
  "game",
  "win on",
  "world cup",
  "super bowl",
  "playoffs",
];
const POLITICS_HINTS = [
  "election",
  "president",
  "presidential",
  "senate",
  "congress",
  "trump",
  "biden",
  "harris",
  "governor",
  "parliament",
  "minister",
  "vote",
  "poll",
  "republican",
  "democrat",
  "impeach",
  "cabinet",
  "mayor",
  "primary",
  "nominee",
  "ceasefire",
  "ukraine",
  "russia",
  "israel",
  "iran",
  "nato",
  "tariffs",
];
const CRYPTO_HINTS = [
  "bitcoin",
  "btc",
  "eth",
  "ethereum",
  "solana",
  "sol",
  "crypto",
  "xrp",
  "doge",
  "memecoin",
  "token",
  "altcoin",
  "hyperliquid",
  "binance",
  "coinbase",
];
const FINANCE_HINTS = [
  "fed",
  "rate cut",
  "rate hike",
  "inflation",
  "cpi",
  "gdp",
  "stock",
  "s p 500",
  "nasdaq",
  "recession",
  "tariff",
  "earnings",
  "ipo",
  "oil",
  "gold",
  "treasury",
  "nvidia",
  "apple",
  "tesla",
  "market cap",
  "fomc",
];
const CULTURE_HINTS = [
  "oscar",
  "oscars",
  "grammy",
  "grammys",
  "movie",
  "box office",
  "album",
  "song",
  "spotify",
  "netflix",
  "celebrity",
  "taylor swift",
  "kanye",
  "rotten tomatoes",
  "emmys",
  "game awards",
  "tiktok",
  "youtube",
  "mrbeast",
  "gta",
  "billboard",
];

function tokensOf(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function hasHint(tokens: string, hints: string[]) {
  return hints.some((hint) => tokens.includes(` ${hint} `));
}

export function categorize(item: {
  slug?: string;
  eventSlug?: string;
  title?: string;
  icon?: string;
}): MarketCategory {
  const iconName = (item.icon ?? "").split("/").pop() ?? "";
  const tokens = tokensOf(
    `${item.eventSlug ?? ""} ${item.slug ?? ""} ${item.title ?? ""} ${iconName}`,
  );
  if (hasHint(tokens, SPORTS_HINTS)) return "sports";
  if (hasHint(tokens, POLITICS_HINTS)) return "politics";
  if (hasHint(tokens, CRYPTO_HINTS)) return "crypto";
  if (hasHint(tokens, FINANCE_HINTS)) return "finance";
  if (hasHint(tokens, CULTURE_HINTS)) return "culture";
  return "other";
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

const DAY = 86_400;
const INACTIVE_DAYS = 14;

/**
 * One settled bet per market (conditionId). Polymarket keeps winning legs in
 * `/closed-positions` (after redeem / sell) and losing legs in `/positions`
 * at price 0, and hedgers hold both sides of a market, so results are netted
 * per market before counting wins and losses.
 */
export interface SettledBet {
  conditionId: string;
  title: string;
  eventSlug: string;
  slug: string;
  icon?: string;
  costUsd: number;
  pnlUsd: number;
  /** Unix seconds of the latest settlement seen for the market. */
  at: number;
  /** Average entry price weighted by cost, for the winning leg if any. */
  entryPrice: number;
}

interface Leg {
  conditionId: string;
  title: string;
  eventSlug: string;
  slug: string;
  icon?: string;
  cost: number;
  pnl: number;
  at: number;
  avgPrice: number;
}

function isResolvedLoss(position: OpenPosition) {
  return position.curPrice <= 0.001 && (position.currentValue ?? 0) <= 0.01;
}

function isResolvedWin(position: OpenPosition) {
  return position.curPrice >= 0.999;
}

export function settleBets(
  closed: ClosedPosition[],
  open: OpenPosition[],
  now: number,
): { bets: SettledBet[]; live: OpenPosition[] } {
  const legs: Leg[] = [];
  for (const position of closed) {
    const cost = Math.max(0, position.totalBought * position.avgPrice);
    if (cost <= 0) continue;
    legs.push({
      conditionId: position.conditionId,
      title: position.title,
      eventSlug: position.eventSlug,
      slug: position.slug,
      icon: position.icon,
      cost,
      pnl: Number.isFinite(position.realizedPnl) ? position.realizedPnl : 0,
      at: position.timestamp,
      avgPrice: position.avgPrice,
    });
  }
  const live: OpenPosition[] = [];
  for (const position of open) {
    const cost = Math.max(0, position.initialValue || 0);
    const endAt = position.endDate
      ? Math.floor(Date.parse(position.endDate) / 1000)
      : now;
    if (isResolvedLoss(position) && cost > 0) {
      legs.push({
        conditionId: position.conditionId,
        title: position.title,
        eventSlug: position.eventSlug,
        slug: position.slug,
        icon: position.icon,
        cost,
        pnl: (position.realizedPnl || 0) - cost,
        at: Number.isFinite(endAt) ? endAt : now,
        avgPrice: position.avgPrice,
      });
    } else if (isResolvedWin(position) && cost > 0) {
      legs.push({
        conditionId: position.conditionId,
        title: position.title,
        eventSlug: position.eventSlug,
        slug: position.slug,
        icon: position.icon,
        cost,
        pnl: (position.currentValue || 0) - cost + (position.realizedPnl || 0),
        at: Number.isFinite(endAt) ? endAt : now,
        avgPrice: position.avgPrice,
      });
    } else {
      live.push(position);
    }
  }

  const byMarket = new Map<
    string,
    SettledBet & { winCost: number; winPrice: number }
  >();
  for (const leg of legs) {
    const bet = byMarket.get(leg.conditionId) ?? {
      conditionId: leg.conditionId,
      title: leg.title,
      eventSlug: leg.eventSlug,
      slug: leg.slug,
      icon: leg.icon,
      costUsd: 0,
      pnlUsd: 0,
      at: 0,
      entryPrice: 0,
      winCost: 0,
      winPrice: 0,
    };
    bet.costUsd += leg.cost;
    bet.pnlUsd += leg.pnl;
    bet.at = Math.max(bet.at, leg.at);
    if (leg.pnl > 0) {
      bet.winPrice =
        (bet.winPrice * bet.winCost + leg.avgPrice * leg.cost) /
        (bet.winCost + leg.cost);
      bet.winCost += leg.cost;
    }
    byMarket.set(leg.conditionId, bet);
  }
  const bets = Array.from(byMarket.values()).map((bet) => ({
    conditionId: bet.conditionId,
    title: bet.title,
    eventSlug: bet.eventSlug,
    slug: bet.slug,
    icon: bet.icon,
    costUsd: bet.costUsd,
    pnlUsd: bet.pnlUsd,
    at: bet.at,
    entryPrice: bet.winCost > 0 ? bet.winPrice : 0,
  }));
  return { bets, live };
}

export function computeMetrics(input: {
  closed: ClosedPosition[];
  open: OpenPosition[];
  activity: ActivityItem[];
  now?: number;
}): PredictMetrics {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const { bets, live } = settleBets(input.closed, input.open, now);

  const wins = bets.filter((bet) => bet.pnlUsd > 0);
  const losses = bets.filter((bet) => bet.pnlUsd < 0);
  const grossWin = wins.reduce((sum, bet) => sum + bet.pnlUsd, 0);
  const grossLoss = -losses.reduce((sum, bet) => sum + bet.pnlUsd, 0);
  const realized = bets.reduce((sum, bet) => sum + bet.pnlUsd, 0);
  const cost = bets.reduce((sum, bet) => sum + bet.costUsd, 0);
  const stakes = bets.map((bet) => bet.costUsd);
  const topWin = wins.reduce((max, bet) => Math.max(max, bet.pnlUsd), 0);

  const recent = bets.filter((bet) => bet.at >= now - 30 * DAY);
  const recentWins = recent.filter((bet) => bet.pnlUsd > 0).length;

  const categoryMap = new Map<MarketCategory, CategoryStat>();
  for (const bet of bets) {
    const category = categorize(bet);
    const stat = categoryMap.get(category) ?? {
      category,
      markets: 0,
      wins: 0,
      pnlUsd: 0,
    };
    stat.markets += 1;
    if (bet.pnlUsd > 0) stat.wins += 1;
    stat.pnlUsd += bet.pnlUsd;
    categoryMap.set(category, stat);
  }
  const categories = Array.from(categoryMap.values()).sort(
    (a, b) => b.markets - a.markets,
  );

  const openExposure = live.reduce((sum, p) => sum + (p.initialValue || 0), 0);
  const openValue = live.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  const unrealized = live.reduce((sum, p) => sum + (p.cashPnl || 0), 0);

  const trades = input.activity.filter((item) => item.type === "TRADE");
  const lastTrade = trades.length
    ? Math.max(...trades.map((t) => t.timestamp))
    : null;
  const settledTimes = bets.map((bet) => bet.at).filter((t) => t > 0);

  const avgWinEntry = wins.length
    ? wins.reduce((sum, bet) => sum + bet.entryPrice, 0) / wins.length
    : null;

  const flags: PredictFlag[] = [];
  const sportsShare =
    (categoryMap.get("sports")?.markets ?? 0) / Math.max(1, bets.length);
  if (bets.length < 10) flags.push("small-sample");
  if (realized > 0 && topWin / realized > 0.5 && bets.length >= 3)
    flags.push("concentrated");
  if (sportsShare >= 0.9 && bets.length >= 5) flags.push("sports-only");
  if (median(stakes) >= 10_000) flags.push("whale");
  const lastSeen = Math.max(
    lastTrade ?? 0,
    settledTimes.length ? Math.max(...settledTimes) : 0,
  );
  if (lastSeen > 0 && now - lastSeen > INACTIVE_DAYS * DAY)
    flags.push("inactive");
  if (avgWinEntry != null && avgWinEntry >= 0.9 && wins.length >= 5)
    flags.push("favorite-only");

  return {
    markets: bets.length,
    wins: wins.length,
    losses: losses.length,
    markets30d: recent.length,
    winRate30d: recent.length ? recentWins / recent.length : null,
    winRate: bets.length ? wins.length / bets.length : 0,
    realizedPnlUsd: realized,
    costUsd: cost,
    roi: cost > 0 ? realized / cost : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? null : 0,
    avgStakeUsd: bets.length ? cost / bets.length : 0,
    medianStakeUsd: median(stakes),
    topWinShare: realized > 0 ? clamp01(topWin / realized) : 0,
    avgWinEntryPrice: avgWinEntry,
    categories,
    openPositions: live.length,
    openExposureUsd: openExposure,
    openValueUsd: openValue,
    unrealizedPnlUsd: unrealized,
    firstClosedAt: settledTimes.length
      ? new Date(Math.min(...settledTimes) * 1000).toISOString()
      : null,
    lastClosedAt: settledTimes.length
      ? new Date(Math.max(...settledTimes) * 1000).toISOString()
      : null,
    lastTradeAt: lastTrade ? new Date(lastTrade * 1000).toISOString() : null,
    flags,
  };
}

/**
 * 0–100. Win rate weighted by sample size, profit relative to the best
 * trader in the set, ROI, profit factor, and diversification. Copyability
 * matters: concentrated one-hit wonders, whales and inactive traders lose
 * points.
 */
export function scorePredictTrader(
  metrics: PredictMetrics,
  maxPnlUsd: number,
): number {
  const confidence = clamp01(metrics.markets / 40);
  const pnl =
    metrics.realizedPnlUsd > 0
      ? clamp01(metrics.realizedPnlUsd / maxPnlUsd)
      : 0;
  const roi = clamp01(Math.max(0, metrics.roi) / 1);
  const pf =
    metrics.profitFactor == null ? 1 : clamp01(metrics.profitFactor / 3);
  const spread = 1 - metrics.topWinShare;
  let raw =
    0.35 * metrics.winRate * (0.4 + 0.6 * confidence) +
    0.25 * Math.sqrt(pnl) +
    0.15 * roi +
    0.15 * pf +
    0.1 * spread;
  if (metrics.flags.includes("small-sample")) raw *= 0.6;
  if (metrics.flags.includes("concentrated")) raw -= 0.1;
  if (metrics.flags.includes("inactive")) raw -= 0.1;
  if (metrics.flags.includes("whale")) raw -= 0.05;
  if (metrics.flags.includes("favorite-only")) raw -= 0.05;
  return Math.round(clamp01(raw) * 100);
}
