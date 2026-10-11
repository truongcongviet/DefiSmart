import path from "node:path";

import {
  CopyEngine,
  DryRunCopyExecutor,
  JsonFileCopyStore,
} from "../src/lib/copy-engine";
import {
  normalizeSolanaTransaction,
  SolanaLogsWatcher,
  SolanaRpcClient,
  SolanaWalletEffectAdapter,
} from "../src/lib/copy-engine/solana";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function main() {
  const rpcUrl = requiredEnv("SOLANA_RPC_URL");
  const wsUrl = process.env.SOLANA_WS_URL?.trim() || toWebSocketUrl(rpcUrl);
  const leaders = requiredEnv("COPY_LEADER_WALLETS")
    .split(",")
    .map((wallet) => wallet.trim())
    .filter(Boolean);
  const invalidLeaders = leaders.filter(
    (wallet) => !SOLANA_ADDRESS.test(wallet),
  );
  if (invalidLeaders.length > 0) {
    throw new Error(
      `Invalid Solana leader address: ${invalidLeaders.join(", ")}`,
    );
  }

  const follower = process.env.COPY_FOLLOWER_WALLET?.trim();
  if (follower && !SOLANA_ADDRESS.test(follower)) {
    throw new Error("COPY_FOLLOWER_WALLET is not a valid Solana address");
  }

  const stateFile = path.resolve(
    process.cwd(),
    process.env.COPY_STATE_FILE?.trim() || "data/copy-engine/state.json",
  );
  const store = await JsonFileCopyStore.open(stateFile);
  const adapter = new SolanaWalletEffectAdapter();
  const engine = new CopyEngine({
    store,
    adapters: [adapter],
    executor: new DryRunCopyExecutor(),
  });

  if (follower) {
    for (const leader of leaders) {
      await store.upsertSubscription({
        id: `solana:${leader}:${follower}`,
        chain: "solana",
        leaderWallet: leader,
        followerWallet: follower,
        enabled: true,
        createdAt: new Date().toISOString(),
        settings: { mode: "observe-only" },
      });
    }
  }

  const rpc = new SolanaRpcClient({
    httpUrl: rpcUrl,
    commitment: "confirmed",
    maxSupportedTransactionVersion: numberEnv(
      "SOLANA_MAX_TRANSACTION_VERSION",
      1,
    ),
  });
  const watcher = new SolanaLogsWatcher({
    wsUrl,
    leaders,
    commitment: "confirmed",
    onError: (error) => {
      console.error("[copy-worker] watcher error", error);
    },
  });

  await watcher.start(async (notification) => {
    const raw = await rpc.getTransaction(notification.signature);
    if (!raw) {
      console.warn(
        `[copy-worker] transaction unavailable after retries: ${notification.signature}`,
      );
      return;
    }

    const transaction = normalizeSolanaTransaction(raw, {
      leaderWallet: notification.leaderWallet,
      commitment: "confirmed",
    });
    const result = await engine.handle(transaction);

    console.info(
      JSON.stringify({
        type: "copy-engine-result",
        leader: notification.leaderWallet,
        signature: notification.signature,
        slot: notification.slot,
        accepted: result.accepted,
        duplicate: result.duplicate,
        reason: result.reason,
        intents: result.intentIds.length,
        jobs: result.jobIds.length,
        errors: result.errors,
      }),
    );
  });

  console.info(
    `[copy-worker] watching ${leaders.length} leader wallet(s) at confirmed commitment`,
  );
  console.info(`[copy-worker] state: ${stateFile}`);
  console.info(
    follower
      ? "[copy-worker] follower is observe-only; execution adapter is intentionally disabled"
      : "[copy-worker] no follower configured; recording observations and intents only",
  );

  const shutdown = async () => {
    console.info("[copy-worker] shutting down");
    await watcher.stop();
    await store.close();
    process.exitCode = 0;
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function numberEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function toWebSocketUrl(httpUrl: string) {
  const url = new URL(httpUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error("SOLANA_RPC_URL must use http or https");
  return url.toString();
}

main().catch((error) => {
  console.error(
    "[copy-worker] fatal",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
