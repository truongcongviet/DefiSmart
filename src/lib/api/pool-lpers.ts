import {
  fetchDammPositions,
  fetchDlmmPoolPositions,
  fetchPoolMeta,
  poolMetaToDlmmMeta,
  type LpPosition,
  type LpProtocol,
  type PoolMeta,
} from "@/lib/api/meteora-lp";
import {
  getDammV2PoolPositions,
  getDlmmPoolPositions,
  isPublicRpc,
} from "@/lib/api/solana-rpc";

/**
 * Who is providing liquidity in a pool, and how each wallet is doing there.
 *
 * 1. On-chain discovery: position accounts of the pool via `getProgramAccounts`
 *    (only wallets with an OPEN position are discoverable; closed positions are
 *    gone from the chain).
 * 2. Per wallet: every position it ever had in this pool, from the Meteora
 *    Data API, aggregated into deposits / fees / PnL.
 */

const CACHE_TTL_MS = 180_000;
const CACHE_MAX_ENTRIES = 32;
const WALLET_CONCURRENCY = 5;

function readMaxWallets() {
  const raw = Number(process.env.POOL_LPERS_MAX_WALLETS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120;
}

export interface PoolPositionRow {
  owner: string;
  position: string;
  valueUsd: number;
  valueNative: number;
  /** Share of the pool's TVL held by this position, 0–1. */
  shareOfPool: number;
  feeUsd: number;
  feeNative: number;
  unclaimedFeeNative: number;
  pnlUsd: number;
  pnlNative: number;
  pnlPercent: number;
  pnlPercentNative: number;
  ageHours: number;
  minPrice: number | null;
  maxPrice: number | null;
  inRange: boolean | null;
  createdAt: string | null;
}

export interface PoolLperSummary {
  owner: string;
  avgAgeHours: number;
  positions: number;
  openPositions: number;
  closedPositions: number;
  depositUsd: number;
  depositNative: number;
  withdrawUsd: number;
  withdrawNative: number;
  feeUsd: number;
  feeNative: number;
  pnlUsd: number;
  pnlNative: number;
  pnlPercent: number;
  winRate: number;
  inRange: boolean | null;
  firstActivity: string | null;
  lastActivity: string | null;
  openPositionAddresses: string[];
}

export interface PoolLpersResult {
  pool: PoolMeta;
  generatedAt: string;
  solPrice: number | null;
  totals: {
    openPositionsOnChain: number;
    walletsOnChain: number;
    walletsAnalyzed: number;
    walletsSkipped: number;
    unresolvedPositions: number;
    depositUsd: number;
    pnlUsd: number;
    feeUsd: number;
    winners: number;
    losers: number;
  };
  wallets: PoolLperSummary[];
  /** Open positions found on-chain, largest first. */
  positions: PoolPositionRow[];
  warnings: string[];
  rpc: "public" | "custom";
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function toIso(ms: number | null) {
  return ms ? new Date(ms).toISOString() : null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

function summarizeWallet(
  owner: string,
  positions: LpPosition[],
  openAddresses: Set<string>,
): PoolLperSummary {
  const closed = positions.filter((item) => item.isClosed);
  const open = positions.filter((item) => !item.isClosed);
  const sum = (pick: (item: LpPosition) => number) =>
    positions.reduce((total, item) => total + pick(item), 0);

  const depositUsd = sum((item) => item.depositUsd);
  const pnlUsd = sum((item) => item.pnlUsd);
  const times = positions
    .flatMap((item) => [item.createdAtMs, item.closedAtMs ?? item.updatedAtMs])
    .filter((value): value is number => typeof value === "number" && value > 0);

  const rangeFlags = open
    .map((item) => item.inRange)
    .filter((value): value is boolean => typeof value === "boolean");
  const inRange =
    rangeFlags.length === 0 ? null : rangeFlags.some((value) => value);

  const now = Date.now();
  const ages = positions
    .filter((item) => item.createdAtMs)
    .map(
      (item) =>
        ((item.closedAtMs ?? now) - (item.createdAtMs ?? now)) / 3_600_000,
    );

  return {
    owner,
    avgAgeHours: ages.length
      ? ages.reduce((a, b) => a + b, 0) / ages.length
      : 0,
    positions: positions.length,
    openPositions: open.length,
    closedPositions: closed.length,
    depositUsd,
    depositNative: sum((item) => item.depositNative),
    withdrawUsd: sum((item) => item.withdrawUsd),
    withdrawNative: sum((item) => item.withdrawNative),
    feeUsd: sum((item) => item.feeUsd),
    feeNative: sum((item) => item.feeNative),
    pnlUsd,
    pnlNative: sum((item) => item.pnlNative),
    pnlPercent: ratio(pnlUsd, depositUsd) * 100,
    winRate: ratio(
      closed.filter((item) => item.pnlUsd > 0).length,
      closed.length,
    ),
    inRange,
    firstActivity: toIso(times.length ? Math.min(...times) : null),
    lastActivity: toIso(times.length ? Math.max(...times) : null),
    openPositionAddresses: open
      .map((item) => item.position)
      .filter((address) => openAddresses.has(address)),
  };
}

async function buildPoolLpers(
  address: string,
  preferred?: LpProtocol,
): Promise<PoolLpersResult> {
  const pool = await fetchPoolMeta(address, preferred);
  if (!pool) {
    throw new Error(`Pool ${address} not found on Meteora DLMM or DAMM v2.`);
  }

  const warnings: string[] = [];
  let onChain: { position: string; owner: string }[] = [];
  let unresolved = 0;

  if (pool.protocol === "meteora_dlmm") {
    onChain = await getDlmmPoolPositions(pool.address);
  } else {
    const result = await getDammV2PoolPositions(pool.address);
    onChain = result.positions;
    unresolved = result.unresolved;
    if (unresolved > 0) {
      warnings.push(
        `${unresolved} DAMM v2 position(s) could not be mapped to an owner (NFT lookup failed).`,
      );
    }
  }

  const openAddresses = new Set(onChain.map((item) => item.position));
  const owners = Array.from(new Set(onChain.map((item) => item.owner)));
  const maxWallets = readMaxWallets();
  const selected = owners.slice(0, maxWallets);
  if (owners.length > selected.length) {
    warnings.push(
      `Analyzed ${selected.length} of ${owners.length} wallets (POOL_LPERS_MAX_WALLETS=${maxWallets}).`,
    );
  }

  let solPrice: number | null = null;
  const dlmmMeta = poolMetaToDlmmMeta(pool);
  const openRows: PoolPositionRow[] = [];
  const now = Date.now();
  const poolTvl = pool.tvl;

  function collectOpenRows(positions: LpPosition[]) {
    for (const item of positions) {
      if (item.isClosed || !openAddresses.has(item.position)) {
        continue;
      }
      openRows.push({
        owner: item.owner,
        position: item.position,
        valueUsd: item.valueUsd,
        valueNative: item.valueNative,
        shareOfPool: ratio(item.valueUsd, poolTvl),
        feeUsd: item.feeUsd,
        feeNative: item.feeNative,
        unclaimedFeeNative: item.unclaimedFeeNative,
        pnlUsd: item.pnlUsd,
        pnlNative: item.pnlNative,
        pnlPercent: item.pnlPercent,
        pnlPercentNative: item.pnlPercentNative,
        ageHours: item.createdAtMs ? (now - item.createdAtMs) / 3_600_000 : 0,
        minPrice: item.minPrice,
        maxPrice: item.maxPrice,
        inRange: item.inRange,
        createdAt: toIso(item.createdAtMs),
      });
    }
  }

  const summaries = await mapWithConcurrency(
    selected,
    WALLET_CONCURRENCY,
    async (owner) => {
      try {
        let positions: LpPosition[];
        if (pool.protocol === "meteora_dlmm") {
          positions = await fetchDlmmPoolPositions(owner, dlmmMeta);
        } else {
          const [open, closed] = await Promise.all([
            fetchDammPositions(owner, "open_positions", pool.address),
            fetchDammPositions(owner, "closed_positions", pool.address),
          ]);
          solPrice = solPrice ?? open.solPrice ?? closed.solPrice;
          positions = [...open.positions, ...closed.positions];
        }
        collectOpenRows(positions);
        // An empty list means on-chain knows the wallet but the indexer has
        // not caught up yet; still list it so the roster is complete.
        return summarizeWallet(owner, positions, openAddresses);
      } catch (error) {
        warnings.push(
          `${owner}: ${error instanceof Error ? error.message : "fetch failed"}`,
        );
        return null;
      }
    },
  );

  const wallets = summaries
    .filter((item): item is PoolLperSummary => item !== null)
    .sort((a, b) => b.pnlUsd - a.pnlUsd);

  const totals = {
    openPositionsOnChain: onChain.length,
    walletsOnChain: owners.length,
    walletsAnalyzed: wallets.length,
    walletsSkipped: owners.length - wallets.length,
    unresolvedPositions: unresolved,
    depositUsd: wallets.reduce((sum, item) => sum + item.depositUsd, 0),
    pnlUsd: wallets.reduce((sum, item) => sum + item.pnlUsd, 0),
    feeUsd: wallets.reduce((sum, item) => sum + item.feeUsd, 0),
    winners: wallets.filter((item) => item.pnlUsd > 0).length,
    losers: wallets.filter((item) => item.pnlUsd < 0).length,
  };

  openRows.sort((a, b) => b.valueUsd - a.valueUsd);

  return {
    pool,
    generatedAt: new Date().toISOString(),
    solPrice,
    totals,
    wallets,
    positions: openRows,
    warnings,
    rpc: isPublicRpc() ? "public" : "custom",
  };
}

interface CacheEntry {
  promise: Promise<PoolLpersResult>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function getPoolLpers(
  address: string,
  options: { protocol?: LpProtocol; force?: boolean } = {},
): Promise<PoolLpersResult> {
  const key = `${address}|${options.protocol ?? ""}`;
  const now = Date.now();

  for (const [entryKey, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(entryKey);
    }
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }

  const cached = cache.get(key);
  if (cached && !options.force && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = buildPoolLpers(address, options.protocol).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { promise, expiresAt: now + CACHE_TTL_MS });
  return promise;
}
