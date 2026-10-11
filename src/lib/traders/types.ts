export const TRADER_WINDOWS = ["24h", "7d", "30d", "all"] as const;

export type TraderWindow = (typeof TRADER_WINDOWS)[number];

export type TraderDataMode = "live" | "preview";

export type VerificationStatus =
  | "onchain-verified"
  | "source-reported"
  | "pending";

export interface TraderWallets {
  solana: string | null;
  evm: string | null;
}

export interface TraderPerformance {
  pnlUsd: number;
  volumeUsd: number;
  trades: number;
  roiPct: number | null;
  winRatePct: number | null;
  maxDrawdownPct: number | null;
  profitFactor: number | null;
  avgHoldMinutes: number | null;
}

export interface RankedTrader {
  id: string;
  rank: number;
  handle: string;
  displayName: string;
  strategy: "Meme" | "Spot" | "LP" | "Mixed";
  wallets: TraderWallets;
  performance: TraderPerformance;
  followers: number;
  holdings: number;
  topTokens: string[];
  copyScore: number | null;
  risk: "Low" | "Medium" | "High";
  verification: VerificationStatus;
  source: "FOMO API" | "Preview";
}

export interface TraderProviderStatus {
  id: "fomo" | "gmgn" | "helius" | "execution";
  label: string;
  detail: string;
  status: "connected" | "setup" | "restricted" | "safe" | "error";
}

export interface TraderLeaderboardResponse {
  mode: TraderDataMode;
  window: TraderWindow;
  capturedAt: string | null;
  traders: RankedTrader[];
  providers: TraderProviderStatus[];
  notice: string;
}
