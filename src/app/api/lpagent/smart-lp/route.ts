import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { toNumber } from "@/lib/utils";

/**
 * Smart LP wallet list.
 *
 * The paid LP Agent leaderboard was removed. This route now serves the local
 * seed snapshot in `data/lp_smart_wallets_from_openapi.json`, with the same
 * filter / sort / pagination query params the UI already sends. Per-wallet
 * detail is computed live from on-chain Meteora data via `/api/analysis/*`.
 */

const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "lp_smart_wallets_from_openapi.json",
);

interface SeedWallet {
  owner?: string;
  pools?: number;
  total_lp?: number;
  total_pnl_native?: number;
  avg_win_rate_native?: number;
  last_activity?: string;
  sample_pools?: string[];
  smart_score?: number;
}

interface SmartLpWallet {
  owner: string;
  total_pool: number;
  total_lp: number;
  total_pnl_native: number;
  win_rate_native: number;
  smart_score: number;
  last_activity: string | null;
  sample_pools: string[];
}

const SORTABLE: Record<string, keyof SmartLpWallet> = {
  total_pnl_native: "total_pnl_native",
  win_rate_native: "win_rate_native",
  total_lp: "total_lp",
  total_pool: "total_pool",
  smart_score: "smart_score",
  last_activity: "last_activity",
};

let cachedSeed: SmartLpWallet[] | null = null;

async function loadSeed(): Promise<SmartLpWallet[]> {
  if (cachedSeed) {
    return cachedSeed;
  }

  const raw = await fs.readFile(SNAPSHOT_PATH, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed) ? (parsed as SeedWallet[]) : [];

  cachedSeed = list
    .filter((item) => typeof item.owner === "string" && item.owner)
    .map((item) => ({
      owner: item.owner as string,
      total_pool: toNumber(item.pools),
      total_lp: toNumber(item.total_lp),
      total_pnl_native: toNumber(item.total_pnl_native),
      win_rate_native: toNumber(item.avg_win_rate_native),
      smart_score: toNumber(item.smart_score),
      last_activity: item.last_activity
        ? new Date(item.last_activity.replace(" ", "T") + "Z").toISOString()
        : null,
      sample_pools: Array.isArray(item.sample_pools) ? item.sample_pools : [],
    }));

  return cachedSeed;
}

function readNumberParam(url: URL, key: string, fallback: number) {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const page = Math.max(1, Math.floor(readNumberParam(url, "page", 1)));
  const pageSize = Math.max(
    1,
    Math.min(100, Math.floor(readNumberParam(url, "pageSize", 12))),
  );
  const minTotalLp = readNumberParam(url, "minTotalLp", 0);
  const minWinRate = readNumberParam(url, "minWinRateNative", 0);
  const minTotalPnl = readNumberParam(url, "minTotalPnlNative", 0);
  const [orderKey, orderDir] = (
    url.searchParams.get("orderBy") ?? "total_pnl_native:desc"
  ).split(":");

  try {
    const seed = await loadSeed();
    const filtered = seed.filter((item) => {
      if (item.total_lp < minTotalLp) return false;
      if (item.win_rate_native < minWinRate) return false;
      if (item.total_pnl_native < minTotalPnl) return false;
      // `lastActivity` is accepted for UI compatibility but not enforced: the
      // seed is a static snapshot, so every row would fail a recency window.
      return true;
    });

    const sortField = SORTABLE[orderKey] ?? "total_pnl_native";
    const direction = orderDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === "string" || typeof bv === "string") {
        return direction * String(av ?? "").localeCompare(String(bv ?? ""));
      }
      return direction * (toNumber(av) - toNumber(bv));
    });

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const start = (page - 1) * pageSize;

    return NextResponse.json({
      message:
        "Smart LP list served from the local seed snapshot (lastActivity filter is ignored).",
      source: "seed-snapshot",
      data: {
        smart_lp: filtered.slice(start, start + pageSize),
        pagination: {
          currentPage: page,
          pageSize,
          totalCount,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load smart LP snapshot",
      },
      { status: 500 },
    );
  }
}
