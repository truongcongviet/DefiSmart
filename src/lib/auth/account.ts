import type { LinkedAccountWithMetadata, User } from "@privy-io/react-auth";

import {
  type AccountNetwork,
  NETWORKS,
  networkFromChainType,
} from "@/lib/chains";

export type WalletAccount = Extract<
  LinkedAccountWithMetadata,
  { type: "wallet" }
>;

export function isWalletAccount(
  account: LinkedAccountWithMetadata,
): account is WalletAccount {
  return account.type === "wallet";
}

/** Privy embedded wallets are the "agent wallet" of this app. */
export function isAgentWallet(account: WalletAccount): boolean {
  return account.walletClientType === "privy";
}

export interface AccountSummary {
  userId: string;
  email: string | null;
  /** The network this account is bound to, or null until the user picks one. */
  network: AccountNetwork | null;
  agentWallet: WalletAccount | null;
  /** External wallets the user signed in or linked with. */
  ownerWallets: WalletAccount[];
  /** Short human label for the signed-in identity. */
  identityLabel: string;
}

export function shortAddress(address: string, size = 4): string {
  if (address.length <= size * 2 + 3) {
    return address;
  }

  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

export function findAgentWallet(
  user: User | null | undefined,
  network: AccountNetwork,
): WalletAccount | null {
  if (!user) {
    return null;
  }

  const chainType = NETWORKS[network].chainType;

  return (
    user.linkedAccounts
      .filter(isWalletAccount)
      .find(
        (wallet) => isAgentWallet(wallet) && wallet.chainType === chainType,
      ) ?? null
  );
}

export function summarizeAccount(
  user: User | null | undefined,
): AccountSummary | null {
  if (!user) {
    return null;
  }

  const wallets = user.linkedAccounts.filter(isWalletAccount);
  const agentWallet = wallets.find(isAgentWallet) ?? null;
  const ownerWallets = wallets.filter((wallet) => !isAgentWallet(wallet));
  const email = user.email?.address ?? null;

  const network =
    networkFromChainType(agentWallet?.chainType) ??
    networkFromChainType(ownerWallets[0]?.chainType);

  const identityLabel =
    email ??
    (ownerWallets[0] ? shortAddress(ownerWallets[0].address) : null) ??
    (agentWallet ? shortAddress(agentWallet.address) : "Account");

  return {
    userId: user.id,
    email,
    network,
    agentWallet,
    ownerWallets,
    identityLabel,
  };
}
