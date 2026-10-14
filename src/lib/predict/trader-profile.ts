import {
  computeMetrics,
  settleBets,
  type PredictMetrics,
  type SettledBet,
} from "./metrics";
import {
  fetchActivity,
  fetchClosedPositions,
  fetchOpenPositions,
  fetchPublicProfile,
  fetchUserPnl,
  PNL_TIMEFRAMES,
  type ActivityItem,
  type OpenPosition,
  type PnlTimeframe,
} from "./polymarket-api";
import {
  loadPredictSnapshot,
  readPredictBudget,
  type PredictTrader,
} from "./smart-predict-leaderboard";
import { scorePredictTrader } from "./metrics";

/**
 * Everything the PredictSmart profile page shows for one Polymarket wallet:
 * metrics, live positions (what a copier would mirror), recent settled bets
 * and the latest trades. Any address works, not only ranked ones.
 */

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 64;

export interface PredictTraderProfile {
  address: string;
  name: string;
  pseudonym: string | null;
  verified: boolean;
  profileImage: string | null;
  xUsername: string | null;
  memberSince: string | null;
  ranked: boolean;
  rank: number | null;
  score: number;
  metrics: PredictMetrics;
  live: OpenPosition[];
  /** Cumulative PnL curves per timeframe (Polymarket's own series). */
  pnlSeries: Record<PnlTimeframe, Array<[number, number]>>;
  recentBets: SettledBet[];
  activity: ActivityItem[];
  truncated: boolean;
  generatedAt: string;
}

const cache = new Map<
  string,
  { value: PredictTraderProfile; expiresAt: number }
>();
const inflight = new Map<string, Promise<PredictTraderProfile>>();

async function build(address: string): Promise<PredictTraderProfile> {
  const now = Math.floor(Date.now() / 1000);
  const [closed, open, activity, profile, snapshot, ...series] =
    await Promise.all([
      fetchClosedPositions(address, readPredictBudget().closedRows),
      fetchOpenPositions(address),
      fetchActivity(address, 60),
      fetchPublicProfile(address),
      loadPredictSnapshot(),
      ...PNL_TIMEFRAMES.map((timeframe) =>
        fetchUserPnl(address, timeframe).catch(
          () => [] as Array<[number, number]>,
        ),
      ),
    ]);
  const pnlSeries = Object.fromEntries(
    PNL_TIMEFRAMES.map((timeframe, index) => [timeframe, series[index] ?? []]),
  ) as Record<PnlTimeframe, Array<[number, number]>>;
  const metrics = computeMetrics({
    closed: closed.rows,
    open: open.rows,
    activity,
    now,
  });
  const { bets, live } = settleBets(closed.rows, open.rows, now);
  const rankIndex =
    snapshot?.traders.findIndex((t) => t.address === address) ?? -1;
  const ranked: PredictTrader | null =
    rankIndex >= 0 ? (snapshot?.traders[rankIndex] ?? null) : null;
  const maxPnl = Math.max(
    1e-9,
    ...(snapshot?.traders.map((t) => t.realizedPnlUsd) ?? [
      metrics.realizedPnlUsd,
    ]),
  );
  const tradeName = activity.find((a) => a.name)?.name ?? null;

  return {
    address,
    name: profile?.name || ranked?.name || tradeName || address.slice(0, 8),
    pseudonym: profile?.pseudonym ?? null,
    verified: Boolean(profile?.verifiedBadge ?? ranked?.verified),
    profileImage: profile?.profileImage || ranked?.profileImage || null,
    xUsername: profile?.xUsername || ranked?.xUsername || null,
    memberSince: profile?.createdAt ?? null,
    ranked: rankIndex >= 0,
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    score: scorePredictTrader(metrics, maxPnl),
    metrics,
    pnlSeries,
    live: [...live].sort(
      (a, b) => (b.currentValue || 0) - (a.currentValue || 0),
    ),
    recentBets: [...bets].sort((a, b) => b.at - a.at).slice(0, 40),
    activity: activity.filter((a) => a.type === "TRADE").slice(0, 40),
    truncated: closed.truncated,
    generatedAt: new Date().toISOString(),
  };
}

export async function getPredictTraderProfile(
  address: string,
  options: { force?: boolean } = {},
): Promise<PredictTraderProfile> {
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
