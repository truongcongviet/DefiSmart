import { NextResponse } from "next/server";

import {
  paginate,
  readFlag,
  readNumber,
  readPaging,
  sortRows,
} from "@/lib/paging";
import {
  getPredictBoard,
  isPredictBuildRunning,
  type PredictTrader,
} from "@/lib/predict/smart-predict-leaderboard";

/** A refresh analyses ~150 wallets against Polymarket's Data API. */
export const maxDuration = 300;

const SORT_KEYS = [
  "score",
  "winRate",
  "winRate30d",
  "realizedPnlUsd",
  "roi",
  "profitFactor",
  "markets",
  "markets30d",
  "avgStakeUsd",
  "openExposureUsd",
  "lastTradeAt",
] as const satisfies readonly (keyof PredictTrader)[];

/**
 * Paged, filtered PredictSmart leaderboard.
 * Query: page, pageSize, sort, dir, minMarkets, minWin, maxStake, category,
 * hideInactive=1|0, hideWhales=1|0, q (name / address), refresh=1, traders.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const force = params.get("refresh") === "1";
  const traders = Number(params.get("traders"));
  const paging = readPaging(params, SORT_KEYS, "score");
  const minMarkets = readNumber(params, "minMarkets", 0);
  const minWin = readNumber(params, "minWin", 0);
  const maxStake = readNumber(params, "maxStake", 0);
  const category = params.get("category")?.trim().toLowerCase() || "";
  const hideInactive = readFlag(params, "hideInactive", false);
  const hideWhales = readFlag(params, "hideWhales", false);
  const q = params.get("q")?.trim().toLowerCase() || "";

  try {
    const board = await getPredictBoard({
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
          message: isPredictBuildRunning()
            ? "First scan is running; try again in a few minutes."
            : "No snapshot yet. Run `pnpm predict:build` or call ?refresh=1.",
          building: isPredictBuildRunning(),
        },
        { status: 503, headers: { "retry-after": "120" } },
      );
    }

    const filtered = board.traders.filter((trader) => {
      if (trader.markets < minMarkets) return false;
      if (trader.winRate < minWin) return false;
      if (maxStake > 0 && trader.medianStakeUsd > maxStake) return false;
      if (hideInactive && trader.flags.includes("inactive")) return false;
      if (hideWhales && trader.flags.includes("whale")) return false;
      if (category) {
        const stat = trader.categories.find((c) => c.category === category);
        if (!stat || stat.markets / Math.max(1, trader.markets) < 0.3)
          return false;
      }
      if (
        q &&
        !trader.name.toLowerCase().includes(q) &&
        !trader.address.includes(q)
      )
        return false;
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
      profitable: board.traders.filter((t) => t.realizedPnlUsd > 0).length,
      avgWinRate: board.traders.length
        ? board.traders.reduce((s, t) => s + t.winRate, 0) /
          board.traders.length
        : 0,
      markets: board.traders.reduce((s, t) => s + t.markets, 0),
    };

    return NextResponse.json(
      {
        generatedAt: board.generatedAt,
        stats: board.stats,
        totals,
        pagination,
        sort: paging.sort,
        dir: paging.dir,
        traders: items,
        warnings: board.warnings,
        store: board.store,
        building: isPredictBuildRunning(),
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
