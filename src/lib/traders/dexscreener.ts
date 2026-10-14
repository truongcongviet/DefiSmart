import axios from "axios";

/**
 * DexScreener public API (no key). Used for token → pairs lookup, current
 * prices and launch metadata. Limits: ~300 req/min on pair endpoints,
 * 60 req/min on profile/boost endpoints.
 */

const BASE = "https://api.dexscreener.com";
const client = axios.create({ baseURL: BASE, timeout: 15_000 });
const TOKENS_PER_CALL = 30;

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd?: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
}

let lastCall = 0;
async function paced<T>(task: () => Promise<T>): Promise<T> {
  // ≤ 4 calls/s keeps us far below the published limits.
  const wait = lastCall + 250 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return task();
}

/** Every Solana pair of a token, as DexScreener sees it. */
export async function fetchTokenPairs(mint: string): Promise<DexPair[]> {
  const response = await paced(() =>
    client.get<DexPair[]>(`/token-pairs/v1/solana/${mint}`),
  );
  return Array.isArray(response.data) ? response.data : [];
}

/** Main pair per token for up to 30 mints in one call. */
export async function fetchTokensBatch(mints: string[]): Promise<DexPair[]> {
  const out: DexPair[] = [];
  for (let i = 0; i < mints.length; i += TOKENS_PER_CALL) {
    const chunk = mints.slice(i, i + TOKENS_PER_CALL);
    const response = await paced(() =>
      client.get<DexPair[]>(`/tokens/v1/solana/${chunk.join(",")}`),
    );
    if (Array.isArray(response.data)) out.push(...response.data);
  }
  return out;
}

interface ProfileRow {
  chainId: string;
  tokenAddress: string;
}

/** Recently listed / boosted Solana tokens (launch feed). */
export async function fetchSpotlightMints(): Promise<string[]> {
  const mints = new Set<string>();
  for (const path of ["/token-profiles/latest/v1", "/token-boosts/top/v1"]) {
    try {
      const response = await paced(() => client.get<ProfileRow[]>(path));
      for (const row of response.data ?? []) {
        if (row.chainId === "solana" && row.tokenAddress)
          mints.add(row.tokenAddress);
      }
    } catch {
      // optional source
    }
  }
  return Array.from(mints);
}

/** Current USD prices for many mints (null when DexScreener has no pair). */
export async function fetchTokenPrices(
  mints: string[],
): Promise<Map<string, { priceUsd: number; pair: DexPair }>> {
  const result = new Map<string, { priceUsd: number; pair: DexPair }>();
  const unique = Array.from(new Set(mints));
  const pairs = await fetchTokensBatch(unique);
  for (const pair of pairs) {
    const price = Number(pair.priceUsd);
    const mint = pair.baseToken.address;
    const existing = result.get(mint);
    const liquidity = pair.liquidity?.usd ?? 0;
    if (
      Number.isFinite(price) &&
      price > 0 &&
      (!existing || liquidity > (existing.pair.liquidity?.usd ?? 0))
    ) {
      result.set(mint, { priceUsd: price, pair });
    }
  }
  return result;
}
