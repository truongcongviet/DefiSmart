import { getSnapshotStore } from "@/lib/store/snapshot-store";

import {
  computePerpMetrics,
  scorePerpTrader,
  type PerpMetrics,
} from "./perp-metrics";
import {
  fetchPerpFills,
  fetchPerpInstruments,
  fetchPerpLeaderboard,
  fetchPerpPnlSeries,
  fetchPerpPortfolio,
  fetchPerpWins,
  instrumentLogo,
  type PerpInstrument,
  type PerpLogo,
  type PerpWinEntry,
  type PerpWindow,
} from "./perps-api";

/**
 * Perp tab of PredictSmart: Polymarket Perps accounts worth copying.
 * Candidates from the per-account leaderboards (day/week/month/all) and the
 * biggest-wins board; each account is re-scored from its own fills,
 * portfolio and daily PnL.
 */

export const SNAPSHOT_KIND = "smart-perp";
const CACHE_TTL_MS = 60 * 60_000;
const MIN_CLOSED_TRADES = 5;
/** Daily series as far back as the API keeps it; hourly for the day window. */
const SERIES_DAYS = 400;
const HOURLY_DAYS = 2;

export interface PerpBudget {
  traders: number;
  /** Fill pages (100 each) read per account. */
  fillPages: number;
}

export function readPerpBudget(
  overrides: Partial<PerpBudget> = {},
): PerpBudget {
  const env = (name: string, fallback: number) => {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  };
  return {
    traders: overrides.traders ?? env("PERP_TRADERS", 150),
    fillPages: overrides.fillPages ?? env("PERP_FILL_PAGES", 3),
  };
}

export interface PerpTrader extends PerpMetrics {
  address: string;
  score: number;
  sources: string[];
  leaderboard: {
    pnlMonth: number | null;
    roiMonth: number | null;
    notionalMonth: number | null;
    rankMonth: number | null;
    pnlWeek: number | null;
    rankWeek: number | null;
    /** Polymarket's own figures per window, when the account is in that top 200. */
    byWindow: Partial<
      Record<
        PerpWindow,
        { pnl: number; roi: number; notional: number; rank: number }
      >
    >;
  };
  /** Biggest single wins of this account on the wins board. */
  bigWins: Array<{
    symbol: string;
    logo: PerpLogo | null;
    side: "long" | "short";
    pnlUsd: number;
    at: string;
  }>;
  fillsTruncated: boolean;
  scannedAt: string;
}

export interface PerpSnapshot {
  generatedAt: string;
  traders: PerpTrader[];
  wins: Array<PerpWinEntry & { pnlUsd: number; logo: PerpLogo | null }>;
  /** Biggest single wins per window (the `leaderboard/wins` board). */
  winsByWindow: Partial<
    Record<
      PerpWindow,
      Array<PerpWinEntry & { pnlUsd: number; logo: PerpLogo | null }>
    >
  >;
  stats: {
    candidates: number;
    analysed: number;
    failed: number;
    ranked: number;
    durationMs: number;
  };
  warnings: string[];
}

export interface PerpBoard extends PerpSnapshot {
  store: "file" | "postgres";
}

interface Candidate {
  address: string;
  sources: string[];
  bestRank: number;
  leaderboard: PerpTrader["leaderboard"];
  bigWins: PerpTrader["bigWins"];
}

const LEADERBOARD_QUERIES: Array<{ window: PerpWindow; pages: number }> = [
  { window: "month", pages: 2 },
  { window: "week", pages: 1 },
  { window: "all", pages: 1 },
  { window: "day", pages: 1 },
];

