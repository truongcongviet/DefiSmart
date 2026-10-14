import { NextResponse } from "next/server";

import {
  paginate,
  readFlag,
  readNumber,
  readPaging,
  sortRows,
} from "@/lib/paging";
import { PERP_WINDOWS, type PerpWindow } from "@/lib/predict/perps-api";
import {
  getPerpBoard,
  isPerpBuildRunning,
  type PerpTrader,
} from "@/lib/predict/smart-perp-leaderboard";

export const maxDuration = 300;

const SORT_KEYS = [
  "score",
  "winRate",
  "pnlUsd",
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
] as const satisfies readonly (keyof WindowedTrader)[];

/** A leaderboard row with the chosen window's figures on the top level. */
type WindowedTrader = PerpTrader & {
  window: PerpWindow;
  pnlUsd: number;
  periods: number;
  positivePeriods: number;
};

function applyWindow(trader: PerpTrader, window: PerpWindow): WindowedTrader {
  const stats = trader.windows?.[window];
  if (!stats) {
    return {
      ...trader,
      window,
      pnlUsd: trader.pnl30dUsd,
      periods: trader.days,
      positivePeriods: trader.positiveDays,
    };
  }
  return {
    ...trader,
    window,
    closedTrades: stats.closedTrades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
    profitFactor: stats.profitFactor,
    pnlUsd: stats.pnlUsd,
    periods: stats.periods,
    positivePeriods: stats.positivePeriods,
    maxDrawdownUsd: stats.maxDrawdownUsd,
  };
}

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
  const windowParam = params.get("window");
  const window: PerpWindow = PERP_WINDOWS.includes(windowParam as PerpWindow)
    ? (windowParam as PerpWindow)
    : "month";
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

    const windowed = board.traders.map((trader) => applyWindow(trader, window));
    const filtered = windowed.filter((trader) => {
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
    const active = windowed.filter((t) => t.closedTrades > 0 || t.periods > 0);
    const totals = {
      ranked: board.traders.length,
      matching: filtered.length,
      active: active.length,
      profitable: active.filter((t) => t.pnlUsd > 0).length,
      avgWinRate: active.length
        ? active.reduce((s, t) => s + t.winRate, 0) / active.length
        : 0,
      closedTrades: windowed.reduce((s, t) => s + t.closedTrades, 0),
    };

    return NextResponse.json(
      {
        generatedAt: board.generatedAt,
        window,
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
        wins: (board.winsByWindow?.[window] ?? board.wins).slice(0, 20),
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
