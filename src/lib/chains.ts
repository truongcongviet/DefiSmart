import { defineChain } from "viem";

/**
 * Robinhood Chain mainnet (Arbitrum Nitro L2, gas paid in ETH).
 * Public RPC is rate limited and meant for wallet connectivity only.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

/**
 * An account is bound to exactly one network. The agent wallet is created on
 * that network and positions can only be opened there.
 */
export type AccountNetwork = "solana" | "robinhood";

export type AgentChainType = "solana" | "ethereum";

export interface NetworkInfo {
  id: AccountNetwork;
  label: string;
  chainType: AgentChainType;
  nativeToken: string;
  fundingTokens: string;
  protocols: string;
  recommendedDeposit: string;
  walletHint: string;
  explorerAddressUrl: (address: string) => string;
}

export const NETWORKS: Record<AccountNetwork, NetworkInfo> = {
  solana: {
    id: "solana",
    label: "Solana",
    chainType: "solana",
    nativeToken: "SOL",
    fundingTokens: "SOL",
    protocols: "Meteora DLMM · DAMM v2",
    recommendedDeposit: "5 SOL",
    walletHint: "Phantom · Solflare · WalletConnect",
    explorerAddressUrl: (address) => `https://solscan.io/account/${address}`,
  },
  robinhood: {
    id: "robinhood",
    label: "Robinhood Chain",
    chainType: "ethereum",
    nativeToken: "ETH",
    fundingTokens: "ETH or USDG",
    protocols: "Uniswap V3 · V4",
    recommendedDeposit: "0.08 ETH",
    walletHint: "MetaMask · Rabby · WalletConnect",
    explorerAddressUrl: (address) =>
      `${robinhoodChain.blockExplorers.default.url}/address/${address}`,
  },
};

export const NETWORK_LIST: NetworkInfo[] = [
  NETWORKS.solana,
  NETWORKS.robinhood,
];

export function networkFromChainType(
  chainType: string | undefined,
): AccountNetwork | null {
  if (chainType === "solana") {
    return "solana";
  }

  if (chainType === "ethereum") {
    return "robinhood";
  }

  return null;
}
