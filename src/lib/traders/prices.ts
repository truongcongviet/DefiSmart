import axios from "axios";

/**
 * SOL/USD over time, from the hourly candles of Meteora's largest SOL-USDC
 * DLMM pool (free, no key). Current price from Jupiter's keyless endpoint.
 */

const SOL_USDC_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const OHLCV_URL = `https://dlmm.datapi.meteora.ag/pools/${SOL_USDC_POOL}/ohlcv`;
const JUPITER_PRICE_URL = "https://lite-api.jup.ag/price/v3";
const WSOL = "So11111111111111111111111111111111111111112";
const HOUR = 3600;
// The endpoint rejects ranges above ~3 days ("time range too large").
const CHUNK_SEC = 3 * 24 * HOUR;
const CACHE_TTL_MS = 10 * 60_000;

interface Candle {
  timestamp: number;
  close: number;
}

export interface SolPriceSeries {
  /** Hour-aligned unix seconds → close price. */
  at(unixSeconds: number): number;
  current: number;
  candles: number;
}

let seriesCache: {
  from: number;
  to: number;
  series: SolPriceSeries;
  expiresAt: number;
} | null = null;

async function fetchCandles(from: number, to: number): Promise<Candle[]> {
  const out: Candle[] = [];
  for (let start = from; start < to; start += CHUNK_SEC) {
    const end = Math.min(to, start + CHUNK_SEC);
    const response = await axios.get<{ data?: Candle[] }>(OHLCV_URL, {
      params: { timeframe: "1h", start_time: start, end_time: end },
      timeout: 15_000,
    });
    for (const candle of response.data?.data ?? []) {
      if (Number.isFinite(candle.close) && candle.close > 0) out.push(candle);
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchSolPriceNow(): Promise<number | null> {
  try {
    const response = await axios.get<Record<string, { usdPrice?: number }>>(
      JUPITER_PRICE_URL,
      { params: { ids: WSOL }, timeout: 10_000 },
    );
    const price = response.data?.[WSOL]?.usdPrice;
    return Number.isFinite(price) && (price as number) > 0
      ? (price as number)
      : null;
  } catch {
    return null;
  }
}

/** Price series covering [from, to] (unix seconds). */
export async function getSolPriceSeries(
  from: number,
  to: number,
): Promise<SolPriceSeries> {
  const now = Date.now();
  const fromAligned = Math.floor(from / HOUR) * HOUR - HOUR;
  const toAligned = Math.ceil(to / HOUR) * HOUR + HOUR;
  if (
    seriesCache &&
    seriesCache.expiresAt > now &&
    seriesCache.from <= fromAligned &&
    seriesCache.to >= toAligned
  ) {
    return seriesCache.series;
  }

  const [candles, spot] = await Promise.all([
    fetchCandles(fromAligned, toAligned).catch(() => [] as Candle[]),
    fetchSolPriceNow(),
  ]);
  const current = spot ?? candles.at(-1)?.close ?? 0;
  if (current <= 0) throw new Error("SOL price unavailable");

  const byHour = new Map<number, number>();
  for (const candle of candles) {
    byHour.set(Math.floor(candle.timestamp / HOUR) * HOUR, candle.close);
  }
  const timestamps = Array.from(byHour.keys()).sort((a, b) => a - b);

  const series: SolPriceSeries = {
    current,
    candles: candles.length,
    at(unixSeconds) {
      if (timestamps.length === 0) return current;
      const hour = Math.floor(unixSeconds / HOUR) * HOUR;
      const exact = byHour.get(hour);
      if (exact != null) return exact;
      // Nearest earlier candle, else the earliest one, else spot.
      let lo = 0;
      let hi = timestamps.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (timestamps[mid] <= hour) lo = mid;
        else hi = mid - 1;
      }
      const key = timestamps[lo] <= hour ? timestamps[lo] : timestamps[0];
      return byHour.get(key) ?? current;
    },
  };
  seriesCache = {
    from: fromAligned,
    to: toAligned,
    series,
    expiresAt: now + CACHE_TTL_MS,
  };
  return series;
}
