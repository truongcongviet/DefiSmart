import {
  getPreviewLeaderboard,
  getProviderStatuses,
} from "@/lib/traders/preview-data";
import type {
  RankedTrader,
  TraderLeaderboardResponse,
  TraderWindow,
} from "@/lib/traders/types";

interface FomoLeaderboardTrader {
  rank?: unknown;
  handle?: unknown;
  userId?: unknown;
  displayName?: unknown;
  pnlUsd?: unknown;
  volumeUsd?: unknown;
  trades?: unknown;
  followers?: unknown;
  holdings?: unknown;
  topTokens?: unknown;
  verified?: unknown;
  wallets?: {
    solana?: unknown;
    evm?: unknown;
  };
}

interface FomoLeaderboardPayload {
  capturedAt?: unknown;
  traders?: unknown;
}

function asFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeTrader(
  row: FomoLeaderboardTrader,
  index: number,
): RankedTrader {
  const handle = asString(row.handle, `trader-${index + 1}`);
  const verified = row.verified === true;

  return {
    id: asString(row.userId, `fomo-${handle}-${index}`),
    rank: Math.max(1, Math.round(asFiniteNumber(row.rank, index + 1))),
    handle,
    displayName: asString(row.displayName, handle),
    strategy: "Meme",
    wallets: {
      solana: asNullableString(row.wallets?.solana),
      evm: asNullableString(row.wallets?.evm),
    },
    performance: {
      pnlUsd: asFiniteNumber(row.pnlUsd),
      volumeUsd: asFiniteNumber(row.volumeUsd),
      trades: Math.max(0, Math.round(asFiniteNumber(row.trades))),
      roiPct: null,
      winRatePct: null,
      maxDrawdownPct: null,
      profitFactor: null,
      avgHoldMinutes: null,
    },
    followers: Math.max(0, Math.round(asFiniteNumber(row.followers))),
    holdings: Math.max(0, Math.round(asFiniteNumber(row.holdings))),
    topTokens: Array.isArray(row.topTokens)
      ? row.topTokens
          .filter((token): token is string => typeof token === "string")
          .slice(0, 3)
      : [],
    copyScore: null,
    risk: "Medium",
    verification: verified ? "source-reported" : "pending",
    source: "FOMO API",
  };
}

export async function getTraderLeaderboard(
  window: TraderWindow,
): Promise<TraderLeaderboardResponse> {
  const apiKey = process.env.FOMO_API_KEY;

  if (!apiKey) {
    return getPreviewLeaderboard(window);
  }

  try {
    const response = await fetch(
      `https://api.fomoapi.io/v2/leaderboard/${window}?limit=50`,
      {
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`FOMO API responded with ${response.status}`);
    }

    const payload = (await response.json()) as FomoLeaderboardPayload;
    const rawTraders = Array.isArray(payload.traders)
      ? (payload.traders as FomoLeaderboardTrader[])
      : [];

    if (rawTraders.length === 0) {
      throw new Error("FOMO API returned no traders");
    }

    return {
      mode: "live",
      window,
      capturedAt: asNullableString(payload.capturedAt),
      traders: rawTraders.map(normalizeTrader),
      providers: getProviderStatuses(true),
      notice:
        "Live discovery data từ FOMO API độc lập. Chỉ số chưa có dấu On-chain verified không được dùng để auto-copy.",
    };
  } catch (error) {
    console.error("Trader discovery provider failed", error);
    return getPreviewLeaderboard(window, true);
  }
}
