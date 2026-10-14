import { copyPlanId, intentId } from "../ids";
import type { CopyAdapter } from "../ports";
import type {
  CopyIntent,
  CopyPlan,
  CopySubscription,
  ObservedTransaction,
} from "../types";
import { POLYGON_CHAIN } from "./normalize";
import {
  DEFAULT_COPY_SETTINGS,
  type PolymarketCopySettings,
  type PolymarketPlanPayload,
  type PolymarketTradePayload,
} from "./types";

export const POLYMARKET_TRADE_INTENT = "POLYMARKET_TRADE";
const MIN_ORDER_USD = 1;

/** Follower holdings lookup, so sells can be sized against what we actually hold. */
export interface FollowerPositionSource {
  sharesHeld(followerWallet: string, tokenId: string): Promise<number>;
}

/** Leader holdings lookup, so a sell is copied as a fraction of their position. */
export interface LeaderPositionSource {
  sharesHeld(leaderWallet: string, tokenId: string): Promise<number>;
}

export function readCopySettings(
  raw: Record<string, unknown> | undefined,
): PolymarketCopySettings {
  const num = (key: keyof PolymarketCopySettings, fallback: number) => {
    const value = Number(raw?.[key]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const mode = raw?.mode === "live" ? "live" : "dry-run";
  const categories = Array.isArray(raw?.categories)
    ? raw!.categories.filter((c): c is string => typeof c === "string")
    : undefined;
  return {
    ratio: Math.min(1, num("ratio", DEFAULT_COPY_SETTINGS.ratio)),
    maxPerTradeUsd: num("maxPerTradeUsd", DEFAULT_COPY_SETTINGS.maxPerTradeUsd),
    dailyCapUsd: num("dailyCapUsd", DEFAULT_COPY_SETTINGS.dailyCapUsd),
    maxBuyPrice: Math.min(
      0.99,
      num("maxBuyPrice", DEFAULT_COPY_SETTINGS.maxBuyPrice),
    ),
    mode,
    categories,
  };
}

/**
 * Decodes a leader fill into one actionable intent and sizes the follower's
 * order: buys copy a share of the leader's USDC, sells copy the fraction of
 * the leader's position that was sold, applied to the follower's holding.
 */
export class PolymarketTradeAdapter implements CopyAdapter {
  readonly id = "polymarket-trade";
  readonly version = 1;

  constructor(
    private readonly positions: {
      follower: FollowerPositionSource;
      leader: LeaderPositionSource;
    },
  ) {}

  async decode(transaction: ObservedTransaction): Promise<CopyIntent[]> {
    if (transaction.chain !== POLYGON_CHAIN) return [];
    const payload = transaction.raw as PolymarketTradePayload | undefined;
    if (!payload || !payload.tokenId || !payload.side) return [];
    if (payload.usdcSize <= 0 || payload.size <= 0) return [];
    const kind = POLYMARKET_TRADE_INTENT;
    return [
      {
        id: intentId({
          transaction,
          adapterId: this.id,
          adapterVersion: this.version,
          sourceIndex: 0,
          kind,
        }),
        adapterId: this.id,
        adapterVersion: this.version,
        chain: POLYGON_CHAIN,
        leaderWallet: transaction.leaderWallet,
        sourceTransactionId: transaction.id,
        sourceSignature: transaction.signature,
        sourceIndex: 0,
        kind,
        actionability: "actionable",
        confidence: 1,
        createdAt: transaction.observedAt,
        payload,
      },
    ];
  }

  async plan(
    intent: CopyIntent,
    subscription: CopySubscription,
  ): Promise<CopyPlan | null> {
    const trade = intent.payload as PolymarketTradePayload;
    const settings = readCopySettings(subscription.settings);
    const base = {
      adapterId: this.id,
      adapterVersion: this.version,
      chain: POLYGON_CHAIN,
      intentId: intent.id,
      subscriptionId: subscription.id,
      followerWallet: subscription.followerWallet,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    };

    if (trade.side === "BUY") {
      if (trade.price > settings.maxBuyPrice) return null;
      const amountUsd = Math.min(
        trade.usdcSize * settings.ratio,
        settings.maxPerTradeUsd,
      );
      if (amountUsd < MIN_ORDER_USD) return null;
      const payload: PolymarketPlanPayload = {
        tokenId: trade.tokenId,
        conditionId: trade.conditionId,
        side: "BUY",
        amount: Number(amountUsd.toFixed(2)),
        amountUsd: Number(amountUsd.toFixed(2)),
        referencePrice: trade.price,
        title: trade.title,
        eventSlug: trade.eventSlug,
        mode: settings.mode,
      };
      return {
        ...base,
        id: copyPlanId(`${intent.id}:${subscription.id}`),
        action: "BUY",
        payload,
      };
    }

    // SELL: same fraction of the position the leader let go of.
    const [leaderAfter, followerHeld] = await Promise.all([
      this.positions.leader.sharesHeld(intent.leaderWallet, trade.tokenId),
      this.positions.follower.sharesHeld(
        subscription.followerWallet,
        trade.tokenId,
      ),
    ]);
    if (followerHeld <= 0) return null;
    const leaderBefore = leaderAfter + trade.size;
    const fraction =
      leaderBefore > 0 ? Math.min(1, trade.size / leaderBefore) : 1;
    const shares = Number((followerHeld * fraction).toFixed(2));
    const amountUsd = shares * trade.price;
    if (shares <= 0 || amountUsd < MIN_ORDER_USD * 0.5) return null;
    const payload: PolymarketPlanPayload = {
      tokenId: trade.tokenId,
      conditionId: trade.conditionId,
      side: "SELL",
      amount: shares,
      amountUsd: Number(amountUsd.toFixed(2)),
      referencePrice: trade.price,
      title: trade.title,
      eventSlug: trade.eventSlug,
      mode: settings.mode,
    };
    return {
      ...base,
      id: copyPlanId(`${intent.id}:${subscription.id}`),
      action: "SELL",
      payload,
    };
  }
}
