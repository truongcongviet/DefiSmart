import assert from "node:assert/strict";
import test from "node:test";

import { CopyEngine } from "./engine";
import { copyPlanId, intentId, observationId } from "./ids";
import type { CopyAdapter, CopyExecutor } from "./ports";
import { MemoryCopyStore } from "./store";
import type {
  CopyIntent,
  CopySubscription,
  ObservedTransaction,
} from "./types";

function transaction(
  signature: string,
  overrides: Partial<ObservedTransaction> = {},
): ObservedTransaction {
  const leaderWallet = "Leader111111111111111111111111111111111111";
  return {
    id: observationId("solana", leaderWallet, signature),
    chain: "solana",
    signature,
    slot: 1,
    commitment: "confirmed",
    leaderWallet,
    leaderSigned: true,
    success: true,
    observedAt: new Date().toISOString(),
    accountKeys: [leaderWallet],
    programIds: ["Program1111111111111111111111111111111111"],
    assetDeltas: [],
    raw: {},
    ...overrides,
  };
}

function adapter(): CopyAdapter {
  return {
    id: "test-adapter",
    version: 1,
    async decode(source) {
      const intent: CopyIntent = {
        id: intentId({
          transaction: source,
          adapterId: "test-adapter",
          adapterVersion: 1,
          sourceIndex: 0,
          kind: "TEST_ACTION",
        }),
        adapterId: "test-adapter",
        adapterVersion: 1,
        chain: source.chain,
        leaderWallet: source.leaderWallet,
        sourceTransactionId: source.id,
        sourceSignature: source.signature,
        sourceIndex: 0,
        kind: "TEST_ACTION",
        actionability: "actionable",
        confidence: 1,
        createdAt: source.observedAt,
        payload: {},
      };
      return [intent];
    },
    async plan(intent, subscription) {
      const jobId = `${intent.id}:${encodeURIComponent(subscription.id)}`;
      return {
        id: copyPlanId(jobId),
        adapterId: "test-adapter",
        adapterVersion: 1,
        chain: intent.chain,
        intentId: intent.id,
        subscriptionId: subscription.id,
        followerWallet: subscription.followerWallet,
        action: "TEST_EXECUTE",
        createdAt: new Date().toISOString(),
        payload: {},
      };
    },
  };
}

const subscription: CopySubscription = {
  id: "subscription-1",
  chain: "solana",
  leaderWallet: "Leader111111111111111111111111111111111111",
  followerWallet: "Follower1111111111111111111111111111111111",
  enabled: true,
  createdAt: new Date().toISOString(),
  settings: {},
};

test("deduplicates observations and executes one copy job", async () => {
  const store = new MemoryCopyStore();
  await store.upsertSubscription(subscription);
  let executions = 0;
  const executor: CopyExecutor = {
    async execute() {
      executions += 1;
      return {
        status: "confirmed",
        transactionId: "follower-signature",
        submittedAt: new Date().toISOString(),
      };
    },
  };
  const engine = new CopyEngine({
    store,
    adapters: [adapter()],
    executor,
  });

  const first = await engine.handle(transaction("signature-1"));
  const second = await engine.handle(transaction("signature-1"));

  assert.equal(first.accepted, true);
  assert.equal(first.jobIds.length, 1);
  assert.equal(second.duplicate, true);
  assert.equal(executions, 1);
  const job = await store.getJob(first.jobIds[0]);
  assert.equal(job?.status, "CONFIRMED");
  assert.deepEqual(
    job?.history.map((entry) => entry.status),
    ["DETECTED", "VALIDATING", "PLANNING", "READY", "EXECUTING", "CONFIRMED"],
  );
});

test("rejects a mentioned wallet that did not sign", async () => {
  const store = new MemoryCopyStore();
  await store.upsertSubscription(subscription);
  let executions = 0;
  const engine = new CopyEngine({
    store,
    adapters: [adapter()],
    executor: {
      async execute() {
        executions += 1;
        return { status: "simulated", submittedAt: new Date().toISOString() };
      },
    },
  });

  const result = await engine.handle(
    transaction("spoofed-signature", { leaderSigned: false }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "LEADER_DID_NOT_SIGN");
  assert.equal(result.jobIds.length, 0);
  assert.equal(executions, 0);
});

test("serializes execution for jobs sharing a follower wallet", async () => {
  const store = new MemoryCopyStore();
  await store.upsertSubscription(subscription);
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const engine = new CopyEngine({
    store,
    adapters: [adapter()],
    executor: {
      async execute({ transaction: source }) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(`start:${source.signature}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end:${source.signature}`);
        active -= 1;
        return { status: "simulated", submittedAt: new Date().toISOString() };
      },
    },
  });

  const first = engine.handle(transaction("signature-a"));
  await Promise.resolve();
  const second = engine.handle(transaction("signature-b"));
  await Promise.all([first, second]);

  assert.equal(maxActive, 1);
  assert.deepEqual(order, [
    "start:signature-a",
    "end:signature-a",
    "start:signature-b",
    "end:signature-b",
  ]);
});
