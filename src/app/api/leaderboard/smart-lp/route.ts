import { NextResponse } from "next/server";

import { getSmartLpLeaderboard } from "@/lib/api/smart-lp-leaderboard";

/** Scanning ~30 pools takes a while on a cold cache. */
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";
  const pools = Number(url.searchParams.get("pools"));

  try {
    const board = await getSmartLpLeaderboard({
      force,
      pools:
        Number.isFinite(pools) && pools > 0 ? Math.min(60, pools) : undefined,
    });
    return NextResponse.json(board, {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      },
    });
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
