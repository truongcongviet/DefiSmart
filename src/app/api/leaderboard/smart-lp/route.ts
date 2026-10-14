import { NextResponse } from "next/server";

import {
  getSmartLpLeaderboard,
  type LeaderboardWallet,
} from "@/lib/api/smart-lp-leaderboard";
import {
  paginate,
  readFlag,
  readNumber,
  readPaging,
  sortRows,
} from "@/lib/paging";

/** Scanning ~40 pools takes a while on a cold cache. */
export const maxDuration = 60;

const SORT_KEYS = [
  "score",
  "pnlNative",
  "feeNative",
  "positions",
  "winRate",
  "poolCount",
  "earlyEntries",
  "lastActivity",
] as const satisfies readonly (keyof LeaderboardWallet)[];

/**
 * Paged, filtered view of the Smart LP leaderboard. The full snapshot stays on
 * the server; the client only receives one page.
 *
 * Query: page, pageSize, sort, dir, minPositions, minWin, profitable=1|0,
 * refresh=1, pools.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const force = params.get("refresh") === "1";
  const pools = Number(params.get("pools"));
  const paging = readPaging(params, SORT_KEYS, "score");
  const minPositions = readNumber(params, "minPositions", 0);
  const minWin = readNumber(params, "minWin", 0);
  const profitable = readFlag(params, "profitable", false);

  try {
    const board = await getSmartLpLeaderboard({
      force,
      pools:
        Number.isFinite(pools) && pools > 0 ? Math.min(60, pools) : undefined,
    });
    const filtered = board.wallets.filter((wallet) => {
      if (wallet.positions < minPositions) return false;
      if (wallet.winRate < minWin) return false;
      if (profitable && wallet.pnlNative <= 0) return false;
      return true;
    });
    const sorted = sortRows(filtered, paging.sort, paging.dir);
    const { items, pagination } = paginate(
      sorted,
      paging.page,
      paging.pageSize,
    );

    const totals = {
      ranked: board.wallets.length,
      matching: filtered.length,
      profitable: board.wallets.filter((w) => w.pnlNative > 0).length,
      pnlNative: board.wallets.reduce((sum, w) => sum + w.pnlNative, 0),
      feeNative: board.wallets.reduce((sum, w) => sum + w.feeNative, 0),
      avgAgeHours: filtered.length
        ? filtered.reduce((sum, w) => sum + w.avgAgeHours, 0) / filtered.length
        : 0,
    };

    return NextResponse.json(
      {
        generatedAt: board.generatedAt,
        timeframe: board.timeframe,
        poolsRequested: board.poolsRequested,
        poolsScanned: board.poolsScanned,
        poolsFailed: board.poolsFailed,
        walletsSeen: board.walletsSeen,
        totals,
        pagination,
        sort: paging.sort,
        dir: paging.dir,
        wallets: items,
        warnings: board.warnings,
      },
      {
        headers: {
          "cache-control": "public, max-age=120, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to build leaderboard",
      },
      { status: 502 },
    );
  }
}
