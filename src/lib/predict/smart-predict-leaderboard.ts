import { getSnapshotStore } from "@/lib/store/snapshot-store";

import {
  computeMetrics,
  scorePredictTrader,
  type PredictMetrics,
} from "./metrics";
import {
  fetchActivity,
  fetchClosedPositions,
  fetchLeaderboard,
  fetchOpenPositions,
  type LeaderboardCategory,
  type LeaderboardEntry,
  type TimePeriod,
} from "./polymarket-api";

/**
 * PredictSmart: Polymarket traders worth copying.
 *
 * 1. Candidates from Polymarket's own leaderboards (PnL and volume, several
 *    windows and categories) – those only rank by raw PnL / volume.
 * 2. For each candidate, every closed position → win rate, ROI, profit
 *    factor, concentration, categories; open positions → exposure.
 * 3. Score for copyability and rank.
 */

export const SNAPSHOT_KIND = "smart-predict";
const CACHE_TTL_MS = 60 * 60_000;
const MIN_MARKETS = 5;

export interface PredictBudget {
  /** Candidate wallets analysed per run. */
  traders: number;
  /** Closed positions read per wallet. */
  closedRows: number;
}

export function readPredictBudget(
  overrides: Partial<PredictBudget> = {},
): PredictBudget {
  const env = (name: string, fallback: number) => {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  };
  return {
    traders: overrides.traders ?? env("PREDICT_TRADERS", 150),
    closedRows: overrides.closedRows ?? env("PREDICT_CLOSED_ROWS", 1500),
  };
}

export interface PredictTrader extends PredictMetrics {
  address: string;
  name: string;
  verified: boolean;
  profileImage: string | null;
  xUsername: string | null;
  score: number;
  /** Where the candidate came from (leaderboard windows / categories). */
  sources: string[];
  /** Leaderboard figures as reported by Polymarket. */
  leaderboard: {
    pnl30d: number | null;
    vol30d: number | null;
    pnl7d: number | null;
  };
  truncated: boolean;
  scannedAt: string;
}

export interface PredictSnapshot {
  generatedAt: string;
  traders: PredictTrader[];
  stats: {
    candidates: number;
    analysed: number;
    failed: number;
    ranked: number;
    durationMs: number;
  };
  warnings: string[];
}

export interface PredictBoard extends Omit<PredictSnapshot, "traders"> {
  traders: PredictTrader[];
  store: "file" | "postgres";
}

const CANDIDATE_QUERIES: Array<{
  timePeriod: TimePeriod;
  category: LeaderboardCategory;
  orderBy: "PNL" | "VOL";
  limit: number;
}> = [
  { timePeriod: "MONTH", category: "OVERALL", orderBy: "PNL", limit: 100 },
  { timePeriod: "WEEK", category: "OVERALL", orderBy: "PNL", limit: 100 },
  { timePeriod: "MONTH", category: "OVERALL", orderBy: "VOL", limit: 50 },
  { timePeriod: "ALL", category: "OVERALL", orderBy: "PNL", limit: 50 },
  { timePeriod: "MONTH", category: "POLITICS", orderBy: "PNL", limit: 30 },
  { timePeriod: "MONTH", category: "CRYPTO", orderBy: "PNL", limit: 30 },
  { timePeriod: "MONTH", category: "SPORTS", orderBy: "PNL", limit: 30 },
];

interface Candidate {
  entry: LeaderboardEntry;
  sources: string[];
  pnl30d: number | null;
  vol30d: number | null;
  pnl7d: number | null;
  /** Best leaderboard rank seen, for ordering under budget. */
  bestRank: number;
}

