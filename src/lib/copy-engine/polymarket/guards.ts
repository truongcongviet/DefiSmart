import type { CopyGuard } from "../ports";
import { readCopySettings } from "./adapter";
import type { PolymarketTradePayload } from "./types";

const DAY_MS = 86_400_000;

/** Caps per-trade size and rolling 24 h commitment per subscription. */
export class PolymarketBudgetGuard implements CopyGuard {
  readonly id = "polymarket-budget";

  constructor(
    private readonly committedSince: (
      subscriptionId: string,
      sinceIso: string,
    ) => Promise<number>,
  ) {}

  async evaluate(input: Parameters<CopyGuard["evaluate"]>[0]) {
    const settings = readCopySettings(input.subscription.settings);
    const trade = input.intent.payload as PolymarketTradePayload;
    if (trade.side === "BUY") {
      const planned = Math.min(
        trade.usdcSize * settings.ratio,
        settings.maxPerTradeUsd,
      );
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const committed = await this.committedSince(input.subscription.id, since);
      if (committed + planned > settings.dailyCapUsd) {
        return {
          allowed: false,
          reason: `DAILY_CAP:${committed.toFixed(2)}+${planned.toFixed(2)}>${settings.dailyCapUsd}`,
        };
      }
    }
    return { allowed: true };
  }
}

/** Skips fills that are too old to copy sensibly (prices move). */
export class PolymarketFreshnessGuard implements CopyGuard {
  readonly id = "polymarket-freshness";

  constructor(
    private readonly maxAgeMs = 90_000,
    private readonly now: () => number = Date.now,
  ) {}

  async evaluate(input: Parameters<CopyGuard["evaluate"]>[0]) {
    const trade = input.intent.payload as PolymarketTradePayload;
    const age = this.now() - trade.timestamp * 1000;
    return age <= this.maxAgeMs
      ? { allowed: true }
      : { allowed: false, reason: `STALE_FILL:${Math.round(age / 1000)}s` };
  }
}

/** Skips markets outside the subscription's category list, when one is set. */
export class PolymarketCategoryGuard implements CopyGuard {
  readonly id = "polymarket-category";

  constructor(
    private readonly categorize: (trade: PolymarketTradePayload) => string,
  ) {}

  async evaluate(input: Parameters<CopyGuard["evaluate"]>[0]) {
    const settings = readCopySettings(input.subscription.settings);
    if (!settings.categories || settings.categories.length === 0)
      return { allowed: true };
    const trade = input.intent.payload as PolymarketTradePayload;
    const category = this.categorize(trade);
    return settings.categories.includes(category)
      ? { allowed: true }
      : { allowed: false, reason: `CATEGORY_NOT_ALLOWED:${category}` };
  }
}
