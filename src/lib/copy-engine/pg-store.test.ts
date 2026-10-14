import assert from "node:assert/strict";
import { test } from "node:test";

import { PgCopyStore } from "./pg-store";

const url = process.env.DATABASE_URL;

test(
  "PgCopyStore round-trips observations, subscriptions and jobs",
  { skip: !url && "DATABASE_URL not set" },
  async () => {
    const store = await PgCopyStore.open(url as string);
    const suffix = Date.now().toString(36);
    const leader = `0xleader${suffix}`;
    const inserted = await store.insertObservation({
      id: `polygon:${leader}:tx1`,
      chain: "polygon",
      leaderWallet: leader,
      signature: "tx1",
      slot: 0,
      blockTime: null,
      observedAt: new Date().toISOString(),
      success: true,
      leaderSigned: true,
      deltas: [],
      raw: {},
    } as never);
    assert.equal(inserted, true);
    assert.equal(
      await store.insertObservation({
        id: `polygon:${leader}:tx1`,
        chain: "polygon",
        leaderWallet: leader,
        observedAt: new Date().toISOString(),
      } as never),
      false,
    );

    await store.upsertSubscription(
      {
        id: `polygon:${leader}:follower`,
        chain: "polygon",
        leaderWallet: leader,
        followerWallet: "0xfollower",
        enabled: true,
        createdAt: new Date().toISOString(),
        settings: { ratio: 0.1 },
      },
      "user-1",
    );
    const subs = await store.listEnabledSubscriptions("polygon", leader);
    assert.equal(subs.length, 1);
    assert.equal(subs[0].ownerUserId, "user-1");
    assert.deepEqual(subs[0].settings, { ratio: 0.1 });

    const jobId = `job-${suffix}`;
    await store.insertJob({
      id: jobId,
      subscriptionId: subs[0].id,
      intentId: "intent",
      chain: "polygon",
      status: "DETECTED",
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    } as never);
    const updated = await store.updateJob({
      jobId,
      status: "READY",
      at: new Date().toISOString(),
      plan: { id: "p", payload: { amountUsd: 12.5 } } as never,
      incrementAttempts: true,
    });
    assert.equal(updated.status, "READY");
    assert.equal(updated.attempts, 1);
    assert.equal(
      await store.sumCommittedUsd(
        subs[0].id,
        new Date(Date.now() - 60_000).toISOString(),
      ),
      12.5,
    );
    assert.equal(await store.deleteSubscription(subs[0].id, "user-1"), true);
    await store.close();
  },
);
