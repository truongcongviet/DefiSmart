import {
  computePerpMetrics,
  scorePerpTrader,
  type PerpMetrics,
} from "./perp-metrics";
import {
  fetchPerpFills,
  fetchPerpInstruments,
  fetchPerpPnlSeries,
  fetchPerpPortfolio,
  instrumentLogo,
  type PerpFill,
  type PerpLogo,
} from "./perps-api";
import {
  loadPerpSnapshot,
  readPerpBudget,
  type PerpTrader,
} from "./smart-perp-leaderboard";

/** Profile page data for one Polymarket Perps account (any address). */

const CACHE_TTL_MS = 3 * 60_000;
const CACHE_MAX = 64;
const SERIES_DAYS = 30;

export interface PerpFillRow {
  tradeId: number;
  at: string;
  symbol: string;
  logo: PerpLogo | null;
  side: "long" | "short";
  price: number;
  quantity: number;
  notionalUsd: number;
  pnlUsd: number;
  feeUsd: number;
  taker: boolean;
  liquidation: boolean;
  /** "open" grows a position, "close" reduces one (has PnL). */
  action: "open" | "close";
}

export interface PerpTraderProfile {
  address: string;
  ranked: boolean;
  rank: number | null;
  score: number;
  metrics: PerpMetrics;
  leaderboard: PerpTrader["leaderboard"] | null;
  bigWins: PerpTrader["bigWins"];
  series: Array<[number, number]>;
  fills: PerpFillRow[];
  fillsTruncated: boolean;
  generatedAt: string;
}

const cache = new Map<
  string,
  { value: PerpTraderProfile; expiresAt: number }
>();
const inflight = new Map<string, Promise<PerpTraderProfile>>();

function toRow(
  fill: PerpFill,
  symbol: string,
  logo: PerpLogo | null,
): PerpFillRow {
  const price = Number(fill.price) || 0;
  const quantity = Number(fill.quantity) || 0;
  const pnl = Number(fill.pnl) || 0;
  return {
    tradeId: fill.trade_id,
    at: new Date(fill.timestamp).toISOString(),
    symbol,
    logo,
    side: fill.side,
    price,
    quantity,
    notionalUsd: price * quantity,
    pnlUsd: pnl,
    feeUsd: Number(fill.total_fee) || 0,
    taker: fill.taker,
    liquidation: fill.liquidation || fill.adl,
    action: Math.abs(pnl) > 1e-9 ? "close" : "open",
  };
}

async function build(address: string): Promise<PerpTraderProfile> {
  const sinceMs = Date.now() - SERIES_DAYS * 86_400_000;
  const [instruments, fills, portfolio, series, snapshot] = await Promise.all([
    fetchPerpInstruments(),
    fetchPerpFills(address, readPerpBudget().fillPages),
    fetchPerpPortfolio(address).catch(() => ({
      positions: [],
      equity: "0",
      timestamp: Date.now(),
    })),
    fetchPerpPnlSeries(address, sinceMs).catch(
      () => [] as Array<[number, number]>,
    ),
    loadPerpSnapshot(),
  ]);
  const metrics = computePerpMetrics({
    fills: fills.fills,
    portfolio,
    series,
    instruments,
  });
  const index = snapshot?.traders.findIndex((t) => t.address === address) ?? -1;
  const ranked = index >= 0 ? (snapshot?.traders[index] ?? null) : null;
  const maxPnl = Math.max(
    1e-9,
    ...(snapshot?.traders.map((t) => t.pnl30dUsd) ?? [metrics.pnl30dUsd]),
  );
  const symbolOf = (id: number) => instruments.get(id)?.symbol ?? `#${id}`;

  return {
    address,
    ranked: index >= 0,
    rank: index >= 0 ? index + 1 : null,
    score: scorePerpTrader(metrics, maxPnl),
    metrics,
    leaderboard: ranked?.leaderboard ?? null,
    bigWins: ranked?.bigWins ?? [],
    series: [...series].sort((a, b) => a[0] - b[0]),
    fills: [...fills.fills]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100)
      .map((fill) =>
        toRow(
          fill,
          symbolOf(fill.instrument_id),
          instrumentLogo(instruments.get(fill.instrument_id)),
        ),
      ),
    fillsTruncated: fills.more,
    generatedAt: new Date().toISOString(),
  };
}

export async function getPerpTraderProfile(
  address: string,
  options: { force?: boolean } = {},
): Promise<PerpTraderProfile> {
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now())
    return cached.value;
  const running = inflight.get(key);
  if (running) return running;
  const task = build(key)
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
