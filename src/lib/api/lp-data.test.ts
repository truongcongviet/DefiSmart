import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { periodMapForTest, toLpAgentPositionForTest } from "./lp-data";
import type { LpPosition } from "./meteora-lp";

function position(overrides: Partial<LpPosition>): LpPosition {
  return {
    owner: "OWNER",
    position: "POS",
    pool: "POOL",
    protocol: "meteora_dlmm",
    isClosed: true,
    token0: { symbol: "A", address: "A", logo: "", decimals: 6 },
    token1: { symbol: "SOL", address: "S", logo: "", decimals: 9 },
    depositUsd: 100,
    depositNative: 1,
    withdrawUsd: 110,
    withdrawNative: 1.1,
    feeUsd: 5,
    feeNative: 0.05,
    pnlUsd: 10,
    pnlNative: 0.1,
    pnlPercent: 10,
    pnlPercentNative: 10,
    inRange: null,
    valueUsd: 0,
    valueNative: 0,
    unclaimedFeeUsd: 0,
    unclaimedFeeNative: 0,
    minPrice: null,
    maxPrice: null,
    createdAtMs: null,
    updatedAtMs: null,
    closedAtMs: null,
    ...overrides,
  };
}

describe("periodMap", () => {
  it("buckets positions by close time into ALL / 7D / 1M / 3M / 1Y / YTD", () => {
    const now = Date.UTC(2026, 9, 12); // 2026-10-12
    const day = 86_400_000;
    const positions = [
      position({ position: "a", closedAtMs: now - 2 * day, pnlNative: 1 }),
      position({ position: "b", closedAtMs: now - 20 * day, pnlNative: 2 }),
      position({ position: "c", closedAtMs: now - 80 * day, pnlNative: 4 }),
      position({ position: "d", closedAtMs: now - 400 * day, pnlNative: 8 }),
    ];
    const map = periodMapForTest(positions, now, (subset) =>
      subset.reduce((sum, item) => sum + item.pnlNative, 0),
    );
    assert.equal(map.ALL, 15);
    assert.equal(map["7D"], 1);
    assert.equal(map["1M"], 3);
    assert.equal(map["3M"], 7);
    assert.equal(map["1Y"], 7);
    assert.equal(map.YTD, 7);
  });
});

describe("toLpAgentPosition", () => {
  it("emits the legacy field aliases the analysis code reads", () => {
    const now = Date.UTC(2026, 9, 12);
    const item = toLpAgentPositionForTest(
      position({
        createdAtMs: now - 3_600_000,
        closedAtMs: now,
        inRange: true,
      }),
      now,
    );
    assert.equal(item.status, "Close");
    assert.equal(item.tokenId, "POS");
    assert.equal(item.poolAddress, "POOL");
    assert.equal(item.pairName, "A-SOL");
    assert.equal(item.token0Info.token_symbol, "A");
    assert.equal(item.pnl.valueNative, 0.1);
    assert.equal(item.pnlNative, 0.1);
    assert.equal(item.collectedFeeNative, 0.05);
    assert.equal(item.inputNative, 1);
    assert.equal(Math.round(item.ageHour), 1);
    assert.equal(item.closeAt, new Date(now).toISOString());
  });

  it("marks open positions and has no closeAt", () => {
    const item = toLpAgentPositionForTest(
      position({ isClosed: false }),
      Date.now(),
    );
    assert.equal(item.status, "Open");
    assert.equal(item.closeAt, null);
  });
});
