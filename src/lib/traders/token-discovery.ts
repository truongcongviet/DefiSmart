import { fetchDiscoveryPools } from "@/lib/api/meteora-pools";

import {
  fetchSpotlightMints,
  fetchTokensBatch,
  type DexPair,
} from "./dexscreener";
import { QUOTE_MINTS } from "./swaps";

/**
 * Which tokens to scan for smart traders: active, recently launched tokens
 * from Meteora's discovery feed (trending / new / top) and DexScreener's
 * launch feed, each resolved to its busiest pairs.
 */

export interface TrackedPair {
  address: string;
  dex: string;
  quoteSymbol: string;
  liquidityUsd: number;
  volume24hUsd: number;
  txns24h: number;
  createdAt: number | null;
}

export interface TrackedToken {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  txns24h: number;
  /** Unix seconds of the earliest known pair. */
  createdAt: number | null;
  pairs: TrackedPair[];
  source: string[];
}

export interface DiscoveryOptions {
  tokens: number;
  pairsPerToken: number;
  minLiquidityUsd?: number;
  minVolume24hUsd?: number;
  maxAgeDays?: number;
  /** Explicit mints that are always included. */
  include?: string[];
}

const STABLE_LIKE = new Set([
  "USDC",
  "USDT",
  "USDS",
  "USD1",
  "PYUSD",
  "SOL",
  "WSOL",
  "JITOSOL",
  "MSOL",
  "BSOL",
]);

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function baseOf(pool: Record<string, unknown>): Record<string, unknown> | null {
  const x = pool.token_x as Record<string, unknown> | undefined;
  const y = pool.token_y as Record<string, unknown> | undefined;
  if (!x || !y) return null;
  const xAddr = String(x.address ?? "");
  if (
    QUOTE_MINTS.has(xAddr) ||
    STABLE_LIKE.has(String(x.symbol ?? "").toUpperCase())
  ) {
    return QUOTE_MINTS.has(String(y.address ?? "")) ? null : y;
  }
  return x;
}

async function meteoraCandidates(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const category of ["trending", "new", "top"] as const) {
    try {
      const page = await fetchDiscoveryPools({
        timeframe: "24h",
        category,
        pageSize: 40,
        quality: category !== "new",
      });
      for (const pool of page.data) {
        const base = baseOf(pool);
        const mint = base ? String(base.address ?? "") : "";
        if (!mint) continue;
        const sources = out.get(mint) ?? [];
        if (!sources.includes(`meteora:${category}`))
          sources.push(`meteora:${category}`);
        out.set(mint, sources);
      }
    } catch {
      // one feed failing must not stop discovery
    }
  }
  return out;
}

function toPair(pair: DexPair): TrackedPair {
  return {
    address: pair.pairAddress,
    dex: pair.dexId,
    quoteSymbol: pair.quoteToken.symbol,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    volume24hUsd: pair.volume?.h24 ?? 0,
    txns24h: (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
    createdAt: pair.pairCreatedAt
      ? Math.floor(pair.pairCreatedAt / 1000)
      : null,
  };
}

/** Groups DexScreener pairs by base mint into tracked tokens. */
export function tokensFromPairs(
  pairs: DexPair[],
  sources: Map<string, string[]>,
  pairsPerToken: number,
): TrackedToken[] {
  const byMint = new Map<string, DexPair[]>();
  for (const pair of pairs) {
    if (pair.chainId !== "solana") continue;
    const mint = pair.baseToken.address;
    if (QUOTE_MINTS.has(mint)) continue;
    if (!QUOTE_MINTS.has(pair.quoteToken.address)) continue;
    const list = byMint.get(mint) ?? [];
    list.push(pair);
    byMint.set(mint, list);
  }
  const tokens: TrackedToken[] = [];
  for (const [mint, list] of byMint) {
    const sorted = [...list].sort(
      (a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0),
    );
    const main = sorted[0];
    const created = sorted
      .map((p) => p.pairCreatedAt)
      .filter((v): v is number => typeof v === "number" && v > 0);
    tokens.push({
      mint,
      symbol: main.baseToken.symbol.trim(),
      name: main.baseToken.name.trim(),
      logo: main.info?.imageUrl ?? null,
      priceUsd: num(main.priceUsd),
      marketCapUsd: num(main.marketCap ?? main.fdv),
      liquidityUsd: sorted.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0),
      volume24hUsd: sorted.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0),
      txns24h: sorted.reduce(
        (s, p) => s + (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0),
        0,
      ),
      createdAt: created.length
        ? Math.floor(Math.min(...created) / 1000)
        : null,
      pairs: sorted.slice(0, pairsPerToken).map(toPair),
      source: sources.get(mint) ?? ["dexscreener"],
    });
  }
  return tokens;
}

export async function discoverTokens(
  options: DiscoveryOptions,
): Promise<TrackedToken[]> {
  const minLiquidity = options.minLiquidityUsd ?? 15_000;
  const minVolume = options.minVolume24hUsd ?? 30_000;
  const maxAgeSec = (options.maxAgeDays ?? 45) * 86_400;
  const now = Math.floor(Date.now() / 1000);

  const sources = await meteoraCandidates();
  for (const mint of await fetchSpotlightMints()) {
    const list = sources.get(mint) ?? [];
    if (!list.includes("dexscreener")) list.push("dexscreener");
    sources.set(mint, list);
  }
  for (const mint of options.include ?? []) {
    const list = sources.get(mint) ?? [];
    if (!list.includes("manual")) list.push("manual");
    sources.set(mint, list);
  }

  const mints = Array.from(sources.keys());
  if (mints.length === 0) return [];
  // DexScreener returns only the main pair per token here; fetch all pairs
  // later for the shortlist.
  const mainPairs = await fetchTokensBatch(mints);
  const shortlist = tokensFromPairs(mainPairs, sources, options.pairsPerToken)
    .filter((token) => {
      if (options.include?.includes(token.mint)) return true;
      if (token.liquidityUsd < minLiquidity) return false;
      if (token.volume24hUsd < minVolume) return false;
      if (token.createdAt != null && now - token.createdAt > maxAgeSec)
        return false;
      return true;
    })
    .sort((a, b) => {
      // Busy and young first.
      const ageA = a.createdAt ? (now - a.createdAt) / 86_400 : 45;
      const ageB = b.createdAt ? (now - b.createdAt) / 86_400 : 45;
      return b.volume24hUsd / (1 + ageA / 7) - a.volume24hUsd / (1 + ageB / 7);
    })
    .slice(0, options.tokens);

  return shortlist;
}
