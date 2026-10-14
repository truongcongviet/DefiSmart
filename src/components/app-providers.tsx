"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { type ReactNode, useMemo } from "react";
import { mainnet } from "viem/chains";

import {
  AuthFlowProvider,
  UnconfiguredAuthFlowProvider,
} from "@/components/auth/auth-flow-provider";
import { ConnectModal } from "@/components/auth/connect-modal";
import { polygonChain } from "@/lib/chains";

export function AppProviders({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();
  const walletConnectProjectId =
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  const solanaConnectors = useMemo(
    () => toSolanaWalletConnectors({ shouldAutoConnect: false }),
    [],
  );

  if (!appId) {
    return (
      <UnconfiguredAuthFlowProvider>{children}</UnconfiguredAuthFlowProvider>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId || undefined}
      config={{
        // Wallet (extension, WalletConnect QR, in-wallet mobile browser) + email OTP.
        loginMethods: ["wallet", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#10b981",
          landingHeader: "Connect your wallet",
          loginMessage:
            "Sign a gas-free message. Your agent wallet is created right after.",
          showWalletLoginFirst: true,
          walletChainType: "ethereum-and-solana",
          walletList: [
            "detected_solana_wallets",
            "detected_ethereum_wallets",
            "phantom",
            "solflare",
            "backpack",
            "metamask",
            // One generic entry covers WalletConnect QR for both chains; Privy
            // rejects listing the EVM and Solana QR entries together.
            "wallet_connect",
          ],
        },
        // Agent wallets are created explicitly on the network the account binds to.
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
          showWalletUIs: true,
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        supportedChains: [polygonChain, mainnet],
        defaultChain: polygonChain,
        walletConnectCloudProjectId: walletConnectProjectId || undefined,
      }}
    >
      <AuthFlowProvider>
        {children}
        <ConnectModal />
      </AuthFlowProvider>
    </PrivyProvider>
  );
}
