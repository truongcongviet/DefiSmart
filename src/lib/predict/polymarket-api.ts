import axios from "axios";

/**
 * Polymarket public APIs (free, no key). Same endpoints the Polymarket
 * front-end uses: Data API for leaderboard / positions / activity, Gamma for
 * public profiles. Paced to stay polite.
 */

const DATA_API = "https://data-api.polymarket.com";
const GAMMA_API = "https://gamma-api.polymarket.com";
const PAGE_LIMIT = 500;
const RPS = 6;
const MAX_RETRIES = 4;

export type TimePeriod = "DAY" | "WEEK" | "MONTH" | "ALL";
export const TIME_PERIODS: TimePeriod[] = ["DAY", "WEEK", "MONTH", "ALL"];
export type LeaderboardCategory =
  | "OVERALL"
  | "POLITICS"
  | "SPORTS"
  | "CRYPTO"
  | "CULTURE"
  | "MENTIONS"
  | "WEATHER"
  | "ECONOMICS"
  | "TECH"
  | "FINANCE";

export interface LeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  xUsername?: string;
  verifiedBadge?: boolean;
  vol: number;
  pnl: number;
  profileImage?: string;
}

export interface ClosedPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  /** Shares bought over the life of the position. */
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  title: string;
  slug: string;
  icon?: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome?: string;
  endDate?: string;
  /** Unix seconds when the position was closed / resolved. */
  timestamp: number;
}

export interface OpenPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  initialValue: number;
  currentValue: number;
  totalBought: number;
  cashPnl: number;
  percentPnl: number;
  realizedPnl: number;
  title: string;
  slug: string;
  icon?: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome?: string;
  endDate?: string;
  negativeRisk?: boolean;
  redeemable?: boolean;
}

export interface ActivityItem {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type:
    | "TRADE"
    | "REDEEM"
    | "SPLIT"
    | "MERGE"
    | "REWARD"
    | "CONVERSION"
    | string;
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side: "BUY" | "SELL" | "";
  outcomeIndex: number;
  title: string;
  slug: string;
  icon?: string;
  eventSlug: string;
  outcome: string;
  name?: string;
  pseudonym?: string;
  profileImage?: string;
}

export interface PublicProfile {
  proxyWallet: string;
  name?: string;
  pseudonym?: string;
  verifiedBadge?: boolean;
  profileImage?: string;
  xUsername?: string;
  createdAt?: string;
  takerTierName?: string;
}

const client = axios.create({
  timeout: 20_000,
  headers: { accept: "application/json" },
});

let tokens = RPS;
let lastRefill = Date.now();
let pausedUntil = 0;
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function take() {
  for (;;) {
    const now = Date.now();
    if (pausedUntil > now) {
      await sleep(pausedUntil - now);
      continue;
    }
    tokens = Math.min(RPS, tokens + ((now - lastRefill) / 1000) * RPS);
    lastRefill = now;
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    await sleep(Math.ceil(((1 - tokens) / RPS) * 1000));
  }
}

async function get<T>(
  url: string,
  params: Record<string, string | number>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await take();
    try {
      const response = await client.get<T>(url, { params });
      return response.data;
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error)
        ? (error.response?.status ?? 503)
        : 0;
      if (status !== 429 && status < 500) throw error;
      if (attempt === MAX_RETRIES) throw error;
      const wait = Math.min(8_000, 500 * 2 ** attempt);
      if (status === 429)
        pausedUntil = Math.max(pausedUntil, Date.now() + wait);
      else await sleep(wait);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}

function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function fetchLeaderboard(options: {
  timePeriod: TimePeriod;
  category?: LeaderboardCategory;
  orderBy?: "PNL" | "VOL";
  limit?: number;
  offset?: number;
}): Promise<LeaderboardEntry[]> {
  const payload = await get<unknown>(`${DATA_API}/v1/leaderboard`, {
    timePeriod: options.timePeriod,
    category: options.category ?? "OVERALL",
    orderBy: options.orderBy ?? "PNL",
    limit: Math.min(100, options.limit ?? 50),
    offset: options.offset ?? 0,
  });
  return asList<LeaderboardEntry>(payload).filter((row) => row.proxyWallet);
}

