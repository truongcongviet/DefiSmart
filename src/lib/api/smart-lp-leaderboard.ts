import { promises as fs } from "node:fs";
import path from "node:path";

import { fetchDiscoveryPools } from "@/lib/api/meteora-pools";
import { getPoolLpers, type PoolLperSummary } from "@/lib/api/pool-lpers";
import type { LpProtocol } from "@/lib/api/meteora-lp";

/**
 * "Smart LP" leaderboard built purely from on-chain data: scan the top Meteora
 * pools, collect every wallet currently providing liquidity, aggregate how each
 * wallet has done across those pools, and rank them.
 *
 * Replaces the paid LP Agent smart-lp feed.
 */

const DEFAULT_POOLS = 30;
// Pools are scanned one at a time: the public Solana RPC rate-limits
// getProgramAccounts hard, and the RPC client already paces those calls.
const POOL_CONCURRENCY = 1;
const CACHE_TTL_MS = 60 * 60_000;
const FILE_MAX_AGE_MS = 3 * 60 * 60_000;
const MIN_POSITIONS = 2;

const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "smart-lp-leaderboard.json",
);

export interface LeaderboardPool {
  address: string;
  name: string;
  protocol: LpProtocol;
  pnlNative: number;
  pnlUsd: number;
  openPositions: number;
}

export interface LeaderboardWallet {
  owner: string;
  score: number;
  pnlUsd: number;
  pnlNative: number;
  feeUsd: number;
  feeNative: number;
  depositUsd: number;
  depositNative: number;
  positions: number;
  openPositions: number;
  closedPositions: number;
  winRate: number;
  avgAgeHours: number;
  poolCount: number;
  pools: LeaderboardPool[];
  lastActivity: string | null;
}

export interface Leaderboard {
  generatedAt: string;
  timeframe: string;
  poolsRequested: number;
  poolsScanned: number;
  poolsFailed: number;
  walletsSeen: number;
  wallets: LeaderboardWallet[];
  warnings: string[];
}

