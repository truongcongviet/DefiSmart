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

/** A token the user can deposit, with a local logo under `public/logos`. */
export interface TokenBrand {
  symbol: string;
  name: string;
  logo: string;
}

export const TOKENS = {
  SOL: { symbol: "SOL", name: "Solana", logo: "/logos/tokens/sol.png" },
  ETH: { symbol: "ETH", name: "Ether", logo: "/logos/tokens/eth.png" },
  USDG: {
    symbol: "USDG",
    name: "Global Dollar",
    logo: "/logos/tokens/usdg.png",
  },
} as const satisfies Record<string, TokenBrand>;

export interface NetworkInfo {
  id: AccountNetwork;
  label: string;
  /** Square chain logo served from `public/logos/chains`. */
  logo: string;
  chainType: AgentChainType;
  nativeToken: string;
  /** Human sentence fragment, e.g. "ETH or USDG". */
  fundingTokens: string;
  /** Same tokens as `fundingTokens`, with logos, for UI chips. */
  fundingTokenList: TokenBrand[];
  protocols: string;
  recommendedDeposit: string;
  walletHint: string;
  explorerAddressUrl: (address: string) => string;
}

export const NETWORKS: Record<AccountNetwork, NetworkInfo> = {
  solana: {
    id: "solana",
    label: "Solana",
    logo: "/logos/chains/solana.png",
    chainType: "solana",
    nativeToken: "SOL",
    fundingTokens: "SOL",
    fundingTokenList: [TOKENS.SOL],
    protocols: "Meteora DLMM · DAMM v2",
    recommendedDeposit: "5 SOL",
    walletHint: "Phantom · Solflare · WalletConnect",
    explorerAddressUrl: (address) => `https://solscan.io/account/${address}`,
  },
  robinhood: {
    id: "robinhood",
    label: "Robinhood Chain",
    logo: "/logos/chains/robinhood.svg",
    chainType: "ethereum",
    nativeToken: "ETH",
    fundingTokens: "ETH or USDG",
    fundingTokenList: [TOKENS.ETH, TOKENS.USDG],
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
