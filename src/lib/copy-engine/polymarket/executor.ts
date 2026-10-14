import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  Side,
  SignatureType,
  getContractConfig,
  type ApiKeyCreds,
} from "@polymarket/clob-client";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  maxUint256,
  parseAbi,
  type Account,
} from "viem";
import { polygon } from "viem/chains";

import type { CopyExecutor } from "../ports";
import type { ExecutionReceipt } from "../types";
import type { PolymarketPlanPayload } from "./types";

/**
 * Posts copied orders to the Polymarket CLOB from the agent's own EOA
 * (signature type EOA: the key both signs and funds, no proxy wallet). Market
 * orders are fill-or-kill so a partial copy never lingers. In dry-run mode
 * the order is built and logged but not posted.
 */

const CLOB_HOST = "https://clob.polymarket.com";
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const ERC1155_ABI = parseAbi([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

export interface PolymarketExecutorOptions {
  account: Account;
  rpcUrl: string;
  /** Cached CLOB credentials; derived from the key on first use otherwise. */
  creds?: ApiKeyCreds;
  /** Force dry-run regardless of plan mode (safety switch). */
  forceDryRun?: boolean;
  onLog?: (message: string) => void;
}

export class PolymarketClobExecutor implements CopyExecutor {
  private client: ClobClient | null = null;
  private creds: ApiKeyCreds | undefined;

  constructor(private readonly options: PolymarketExecutorOptions) {
    this.creds = options.creds;
  }

  get address() {
    return this.options.account.address;
  }

  private walletClient() {
    return createWalletClient({
      account: this.options.account,
      chain: polygon,
      transport: http(this.options.rpcUrl),
    });
  }

  /** Builds (and caches) an authenticated CLOB client for the agent key. */
  async getClient(): Promise<ClobClient> {
    if (this.client) return this.client;
    const wallet = this.walletClient();
    if (!this.creds) {
      const l1 = new ClobClient(CLOB_HOST, Chain.POLYGON, wallet);
      this.creds = await l1.createOrDeriveApiKey();
      this.options.onLog?.(
        `derived CLOB api key ${this.creds.key.slice(0, 8)}… for ${this.address}`,
      );
    }
    this.client = new ClobClient(
      CLOB_HOST,
      Chain.POLYGON,
      wallet,
      this.creds,
      SignatureType.EOA,
      this.address,
    );
    return this.client;
  }

  /** USDC.e balance (collateral) as seen by the CLOB, in USDC. */
  async collateralBalance(): Promise<number> {
    const client = await this.getClient();
    const result = await client.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });
    return Number(result.balance) / 1e6;
  }

  /**
   * One-time on-chain approvals so the exchanges can move the agent's USDC.e
   * and outcome tokens. Costs a little POL in gas; idempotent.
   */
  async ensureApprovals(): Promise<string[]> {
    const config = getContractConfig(Chain.POLYGON);
    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(this.options.rpcUrl),
    });
    const wallet = this.walletClient();
    const owner = this.address;
    const hashes: string[] = [];
    const spenders = [
      config.exchange,
      config.negRiskExchange,
      config.negRiskAdapter,
    ] as `0x${string}`[];

    for (const spender of spenders) {
      const allowance = await publicClient.readContract({
        address: config.collateral as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [owner, spender],
      });
      if (allowance < maxUint256 / BigInt(2)) {
        const hash = await wallet.sendTransaction({
          to: config.collateral as `0x${string}`,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [spender, maxUint256],
          }),
        });
        hashes.push(hash);
      }
      const approved = await publicClient.readContract({
        address: config.conditionalTokens as `0x${string}`,
        abi: ERC1155_ABI,
        functionName: "isApprovedForAll",
        args: [owner, spender],
      });
      if (!approved) {
        const hash = await wallet.sendTransaction({
          to: config.conditionalTokens as `0x${string}`,
          data: encodeFunctionData({
            abi: ERC1155_ABI,
            functionName: "setApprovalForAll",
            args: [spender, true],
          }),
        });
        hashes.push(hash);
      }
    }
    for (const hash of hashes) {
      await publicClient.waitForTransactionReceipt({
        hash: hash as `0x${string}`,
      });
    }
    return hashes;
  }

  async execute(
    input: Parameters<CopyExecutor["execute"]>[0],
  ): Promise<ExecutionReceipt> {
    const plan = input.plan.payload as PolymarketPlanPayload;
    const submittedAt = new Date().toISOString();
    const dryRun = this.options.forceDryRun || plan.mode !== "live";
    const label = `${plan.side} ${plan.side === "BUY" ? `$${plan.amount}` : `${plan.amount} sh`} ${plan.title} @${plan.referencePrice}`;

    if (dryRun) {
      this.options.onLog?.(`[dry-run] ${label}`);
      return {
        status: "simulated",
        submittedAt,
        metadata: { dryRun: true, plan, follower: this.address },
      };
    }

    const client = await this.getClient();
    const tickSize = await client.getTickSize(plan.tokenId);
    const negRisk = await client.getNegRisk(plan.tokenId);
    const response = await client.createAndPostMarketOrder(
      {
        tokenID: plan.tokenId,
        amount: plan.amount,
        side: plan.side === "BUY" ? Side.BUY : Side.SELL,
      },
      { tickSize, negRisk },
      OrderType.FOK,
    );
    const orderId =
      typeof response?.orderID === "string" ? response.orderID : undefined;
    const success = response?.success !== false && !response?.error;
    this.options.onLog?.(
      `[live] ${label} → ${success ? `order ${orderId ?? "?"}` : `rejected: ${JSON.stringify(response).slice(0, 200)}`}`,
    );
    if (!success) {
      throw new Error(
        `CLOB rejected order: ${response?.errorMsg ?? response?.error ?? "unknown"}`,
      );
    }
    return {
      status: "submitted",
      transactionId: orderId,
      submittedAt,
      metadata: { plan, response },
    };
  }
}
