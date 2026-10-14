import { NextResponse } from "next/server";

import {
  paginate,
  readFlag,
  readNumber,
  readPaging,
  sortRows,
} from "@/lib/paging";
import type { TraderWallet } from "@/lib/traders/pnl";
import {
  getSmartTraderBoard,
  isBuildRunning,
} from "@/lib/traders/smart-trader-leaderboard";

/** A refresh pulls thousands of transactions; give the cron room. */
export const maxDuration = 300;

const SORT_KEYS = [
  "score",
  "totalPnlUsd",
  "realizedPnlUsd",
  "roi",
  "winRate",
  "tokensTraded",
  "medianHoldMinutes",
  "earlyEntries",
  "volumeUsd",
  "lastTradeAt",
] as const satisfies readonly (keyof TraderWallet)[];

/**
 * Paged, filtered view of the Smart Traders leaderboard.
 *
 * Query: page, pageSize, sort, dir, minTokens, minWin, profitable=1|0,
 * hideBots=1|0, token=<mint>, refresh=1, tokens, sigs.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const force = params.get("refresh") === "1";
  const tokens = Number(params.get("tokens"));
  const sigs = Number(params.get("sigs"));
  const paging = readPaging(params, SORT_KEYS, "score");
  const minTokens = readNumber(params, "minTokens", 0);
  const minWin = readNumber(params, "minWin", 0);
  const profitable = readFlag(params, "profitable", false);
  const hideBots = readFlag(params, "hideBots", false);
  const tokenFilter = params.get("token")?.trim() || "";

  try {
    const board = await getSmartTraderBoard({
      force,
      budget: {
        tokens:
          Number.isFinite(tokens) && tokens > 0
            ? Math.min(40, tokens)
            : undefined,
        sigsPerPair:
          Number.isFinite(sigs) && sigs > 0 ? Math.min(3000, sigs) : undefined,
      },
    });
    if (!board) {
      return NextResponse.json(
        {
          message: isBuildRunning()
            ? "First scan is running; try again in a few minutes."
            : "No snapshot yet. Run `pnpm traders:build` or call ?refresh=1.",
          building: isBuildRunning(),
        },
        { status: 503, headers: { "retry-after": "120" } },
      );
    }

    const filtered = board.wallets.filter((wallet) => {
      if (wallet.tokensTraded < minTokens) return false;
      if (wallet.winRate < minWin) return false;
      if (profitable && wallet.totalPnlUsd <= 0) return false;
      if (
        hideBots &&
        (wallet.flags.includes("bot") || wallet.flags.includes("sniper"))
      )
        return false;
      if (tokenFilter && !wallet.tokens.some((t) => t.mint === tokenFilter))
        return false;
      return true;
    });
    const sorted = sortRows(filtered, paging.sort, paging.dir);
    const { items, pagination } = paginate(
      sorted,
      paging.page,
      paging.pageSize,
    );
    // Token chips only need a short list per wallet.
    const wallets = items.map((wallet) => ({
      ...wallet,
      tokens: wallet.tokens.slice(0, 6),
    }));

    const totals = {
      ranked: board.wallets.length,
      matching: filtered.length,
      profitable: board.wallets.filter((w) => w.totalPnlUsd > 0).length,
      pnlUsd: board.wallets.reduce((sum, w) => sum + w.totalPnlUsd, 0),
    };

    return NextResponse.json(
      {
        generatedAt: board.generatedAt,
        windowDays: board.windowDays,
        stats: board.stats,
        tokens: board.tokens,
        walletsSeen: board.walletsSeen,
        totals,
        pagination,
        sort: paging.sort,
        dir: paging.dir,
        wallets,
        warnings: board.warnings,
        store: board.store,
        building: isBuildRunning(),
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
