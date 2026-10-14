import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { JsonTransaction } from "../api/solana-rpc";
import { buildLedgers, scoreTrader, summarizeWallet, valueLedger } from "./pnl";
import { extractSwaps, WSOL_MINT, type SwapEvent } from "./swaps";

const FARTCOIN = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const TRADER = "CreQJ2t94QK5dsxUZGXfPJ8Nx7wA9LHr5chxjSMkbNft";

function fixture(name: string): JsonTransaction {
  return JSON.parse(
    readFileSync(path.join(__dirname, "__fixtures__", `${name}.json`), "utf8"),
  ) as JsonTransaction;
}

test("extractSwaps reads a Raydium buy from balance deltas", () => {
  const [swap, ...rest] = extractSwaps(fixture("swap-buy"), {
    solPriceUsd: 100,
  });
  assert.equal(rest.length, 0);
  assert.equal(swap.wallet, TRADER);
  assert.equal(swap.mint, FARTCOIN);
  assert.equal(swap.side, "buy");
  assert.equal(swap.quoteMint, WSOL_MINT);
  assert.ok(swap.tokenAmount > 0);
  assert.ok(swap.quoteAmount > 0.1);
  assert.ok(Math.abs(swap.quoteUsd - swap.quoteAmount * 100) < 1e-9);
  assert.ok(swap.priceUsd > 0);
});

test("extractSwaps reads a Raydium sell", () => {
  const [swap] = extractSwaps(fixture("swap-sell"), { solPriceUsd: 100 });
  assert.equal(swap.side, "sell");
  assert.equal(swap.wallet, TRADER);
  assert.ok(swap.tokenAmount > 1000);
  assert.ok(swap.quoteAmount > 1);
});

test("extractSwaps ignores transactions that move no tokens for the signer", () => {
  assert.deepEqual(extractSwaps(fixture("non-swap"), { solPriceUsd: 100 }), []);
});

test("extractSwaps honours the mint filter", () => {
  assert.deepEqual(
    extractSwaps(fixture("swap-buy"), { solPriceUsd: 100, mint: "NotTheMint" }),
    [],
  );
});

function event(
  partial: Partial<SwapEvent> &
    Pick<SwapEvent, "side" | "tokenAmount" | "quoteUsd" | "blockTime">,
): SwapEvent {
  return {
    signature: `sig-${partial.blockTime}-${partial.side}`,
    slot: partial.blockTime,
    wallet: "W",
    mint: "M",
    tokenDecimals: 6,
    quoteMint: WSOL_MINT,
    quoteAmount: partial.quoteUsd / 100,
    priceUsd: partial.quoteUsd / partial.tokenAmount,
    ...partial,
  };
}

test("buildLedgers applies FIFO and tracks unmatched sells", () => {
  const [ledger] = buildLedgers([
    event({ side: "buy", tokenAmount: 100, quoteUsd: 100, blockTime: 1000 }),
    event({ side: "buy", tokenAmount: 100, quoteUsd: 300, blockTime: 2000 }),
    event({ side: "sell", tokenAmount: 150, quoteUsd: 450, blockTime: 3800 }),
    event({ side: "sell", tokenAmount: 100, quoteUsd: 100, blockTime: 4000 }),
  ]);
  // First 100 cost 100, next 50 cost 150 → cost 250, proceeds 450 → +200.
  // Second sell: 50 matched at cost 150 for proceeds 50 → -100; 50 untracked.
  assert.equal(ledger.buys, 2);
  assert.equal(ledger.sells, 2);
  assert.equal(ledger.realizedPnlUsd, 100);
  assert.equal(ledger.untrackedSoldTokens, 50);
  assert.equal(ledger.remainingTokens, 0);
  assert.equal(ledger.earlyRank, 1);
  assert.ok(ledger.avgHoldMinutes != null && ledger.avgHoldMinutes > 0);
});

test("valueLedger marks remaining tokens to market", () => {
  const [ledger] = buildLedgers([
    event({ side: "buy", tokenAmount: 10, quoteUsd: 50, blockTime: 10 }),
  ]);
  const valued = valueLedger(ledger, 8);
  assert.equal(valued.unrealizedPnlUsd, 30);
  assert.equal(valued.totalPnlUsd, 30);
  assert.equal(valued.closed, false);
});

test("summarizeWallet + scoreTrader penalise snipers and reward breadth", () => {
  const created = { A: 0, B: 0, C: 0 };
  const swaps: SwapEvent[] = [];
  for (const mint of ["A", "B", "C"]) {
    swaps.push(
      event({
        mint,
        side: "buy",
        tokenAmount: 100,
        quoteUsd: 100,
        blockTime: 10,
      }),
      event({
        mint,
        side: "sell",
        tokenAmount: 100,
        quoteUsd: 200,
        blockTime: 7200,
      }),
    );
  }
  const ledgers = buildLedgers(swaps, { pairCreatedAt: created }).map((l) =>
    valueLedger(l, null),
  );
  const sniper = summarizeWallet("W", ledgers, () => ({
    symbol: "X",
    name: "X",
    logo: null,
  }));
  assert.equal(sniper.tokensTraded, 3);
  assert.equal(sniper.winRate, 1);
  assert.equal(sniper.realizedPnlUsd, 300);
  assert.ok(sniper.flags.includes("sniper"));

  const late = buildLedgers(
    swaps.map((s) => ({ ...s, blockTime: s.blockTime + 86_400 })),
    { pairCreatedAt: created },
  ).map((l) => valueLedger(l, null));
  const human = summarizeWallet("W", late, () => ({
    symbol: "X",
    name: "X",
    logo: null,
  }));
  assert.ok(!human.flags.includes("sniper"));
  assert.ok(scoreTrader(human, 300) > scoreTrader(sniper, 300));
});
