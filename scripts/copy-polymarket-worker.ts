/**
 * Polymarket copy worker: watches the leaders of every enabled Polygon
 * subscription, turns their fills into sized orders for each follower agent
 * and posts them (dry-run unless the subscription says "live" and
 * COPY_FORCE_DRY_RUN is not set).
 *
 * Usage: pnpm copy:polymarket
 * Env:   DATABASE_URL, COPY_KEY_SECRET, POLYGON_RPC_URL (default public),
 *        COPY_FORCE_DRY_RUN=1, COPY_POLL_MS (default 4000)
 */
import { CopyEngine } from "../src/lib/copy-engine/engine";
import { PgCopyStore } from "../src/lib/copy-engine/pg-store";
import { PolymarketTradeAdapter } from "../src/lib/copy-engine/polymarket/adapter";
import { agentAccount } from "../src/lib/copy-engine/polymarket/agent-wallet";
import { PolymarketClobExecutor } from "../src/lib/copy-engine/polymarket/executor";
import {
  PolymarketBudgetGuard,
  PolymarketCategoryGuard,
  PolymarketFreshnessGuard,
} from "../src/lib/copy-engine/polymarket/guards";
import type { PolymarketPlanPayload } from "../src/lib/copy-engine/polymarket/types";
import { PolymarketActivityWatcher } from "../src/lib/copy-engine/polymarket/watcher";
import type { CopyExecutor } from "../src/lib/copy-engine/ports";
import { categorize } from "../src/lib/predict/metrics";
import { fetchOpenPositions } from "../src/lib/predict/polymarket-api";

const CHAIN = "polygon";
const REFRESH_MS = 30_000;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const log = (message: string) =>
  console.info(`[copy-polymarket] ${new Date().toISOString()} ${message}`);

/** Open-position lookup shared by the adapter (leader and follower sides). */
const positionCache = new Map<
  string,
  { at: number; rows: Map<string, number> }
>();
async function sharesHeld(wallet: string, tokenId: string) {
  const key = wallet.toLowerCase();
  const cached = positionCache.get(key);
  if (!cached || Date.now() - cached.at > 15_000) {
    const { rows } = await fetchOpenPositions(key, 300).catch(() => ({
      rows: [],
    }));
    positionCache.set(key, {
      at: Date.now(),
      rows: new Map(rows.map((r) => [r.asset, Number(r.size) || 0])),
    });
  }
  return positionCache.get(key)?.rows.get(tokenId) ?? 0;
}

/** One executor per follower agent, routed by the plan's follower wallet. */
class RoutingExecutor implements CopyExecutor {
  constructor(
    private readonly executors: Map<string, PolymarketClobExecutor>,
  ) {}
  async execute(input: Parameters<CopyExecutor["execute"]>[0]) {
    const executor = this.executors.get(
      input.plan.followerWallet.toLowerCase(),
    );
    if (!executor)
      throw new Error(`No agent key for follower ${input.plan.followerWallet}`);
    return executor.execute(input);
  }
}

async function main() {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const secret = requiredEnv("COPY_KEY_SECRET");
  const rpcUrl =
    process.env.POLYGON_RPC_URL?.trim() || "https://polygon-rpc.com";
  const forceDryRun = process.env.COPY_FORCE_DRY_RUN === "1";
  const pollMs = Number(process.env.COPY_POLL_MS) || 4_000;

  const store = await PgCopyStore.open(databaseUrl);
  const executors = new Map<string, PolymarketClobExecutor>();
  const engine = new CopyEngine({
    store,
    adapters: [
      new PolymarketTradeAdapter({
        follower: { sharesHeld },
        leader: { sharesHeld },
      }),
    ],
    guards: [
      new PolymarketFreshnessGuard(90_000),
      new PolymarketBudgetGuard((id, since) =>
        store.sumCommittedUsd(id, since),
      ),
      new PolymarketCategoryGuard((trade) =>
        categorize({ ...trade, icon: trade.icon ?? undefined }),
      ),
    ],
    executor: new RoutingExecutor(executors),
  });

  let watcher: PolymarketActivityWatcher | null = null;
  let watchedLeaders = "";

  async function syncSubscriptions() {
    const subscriptions = await store.listEnabledByChain(CHAIN);
    // Executors for every follower agent we have a key for.
    for (const subscription of subscriptions) {
      const follower = subscription.followerWallet.toLowerCase();
      if (executors.has(follower)) continue;
      const agent = await store.getAgentByAddress(follower);
      if (!agent) {
        log(
          `no agent key for ${follower}; its subscriptions will fail at execution`,
        );
        continue;
      }
      executors.set(
        follower,
        new PolymarketClobExecutor({
          account: agentAccount(agent.keyBlob, secret),
          rpcUrl,
          forceDryRun,
          onLog: log,
        }),
      );
    }
    const leaders = Array.from(
      new Set(subscriptions.map((s) => s.leaderWallet.toLowerCase())),
    ).sort();
    const signature = leaders.join(",");
    if (signature === watchedLeaders) return;
    watchedLeaders = signature;
    await watcher?.stop();
    watcher = null;
    if (leaders.length === 0) {
      log("no enabled subscriptions; idle");
      return;
    }
    watcher = new PolymarketActivityWatcher({
      leaders,
      pollIntervalMs: pollMs,
      onError: (error) =>
        console.error(
          "[copy-polymarket] watcher error",
          error instanceof Error ? error.message : error,
        ),
      onLog: log,
    });
    await watcher.start(async (transaction) => {
      const result = await engine.handle(transaction);
      const trade = transaction.raw as {
        side: string;
        usdcSize: number;
        title: string;
      };
      log(
        `${transaction.leaderWallet.slice(0, 8)} ${trade.side} $${trade.usdcSize.toFixed(2)} ${trade.title} → intents ${result.intentIds.length}, jobs ${result.jobIds.length}${result.reason ? `, ${result.reason}` : ""}${result.errors.length ? `, errors ${result.errors.join("; ")}` : ""}`,
      );
      for (const jobId of result.jobIds) {
        const job = await store.getJob(jobId);
        if (!job) continue;
        const plan = job.plan?.payload as PolymarketPlanPayload | undefined;
        log(
          `  job ${job.status}${job.reason ? ` (${job.reason})` : ""}${plan ? ` ${plan.side} ${plan.amount} ${plan.mode}` : ""}`,
        );
      }
    });
    log(
      `subscriptions ${subscriptions.length}, leaders ${leaders.length}, agents ${executors.size}, ${forceDryRun ? "FORCED DRY-RUN" : "live allowed per subscription"}`,
    );
  }

  await syncSubscriptions();
  const timer = setInterval(
    () =>
      void syncSubscriptions().catch((error) =>
        console.error("[copy-polymarket] sync error", error),
      ),
    REFRESH_MS,
  );

  const shutdown = async () => {
    clearInterval(timer);
    await watcher?.stop();
    await store.close();
    log("stopped");
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
