import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readDammPosition,
  readDlmmPosition,
  type DlmmPoolMeta,
} from "./meteora-lp";

const pool: DlmmPoolMeta = {
  poolAddress: "POOL",
  tokenX: { symbol: "KERMIT", address: "X", logo: "", decimals: 6 },
  tokenY: { symbol: "SOL", address: "Y", logo: "", decimals: 9 },
  lastClosedAtMs: null,
  hasOpen: true,
};

describe("readDlmmPosition", () => {
  it("normalizes a closed position (seconds → ms, strings → numbers)", () => {
    const item = readDlmmPosition("OWNER", pool, {
      positionAddress: "POS1",
      isClosed: true,
      isOutOfRange: false,
      createdAt: 1789307264,
      closedAt: 1789307282,
      updatedAt: 1789307272,
      pnlUsd: "-0.43",
      pnlSol: "-0.001",
      pnlPctChange: "-0.0024",
      pnlSolPctChange: "-0.0006",
      minPrice: "0.000005",
      maxPrice: "0.00003",
      allTimeDeposits: { total: { usd: "18117.1", sol: "181.2" } },
      allTimeWithdrawals: { total: { usd: "18116.7", sol: "181.23" } },
      allTimeFees: { total: { usd: "0", sol: "0" } },
      unrealizedPnl: null,
    });
    assert.ok(item);
    assert.equal(item.isClosed, true);
    assert.equal(item.createdAtMs, 1789307264000);
    assert.equal(item.closedAtMs, 1789307282000);
    assert.equal(item.depositUsd, 18117.1);
    assert.equal(item.withdrawNative, 181.23);
    assert.equal(item.pnlUsd, -0.43);
    assert.equal(item.inRange, true);
    assert.equal(item.valueUsd, 0);
    assert.equal(item.minPrice, 0.000005);
    assert.equal(item.token0.symbol, "KERMIT");
  });

  it("keeps unclaimed fees and current value for open positions", () => {
    const item = readDlmmPosition("OWNER", pool, {
      positionAddress: "POS2",
      isClosed: false,
      isOutOfRange: true,
      createdAt: 1789308592,
      pnlUsd: "10",
      pnlSol: "0.1",
      allTimeDeposits: { total: { usd: "100", sol: "1" } },
      allTimeWithdrawals: { total: { usd: "0", sol: "0" } },
      allTimeFees: { total: { usd: "2", sol: "0.02" } },
      unrealizedPnl: {
        balances: 95.5,
        balancesSol: "0.95",
        unclaimedFeeTokenX: { usd: "0.5", amountSol: "0.005" },
        unclaimedFeeTokenY: { usd: "0.25", amountSol: "0.0025" },
      },
    });
    assert.ok(item);
    assert.equal(item.inRange, false);
    assert.equal(item.valueUsd, 95.5);
    assert.equal(item.valueNative, 0.95);
    assert.equal(item.feeUsd, 2.75);
    assert.equal(item.unclaimedFeeNative, 0.0075);
    assert.equal(item.closedAtMs, null);
  });

  it("drops rows without a position address", () => {
    assert.equal(readDlmmPosition("OWNER", pool, { isClosed: true }), null);
  });
});

describe("readDammPosition", () => {
  const raw = {
    position_address: "DPOS",
    pool_address: "DPOOL",
    token_x: { symbol: "SOL", address: "X", icon: "", decimals: 9 },
    token_y: { symbol: "HORSE", address: "Y", icon: "", decimals: 6 },
    created_at: 1771223159,
    closed_at: 1771230000,
    pnl: -85037.78,
    pnl_change_pct: -35.8,
    pnl_sol: -999.4,
    pnl_sol_pct_change: -35.85,
    pool_price: 2867757.85,
    pool_config: { concentrated_liquidity: false, min_price: 0, max_price: 1 },
    total_deposits: {
      amount_x_usd: 2384.7,
      amount_y_usd: 235071.2,
      amount_x_sol: 28,
      amount_y_sol: 2760,
    },
    total_withdraws: {
      amount_x_usd: 8420,
      amount_y_usd: 143998,
      amount_x_sol: 98.8,
      amount_y_sol: 1689.8,
    },
    total_claimed_fees: {
      amount_x_usd: 1,
      amount_y_usd: 2,
      amount_x_sol: 0.01,
      amount_y_sol: 0.02,
    },
    current_position: {
      current_deposits: {
        amount_x_usd: 10,
        amount_y_usd: 5,
        amount_x_sol: 0.1,
        amount_y_sol: 0.05,
      },
      unclaimed_fees: {
        amount_x_usd: 0.3,
        amount_y_usd: 0.2,
        amount_x_sol: 0.003,
        amount_y_sol: 0.002,
      },
    },
  };

  it("sums token legs and treats full-range pools as in range", () => {
    const item = readDammPosition("OWNER", raw, true);
    assert.ok(item);
    assert.equal(item.protocol, "meteora_damm_v2");
    assert.equal(item.depositUsd, 2384.7 + 235071.2);
    assert.equal(item.depositNative, 2788);
    assert.equal(item.feeUsd, 3);
    assert.equal(item.pnlUsd, -85037.78);
    assert.equal(item.inRange, true);
    assert.equal(item.minPrice, null);
    assert.equal(item.closedAtMs, 1771230000000);
    assert.equal(item.valueUsd, 0);
  });

  it("uses unrealized PnL, current value and unclaimed fees when open", () => {
    const item = readDammPosition(
      "OWNER",
      { ...raw, unrealized_pnl: 12.5, unrealized_pnl_change_pct: 1.2 },
      false,
    );
    assert.ok(item);
    assert.equal(item.isClosed, false);
    assert.equal(item.pnlUsd, 12.5);
    assert.equal(item.pnlPercent, 1.2);
    assert.equal(item.valueUsd, 15);
    assert.equal(item.feeUsd, 3.5);
    assert.equal(item.closedAtMs, null);
  });

  it("derives range from concentrated pool config", () => {
    const item = readDammPosition(
      "OWNER",
      {
        ...raw,
        pool_price: 0.05,
        pool_config: {
          concentrated_liquidity: true,
          min_price: 0.01,
          max_price: 0.1,
        },
      },
      false,
    );
    assert.ok(item);
    assert.equal(item.inRange, true);
    assert.equal(item.minPrice, 0.01);
    assert.equal(item.maxPrice, 0.1);
  });
});
