import axios, { type AxiosInstance } from "axios";

import { getNested, isRecord, toNumber } from "@/lib/utils";

/**
 * On-chain LP data for a Solana wallet, read from Meteora's free Data APIs
 * (no API key, DLMM 30 RPS, DAMM v2 10 RPS).
 *
 * - DLMM:    https://dlmm.datapi.meteora.ag/swagger-ui/
 * - DAMM v2: https://damm-v2.datapi.meteora.ag/swagger-ui/
 */

const DLMM_BASE_URL = "https://dlmm.datapi.meteora.ag";
const DAMM_V2_BASE_URL = "https://damm-v2.datapi.meteora.ag";

const PAGE_SIZE = 100;
const DLMM_POOL_CONCURRENCY = 5;
const DAMM_MAX_PAGES = 20;
const CACHE_TTL_MS = 120_000;
const CACHE_MAX_ENTRIES = 64;

function readMaxPools() {
  const raw = Number(process.env.LP_DATA_MAX_POOLS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return 80;
}

export type LpProtocol = "meteora_dlmm" | "meteora_damm_v2";

export interface LpTokenInfo {
  symbol: string;
  address: string;
  logo: string;
  decimals: number | null;
}

export interface LpPosition {
  owner: string;
  position: string;
  pool: string;
  protocol: LpProtocol;
  isClosed: boolean;
  token0: LpTokenInfo;
  token1: LpTokenInfo;
  depositUsd: number;
  depositNative: number;
  withdrawUsd: number;
  withdrawNative: number;
  feeUsd: number;
  feeNative: number;
  pnlUsd: number;
  pnlNative: number;
  pnlPercent: number;
  pnlPercentNative: number;
  inRange: boolean | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  closedAtMs: number | null;
}

export interface LpSourceStatus {
  dlmm: boolean;
  dammOpen: boolean;
  dammClosed: boolean;
}

export interface WalletLpSnapshot {
  owner: string;
  positions: LpPosition[];
  solPrice: number | null;
  fetchedAt: number;
  sources: LpSourceStatus;
  warnings: string[];
  dlmmPoolsTotal: number;
  dlmmPoolsScanned: number;
}

export interface LpPositionEvent {
  signature: string;
  eventType: "add" | "remove" | "claim_fee" | "claim_reward" | string;
  timestampMs: number;
  amount0: number;
  amount1: number;
  amount0Usd: number;
  amount1Usd: number;
  totalUsd: number;
}

const dlmmClient: AxiosInstance = axios.create({
  baseURL: DLMM_BASE_URL,
  timeout: 20_000,
});

const dammClient: AxiosInstance = axios.create({
  baseURL: DAMM_V2_BASE_URL,
  timeout: 20_000,
});

function toMs(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed <= 0) {
    return null;
  }
  // Meteora mixes seconds (position timestamps) and milliseconds (event blockTime).
  return parsed < 1e12 ? parsed * 1000 : parsed;
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function tokenInfo(
  symbol: unknown,
  address: unknown,
  logo: unknown,
  decimals: unknown = null,
): LpTokenInfo {
  const parsedDecimals = toNumber(decimals);
  return {
    symbol: pickString(symbol).trim(),
    address: pickString(address),
    logo: pickString(logo),
    decimals: decimals === null ? null : parsedDecimals,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    run(),
  );
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// DLMM
// ---------------------------------------------------------------------------

interface DlmmPoolMeta {
  poolAddress: string;
  tokenX: LpTokenInfo;
  tokenY: LpTokenInfo;
  lastClosedAtMs: number | null;
  hasOpen: boolean;
}

function readDlmmPoolMeta(raw: Record<string, unknown>): DlmmPoolMeta | null {
  const poolAddress = pickString(raw.poolAddress);
  if (!poolAddress) {
    return null;
  }

  return {
    poolAddress,
    tokenX: tokenInfo(raw.tokenX, raw.tokenXMint, raw.tokenXIcon),
    tokenY: tokenInfo(raw.tokenY, raw.tokenYMint, raw.tokenYIcon),
    lastClosedAtMs: toMs(raw.lastClosedAt),
    hasOpen: toNumber(raw.openPositionCount) > 0,
  };
}

async function fetchDlmmPortfolioPools(
  owner: string,
  path: "/portfolio" | "/portfolio/open",
  maxPools: number,
): Promise<{
  pools: DlmmPoolMeta[];
  totalCount: number;
  solPrice: number | null;
}> {
  const pools: DlmmPoolMeta[] = [];
  let page = 1;
  let totalCount = 0;
  let solPrice: number | null = null;

  for (;;) {
    const response = await dlmmClient.get(path, {
      params: { user: owner, page, page_size: PAGE_SIZE },
    });
    const payload = isRecord(response.data) ? response.data : {};
    totalCount = toNumber(payload.totalCount);
    const parsedSol = toNumber(payload.solPrice);
    if (parsedSol > 0) {
      solPrice = parsedSol;
    }

    const items = Array.isArray(payload.pools) ? payload.pools : [];
    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      const meta = readDlmmPoolMeta(item);
      if (meta) {
        pools.push(meta);
      }
    }

    if (
      payload.hasNext !== true ||
      items.length === 0 ||
      pools.length >= maxPools
    ) {
      break;
    }
    page += 1;
  }

  return { pools, totalCount, solPrice };
}

function readUsdSol(value: unknown): { usd: number; sol: number } {
  return {
    usd: toNumber(getNested(value, ["total", "usd"])),
    sol: toNumber(getNested(value, ["total", "sol"])),
  };
}

function readDlmmPosition(
  owner: string,
  pool: DlmmPoolMeta,
  raw: Record<string, unknown>,
): LpPosition | null {
  const position = pickString(raw.positionAddress);
  if (!position) {
    return null;
  }

  const deposits = readUsdSol(raw.allTimeDeposits);
  const withdrawals = readUsdSol(raw.allTimeWithdrawals);
  const fees = readUsdSol(raw.allTimeFees);

  const unrealized = raw.unrealizedPnl;
  const unclaimedFeeUsd =
    toNumber(getNested(unrealized, ["unclaimedFeeTokenX", "usd"])) +
    toNumber(getNested(unrealized, ["unclaimedFeeTokenY", "usd"]));
  const unclaimedFeeSol =
    toNumber(getNested(unrealized, ["unclaimedFeeTokenX", "amountSol"])) +
    toNumber(getNested(unrealized, ["unclaimedFeeTokenY", "amountSol"]));

  const isClosed = raw.isClosed === true;
  const isOutOfRange = raw.isOutOfRange;

  return {
    owner,
    position,
    pool: pool.poolAddress,
    protocol: "meteora_dlmm",
    isClosed,
    token0: pool.tokenX,
    token1: pool.tokenY,
    depositUsd: deposits.usd,
    depositNative: deposits.sol,
    withdrawUsd: withdrawals.usd,
    withdrawNative: withdrawals.sol,
    feeUsd: fees.usd + (isClosed ? 0 : unclaimedFeeUsd),
    feeNative: fees.sol + (isClosed ? 0 : unclaimedFeeSol),
    pnlUsd: toNumber(raw.pnlUsd),
    pnlNative: toNumber(raw.pnlSol),
    pnlPercent: toNumber(raw.pnlPctChange),
    pnlPercentNative: toNumber(raw.pnlSolPctChange),
    inRange: typeof isOutOfRange === "boolean" ? !isOutOfRange : null,
    createdAtMs: toMs(raw.createdAt),
    updatedAtMs: toMs(raw.updatedAt),
    closedAtMs: toMs(raw.closedAt),
  };
}

async function fetchDlmmPoolPositions(
  owner: string,
  pool: DlmmPoolMeta,
): Promise<LpPosition[]> {
  const positions: LpPosition[] = [];
  let page = 1;

  for (;;) {
    const response = await dlmmClient.get(
      `/positions/${pool.poolAddress}/pnl`,
      {
        params: { user: owner, status: "all", page, page_size: PAGE_SIZE },
      },
    );
    const payload = isRecord(response.data) ? response.data : {};
    const items = Array.isArray(payload.positions) ? payload.positions : [];

    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      const parsed = readDlmmPosition(owner, pool, item);
      if (parsed) {
        positions.push(parsed);
      }
    }

    if (payload.hasNext !== true || items.length === 0) {
      break;
    }
    page += 1;
  }

  return positions;
}

