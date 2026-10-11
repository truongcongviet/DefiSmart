export type WalletSegment =
  | "Diversified Multi-Protocol"
  | "Stable Yield Farmer"
  | "Active Rebalancer"
  | "Momentum Rotator"
  | "Concentrated Conviction"
  | "High-Risk Spinner"
  | "Balanced LP Farmer";

export type WalletTier = "Smart LP" | "Watchlist" | "Risky";

export interface WalletMetrics {
  uniquePools: number;
  protocolsUsed: number;
  openPositions: number;
  historicalPositions: number;
  turnoverRatio: number;
  outOfRangeRatio: number;
  stableExposureRatio: number;
  avgPositionAgeHours: number;
  winRate: number;
  totalPnlUsd: number;
  totalFeeUsd: number;
  roi: number;
  apr: number;
  revenueTrendPct: number;
}

export interface SourceStatus {
  lpOverview: boolean;
  lpOpening: boolean;
  lpHistorical: boolean;
  lpRevenue: boolean;
  meteoraDlmm: boolean;
  meteoraDammOpen: boolean;
  meteoraDammClosed: boolean;
}

export interface WalletClassificationResult {
  wallet: string;
  tier: WalletTier;
  segment: WalletSegment;
  smartScore: number;
  confidence: number;
  summary: string;
  rationale: string[];
  metrics: WalletMetrics;
  sourceStatus: SourceStatus;
  generatedAt: string;
}
