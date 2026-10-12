import axios from "axios";

import { isRecord, toNumber } from "@/lib/utils";

/**
 * Meteora pool discovery API (the feed behind app.meteora.ag's pool list).
 * Public, no key. Swagger: https://pool-discovery-api.datapi.meteora.ag/swagger-ui/
 */

const BASE_URL = "https://pool-discovery-api.datapi.meteora.ag";
const CACHE_TTL_MS = 45_000;
const CACHE_MAX = 64;

export const POOL_TIMEFRAMES = [
  "5m",
  "30m",
  "1h",
  "2h",
  "4h",
  "12h",
  "24h",
] as const;
export const POOL_CATEGORIES = [
  "top",
  "trending",
  "new",
  "all",
  "rwa",
] as const;

export type PoolTimeframe = (typeof POOL_TIMEFRAMES)[number];
export type PoolCategory = (typeof POOL_CATEGORIES)[number];

/** Same quality gate app.meteora.ag applies to its "Top" list. */
export const QUALITY_FILTER =
  "base_token_market_cap>=70000&&base_token_holders>=15&&volume>=1000&&fee>=5&&active_tvl>=10000";

export interface DiscoveryQuery {
  timeframe?: PoolTimeframe;
  category?: PoolCategory;
  pageSize?: number;
  afterKey?: string;
  query?: string;
  /** Apply the Meteora quality filter (default true). */
  quality?: boolean;
  sortBy?: string;
}

export interface DiscoveryPage {
  total: number;
  pageSize: number;
  afterKey: string | null;
  hasMore: boolean;
  data: Record<string, unknown>[];
  fetchedAt: string;
}

export function isTimeframe(value: unknown): value is PoolTimeframe {
  return (
    typeof value === "string" &&
    (POOL_TIMEFRAMES as readonly string[]).includes(value)
  );
}

export function isCategory(value: unknown): value is PoolCategory {
  return (
    typeof value === "string" &&
    (POOL_CATEGORIES as readonly string[]).includes(value)
  );
}

const client = axios.create({ baseURL: BASE_URL, timeout: 20_000 });

interface CacheEntry {
  promise: Promise<DiscoveryPage>;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

async function request(
  params: Record<string, string | number>,
): Promise<DiscoveryPage> {
  const search = params.query ? "/search" : "/pools";
  const response = await client.get<unknown>(search, { params });
  const body = isRecord(response.data) ? response.data : {};
  const data = Array.isArray(body.data)
    ? body.data.filter((item): item is Record<string, unknown> =>
        isRecord(item),
      )
    : [];
  return {
    total: toNumber(body.total) || data.length,
    pageSize: toNumber(body.page_size) || data.length,
    afterKey:
      typeof body.after_key === "string" && body.after_key
        ? body.after_key
        : null,
    hasMore: body.has_more === true,
    data,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchDiscoveryPools(
  input: DiscoveryQuery = {},
): Promise<DiscoveryPage> {
  const params: Record<string, string | number> = {
    page_size: Math.max(1, Math.min(200, input.pageSize ?? 50)),
    timeframe: input.timeframe ?? "2h",
    category: input.category ?? "top",
  };
  if (input.quality !== false) params.filter_by = QUALITY_FILTER;
  if (input.afterKey) params.after_key = input.afterKey;
  if (input.query) params.query = input.query;
  if (input.sortBy) params.sort_by = input.sortBy;

  const key = JSON.stringify(params);
  const now = Date.now();
  for (const [entryKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(entryKey);
  }
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }

  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = request(params).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { promise, expiresAt: now + CACHE_TTL_MS });
  return promise;
}