async function paged<T>(
  url: string,
  params: Record<string, string | number>,
  maxRows: number,
  pageSize = PAGE_LIMIT,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    if (limit <= 0) return { rows, truncated: true };
    const page = asList<T>(
      await get<unknown>(url, { ...params, limit, offset }),
    );
    rows.push(...page);
    if (page.length < limit) return { rows, truncated: false };
    offset += page.length;
  }
}

/**
 * Redeemed / sold-out positions (always realized-PnL ≥ 0 in practice: losing
 * positions never get redeemed, they stay in `/positions` at price 0). The
 * endpoint serves 50 rows per page regardless of `limit`.
 */
export function fetchClosedPositions(user: string, maxRows = 1500) {
  return paged<ClosedPosition>(
    `${DATA_API}/closed-positions`,
    { user, sortBy: "TIMESTAMP", sortDirection: "DESC" },
    maxRows,
    50,
  );
}

export function fetchOpenPositions(user: string, maxRows = 500) {
  return paged<OpenPosition>(
    `${DATA_API}/positions`,
    { user, sizeThreshold: 0 },
    maxRows,
  );
}

export async function fetchActivity(
  user: string,
  limit = 100,
): Promise<ActivityItem[]> {
  const payload = await get<unknown>(`${DATA_API}/activity`, {
    user,
    limit: Math.min(PAGE_LIMIT, limit),
    offset: 0,
    sortBy: "TIMESTAMP",
    sortDirection: "DESC",
    excludeDepositsWithdrawals: "true",
  });
  return asList<ActivityItem>(payload);
}

export async function fetchPublicProfile(
  address: string,
): Promise<PublicProfile | null> {
  try {
    const payload = await get<PublicProfile>(`${GAMMA_API}/public-profile`, {
      address,
    });
    return payload && payload.proxyWallet ? payload : null;
  } catch {
    return null;
  }
}

export function polymarketProfileUrl(address: string) {
  return `https://polymarket.com/profile/${address}`;
}

export function polymarketEventUrl(eventSlug: string) {
  return `https://polymarket.com/event/${eventSlug}`;
}

// ---------------------------------------------------------------------------
// PnL history (user-pnl-api, as used by polymarket.com's portfolio chart)
// ---------------------------------------------------------------------------

const USER_PNL_API = "https://user-pnl-api.polymarket.com/user-pnl";

export type PnlTimeframe = "1D" | "1W" | "1M" | "ALL";
export const PNL_TIMEFRAMES: PnlTimeframe[] = ["1D", "1W", "1M", "ALL"];
const PNL_REQUESTS: Record<
  PnlTimeframe,
  { interval: string; fidelity: string }
> = {
  "1D": { interval: "1d", fidelity: "1h" },
  "1W": { interval: "1w", fidelity: "3h" },
  "1M": { interval: "1m", fidelity: "1d" },
  ALL: { interval: "all", fidelity: "12h" },
};

/** Cumulative PnL points `[unixSeconds, pnlUsd]` for the timeframe. */
export async function fetchUserPnl(
  address: string,
  timeframe: PnlTimeframe,
): Promise<Array<[number, number]>> {
  const payload = await get<Array<{ t?: number; p?: number }>>(USER_PNL_API, {
    user_address: address,
    ...PNL_REQUESTS[timeframe],
  });
  return (Array.isArray(payload) ? payload : [])
    .map((row) => [Number(row.t), Number(row.p)] as [number, number])
    .filter(([t, p]) => Number.isFinite(t) && Number.isFinite(p))
    .sort((a, b) => a[0] - b[0]);
}
