import { observationId } from "../ids";
import type { ObservedTransaction } from "../types";
import type { PolymarketActivity, PolymarketTradePayload } from "./types";

export const POLYGON_CHAIN = "polygon";

/** Turns a Data API activity row into an engine observation (TRADE rows only). */
export function normalizePolymarketActivity(
  item: PolymarketActivity,
  leaderWallet: string,
  observedAt = new Date().toISOString(),
): ObservedTransaction<PolymarketTradePayload> | null {
  if (item.type !== "TRADE") return null;
  if (item.side !== "BUY" && item.side !== "SELL") return null;
  const leader = leaderWallet.toLowerCase();
  if (item.proxyWallet?.toLowerCase() !== leader) return null;
  const hash = item.transactionHash || `${item.timestamp}-${item.asset}`;
  const payload: PolymarketTradePayload = {
    conditionId: item.conditionId,
    tokenId: item.asset,
    outcome: item.outcome,
    outcomeIndex: item.outcomeIndex,
    side: item.side,
    price: Number(item.price) || 0,
    size: Number(item.size) || 0,
    usdcSize: Number(item.usdcSize) || 0,
    title: item.title,
    slug: item.slug,
    eventSlug: item.eventSlug,
    icon: item.icon ?? null,
    timestamp: item.timestamp,
    transactionHash: hash,
  };
  return {
    id: observationId(
      POLYGON_CHAIN,
      leader,
      `${hash}:${item.asset}:${item.side}`,
    ),
    chain: POLYGON_CHAIN,
    leaderWallet: leader,
    signature: hash,
    slot: 0,
    blockTime: item.timestamp,
    observedAt,
    success: true,
    leaderSigned: true,
    deltas: [],
    raw: payload,
  } as unknown as ObservedTransaction<PolymarketTradePayload>;
}
