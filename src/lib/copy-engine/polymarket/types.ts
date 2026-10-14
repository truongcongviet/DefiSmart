import type { ActivityItem } from "@/lib/predict/polymarket-api";

/** A leader's CLOB fill, as seen on the Data API activity feed. */
export interface PolymarketTradePayload {
  conditionId: string;
  /** ERC-1155 token id of the outcome traded. */
  tokenId: string;
  outcome: string;
  outcomeIndex: number;
  side: "BUY" | "SELL";
  /** Price in USDC per share, 0–1. */
  price: number;
  /** Shares. */
  size: number;
  usdcSize: number;
  title: string;
  slug: string;
  eventSlug: string;
  icon: string | null;
  /** Unix seconds of the fill. */
  timestamp: number;
  transactionHash: string;
}

export interface PolymarketCopySettings {
  /** Share of the leader's USDC size to copy, e.g. 0.1 = 10 %. */
  ratio: number;
  /** Hard cap per copied order in USDC. */
  maxPerTradeUsd: number;
  /** Cap on USDC committed per rolling 24 h. */
  dailyCapUsd: number;
  /** Skip buys priced above this (cents of certainty are rarely worth it). */
  maxBuyPrice: number;
  /** "dry-run" plans and logs; "live" posts orders. */
  mode: "dry-run" | "live";
  /** Only copy these categories (empty = all). */
  categories?: string[];
}

export const DEFAULT_COPY_SETTINGS: PolymarketCopySettings = {
  ratio: 0.1,
  maxPerTradeUsd: 25,
  dailyCapUsd: 100,
  maxBuyPrice: 0.95,
  mode: "dry-run",
};

export interface PolymarketPlanPayload {
  tokenId: string;
  conditionId: string;
  side: "BUY" | "SELL";
  /** BUY: USDC to spend. SELL: shares to sell. */
  amount: number;
  /** USD notional of the order, for caps. */
  amountUsd: number;
  referencePrice: number;
  title: string;
  eventSlug: string;
  mode: "dry-run" | "live";
}

export type PolymarketActivity = ActivityItem;