async function fetchDlmmPositions(
  owner: string,
  maxPools: number,
): Promise<{
  positions: LpPosition[];
  solPrice: number | null;
  poolsTotal: number;
  poolsScanned: number;
  warnings: string[];
}> {
  const [closed, open] = await Promise.all([
    fetchDlmmPortfolioPools(owner, "/portfolio", maxPools),
    fetchDlmmPortfolioPools(owner, "/portfolio/open", maxPools),
  ]);

  const poolMap = new Map<string, DlmmPoolMeta>();
  for (const pool of open.pools) {
    poolMap.set(pool.poolAddress, { ...pool, hasOpen: true });
  }
  for (const pool of closed.pools) {
    const existing = poolMap.get(pool.poolAddress);
    if (existing) {
      existing.lastClosedAtMs = pool.lastClosedAtMs ?? existing.lastClosedAtMs;
    } else {
      poolMap.set(pool.poolAddress, pool);
    }
  }

  // Pools with open positions always count; the rest are the most recently
  // closed ones, capped so a very active wallet does not fan out into
  // hundreds of requests.
  const ordered = Array.from(poolMap.values()).sort((a, b) => {
    if (a.hasOpen !== b.hasOpen) {
      return a.hasOpen ? -1 : 1;
    }
    return (b.lastClosedAtMs ?? 0) - (a.lastClosedAtMs ?? 0);
  });
  const selected = ordered.slice(0, maxPools);

  const warnings: string[] = [];
  const results = await mapWithConcurrency(
    selected,
    DLMM_POOL_CONCURRENCY,
    async (pool) => {
      try {
        return await fetchDlmmPoolPositions(owner, pool);
      } catch (error) {
        warnings.push(
          `DLMM pool ${pool.poolAddress}: ${
            error instanceof Error ? error.message : "fetch failed"
          }`,
        );
        return [] as LpPosition[];
      }
    },
  );

  const poolsTotal = Math.max(closed.totalCount, poolMap.size);
  if (poolMap.size > selected.length) {
    warnings.push(
      `DLMM: scanned ${selected.length} of ${poolMap.size} pools (LP_DATA_MAX_POOLS=${maxPools}).`,
    );
  }

  return {
    positions: results.flat(),
    solPrice: open.solPrice ?? closed.solPrice,
    poolsTotal,
    poolsScanned: selected.length,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// DAMM v2
// ---------------------------------------------------------------------------

function readAmountPair(value: unknown): { usd: number; sol: number } {
  return {
    usd:
      toNumber(getNested(value, ["amount_x_usd"])) +
      toNumber(getNested(value, ["amount_y_usd"])),
    sol:
      toNumber(getNested(value, ["amount_x_sol"])) +
      toNumber(getNested(value, ["amount_y_sol"])),
  };
}

function readDammToken(value: unknown): LpTokenInfo {
  return tokenInfo(
    getNested(value, ["symbol"]),
    getNested(value, ["address"]),
    getNested(value, ["icon"]),
    getNested(value, ["decimals"]),
  );
}

function readDammPosition(
  owner: string,
  raw: Record<string, unknown>,
  isClosed: boolean,
): LpPosition | null {
  const position = pickString(raw.position_address);
  const pool = pickString(raw.pool_address);
  if (!position || !pool) {
    return null;
  }

  const deposits = readAmountPair(raw.total_deposits);
  const withdrawals = readAmountPair(raw.total_withdraws);
  const claimedFees = readAmountPair(raw.total_claimed_fees);
  const unclaimedFees = isClosed
    ? { usd: 0, sol: 0 }
    : readAmountPair(getNested(raw, ["current_position", "unclaimed_fees"]));

  let inRange: boolean | null = null;
  const config = raw.pool_config;
  const poolPrice = toNumber(raw.pool_price);
  if (
    isRecord(config) &&
    config.concentrated_liquidity === true &&
    poolPrice > 0
  ) {
    const min = toNumber(config.min_price);
    const max = toNumber(config.max_price);
    inRange = poolPrice >= min && poolPrice <= max;
  } else if (isRecord(config) && config.concentrated_liquidity === false) {
    inRange = true;
  }

  const pnlUsd = isClosed ? toNumber(raw.pnl) : toNumber(raw.unrealized_pnl);
  const pnlPercent = isClosed
    ? toNumber(raw.pnl_change_pct)
    : toNumber(raw.unrealized_pnl_change_pct);

  return {
    owner,
    position,
    pool,
    protocol: "meteora_damm_v2",
    isClosed,
    token0: readDammToken(raw.token_x),
    token1: readDammToken(raw.token_y),
    depositUsd: deposits.usd,
    depositNative: deposits.sol,
    withdrawUsd: withdrawals.usd,
    withdrawNative: withdrawals.sol,
    feeUsd: claimedFees.usd + unclaimedFees.usd,
    feeNative: claimedFees.sol + unclaimedFees.sol,
    pnlUsd,
    pnlNative: toNumber(raw.pnl_sol),
    pnlPercent,
    pnlPercentNative: toNumber(raw.pnl_sol_pct_change),
    inRange,
    createdAtMs: toMs(raw.created_at),
    updatedAtMs: null,
    closedAtMs: isClosed ? toMs(raw.closed_at) : null,
  };
}

async function fetchDammPositions(
  owner: string,
  kind: "open_positions" | "closed_positions",
): Promise<{ positions: LpPosition[]; solPrice: number | null }> {
  const positions: LpPosition[] = [];
  let cursor: string | null = null;
  let solPrice: number | null = null;

  for (let page = 0; page < DAMM_MAX_PAGES; page += 1) {
    const params: Record<string, string | number> = { limit: PAGE_SIZE };
    if (cursor) {
      params.next_cursor = cursor;
    }
    const response = await dammClient.get<unknown>(
      `/wallets/${owner}/${kind}`,
      {
        params,
      },
    );
    const payload: Record<string, unknown> = isRecord(response.data)
      ? response.data
      : {};
    const parsedSol = toNumber(payload.sol_price);
    if (parsedSol > 0) {
      solPrice = parsedSol;
    }

    const items = Array.isArray(payload.data) ? payload.data : [];
    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      const parsed = readDammPosition(owner, item, kind === "closed_positions");
      if (parsed) {
        positions.push(parsed);
      }
    }

    const next: unknown = payload.next_cursor;
    if (typeof next !== "string" || !next || items.length === 0) {
      break;
    }
    cursor = next;
  }

  return { positions, solPrice };
}

// ---------------------------------------------------------------------------
// Snapshot + cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  promise: Promise<WalletLpSnapshot>;
  expiresAt: number;
}

