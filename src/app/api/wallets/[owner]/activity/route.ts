import { NextResponse } from "next/server";

import { getWalletLpSnapshot } from "@/lib/api/meteora-lp";

const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DAY_MS = 86_400_000;

export interface WalletActivityEvent {
  type: "open" | "close";
  at: string;
  owner: string;
  position: string;
  pool: string;
  pairName: string;
  protocol: string;
  logo0: string;
  logo1: string;
  depositNative: number;
  depositUsd: number;
  valueNative: number;
  pnlNative: number;
  pnlUsd: number;
  pnlPercentNative: number;
  inRange: boolean | null;
}

/**
 * Recent LP activity of a wallet (positions opened / closed in the window),
 * derived from on-chain Meteora data. Powers the watchlist feed.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string }> },
) {
  const { owner } = await params;
  const url = new URL(request.url);
  const days = Math.max(
    1,
    Math.min(30, Number(url.searchParams.get("days")) || 7),
  );

  if (!ADDRESS_PATTERN.test(owner)) {
    return NextResponse.json(
      { message: "Invalid wallet address." },
      { status: 400 },
    );
  }

  try {
    const snapshot = await getWalletLpSnapshot(owner);
    const since = Date.now() - days * DAY_MS;
    const events: WalletActivityEvent[] = [];

    for (const item of snapshot.positions) {
      const base = {
        owner,
        position: item.position,
        pool: item.pool,
        pairName: `${item.token0.symbol || "?"}-${item.token1.symbol || "?"}`,
        protocol: item.protocol,
        logo0: item.token0.logo,
        logo1: item.token1.logo,
        depositNative: item.depositNative,
        depositUsd: item.depositUsd,
        valueNative: item.valueNative,
        pnlNative: item.pnlNative,
        pnlUsd: item.pnlUsd,
        pnlPercentNative: item.pnlPercentNative,
        inRange: item.inRange,
      };
      if (item.createdAtMs && item.createdAtMs >= since) {
        events.push({
          type: "open",
          at: new Date(item.createdAtMs).toISOString(),
          ...base,
        });
      }
      if (item.closedAtMs && item.closedAtMs >= since) {
        events.push({
          type: "close",
          at: new Date(item.closedAtMs).toISOString(),
          ...base,
        });
      }
    }
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const open = snapshot.positions.filter((item) => !item.isClosed);
    const closedInWindow = snapshot.positions.filter(
      (item) => item.isClosed && item.closedAtMs && item.closedAtMs >= since,
    );

    return NextResponse.json({
      owner,
      days,
      generatedAt: new Date().toISOString(),
      summary: {
        openPositions: open.length,
        openValueNative: open.reduce((sum, item) => sum + item.valueNative, 0),
        openPnlNative: open.reduce((sum, item) => sum + item.pnlNative, 0),
        closedInWindow: closedInWindow.length,
        realizedPnlNativeInWindow: closedInWindow.reduce(
          (sum, item) => sum + item.pnlNative,
          0,
        ),
        uniquePools: new Set(snapshot.positions.map((item) => item.pool)).size,
      },
      events,
      warnings: snapshot.warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load wallet activity",
      },
      { status: 502 },
    );
  }
}
