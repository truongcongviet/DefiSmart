/**
 * Build the PredictSmart (Polymarket) leaderboard snapshot.
 * Usage: pnpm predict:build [traders]
 * Env:   PREDICT_TRADERS, PREDICT_CLOSED_ROWS, DATABASE_URL
 */
import { refreshPredictSnapshot } from "../src/lib/predict/smart-predict-leaderboard";

const traders = Number(process.argv[2]) || undefined;

refreshPredictSnapshot({
  budget: { traders },
  onProgress: (message) => console.log(`  ${message}`),
})
  .then((snapshot) => {
    const s = snapshot.stats;
    console.log(
      `predict: ${s.ranked} ranked / ${s.analysed} analysed of ${s.candidates} candidates (${s.failed} failed) in ${(s.durationMs / 1000).toFixed(0)}s`,
    );
    for (const t of snapshot.traders.slice(0, 8)) {
      console.log(
        `  ${t.name.padEnd(18)} score=${t.score} win=${(t.winRate * 100).toFixed(0)}% (${t.wins}/${t.markets}) pnl=$${t.realizedPnlUsd.toFixed(0)} roi=${(t.roi * 100).toFixed(0)}% pf=${t.profitFactor?.toFixed(2) ?? "-"} flags=${t.flags.join(",") || "-"}`,
      );
    }
    if (snapshot.warnings.length) console.log("warnings:", snapshot.warnings);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
