/**
 * Precompute the Smart LP leaderboard into data/smart-lp-leaderboard.json.
 * Usage: yarn leaderboard:build [pools]
 */
import { getSmartLpLeaderboard } from "../src/lib/api/smart-lp-leaderboard";

const pools = Number(process.argv[2]) || undefined;
getSmartLpLeaderboard({ force: true, pools })
  .then((board) => {
    console.log(
      `leaderboard: ${board.wallets.length} wallets from ${board.poolsScanned}/${board.poolsRequested} pools (${board.walletsSeen} seen)`,
    );
    for (const w of board.wallets.slice(0, 5)) {
      console.log(
        `  ${w.owner.slice(0, 8)} score=${w.score} pnl=${w.pnlNative.toFixed(2)} SOL win=${(w.winRate * 100).toFixed(0)}% pools=${w.poolCount}`,
      );
    }
    if (board.warnings.length) console.log("warnings:", board.warnings);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
