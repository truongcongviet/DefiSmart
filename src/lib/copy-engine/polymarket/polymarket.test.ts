import assert from "node:assert/strict";
import { test } from "node:test";

import type { CopySubscription } from "../types";
import { PolymarketTradeAdapter, readCopySettings } from "./adapter";
import {
  agentAccount,
  decryptPrivateKey,
  generateAgentKey,
} from "./agent-wallet";
import { PolymarketBudgetGuard, PolymarketFreshnessGuard } from "./guards";
import { normalizePolymarketActivity } from "./normalize";
import type { PolymarketActivity } from "./types";

const LEADER = "0xE4A57385A34B0B32FD86BE72EFD25CDA41003CAD";

function activity(
  partial: Partial<PolymarketActivity> = {},
): PolymarketActivity {
  return {
    proxyWallet: LEADER.toLowerCase(),
    timestamp: Math.floor(Date.now() / 1000) - 5,
    conditionId: "0xcond",
    type: "TRADE",
    size: 100,
    usdcSize: 57.4,
    transactionHash: "0xhash",
    price: 0.574,
    asset: "1234",
    side: "BUY",
    outcomeIndex: 1,
    title: "Flyers vs. Bruins",
    slug: "nhl-phi-bos",
    eventSlug: "nhl-phi-bos",
    outcome: "Bruins",
    ...partial,
  } as PolymarketActivity;
}

const subscription: CopySubscription = {
  id: "sub",
  chain: "polygon",
  leaderWallet: LEADER.toLowerCase(),
  followerWallet: "0xfollower",
  enabled: true,
  createdAt: new Date().toISOString(),
  settings: {
    ratio: 0.2,
    maxPerTradeUsd: 10,
    dailyCapUsd: 25,
    mode: "dry-run",
  },
};

const adapter = new PolymarketTradeAdapter({
  follower: { sharesHeld: async () => 40 },
  leader: { sharesHeld: async () => 300 },
});

test("normalize keeps only the leader's TRADE rows and ids them by tx + asset + side", () => {
  const tx = normalizePolymarketActivity(activity(), LEADER);
  assert.ok(tx);
  assert.equal(tx!.chain, "polygon");
  assert.equal(tx!.leaderWallet, LEADER.toLowerCase());
  assert.ok(tx!.id.includes("0xhash"));
  assert.equal(
    normalizePolymarketActivity(activity({ type: "REDEEM", side: "" }), LEADER),
    null,
  );
  assert.equal(
    normalizePolymarketActivity(activity({ proxyWallet: "0xother" }), LEADER),
    null,
  );
});

test("adapter sizes buys by ratio and cap, and skips expensive buys", async () => {
  const tx = normalizePolymarketActivity(activity(), LEADER)!;
  const [intent] = await adapter.decode(tx);
  assert.equal(intent.kind, "POLYMARKET_TRADE");
  const plan = await adapter.plan(intent, subscription);
  assert.ok(plan);
  assert.equal(plan!.action, "BUY");
  // 57.4 × 0.2 = 11.48 → capped at 10
  assert.equal((plan!.payload as { amount: number }).amount, 10);

  const pricey = normalizePolymarketActivity(
    activity({ price: 0.97, usdcSize: 97 }),
    LEADER,
  )!;
  const [pIntent] = await adapter.decode(pricey);
  assert.equal(await adapter.plan(pIntent, subscription), null);
});

test("adapter copies sells as the fraction of the leader's position that was sold", async () => {
  // leader sold 100 of 400 (300 left) → 25 % of follower's 40 shares = 10
  const tx = normalizePolymarketActivity(activity({ side: "SELL" }), LEADER)!;
  const [intent] = await adapter.decode(tx);
  const plan = await adapter.plan(intent, subscription);
  assert.ok(plan);
  assert.equal(plan!.action, "SELL");
  assert.equal((plan!.payload as { amount: number }).amount, 10);
});

test("budget guard enforces the rolling daily cap", async () => {
  const tx = normalizePolymarketActivity(activity(), LEADER)!;
  const [intent] = await adapter.decode(tx);
  const under = new PolymarketBudgetGuard(async () => 10);
  const over = new PolymarketBudgetGuard(async () => 20);
  assert.equal(
    (await under.evaluate({ transaction: tx, intent, subscription })).allowed,
    true,
  );
  const decision = await over.evaluate({
    transaction: tx,
    intent,
    subscription,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /DAILY_CAP/);
});

test("freshness guard rejects old fills", async () => {
  const old = normalizePolymarketActivity(
    activity({ timestamp: Math.floor(Date.now() / 1000) - 600 }),
    LEADER,
  )!;
  const [intent] = await adapter.decode(old);
  const guard = new PolymarketFreshnessGuard(90_000);
  assert.equal(
    (await guard.evaluate({ transaction: old, intent, subscription })).allowed,
    false,
  );
});

test("readCopySettings clamps and defaults", () => {
  const s = readCopySettings({ ratio: 5, maxBuyPrice: 2, mode: "live" });
  assert.equal(s.ratio, 1);
  assert.equal(s.maxBuyPrice, 0.99);
  assert.equal(s.mode, "live");
  assert.equal(readCopySettings(undefined).mode, "dry-run");
});

test("agent key is encrypted at rest and decrypts to the same address", () => {
  const secret = "test-secret-with-enough-length";
  const generated = generateAgentKey(secret);
  assert.match(generated.address, /^0x[0-9a-fA-F]{40}$/);
  const key = decryptPrivateKey(generated.blob, secret);
  assert.equal(agentAccount(generated.blob, secret).address, generated.address);
  assert.match(key, /^0x[0-9a-f]{64}$/);
  assert.throws(() =>
    decryptPrivateKey(generated.blob, "wrong-secret-wrong-secret"),
  );
});
