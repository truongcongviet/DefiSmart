import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSolanaTransaction } from "./normalize";
import type { SolanaRpcTransaction } from "./types";

const leader = "Leader111111111111111111111111111111111111";
const tokenAccount = "TokenAccount1111111111111111111111111111111";
const mint = "Mint11111111111111111111111111111111111111";

test("normalizes signer, program ids and leader asset deltas", () => {
  const raw: SolanaRpcTransaction = {
    slot: 42,
    blockTime: 1_700_000_000,
    transaction: {
      signatures: ["source-signature"],
      message: {
        accountKeys: [
          { pubkey: leader, signer: true, writable: true },
          { pubkey: tokenAccount, signer: false, writable: true },
        ],
        instructions: [{ programId: "OuterProgram111" }],
      },
    },
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [10_000_000_000, 2_039_280],
      postBalances: [8_999_995_000, 2_039_280],
      preTokenBalances: [
        {
          accountIndex: 1,
          mint,
          owner: leader,
          uiTokenAmount: { amount: "0", decimals: 6 },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 1,
          mint,
          owner: leader,
          uiTokenAmount: { amount: "2500000", decimals: 6 },
        },
      ],
      innerInstructions: [
        { index: 0, instructions: [{ programId: "InnerProgram111" }] },
      ],
    },
  };

  const normalized = normalizeSolanaTransaction(raw, {
    leaderWallet: leader,
    commitment: "confirmed",
    observedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(normalized.leaderSigned, true);
  assert.equal(normalized.success, true);
  assert.deepEqual(normalized.programIds, [
    "OuterProgram111",
    "InnerProgram111",
  ]);
  assert.deepEqual(normalized.assetDeltas, [
    {
      assetId: "SOL",
      assetType: "native",
      decimals: 9,
      owner: leader,
      rawDelta: "-1000005000",
    },
    {
      assetId: mint,
      assetType: "token",
      decimals: 6,
      owner: leader,
      rawDelta: "2500000",
      tokenAccounts: [tokenAccount],
    },
  ]);
});

test("does not trust an address that is present but is not a signer", () => {
  const raw: SolanaRpcTransaction = {
    slot: 1,
    blockTime: null,
    transaction: {
      signatures: ["source-signature"],
      message: {
        accountKeys: [
          {
            pubkey: "ActualSigner1111111111111111111111111111111",
            signer: true,
            writable: true,
          },
          { pubkey: leader, signer: false, writable: false },
        ],
        instructions: [],
      },
    },
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [1_000_000, 0],
      postBalances: [995_000, 0],
    },
  };

  const normalized = normalizeSolanaTransaction(raw, {
    leaderWallet: leader,
    commitment: "confirmed",
  });

  assert.equal(normalized.leaderSigned, false);
});