async function collectCandidates(warnings: string[]): Promise<Candidate[]> {
  const map = new Map<string, Candidate>();
  for (const query of CANDIDATE_QUERIES) {
    const label = `${query.timePeriod.toLowerCase()}:${query.category.toLowerCase()}:${query.orderBy.toLowerCase()}`;
    try {
      const rows = await fetchLeaderboard(query);
      rows.forEach((entry, index) => {
        const key = entry.proxyWallet.toLowerCase();
        const existing = map.get(key) ?? {
          entry,
          sources: [],
          pnl30d: null,
          vol30d: null,
          pnl7d: null,
          bestRank: Infinity,
        };
        existing.sources.push(label);
        existing.bestRank = Math.min(existing.bestRank, index + 1);
        if (query.category === "OVERALL") {
          if (query.timePeriod === "MONTH") {
            if (query.orderBy === "PNL" || existing.pnl30d == null)
              existing.pnl30d = entry.pnl;
            if (query.orderBy === "VOL" || existing.vol30d == null)
              existing.vol30d = entry.vol;
          }
          if (query.timePeriod === "WEEK") existing.pnl7d = entry.pnl;
        }
        if (!existing.entry.userName && entry.userName) existing.entry = entry;
        map.set(key, existing);
      });
    } catch (error) {
      warnings.push(
        `${label}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.sources.length - a.sources.length || a.bestRank - b.bestRank,
  );
}

/** Full metrics for one wallet (also used by the on-demand profile API). */
export async function analyseTrader(
  address: string,
  options: { closedRows?: number } = {},
): Promise<{ metrics: PredictMetrics; truncated: boolean }> {
  const [closed, open, activity] = await Promise.all([
    fetchClosedPositions(
      address,
      options.closedRows ?? readPredictBudget().closedRows,
    ),
    fetchOpenPositions(address),
    fetchActivity(address, 100),
  ]);
  return {
    metrics: computeMetrics({ closed: closed.rows, open: open.rows, activity }),
    truncated: closed.truncated,
  };
}

export async function buildPredictSnapshot(
  options: {
    budget?: Partial<PredictBudget>;
    onProgress?: (m: string) => void;
  } = {},
): Promise<PredictSnapshot> {
  const startedAt = Date.now();
  const budget = readPredictBudget(options.budget);
  const warnings: string[] = [];
  const log = options.onProgress ?? (() => undefined);

  const candidates = (await collectCandidates(warnings)).slice(
    0,
    budget.traders,
  );
  log(`candidates: ${candidates.length}`);

  const traders: PredictTrader[] = [];
  let failed = 0;
  let done = 0;
  const CONCURRENCY = 3;
  const queue = [...candidates];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const candidate = queue.shift() as Candidate;
        const address = candidate.entry.proxyWallet.toLowerCase();
        try {
          const { metrics, truncated } = await analyseTrader(address, {
            closedRows: budget.closedRows,
          });
          traders.push({
            address,
            name:
              candidate.entry.userName ||
              candidate.entry.proxyWallet.slice(0, 8),
            verified: Boolean(candidate.entry.verifiedBadge),
            profileImage: candidate.entry.profileImage || null,
            xUsername: candidate.entry.xUsername || null,
            score: 0,
            sources: candidate.sources,
            leaderboard: {
              pnl30d: candidate.pnl30d,
              vol30d: candidate.vol30d,
              pnl7d: candidate.pnl7d,
            },
            truncated,
            scannedAt: new Date().toISOString(),
            ...metrics,
          });
        } catch (error) {
          failed += 1;
          warnings.push(
            `${address.slice(0, 10)}: ${error instanceof Error ? error.message : "failed"}`,
          );
        }
        done += 1;
        if (done % 10 === 0) log(`analysed ${done}/${candidates.length}`);
      }
    }),
  );

  const ranked = traders.filter((t) => t.markets >= MIN_MARKETS);
  const maxPnl = Math.max(1e-9, ...ranked.map((t) => t.realizedPnlUsd));
  for (const trader of ranked)
    trader.score = scorePredictTrader(trader, maxPnl);
  ranked.sort(
    (a, b) => b.score - a.score || b.realizedPnlUsd - a.realizedPnlUsd,
  );

  return {
    generatedAt: new Date().toISOString(),
    traders: ranked,
    stats: {
      candidates: candidates.length,
      analysed: traders.length,
      failed,
      ranked: ranked.length,
      durationMs: Date.now() - startedAt,
    },
    warnings: warnings.slice(0, 12),
  };
}

// ---------------------------------------------------------------------------
// Cache + store
// ---------------------------------------------------------------------------

let memory: { snapshot: PredictSnapshot; expiresAt: number } | null = null;
let inflight: Promise<PredictSnapshot> | null = null;

function isSnapshot(value: unknown): value is PredictSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as PredictSnapshot).traders)
  );
}

const STORE_CHECK_MS = 60_000;
let storeCheckedAt = 0;

/** Latest snapshot; re-reads the store when another process wrote a newer one. */
export async function loadPredictSnapshot(): Promise<PredictSnapshot | null> {
  const now = Date.now();
  if (memory && now - storeCheckedAt < STORE_CHECK_MS) return memory.snapshot;
  storeCheckedAt = now;
  const store = getSnapshotStore();
  if (memory) {
    const [latest] = await store.history(SNAPSHOT_KIND, 1).catch(() => []);
    if (
      !latest ||
      Date.parse(latest.generatedAt) <= Date.parse(memory.snapshot.generatedAt)
    ) {
      return memory.snapshot;
    }
  }
  const stored = await store.load<PredictSnapshot>(SNAPSHOT_KIND);
  if (!stored || !isSnapshot(stored.payload)) return memory?.snapshot ?? null;
  memory = {
    snapshot: stored.payload,
    expiresAt: Date.parse(stored.payload.generatedAt) + CACHE_TTL_MS,
  };
  return stored.payload;
}

export async function refreshPredictSnapshot(
  options: {
    budget?: Partial<PredictBudget>;
    onProgress?: (m: string) => void;
  } = {},
): Promise<PredictSnapshot> {
  if (inflight) return inflight;
  inflight = (async () => {
    const snapshot = await buildPredictSnapshot(options);
    memory = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
    await getSnapshotStore().save(
      SNAPSHOT_KIND,
      snapshot,
      snapshot.generatedAt,
    );
    return snapshot;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function getPredictBoard(
  options: { force?: boolean; budget?: Partial<PredictBudget> } = {},
): Promise<PredictBoard | null> {
  if (options.force) {
    await refreshPredictSnapshot({ budget: options.budget });
  } else {
    await loadPredictSnapshot();
    if (memory && memory.expiresAt <= Date.now() && !inflight) {
      void refreshPredictSnapshot({ budget: options.budget }).catch(
        () => undefined,
      );
    }
  }
  if (!memory) return null;
  return { ...memory.snapshot, store: getSnapshotStore().backend };
}

export function isPredictBuildRunning() {
  return inflight !== null;
}
