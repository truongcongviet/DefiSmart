import { polygon } from "viem/chains";

/**
 * Polygon PoS mainnet: where Polymarket settles prediction markets (USDC.e,
 * CTF outcome tokens, CLOB exchanges) and perps (pUSD). Agent wallets that
 * copy Polymarket positions live here.
 */
export const polygonChain = polygon;

/**
 * An account is bound to exactly one network. The agent wallet is created on
 * that network and positions can only be opened there.
 */
export type AccountNetwork = "solana" | "polygon";

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
  USDC: { symbol: "USDC", name: "USD Coin", logo: "/logos/tokens/usdc.png" },
  POL: { symbol: "POL", name: "Polygon", logo: "/logos/tokens/pol.png" },
} as const satisfies Record<string, TokenBrand>;

export interface NetworkInfo {
  id: AccountNetwork;
  label: string;
  /** Square chain logo served from `public/logos/chains`. */
  logo: string;
  chainType: AgentChainType;
  nativeToken: string;
  /** Human sentence fragment, e.g. "USDC (plus a little POL for gas)". */
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
  polygon: {
    id: "polygon",
    label: "Polygon",
    logo: "/logos/chains/polygon.svg",
    chainType: "ethereum",
    nativeToken: "POL",
    fundingTokens: "USDC (plus a little POL for gas)",
    fundingTokenList: [TOKENS.USDC, TOKENS.POL],
    protocols: "Polymarket · prediction markets · perps",
    recommendedDeposit: "100 USDC",
    walletHint: "MetaMask · Rabby · WalletConnect",
    explorerAddressUrl: (address) =>
      `${polygonChain.blockExplorers.default.url}/address/${address}`,
  },
};

export const NETWORK_LIST: NetworkInfo[] = [NETWORKS.solana, NETWORKS.polygon];

export function networkFromChainType(
  chainType: string | undefined,
): AccountNetwork | null {
  if (chainType === "solana") {
    return "solana";
  }

  if (chainType === "ethereum") {
    return "polygon";
  }

  return null;
}
