/**
 * One-time on-chain approvals for a copy agent so Polymarket's exchanges can
 * move its USDC.e and outcome tokens. Needs a little POL in the agent wallet.
 * Usage: pnpm copy:approve <agent address>
 */
import { PgCopyStore } from "../src/lib/copy-engine/pg-store";
import { agentAccount } from "../src/lib/copy-engine/polymarket/agent-wallet";
import { PolymarketClobExecutor } from "../src/lib/copy-engine/polymarket/executor";

async function main() {
  const address = process.argv[2];
  if (!address) throw new Error("usage: copy-agent-approve <agent address>");
  const store = await PgCopyStore.open(process.env.DATABASE_URL ?? "");
  const agent = await store.getAgentByAddress(address);
  if (!agent) throw new Error("agent not found");
  const executor = new PolymarketClobExecutor({
    account: agentAccount(agent.keyBlob, process.env.COPY_KEY_SECRET ?? ""),
    rpcUrl: process.env.POLYGON_RPC_URL?.trim() || "https://polygon-rpc.com",
    onLog: (m) => console.log(m),
  });
  const hashes = await executor.ensureApprovals();
  console.log(
    hashes.length ? `approvals sent: ${hashes.join(", ")}` : "already approved",
  );
  console.log(
    `CLOB collateral balance: ${await executor.collateralBalance()} USDC`,
  );
  await store.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