async function collectCandidates(
  warnings: string[],
  instruments: Map<number, PerpInstrument>,
): Promise<{
  candidates: Candidate[];
  wins: PerpSnapshot["wins"];
  winsByWindow: PerpSnapshot["winsByWindow"];
}> {
  const map = new Map<string, Candidate>();
  const get = (address: string) => {
    const key = address.toLowerCase();
    const existing = map.get(key) ?? {
      address: key,
      sources: [],
      bestRank: Infinity,
      leaderboard: {
        pnlMonth: null,
        roiMonth: null,
        notionalMonth: null,
        rankMonth: null,
        pnlWeek: null,
        rankWeek: null,
        byWindow: {},
      },
      bigWins: [],
    };
    map.set(key, existing);
    return existing;
  };

  for (const query of LEADERBOARD_QUERIES) {
    for (let page = 0; page < query.pages; page += 1) {
      try {
        const { entries } = await fetchPerpLeaderboard({
          window: query.window,
          limit: 100,
          offset: page * 100,
        });
        for (const entry of entries) {
          if (Number(entry.pnl) <= 0) continue;
          const candidate = get(entry.account);
          const label = `leaderboard:${query.window}`;
          if (!candidate.sources.includes(label)) candidate.sources.push(label);
          candidate.bestRank = Math.min(candidate.bestRank, entry.rank);
          candidate.leaderboard.byWindow[query.window] = {
            pnl: Number(entry.pnl),
            roi: Number(entry.roi),
            notional: Number(entry.notional),
            rank: entry.rank,
          };
          if (query.window === "month") {
            candidate.leaderboard.pnlMonth = Number(entry.pnl);
            candidate.leaderboard.roiMonth = Number(entry.roi);
            candidate.leaderboard.notionalMonth = Number(entry.notional);
            candidate.leaderboard.rankMonth = entry.rank;
          }
          if (query.window === "week") {
            candidate.leaderboard.pnlWeek = Number(entry.pnl);
            candidate.leaderboard.rankWeek = entry.rank;
          }
        }
      } catch (error) {
        warnings.push(
          `leaderboard ${query.window} p${page + 1}: ${error instanceof Error ? error.message : "failed"}`,
        );
      }
    }
  }

  let wins: PerpSnapshot["wins"] = [];
  const winsByWindow: PerpSnapshot["winsByWindow"] = {};
  for (const window of ["month", "week", "day", "all"] as PerpWindow[]) {
    try {
      const entries = await fetchPerpWins(window, 100);
      const decorated = entries.map((e) => ({
        ...e,
        pnlUsd: Number(e.pnl),
        logo: instrumentLogo(instruments.get(e.instrument_id)),
      }));
      winsByWindow[window] = decorated;
      if (window === "month") wins = decorated;
      for (const entry of entries) {
        const candidate = get(entry.account);
        const label = `wins:${window}`;
        if (!candidate.sources.includes(label)) candidate.sources.push(label);
        candidate.bestRank = Math.min(candidate.bestRank, entry.rank + 100);
        if (window === "month" && candidate.bigWins.length < 3) {
          candidate.bigWins.push({
            symbol: entry.symbol,
            logo: instrumentLogo(instruments.get(entry.instrument_id)),
            side: entry.side,
            pnlUsd: Number(entry.pnl),
            at: new Date(entry.timestamp).toISOString(),
          });
        }
      }
    } catch (error) {
      warnings.push(
        `wins ${window}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }

  const candidates = Array.from(map.values()).sort(
    (a, b) => b.sources.length - a.sources.length || a.bestRank - b.bestRank,
  );
  return { candidates, wins, winsByWindow };
}

export async function analysePerpTrader(
  address: string,
  options: { fillPages?: number } = {},
): Promise<{ metrics: PerpMetrics; truncated: boolean }> {
  const now = Date.now();
  const [instruments, fills, portfolio, series, hourly] = await Promise.all([
    fetchPerpInstruments(),
    fetchPerpFills(address, options.fillPages ?? readPerpBudget().fillPages),
    fetchPerpPortfolio(address).catch(() => ({
      positions: [],
      equity: "0",
      timestamp: now,
    })),
    fetchPerpPnlSeries(address, now - SERIES_DAYS * 86_400_000).catch(
      () => [] as Array<[number, number]>,
    ),
    fetchPerpPnlSeries(address, now - HOURLY_DAYS * 86_400_000, "1h").catch(
      () => [] as Array<[number, number]>,
    ),
  ]);
  return {
    metrics: computePerpMetrics({
      fills: fills.fills,
      portfolio,
      series,
      hourly,
      instruments,
    }),
    truncated: fills.more,
  };
}

export async function buildPerpSnapshot(
  options: {
    budget?: Partial<PerpBudget>;
    onProgress?: (m: string) => void;
  } = {},
): Promise<PerpSnapshot> {
  const startedAt = Date.now();
  const budget = readPerpBudget(options.budget);
  const warnings: string[] = [];
  const log = options.onProgress ?? (() => undefined);

  const instruments = await fetchPerpInstruments().catch(
    () => new Map<number, PerpInstrument>(),
  );
  const {
    candidates: all,
    wins,
    winsByWindow,
  } = await collectCandidates(warnings, instruments);
  const candidates = all.slice(0, budget.traders);
  log(`candidates: ${candidates.length} of ${all.length}`);

  const traders: PerpTrader[] = [];
  let failed = 0;
  let done = 0;
  const queue = [...candidates];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (queue.length) {
        const candidate = queue.shift() as Candidate;
        try {
          const { metrics, truncated } = await analysePerpTrader(
            candidate.address,
            { fillPages: budget.fillPages },
          );
          traders.push({
            address: candidate.address,
            score: 0,
            sources: candidate.sources,
            leaderboard: candidate.leaderboard,
            bigWins: candidate.bigWins,
            fillsTruncated: truncated,
            scannedAt: new Date().toISOString(),
            ...metrics,
          });
        } catch (error) {
          failed += 1;
          warnings.push(
            `${candidate.address.slice(0, 10)}: ${error instanceof Error ? error.message : "failed"}`,
          );
        }
        done += 1;
        if (done % 10 === 0) log(`analysed ${done}/${candidates.length}`);
      }
    }),
  );

  const ranked = traders.filter((t) => t.closedTrades >= MIN_CLOSED_TRADES);
  const maxPnl = Math.max(1e-9, ...ranked.map((t) => t.pnl30dUsd));
  for (const trader of ranked) trader.score = scorePerpTrader(trader, maxPnl);
  ranked.sort((a, b) => b.score - a.score || b.pnl30dUsd - a.pnl30dUsd);

  return {
    generatedAt: new Date().toISOString(),
    traders: ranked,
    wins,
    winsByWindow,
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

let memory: { snapshot: PerpSnapshot; expiresAt: number } | null = null;
let inflight: Promise<PerpSnapshot> | null = null;
const STORE_CHECK_MS = 60_000;
let storeCheckedAt = 0;

function isSnapshot(value: unknown): value is PerpSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as PerpSnapshot).traders)
  );
}

export async function loadPerpSnapshot(): Promise<PerpSnapshot | null> {
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
  const stored = await store.load<PerpSnapshot>(SNAPSHOT_KIND);
  if (!stored || !isSnapshot(stored.payload)) return memory?.snapshot ?? null;
  memory = {
    snapshot: stored.payload,
    expiresAt: Date.parse(stored.payload.generatedAt) + CACHE_TTL_MS,
  };
  return stored.payload;
}

export async function refreshPerpSnapshot(
  options: {
    budget?: Partial<PerpBudget>;
    onProgress?: (m: string) => void;
  } = {},
): Promise<PerpSnapshot> {
  if (inflight) return inflight;
  inflight = (async () => {
    const snapshot = await buildPerpSnapshot(options);
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

export async function getPerpBoard(
  options: { force?: boolean; budget?: Partial<PerpBudget> } = {},
): Promise<PerpBoard | null> {
  if (options.force) {
    await refreshPerpSnapshot({ budget: options.budget });
  } else {
    await loadPerpSnapshot();
    if (memory && memory.expiresAt <= Date.now() && !inflight) {
      void refreshPerpSnapshot({ budget: options.budget }).catch(
        () => undefined,
      );
    }
  }
  if (!memory) return null;
  return { ...memory.snapshot, store: getSnapshotStore().backend };
}

export function isPerpBuildRunning() {
  return inflight !== null;
}
