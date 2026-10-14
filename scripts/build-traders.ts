/**
 * Build (incrementally) the Smart Traders snapshot from on-chain swaps.
 * Usage: pnpm traders:build [tokens] [sigsPerPair]
 * Env:   TRADER_TOKENS, TRADER_PAIRS_PER_TOKEN, TRADER_SIGS_PER_PAIR,
 *        TRADER_MAX_TX, TRADER_WALLETS, TRADER_WALLET_TX, SOLANA_TX_RPC_URL,
 *        DATABASE_URL
 */
import {
  refreshTraderSnapshot,
  toBoard,
} from "../src/lib/traders/smart-trader-leaderboard";

const tokens = Number(process.argv[2]) || undefined;
const sigsPerPair = Number(process.argv[3]) || undefined;

refreshTraderSnapshot({
  budget: { tokens, sigsPerPair },
  onProgress: (message) => console.log(`  ${message}`),
})
  .then((snapshot) => {
    const board = toBoard(snapshot);
    const s = snapshot.stats;
    console.log(
      `traders: ${board.wallets.length} ranked / ${board.walletsSeen} seen, ${s.swapsTotal} swaps across ${snapshot.tokens.length} tokens, ${Object.keys(snapshot.walletScans).length} wallets with full history (${s.walletsExpanded} this run; ${s.txFetched} tx fetched in ${(s.durationMs / 1000).toFixed(0)}s, store=${board.store})`,
    );
    for (const w of board.wallets.slice(0, 8)) {
      console.log(
        `  ${w.owner.slice(0, 8)} score=${w.score} pnl=$${w.totalPnlUsd.toFixed(0)} win=${(w.winRate * 100).toFixed(0)}% tokens=${w.tokensTraded} hold=${w.medianHoldMinutes?.toFixed(0) ?? "-"}m ${w.coverage} flags=${w.flags.join(",") || "-"}`,
      );
    }
    if (snapshot.warnings.length) console.log("warnings:", snapshot.warnings);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
