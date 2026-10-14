import assert from "node:assert/strict";
import { test } from "node:test";

import { privateKeyToAccount } from "viem/accounts";

import { CopyEngine } from "../engine";
import { PgCopyStore } from "../pg-store";
import { PolymarketTradeAdapter } from "./adapter";
import { PolymarketClobExecutor } from "./executor";
import { PolymarketBudgetGuard, PolymarketFreshnessGuard } from "./guards";
import { normalizePolymarketActivity } from "./normalize";
import type { PolymarketActivity } from "./types";

const url = process.env.DATABASE_URL;

test(
  "end to end: a leader BUY becomes a sized DRY_RUN job in Postgres",
  { skip: !url && "DATABASE_URL not set" },
  async () => {
    const store = await PgCopyStore.open(url as string);
    const suffix = Date.now().toString(36);
    const leader = `0x${suffix.padEnd(40, "a").slice(0, 40)}`;
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    await store.upsertSubscription(
      {
        id: `polygon:${leader}:${account.address.toLowerCase()}`,
        chain: "polygon",
        leaderWallet: leader,
        followerWallet: account.address,
        enabled: true,
        createdAt: new Date().toISOString(),
        settings: {
          ratio: 0.25,
          maxPerTradeUsd: 20,
          dailyCapUsd: 50,
          mode: "dry-run",
        },
      },
      `user-${suffix}`,
    );
    const logs: string[] = [];
    const engine = new CopyEngine({
      store,
      adapters: [
        new PolymarketTradeAdapter({
          follower: { sharesHeld: async () => 0 },
          leader: { sharesHeld: async () => 0 },
        }),
      ],
      guards: [
        new PolymarketFreshnessGuard(90_000),
        new PolymarketBudgetGuard((id, since) =>
          store.sumCommittedUsd(id, since),
        ),
      ],
      executor: new PolymarketClobExecutor({
        account,
        rpcUrl: "https://polygon-rpc.com",
        forceDryRun: true,
        onLog: (m) => logs.push(m),
      }),
    });
    const activity: PolymarketActivity = {
      proxyWallet: leader,
      timestamp: Math.floor(Date.now() / 1000) - 3,
      conditionId: "0xcond",
      type: "TRADE",
      size: 200,
      usdcSize: 120,
      transactionHash: `0xtx${suffix}`,
      price: 0.6,
      asset: "999",
      side: "BUY",
      outcomeIndex: 0,
      title: "Test market",
      slug: "test",
      eventSlug: "test",
      outcome: "Yes",
    } as PolymarketActivity;
    const tx = normalizePolymarketActivity(activity, leader)!;
    const result = await engine.handle(tx);
    assert.equal(result.accepted, true);
    assert.equal(result.intentIds.length, 1);
    assert.equal(result.jobIds.length, 1);
    const job = await store.getJob(result.jobIds[0]);
    assert.ok(job);
    assert.equal(job!.status, "DRY_RUN");
    // 120 × 0.25 = 30 → capped at 20
    assert.equal((job!.plan?.payload as { amount: number }).amount, 20);
    assert.equal(job!.receipt?.status, "simulated");
    assert.ok(logs.some((l) => l.includes("[dry-run] BUY $20")));
    // A duplicate observation is ignored.
    const again = await engine.handle(tx);
    assert.equal(again.duplicate, true);
    await store.close();
  },
);
