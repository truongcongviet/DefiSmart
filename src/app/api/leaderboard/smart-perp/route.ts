import { NextResponse } from "next/server";

import {
  paginate,
  readFlag,
  readNumber,
  readPaging,
  sortRows,
} from "@/lib/paging";
import {
  getPerpBoard,
  isPerpBuildRunning,
  type PerpTrader,
} from "@/lib/predict/smart-perp-leaderboard";

export const maxDuration = 300;

const SORT_KEYS = [
  "score",
  "winRate",
  "pnl30dUsd",
  "realizedPnlUsd",
  "profitFactor",
  "closedTrades",
  "positiveDays",
  "maxDrawdownUsd",
  "equityUsd",
  "openNotionalUsd",
  "avgFillNotionalUsd",
  "lastFillAt",
] as const satisfies readonly (keyof PerpTrader)[];

/**
 * Paged, filtered Perp leaderboard.
 * Query: page, pageSize, sort, dir, minTrades, minWin, maxFill, category,
 * hideInactive, hideLiquidated, hideWhales, q, refresh=1, traders.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("refresh") === "1";
  const traders = Number(params.get("traders"));
  const paging = readPaging(params, SORT_KEYS, "score");
  const minTrades = readNumber(params, "minTrades", 0);
  const minWin = readNumber(params, "minWin", 0);
  const maxFill = readNumber(params, "maxFill", 0);
  const category = params.get("category")?.trim().toLowerCase() || "";
  const hideInactive = readFlag(params, "hideInactive", false);
  const hideLiquidated = readFlag(params, "hideLiquidated", false);
  const hideWhales = readFlag(params, "hideWhales", false);
  const q = params.get("q")?.trim().toLowerCase() || "";

  try {
    const board = await getPerpBoard({
      force,
      budget: {
        traders:
          Number.isFinite(traders) && traders > 0
            ? Math.min(400, traders)
            : undefined,
      },
    });
    if (!board) {
      return NextResponse.json(
        {
          message: isPerpBuildRunning()
            ? "First scan is running; try again in a few minutes."
            : "No snapshot yet. Run `pnpm perp:build` or call ?refresh=1.",
          building: isPerpBuildRunning(),
        },
        { status: 503, headers: { "retry-after": "120" } },
      );
    }

    const filtered = board.traders.filter((trader) => {
      if (trader.closedTrades < minTrades) return false;
      if (trader.winRate < minWin) return false;
      if (maxFill > 0 && trader.avgFillNotionalUsd > maxFill) return false;
      if (hideInactive && trader.flags.includes("inactive")) return false;
      if (hideLiquidated && trader.flags.includes("liquidated")) return false;
      if (hideWhales && trader.flags.includes("whale")) return false;
      if (category) {
        const trades = trader.instruments.reduce((s, i) => s + i.trades, 0);
        const inCategory = trader.instruments
          .filter((i) => i.category === category)
          .reduce((s, i) => s + i.trades, 0);
        if (trades === 0 || inCategory / trades < 0.3) return false;
      }
      if (q && !trader.address.includes(q)) return false;
      return true;
    });
    const sorted = sortRows(filtered, paging.sort, paging.dir);
    const { items, pagination } = paginate(
      sorted,
      paging.page,
      paging.pageSize,
    );
    const totals = {
      ranked: board.traders.length,
      matching: filtered.length,
      profitable30d: board.traders.filter((t) => t.pnl30dUsd > 0).length,
      avgWinRate: board.traders.length
        ? board.traders.reduce((s, t) => s + t.winRate, 0) /
          board.traders.length
        : 0,
      closedTrades: board.traders.reduce((s, t) => s + t.closedTrades, 0),
    };

    return NextResponse.json(
      {
        generatedAt: board.generatedAt,
        stats: board.stats,
        totals,
        pagination,
        sort: paging.sort,
        dir: paging.dir,
        traders: items.map((t) => ({
          ...t,
          openPositions: t.openPositions.slice(0, 5),
          instruments: t.instruments.slice(0, 6),
        })),
        wins: board.wins.slice(0, 20),
        warnings: board.warnings,
        store: board.store,
        building: isPerpBuildRunning(),
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
