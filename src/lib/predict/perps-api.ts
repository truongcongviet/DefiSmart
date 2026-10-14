import axios from "axios";

/**
 * Polymarket Perpetuals public info API (no key). Endpoints as called by
 * polymarket.com: per-account leaderboard, biggest single wins, fills with
 * realized PnL per fill, open portfolio, daily PnL series, instruments.
 */

const BASE = "https://api.perpetuals.polymarket.com/v1/info";
const RPS = 6;
const MAX_RETRIES = 4;
const FILLS_PAGE = 100;

export type PerpWindow = "day" | "week" | "month" | "all";
export const PERP_WINDOWS: PerpWindow[] = ["day", "week", "month", "all"];

export interface PerpLeaderboardEntry {
  rank: number;
  account: string;
  pnl: string;
  notional: string;
  account_value: string;
  roi: string;
  instruments_traded: number;
  top_instrument_ids: number[];
}

export interface PerpWinEntry {
  rank: number;
  account: string;
  instrument_id: number;
  symbol: string;
  side: "long" | "short";
  pnl: string;
  timestamp: number;
}

export interface PerpFill {
  trade_id: number;
  order_id: number;
  instrument_id: number;
  side: "long" | "short";
  price: string;
  quantity: string;
  taker: boolean;
  fee: string;
  total_fee: string;
  previous_size: string;
  previous_entry_price: string;
  /** Realized PnL of this fill (non-zero when it reduces a position). */
  pnl: string;
  liquidation: boolean;
  adl: boolean;
  settlement: boolean;
  /** Unix milliseconds. */
  timestamp: number;
}

export interface PerpPosition {
  instrument_id: number;
  symbol: string;
  /** Signed size; negative = short. */
  size: string;
  entry_price: string;
  unrealized_pnl: string;
  return_on_equity: string;
}

export interface PerpPortfolio {
  positions: PerpPosition[];
  equity: string;
  timestamp: number;
}

export interface PerpLogo {
  light?: string;
  dark?: string;
}

export interface PerpInstrument {
  instrument_id: number;
  symbol: string;
  display_symbol?: string;
  category: string;
  base_asset: string;
  logo?: PerpLogo | null;
}

/** Fallbacks for the few instruments the API ships without artwork. */
const LOGO_FALLBACK: Record<string, string> = {
  BTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  ETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  SOL: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
  XRP: "https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png",
  DOGE: "https://assets.coingecko.com/coins/images/5/small/dogecoin.png",
  BNB: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png",
};

export function instrumentLogo(
  instrument: PerpInstrument | undefined,
): PerpLogo | null {
  if (!instrument) return null;
  if (instrument.logo && (instrument.logo.dark || instrument.logo.light)) {
    return {
      light: instrument.logo.light ?? instrument.logo.dark,
      dark: instrument.logo.dark ?? instrument.logo.light,
    };
  }
  const fallback = LOGO_FALLBACK[instrument.base_asset?.toUpperCase() ?? ""];
  return fallback ? { light: fallback, dark: fallback } : null;
}

const client = axios.create({
  baseURL: BASE,
  timeout: 20_000,
  headers: {
    accept: "*/*",
    origin: "https://polymarket.com",
    referer: "https://polymarket.com/",
  },
});

let tokens = RPS;
let lastRefill = Date.now();
let pausedUntil = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
  path: string,
  params: Record<string, string | number>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await take();
    try {
      return (await client.get<T>(path, { params })).data;
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error)
        ? (error.response?.status ?? 503)
        : 0;
      if (status === 404) throw error;
      if (status !== 429 && status < 500) throw error;
      if (attempt === MAX_RETRIES) throw error;
      const retryAfter = axios.isAxiosError(error)
        ? Number(error.response?.headers?.["retry-after"])
        : NaN;
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(8_000, 500 * 2 ** attempt);
      if (status === 429)
        pausedUntil = Math.max(pausedUntil, Date.now() + wait);
      else await sleep(wait);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}

export async function fetchPerpLeaderboard(options: {
  window: PerpWindow;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; entries: PerpLeaderboardEntry[] }> {
  const payload = await get<{
    total?: number;
    entries?: PerpLeaderboardEntry[];
  }>("/leaderboard", {
    window: options.window,
    limit: Math.min(100, options.limit ?? 100),
    offset: options.offset ?? 0,
  });
  return { total: payload.total ?? 0, entries: payload.entries ?? [] };
}

/** Biggest single winning trades in the window (top 100, no paging). */
export async function fetchPerpWins(
  window: PerpWindow,
  limit = 100,
): Promise<PerpWinEntry[]> {
  const payload = await get<{ entries?: PerpWinEntry[] }>("/leaderboard/wins", {
    window,
    limit: Math.min(100, limit),
  });
  return payload.entries ?? [];
}

/** Newest fills first; follows the cursor for up to `pages` pages. */
export async function fetchPerpFills(
  address: string,
  pages = 3,
): Promise<{ fills: PerpFill[]; more: boolean }> {
  const fills: PerpFill[] = [];
  let cursor: string | undefined;
  let more = false;
  for (let page = 0; page < pages; page += 1) {
    const params: Record<string, string | number> = {
      address,
      limit: FILLS_PAGE,
    };
    if (cursor) params.cursor = cursor;
    const payload = await get<{
      data?: PerpFill[];
      more?: boolean;
      cursor?: string;
    }>("/fills", params);
    fills.push(...(payload.data ?? []));
    more = Boolean(payload.more);
    cursor = payload.cursor;
    if (!more || !cursor) break;
  }
  return { fills, more };
}

export async function fetchPerpPortfolio(
  address: string,
): Promise<PerpPortfolio> {
  const payload = await get<Partial<PerpPortfolio>>("/portfolio", { address });
  return {
    positions: payload.positions ?? [],
    equity: payload.equity ?? "0",
    timestamp: payload.timestamp ?? Date.now(),
  };
}

/** Realized PnL points `[ms, pnl]` since `sinceMs` (daily by default). */
export async function fetchPerpPnlSeries(
  address: string,
  sinceMs: number,
  interval: "1h" | "4h" | "1d" | "1w" = "1d",
): Promise<Array<[number, number]>> {
  const payload = await get<{ data?: Array<[number, string]> }>("/pnl", {
    address,
    interval,
    start_timestamp: sinceMs,
    end_timestamp: Date.now(),
  });
  return (payload.data ?? [])
    .map(([ts, pnl]) => [Number(ts), Number(pnl)] as [number, number])
    .filter(([ts, pnl]) => Number.isFinite(ts) && Number.isFinite(pnl));
}

let instrumentCache: {
  map: Map<number, PerpInstrument>;
  expiresAt: number;
} | null = null;

export async function fetchPerpInstruments(): Promise<
  Map<number, PerpInstrument>
> {
  if (instrumentCache && instrumentCache.expiresAt > Date.now())
    return instrumentCache.map;
  const payload = await get<PerpInstrument[] | { data?: PerpInstrument[] }>(
    "/instruments",
    {},
  );
  const list = Array.isArray(payload) ? payload : (payload.data ?? []);
  const map = new Map(list.map((item) => [item.instrument_id, item]));
  instrumentCache = { map, expiresAt: Date.now() + 6 * 60 * 60_000 };
  return map;
}

export function perpProfileUrl(address: string) {
  return `https://polymarket.com/profile/${address}`;
}
