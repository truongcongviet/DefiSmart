import assert from "node:assert/strict";
import { test } from "node:test";

import { computePerpMetrics, scorePerpTrader } from "./perp-metrics";
import type { PerpFill, PerpInstrument } from "./perps-api";

const instruments = new Map<number, PerpInstrument>([
  [
    1,
    {
      instrument_id: 1,
      symbol: "BTC-USD",
      category: "crypto",
      base_asset: "BTC",
    },
  ],
]);

function fill(
  partial: Partial<PerpFill> & { pnl: string; timestamp: number },
): PerpFill {
  return {
    trade_id: partial.timestamp,
    order_id: 1,
    instrument_id: 1,
    side: "long",
    price: "100",
    quantity: "1",
    taker: true,
    fee: "0.1",
    total_fee: "0.1",
    previous_size: "0",
    previous_entry_price: "0",
    liquidation: false,
    adl: false,
    settlement: false,
    ...partial,
  };
}

test("computePerpMetrics counts realized fills as trades and reads the portfolio", () => {
  const now = 1_800_000_000_000;
  const fills = [
    fill({ pnl: "0", timestamp: now - 4_000 }),
    fill({ pnl: "50", timestamp: now - 3_000 }),
    fill({ pnl: "-20", timestamp: now - 2_000 }),
    fill({ pnl: "30", timestamp: now - 1_000, liquidation: true }),
  ];
  const m = computePerpMetrics({
    fills,
    portfolio: {
      equity: "1000",
      timestamp: now,
      positions: [
        {
          instrument_id: 1,
          symbol: "BTC-USD",
          size: "-2",
          entry_price: "100",
          unrealized_pnl: "5",
          return_on_equity: "0.05",
        },
      ],
    },
    series: [
      [now - 2 * 86_400_000, 10],
      [now - 86_400_000, -5],
    ],
    instruments,
    nowMs: now,
  });
  assert.equal(m.closedTrades, 3);
  assert.equal(m.wins, 2);
  assert.equal(m.losses, 1);
  assert.equal(m.realizedPnlUsd, 60);
  assert.equal(m.profitFactor, 4);
  assert.equal(m.liquidations, 1);
  assert.equal(m.openPositions[0].side, "short");
  assert.equal(m.openPositions[0].notionalUsd, 200);
  assert.equal(m.positiveDays, 1);
  assert.equal(m.pnl30dUsd, 5);
  assert.equal(m.maxDrawdownUsd, 5);
  assert.ok(m.flags.includes("liquidated"));
  assert.ok(m.flags.includes("small-sample"));
  assert.equal(m.instruments[0].symbol, "BTC-USD");
});

test("scorePerpTrader prefers consistent traders without liquidations", () => {
  const now = 1_800_000_000_000;
  const fills = Array.from({ length: 120 }, (_, i) =>
    fill({
      pnl: i % 3 === 0 ? "-30" : "50",
      timestamp: now - (120 - i) * 60_000,
    }),
  );
  const series = Array.from(
    { length: 30 },
    (_, i) =>
      [now - i * 86_400_000, i % 4 === 0 ? -100 : 300] as [number, number],
  );
  const strong = computePerpMetrics({
    fills,
    portfolio: { equity: "10000", timestamp: now, positions: [] },
    series,
    instruments,
    nowMs: now,
  });
  const weak = computePerpMetrics({
    fills: fills
      .slice(0, 10)
      .map((f, i) => (i === 0 ? { ...f, liquidation: true } : f)),
    portfolio: { equity: "10000", timestamp: now, positions: [] },
    series: series.slice(0, 5),
    instruments,
    nowMs: now,
  });
  assert.ok(
    scorePerpTrader(strong, strong.pnl30dUsd) >
      scorePerpTrader(weak, strong.pnl30dUsd),
  );
  assert.ok(scorePerpTrader(strong, strong.pnl30dUsd) >= 60);
});

test("computeWindowStats restricts fills and series to the window", () => {
  const now = 1_800_000_000_000;
  const day = 86_400_000;
  const fills = [
    fill({ pnl: "10", timestamp: now - 2 * 3_600_000 }), // today
    fill({ pnl: "-5", timestamp: now - 3 * day }), // this week
    fill({ pnl: "20", timestamp: now - 20 * day }), // this month
    fill({ pnl: "-8", timestamp: now - 60 * day }), // older
  ];
  const daily: Array<[number, number]> = [
    [now - 1 * day, 5],
    [now - 3 * day, -2],
    [now - 20 * day, 7],
    [now - 60 * day, -4],
  ];
  const hourly: Array<[number, number]> = [
    [now - 1 * 3_600_000, 3],
    [now - 2 * 3_600_000, -1],
    [now - 30 * 3_600_000, 9], // yesterday, outside "day"
  ];
  const m = computePerpMetrics({
    fills,
    portfolio: { equity: "0", timestamp: now, positions: [] },
    series: daily,
    hourly,
    instruments,
    nowMs: now,
  });
  assert.equal(m.windows.day.closedTrades, 1);
  assert.equal(m.windows.day.pnlUsd, 2);
  assert.equal(m.windows.day.periods, 2);
  assert.equal(m.windows.week.closedTrades, 2);
  assert.equal(m.windows.week.winRate, 0.5);
  assert.equal(m.windows.week.pnlUsd, 3);
  assert.equal(m.windows.month.closedTrades, 3);
  assert.equal(m.windows.month.pnlUsd, 10);
  assert.equal(m.windows.all.closedTrades, 4);
  assert.equal(m.windows.all.pnlUsd, 6);
  assert.equal(m.pnl30dUsd, 10);
});
