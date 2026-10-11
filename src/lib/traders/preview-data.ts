import type {
  RankedTrader,
  TraderLeaderboardResponse,
  TraderProviderStatus,
  TraderWindow,
} from "@/lib/traders/types";

const WINDOW_FACTOR: Record<TraderWindow, number> = {
  "24h": 0.09,
  "7d": 0.31,
  "30d": 1,
  all: 4.7,
};

const PREVIEW_TRADERS: RankedTrader[] = [
  {
    id: "preview-orbit",
    rank: 1,
    handle: "orbit.sol",
    displayName: "Orbit",
    strategy: "Meme",
    wallets: {
      solana: "7oRbitnQVL7eP4A4nXoUErQh3uM5Brx9tYp2K8sWcLm",
      evm: null,
    },
    performance: {
      pnlUsd: 248_640,
      volumeUsd: 1_840_000,
      trades: 184,
      roiPct: 84.2,
      winRatePct: 68.4,
      maxDrawdownPct: 11.8,
      profitFactor: 2.42,
      avgHoldMinutes: 38,
    },
    followers: 12_840,
    holdings: 7,
    topTokens: ["FARTCOIN", "BONK", "WIF"],
    copyScore: 92,
    risk: "Medium",
    verification: "onchain-verified",
    source: "Preview",
  },
  {
    id: "preview-nova",
    rank: 2,
    handle: "novacap",
    displayName: "Nova Capital",
    strategy: "Spot",
    wallets: {
      solana: "Nva4St8Cw2jKu6Vprh5x9eA3QmBn7Lyd1oFgPzXcRtS",
      evm: null,
    },
    performance: {
      pnlUsd: 196_320,
      volumeUsd: 2_970_000,
      trades: 96,
      roiPct: 59.7,
      winRatePct: 72.9,
      maxDrawdownPct: 8.6,
      profitFactor: 2.16,
      avgHoldMinutes: 214,
    },
    followers: 8_294,
    holdings: 12,
    topTokens: ["JUP", "JTO", "PYTH"],
    copyScore: 89,
    risk: "Low",
    verification: "onchain-verified",
    source: "Preview",
  },
  {
    id: "preview-tide",
    rank: 3,
    handle: "tidemaker",
    displayName: "Tide Maker",
    strategy: "Mixed",
    wallets: {
      solana: "T1de8MaKr9sP4yVb2Fn6qXc7Lw3GzUe5JhR0oAdNmK",
      evm: null,
    },
    performance: {
      pnlUsd: 142_770,
      volumeUsd: 1_260_000,
      trades: 132,
      roiPct: 48.1,
      winRatePct: 64.2,
      maxDrawdownPct: 14.4,
      profitFactor: 1.92,
      avgHoldMinutes: 91,
    },
    followers: 6_171,
    holdings: 9,
    topTokens: ["PENGU", "JUP", "BONK"],
    copyScore: 84,
    risk: "Medium",
    verification: "onchain-verified",
    source: "Preview",
  },
  {
    id: "preview-flash",
    rank: 4,
    handle: "flashentry",
    displayName: "Flash Entry",
    strategy: "Meme",
    wallets: {
      solana: "F1ash7EnTr2yVm9Qp5Kd3Xb8Gs4Uc6AwNj0RoLeZtHi",
      evm: null,
    },
    performance: {
      pnlUsd: 118_940,
      volumeUsd: 4_540_000,
      trades: 421,
      roiPct: 124.6,
      winRatePct: 55.8,
      maxDrawdownPct: 28.7,
      profitFactor: 1.71,
      avgHoldMinutes: 12,
    },
    followers: 21_907,
    holdings: 4,
    topTokens: ["WIF", "POPCAT", "MEW"],
    copyScore: 71,
    risk: "High",
    verification: "onchain-verified",
    source: "Preview",
  },
  {
    id: "preview-range",
    rank: 5,
    handle: "rangebound",
    displayName: "Rangebound",
    strategy: "LP",
    wallets: {
      solana: "RaNge2BoUn7dLp4Xk9Qs5Ec3Mv8Aw1Hi6Jt0YzFrPg",
      evm: null,
    },
    performance: {
      pnlUsd: 86_410,
      volumeUsd: 814_000,
      trades: 67,
      roiPct: 34.9,
      winRatePct: 76.1,
      maxDrawdownPct: 6.9,
      profitFactor: 2.09,
      avgHoldMinutes: 760,
    },
    followers: 3_842,
    holdings: 15,
    topTokens: ["SOL", "USDC", "JUP"],
    copyScore: 87,
    risk: "Low",
    verification: "onchain-verified",
    source: "Preview",
  },
  {
    id: "preview-ember",
    rank: 6,
    handle: "ember.sol",
    displayName: "Ember",
    strategy: "Meme",
    wallets: {
      solana: "EmBeR6SoL3pV9cX2Qw7Na4Hd8Jk1Fg5Ty0UzMrLeBi",
      evm: null,
    },
    performance: {
      pnlUsd: 73_250,
      volumeUsd: 932_000,
      trades: 153,
      roiPct: 42.3,
      winRatePct: 61.4,
      maxDrawdownPct: 17.2,
      profitFactor: 1.66,
      avgHoldMinutes: 54,
    },
    followers: 4_906,
    holdings: 6,
    topTokens: ["GOAT", "BONK", "WIF"],
    copyScore: 77,
    risk: "Medium",
    verification: "onchain-verified",
    source: "Preview",
  },
];

export function getProviderStatuses(
  hasFomoKey: boolean,
  fomoError?: boolean,
): TraderProviderStatus[] {
  return [
    {
      id: "fomo",
      label: "FOMO discovery",
      detail: fomoError
        ? "Provider unavailable"
        : hasFomoKey
          ? "Independent API connected"
          : "Add FOMO_API_KEY",
      status: fomoError ? "error" : hasFomoKey ? "connected" : "setup",
    },
    {
      id: "gmgn",
      label: "GMGN data",
      detail: "Partnership / IP whitelist",
      status: "restricted",
    },
    {
      id: "helius",
      label: "On-chain verifier",
      detail: "Helius + price indexer next",
      status: "setup",
    },
    {
      id: "execution",
      label: "Copy engine",
      detail: "Observe-only · no live orders",
      status: "safe",
    },
  ];
}

export function getPreviewLeaderboard(
  window: TraderWindow,
  fomoError = false,
): TraderLeaderboardResponse {
  const factor = WINDOW_FACTOR[window];
  const traders = PREVIEW_TRADERS.map((trader, index) => ({
    ...trader,
    rank: index + 1,
    performance: {
      ...trader.performance,
      pnlUsd: Math.round(trader.performance.pnlUsd * factor),
      volumeUsd: Math.round(trader.performance.volumeUsd * factor),
      trades: Math.max(1, Math.round(trader.performance.trades * factor)),
      roiPct:
        trader.performance.roiPct === null
          ? null
          : Number(
              (trader.performance.roiPct * Math.min(factor, 1.8)).toFixed(1),
            ),
    },
  }));

  return {
    mode: "preview",
    window,
    capturedAt: null,
    traders,
    providers: getProviderStatuses(
      Boolean(process.env.FOMO_API_KEY),
      fomoError,
    ),
    notice: fomoError
      ? "FOMO API chưa phản hồi. Đang hiển thị dữ liệu mô phỏng để giữ dashboard hoạt động."
      : "Preview dataset — các con số dưới đây là dữ liệu mô phỏng, không phải khuyến nghị giao dịch.",
  };
}