const snapshotCache = new Map<string, CacheEntry>();

function pruneCache(now: number) {
  for (const [key, entry] of snapshotCache) {
    if (entry.expiresAt <= now) {
      snapshotCache.delete(key);
    }
  }
  while (snapshotCache.size > CACHE_MAX_ENTRIES) {
    const oldest = snapshotCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    snapshotCache.delete(oldest);
  }
}

async function buildSnapshot(owner: string): Promise<WalletLpSnapshot> {
  const maxPools = readMaxPools();
  const [dlmmResult, dammOpenResult, dammClosedResult] =
    await Promise.allSettled([
      fetchDlmmPositions(owner, maxPools),
      fetchDammPositions(owner, "open_positions"),
      fetchDammPositions(owner, "closed_positions"),
    ]);

  const warnings: string[] = [];
  const positions: LpPosition[] = [];
  let solPrice: number | null = null;
  let dlmmPoolsTotal = 0;
  let dlmmPoolsScanned = 0;

  if (dlmmResult.status === "fulfilled") {
    positions.push(...dlmmResult.value.positions);
    warnings.push(...dlmmResult.value.warnings);
    solPrice = dlmmResult.value.solPrice ?? solPrice;
    dlmmPoolsTotal = dlmmResult.value.poolsTotal;
    dlmmPoolsScanned = dlmmResult.value.poolsScanned;
  } else {
    warnings.push(`Meteora DLMM: ${describeError(dlmmResult.reason)}`);
  }

  if (dammOpenResult.status === "fulfilled") {
    positions.push(...dammOpenResult.value.positions);
    solPrice = solPrice ?? dammOpenResult.value.solPrice;
  } else {
    warnings.push(
      `Meteora DAMM v2 open: ${describeError(dammOpenResult.reason)}`,
    );
  }

  if (dammClosedResult.status === "fulfilled") {
    positions.push(...dammClosedResult.value.positions);
  } else {
    warnings.push(
      `Meteora DAMM v2 closed: ${describeError(dammClosedResult.reason)}`,
    );
  }

  if (
    dlmmResult.status === "rejected" &&
    dammOpenResult.status === "rejected" &&
    dammClosedResult.status === "rejected"
  ) {
    throw new Error(
      `Meteora data unavailable for ${owner}: ${warnings.join("; ")}`,
    );
  }

  const seen = new Set<string>();
  const unique = positions.filter((item) => {
    const key = `${item.protocol}|${item.position}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    owner,
    positions: unique,
    solPrice,
    fetchedAt: Date.now(),
    sources: {
      dlmm: dlmmResult.status === "fulfilled",
      dammOpen: dammOpenResult.status === "fulfilled",
      dammClosed: dammClosedResult.status === "fulfilled",
    },
    warnings,
    dlmmPoolsTotal,
    dlmmPoolsScanned,
  };
}

function describeError(reason: unknown): string {
  if (axios.isAxiosError(reason)) {
    return reason.response?.status
      ? `HTTP ${reason.response.status}`
      : reason.message;
  }
  return reason instanceof Error ? reason.message : "request failed";
}

export async function getWalletLpSnapshot(
  owner: string,
  options: { force?: boolean } = {},
): Promise<WalletLpSnapshot> {
  const key = owner.trim();
  const now = Date.now();
  pruneCache(now);

  const cached = snapshotCache.get(key);
  if (cached && !options.force && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = buildSnapshot(key).catch((error) => {
    snapshotCache.delete(key);
    throw error;
  });
  snapshotCache.set(key, { promise, expiresAt: now + CACHE_TTL_MS });
  return promise;
}

// ---------------------------------------------------------------------------
// Position events (DLMM only; DAMM v2 has no public event feed yet)
// ---------------------------------------------------------------------------

export async function fetchDlmmPositionEvents(
  positionAddress: string,
): Promise<LpPositionEvent[]> {
  const response = await dlmmClient.get(
    `/positions/${positionAddress}/historical`,
    { params: { order_direction: "desc" } },
  );
  const payload = isRecord(response.data) ? response.data : {};
  const events = Array.isArray(payload.events) ? payload.events : [];

  return events.flatMap((raw) => {
    if (!isRecord(raw)) {
      return [];
    }
    const timestampMs =
      toMs(raw.blockTime) ?? Date.parse(pickString(raw.createdAt));
    if (!Number.isFinite(timestampMs)) {
      return [];
    }
    return [
      {
        signature: pickString(raw.signature),
        eventType: pickString(raw.eventType),
        timestampMs,
        amount0: toNumber(raw.amountX),
        amount1: toNumber(raw.amountY),
        amount0Usd: toNumber(raw.amountXUsd),
        amount1Usd: toNumber(raw.amountYUsd),
        totalUsd: toNumber(raw.totalUsd),
      },
    ];
  });
}
