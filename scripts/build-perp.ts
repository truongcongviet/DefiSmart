/**
 * Build the PredictSmart Perp (Polymarket Perps) leaderboard snapshot.
 * Usage: pnpm perp:build [traders]
 * Env:   PERP_TRADERS, PERP_FILL_PAGES, DATABASE_URL
 */
import { refreshPerpSnapshot } from "../src/lib/predict/smart-perp-leaderboard";

const traders = Number(process.argv[2]) || undefined;

refreshPerpSnapshot({
  budget: { traders },
  onProgress: (m) => console.log(`  ${m}`),
})
  .then((snapshot) => {
    const s = snapshot.stats;
    console.log(
      `perp: ${s.ranked} ranked / ${s.analysed} analysed of ${s.candidates} candidates (${s.failed} failed) in ${(s.durationMs / 1000).toFixed(0)}s; ${snapshot.wins.length} big wins`,
    );
    for (const t of snapshot.traders.slice(0, 8)) {
      console.log(
        `  ${t.address.slice(0, 10)} score=${t.score} win=${(t.winRate * 100).toFixed(0)}% (${t.wins}/${t.closedTrades}) pnl30d=$${t.pnl30dUsd.toFixed(0)} realized=$${t.realizedPnlUsd.toFixed(0)} pf=${t.profitFactor?.toFixed(2) ?? "-"} days+=${t.positiveDays}/${t.days} dd=$${t.maxDrawdownUsd.toFixed(0)} flags=${t.flags.join(",") || "-"}`,
      );
    }
    if (snapshot.warnings.length) console.log("warnings:", snapshot.warnings);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
