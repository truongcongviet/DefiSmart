import assert from "node:assert/strict";
import { test } from "node:test";

import {
  categorize,
  computeMetrics,
  scorePredictTrader,
  settleBets,
} from "./metrics";
import type { ClosedPosition, OpenPosition } from "./polymarket-api";

function lostPosition(
  partial: Partial<OpenPosition> & { initialValue: number },
): OpenPosition {
  return {
    proxyWallet: "0xabc",
    asset: "2",
    conditionId: "0xlost",
    size: 100,
    avgPrice: 0.5,
    curPrice: 0,
    currentValue: 0,
    totalBought: 100,
    cashPnl: -partial.initialValue,
    percentPnl: -100,
    realizedPnl: 0,
    title: "Lost market",
    slug: "lost",
    eventSlug: "lost-event",
    outcome: "Yes",
    outcomeIndex: 0,
    endDate: "2026-01-01",
    ...partial,
  };
}

function closed(
  partial: Partial<ClosedPosition> & {
    realizedPnl: number;
    totalBought: number;
    avgPrice: number;
  },
): ClosedPosition {
  return {
    proxyWallet: "0xabc",
    asset: "1",
    conditionId: "0x1",
    curPrice: 1,
    title: "Market",
    slug: "market",
    eventSlug: "event",
    outcome: "Yes",
    outcomeIndex: 0,
    timestamp: 1_000_000,
    ...partial,
  };
}

test("categorize reads sport / politics / crypto hints from slugs", () => {
  assert.equal(categorize({ eventSlug: "nhl-phi-bos-2026-10-10" }), "sports");
  assert.equal(
    categorize({ title: "Will Trump win the election?" }),
    "politics",
  );
  assert.equal(categorize({ slug: "bitcoin-above-100k" }), "crypto");
  assert.equal(categorize({ title: "Something else" }), "other");
});

test("computeMetrics derives win rate, ROI, profit factor and flags", () => {
  const now = 1_800_000_000;
  const closedRows = [
    closed({
      conditionId: "0xa",
      realizedPnl: 100,
      totalBought: 200,
      avgPrice: 0.5,
      timestamp: now - 86_400,
    }),
    closed({
      conditionId: "0xb",
      realizedPnl: 50,
      totalBought: 100,
      avgPrice: 0.5,
      timestamp: now - 86_400 * 2,
    }),
    closed({
      conditionId: "0xc",
      realizedPnl: 0,
      totalBought: 0,
      avgPrice: 0.5,
    }), // no cost → ignored
  ];
  // Losing legs live in /positions at price 0.
  const open = [
    lostPosition({
      conditionId: "0xd",
      initialValue: 50,
      endDate: new Date((now - 86_400 * 40) * 1000).toISOString(),
    }),
  ];
  const m = computeMetrics({ closed: closedRows, open, activity: [], now });
  assert.equal(m.markets, 3);
  assert.equal(m.wins, 2);
  assert.equal(m.losses, 1);
  assert.equal(m.winRate, 2 / 3);
  assert.equal(m.realizedPnlUsd, 100);
  assert.equal(m.costUsd, 200);
  assert.equal(m.roi, 0.5);
  assert.equal(m.profitFactor, 3);
  assert.equal(m.markets30d, 2);
  assert.equal(m.winRate30d, 1);
  assert.ok(m.flags.includes("small-sample"));
  assert.ok(m.flags.includes("concentrated"));
  assert.ok(!m.flags.includes("inactive"));
});

test("scorePredictTrader rewards consistent, diversified traders", () => {
  const now = 1_800_000_000;
  const many = Array.from({ length: 60 }, (_, i) =>
    closed({
      conditionId: `0x${i}`,
      realizedPnl: 60,
      totalBought: 100,
      avgPrice: 0.5,
      timestamp: now - 3_600 * (i + 1),
      eventSlug: `event-${i}`,
    }),
  );
  const lost = Array.from({ length: 20 }, (_, i) =>
    lostPosition({
      conditionId: `0xl${i}`,
      initialValue: 40,
      endDate: new Date((now - 3_600 * (i + 1)) * 1000).toISOString(),
    }),
  );
  const strong = computeMetrics({
    closed: many,
    open: lost,
    activity: [{ type: "TRADE", timestamp: now - 10 } as never],
    now,
  });
  const weak = computeMetrics({
    closed: many.slice(0, 4),
    open: [],
    activity: [],
    now,
  });
  assert.ok(
    scorePredictTrader(strong, strong.realizedPnlUsd) >
      scorePredictTrader(weak, strong.realizedPnlUsd),
  );
  assert.ok(scorePredictTrader(strong, strong.realizedPnlUsd) >= 60);
});

test("settleBets nets hedged legs per market", () => {
  const now = 1_800_000_000;
  const closedRows = [
    closed({
      conditionId: "0xm",
      realizedPnl: 120,
      totalBought: 200,
      avgPrice: 0.5,
      timestamp: now - 10,
    }),
  ];
  const open = [
    lostPosition({
      conditionId: "0xm",
      initialValue: 90,
      endDate: "2026-01-01",
    }),
  ];
  const { bets, live } = settleBets(closedRows, open, now);
  assert.equal(bets.length, 1);
  assert.equal(bets[0].costUsd, 190);
  assert.equal(bets[0].pnlUsd, 30);
  assert.equal(live.length, 0);
});