interface Accumulator {
  owner: string;
  pnlUsd: number;
  pnlNative: number;
  feeUsd: number;
  feeNative: number;
  depositUsd: number;
  depositNative: number;
  positions: number;
  openPositions: number;
  closedPositions: number;
  wins: number;
  ageWeighted: number;
  pools: LeaderboardPool[];
  lastActivityMs: number;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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

function fold(
  acc: Accumulator,
  wallet: PoolLperSummary,
  pool: LeaderboardPool,
) {
  acc.pnlUsd += wallet.pnlUsd;
  acc.pnlNative += wallet.pnlNative;
  acc.feeUsd += wallet.feeUsd;
  acc.feeNative += wallet.feeNative;
  acc.depositUsd += wallet.depositUsd;
  acc.depositNative += wallet.depositNative;
  acc.positions += wallet.positions;
  acc.openPositions += wallet.openPositions;
  acc.closedPositions += wallet.closedPositions;
  acc.wins += wallet.winRate * wallet.closedPositions;
  acc.ageWeighted += wallet.avgAgeHours * wallet.positions;
  acc.pools.push(pool);
  const last = wallet.lastActivity ? Date.parse(wallet.lastActivity) : 0;
  if (last > acc.lastActivityMs) acc.lastActivityMs = last;
}

function score(
  acc: Accumulator,
  maxPnlNative: number,
  maxFeeNative: number,
): number {
  const winRate = acc.closedPositions > 0 ? acc.wins / acc.closedPositions : 0;
  // Few closed positions → low confidence in the win rate.
  const confidence = clamp01(acc.closedPositions / 8);
  const pnl = acc.pnlNative > 0 ? clamp01(acc.pnlNative / maxPnlNative) : 0;
  const fee = clamp01(acc.feeNative / maxFeeNative);
  const breadth = clamp01(acc.pools.length / 4);
  const raw =
    0.35 * winRate * (0.5 + 0.5 * confidence) +
    0.35 * Math.sqrt(pnl) +
    0.15 * Math.sqrt(fee) +
    0.15 * breadth;
  return Math.round(raw * 100);
}

async function buildLeaderboard(poolsRequested: number): Promise<Leaderboard> {
  const warnings: string[] = [];
  const page = await fetchDiscoveryPools({
    timeframe: "24h",
    category: "top",
    pageSize: poolsRequested,
  });

  const pools = page.data
    .map((item) => ({
      address: typeof item.pool_address === "string" ? item.pool_address : "",
      name: typeof item.name === "string" ? item.name : "",
      protocol: (item.pool_type === "damm_v2"
        ? "meteora_damm_v2"
        : "meteora_dlmm") as LpProtocol,
    }))
    .filter((item) => item.address);

  const accounts = new Map<string, Accumulator>();
  let poolsFailed = 0;

  await mapWithConcurrency(pools, POOL_CONCURRENCY, async (pool) => {
    try {
      const result = await getPoolLpers(pool.address, {
        protocol: pool.protocol,
      });
      for (const wallet of result.wallets) {
        const entry: LeaderboardPool = {
          address: pool.address,
          name: result.pool.name || pool.name,
          protocol: result.pool.protocol,
          pnlNative: wallet.pnlNative,
          pnlUsd: wallet.pnlUsd,
          openPositions: wallet.openPositions,
        };
        const acc = accounts.get(wallet.owner) ?? {
          owner: wallet.owner,
          pnlUsd: 0,
          pnlNative: 0,
          feeUsd: 0,
          feeNative: 0,
          depositUsd: 0,
          depositNative: 0,
          positions: 0,
          openPositions: 0,
          closedPositions: 0,
          wins: 0,
          ageWeighted: 0,
          pools: [],
          lastActivityMs: 0,
        };
        fold(acc, wallet, entry);
        accounts.set(wallet.owner, acc);
      }
    } catch (error) {
      poolsFailed += 1;
      warnings.push(
        `${pool.name || pool.address}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  });

  const candidates = Array.from(accounts.values()).filter(
    (acc) => acc.positions >= MIN_POSITIONS,
  );
  const maxPnlNative = Math.max(
    1e-9,
    ...candidates.map((acc) => acc.pnlNative),
  );
  const maxFeeNative = Math.max(
    1e-9,
    ...candidates.map((acc) => acc.feeNative),
  );

  const wallets: LeaderboardWallet[] = candidates
    .map((acc) => ({
      owner: acc.owner,
      score: score(acc, maxPnlNative, maxFeeNative),
      pnlUsd: acc.pnlUsd,
      pnlNative: acc.pnlNative,
      feeUsd: acc.feeUsd,
      feeNative: acc.feeNative,
      depositUsd: acc.depositUsd,
      depositNative: acc.depositNative,
      positions: acc.positions,
      openPositions: acc.openPositions,
      closedPositions: acc.closedPositions,
      winRate: acc.closedPositions > 0 ? acc.wins / acc.closedPositions : 0,
      avgAgeHours: acc.positions > 0 ? acc.ageWeighted / acc.positions : 0,
      poolCount: acc.pools.length,
      pools: [...acc.pools].sort((a, b) => b.pnlNative - a.pnlNative),
      lastActivity: acc.lastActivityMs
        ? new Date(acc.lastActivityMs).toISOString()
        : null,
    }))
    .sort((a, b) => b.score - a.score || b.pnlNative - a.pnlNative);

  return {
    generatedAt: new Date().toISOString(),
    timeframe: "24h",
    poolsRequested: pools.length,
    poolsScanned: pools.length - poolsFailed,
    poolsFailed,
    walletsSeen: accounts.size,
    wallets,
    warnings: warnings.slice(0, 10),
  };
}

async function readSnapshotFile(): Promise<Leaderboard | null> {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Leaderboard;
    if (!parsed || !Array.isArray(parsed.wallets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeSnapshotFile(board: Leaderboard) {
  try {
    await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
    await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(board));
  } catch {
    // read-only filesystem (e.g. Vercel); memory cache still applies
  }
}

let memory: { board: Leaderboard; expiresAt: number } | null = null;
let inflight: Promise<Leaderboard> | null = null;

export async function getSmartLpLeaderboard(
  options: { force?: boolean; pools?: number } = {},
): Promise<Leaderboard> {
  const now = Date.now();
  if (!options.force && memory && memory.expiresAt > now) return memory.board;

  if (!options.force && !memory) {
    const file = await readSnapshotFile();
    if (file && now - Date.parse(file.generatedAt) < FILE_MAX_AGE_MS) {
      memory = {
        board: file,
        expiresAt: Date.parse(file.generatedAt) + CACHE_TTL_MS,
      };
      if (memory.expiresAt > now) return file;
    }
  }

  if (inflight) return inflight;
  inflight = buildLeaderboard(options.pools ?? DEFAULT_POOLS)
    .then(async (board) => {
      memory = { board, expiresAt: Date.now() + CACHE_TTL_MS };
      await writeSnapshotFile(board);
      return board;
    })
    .finally(() => {
      inflight = null;
    });

  // While a rebuild runs, keep serving whatever we have.
  if (memory) return memory.board;
  const file = await readSnapshotFile();
  if (file) return file;
  return inflight;
}

/** The stale copy, if any, without triggering a rebuild. */
export function peekSmartLpLeaderboard(): Leaderboard | null {
  return memory?.board ?? null;
}
